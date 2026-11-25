// E2E: the one list toolbar (search · Bộ lọc · "+") and the "+" prefill (owner rules 2026-11-23, web/js/prefill.js):
//   every toolbar the "+" is the same DS icon button as Bộ lọc (class, size, background, border);
//   Tìm list     a search that found no one says "Không thấy “…”. Bấm + để thêm người này." and becomes the new name;
//   Dòng đời     the "+" sits in the timeline toolbar (no loose button under the list); a year in the search is the date;
//   Quan hệ      search and the Mức filter narrow every level (same "Không thấy" line); "+" with Mức = Con opens "Con" at the person step with the
//                search text, and "Tạo người mới" opens the form with that name and the next generation.
// Mocked API, no database:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/toolbar-add.test.js
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
const PERSONS = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 1, born: '1950' }),
  P('K2', { name: 'Dương Thị Hai', sex: 'f', gen: 7, thu: '2', parent: 'PA', order: 2, born: '1952', died: '2001' }),
  P('G1', { name: 'Dương Văn Cháu', sex: 'm', gen: 8, thu: '1', parent: 'K1', order: 1, born: '1975' }),
];
const PC = (id, parent, child, order) => ({ id, parent_id: parent, child_id: child, kind: 'ruot', birth_order: order, private: false });
const REL = { source: 'table', parent_child: [PC(1, 'PR', 'PA', 1), PC(2, 'PA', 'K1', 1), PC(3, 'PA', 'K2', 2), PC(4, 'K1', 'G1', 1)], couple: [] };
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

async function open(browser, hash, colorScheme = 'light', width = 390) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, colorScheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: 'Tester', role: 'editor', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: 'editor' } });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') {
      const since = u.searchParams.get('since'); const ids = u.searchParams.get('ids');
      if (ids) return json({ items: PERSONS.filter((x) => ids.split(',').includes(x.id)), rel: REL });
      return json(since === '0' || since === null ? { items: PERSONS, next_since: 1, rel: REL } : { items: [], next_since: Number(since), rel: REL });
    }
    if (p === '/api/events') return json({ items: [], stories: [] });
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + '/#/duong/' + hash);
  await page.waitForTimeout(400);
  return { page, ctx, errors };
}
const shot = async (page, name) => { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true }); };
// The "+" is the same DS icon button as Bộ lọc: same class, size, background and border (pointer moved away: no hover).
async function sameLook(page, bar, addSel) {
  await page.mouse.move(1, 1);
  const st = await page.evaluate(([b, a]) => {
    const pick = (el) => { const c = getComputedStyle(el); return { cls: el.className, w: c.width, h: c.height, bg: c.backgroundColor, bb: c.borderBottom, bt: c.borderTop, color: c.color }; };
    return { f: pick(document.querySelector(b + ' [data-fp]')), a: pick(document.querySelector(b + ' ' + a)) };
  }, [bar, addSel]);
  assert.deepStrictEqual(st.a, st.f, `the "+" looks like Bộ lọc in ${bar}`);
}

test('Tìm: the "+" is in the toolbar after Bộ lọc; a search that found no one becomes the name', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, errors } = await open(b, 'list');
    await page.waitForSelector('.lbar [data-add="list"]');
    const order = await page.$$eval('.lbar > *', (els) => els.map((e) => (e.matches('[data-add]') ? 'add' : e.matches('[data-fp]') ? 'filter' : e.className)));
    assert.deepEqual(order.slice(-2), ['filter', 'add'], 'Bộ lọc, then "+"');
    await sameLook(page, '.lbar', '[data-add="list"]');
    await page.fill('#q', 'Giả Quang Nghĩa');
    await page.waitForSelector('.lempty');
    assert.equal((await page.textContent('.lempty')).trim(), 'Không thấy “Giả Quang Nghĩa”. Bấm + để thêm người này.');
    assert.equal(await page.locator('#acbox:visible').count(), 0, 'no type-ahead popup when nothing matches: one empty state');
    await shot(page, 'tb-list-390.png');
    await page.click('[data-add="list"]');
    // step 1: the search text is in the search field; nobody matches, so "Không thấy" goes on to the basic form
    await page.waitForSelector('#add-q', { timeout: 8000 });
    assert.equal(await page.inputValue('#add-q'), 'Giả Quang Nghĩa');
    await page.click('[data-new]');
    await page.waitForSelector('#add-f input[name="name"]', { timeout: 8000 });
    assert.equal(await page.inputValue('#add-f input[name="name"]'), 'Giả Quang Nghĩa');
    assert.deepStrictEqual(errors, []);
  } finally { await b.close(); }
});

test('Dòng đời: "+" in the timeline toolbar, no loose button under the list; a year in the search is the date', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, errors } = await open(b, 'person/K1');
    await page.click('[data-ptab="life"]');
    await page.waitForSelector('#tl-bar .lbar [data-ev-add]', { timeout: 8000 });
    assert.equal(await page.locator('[data-ev-add]').count(), 1, 'one "+" only');
    assert.equal(await page.locator('.tl-add').count(), 0);
    await sameLook(page, '#tl-bar', '[data-ev-add]');
    await page.fill('#tlq', 'nhập ngũ 1968');
    await page.waitForTimeout(300);
    await shot(page, 'tb-life-390.png');
    await page.click('[data-ev-add]');
    await page.waitForSelector('.evpage [data-f="date_text"]');
    assert.equal(await page.inputValue('.evpage [data-f="date_text"]'), '1968');
    assert.deepStrictEqual(errors, []);
  } finally { await b.close(); }
});

test('Quan hệ: search and Mức narrow every level; "+" with Mức = Con prefills the new child', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, errors } = await open(b, 'person/PA');
    await page.waitForSelector('section.relsec #reltb .lbar [data-rel-add]', { timeout: 8000 });
    assert.equal(await page.locator('section.relsec .calm.ghost').count(), 0, 'no separate "＋ Thêm quan hệ" row');
    await sameLook(page, '#reltb', '[data-rel-add]');
    // search: one child left, the grandchild level is gone
    await page.fill('#relq', 'một');
    await page.waitForFunction(() => document.querySelectorAll('#relbody .calm-n').length === 1);
    assert.match(await page.textContent('#relbody'), /Dương Văn Một/);
    // Mức = Con through the filter sheet: only children, a chip, the badge on Bộ lọc
    await page.fill('#relq', '');
    await page.waitForFunction(() => document.querySelectorAll('#relbody .calm-n').length > 2);
    await page.click('section.relsec [data-fp]');
    await page.selectOption('dialog.fpanel[open] select[data-relf="lv"]', 'con');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => /Con · 2 người/.test(document.querySelector('#relbody')?.textContent || '') && !/Cháu/.test(document.querySelector('#relbody').textContent));
    assert.ok(await page.locator('#relbody .ltags [data-untag="lv"]').count(), 'chip for the filter');
    // an unmatched name in the search, then "+": the Con step with the text, then the form with the name
    await page.fill('#relq', 'Giả Quang Nghĩa');
    await page.waitForSelector('#relbody .rel-empty');
    assert.equal((await page.textContent('#relbody .rel-empty')).trim(), 'Không thấy “Giả Quang Nghĩa”. Bấm + để thêm người này.');
    await shot(page, 'tb-rel-390.png');
    await page.click('[data-rel-add]');
    await page.waitForSelector('.rel-sheet #rel-q');
    assert.equal(await page.inputValue('.rel-sheet #rel-q'), 'Giả Quang Nghĩa');
    assert.match(await page.textContent('.rel-sheet h2'), /Con/);
    await page.click('.rel-sheet [data-newp]');
    await page.waitForSelector('#add-f input[name="name"]', { timeout: 8000 });
    assert.equal(await page.inputValue('#add-f input[name="name"]'), 'Giả Quang Nghĩa');
    // the basic form has no Đời field: the generation (Cha is 6, so 7) is saved with the child (form-fields.test.js)
    await shot(page, 'tb-rel-form-390.png');
    assert.deepStrictEqual(errors, []);
  } finally { await b.close(); }
});

// The toolbar fields (search input, Bộ lọc, +) use a translucent tint (tokens.css --c-field-tint), so they show on any layer.
// The field's computed background must differ from the background behind it (nearest non-transparent ancestor), in both themes.
test('Hồ sơ Quan hệ and Tìm: the toolbar search field has its own background on the card (dark and light)', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const bgUnder = (page, sel) => page.evaluate((s) => {
    const field = document.querySelector(s);
    const behind = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c; } return 'none'; };
    return { field: getComputedStyle(field).backgroundColor, behind: behind(field.parentElement), scheme: getComputedStyle(document.documentElement).colorScheme };
  }, sel);
  try {
    for (const scheme of ['dark', 'light']) {
      const q = await open(b, 'person/PA', scheme);
      await q.page.waitForSelector('section.relsec #relq', { timeout: 8000 });
      await q.page.mouse.move(1, 1);
      const rel = await bgUnder(q.page, 'section.relsec #relq');
      assert.notEqual(rel.field, rel.behind, `Quan hệ ${scheme}: the search field differs from the card behind it`);
      assert.notEqual(rel.field, 'none');
      if (SHOT_DIR) { await q.page.locator('#reltb').evaluate((el) => el.scrollIntoView({ block: 'start' })); await q.page.waitForTimeout(200); }
      if (SHOT_DIR) await q.page.screenshot({ path: path.join(SHOT_DIR, `tbar-quanhe-${scheme}.png`) });
      assert.deepStrictEqual(q.errors, []);
      await q.ctx.close();

      const t = await open(b, 'list', scheme);
      await t.page.waitForSelector('.lbar #q', { timeout: 8000 });
      await t.page.mouse.move(1, 1);
      const tim = await bgUnder(t.page, '.lbar #q');
      assert.notEqual(tim.field, tim.behind, `Tìm ${scheme}: the search field differs from the bar behind it`);
      if (SHOT_DIR) await t.page.screenshot({ path: path.join(SHOT_DIR, `tbar-tim-${scheme}.png`) });
      assert.deepStrictEqual(t.errors, []);
      await t.ctx.close();
    }
  } finally { await b.close(); }
});

// Desktop (1280): the inline quick-filter select (.lq, Lịch "Hiển thị") uses the same field tint as the search field, inside a card.
test('Lịch at 1280 in a card: the inline quick-filter select has the field tint, not the card layer (dark and light)', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    for (const scheme of ['dark', 'light']) {
      const q = await open(b, 'lich', scheme, 1280);
      await q.page.waitForSelector('#gallq', { timeout: 8000 });
      // the owner's case: the toolbar inside a card (.cd, layer colour). Lịch has no card around its bar, so wrap the real bar in one.
      await q.page.evaluate(() => { const bar = document.querySelector('#gq').closest('.lbar'); const card = document.createElement('div'); card.className = 'cd'; bar.parentNode.insertBefore(card, bar); card.appendChild(bar); });
      await q.page.mouse.move(1, 1);
      const st = await q.page.evaluate(() => {
        const field = document.querySelector('#gallq');
        const behind = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c; } return 'none'; };
        return { field: getComputedStyle(field).backgroundColor, behind: behind(field.parentElement) };
      });
      assert.notEqual(st.field, 'none');
      assert.notEqual(st.field, st.behind, `Lịch 1280 ${scheme}: the quick-filter select differs from the bar behind it`);
      assert.deepStrictEqual(q.errors, []);
      await q.ctx.close();
    }
  } finally { await b.close(); }
});
