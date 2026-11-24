// E2E: the search / filter / + toolbar sticks under the top bar on scroll, everywhere (owner 2026-11-24). Mocked API,
// no database:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/sticky-toolbar.test.js
// For each page: scroll 600 px, then the toolbar's top equals the top bar's bottom (±1 px), its background is opaque,
// and the point just under its top edge belongs to the toolbar (content never shows through). On the profile the
// tab bar sticks under the top bar and the Quan hệ toolbar just under it while its card is on screen; it is released
// once the card has scrolled away.
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
const KIDS = Array.from({ length: 60 }, (_, i) => P('K' + i, { name: `Dương Văn Con Thứ ${i + 1}`, sex: i % 2 ? 'f' : 'm', gen: 7, thu: String(i + 1), parent: 'PA', order: i + 2, born: String(1950 + (i % 30)), died: String(2000 + (i % 20)), gio_lunar: `${(i % 28) + 1}/${(i % 12) + 1}` }));
const PERSONS = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  ...KIDS,
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };

let base; let srv;
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
});
test.after(() => { srv?.close(); });

async function open(browser, width, scheme, hash) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role: 'member', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: 'member' } });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: PERSONS, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + '/#/duong/' + hash);
  await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  return { page, ctx, errors };
}

// Geometry of the sticky toolbar `sel` (first visible match) against the top bar.
const GEO = (sel) => {
  const bar = [...document.querySelectorAll('.cbar')].find((b) => b.getBoundingClientRect().height > 0);
  const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().height > 0);
  if (!el) return null;
  const r = el.getBoundingClientRect(); const bg = getComputedStyle(el).backgroundColor;
  const hit = document.elementFromPoint(Math.round(r.left + 8), Math.round(r.top + 3));
  return { top: r.top, barBottom: bar ? bar.getBoundingClientRect().bottom : 0, bg, inside: !!hit && el.contains(hit), stuck: el.hasAttribute('data-stuck') };
};
const opaque = (bg) => !/rgba\(.*,\s*0\)$/.test(bg) && bg !== 'transparent';

const PAGES = [
  ['list', '.lbar', 'Tìm'],
  ['gio', '.lbar', 'Giỗ'],
  ['tree', '.tbar2', 'Cây'],
  ['mine', '.lbar', 'Góp ý của tôi'],
];
for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [1280, 'light']]) {
  for (const [hash, sel, label] of PAGES) {
    test(`${label}: toolbar sticks under the top bar after scrolling (${width}px ${scheme})`, { skip }, async () => {
      const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
      try {
        const { page, ctx, errors } = await open(browser, width, scheme, hash);
        const before = await page.evaluate(GEO, sel);
        assert.ok(before, `${label}: toolbar ${sel} present`);
        // make sure the page can scroll at least 600 px past the toolbar (short pages get padding for the check)
        await page.evaluate(() => { const sp = document.createElement('div'); sp.style.height = '1600px'; document.querySelector('main').append(sp); });
        await page.evaluate(() => window.scrollTo(0, 600));
        await page.waitForTimeout(250);
        const g = await page.evaluate(GEO, sel);
        assert.ok(Math.abs(g.top - g.barBottom) <= 1, `${label}: toolbar top ${g.top} vs top bar bottom ${g.barBottom}`);
        assert.ok(opaque(g.bg), `${label}: opaque background (${g.bg})`);
        assert.ok(g.inside, `${label}: the point under the toolbar's top edge is the toolbar`);
        assert.ok(g.stuck, `${label}: marked data-stuck (divider)`);
        if (SHOT_DIR && hash === 'list') { fs.mkdirSync(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, `sticky-list-${width}-${scheme}.png`) }); }
        assert.deepEqual(errors, []);
        await ctx.close();
      } finally { await browser.close(); }
    });
  }

  test(`profile: tab bar sticks, the Quan hệ toolbar sticks under it and releases after the card (${width}px ${scheme})`, { skip }, async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    try {
      const { page, ctx, errors } = await open(browser, width, scheme, 'person/PA');
      await page.waitForSelector('#reltb');
      await page.evaluate(() => { const sp = document.createElement('div'); sp.style.height = '2400px'; document.querySelector('main').append(sp); });
      // scroll so the Quan hệ toolbar's natural place is 30 px above the tab bar's bottom (its card still on screen)
      await page.evaluate(() => { const sp = document.createElement('div'); sp.style.height = '900px'; document.querySelector('#relbody').append(sp); });
      await page.evaluate(() => { const t = document.querySelector('#reltb'); window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 97 + 30); });
      await page.waitForTimeout(250);
      const tabs = await page.evaluate(GEO, '.ptabs');
      assert.ok(Math.abs(tabs.top - tabs.barBottom) <= 1, `tab bar top ${tabs.top} vs top bar bottom ${tabs.barBottom}`);
      const tabsBottom = await page.evaluate(() => document.querySelector('.ptabs').getBoundingClientRect().bottom);
      const rel = await page.evaluate(GEO, '#reltb');
      assert.ok(Math.abs(rel.top - tabsBottom) <= 1, `Quan hệ toolbar top ${rel.top} vs tab bar bottom ${tabsBottom}`);
      assert.ok(opaque(rel.bg), `Quan hệ toolbar opaque (${rel.bg})`);
      assert.ok(rel.inside, 'the point under the Quan hệ toolbar is the toolbar');
      if (SHOT_DIR) { fs.mkdirSync(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, `sticky-profile-${width}-${scheme}.png`) }); }
      // scroll past the end of the Quan hệ card: its toolbar leaves with it
      await page.evaluate(() => { const c = document.querySelector('#reltb').parentElement; window.scrollTo(0, c.getBoundingClientRect().bottom + window.scrollY + 300); });
      await page.waitForTimeout(250);
      const gone = await page.evaluate(() => document.querySelector('#reltb').getBoundingClientRect().bottom);
      const tb = await page.evaluate(() => document.querySelector('.ptabs').getBoundingClientRect().bottom);
      assert.ok(gone <= tb + 1, `Quan hệ toolbar released with its card (bottom ${gone} ≤ tab bar bottom ${tb})`);
      assert.deepEqual(errors, []);
      await ctx.close();
    } finally { await browser.close(); }
  });
}
