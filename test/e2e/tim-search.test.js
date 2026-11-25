// E2E: Tìm page search. The top bar has a search button (Tìm kiếm) that opens Tìm focused.
// "/" and Ctrl+K open Tìm with its field focused; a lunar giỗ date ("3/8", "3-8", "mồng 3 tháng 8") lists the
// people whose giỗ is that day (line 2 "Giỗ 3/8 ÂL"); (recent searches were removed 2026-11-24) and a
// "Xoá tất cả" link. Mocked /api responses, no database needed:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] node --test test/e2e/tim-search.test.js
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

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PERSONS = [
  P('PR', { name: 'Dương Văn Tổ', sex: 'f', gen: 1, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', order: 1, born: '1925' }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 2, born: '1950' }),
  P('K2', { name: 'Dương Thị Hai', sex: 'f', gen: 7, thu: '2', parent: 'PA', order: 3, born: '1953', gio_lunar: '3/8' }),
  P('K7', { name: 'Dương Thị Bảy', sex: 'f', gen: 8, thu: '2', order: 8, born: '1983' }),
  P('K9', { name: 'Dương Hoàng Chín', sex: 'm', gen: 9, thu: '1', order: 10, born: '2010', death_lunar: '3/8' }),
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };

let base; let srv;
test.before(async () => {
  if (skip) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const pn = u.pathname === '/' ? '/index.html' : u.pathname === '/book' ? '/book.html' : u.pathname; const f = path.join(WEB, pn);
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv?.close(); });

async function open(browser, { phone, hash = '/#/duong/tree' }) {
  const ctx = await browser.newContext({
    serviceWorkers: 'block', colorScheme: 'light',
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    hasTouch: phone, isMobile: phone,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.)/, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: PERSONS, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + hash);
  await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);
  return { page, ctx, errors };
}

test('top bar search button opens Tìm focused; "/" and Ctrl+K open Tìm with the field focused', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await open(browser, { phone: false });
    assert.equal(await page.locator('header button[aria-label="Tìm kiếm"]').count(), 1, 'top-bar search button');
    await page.click('#topsearch');
    await page.waitForFunction(() => location.hash === '#list', null, { timeout: 3000 });
    await page.waitForFunction(() => document.activeElement?.id === 'q', null, { timeout: 3000 });
    await page.evaluate(() => { location.hash = '#tree'; });
    await page.waitForFunction(() => location.hash === '#tree', null, { timeout: 3000 });
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await page.keyboard.press('/');
    await page.waitForFunction(() => location.hash === '#list', null, { timeout: 3000 });
    await page.waitForFunction(() => document.activeElement?.id === 'q', null, { timeout: 3000 });
    // a background render (the app's own sync on `online`) must not take the focus away from the field
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.keyboard.type('Dương');
    await page.waitForFunction(() => document.activeElement?.id === 'q' && document.activeElement.value === 'Dương', null, { timeout: 3000 });
    assert.equal(await page.locator('dialog[open]').count(), 0, 'no dialog opens');
    await page.goto(base + '/#/duong/tree');
    await page.waitForFunction(() => /tree/.test(location.hash) && document.querySelector('main')?.children.length > 0 && !/Đang tải/.test(document.querySelector('main').innerText), null, { timeout: 8000 });
    await page.locator('body').click({ position: { x: 5, y: 400 } });
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => /^#list(\/|$)/.test(location.hash) && document.activeElement?.id === 'q', null, { timeout: 3000 });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); }
});

test('Tìm: a giỗ date lists the people whose giỗ is that lunar day; line 2 shows "Giỗ 3/8 ÂL"', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx } = await open(browser, { phone: true, hash: '/#/duong/list' });
    for (const q of ['3/8', '3-8', 'mồng 3 tháng 8', 'Mong 3 thang 8']) {
      await page.locator('#q').fill(q);
      await page.waitForFunction((n) => document.querySelectorAll('.pi-card').length === n, 2, { timeout: 3000 });
      const names = await page.locator('.pi-card b').allInnerTexts();
      assert.deepEqual(names.map((n) => n.replace(/^(Ông|Bà) \S+ /, '')).sort(), ['Dương Hoàng Chín', 'Dương Thị Hai'], q);
      assert.deepEqual(await page.locator('.pi-card .sub').allInnerTexts(), ['Giỗ 3/8 ÂL', 'Giỗ 3/8 ÂL'], q + ': line 2');
    }
    await page.locator('#q').fill('3/9');
    await page.waitForFunction(() => document.querySelectorAll('.pi-card').length === 0, null, { timeout: 3000 });
    await ctx.close();
  } finally { await browser.close(); }
});


// A re-render while the person types (a sync, a navigation) must not drop the text typed so far: the field is rebuilt
// from the last committed value, so the typed text and the focus are carried over.
test('Tìm: a re-render between keystrokes keeps the typed text and the focus', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx } = await open(browser, { phone: false });
    await page.click('#topsearch');
    await page.waitForFunction(() => location.hash === '#list', null, { timeout: 3000 });
    await page.waitForFunction(() => document.activeElement?.id === 'q', null, { timeout: 3000 });
    for (const ch of 'Dương') {
      await page.keyboard.type(ch);
      await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange'))); // a same-route re-render
    }
    await page.waitForFunction(() => document.activeElement?.id === 'q' && document.getElementById('q').value === 'Dương', null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => document.getElementById('q').value), 'Dương', 'the typed text survives the re-renders');
    await ctx.close();
  } finally { await browser.close(); }
});
