// The design system's rules (DESIGN.md). Each test is a rule marked [enforced] there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { buildTokens, DESIGN_DOC, OUT_CSS, OUT_JS, resolveScheme, resolveValue, SCHEMES, updateDesignDoc } from '../scripts/build-tokens.mjs';
import { tokens } from '../public/js/tokens.js';

const ROOT = join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const NS = 'info.bicisampa';
const schemes = Object.fromEntries(SCHEMES.map((s) => [s, resolveScheme(s)]));
const roles = [...schemes.light.values()].filter((t) => t.path[0] !== 'ref');
const meta = (t) => t.$extensions?.[NS] ?? {};

// Role tokens that may hold a raw value, and why. Everything else points at ref. A key
// ending in .* covers a group. Shadows under it still need their colour from ref.
const ROLE_LITERALS = {
  'ui.size.touch': 'Não há escala de tamanhos ainda (vem no redesign).',
  'ui.font.family.base': 'A fonte do sistema não é uma primitiva da paleta.',
  'ui.shadow.*': 'Deslocamento e desfoque: não há escala de espaço ainda (vem no redesign).',
};
const literalRule = (key) => Object.keys(ROLE_LITERALS).find((k) => k === key || (k.endsWith('.*') && key.startsWith(k.slice(0, -1))));
// Custom properties set at runtime, outside the tokens.
const RUNTIME_VARS = ['--sat', '--sar', '--sab', '--sal', '--bus-scale'];

const sources = () => [
  'public/style.css',
  'public/index.html',
  'public/sw-template.js',
  ...readdirSync(join(ROOT, 'public/js')).filter((f) => f.endsWith('.js') && f !== 'tokens.js').map((f) => `public/js/${f}`),
];

test('tokens.css, tokens.js and the tables in DESIGN.md are up to date (run npm run build:tokens)', () => {
  const { css, js, tables } = buildTokens();
  assert.equal(readFileSync(OUT_CSS, 'utf8'), css);
  assert.equal(readFileSync(OUT_JS, 'utf8'), js);
  const doc = readFileSync(DESIGN_DOC, 'utf8');
  assert.equal(doc, updateDesignDoc(doc, tables));
});

test('ref is the palette: no aliases', () => {
  for (const t of schemes.light.values()) {
    if (t.path[0] === 'ref') assert.ok(typeof t.$value !== 'string' || !t.$value.startsWith('{'), `${t.path.join('.')} is an alias`);
  }
});

// The words `usage` may use (DESIGN.md, "Metadados"), so tools can rely on them.
const USAGE = ['text', 'icon', 'background', 'border', 'outline', 'line', 'fill', 'shadow', 'text-shadow', 'font', 'width', 'height', 'theme-color'];

test('every role has a description and a usage from the list', () => {
  for (const t of roles) {
    assert.ok(t.$description, `${t.path.join('.')} has no $description`);
    assert.ok(meta(t).usage?.length, `${t.path.join('.')} has no usage`);
    for (const u of meta(t).usage) assert.ok(USAGE.includes(u), `${t.path.join('.')}: unknown usage "${u}"`);
  }
});

test('roles point at ref, except the declared literals', () => {
  const isAlias = (v) => typeof v === 'string' && /^\{[^}]+\}$/.test(v);
  const pointsAtRef = (v, where) => assert.ok(v.slice(1).startsWith('ref.'), `${where} points at ${v}, not at ref`);
  const used = new Set();
  for (const scheme of SCHEMES) {
    for (const t of schemes[scheme].values()) {
      if (t.path[0] === 'ref') continue;
      const key = t.path.join('.');
      const where = `${key} (${scheme})`;
      const rule = literalRule(key);
      if (isAlias(t.$value)) { pointsAtRef(t.$value, where); continue; }
      if (t.$type === 'shadow') {
        for (const s of [t.$value].flat()) {
          assert.ok(isAlias(s.color), `${where}: the shadow colour must be a token`);
          pointsAtRef(s.color, where);
          const raw = ['offsetX', 'offsetY', 'blur', 'spread'].filter((k) => s[k] && !isAlias(s[k]));
          if (raw.length) { assert.ok(rule, `${where}: raw ${raw.join(', ')}`); used.add(rule); }
        }
        continue;
      }
      assert.ok(rule, `${where}: raw value ${JSON.stringify(t.$value)}`);
      used.add(rule);
    }
  }
  for (const rule of Object.keys(ROLE_LITERALS)) assert.ok(used.has(rule), `ROLE_LITERALS["${rule}"] covers no raw value: remove it`);
});

test('the dark theme has exactly the tokens of the light one, values only', () => {
  const flat = (file) => {
    const out = new Map();
    const walk = (node, path) => {
      for (const [k, v] of Object.entries(node)) {
        if (k.startsWith('$') || typeof v !== 'object') continue;
        if ('$value' in v) out.set([...path, k].join('.'), v);
        else walk(v, [...path, k]);
      }
    };
    walk(JSON.parse(read(file)), []);
    return out;
  };
  const light = flat('design/tokens/themes/light.tokens.json');
  const dark = flat('design/tokens/themes/dark.tokens.json');
  assert.deepEqual([...dark.keys()].sort(), [...light.keys()].sort());
  for (const [key, t] of dark) assert.deepEqual(Object.keys(t), ['$value'], `${key}: description and metadata live in light.tokens.json`);
});

test('no colour literals outside the tokens', () => {
  const literal = /(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
  // Named colours as CSS values (comments may still say "white").
  const named = /:\s*[^;{}]*\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|teal|cyan)\b[^;{}]*;/gi;
  for (const file of sources()) {
    let text = read(file);
    // index.html can't read CSS: its theme-color repeats brand.theme (checked below).
    if (file.endsWith('index.html')) text = text.replace(/<meta name="theme-color"[^>]*>/, '');
    const css = file.endsWith('.css');
    const found = text.split('\n').flatMap((line, i) => (line.match(literal) || (css && line.match(named)) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
    assert.deepEqual(found, [], 'use a token (DESIGN.md, "Mudar uma cor")');
  }
});

test('the code reads only role tokens, and only ones that exist', () => {
  const defined = new Set([...read('public/tokens.css').matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));
  for (const file of sources()) {
    for (const [, name] of read(file).matchAll(/var\((--[\w-]+)/g)) {
      assert.ok(!name.startsWith('--ref-'), `${file} reads ${name}: use a role token, never ref`);
      assert.ok(defined.has(name) || RUNTIME_VARS.includes(name), `${file} reads ${name}, which no token defines`);
    }
  }
});

test('theme-color and the manifest match the brand tokens', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.theme_color, tokens.brand.theme);
  assert.equal(manifest.background_color, tokens.brand.splash);
  assert.equal(read('public/index.html').match(/<meta name="theme-color" content="([^"]+)">/)[1], tokens.brand.theme);
});

// WCAG 2.x contrast, with translucent colours composited over what's behind them.
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const over = (top, under) => top.components.map((c, i) => c * (top.alpha ?? 1) + under[i] * (1 - (top.alpha ?? 1)));
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('declared contrast pairs pass, in both schemes; departures are recorded and still needed', () => {
  for (const t of roles) {
    for (const rule of meta(t).contrast ?? []) {
      for (const scheme of SCHEMES) {
        const all = schemes[scheme];
        const color = (path) => resolveValue(all, all.get(path).$value);
        const page = color('ui.surface.page').components;
        const bg = over(color(rule.against), page);
        const r = ratio(over(color(t.path.join('.')), bg), bg);
        const where = `${t.path.join('.')} on ${rule.against} (${scheme}): ${r.toFixed(2)}:1`;
        if (rule.departure) {
          assert.ok(rule.departure.reason && rule.departure.since, `${where}: a departure needs a reason and a date`);
          assert.ok(r < rule.min, `${where} passes now: remove the departure`);
        } else {
          assert.ok(r >= rule.min, `${where}, needs ${rule.min}:1`);
        }
      }
    }
  }
});

test('every token path the JavaScript reads exists', () => {
  const files = readdirSync(join(ROOT, 'public/js')).filter((f) => f.endsWith('.js') && f !== 'tokens.js');
  for (const file of files) {
    const text = read(`public/js/${file}`);
    // const MAP = tokens.map; → MAP.x.y means tokens.map.x.y
    const roots = new Map([['tokens', []], ...[...text.matchAll(/const (\w+) = tokens((?:\.\w+)+);/g)].map((m) => [m[1], m[2].slice(1).split('.')])]);
    for (const [name, base] of roots) {
      for (const [, path] of text.matchAll(new RegExp(`(?<![\\w./])${name}((?:\\.\\w+)+)(?![\\w(])`, 'g'))) {
        const keys = [...base, ...path.slice(1).split('.')];
        const value = keys.reduce((o, k) => o?.[k], tokens);
        assert.ok(value !== undefined, `public/js/${file}: ${name}${path} is not a token`);
      }
    }
  }
});
