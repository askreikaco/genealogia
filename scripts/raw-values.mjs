#!/usr/bin/env node
// Raw-value guard (conv §36): literal colours, lengths, font sizes, shadows, radius, z-index, durations and @media width
// rules outside web/tokens.css. Values belong in tokens; this scanner counts what is left so the count can only go down.
//   node scripts/raw-values.mjs                   -> prints counts per file and kind
//   node scripts/raw-values.mjs --write-baseline  -> writes scripts/raw-values-baseline.json (after you removed raw values)
// Allowed without a token: 0, 1px hairlines, 2px focus rings, percentages, unitless flex/grid numbers, cqi/vw/vh/fr/ch.
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = join(ROOT, 'scripts/raw-values-baseline.json');

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;
const LENGTH = /(?<![\w.#-])(\d*\.?\d+)(px|rem|em)\b/g;
const DURATION = /(?<![\w.#-])\d*\.?\d+m?s\b/g;
const ALLOWED_PX = new Set(['0', '1', '2']);

export function kindOf(prop) {
  if (prop.startsWith('font') || prop === 'line-height' || prop === 'letter-spacing') return 'type';
  if (prop.includes('radius')) return 'radius';
  if (prop.includes('shadow')) return 'shadow';
  if (prop === 'z-index') return 'z';
  if (/^(transition|animation)/.test(prop)) return 'motion';
  if (/^(padding|margin|gap|row-gap|column-gap|inset|top|left|right|bottom)/.test(prop)) return 'space';
  if (/^(width|height|min-|max-|flex-basis|grid-template|grid-auto)/.test(prop)) return 'size';
  return 'other';
}

const stripVars = (v) => { let s = v; for (let i = 0; i < 5; i++) s = s.replace(/var\([^()]*\)/g, ''); return s; };

// Counts for one CSS text: { kind: n }. Custom property definitions (--x: ...) are skipped: they are tokens.
export function scanCss(text) {
  const out = {};
  const add = (k, n = 1) => { if (n) out[k] = (out[k] || 0) + n; };
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  add('media', (src.match(/@media[^{]*\((?:max|min)-width/g) || []).length);
  for (const m of src.matchAll(/(^|[;{\s])([a-z-]+)\s*:\s*([^;{}]+)/g)) {
    const prop = m[2]; const raw = m[3];
    if (prop.startsWith('--')) continue;
    const val = stripVars(raw);
    const colours = (val.match(COLOUR) || []).length;
    add('colour', colours);
    const v2 = val.replace(COLOUR, '');
    let lengths = 0;
    for (const l of v2.matchAll(LENGTH)) {
      if (l[2] === 'px' && ALLOWED_PX.has(String(Number(l[1])))) continue;
      lengths++;
    }
    if (prop === 'z-index' && /\b\d+\b/.test(val)) add('z');
    else if (kindOf(prop) === 'motion') add('motion', (v2.match(DURATION) || []).length);
    if (prop === 'line-height' && /^\s*\d*\.?\d+\s*$/.test(val) && Number(val) !== 1) lengths++; // unitless line height
    if (lengths) add(kindOf(prop) === 'motion' ? 'other' : kindOf(prop), lengths);
  }
  return out;
}

// Counts for one JS file: hex colours in code, and raw lengths / colours inside style="..." attributes.
export function scanJs(text) {
  const out = {};
  const add = (k, n = 1) => { if (n) out[k] = (out[k] || 0) + n; };
  const src = text.replace(/^\s*\/\/.*$/gm, '');
  add('js-colour', (src.match(/['"`]#[0-9a-fA-F]{6}\b|['"`]#(?:fff|000)\b/g) || []).length);
  for (const m of src.matchAll(/style="([^"]*)"/g)) {
    const val = stripVars(m[1].replace(/\$\{[^}]*\}/g, ''));
    add('js-style', (val.match(COLOUR) || []).length);
    for (const l of val.matchAll(LENGTH)) if (!(l[2] === 'px' && ALLOWED_PX.has(String(Number(l[1]))))) add('js-style');
  }
  return out;
}

function walk(dir, ext) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'vendor') out.push(...walk(p, ext)); } else if (f.endsWith(ext)) out.push(p);
  }
  return out;
}

// { "web/app.css": { type: 40, ... }, ... } for every file with at least one raw value.
export function scanRepo(root = ROOT) {
  const res = {};
  const css = readdirSync(join(root, 'web')).filter((f) => f.endsWith('.css') && f !== 'tokens.css').map((f) => join(root, 'web', f));
  for (const f of css) { const c = scanCss(readFileSync(f, 'utf8')); if (Object.keys(c).length) res[relative(root, f)] = c; }
  for (const f of walk(join(root, 'web/js'), '.js')) { const c = scanJs(readFileSync(f, 'utf8')); if (Object.keys(c).length) res[relative(root, f)] = c; }
  return Object.fromEntries(Object.entries(res).sort(([a], [b]) => a.localeCompare(b)));
}

export const total = (r) => Object.values(r).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0);

// Rises against the baseline: [{ file, kind, now, base }]. A file not in the baseline counts from 0.
export function rises(now, base) {
  const out = [];
  for (const [file, kinds] of Object.entries(now)) {
    for (const [kind, n] of Object.entries(kinds)) {
      const b = (base[file] && base[file][kind]) || 0;
      if (n > b) out.push({ file, kind, now: n, base: b });
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const now = scanRepo();
  if (process.argv.includes('--write-baseline')) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 1) + '\n');
    console.log(`baseline written: ${total(now)} raw values in ${Object.keys(now).length} files`);
  } else {
    for (const [f, k] of Object.entries(now)) console.log(f.padEnd(28), JSON.stringify(k));
    console.log('total', total(now));
  }
}
