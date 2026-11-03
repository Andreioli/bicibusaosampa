// The design system's rules (DESIGN.md). Each test is a rule marked [enforced] there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { buildTokens, DESIGN_DOC, MODIFIERS, OUT_CSS, OUT_JS, resolveContexts, resolveScheme, resolveValue, SCHEMES, updateDesignDoc } from '../scripts/build-tokens.mjs';
import { buildIconsJs, loadIcons, updateIndexIcons } from '../scripts/build-icons.mjs';
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
  'ui.shadow.*': 'Deslocamento e desfoque de sombra (1, 3, 6 px…) não cabem na grade de espaço; a cor vem da paleta.',
  'ui.layer.*': 'A ordem de empilhamento conversa com números fixos do Leaflet (popups em 700, controles em 1000), não com uma escala.',
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
const USAGE = [
  'text', 'icon', 'background', 'border', 'outline', 'line', 'fill', 'shadow', 'text-shadow', 'font', 'theme-color',
  'padding', 'gap', 'margin', 'position', 'width', 'height', 'radius', 'z-index', 'transition', 'animation',
];

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
      if (t.$type === 'typography') {
        for (const [part, v] of Object.entries(t.$value)) {
          assert.ok(isAlias(v), `${where}: raw ${part}`);
          pointsAtRef(v, `${where}.${part}`);
        }
        continue;
      }
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

test('each modifier context has exactly the tokens of the default one, values only', () => {
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
  const resolver = JSON.parse(read('design/tokens/bicibusao.resolver.json'));
  for (const [name, [first, ...others]] of Object.entries(MODIFIERS)) {
    const files = (c) => resolver.modifiers[name].contexts[c].map((s) => `design/tokens/${s.$ref}`);
    const keys = (c) => files(c).flatMap((f) => [...flat(f).keys()]).sort();
    for (const c of others) {
      assert.deepEqual(keys(c), keys(first), `${name}: ${c} and ${first} must define the same tokens`);
      for (const f of files(c)) {
        for (const [key, t] of flat(f)) assert.deepEqual(Object.keys(t), ['$value'], `${f}: ${key}: description and metadata live in the ${first} file`);
      }
    }
  }
});

test('space and size sit on the 4 px grid (2 px is the one exception)', () => {
  for (const t of schemes.light.values()) {
    if (t.path[0] !== 'ref' || !['space', 'size'].includes(t.path[1])) continue;
    const { value, unit } = t.$value;
    assert.equal(unit, 'px', t.path.join('.'));
    assert.ok(value % 4 === 0 || value === 2, `${t.path.join('.')} = ${value}px is off the grid`);
  }
});

// The properties style.css must fill from tokens. 0, percentages, keywords and var() are fine.
const SCALED = /^\s*(padding|margin|gap|row-gap|column-gap|border-radius|font|font-size|font-weight|line-height|letter-spacing|transition|animation|z-index)(-[a-z-]+)?\s*:\s*([^;]+);/;

test('spacing, radius, type, motion and layers in style.css come from tokens', () => {
  const found = [];
  read('public/style.css').split('\n').forEach((line, i) => {
    for (const decl of line.split(/[{;}]/).map((d) => `${d.trim()};`)) {
      const m = decl.match(SCALED);
      if (!m) continue;
      // What's left once tokens are taken out: a number with a unit, or a bare number, is a literal.
      const rest = m[3].replace(/var\(--[\w-]+\)/g, '').replace(/\*\s*-1\b/g, '').replace(/!important/g, '');
      if (/(?<![\w-])-?\d*\.?\d+(px|em|rem|ms|s)?(?![\w%-])/.test(rest.replace(/\b0\b/g, ''))) found.push(`style.css:${i + 1}: ${decl}`);
    }
  });
  assert.deepEqual(found, [], 'use a token (DESIGN.md, "Usar um token")');
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

// Inline styles in generated HTML may only carry what's computed at runtime (a line's
// colour, a size from the zoom); everything else is a class in style.css.
const INLINE_OK = ['background', 'width', 'height', 'transform', 'fill'];

test('inline styles in JavaScript only set runtime values', () => {
  for (const f of readdirSync(join(ROOT, 'public/js')).filter((x) => x.endsWith('.js'))) {
    for (const [, style] of read(`public/js/${f}`).matchAll(/(?<![\w-])style="([^"]*)"/g)) {
      for (const prop of style.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean)) {
        assert.ok(INLINE_OK.includes(prop), `public/js/${f}: inline ${prop} in style="${style}": use a class`);
      }
    }
  }
});

test('the palette holds only what some role uses', () => {
  const used = new Set();
  for (const [m, contexts] of Object.entries(MODIFIERS)) {
    for (const c of contexts) {
      for (const t of resolveContexts({ [m]: c }).values()) {
        if (t.path[0] !== 'ref') JSON.stringify(t.$value).replace(/\{(ref\.[^}]+)\}/g, (_, r) => used.add(r));
      }
    }
  }
  const unused = [...schemes.light.values()].filter((t) => t.path[0] === 'ref' && !used.has(t.path.join('.'))).map((t) => t.path.join('.'));
  assert.deepEqual(unused, [], 'remove these from ref.tokens.json, or give them a role');
});

// Icons (DESIGN.md, "Ícones").
const vocabulary = JSON.parse(read('design/icons/vocabulary.json'));
const uiFiles = () => ['public/index.html', 'public/style.css', ...readdirSync(join(ROOT, 'public/js')).filter((f) => f.endsWith('.js') && !['tokens.js', 'icons.js'].includes(f)).map((f) => `public/js/${f}`)];

test('icons.js and the icons in index.html are up to date (run npm run build:icons)', () => {
  const icons = loadIcons();
  assert.equal(read('public/js/icons.js'), buildIconsJs(icons));
  const html = read('public/index.html');
  assert.equal(html, updateIndexIcons(html, icons));
});

test('every icon used is in the vocabulary, in a style it has, and every icon is used', () => {
  const used = new Map(); // meaning → styles
  const use = (name, style = 'outline') => used.set(name, new Set([...(used.get(name) ?? []), style]));
  for (const file of uiFiles()) {
    const text = read(file);
    for (const [, name, style] of text.matchAll(/\bicon\('([\w-]+)'(?:,\s*'[^']*'(?:,\s*'([\w-]+)')?)?/g)) use(name, style);
    for (const [, name, style] of text.matchAll(/data-icon="([\w-]+)"(?: data-style="([\w-]+)")?/g)) use(name, style);
    // MODE_ICON in planner.js maps leg kinds through a list.
    for (const [, list] of text.matchAll(/\[([^\]]*)\]\.map\(\(m\) => \[m, icon\(m\)\]\)/g)) for (const [, n] of list.matchAll(/'([\w-]+)'/g)) use(n);
  }
  for (const [name, styles] of used) {
    const entry = vocabulary.icons[name];
    assert.ok(entry, `icon "${name}" is not in design/icons/vocabulary.json`);
    if (styles.has('filled')) assert.ok(entry.filled, `icon "${name}" is used filled, but the vocabulary has no filled drawing for it`);
  }
  for (const name of Object.keys(vocabulary.icons)) assert.ok(used.has(name), `icon "${name}" is in the vocabulary but nothing uses it`);
});

test('the copied SVGs are exactly those of the vocabulary, from its library and version, with the licence', () => {
  const dir = `design/icons/${vocabulary.library}`;
  assert.deepEqual(readdirSync(join(ROOT, 'design/icons')).sort(), [vocabulary.library, 'vocabulary.json'].sort(), 'only the current library is copied (npm run icons:fetch)');
  assert.deepEqual(JSON.parse(read(`${dir}/source.json`)), { library: vocabulary.library, version: vocabulary.version }, 'copies are from another version (npm run icons:fetch)');
  assert.ok(read(`${dir}/LICENSE`).length > 0, `${dir}/LICENSE is missing`);
  for (const style of ['outline', 'filled']) {
    const key = style === 'outline' ? 'name' : 'filled';
    const wanted = [...new Set(Object.values(vocabulary.icons).map((i) => i[key]).filter(Boolean))].map((n) => `${n}.svg`).sort();
    assert.deepEqual(readdirSync(join(ROOT, dir, style)).sort(), wanted, `${dir}/${style} (npm run icons:fetch)`);
  }
});

test('no emoji or text glyphs as icons in the interface', () => {
  const glyph = /(?![©®™\u2190-\u21ff])\p{Extended_Pictographic}|[☰▾▴✕⇅⇄]/u; // ©, ™ and arrows in text (A → B) are text, not icons
  for (const file of uiFiles()) {
    read(file).split('\n').forEach((line, i) => assert.ok(!glyph.test(line), `${file}:${i + 1}: use an icon (DESIGN.md, "Ícones"): ${line.trim()}`));
  }
});
