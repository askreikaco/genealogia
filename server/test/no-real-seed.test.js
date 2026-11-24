// CI guard: real family data is never tracked in git. Fails when a tracked file named persons*.json sits outside the
// fictional demo seed (server/seed/demo-*), when server/seed holds anything but demo files, when a tracked data file
// carries a marker of the real source, or when the demo seed is not marked fictional or is stale vs its generator.
// No database needed. Skipped outside a git checkout.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
let tracked = null;
try { git(['rev-parse', '--is-inside-work-tree']); tracked = git(['ls-files', '-z']).split('\0').filter(Boolean); } catch { tracked = null; }
const skip = tracked ? false : 'not a git checkout';

// Fingerprints of the real source (sheet and file titles). Data files only (json, csv, tsv, sql, txt).
const MARKERS = ['GIAPHAHODUONG', 'GIA PHẢ HỌ DƯƠNG', 'GIA PHẢ/SOURCES'];
const DATA_EXT = /\.(json|csv|tsv|sql|txt)$/i;
const DEMO = 'server/seed/demo-persons.json';

test('no tracked persons*.json outside the demo seed', { skip }, () => {
  const bad = tracked.filter((f) => /(^|\/)persons[^/]*\.json$/i.test(f) && !/^server\/seed\/demo-[^/]*$/.test(f));
  assert.deepStrictEqual(bad, [], 'real person data must not be tracked; keep it in the database and its backups');
});

test('server/seed holds only demo files', { skip }, () => {
  const bad = tracked.filter((f) => f.startsWith('server/seed/') && !/^server\/seed\/demo-[^/]*$/.test(f));
  assert.deepStrictEqual(bad, []);
});

test('no tracked data file carries a real-source marker', { skip }, () => {
  const hits = [];
  for (const f of tracked) {
    if (!DATA_EXT.test(f)) continue;
    let text; try { text = fs.readFileSync(path.join(REPO, f), 'utf8'); } catch { continue; }
    if (MARKERS.some((m) => text.includes(m))) hits.push(f);
  }
  assert.deepStrictEqual(hits, [], 'a tracked data file names the real source');
});

test('the demo seed is fictional: every row is marked as sample data', { skip }, () => {
  const rows = require(path.join(REPO, DEMO));
  assert.ok(rows.length >= 200, 'demo seed has the expected size');
  const unmarked = rows.filter((r) => !/demo|mẫu/i.test(String(r.data.source || '')));
  assert.strictEqual(unmarked.length, 0, 'every demo row carries a sample-data source');
});

test('the demo seed matches its generator', { skip }, () => {
  const out = execFileSync(process.execPath, [path.join(REPO, 'scripts', 'make-demo-seed.mjs'), '--check'], { encoding: 'utf8' });
  assert.match(out, /matches the generator/);
});
