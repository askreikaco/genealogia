// E2E: everyone is the default set. Six people: four bloodline (Chi C3 with two generations below it, one more Đời 3 person)
// and two people married in (their Đời and Chi come from their spouse). Counts on list, search and map must include them;
// Chi / Đời filters narrow the same set. Mocked /api, no database. Needs playwright and Chrome:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] node --test test/e2e/everyone.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !chromium ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;
const WEB = path.join(__dirname, '..', '..', 'web');

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PERSONS = [
  P('C3', { name: 'Dương Văn Chi', sex: 'm', gen: 3, thu: '1', order: 0, place: 'Củ Chi' }),
  P('C4', { name: 'Dương Thị Bốn', sex: 'f', gen: 4, thu: '1', parent: 'C3', order: 1, place: 'Củ Chi' }),
  P('C5', { name: 'Dương Văn Năm', sex: 'm', gen: 5, thu: '1', parent: 'C4', order: 2 }),
  P('R3', { name: 'Dương Văn Khác', sex: 'm', gen: 3, thu: '2', order: 3, place: 'Huế' }),
  P('S1', { name: 'Rể Vân', sex: 'm', spouse_of: 'C4', spouse_n: 1, place: 'Củ Chi' }),
  P('S2', { name: 'Dâu Lan', sex: 'f', spouse_of: 'R3', spouse_n: 1 }),
];
delete PERSONS[4].data.gen; delete PERSONS[5].data.gen; // married in: no Đời of their own
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', han: '楊', visibility: 'public', people: 6, generations: 5 };
const N = PERSONS.length; // 4 bloodline + 2 married in
const ROOT = pathToFileURL(path.join(WEB, 'js', 'geo.js')).href;

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

async function open(browser, hash) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|tiles\.openfreemap\.org)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role: 'member', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: 'member' } });
    if (p === '/api/families') return json({ items: [{ ...FAM, my_role: 'member' }] });
    if (p.startsWith('/api/families/')) return json({ ...FAM, my_role: 'member' });
    if (p === '/api/persons') { const since = Number(u.searchParams.get('since')); return since === 0 ? json({ items: PERSONS, next_since: N }) : json({ items: [], next_since: since }); }
    if (p.startsWith('/api/suggestions')) return json({ items: [], counts: { pending: 0 } });
    if (p === '/api/me/prefs') return json({ prefs: {} });
    return json({});
  });
  await page.goto(base + '/#' + hash);
  await page.waitForSelector('#main', { state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#sync')?.textContent.includes('Đã đồng bộ'));
  return { ctx, page, errors };
}
const launch = () => chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

test('list: default count line is everyone, N / N (married-in people included)', { skip }, async () => {
  const b = await launch();
  try {
    const { ctx, page, errors } = await open(b, '/duong/list');
    // the count line and cards render after the persons arrive: wait for the final values, not the element
    await page.waitForFunction((n) => (document.querySelector('.lcount')?.textContent || '').trim().startsWith(n), `${N} / ${N}`);
    await page.waitForFunction((n) => document.querySelectorAll('.cards .card').length === n, N);
    assert.equal((await page.textContent('.lcount')).trim().split(' người')[0], `${N} / ${N}`);
    assert.equal(await page.locator('.cards .card').count(), N);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('list: Chi filter keeps a married-in person in their spouse branch', { skip }, async () => {
  const b = await launch();
  try {
    const { ctx, page, errors } = await open(b, '/duong/list');
    await page.waitForSelector('.lcount');
    await page.click('[data-fp]');
    await page.selectOption('#fchi', 'C3');
    await page.waitForFunction(() => document.querySelector('.lcount')?.textContent.startsWith('4 / '));
    // Chi C3: Dương Văn Chi, Dương Thị Bốn, Dương Văn Năm and Rể Vân (spouse of Bốn)
    assert.match(await page.textContent('.lcount'), /^4 \/ 6 người/);
    assert.match(await page.textContent('.cards'), /Rể Vân/);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('list: Đời filter uses the spouse Đời (Rể Vân is Đời 4 with Bốn)', { skip }, async () => {
  const b = await launch();
  try {
    const { ctx, page, errors } = await open(b, '/duong/list');
    await page.waitForSelector('.lcount');
    await page.click('[data-fp]');
    await page.selectOption('#fgen', '4');
    await page.waitForFunction(() => document.querySelector('.lcount')?.textContent.startsWith('2 / '));
    assert.match(await page.textContent('.lcount'), /^2 \/ 6 người/);
    assert.match(await page.textContent('.cards'), /Rể Vân/);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('map: count line counts everyone, placed people match the places', { skip }, async () => {
  const { locate } = await import(ROOT);
  const placed = PERSONS.filter((p) => locate(p.data)).length;
  const b = await launch();
  try {
    const { ctx, page } = await open(b, '/duong/map');
    await page.waitForFunction((n) => document.querySelector('#mcount')?.textContent.startsWith(n + ' người khớp'), N); // first paint can be before the people are in
    assert.equal(await page.textContent('#mcount'), `${N} người khớp · ${placed} có nơi sống trên bản đồ`);
    await ctx.close();
  } finally { await b.close(); }
});

test('search: type-ahead finds a married-in person by name', { skip }, async () => {
  const b = await launch();
  try {
    const { ctx, page, errors } = await open(b, '/duong/list');
    await page.fill('#q', 'Rể Vân');
    await page.waitForFunction(() => document.querySelector('.lcount')?.textContent.startsWith('1 / '));
    assert.match(await page.textContent('.lcount'), /^1 \/ 6 người/);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});
