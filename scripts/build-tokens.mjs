#!/usr/bin/env node
// Builds the design tokens (design/tokens/, DTCG 2025.10) into the files the site loads:
// public/tokens.css (custom properties, with a media query per modifier context) and
// public/js/tokens.js (the same values for canvas, SVG icons and the tests). Both are
// generated: never edit them. It also rewrites the token tables in DESIGN.md (between
// <!-- tokens:… --> markers) and the colours that index.html and the manifest repeat,
// since those can't read CSS.
//
// Usage: node scripts/build-tokens.mjs   (npm run build:tokens)
//
// Covers the subset of the spec this project uses: the resolver's sets and modifiers,
// aliases, and the color, dimension, number, fontFamily, fontWeight, duration,
// cubicBezier, shadow and typography types. Anything else is an error, not a guess.
// Why a script of our own instead of Style Dictionary: DESIGN.md, "Decisões".

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

// The media query that switches each non-default context on.
const MEDIA = {
  scheme: { dark: '(prefers-color-scheme: dark)' },
  motion: { reduced: '(prefers-reduced-motion: reduce)' },
};
// Token kinds that never change with the colour scheme (DESIGN.md, decision 6).
const SCHEMELESS = ['ref', 'map', 'brand'];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const ALIAS = /^\{([^}]+)\}$/;
const resolver = readJson(RESOLVER);

/** Each modifier with its contexts, the default first. */
export const MODIFIERS = Object.fromEntries(Object.entries(resolver.modifiers).map(([name, m]) => {
  const contexts = Object.keys(m.contexts);
  return [name, [m.default, ...contexts.filter((c) => c !== m.default)]];
}));
export const SCHEMES = MODIFIERS.scheme;

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

/** Every token for one choice of contexts ({ scheme: 'dark' }; the rest take their default), in the resolver's order. */
export function resolveContexts(inputs = {}) {
  for (const name of Object.keys(inputs)) if (!MODIFIERS[name]) throw new Error(`unknown modifier ${name}`);
  const tokens = new Map();
  for (const { $ref } of resolver.resolutionOrder) {
    const [, kind, name] = $ref.split('/');
    const sources = kind === 'sets' ? resolver.sets[name].sources : resolver.modifiers[name].contexts[inputs[name] ?? MODIFIERS[name][0]];
    if (!sources) throw new Error(`${$ref}: no sources for ${inputs[name]}`);
    for (const source of sources) for (const [key, token] of flatten(readJson(join(TOKENS, source.$ref)))) tokens.set(key, token);
  }
  return tokens;
}
export const resolveScheme = (scheme) => resolveContexts({ scheme });

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
const family = (f) => (/^[\w-]+$/.test(f) ? f : `"${f}"`);
const UNITS = { dimension: ['px', 'rem'], duration: ['ms', 's'] };

// The CSS text of a value. With `refVars`, aliases into ref stay var(--ref-…), so DevTools
// shows where a value comes from; without, everything is written out (for JavaScript,
// where canvas can't read var()).
function format(tokens, value, type, refVars) {
  const alias = typeof value === 'string' && value.match(ALIAS);
  if (alias) {
    const target = tokens.get(alias[1]);
    if (!target) throw new Error(`unknown token {${alias[1]}}`);
    if (target.$type !== type) throw new Error(`{${alias[1]}} is a ${target.$type}, not a ${type}`);
    return refVars && target.path[0] === 'ref' ? `var(${cssVar(target.path)})` : format(tokens, target.$value, type, refVars);
  }
  const part = (v, t) => format(tokens, v, t, refVars);
  switch (type) {
    case 'color': return color(value);
    case 'dimension':
    case 'duration':
      if (!UNITS[type].includes(value.unit)) throw new Error(`unsupported ${type} unit ${value.unit}`);
      return `${value.value}${value.unit}`;
    case 'number': case 'fontWeight': return String(value);
    case 'fontFamily': return [value].flat().map(family).join(', ');
    case 'cubicBezier': return `cubic-bezier(${value.join(', ')})`;
    case 'shadow':
      return [value].flat().map((s) => {
        if (s.inset) throw new Error('inset shadows are not supported');
        // A zero spread is left out: then the same token works in box-shadow and in
        // text-shadow, which has no spread and drops the whole declaration if it gets one.
        const lengths = resolveValue(tokens, s.spread)?.value ? [s.offsetX, s.offsetY, s.blur, s.spread] : [s.offsetX, s.offsetY, s.blur];
        return [...lengths.map((d) => part(d, 'dimension')), part(s.color, 'color')].join(' ');
      }).join(', ');
    case 'typography':
      // The font shorthand; letter-spacing isn't part of it (see the -tracking variable).
      return `${part(value.fontWeight, 'fontWeight')} ${part(value.fontSize, 'dimension')}/${part(value.lineHeight, 'number')} ${part(value.fontFamily, 'fontFamily')}`;
    default: throw new Error(`unsupported $type ${type}`);
  }
}

// One token can become more than one custom property: typography adds its tracking.
function properties(tokens, token, refVars) {
  const own = [[token.path, format(tokens, token.$value, token.$type, refVars)]];
  if (token.$type === 'typography') own.push([[...token.path.slice(0, -1), `${token.path.at(-1)}-tracking`], format(tokens, token.$value.letterSpacing, 'dimension', refVars)]);
  return own;
}

// In JavaScript the names are camelCase: map.plan.bus-bike → tokens.map.plan.busBike.
const camel = (name) => name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
function setPath(obj, path, value) {
  const keys = path.map(camel);
  const parent = keys.slice(0, -1).reduce((o, k) => (o[k] ??= {}), obj);
  parent[keys.at(-1)] = value;
}

export function buildTokens() {
  const base = resolveContexts();
  // Every non-default context, resolved once: [modifier, context, tokens].
  const variants = Object.entries(MODIFIERS).flatMap(([m, [, ...others]]) => others.map((c) => [m, c, resolveContexts({ [m]: c })]));
  const root = [];
  const media = new Map(variants.map(([m, c]) => [`${m}.${c}`, []]));
  const js = {};
  const rows = { ui: [], map: [], brand: [] };
  const names = new Map();
  for (const [key, token] of base) {
    const props = properties(base, token, true);
    // Two paths can meet in one name (map.plan.bus-bike and map.plan.bus.bike).
    for (const name of [...props.map(([p]) => cssVar(p)), token.path.map(camel).join('.')]) {
      if (names.has(name)) throw new Error(`${key} and ${names.get(name)} both become ${name}`);
      names.set(name, key);
    }
    // Descriptions stay out: this file is render-blocking, and they live in the JSON and DESIGN.md.
    for (const [path, value] of props) root.push(`  ${cssVar(path)}: ${value};`);

    let jsValue = format(base, token.$value, token.$type, false);
    const shown = [`\`${jsValue}\``];
    let varies;
    for (const [m, c, tokens] of variants) {
      const other = tokens.get(key);
      if (!other) throw new Error(`${key} is missing in ${m} ${c}`);
      const otherProps = properties(tokens, other, true);
      if (otherProps.every(([, v], i) => v === props[i][1])) continue;
      if (m === 'scheme' && SCHEMELESS.includes(token.path[0])) throw new Error(`${key} changes with the scheme; only ui.* may`);
      if (varies && varies !== m) throw new Error(`${key} changes with both ${varies} and ${m}`);
      varies = m;
      for (const [path, value] of otherProps) media.get(`${m}.${c}`).push(`    ${cssVar(path)}: ${value};`);
      const otherJs = format(tokens, other.$value, other.$type, false);
      jsValue = typeof jsValue === 'object' ? { ...jsValue, [c]: otherJs } : { [MODIFIERS[m][0]]: jsValue, [c]: otherJs };
      shown.push(`${c} \`${otherJs}\``);
    }
    if (token.path[0] === 'ref') continue;
    setPath(js, token.path, jsValue);
    const departures = (token.$extensions?.['info.bicisampa']?.contrast ?? []).filter((c) => c.departure);
    const flag = departures.length ? ` ⚠️ ${departures.map((c) => `contraste com \`${c.against}\` abaixo de ${c.min}:1`).join('; ')}.` : '';
    rows[token.path[0]]?.push(`| \`${key}\` | ${shown.join(' · ')} | ${(token.$description ?? '').replaceAll('|', '\\|')}${flag} |`);
  }
  const tables = Object.fromEntries(Object.entries(rows).map(([group, lines]) => [group,
    ['| Token | Valor | Para quê |', '|---|---|---|', ...lines].join('\n')]));
  const blocks = variants.map(([m, c]) => `
@media ${MEDIA[m]?.[c] ?? (() => { throw new Error(`no media query for ${m} ${c}`); })()} {
  :root {
${media.get(`${m}.${c}`).join('\n')}
  }
}
`).join('');
  const css = `/* Generated by scripts/build-tokens.mjs from design/tokens/. Do not edit: see DESIGN.md. */

:root {
${root.join('\n')}
}
${blocks}`;
  const jsOut = `// Generated by scripts/build-tokens.mjs from design/tokens/. Do not edit: see DESIGN.md.
// Values for code that can't read CSS custom properties (canvas, SVG strings, tests).
// A token that changes with a modifier is an object by context: { light, dark }.

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
