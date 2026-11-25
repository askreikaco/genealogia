// Minimal UI (owner rule 2026-11-22): one primary action per screen, at most one secondary, short copy, advanced
// options behind ⋯ or a sub-page. Mocked API, 390 px phone unless said otherwise:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] node --test test/e2e/minimal-ui.test.js
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

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PERSONS = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 2, born: '1950', verify: 'Thiếu thông tin' }),
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', han: '楊', visibility: 'public', has_emblem: false };

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

async function openPage(browser, role, hash, width = 390) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role, status: role === 'guest' ? null : 'active', person_id: null, email: role === 'guest' ? null : 't@test.local', name: 'Tester', google: false, roles: role === 'guest' ? {} : { duong: role } });
    if (p === '/api/families/duong') return json({ ...FAM, my_role: role === 'guest' ? null : role });
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: PERSONS, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + '/' + hash);
  await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}
const mainText = (page) => page.evaluate(() => document.querySelector('#main')?.innerText || '');
const countIn = (text, s) => text.split(s).length - 1;

test('Cài đặt dòng họ: the succession block is on its own sub-page; one calm row leads there', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const o = await openPage(b, 'owner', '#/duong/cai-dat-dong-ho');
    const t = await mainText(o.page);
    for (const gone of ['Người được ủy thác', 'Báo Chủ họ đã mất', 'Thời hạn không đăng nhập', 'Tôi vẫn giữ quyền']) assert.ok(!t.includes(gone), `"${gone}" is not on Cài đặt dòng họ`);
    assert.equal(await o.page.locator('#succ-settings').count(), 0, 'no succession block on the settings page');
    const row = o.page.locator('a.calm[href="#nguoi-ke-nhiem"]');
    assert.equal(await row.count(), 1, 'one calm row to Người kế nhiệm');
    assert.match(await row.innerText(), /Người kế nhiệm[\s\S]*Ủy thác/);
    assert.equal(await o.page.locator('#setdef').count(), 1, 'default-family row present once');
    assert.deepStrictEqual(o.errors, []);
    await o.ctx.close();

    const s = await openPage(b, 'owner', '#/duong/nguoi-ke-nhiem');
    // page titles live in the bar (the page wrapper moves the h1 there)
    assert.equal((await s.page.locator('#cbtitle').innerText()).trim(), 'Người kế nhiệm');
    assert.equal(await s.page.locator('#succ-settings').count(), 1, 'succession block lives on the sub-page');
    await s.ctx.close();

    const m = await openPage(b, 'member', '#/duong/nguoi-ke-nhiem');
    assert.match(await mainText(m.page), /Chỉ Chủ họ và Quản trị xem được trang này/);
    await m.ctx.close();
  } finally { await b.close(); }
});

test('Cài đặt: "Họ Dương" is listed once (the default-family row names no family)', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await openPage(b, 'member', '#/duong/settings');
    assert.equal(countIn(await mainText(page), 'Họ Dương'), 1, 'Họ Dương appears once on Cài đặt');
    assert.equal(await page.locator('#defam').count(), 0, 'no duplicate default row');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('person header: one Sửa for every role; the profile ⋯ repeats nothing on the page; no Quan hệ tab', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await openPage(b, 'editor', '#/duong/person/PA');
    const acts = page.locator('.acts2');
    assert.equal(await acts.locator('button.btn.sm').count(), 1, 'one visible action button');
    assert.equal(await acts.locator('button.btn.sm').innerText(), 'Sửa');
    assert.equal(await acts.locator('a').count(), 0, 'no link actions in the header');
    await page.locator('[data-menu="PA"]').click();
    const menu = page.locator('.menu');
    assert.ok(await menu.locator('[data-act="treeview"]').count() === 1, '⋯ has Xem trên cây');
    for (const k of ['view', 'edit', 'suggest', 'parent', 'child', 'spouse', 'sibling']) assert.equal(await menu.locator(`[data-act="${k}"]`).count(), 0, `profile ⋯ has no ${k} (it repeats an on-page action)`);
    assert.equal(await page.locator('button[data-ptab="rel"]').count(), 0, 'no Quan hệ tab: relations are on Thông tin');
    assert.ok(await page.locator('section.relsec').count() >= 1, 'the Quan hệ section is on the Thông tin tab');
    const g = await openPage(b, 'guest', '#/duong/person/PA');
    const gb = g.page.locator('.acts2 button.btn.sm');
    assert.equal(await gb.innerText(), 'Sửa', 'a guest gets the same Sửa button');
    assert.equal(await gb.getAttribute('data-act'), 'suggest', 'for a guest Sửa opens the suggestion form');
    await g.ctx.close();
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('Tải về: Excel is the one primary; SVG and Sách are calm rows; no explanatory paragraphs', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await openPage(b, 'member', '#/duong/export');
    const t = await mainText(page);
    assert.equal(await page.locator('#main .btn.sm, #main button.btn').count(), 1, 'one button, the Excel primary');
    assert.equal(await page.locator('#xcsv').innerText(), 'Tải file Excel (.csv)');
    assert.equal(await page.locator('#xsvg').count(), 1, 'SVG is a calm row');
    assert.equal(await page.locator('a.calm[href="/book"]').count(), 1, 'Sách is a calm link');
    assert.ok(!t.includes('Hình cây đầy đủ') && !t.includes('Ai cũng tải được'), 'no long explanations');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('Thành viên & quyền: the role legend is a sub-page; the members page keeps no legend card', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx } = await openPage(b, 'owner', '#/duong/members');
    assert.equal(await page.locator('.roles').count(), 0, 'no legend card on the members page');
    assert.equal(await page.locator('a.calm[href="#vai-tro"]').count(), 1, 'one calm row to Vai trò và quyền');
    await ctx.close();
    const s = await openPage(b, 'owner', '#/duong/vai-tro');
    assert.equal((await s.page.locator('#cbtitle').innerText()).trim(), 'Vai trò và quyền');
    assert.ok(await s.page.locator('.roles .rl > div').count() >= 4, 'role rows on the sub-page');
    await s.ctx.close();
  } finally { await b.close(); }
});

test('Cần bổ sung: the row is the link, the header is the count, no per-row button', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await openPage(b, 'guest', '#/duong/verify');
    assert.equal(await page.locator('.lcount').innerText(), '1 chỗ còn thiếu');
    assert.equal(await page.locator('.cd a.calm').count(), 1, 'the row is a link');
    assert.equal(await page.locator('.cd button').count(), 0, 'no per-row button');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('form: no "Để trống" hint; Thứ and Đời share one row at 390 px; guest intro is one short line', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const e = await openPage(b, 'editor', '#/duong/sua/K1');
    assert.ok(!(await mainText(e.page)).includes('Để trống nếu là người gốc'), 'no parent hint');
    await e.page.locator('[data-acc-btn="gd"]').click();
    const tops = await e.page.evaluate(() => ['gen', 'thu'].map((k) => Math.round(document.querySelector(`[data-au="${k}"]`).getBoundingClientRect().top)));
    assert.equal(tops[0], tops[1], 'Đời and Thứ start on the same row');
    assert.equal(await e.page.locator('.fp-guest').count(), 0, 'no sign-in note for an editor');
    await e.ctx.close();
    const g = await openPage(b, 'guest', '#/duong/sua/K1');
    const note = await g.page.locator('#fpnote').innerText().catch(() => '');
    assert.ok(!note.includes('Chỉ cần điền'), 'the long intro is gone');
    const gn = g.page.locator('.fp-guest');
    assert.equal(await gn.count(), 1, 'a guest sees the sign-in note above the form');
    assert.match(await gn.innerText(), /Bạn chưa đăng nhập/);
    await gn.locator('[data-fp-guest-x]').click();
    assert.equal(await gn.isVisible(), false, 'Tiếp tục góp ý hides the note');
    await g.ctx.close();
  } finally { await b.close(); }
});

test('Lập gia phả mới: visibility is one select; no crest square until a Hán name is typed', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await openPage(b, 'owner', '#lap-gia-pha');
    assert.equal(await page.locator('input[name=visibility]').count(), 0, 'no radio group');
    assert.equal(await page.locator('select[name=visibility] option').count(), 3, 'one select with the three choices');
    assert.equal(await page.locator('#lf-tile').evaluate((el) => el.hidden), true, 'no empty square');
    await page.locator('#lf-han').fill('潘');
    assert.equal(await page.locator('#lf-tile').evaluate((el) => el.hidden), false, 'the Hán crest shows');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('emblem: no file yet means one "Thêm biểu tượng" row and no empty square', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx } = await openPage(b, 'owner', '#/duong/cai-dat-dong-ho');
    assert.match(await page.locator('.emb-add').innerText(), /Thêm biểu tượng/);
    assert.equal(await page.locator('.emb-prev').count(), 0, 'no preview square');
    await ctx.close();
  } finally { await b.close(); }
});

test('Thống kê: no coloured tile borders; the generation chart is a sub-page', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await openPage(b, 'member', '#/duong/stats');
    assert.equal(await page.locator('.kpi').first().evaluate((el) => getComputedStyle(el).borderTopWidth), '0px', 'no tile top border');
    assert.equal(await page.locator('.gbars').count(), 1, 'only the places bars stay on the summary');
    assert.equal(await page.locator('a.calm[href="#doi-chi"]').count(), 1, 'one row to the chart');
    await ctx.close();
    const s = await openPage(b, 'member', '#/duong/doi-chi');
    assert.equal((await s.page.locator('#cbtitle').innerText()).trim(), 'Theo đời và chi');
    assert.ok(await s.page.locator('.gbars .gb').count() >= 1, 'generation rows on the sub-page');
    assert.deepStrictEqual(errors, []);
    await s.ctx.close();
  } finally { await b.close(); }
});

test('Cây: a branch row shows its generation only at the top; group headers carry it below', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx } = await openPage(b, 'guest', '#/duong/tree');
    const child = page.locator('.tn[style*="--d:1"] .tnm .sub').first();
    assert.equal(await child.count(), 1, 'a child row exists');
    assert.ok(!(await child.innerText()).includes('Đời'), 'child row has no Đời');
    assert.ok((await page.locator('.tn[style*="--d:0"] .tnm .sub').first().innerText()).includes('Đời'), 'root row keeps Đời');
    await ctx.close();
  } finally { await b.close(); }
});

test('Thêm: no "Của tôi" heading; Cài đặt sits in the Ứng dụng group', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx } = await openPage(b, 'member', '#/duong/more');
    const heads = await page.$$eval('.mg-h', (els) => els.map((e) => e.textContent.trim()));
    assert.ok(!heads.includes('Của tôi'), `headings: ${heads.join(', ')}`);
    assert.equal(await page.locator('.mg-g a.calm[href="#settings"]').count(), 1, 'Cài đặt is a row in a group card');
    await ctx.close();
  } finally { await b.close(); }
});
