// E2E: the app update notice (new build while open; auto-apply when idle; never while a form is dirty), the Thêm page
// structure (every row inside a group card, account block last), and the top-bar title centred on the viewport.
// Mocked /api (no database). Needs playwright and Chrome:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/update-more.test.js
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
// The build in use (BUILD in js/update.js: the gp-dev placeholder on master) and a release newer than it.
const UPD_SRC = fs.readFileSync(path.join(WEB, 'js', 'update.js'), 'utf8');
const CUR = /BUILD = '([^']+)'/.exec(UPD_SRC)[1];
const NEXT = 'gp-9.9.9';
const SHOTS = process.env.GP_SHOT_DIR || '';
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', han: '楊', visibility: 'public', place: 'Củ Chi', people: 3, generations: 3 };
const PERSON = (id, name, gen) => ({ id, deleted: false, v: 1, data: { name, sex: 'm', gen, thu: '1', order: 0 } });
const PERSONS = [PERSON('PA', 'Dương Văn Cha', 6), PERSON('K1', 'Dương Văn Một', 7)];

// Serves web/. st.bump: sw.js and js/update.js answer as the next build (NEXT), as after a deploy.
let srv; let base; const st = { bump: false, serverV: CUR, role: 'member' };
test.before(async () => {
  if (skip) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const pn = u.pathname === '/' ? '/index.html' : u.pathname;
    if (pn.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    const f = path.join(WEB, pn);
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(f);
    if (st.bump && (pn === '/sw.js' || pn === '/js/update.js')) body = Buffer.from(body.toString('utf8').split(CUR).join(NEXT));
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv?.close(); });

async function open(browser, { width = 390, hash = '/duong/more', role = st.role, scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/version') return json({ v: st.serverV, sha: null });
    if (p === '/api/me') return json(role === 'guest' ? { editor: null, role, status: null, person_id: null, email: null, name: null, google: false, roles: {} }
      : { editor: null, role, status: 'active', person_id: null, email: 'an@example.test', name: 'Nguyễn An', google: false, roles: { duong: 'owner' } });
    if (p === '/api/families/duong') return json({ ...FAM, my_role: role === 'guest' ? null : 'owner' });
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: PERSONS, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + '/#' + hash);
  await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}
// A new build is live: the page is told by its next version check (the app asks at most once a day, so the test
// clears that day first, as if a day had passed, then the page comes back to the foreground).
async function announceNewBuild(page) {
  st.serverV = NEXT; st.bump = true;
  await page.evaluate(() => { try { localStorage.removeItem('gp-upd-checked'); } catch {} document.dispatchEvent(new Event('visibilitychange')); });
}
async function reset() { st.serverV = CUR; st.bump = false; st.role = 'member'; }

// ---------- update notice ----------
test('update: a new build while the app is open shows "Có bản mới · Tải lại", not over the toolbar', { skip }, async () => {
  await reset();
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await open(b, { hash: '/duong/tree', role: 'guest' });
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 8000 });
    await page.evaluate(() => { window.__m = 'same-page'; });
    // a dialog open: the app is not idle, so the notice shows and nothing reloads
    await page.click('#swbtn');
    await announceNewBuild(page);
    await page.waitForSelector('#updnote', { timeout: 15000 });
    assert.match(await page.textContent('#updnote'), /Có bản mới ·\s*Tải lại/);
    assert.strictEqual(await page.evaluate(() => window.__m), 'same-page', 'the page is not reloaded by itself');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // the notice never covers the toolbar buttons or the bottom nav
    const covered = await page.evaluate(() => {
      const pts = [...document.querySelectorAll('.cbar button, .cbar a, .tabs a, .tabs button')].map((el) => {
        const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];
      });
      return pts.filter(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit && hit.closest('#updnote'); }).length;
    });
    assert.strictEqual(covered, 0, 'no toolbar or nav control is under the notice');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'update-notice-390.png') });
    assert.deepStrictEqual(errors, []);
    await page.click('#updreload');
    await page.waitForFunction(() => window.__m === undefined, null, { timeout: 15000 });
    await page.waitForSelector('.cbar'); 
    await ctx.close();
  } finally { await b.close(); await reset(); }
});

test('update: an idle app applies a new build by itself when it comes back to the foreground', { skip }, async () => {
  await reset();
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await open(b, { hash: '/duong/more', role: 'guest' });
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 8000 });
    await page.evaluate(() => { window.__m = 'before'; });
    await announceNewBuild(page);
    await page.waitForFunction(() => window.__m === undefined, null, { timeout: 15000 });
    await page.waitForSelector('#chkupd');
    assert.ok((await page.textContent('#chkupd')).includes('Phiên bản ' + NEXT.slice(3)), 'the reloaded page runs the new build');
    assert.strictEqual(await page.locator('#updnote').count(), 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); await reset(); }
});

test('update: a dialog open keeps the page; once closed, the next navigation applies the waiting build', { skip }, async () => {
  await reset();
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await open(b, { hash: '/duong/tree', role: 'guest' });
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 8000 });
    await page.click('#swbtn');
    await announceNewBuild(page);
    await page.waitForSelector('#updnote', { timeout: 15000 });
    await page.evaluate(() => { window.__m = 'before-nav'; });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert.strictEqual(await page.evaluate(() => window.__m), 'before-nav', 'still not reloaded after the dialog closed');
    await page.evaluate(() => { location.hash = '#/duong/more'; });
    await page.waitForFunction(() => window.__m === undefined, null, { timeout: 15000 });
    await page.waitForSelector('#chkupd');
    assert.ok((await page.textContent('#chkupd')).includes('Phiên bản ' + NEXT.slice(3)), 'the page after navigation runs the new build');
    assert.strictEqual(await page.locator('#updnote').count(), 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); await reset(); }
});

test('update: a form with unsaved changes keeps the page; the notice waits', { skip }, async () => {
  await reset();
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx } = await open(b, { hash: '/duong/them', role: 'guest' });
    await page.waitForSelector('#main input');
    await page.locator('#main input').first().fill('Đang nhập dở');
    await page.evaluate(() => { window.__m = 'typing'; });
    await announceNewBuild(page);
    await page.waitForSelector('#updnote', { timeout: 15000 });
    assert.strictEqual(await page.evaluate(() => window.__m), 'typing', 'not reloaded while typing');
    assert.strictEqual(await page.locator('#main input').first().inputValue(), 'Đang nhập dở');
    await ctx.close();
  } finally { await b.close(); await reset(); }
});

// ---------- Thêm (More) ----------
test('Thêm: every row sits in a group card; the account block is last; the version row checks now', { skip }, async () => {
  await reset();
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    for (const role of ['guest', 'member']) {
      const { page, ctx, errors } = await open(b, { hash: '/duong/more', role });
      const rows = await page.locator('#main .calm').count();
      const inGroup = await page.locator('#main .mg-g .calm').count();
      assert.ok(rows > 3, `${role}: rows on the page: ${rows}`);
      assert.strictEqual(inGroup, rows, `${role}: every row is inside a group card`);
      const heads = await page.$$eval('#main .mg-h', (els) => els.map((e) => e.textContent.trim()));
      assert.ok(heads.includes('Ứng dụng') && heads.includes('Xem'), `${role}: headings ${heads.join(', ')}`);
      // wait for both blocks to be laid out: boundingBox() returns null while an element is not rendered yet (CI flake)
      const appLoc = page.locator('#main section.mg', { has: page.locator('.mg-h', { hasText: 'Ứng dụng' }) }).locator('.mg-g');
      const acctLoc = page.locator('#main .mg-who');
      await appLoc.waitFor({ state: 'visible' }); await acctLoc.waitFor({ state: 'visible' });
      const appGroup = await appLoc.boundingBox();
      const acct = await acctLoc.boundingBox();
      assert.ok(acct.y > appGroup.y + appGroup.height, `${role}: the account block comes after the Ứng dụng group`);
      assert.match(await page.textContent('#chkupd'), /Phiên bản dev.*Kiểm tra cập nhật/);
      await page.click('#chkupd');
      await page.waitForSelector('.toast:not([hidden])', { timeout: 5000 });
      assert.match(await page.textContent('.toast'), /Đã là bản mới nhất/);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `more-${role}-390.png`), fullPage: true });
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally { await b.close(); await reset(); }
});

// ---------- top bar title ----------
test('top bar: the page title is centred on the viewport (±2px) on #more, #tree and a person page, at 390 and 1280', { skip }, async () => {
  await reset();
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    for (const width of [390, 1280]) for (const hash of ['/duong/more', '/duong/tree', '/duong/person/PA']) {
      const { page, ctx } = await open(b, { width, hash, role: 'member' });
      const c = await page.evaluate(() => {
        const t = document.getElementById('cbtitle'); const r = t.getBoundingClientRect();
        return { text: t.textContent.trim(), centre: r.left + r.width / 2, width: window.innerWidth };
      });
      assert.ok(c.text.length > 0, `${width} ${hash}: a title is shown`);
      assert.ok(Math.abs(c.centre - c.width / 2) <= 2, `${width} ${hash}: title "${c.text}" centre ${c.centre} vs ${c.width / 2}`);
      await ctx.close();
    }
  } finally { await b.close(); }
});
