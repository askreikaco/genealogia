'use strict';
// REIKA DS vendor (web/vendor/reika-ds, sync: scripts/sync-ds.mjs): the vendored files match the pinned version and
// checksums, a changed file is caught, tokens.css imports the vendored set, and sw.js precaches every runtime file.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const VENDOR = path.join(ROOT, 'web', 'vendor', 'reika-ds');
const lib = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'sync-ds.mjs')).href);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('vendored REIKA DS matches the pinned version and every checksum', async () => {
  const { verifyVendor } = await lib();
  assert.deepStrictEqual(verifyVendor(VENDOR), [], 'run node scripts/sync-ds.mjs to re-vendor');
});

test('a changed or extra vendored file fails the check', async () => {
  const { verifyVendor, PIN } = await lib();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-vendor-test-'));
  try {
    fs.cpSync(VENDOR, tmp, { recursive: true });
    fs.appendFileSync(path.join(tmp, 'tokens.css'), '\n/* edited */\n');
    fs.writeFileSync(path.join(tmp, 'extra.js'), 'x');
    const problems = verifyVendor(tmp, PIN);
    assert.ok(problems.some((p) => p === 'checksum mismatch: tokens.css'), problems.join('\n'));
    assert.ok(problems.some((p) => p === 'not in SHA256SUMS: extra.js'), problems.join('\n'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the pin names one version and three tarballs with sha256 values', async () => {
  const { PIN } = await lib();
  assert.match(PIN.version, /^\d+\.\d+\.\d+$/);
  const names = Object.keys(PIN.tarballs);
  assert.strictEqual(names.length, 3);
  for (const n of names) assert.match(PIN.tarballs[n], /^[0-9a-f]{64}$/, n);
  assert.strictEqual(fs.readFileSync(path.join(VENDOR, 'VERSION'), 'utf8').trim(), PIN.version);
});

test('tokens.css imports the vendored tokens and faces, and no longer hand-copies --rk-* values', () => {
  const css = read('web/tokens.css');
  assert.match(css, /@import url\("vendor\/reika-ds\/tokens\.css"\);/);
  assert.match(css, /@import url\("vendor\/reika-ds\/fonts\/fonts\.css"\);/);
  assert.doesNotMatch(css, /--rk-[a-z0-9-]+\s*:/, 'the --rk-* block is defined by the vendored tokens.css only');
});

test('no page loads IBM Plex from Google Fonts (only Noto Serif in book.html)', () => {
  for (const f of ['web/index.html', 'web/oauth-consent.html', 'web/book.html']) {
    const html = read(f);
    assert.doesNotMatch(html, /family=IBM\+Plex/, f);
  }
  assert.match(read('web/book.html'), /family=Noto\+Serif/);
});

test('sw.js precaches every runtime vendor file', () => {
  const sw = read('web/sw.js');
  const shell = new Set([...sw.matchAll(/'(\/vendor\/reika-ds\/[^']+)'/g)].map((m) => m[1]));
  const runtime = ['tokens.css', 'web.css', 'fonts/fonts.css', 'js/index.js', 'js/html.js', 'js/components.js', 'js/menu-controller.js',
    'fonts/IBMPlexSans-Regular.woff2', 'fonts/IBMPlexSans-Medium.woff2', 'fonts/IBMPlexSans-SemiBold.woff2', 'fonts/IBMPlexMono-Regular.woff2'];
  for (const f of runtime) assert.ok(shell.has('/vendor/reika-ds/' + f), `missing from sw.js SHELL: ${f}`);
});
