// E2E: giỗ reminders (N1). (1) Lịch shows "Giỗ sắp tới (7 ngày)" for the followed people with a giỗ in the next 7 days,
// and no block when nothing is followed. (2) Cài đặt has the opt-in toggle "Gửi email nhắc giỗ mỗi tuần", default off,
// saved with PUT /api/me/digest. Mocked API, no database, no mail:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/gio-digest.test.js
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
const SHOT_DIR = process.env.GP_SHOT_DIR || '';
const COPY = require('../../server/digest-vi');

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
// K2's giỗ falls 6 days from today (Vietnam time): its lunar date is set in before() from the lunar module.
let K2_LUNAR = '1/1';
const personsNow = () => [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 1, born: '1950' }),
  P('K2', { name: 'Dương Thị Hai', sex: 'f', gen: 7, thu: '2', parent: 'PA', order: 2, born: '1952', died: '2027', death_lunar: K2_LUNAR, living: 'dead' }),
];
const PC = (id, parent, child, order) => ({ id, parent_id: parent, child_id: child, kind: 'ruot', birth_order: order, private: false });
const REL0 = { source: 'table', parent_child: [PC(1, 'PR', 'PA', 1), PC(2, 'PA', 'K1', 1), PC(3, 'PA', 'K2', 2)], couple: [] };
const REL = REL0;
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };

let base; let srv;
test.before(async () => {
  if (skip) return;
  const L = await import(require('url').pathToFileURL(path.join(WEB, 'js', 'lunar.js')).href);
  const vn = new Date(Date.now() + 7 * 3600e3 + 6 * 864e5); // Vietnam day, six days from now
  const lu = L.solarToLunar(vn.getUTCDate(), vn.getUTCMonth() + 1, vn.getUTCFullYear());
  K2_LUNAR = `${lu.day}/${lu.month}`;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const pn = u.pathname === '/' ? '/index.html' : u.pathname; const f = path.join(WEB, pn);
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv?.close(); });

// Opens a page with the mocked API. follow: the ids in the device's ☆ list. digest: the account's saved toggle.
async function open(browser, hash, { follow = [], digest = { enabled: false }, colorScheme = 'light', width = 390, log = [] } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, colorScheme, timezoneId: 'Asia/Ho_Chi_Minh' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((f) => { try { localStorage.setItem('gp_follow', JSON.stringify(f)); } catch {} }, follow);
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname; const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: 'Tester', role: 'editor', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: 'editor' } });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') {
      const since = u.searchParams.get('since'); const ids = u.searchParams.get('ids'); const PERSONS = personsNow();
      if (ids) return json({ items: PERSONS.filter((x) => ids.split(',').includes(x.id)), rel: REL });
      return json(since === '0' || since === null ? { items: PERSONS, next_since: 1, rel: REL } : { items: [], next_since: Number(since), rel: REL });
    }
    if (p === '/api/me/digest') {
      if (req.method() === 'PUT') { log.push(JSON.parse(req.postData() || '{}')); return json({ ok: true, enabled: JSON.parse(req.postData() || '{}').enabled }); }
      return json({ enabled: digest.enabled, last_sent_at: null });
    }
    if (p === '/api/me/prefs') return json({ prefs: { follows: follow } });
    if (p === '/api/events') return json({ items: [], stories: [] });
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + '/#/duong/' + hash);
  await page.waitForTimeout(400);
  return { page, ctx, errors };
}
const shot = async (page, name) => { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true }); };

test('Lịch: the 7-day giỗ block shows the followed person, with the copy from digest-vi', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, errors } = await open(b, 'lich', { follow: ['K2'] });
    await page.waitForSelector('.soon-blk');
    assert.equal((await page.textContent('.soon-blk .soon-h')).trim(), COPY.block_title);
    assert.match(await page.textContent('.soon-blk'), /Dương Thị Hai/);
    assert.match(await page.textContent('.soon-blk'), /Còn 6 ngày/);
    await shot(page, 'gio-block-390-light.png');
    assert.deepStrictEqual(errors, []);
  } finally { await b.close(); }
});

test('Lịch: no block when nothing is followed (hidden, not an empty box)', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page } = await open(b, 'lich', { follow: [] });
    await page.waitForFunction(() => (document.querySelector('main') || document.body).textContent.includes('Cả họ'));
    assert.equal(await page.locator('.soon-blk').count(), 0);
  } finally { await b.close(); }
});

test('Cài đặt: the opt-in toggle is off by default and saves to the account', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const log = [];
    const { page, errors } = await open(b, 'settings', { log });
    await page.waitForSelector('#dgt');
    assert.equal(await page.isChecked('#dgt'), false, 'default OFF');
    assert.match(await page.textContent('body'), new RegExp(COPY.toggle_label));
    await page.check('#dgt');
    await page.waitForSelector('#dgs:has-text("' + COPY.toggle_saved + '")');
    assert.deepStrictEqual(log, [{ enabled: true }]);
    await shot(page, 'gio-settings-390-light.png');
    assert.deepStrictEqual(errors, []);
  } finally { await b.close(); }
});

test('Cài đặt, dark: the toggle reads in dark mode', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page } = await open(b, 'settings', { colorScheme: 'dark', digest: { enabled: true } });
    await page.waitForSelector('#dgt');
    assert.equal(await page.isChecked('#dgt'), true, 'saved ON is shown');
    await shot(page, 'gio-settings-390-dark.png');
    if (SHOT_DIR) await (await open(b, 'lich', { colorScheme: 'dark', follow: ['K2'] })).page.screenshot({ path: path.join(SHOT_DIR, 'gio-block-390-dark.png'), fullPage: true });
  } finally { await b.close(); }
});
