// E2E: #11 person codes. The profile shows the code (D-3.2.1) as a tag that copies on tap; Tìm finds a person by
// code and lists a generation under a path by prefix ("D-3.2" -> D-3.2.1, D-3.2.2, D-3.2.3, not D-2.2). Mocked /api:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/tim-search-codes.test.js
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

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
// stable short IDs (web/js/shortid.js): 6 characters + check (sum of position x value, mod 31)
const ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXY';
const sidOf = (b) => b + ALPH[[...b].reduce((w, c, i) => w + (i + 1) * ALPH.indexOf(c), 0) % 31];
const SID_A2 = sidOf('H4K7PQ'); const SID_B = sidOf('B2C3D4');
// invented family: thủy tổ R, two sons (A Thứ 2, B Thứ 1), A's children (a son, a daughter, one of unknown sex)
const PERSONS = [
  P('R', { name: 'Dương Văn Tổ', sex: 'm', gen: 1, born: '1850', died: '1910' }),
  P('A', { name: 'Vương Văn Lyh', sex: 'm', gen: 2, parent: 'R', order: 2, born: '1880', died: '1950' }),
  P('B', { name: 'Dương Văn Bình', sex: 'm', gen: 2, parent: 'R', order: 1, born: '1878', died: '1940', sid: SID_B }),
  P('A1', { name: 'Giả Văn An', sex: 'm', gen: 3, parent: 'A', order: 1, born: '1905', died: '1970' }),
  P('A2', { name: 'Vương Thị Lan', sex: 'f', gen: 3, parent: 'A', order: 2, born: '1908', died: '1990', sid: SID_A2 }),
  P('A3', { name: 'Dương Chưa Rõ', gen: 3, parent: 'A', order: 3, born: '1910', died: '1960' }),
  P('W', { name: 'Lê Thị Vợ', sex: 'f', gen: 1, spouse_of: 'R', spouse_n: 1, died: '1915' }),
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };

let base; let srv; let browser;
test.before(async () => {
  if (skip) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const pn = u.pathname === '/' ? '/index.html' : u.pathname; const f = path.join(WEB, pn);
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME });
});
test.after(async () => { await browser?.close(); srv?.close(); });

async function open(hash, { scheme = 'light', width = 390 } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: PERSONS, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(`${base}/#/duong/${hash}`);
  await page.waitForSelector('#q, .prof, #tr', { state: 'attached', timeout: 8000 });
  await page.waitForTimeout(400);
  return { page, ctx, errors };
}

test('profile: the stable ID is the tag (copy on tap); the tree position sits in Thông tin', { skip }, async () => {
  const fmt = SID_A2.slice(0, 4) + '-' + SID_A2.slice(4);
  const { page, ctx, errors } = await open('person/A2');
  try {
    await page.waitForSelector('.prof', { timeout: 8000 });
    const tag = page.locator('.prof .pcode');
    assert.equal((await tag.innerText()).trim(), fmt);
    assert.match(await tag.getAttribute('title'), /Mã người cố định/);
    await tag.click();
    await page.waitForFunction((f) => document.body.innerText.includes(f), fmt, { timeout: 3000 });
    assert.match(await page.locator('#main').innerText(), /Vị trí trong cây\s*D-3\.2\.2/, 'tree position in Thông tin');
    if (SHOT_DIR) await page.locator('.prof').screenshot({ path: path.join(SHOT_DIR, 'ids-profile-390-light.png') });
    const w = await open('person/W'); // no ID in this data: no tag
    try { await w.page.waitForSelector('.prof'); assert.equal(await w.page.locator('.prof .pcode').count(), 0); } finally { await w.ctx.close(); }
    assert.deepStrictEqual(errors, []);
  } finally { await ctx.close(); }
});

test('Tìm: the stable ID, with or without the dash, any case', { skip }, async () => {
  for (const [scheme, q] of [['light', SID_A2.slice(0, 4) + '-' + SID_A2.slice(4)], ['dark', SID_A2.toLowerCase()]]) {
    const { page, ctx, errors } = await open('list/' + encodeURIComponent(q), { scheme });
    try {
      await page.waitForSelector('.cards', { timeout: 8000 });
      const names = (await page.locator('.cards .card b').allInnerTexts()).map((t) => t.trim());
      assert.equal(names.length, 1, names.join(' | ')); assert.ok(names[0].includes('Vương Thị Lan'));
      assert.match(await page.locator('.cards .card').first().innerText(), new RegExp(SID_A2.slice(0, 4) + '-' + SID_A2.slice(4) + ' ·'));
      if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `ids-search-390-${scheme}.png`) });
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

test('Tìm: exact code and prefix', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { page, ctx, errors } = await open('list/' + encodeURIComponent('d-3.2'), { scheme });
    try {
      await page.waitForSelector('.cards', { timeout: 8000 });
      const names = (await page.locator('.cards .card b').allInnerTexts()).map((t) => t.trim());
      assert.equal(names.length, 3, names.join(' | '));
      for (const n of ['Giả Văn An', 'Vương Thị Lan', 'Dương Chưa Rõ']) assert.ok(names.some((x) => x.includes(n)), n);
      assert.match(await page.locator('.cards .card').first().innerText(), /D-3\.2\.1 ·/, 'the code leads line 2 for a code search');
      if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `codes-search-390-${scheme}.png`) });
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); }
  }
  const { page, ctx } = await open('list/' + encodeURIComponent('D-2.1'));
  try {
    await page.waitForSelector('.cards', { timeout: 8000 });
    const names = await page.locator('.cards .card b').allInnerTexts();
    assert.equal(names.length, 1); assert.ok(names[0].includes('Dương Văn Bình'), 'Thứ 1 is D-2.1');
  } finally { await ctx.close(); }
});
