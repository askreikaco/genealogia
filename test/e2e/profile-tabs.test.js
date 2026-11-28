// E2E: the shared tab bar (.ptabs: Thông tin | Dòng đời | Tư liệu) on the person profile never shows a
// vertical scrollbar or vertical overflow, at phone (390 px) and desktop (1280 px), in light and dark.
// Mocked API, no database:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/profile-tabs.test.js
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
const SHOT_TAG = process.env.GP_SHOT_TAG || '';

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PERSONS = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 2, born: '1950' }),
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

async function openProfile(browser, width, scheme) {
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
  await page.goto(base + '/#/duong/person/PA');
  await page.waitForSelector('.ptabs', { timeout: 8000 });
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}

// Geometry of the tab bar: vertical overflow (content taller than the box), a vertical scrollbar, and every tab's
// indicator drawn inside the box.
const GEOM = () => {
  const el = document.querySelector('.ptabs');
  const box = el.getBoundingClientRect();
  const tabs = [...el.querySelectorAll('.ptab')].map((t) => {
    const r = t.getBoundingClientRect();
    return { label: t.textContent.trim(), top: r.top - box.top, bottom: r.bottom - box.top };
  });
  const cs = getComputedStyle(el);
  return {
    scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, offsetWidth: el.offsetWidth, clientWidth: el.clientWidth,
    overflowY: cs.overflowY, overflowX: cs.overflowX, height: box.height, tabs,
  };
};

for (const [width, scheme] of [[390, 'dark'], [390, 'light'], [1280, 'dark'], [1280, 'light']]) {
  test(`profile tab bar has no vertical overflow or scrollbar at ${width} px (${scheme})`, { skip }, async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    try {
      const { page, ctx, errors } = await openProfile(browser, width, scheme);
      const g = await page.evaluate(GEOM);
      if (SHOT_DIR) {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        const el = await page.$('.ptabs');
        await page.evaluate(() => document.querySelector('.ptabs').scrollIntoView({ block: 'center' }));
        await page.screenshot({ path: path.join(SHOT_DIR, `profile-tabs${SHOT_TAG ? '-' + SHOT_TAG : ''}-${width}-${scheme}.png`), clip: await (async () => { const b = await el.boundingBox(); return { x: 0, y: Math.max(0, b.y - 120), width, height: 240 }; })() });
      }
      assert.deepEqual(errors, [], 'page errors');
      assert.ok(g.scrollHeight <= g.clientHeight, `tabs content ${g.scrollHeight}px taller than box ${g.clientHeight}px`);
      assert.equal(g.offsetWidth, g.clientWidth, 'vertical scrollbar is drawn on the tab bar');
      assert.ok(g.overflowY === 'hidden' || g.overflowY === 'clip' || g.scrollHeight <= g.clientHeight, 'overflow-y must be hidden or clip');
      for (const t of g.tabs) {
        assert.ok(t.top >= -0.5 && t.bottom <= g.height + 0.5, `tab "${t.label}" is drawn outside the tab bar (${t.bottom} > ${g.height})`);
      }
      await ctx.close();
    } finally { await browser.close(); }
  });
}

test('Ông bà rows are the same person row as Quan hệ (calm row, tile, sex mark), no Tổ tiên card, and open the profile', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    for (const scheme of ['light', 'dark']) {
      const { page, ctx, errors } = await openProfile(browser, 390, scheme);
      // relations from the relation table (as live): PR -> PA -> K1
      const PCR = (i, a, b) => ({ id: i, parent_id: a, child_id: b, kind: 'ruot', birth_order: 1, private: false });
      const REL = { source: 'table', parent_child: [PCR(1, 'PR', 'PA'), PCR(2, 'PA', 'K1')], couple: [] };
      await page.route('**/api/persons**', (route, req) => {
        const since = new URL(req.url()).searchParams.get('since');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(since === '0' || since === null ? { items: PERSONS, next_since: 1, rel: REL } : { items: [], next_since: Number(since), rel: REL }) });
      });
      await page.evaluate(() => indexedDB.databases?.().then((ds) => Promise.all(ds.map((d) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; })))));
      await page.goto(base + '/#/duong/person/K1'); await page.reload();
      await page.waitForSelector('section.relsec h3.relgrp:text-is("Ông bà") + .relrows > a.calm', { timeout: 8000 });
      assert.equal(await page.locator('section[aria-label="Tổ tiên"]').count(), 0, 'no Tổ tiên card');
      const anc = page.locator('section.relsec h3.relgrp:text-is("Ông bà") + .relrows > a.calm').first();
      const rel = page.locator('section.relsec h3.relgrp:text-is("Cha mẹ") + .relrows > a.calm').first();
      assert.equal(await anc.getAttribute('class'), await rel.getAttribute('class'), 'same row classes as Quan hệ');
      const shape = (l) => l.evaluate((el) => [...el.children].map((c) => c.tagName + '.' + (c.getAttribute('class') || '')).join(' '));
      assert.equal(await shape(anc), await shape(rel), 'same inner structure');
      assert.ok(await page.locator('section.relsec h3.relgrp:text-is("Ông bà") + .relrows .sx').count() > 0, 'sex mark present');
      const tA = await anc.locator('.crest-sq').boundingBox(); const tR = await rel.locator('.crest-sq').boundingBox();
      assert.equal(Math.round(tA.width), Math.round(tR.width), 'same tile size');
      if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `ancestors-${scheme}-390.png`), fullPage: true });
      if (scheme === 'dark') {
        const href = await anc.getAttribute('href');
        await anc.click();
        await page.waitForFunction((h) => location.hash === h, href, { timeout: 5000 });
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); }
});

