// E2E: the Thông tin facts card groups the life basics under "Tóm tắt" (no SINH / MẤT headers over one row each).
// Guest: the "(ngày sinh chỉ hiện khi đăng nhập)" hint shows for a living person born within 110 years, not for a dead one.
// Mocked API, no database:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/facts-tomtat.test.js
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
const FULL = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0, died: '1900', born: '1850' }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1960', birth_place: 'Củ Chi', place: 'Củ Chi', job: 'Nông', note: 'Ghi chú thử' }),
  P('PD', { name: 'Dương Văn Đã', sex: 'm', gen: 6, thu: '2', parent: 'PR', order: 2, born: '1930', died: '2001', burial: 'Nghĩa trang Củ Chi' }),
  P('PO', { name: 'Dương Văn Cổ', sex: 'm', gen: 6, thu: '3', parent: 'PR', order: 3, born: '1900' }),
  P('PN', { name: 'Dương Văn Không', sex: 'm', gen: 6, thu: '4', parent: 'PR', order: 4, born: '1965', died: '' }),
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

// who: 'guest' | 'member'. The guest gets what the server sends a non-member: the same rows (birth years stay).
async function openProfile(who, id) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  const member = who === 'member';
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') {
      if (!member) return json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
      return json({ editor: null, role: 'member', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: 'member' } });
    }
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: FULL, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(`${base}/#/duong/person/${id}`);
  await page.waitForSelector('.ptabs', { timeout: 8000 });
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}
// textContent: the small group labels are uppercase on screen (text-transform), so innerText would show them in capitals.
const headers = (page) => page.locator('.factcard .fgrp > .tgen').allTextContents();
// The card title (Tóm tắt) is the Quan hệ title element: .relhead > h2.
const cardTitle = (page) => page.locator('.factcard .fgrp:first-child > .relhead > h2').allTextContents();

test('Tóm tắt is the first group; no header repeats a single row', { skip }, async () => {
  const { page, ctx, errors } = await openProfile('member', 'PA');
  try {
    assert.deepStrictEqual(await cardTitle(page), ['Tóm tắt'], 'Tóm tắt is the card title');
    const h = await headers(page);
    assert.deepStrictEqual(h, ['Nơi sống & nghề'], 'small labels: Ghi chú alone (one row, header repeats it) is merged; no eyebrow');
    assert.ok(!h.includes('Sinh') && !h.includes('Mất'), 'no SINH / MẤT header');
    const same = await page.evaluate(() => {
      const t = document.querySelector('.factcard .fgrp:first-child > .relhead > h2');
      const q = document.querySelector('.relsec .relhead > h2');
      const cs = (el) => { const c = getComputedStyle(el); return [c.fontSize, c.fontWeight, c.lineHeight, c.color]; };
      return { tag: [t?.tagName, q?.tagName], cls: [t?.className, q?.className], style: [cs(t), cs(q)] };
    });
    assert.equal(same.tag[0], same.tag[1], 'same element as the Quan hệ title');
    assert.equal(same.cls[0], same.cls[1], 'same class as the Quan hệ title');
    assert.deepStrictEqual(same.style[0], same.style[1], 'same size, weight and colour as the Quan hệ title');
    assert.equal(await page.locator('.factcard .tgen', { hasText: /tóm tắt/i }).count(), 0, 'the old TÓM TẮT eyebrow is gone');
    const rows = await page.locator('.factcard .fgrp').first().locator('dt').allTextContents();
    assert.deepStrictEqual(rows, ['Sinh', 'Nơi sinh', 'Ghi chú'], 'row labels kept under Tóm tắt');
    assert.equal(await page.locator('.factcard .fgrp').first().locator('dt', { hasText: 'Mất' }).count(), 0, 'no Mất row for a living person');
    const lefts = await page.evaluate(() => [...new Set([...document.querySelectorAll('.factcard dd')].map((d) => Math.round(d.getBoundingClientRect().left)))]);
    assert.equal(lefts.length, 1, 'values start at one x across every group (shared label column): ' + lefts.join(','));
    assert.deepStrictEqual(errors, []);
  } finally { await ctx.close(); }
});

test('a dead person: Tóm tắt holds Mất, Giỗ and An táng; no born-date hint', { skip }, async () => {
  const { page, ctx, errors } = await openProfile('guest', 'PD');
  try {
    assert.deepStrictEqual(await cardTitle(page), ['Tóm tắt']);
    const t = await page.locator('.factcard').first().textContent();
    assert.match(t, /Mất2001/); assert.match(t, /An tángNghĩa trang Củ Chi/);
    assert.doesNotMatch(t, /ngày sinh chỉ hiện khi đăng nhập/, 'no hint for the deceased');
    assert.deepStrictEqual(errors, []);
  } finally { await ctx.close(); }
});

test('guest, living, born within 110 years: the hint shows; born over 110 years ago: no hint', { skip }, async () => {
  for (const [id, want] of [['PA', true], ['PO', false]]) {
    const { page, ctx, errors } = await openProfile('guest', id);
    try {
      const shown = (await page.locator('.factcard').first().textContent()).includes('ngày sinh chỉ hiện khi đăng nhập');
      assert.equal(shown, want, `${id}: born-date hint`);
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

test('member: no hint at all', { skip }, async () => {
  const { page, ctx } = await openProfile('member', 'PA');
  try {
    assert.doesNotMatch(await page.locator('.factcard').first().textContent(), /ngày sinh chỉ hiện khi đăng nhập/);
  } finally { await ctx.close(); }
});
