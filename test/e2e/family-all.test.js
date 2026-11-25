// E2E: "Tất cả dòng họ" (all families in scope). Two families followed (duong, dong-a) and one private family the server
// refuses (kin). Mocked /api, so no database is needed. Needs playwright and Chrome:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] node --test test/e2e/family-all.test.js
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

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const FAMS = {
  duong: { id: 'duong', slug: 'duong', name: 'Họ Dương', han: '楊', visibility: 'public', place: 'Củ Chi', people: 3, generations: 3 },
  'dong-a': { id: 'dong-a', slug: 'dong-a', name: 'Họ Nguyễn', han: '阮', visibility: 'public', place: 'Huế', people: 2, generations: 2 },
  kin: { id: 'kin', slug: 'kin', name: 'Họ Trần', han: '陳', visibility: 'public', place: 'Đà Nẵng', people: 1, generations: 1 },
};
const PERSONS = {
  duong: [
    P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
    P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925', died: '1990', gio_lunar: '10/3' }),
    P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 2, born: '1950' }),
  ],
  'dong-a': [
    P('N1', { name: 'Nguyễn Văn Xa', sex: 'm', gen: 3, thu: '1', order: 0, born: '1900', died: '1960', gio_lunar: '5/8' }),
    P('N2', { name: 'Nguyễn Thị Hoa', sex: 'f', gen: 4, thu: '2', parent: 'N1', order: 1, born: '1930', place: 'Củ Chi', gio_lunar: '20/1' }),
  ],
};

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

// roles: the account's memberships. A private family it is not a member of answers 403 (kin is refused).
// Waits until the families are pulled (the sync indicator says so): every count below depends on it.
async function settled(page) { await page.waitForFunction(() => document.querySelector('#sync')?.textContent.includes('Đã đồng bộ')); }

// The switcher button is re-drawn whenever data arrives, so a click can land on a button that is already gone:
// open it again until the dialog is up.
async function openSwitcher(page) {
  for (let i = 0; i < 6; i++) {
    await page.click('#swbtn');
    if (await page.locator('dialog.csw .famr').first().isVisible().catch(() => false)) return;
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('dialog.csw .famr', { state: 'visible' });
}

async function open(browser, { roles, width, hash }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: width < 672 ? 844 : 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role: 'member', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles });
    if (p === '/api/families') return json({ items: Object.values(FAMS).map((f) => ({ ...f, my_role: roles[f.id] || null })) });
    if (p.startsWith('/api/families/')) { const f = FAMS[decodeURIComponent(p.split('/').pop())]; return f ? json({ ...f, my_role: roles[f.id] || null }) : json({ error: 'Không tìm thấy dòng họ.' }, 404); }
    if (p === '/api/persons') {
      const fam = u.searchParams.get('family'); const since = Number(u.searchParams.get('since'));
      if (fam === 'kin') return json({ error: 'Dòng họ này là riêng tư.' }, 403);
      if (since !== 0) return json({ items: [], next_since: since });
      const items = PERSONS[fam] || [];
      return json({ items, next_since: items.length ? items.length : 0 });
    }
    if (p.startsWith('/api/suggestions')) return json({ items: [], counts: { pending: 0 } });
    if (p === '/api/me/prefs') return json({ prefs: {} });
    return json({});
  });
  await page.goto(base + '/#' + hash);
  await page.waitForSelector('#main', { state: 'attached' });
  await settled(page);
  return { ctx, page, errors };
}
const BOTH = { duong: 'member', 'dong-a': 'member' };

test('switcher shows "Tất cả dòng họ (2)" first; kin (refused) is not counted', { skip }, async () => {
  const c = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { ctx, page, errors } = await open(c, { roles: BOTH, width: 390, hash: '/duong/tree' });
    await openSwitcher(page);
    const first = await page.textContent('dialog.csw .famr:first-child');
    assert.match(first, /Tất cả dòng họ \(2\)/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'switcher-390.png') });
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await c.close(); }
});

test('giỗ combines both families with a chip on every row, sorted by date', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { ctx, page, errors } = await open(b, { roles: BOTH, width: 390, hash: '/tat-ca/gio' });
    await page.waitForFunction(() => document.querySelectorAll('.gior').length === 3); // both families pulled
    // the giỗ list is redrawn on every store sync: wait for the sync to settle before counting (count() does not wait)
    await page.waitForFunction(() => document.querySelector('#sync')?.textContent.includes('Đã đồng bộ'), null, { timeout: 15000 });
    const rows = await page.locator('.gior').count();
    assert.equal(rows, 3); // Dương Văn Cha (10/3), Nguyễn Văn Xa (5/8), Nguyễn Thị Hoa (20/1)
    await page.locator('.gior .fchip-n').first().waitFor({ state: 'visible' });
    assert.equal(await page.locator('.gior .fchip-n').count(), rows);
    const names = await page.locator('.gior .fchip-n').allTextContents();
    assert.ok(names.includes('Dương') || names.some((x) => /Dương/.test(x)));
    assert.ok(names.some((x) => /Nguyễn/.test(x)));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'gio-390.png'), fullPage: false });
    if (SHOTS) { const d = await open(b, { roles: BOTH, width: 1280, hash: '/tat-ca/gio' }); await d.page.waitForFunction(() => document.querySelectorAll('.gior').length === 3); await d.page.screenshot({ path: path.join(SHOTS, 'gio-1280.png') }); await d.ctx.close(); }
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('phone: Dòng họ filter in the sheet, active tag removes it; person links keep their family', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { ctx, page, errors } = await open(b, { roles: BOTH, width: 390, hash: '/tat-ca/list' });
    await page.waitForFunction(() => document.querySelectorAll('.cards .pi-card').length === 5);
    const href = await page.getAttribute('.cards .pi-card a', 'href');
    assert.match(href, /^#\/(duong|dong-a)\/person\//);
    await page.click('[data-fp]');
    await page.selectOption('#ffamp', 'dong-a');
    await page.waitForSelector('.ltags .tagx');
    assert.match(await page.textContent('.ltags .tagx'), /Dòng họ: Nguyễn/);
    assert.equal(await page.locator('.cards .pi-card').count(), 2);
    if (SHOTS) {
      await page.click('[data-fp]'); await page.selectOption('#ffamp', 'dong-a');
      await page.click('[data-fp]'); await page.screenshot({ path: path.join(SHOTS, 'list-filter-sheet-390.png') });
      await page.keyboard.press('Escape');
    }
    await page.click('.ltags .tagx');
    await page.waitForFunction(() => document.querySelectorAll('.cards .pi-card').length === 5);
    assert.equal(await page.locator('.ltags .tagx').count(), 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('desktop: Dòng họ select is inline in the list toolbar and filters the table', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { ctx, page, errors } = await open(b, { roles: BOTH, width: 1280, hash: '/tat-ca/list' });
    await page.waitForSelector('#ffam');
    assert.ok(await page.isVisible('#ffam'));
    await page.selectOption('#ffam', 'duong');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 3);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('tree in "Tất cả" is the family list: "Dòng họ của bạn" rows open the tree', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { ctx, page, errors } = await open(b, { roles: BOTH, width: 390, hash: '/tat-ca/tree' });
    await page.waitForSelector('#flist .cay-h:has-text("Dòng họ của bạn")');
    // wait for the signed-in section (the list can paint once before the follows are known, with Nguyễn still under Khám phá)
    await page.waitForSelector('#flist .cay-h:has-text("Dòng họ của bạn") + .cay-list a.calm:has-text("Nguyễn")');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'tree-picker-390.png') });
    assert.equal(await page.locator('#flist .cay-h:has-text("Dòng họ của bạn") + .cay-list a.calm').count(), 2);
    await page.click('#flist .cay-list a.calm:has-text("Nguyễn")');
    await page.waitForURL(/#\/dong-a\/tree$/);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('"Tất cả" stats show the per-family breakdown; map legend colours each family (1280)', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const s = await open(b, { roles: BOTH, width: 390, hash: '/tat-ca/stats' });
    await s.page.waitForSelector('text=Theo dòng họ');
    await s.ctx.close();
    const m = await open(b, { roles: BOTH, width: 1280, hash: '/tat-ca/map' });
    await m.page.waitForSelector('.legend .fchip-n');
    assert.equal(await m.page.locator('.legend .fchip-n').count(), 3); // two families and "Nhiều dòng họ" (mixed clusters)
    if (SHOTS) await m.page.screenshot({ path: path.join(SHOTS, 'map-1280.png') });
    assert.deepStrictEqual(m.errors, []);
    await m.ctx.close();
  } finally { await b.close(); }
});

test('a family the server refuses drops out of "Tất cả" once it is followed', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { ctx, page, errors } = await open(b, { roles: BOTH, width: 390, hash: 'tim-dong-ho' });
    await page.waitForSelector('[data-fam-follow="kin"]');
    await page.click('[data-fam-follow="kin"]');
    await page.waitForTimeout(400); // the follow pulls the family; the server refuses it
    await page.evaluate(() => { location.hash = '#/tat-ca/list'; });
    await page.waitForFunction(() => document.querySelectorAll('.cards .pi-card').length === 5);
    await openSwitcher(page);
    assert.match(await page.textContent('dialog.csw .famr:first-child'), /Tất cả dòng họ \(2\)/);
    assert.equal(await page.locator('.cards .pi-card').count(), 5);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('add person in "Tất cả" opens the form with a Dòng họ field (no picker step)', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { ctx, page, errors } = await open(b, { roles: BOTH, width: 390, hash: '/tat-ca/list' });
    await page.waitForSelector('[data-add]');
    await page.click('[data-add]');
    await page.waitForURL(/#\/tat-ca\/them$/);
    // members of both families send suggestions (not direct edits): the form says so, the Dòng họ field comes first
    await page.waitForFunction(() => document.getElementById('cbtitle').textContent.trim() === 'Góp ý' && document.querySelector('#fpfam'));
    assert.equal(await page.textContent('#fpsave'), 'Gửi góp ý');
    assert.equal(await page.locator('.famrs a.famr').count(), 0);
    assert.equal(await page.locator('#fpfam option').count(), 2);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('single family: no chips, no Dòng họ filter, no "Tất cả" entry (unchanged)', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { ctx, page, errors } = await open(b, { roles: { duong: 'member' }, width: 390, hash: '/duong/list' });
    await page.waitForSelector('.cards .pi-card');
    assert.equal(await page.locator('.fchip').count(), 0);
    assert.equal(await page.locator('#ffamp').count(), 0);
    await openSwitcher(page);
    assert.equal(await page.locator('dialog.csw .famr:not(.add)').count(), 1);
    assert.doesNotMatch(await page.textContent('dialog.csw'), /Tất cả/);
    if (SHOTS) { await page.keyboard.press('Escape'); await page.screenshot({ path: path.join(SHOTS, 'single-list-390.png') }); }
    assert.deepStrictEqual(errors, []);
    await ctx.close();
    const d = await open(b, { roles: { duong: 'member' }, width: 1280, hash: '/duong/list' });
    await d.page.waitForSelector('tbody tr');
    assert.equal(await d.page.locator('#ffam').count(), 0);
    assert.equal(await d.page.locator('.fchip').count(), 0);
    await d.ctx.close();
  } finally { await b.close(); }
});
