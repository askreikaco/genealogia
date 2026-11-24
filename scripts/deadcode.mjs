#!/usr/bin/env node
// Grep-based dead-code scan for giapha/ (warning level: prints findings, exits 0 unless --strict).
//   node giapha/scripts/deadcode.mjs [--strict]
// Checks: CSS classes never named in web/ or test/ (maplibre-* classes are added by the library and skipped); exported functions/consts never used outside their definition
// (web/js and server/*.js); top-level local functions/consts never used; web/ files nothing links to; server dependencies never required; env keys in
// README.md that the code never reads.
// It is a text scan, so it can miss dynamic names (a class built as 'x' + y is seen only if 'x' appears literally).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const SKIP = new Set(['node_modules', '.git', 'logs']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p);
const read = (p) => readFileSync(p, 'utf8');
const files = walk(ROOT);
const text = (f) => read(f);
const WEB = files.filter((f) => rel(f).startsWith('web/') && /\.(js|html|css|webmanifest)$/.test(f));
const SERVER_JS = files.filter((f) => /^server\/[^/]+\.js$/.test(rel(f)));
const CODE = files.filter((f) => /\.(js|mjs|html|css)$/.test(f) && !rel(f).startsWith('server/node_modules'));
const findings = [];
const report = (kind, where, what) => findings.push(`${kind}\t${where}\t${what}`);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const countWord = (corpus, word) => (corpus.match(new RegExp(`(?<![\\w-])${escRe(word)}(?![\\w-])`, 'g')) || []).length;

// 1. CSS classes never used by any page, script or test
const cssFiles = WEB.filter((f) => f.endsWith('.css'));
const usageCorpus = CODE.filter((f) => !f.endsWith('.css')).map(text).join('\n') + files.filter((f) => /test\/.*\.js$/.test(rel(f))).map(text).join('\n');
for (const f of cssFiles) {
  const css = text(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"]*"|'[^']*'/g, '');
  const classes = new Set([...css.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((m) => m[1]).filter((c) => !/^\d/.test(c)));
  for (const c of classes) if (!/^maplibre/.test(c) && countWord(usageCorpus, c) === 0) report('css-class', rel(f), c);
}

// 2. exported functions / consts (web/js and server) with no use outside their definition
const exportNames = [];
for (const f of [...WEB.filter((x) => x.endsWith('.js')), ...SERVER_JS]) {
  const src = text(f);
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) exportNames.push([f, m[1]]);
  const cjs = /module\.exports\s*=\s*\{([\s\S]*?)\}/.exec(src);
  if (cjs) for (const part of cjs[1].split(',')) { const n = part.trim().split(':')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) exportNames.push([f, n]); }
}
const allJs = files.filter((f) => /\.(js|mjs|html)$/.test(f) && !rel(f).includes('node_modules')).map(text).join('\n');
for (const [f, name] of exportNames) {
  if (countWord(allJs, name) <= 1) report('unused-export', rel(f), name);
}
// top-level functions and consts that are neither exported nor used in their own file
for (const f of [...WEB.filter((x) => x.endsWith('.js')), ...SERVER_JS]) {
  const src = text(f);
  if (f.endsWith('.js') && rel(f).startsWith('web/')) {
    for (const m of src.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (countWord(src, m[1]) <= 1 && countWord(allJs, m[1]) <= 1) report('unused-local', rel(f), m[1]);
    }
  }
}

// 3. web files nothing references (by path or by basename)
const entries = new Set(['web/index.html', 'web/book.html', 'web/sw.js']);
const htmlAndJs = WEB.filter((f) => !f.endsWith('.css')).map(text).join('\n') + '\n' + cssFiles.map(text).join('\n') + '\n' + text(join(ROOT, 'web/sw.js'));
for (const f of WEB) {
  const r = rel(f);
  if (entries.has(r)) continue;
  const path = '/' + relative(join(ROOT, 'web'), f);
  if (!htmlAndJs.includes(path) && !htmlAndJs.includes(relative(join(ROOT, 'web'), f)) && !allJs.includes(basename(f))) report('unreferenced-file', r, '');
}

// 4. server dependencies never required
const pkg = JSON.parse(read(join(ROOT, 'server/package.json')));
const serverSrc = files.filter((f) => rel(f).startsWith('server/') && !rel(f).startsWith('server/node_modules') && /\.js$/.test(f)).map(text).join('\n');
for (const dep of Object.keys(pkg.dependencies || {})) {
  if (!new RegExp(`(require\\(|from\\s+)['"]${escRe(dep)}['"]`).test(serverSrc)) report('unused-dep', 'server/package.json', dep);
}

// 5. env keys the README documents that no code reads
const readme = text(join(ROOT, 'README.md'));
const envInCode = new Set([...files.filter((f) => /\.(js|sh|yml)$/.test(f)).map(text).join('\n').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)|\$\{\{\s*secrets\.([A-Z0-9_]+)|\b([A-Z][A-Z0-9_]{3,})=/g)].map((m) => m[1] || m[2] || m[3]));
const envInDocs = new Set([...readme.matchAll(/\b([A-Z][A-Z0-9]{2,}(?:_[A-Z0-9]+)+)\b/g)].map((m) => m[1]));
for (const k of envInDocs) if (!envInCode.has(k)) report('doc-env-unused', 'README.md', k);

for (const line of findings) console.log(line);
const byKind = {};
for (const l of findings) { const k = l.split('\t')[0]; byKind[k] = (byKind[k] || 0) + 1; }
console.log(`deadcode: ${findings.length} finding(s)${Object.keys(byKind).length ? ' ' + JSON.stringify(byKind) : ''}`);
if (STRICT && findings.length) process.exit(1);
