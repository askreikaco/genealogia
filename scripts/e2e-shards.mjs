#!/usr/bin/env node
// Split e2e files into N shard groups for the CI matrix. Stdout: a JSON array of N strings, each a space-separated
// list of files (paths as given). book-entries (the PDF test, the slowest) always gets a shard of its own.
// The rest are packed greedily, largest first, into the least-loaded shard. Weight = file size in bytes (a proxy for
// duration; measured timings are not kept). Paths are repo-root paths (test/e2e/x.test.js), read from the cwd.
// Usage: node scripts/e2e-shards.mjs <n> <file...>
import { statSync } from 'node:fs';
import { basename } from 'node:path';

const [nArg, ...files] = process.argv.slice(2);
const n = Number(nArg);
if (!Number.isInteger(n) || n < 1) { console.error('usage: e2e-shards.mjs <n> <files...>'); process.exit(2); }
const ALONE = new Set(['book-entries.test.js']);
const groups = Array.from({ length: n }, () => ({ files: [], load: 0 }));

const alone = files.filter((f) => ALONE.has(basename(f)));
const rest = files.filter((f) => !ALONE.has(basename(f)))
  .map((f) => ({ f, w: statSync(f, { throwIfNoEntry: false })?.size ?? 0 }))
  .sort((a, b) => b.w - a.w || a.f.localeCompare(b.f));

if (alone.length && n > 1) { groups[0].files.push(...alone); groups[0].load = Infinity; }
else rest.unshift(...alone.map((f) => ({ f, w: 0 })));
for (const { f, w } of rest) {
  const g = groups.reduce((best, cur) => (cur.load < best.load ? cur : best));
  g.files.push(f); g.load += w;
}
console.log(JSON.stringify(groups.map((g) => g.files.join(' '))));
