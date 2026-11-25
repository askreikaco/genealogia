// e2e: the Nhận quản lý cây entry in the Thêm page (Dòng họ group) and the side nav (Dữ liệu group), signed-in only.
// Mocked /api (no database). Needs playwright and Chrome:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/nav-claim.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !chromium ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;
const WEB = path.join(__dirname, '..', '..', 'web');
const SHOTS = process.env.GP_SHOT_DIR || '';
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', han: '楊', visibility: 'public', place: 'Củ Chi', people: 1, generations: 1 };

let srv; let base;
test.before(async () => {
  if (skip) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const pn = u.pathname === '/' ? '/index.html' : u.pathname;
    if (pn.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    const f = path.join(WEB, pn);
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv?.close(); });

async function open(browser, { width = 390, role = 'member', signedIn = true, hash = '/duong/more' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/version') return json({ v: 'gp-dev', sha: null });
    if (p === '/api/me') return json(signedIn
      ? { editor: null, role, status: 'active', person_id: null, email: 'an@example.test', name: 'Nguyễn An', google: false, roles: { duong: role } }
      : { editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
    if (p === '/api/families/duong') return json({ ...FAM, my_role: signedIn ? role : null });
    if (p === '/api/app/claims') return json({ claims: [], links: [] });
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: [], next_since: 1 } : { items: [], next_since: Number(since) }); }
    return json({});
  });
  await page.goto(base + '/#' + hash);
  await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}

test('Thêm: the Nhận quản lý cây row is in the Dòng họ group for a signed-in user and opens the claim page', { skip }, async (t) => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { page, ctx, errors } = await open(browser, { hash: '/duong/more' });
  t.after(() => ctx.close());
  const row = page.locator('a[href="#nhan-quan-ly"]');
  assert.strictEqual(await row.count(), 1, 'one entry on Thêm');
  const group = await row.evaluate((a) => a.closest('section.mg')?.querySelector('.mg-h')?.textContent);
  assert.strictEqual(group, 'Dòng họ', 'in the Dòng họ group');
  await row.scrollIntoViewIfNeeded();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'nav-claim.png') });
  await row.click();
  await page.waitForFunction(() => /Đơn đang góp ý/.test(document.querySelector('#main')?.innerText || ''), null, { timeout: 8000 });
  assert.match(page.url(), /#nhan-quan-ly$/, 'opens the claim page');
  assert.deepStrictEqual(errors, [], 'no page errors');
});

test('signed out: no Nhận quản lý cây row on Thêm', { skip }, async (t) => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { page, ctx } = await open(browser, { signedIn: false, hash: '/duong/more' });
  t.after(() => ctx.close());
  assert.strictEqual(await page.locator('a[href="#nhan-quan-ly"]').count(), 0);
});

test('side nav (wide): the entry sits in the second group for signed-in users', { skip }, async (t) => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const { page, ctx } = await open(browser, { width: 1024, hash: '/duong/tree' });
  t.after(() => ctx.close());
  const link = page.locator('#nav a.sn-link[href="#nhan-quan-ly"]');
  assert.strictEqual(await link.count(), 1, 'side nav entry');
});
