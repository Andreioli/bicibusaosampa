#!/usr/bin/env node
// Copies the SVGs named in design/icons/vocabulary.json into design/icons/<library>/
// (outline/ and filled/), at the version the vocabulary pins, with the library's licence
// and a source.json saying what was copied. Run it only after adding an icon or changing
// the library or its version; the copies are committed, so the build and the site need
// no network and no dependency.
//
// Usage: node scripts/fetch-icons.mjs   (npm run icons:fetch)
//
// Switching libraries: add it to LIBRARIES, then change library, version and the names
// in the vocabulary. Nothing else in the app knows which library draws the icons.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'design', 'icons');

// Where each library publishes one SVG per icon and style, and its licence.
const LIBRARIES = {
  tabler: {
    svg: (v, style, name) => `https://unpkg.com/@tabler/icons@${v}/icons/${style}/${name}.svg`,
    license: (v) => `https://unpkg.com/@tabler/icons@${v}/LICENSE`,
  },
};

const vocabulary = JSON.parse(readFileSync(join(ICONS, 'vocabulary.json'), 'utf8'));
const lib = LIBRARIES[vocabulary.library];
if (!lib) throw new Error(`no source for library "${vocabulary.library}" in scripts/fetch-icons.mjs`);

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const wanted = { outline: new Set(), filled: new Set() };
for (const i of Object.values(vocabulary.icons)) {
  wanted.outline.add(i.name);
  if (i.filled) wanted.filled.add(i.filled);
}
// Download everything first, so a failure leaves the committed copies alone.
const files = new Map();
for (const [style, names] of Object.entries(wanted)) {
  for (const name of names) files.set(join(style, `${name}.svg`), await get(lib.svg(vocabulary.version, style, name)));
}
files.set('LICENSE', await get(lib.license(vocabulary.version)));
files.set('source.json', JSON.stringify({ library: vocabulary.library, version: vocabulary.version }, null, 2) + '\n');

// Copies of a library the vocabulary no longer uses, and icons it dropped, go.
for (const entry of readdirSync(ICONS, { withFileTypes: true })) {
  if (entry.isDirectory()) rmSync(join(ICONS, entry.name), { recursive: true });
}
const dir = join(ICONS, vocabulary.library);
for (const [path, text] of files) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}
console.log(`${wanted.outline.size} outline + ${wanted.filled.size} filled from ${vocabulary.library} ${vocabulary.version}`);
