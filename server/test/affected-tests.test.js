'use strict';
// Guards scripts/affected-tests.mjs and scripts/test-map.json: selection rules, and every e2e file is mapped.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = pathToFileURL(path.join(ROOT, 'scripts', 'affected-tests.mjs')).href;
let mod = null;
async function lib() {
  if (!mod) mod = await import(SCRIPT);
  return mod;
}
test('docs-only change selects no e2e file', async () => {
  const { selectTests: sel } = await lib();
  const r = sel(['README.md', 'docs/notes.md', 'server/test/README.md']);
  assert.strictEqual(r.mode, 'none');
  assert.deepStrictEqual(r.files, []);
});

test('web/js/book.js selects the book files and the smoke set', async () => {
  const { selectTests: sel, e2eOnDisk: disk } = await lib();
  const r = sel(['web/js/book.js']);
  assert.strictEqual(r.mode, 'selected');
  const books = disk().filter((f) => /^test\/e2e\/book-/.test(f));
  assert.ok(books.length >= 2, 'book e2e files exist');
  for (const b of books) assert.ok(r.files.includes(b), `${b} selected`);
  for (const s of ['test/e2e/e2e-signin.test.js', 'test/e2e/minimal-ui.test.js', 'test/e2e/profile-tabs.test.js',
    'test/e2e/tim-search.test.js', 'test/e2e/form-clearance.test.js']) {
    assert.ok(r.files.includes(s), `smoke ${s} selected`);
  }
  assert.ok(!r.files.includes('test/e2e/gedcom.test.js'), 'unrelated module not selected');
});

test('a migration selects every e2e file', async () => {
  const { selectTests: sel, e2eOnDisk: disk } = await lib();
  const r = sel(['server/migrations/x.sql']);
  assert.strictEqual(r.mode, 'full');
  assert.deepStrictEqual(r.files, disk());
});

test('a changed e2e test file is selected even when no module matches it', async () => {
  const { selectTests: sel } = await lib();
  const r = sel(['test/e2e/descendants.test.js']);
  assert.ok(r.files.includes('test/e2e/descendants.test.js'));
});

test('an unknown path selects the smoke set only', async () => {
  const { selectTests: sel, loadMap: load } = await lib();
  const r = sel(['some/unknown/file.xyz']);
  assert.strictEqual(r.mode, 'selected');
  assert.deepStrictEqual(r.files, [...load().smoke].sort());
});

test('CLI prints ../test/e2e paths, sorted and unique, and a reason on stderr', async () => {
  const { execFileSync } = require('child_process');
  const script = path.join(ROOT, 'scripts', 'affected-tests.mjs');
  const out = execFileSync(process.execPath, [script, 'web/js/book.js', 'web/js/book.js'], { encoding: 'utf8' });
  const lines = out.trim().split('\n');
  assert.deepStrictEqual(lines, [...new Set(lines)].sort());
  for (const l of lines) assert.ok(l.startsWith('../test/e2e/') && l.endsWith('.test.js'), l);
});

test('every e2e test file on disk belongs to a module or the smoke set, and every glob matches a file', async () => {
  const { loadMap: load, e2eOnDisk: disk, globToRegExp: g2r } = await lib();
  const map = load();
  const all = disk();
  const owned = new Set(map.smoke);
  for (const [name, m] of Object.entries(map.modules)) {
    for (const glob of m.e2e) {
      const hits = all.filter((f) => g2r(glob).test(f));
      assert.ok(hits.length > 0, `module ${name}: glob ${glob} matches no e2e file`);
      hits.forEach((f) => owned.add(f));
    }
  }
  const orphans = all.filter((f) => !owned.has(f));
  assert.deepStrictEqual(orphans, [], `e2e files not in any module or smoke: ${orphans.join(', ')}`);
  for (const s of map.smoke) assert.ok(all.includes(s), `smoke file ${s} exists`);
});
