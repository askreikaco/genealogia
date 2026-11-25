// E2E: the Quốc gia level. #tree shows TOÀN CẦU then QUỐC GIA ("Họ Dương · Việt Nam · 9 cây", this tree's country) above
// the root; the clan page shows one chip per country and a chip filters the trees. Mocked /api, invented data:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/clan-country.test.js
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
const PERSONS = [P('R', { name: 'Dương Văn Tổ', sex: 'm', gen: 1, born: '1850', died: '1910' }), P('A', { name: 'Dương Văn Anh', sex: 'm', gen: 2, parent: 'R', born: '1880', died: '1950' })];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', han: '楊', visibility: 'public', country: 'VN' };
const tree = (id, label, country) => ({ id, slug: id, label, han: '楊', origin: '', people: 10, year: 1800, country, founder: null });
const ALL = [tree('t1', 'Dương · Làng Một', 'VN'), tree('t2', 'Dương · Làng Hai', 'VN'), tree('t3', 'Dương · Bên Kia', 'US'), tree('t4', 'Dương · Chưa Rõ', '')];
const clan = (country) => {
  const shown = country ? ALL.filter((t) => (country === 'NONE' ? !t.country : t.country === country)) : ALL;
  return { surname: 'Dương', han: '楊', slug: 'duong', kpis: { groups: 0, trees: 12, people: 400 }, private_count: 0, page: 1, pages: 1, groups: [], unlinked: shown,
    countries: [{ code: 'VN', trees: 9 }, { code: 'US', trees: 2 }, { code: 'NONE', trees: 1 }], country: country || '' };
};

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

async function open(hash, { scheme = 'light', width = 390, fam = FAM } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const asked = [];
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
    if (p.startsWith('/api/families/')) return json(fam);
    if (p === '/api/persons') { const since = u.searchParams.get('since'); return json(since === '0' ? { items: PERSONS, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/clans/')) { asked.push(p + u.search); return json(clan(u.searchParams.get('country') || '')); }
    if (p.startsWith('/api/links')) return json({ items: [] });
    return json({});
  });
  await page.goto(`${base}/#${hash}`);
  await page.waitForTimeout(600);
  return { page, ctx, errors, asked };
}

test('#tree: QUỐC GIA sits under TOÀN CẦU with this tree\'s country and its count', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { page, ctx, errors } = await open('/duong/tree', { scheme });
    try {
      await page.waitForFunction(() => /Việt Nam/.test(document.body.innerText), null, { timeout: 8000 });
      const cards = await page.locator('.tcard').allInnerTexts();
      const i = cards.findIndex((t) => t.includes('Họ Dương · Việt Nam'));
      assert.ok(i > 0, cards.join(' | ')); assert.match(cards[i], /9 cây/);
      assert.ok(cards[0].includes('12 cây'), 'TOÀN CẦU first');
      assert.match(await page.locator('#main').innerText(), /QUỐC GIA|Quốc gia/);
      assert.match(await page.locator('.tcard').nth(i).getAttribute('href'), /#ho\/duong\?qg=VN$/);
      if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `nation-tree-390-${scheme}.png`) });
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

test('clan page: one chip per country, "Chưa rõ" last; a chip filters the trees', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { page, ctx, errors, asked } = await open('ho/duong', { scheme });
    try {
      await page.waitForSelector('.clan-qg', { timeout: 8000 });
      const chips = (await page.locator('.clan-qg .tag.chip').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      assert.deepStrictEqual(chips, ['Tất cả 12', 'Việt Nam 9', 'Hoa Kỳ 2', 'Chưa rõ 1']);
      await page.locator('.clan-qg .tag.chip', { hasText: 'Hoa Kỳ' }).click();
      await page.waitForFunction(() => /qg=US/.test(location.hash), null, { timeout: 5000 });
      await page.waitForFunction(() => document.querySelectorAll('[data-clan-tree]').length === 1, null, { timeout: 5000 });
      assert.match(await page.locator('[data-clan-tree]').first().innerText(), /Bên Kia.*Hoa Kỳ/s);
      assert.ok(asked.some((q) => /country=US/.test(q)), 'the API was asked for US');
      assert.equal(await page.locator('.clan-qg .tag.chip[aria-current="true"]').innerText().then((t) => t.replace(/\s+/g, ' ').trim()), 'Hoa Kỳ 2');
      if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `nation-clan-390-${scheme}.png`) });
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

test('#tree of a Japanese reference tree: no TOÀN CẦU / QUỐC GIA rows, no clan link, the clan API is never asked', { skip }, async () => {
  const JP = { id: 'ref-jp-imperial', slug: 'ref-jp-imperial', name: 'Hoàng tộc Nhật Bản (tham khảo)', han: '', visibility: 'public', country: 'JP' };
  const { page, ctx, errors, asked } = await open('/ref-jp-imperial/tree', { fam: JP });
  try {
    await page.waitForFunction(() => document.body.innerText.includes('Hoàng tộc Nhật Bản'), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const text = await page.locator('#main').innerText();
    assert.match(text, /CÂY NÀY/, 'the tree page rendered');
    assert.ok(!/TOÀN CẦU|Toàn cầu/.test(text), 'no TOÀN CẦU row');
    assert.ok(!/QUỐC GIA|Quốc gia/.test(text), 'no QUỐC GIA row');
    assert.ok(!/Họ Hoàng/.test(text), 'not filed under Họ Hoàng');
    assert.equal(await page.locator('#main a[href^="#ho/"]').count(), 0, 'no clan link');
    assert.deepStrictEqual(asked.filter((q) => q.includes('hoang')), [], 'the clan API is not asked for hoang');
    assert.deepStrictEqual(errors, []);
  } finally { await ctx.close(); }
});

test('#tree of a US diaspora "Họ Dương": still in clan duong, the TOÀN CẦU row links to it and the QUỐC GIA row shows Hoa Kỳ', { skip }, async () => {
  const US = { id: 'duong-us', slug: 'duong-us', name: 'Họ Dương', han: '楊', visibility: 'public', country: 'US' };
  const { page, ctx, errors, asked } = await open('/duong-us/tree', { fam: US });
  try {
    await page.waitForFunction(() => /Hoa Kỳ/.test(document.body.innerText), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const cards = await page.locator('.tcard').allInnerTexts();
    const i = cards.findIndex((t) => t.includes('Họ Dương · Hoa Kỳ'));
    assert.ok(i > 0, cards.join(' | ')); assert.match(cards[i], /2 cây/);
    assert.ok(cards[0].includes('12 cây'), 'TOÀN CẦU first');
    assert.match(await page.locator('.tcard').nth(i).getAttribute('href'), /#ho\/duong\?qg=US$/);
    assert.ok(asked.some((q) => q.startsWith('/api/clans/duong')), 'the clan API is asked for duong');
    assert.deepStrictEqual(errors, []);
  } finally { await ctx.close(); }
});
