#!/usr/bin/env node
// Builds the design tokens (design/tokens/, DTCG 2025.10) into the files the site loads:
// public/tokens.css (custom properties, light and dark) and public/js/tokens.js (the same
// values for canvas, SVG icons and the tests). Both are generated: never edit them.
// It also rewrites the token tables in DESIGN.md (between <!-- tokens:… --> markers) and
// the colours that index.html and the manifest repeat, since those can't read CSS.
//
// Usage: node scripts/build-tokens.mjs   (npm run build:tokens)
//
// Covers the subset of the spec this project uses: the resolver's sets and one modifier
// (scheme), aliases, and the color, dimension, shadow and fontFamily types. Anything else
// is an error, not a guess. Why a script of our own instead of Style Dictionary:
// DESIGN.md, "Decisões".

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = join(ROOT, 'design', 'tokens');
const RESOLVER = join(TOKENS, 'bicibusao.resolver.json');
export const OUT_CSS = join(ROOT, 'public', 'tokens.css');
export const OUT_JS = join(ROOT, 'public', 'js', 'tokens.js');
export const DESIGN_DOC = join(ROOT, 'DESIGN.md');
export const INDEX_HTML = join(ROOT, 'public', 'index.html');
export const MANIFEST = join(ROOT, 'public', 'manifest.webmanifest');
export const SCHEMES = ['light', 'dark'];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const ALIAS = /^\{([^}]+)\}$/;
// Token kinds that never change with the colour scheme (DESIGN.md, decision 6).
const SCHEMELESS = ['ref', 'map', 'brand'];

// Token tree → Map(dotted path → token), with $type inherited from the groups.
function flatten(node, path = [], type, out = new Map()) {
  for (const key of ['$extends', '$ref']) if (key in node) throw new Error(`${path.join('.') || 'root'}: ${key} is not supported`);
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$') || !child || typeof child !== 'object') continue;
    const childType = child.$type ?? type;
    if ('$value' in child) out.set([...path, key].join('.'), { ...child, $type: childType, path: [...path, key] });
    else flatten(child, [...path, key], childType, out);
  }
  return out;
}

/** Every token for one value of the scheme modifier, in the resolver's order. Later sources win. */
export function resolveScheme(scheme) {
  const resolver = readJson(RESOLVER);
  const tokens = new Map();
  for (const { $ref } of resolver.resolutionOrder) {
    const [, kind, name] = $ref.split('/');
    const sources = kind === 'sets' ? resolver.sets[name].sources : resolver.modifiers[name].contexts[scheme];
    if (!sources) throw new Error(`${$ref}: no sources for ${scheme}`);
    for (const source of sources) for (const [key, token] of flatten(readJson(join(TOKENS, source.$ref)))) tokens.set(key, token);
  }
  return tokens;
}

/** A token's value with every alias followed to the end. */
export function resolveValue(tokens, value, seen = []) {
  if (typeof value === 'string') {
    const alias = value.match(ALIAS);
    if (!alias) return value;
    if (seen.includes(alias[1])) throw new Error(`alias cycle: ${[...seen, alias[1]].join(' → ')}`);
    const target = tokens.get(alias[1]);
    if (!target) throw new Error(`unknown token {${alias[1]}}`);
    return resolveValue(tokens, target.$value, [...seen, alias[1]]);
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && !('colorSpace' in value) && !('unit' in value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(tokens, v, seen)]));
  }
  return value;
}

export const cssVar = (path) => `--${path.join('-')}`;

// Colors: hex when opaque, rgb() with alpha otherwise. Only sRGB is used here.
function color(c) {
  if (c.colorSpace !== 'srgb') throw new Error(`unsupported color space ${c.colorSpace}`);
  if (c.alpha === undefined || c.alpha === 1) return c.hex ?? `rgb(${c.components.map((x) => Math.round(x * 255)).join(' ')})`;
  return `rgb(${c.components.map((x) => Math.round(x * 255)).join(' ')} / ${c.alpha})`;
}
const dimension = (d) => `${d.value}${d.unit}`;
// A zero spread is left out: then the same token is valid in box-shadow and text-shadow
// (which has no spread, and drops the whole declaration if it gets one).
function shadowLengths(tokens, s) {
  if (s.inset) throw new Error('inset shadows are not supported');
  return resolveValue(tokens, s.spread)?.value ? [s.offsetX, s.offsetY, s.blur, s.spread] : [s.offsetX, s.offsetY, s.blur];
}
const family = (f) => (/^[\w-]+$/.test(f) ? f : `"${f}"`);

// The CSS value of a token. Aliases into ref stay var(--ref-…), so DevTools shows where a
// value comes from; everything else is written out.
function cssValue(tokens, value, type) {
  const alias = typeof value === 'string' && value.match(ALIAS);
  if (alias) {
    const target = tokens.get(alias[1]);
    if (!target) throw new Error(`unknown token {${alias[1]}}`);
    return target.path[0] === 'ref' ? `var(${cssVar(target.path)})` : cssValue(tokens, target.$value, type);
  }
  switch (type) {
    case 'color': return color(value);
    case 'dimension': return dimension(value);
    case 'fontFamily': return [value].flat().map(family).join(', ');
    case 'shadow':
      return [value].flat().map((s) => shadowLengths(tokens, s).map((d) => cssValue(tokens, d, 'dimension'))
        .concat(cssValue(tokens, s.color, 'color')).join(' ')).join(', ');
    default: throw new Error(`unsupported $type ${type}`);
  }
}

// In JavaScript the names are camelCase: map.plan.bus-bike → tokens.map.plan.busBike.
const camel = (name) => name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
function setPath(obj, path, value) {
  const keys = path.map(camel);
  const parent = keys.slice(0, -1).reduce((o, k) => (o[k] ??= {}), obj);
  parent[keys.at(-1)] = value;
}

export function buildTokens() {
  const [light, dark] = SCHEMES.map(resolveScheme);
  const root = [];
  const darkRoot = [];
  const js = {};
  const rows = { ui: [], map: [], brand: [] };
  const names = new Map();
  for (const [key, token] of light) {
    const other = dark.get(key);
    if (!other) throw new Error(`${key} is missing in the dark scheme`);
    // Two paths can meet in one name (map.plan.bus-bike and map.plan.bus.bike).
    for (const name of [cssVar(token.path), token.path.map(camel).join('.')]) {
      if (names.has(name)) throw new Error(`${key} and ${names.get(name)} both become ${name}`);
      names.set(name, key);
    }
    const lightCss = cssValue(light, token.$value, token.$type);
    const darkCss = cssValue(dark, other.$value, other.$type);
    if (darkCss !== lightCss && SCHEMELESS.includes(token.path[0])) throw new Error(`${key} changes with the scheme; only ui.* may`);
    // Descriptions stay out: this file is render-blocking, and they live in the JSON and DESIGN.md.
    root.push(`  ${cssVar(token.path)}: ${lightCss};`);
    if (darkCss !== lightCss) darkRoot.push(`    ${cssVar(token.path)}: ${darkCss};`);
    if (token.path[0] === 'ref') continue;
    const lightJs = resolveJs(light, token);
    const darkJs = resolveJs(dark, other);
    setPath(js, token.path, lightJs === darkJs ? lightJs : { light: lightJs, dark: darkJs });
    const shown = lightJs === darkJs ? `\`${lightJs}\`` : `\`${lightJs}\` · escuro \`${darkJs}\``;
    const departures = (token.$extensions?.['info.bicisampa']?.contrast ?? []).filter((c) => c.departure);
    const flag = departures.length ? ` ⚠️ ${departures.map((c) => `contraste com \`${c.against}\` abaixo de ${c.min}:1`).join('; ')}.` : '';
    rows[token.path[0]]?.push(`| \`${key}\` | ${shown} | ${(token.$description ?? '').replaceAll('|', '\\|')}${flag} |`);
  }
  const tables = Object.fromEntries(Object.entries(rows).map(([group, lines]) => [group,
    ['| Token | Valor | Para quê |', '|---|---|---|', ...lines].join('\n')]));
  const css = `/* Generated by scripts/build-tokens.mjs from design/tokens/. Do not edit: see DESIGN.md. */

:root {
${root.join('\n')}
}

@media (prefers-color-scheme: dark) {
  :root {
${darkRoot.join('\n')}
  }
}
`;
  const jsOut = `// Generated by scripts/build-tokens.mjs from design/tokens/. Do not edit: see DESIGN.md.
// Values for code that can't read CSS custom properties (canvas, SVG strings, tests).
// A token that changes with the colour scheme is { light, dark }.

export const tokens = ${JSON.stringify(js, null, 2)};
`;
  return { css, js: jsOut, tables, brand: js.brand };
}

/** DESIGN.md with each <!-- tokens:<group> --> block replaced by its generated table. */
export function updateDesignDoc(doc, tables) {
  for (const group of Object.keys(tables)) {
    if (!doc.includes(`<!-- tokens:${group} -->\n`) || !doc.includes(`<!-- /tokens:${group} -->`)) throw new Error(`DESIGN.md: markers for ${group} are missing`);
  }
  return doc.replace(/(<!-- tokens:(\w+) -->\n)[\s\S]*?(<!-- \/tokens:\2 -->)/g, (m, open, group, close) => {
    if (!tables[group]) throw new Error(`DESIGN.md: no tokens in group ${group}`);
    return `${open}${tables[group]}\n${close}`;
  });
}

/** index.html and the manifest can't read CSS: their colours are rewritten from brand.*. */
export function updateBrandColors(html, manifest, brand) {
  const meta = /(<meta name="theme-color" content=")[^"]*(">)/;
  if (!meta.test(html)) throw new Error('index.html: no theme-color meta');
  const m = JSON.parse(manifest);
  return {
    html: html.replace(meta, `$1${brand.theme}$2`),
    manifest: JSON.stringify({ ...m, theme_color: brand.theme, background_color: brand.splash }, null, 2) + '\n',
  };
}

// The value for JavaScript: the same CSS text, fully resolved (canvas can't read var()).
function resolveJs(tokens, token) {
  const value = resolveValue(tokens, token.$value);
  switch (token.$type) {
    case 'color': return color(value);
    case 'dimension': return dimension(value);
    case 'fontFamily': return [value].flat().map(family).join(', ');
    case 'shadow': return [value].flat().map((s) => `${shadowLengths(tokens, s).map(dimension).join(' ')} ${color(s.color)}`).join(', ');
    default: throw new Error(`unsupported $type ${token.$type}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { css, js, tables, brand } = buildTokens();
  writeFileSync(OUT_CSS, css);
  writeFileSync(OUT_JS, js);
  writeFileSync(DESIGN_DOC, updateDesignDoc(readFileSync(DESIGN_DOC, 'utf8'), tables));
  const app = updateBrandColors(readFileSync(INDEX_HTML, 'utf8'), readFileSync(MANIFEST, 'utf8'), brand);
  writeFileSync(INDEX_HTML, app.html);
  writeFileSync(MANIFEST, app.manifest);
  console.log('tokens → public/tokens.css, public/js/tokens.js, DESIGN.md, index.html and manifest colours');
}
