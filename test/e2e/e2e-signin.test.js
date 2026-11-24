// E2E: a signed-in owner must leave the "Đang tải" (loading) state within 5 s, also when an older tab holds the
// IndexedDB at a lower version (the upgrade is then blocked). Needs a SCRATCH database and a Chrome/Chromium:
//   GP_TEST_DATABASE_URL=postgres://... [GP_E2E_CHROME=/usr/bin/google-chrome] NODE_PATH=<dir with playwright> npm run test:e2e (from giapha/server)
// Skipped when either is missing.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const TAG = 'TEST-E2E-' + crypto.randomBytes(3).toString('hex');
const OWNER = `owner-${TAG}@test.local`;
let base, pool, srv;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  await pool.query("insert into members (email, name, role, status) values ($1, 'Chủ họ e2e', 'owner', 'active')", [OWNER]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(async () => {
  if (skip) return;
  srv?.close();
  await pool?.query('delete from members where email = $1', [OWNER]).catch(() => {});
  await pool?.end().catch(() => {});
});

async function signedInContext(browser) {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
  assert.equal(r.status, 200);
  const [pair] = r.headers.get('set-cookie').split(';');
  const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
  const ctx = await browser.newContext();
  // no internet in CI: font requests fail fast instead of holding the page load
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  await ctx.addCookies([{ name, value, url: base }]);
  return ctx;
}

// Waits up to 5 s for the page to leave the loading state; returns the visible text of <main>.
async function waitPastLoading(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    const txt = await page.locator('main').innerText().catch(() => '');
    if (txt && !/Đang tải/.test(txt)) return txt;
    await page.waitForTimeout(150);
  }
  assert.fail('still on the loading state after 5 s: ' + (await page.locator('main').innerText().catch(() => '')).slice(0, 80));
}

test('signed-in owner reaches content', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await signedInContext(browser);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/');
    await waitPastLoading(page);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); }
});

test('signed-in owner reaches content while an older tab blocks the IndexedDB upgrade', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await signedInContext(browser);
    // The "old tab": the previous version's database (v1) held open, with no versionchange handler.
    const old = await ctx.newPage();
    await old.goto(base + '/api/me');
    await old.evaluate(() => new Promise((ok, bad) => {
      const r = indexedDB.open('giapha', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('persons', { keyPath: 'id' }); d.createObjectStore('outbox', { keyPath: 'op_id' }); d.createObjectStore('meta'); };
      r.onsuccess = () => { window.__oldDb = r.result; ok(); }; r.onerror = () => bad(r.error);
    }));
    const page = await ctx.newPage();
    await page.goto(base + '/');
    await waitPastLoading(page);
    await ctx.close();
  } finally { await browser.close(); }
});
