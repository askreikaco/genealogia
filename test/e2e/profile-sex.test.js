// E2E: #13 sex cue (variant A). Colour is never the only signal: a shape (square nam, circle nữ) with a text label
// (aria-label/title) next to the name in the tree list, the Tìm list and the profile header (a Nam / Nữ tag).
// Unknown sex: neutral, no shape. Mocked /api, no database:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/profile-sex.test.js
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
// invented family: thủy tổ R, two sons (A Thứ 2, B Thứ 1), A's children (a son, a daughter, one of unknown sex)
const PERSONS = [
  P('R', { name: 'Dương Văn Tổ', sex: 'm', gen: 1, born: '1850', died: '1910' }),
  P('A', { name: 'Vương Văn Lyh', sex: 'm', gen: 2, parent: 'R', order: 2, born: '1880', died: '1950' }),
  P('B', { name: 'Dương Văn Bình', sex: 'm', gen: 2, parent: 'R', order: 1, born: '1878', died: '1940' }),
  P('A1', { name: 'Giả Văn An', sex: 'm', gen: 3, parent: 'A', order: 1, born: '1905', died: '1970' }),
  P('A2', { name: 'Vương Thị Lan', sex: 'f', gen: 3, parent: 'A', order: 2, born: '1908', died: '1990' }),
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

test('profile header: a Nam / Nữ tag with the shape; none for unknown sex', { skip }, async () => {
  for (const [id, label] of [['A1', 'Nam'], ['A2', 'Nữ'], ['A3', null]]) {
    const { page, ctx, errors } = await open(`person/${id}`);
    try {
      await page.waitForSelector('.prof', { timeout: 8000 });
      const tag = page.locator('.prof .sxtag');
      if (!label) { assert.equal(await tag.count(), 0, 'no tag for unknown sex'); continue; }
      assert.equal(await tag.count(), 1, `${id}: one sex tag`);
      assert.equal((await tag.innerText()).trim(), label);
      assert.equal(await tag.locator(`.sx[aria-label="${label}"]`).count(), 1, 'the shape carries the same label');
      if (SHOT_DIR && id === 'A2') await page.locator('.prof').screenshot({ path: path.join(SHOT_DIR, 'sex-profile-390-light.png') });
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

test('Tìm list: labelled shapes replace the colour-only dots; unknown sex has none', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { page, ctx, errors } = await open('list', { scheme });
    try {
      await page.waitForSelector('.cards .card', { timeout: 8000 });
      assert.equal(await page.locator('.cards .dot').count(), 0, 'no colour-only dot');
      const card = (name) => page.locator('.cards .card', { hasText: name });
      assert.equal(await card('Giả Văn An').locator('.sx.m[aria-label="Nam"]').count(), 1);
      assert.equal(await card('Vương Thị Lan').locator('.sx.f[aria-label="Nữ"]').count(), 1);
      assert.equal(await card('Dương Chưa Rõ').locator('.sx').count(), 0, 'unknown sex: no shape');
      // the two shapes differ by form, not only colour
      const radius = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
      assert.equal(await radius('.cards .sx.m'), '0px'); assert.notEqual(await radius('.cards .sx.f'), '0px');
      if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `sex-list-390-${scheme}.png`) });
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

test('tree list: sex rule colour + shape; unknown sex neutral', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { page, ctx, errors } = await open('tree', { scheme });
    try {
      await page.waitForSelector('#tr .tn', { timeout: 8000 });
      assert.ok(await page.locator('#tr .tn.m .sx.m').count() > 0, 'male nodes: square');
      assert.ok(await page.locator('#tr .tn.f .sx.f').count() > 0, 'female nodes: circle');
      const u = page.locator('#tr .tn.u');
      assert.equal(await u.count(), 1, 'one node of unknown sex'); assert.equal(await u.locator('.sx').count(), 0);
      const rule = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).borderLeftColor);
      assert.notEqual(await rule('#tr .tn.m'), await rule('#tr .tn.f'));
      assert.notEqual(await rule('#tr .tn.u'), await rule('#tr .tn.m'));
      if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `sex-tree-390-${scheme}.png`) });
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); }
  }
});
