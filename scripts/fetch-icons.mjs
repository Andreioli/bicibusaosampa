#!/usr/bin/env node
// Copies the Lucide SVGs named in design/icons/vocabulary.json into design/icons/lucide/,
// at the version the vocabulary pins, with Lucide's licence. Run it only after adding an
// icon to the vocabulary or changing the version; the copies are committed, so the
// build and the site need no network and no dependency.
//
// Usage: node scripts/fetch-icons.mjs   (npm run icons:fetch)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'design', 'icons', 'lucide');
const vocabulary = JSON.parse(readFileSync(join(ROOT, 'design', 'icons', 'vocabulary.json'), 'utf8'));
const base = `https://unpkg.com/lucide-static@${vocabulary.lucide}`;

async function get(path) {
  const res = await fetch(`${base}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

writeFileSync(join(DIR, 'LICENSE'), await get('LICENSE'));
const names = new Set(Object.values(vocabulary.icons).map((i) => i.lucide));
for (const name of names) {
  const file = join(DIR, `${name}.svg`);
  const svg = await get(`icons/${name}.svg`);
  if (!svg.includes(`lucide-static v${vocabulary.lucide}`)) throw new Error(`${name}: not version ${vocabulary.lucide}`);
  if (!existsSync(file) || readFileSync(file, 'utf8') !== svg) console.log(`${name}.svg`);
  writeFileSync(file, svg);
}
console.log(`${names.size} icons from lucide-static ${vocabulary.lucide}`);
