// E2E: clan step 1. Cài đặt dòng họ "Chi và thủy tổ": automatic founder, branch split, order and short name with reasons;
// one "Sửa tay" switch for overrides; round-trips through PATCH /api/families/:ref; chips name two same-surname families apart. Mocked /api, no database.
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/clan-settings.test.js
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
const SHOTS = process.env.GP_SHOT_DIR || '';

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const fams = () => ({
  duong: { id: 'duong', slug: 'duong', name: 'Họ Dương', han: '楊', visibility: 'public', place: 'Phú Mỹ', people: 6, generations: 4, branch_gen: null, branch_order: null, short_name: null, origin_place: null, founder_person_id: null },
  anlac: { id: 'anlac', slug: 'anlac', name: 'Họ Dương', han: '楊', visibility: 'public', place: 'Hòa An', origin_place: 'An Lạc', people: 1, generations: 1, branch_gen: null, branch_order: null, short_name: null, founder_person_id: null },
});
// R -> C -> two branch founders at Đời 3: Y3 (Thứ 1) and X3 (Thứ 2), each with a child
const PERSONS = {
  duong: [
    P('R', { name: 'Dương Văn Tổ', sex: 'm', gen: 1, order: 1, died: '1800', gio_lunar: '1/1' }),
    P('C', { name: 'Dương Văn Con', sex: 'm', gen: 2, parent: 'R', order: 1 }),
    P('X3', { name: 'Dương Văn Hai', sex: 'm', gen: 3, thu: '2', parent: 'C', order: 2, born: '1850' }),
    P('Y3', { name: 'Dương Văn Một', sex: 'm', gen: 3, thu: '1', parent: 'C', order: 1, born: '1852' }),
    P('X4', { name: 'Dương Văn Cháu Hai', sex: 'm', gen: 4, parent: 'X3', order: 1 }),
    P('Y4', { name: 'Dương Văn Cháu Một', sex: 'm', gen: 4, parent: 'Y3', order: 1 }),
  ],
  anlac: [P('H1', { name: 'Vương Thị Tâm', sex: 'm', gen: 1, order: 1, died: '1900', gio_lunar: '3/3' })],
};

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

async function open(browser, { roles, hash, FAMS = fams(), patches = [] }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role: 'member', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles });
    if (p === '/api/families') return json({ items: Object.values(FAMS).map((f) => ({ ...f, my_role: roles[f.id] || null })) });
    if (p.startsWith('/api/families/')) {
      const f = FAMS[decodeURIComponent(p.split('/')[3])];
      if (!f) return json({ error: 'Không tìm thấy dòng họ.' }, 404);
      if (req.method() === 'PATCH') {
        const b = JSON.parse(req.postData() || '{}'); patches.push(b);
        for (const k of ['short_name', 'origin_place', 'founder_person_id']) if (k in b) f[k] = b[k] || null;
        if ('branch_gen' in b) f.branch_gen = b.branch_gen;
        if ('branch_order' in b) f.branch_order = b.branch_order;
        return json({ ok: true, family: { ...f, my_role: roles[f.id] || null } });
      }
      return json({ ...f, my_role: roles[f.id] || null });
    }
    if (p === '/api/persons') {
      const fam = u.searchParams.get('family'); const since = Number(u.searchParams.get('since'));
      if (since !== 0) return json({ items: [], next_since: since });
      const items = PERSONS[fam] || [];
      return json({ items, next_since: items.length });
    }
    if (p.startsWith('/api/suggestions')) return json({ items: [], counts: { pending: 0 } });
    if (p === '/api/me/prefs') return json({ prefs: { follows_families: Object.keys(FAMS) } });
    return json({});
  });
  await page.goto(base + '/#' + hash);
  await page.waitForSelector('#main', { state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#sync')?.textContent.includes('Đã đồng bộ'));
  return { ctx, page, errors, FAMS, patches };
}
const launch = () => chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
// the people arrive after the first paint: wait for the branch rows before reading them
const orderTexts = async (page, n = 1) => { await page.waitForFunction((k) => document.querySelectorAll('#clan-order [data-bid]').length >= k, n); return page.locator('#clan-order .clan-n').allTextContents(); };

test('admin: everything is automatic first (founder, split, order, short name) with reasons; saving keeps it automatic', { skip }, async () => {
  const b = await launch();
  try {
    const s = await open(b, { roles: { duong: 'admin' }, hash: '/duong/cai-dat-dong-ho' });
    await s.page.waitForSelector('#fclan');
    assert.deepEqual(await orderTexts(s.page, 2), ['1. Chi Ông 1 Dương Văn Một', '2. Chi Ông 2 Dương Văn Hai'], 'chi trưởng (Thứ 1) first');
    const view = await s.page.textContent('#clan-view');
    assert.match(view, /Thủy tổ\s*Đời 1 · Ông Dương Văn Tổ\s*Tự động\s*người sớm nhất không có cha mẹ trong cây/);
    assert.match(view, /Chi\s*2 chi · đời 3\s*Tự động\s*chia nhánh ở đời 3/);
    assert.match(view, /Tên ngắn\s*Dương · Phú Mỹ\s*Tự động/);
    assert.equal(await s.page.isChecked('#fclan [name=manual]'), false);
    assert.equal(await s.page.isHidden('#clan-man'), true, 'overrides hidden until Sửa tay');
    assert.equal(await s.page.locator('#clan-order [data-up]').count(), 0, 'no ↑↓ in automatic mode');
    if (SHOTS) await s.page.locator('#clan').screenshot({ path: path.join(SHOTS, 'clan-settings-390.png') });
    await s.page.fill('#fclan [name=origin_place]', 'Tân Lập');
    assert.match(await s.page.textContent('#clan-view'), /Dương · Tân Lập/, 'short name follows quê gốc while typing');
    await s.page.click('#fclan button:not([type=button])');
    await s.page.waitForFunction(() => /Đã lưu chi và thủy tổ/.test(document.body.innerText));
    assert.deepEqual({ ...s.patches.at(-1) }, { short_name: null, founder_person_id: null, branch_gen: null, branch_order: null, origin_place: 'Tân Lập', country: '' }); // country: the Quốc gia field saves with the form (unchanged)
    assert.deepStrictEqual(s.errors, []);
    await s.ctx.close();
  } finally { await b.close(); }
});

test('admin: Sửa tay reveals the overrides (↓ order, founder, branch generation); Về tự động clears them', { skip }, async () => {
  const b = await launch();
  try {
    const s = await open(b, { roles: { duong: 'admin' }, hash: '/duong/cai-dat-dong-ho' });
    await s.page.waitForSelector('#fclan');
    await orderTexts(s.page, 2);
    await s.page.check('#fclan [name=manual]');
    assert.equal(await s.page.isVisible('#clan-man'), true);
    await s.page.click('#clan-order [data-bid="Y3"] [data-dn]');
    assert.deepEqual(await orderTexts(s.page, 2), ['1. Chi Ông 2 Dương Văn Hai', '2. Chi Ông 1 Dương Văn Một']);
    assert.match(await s.page.textContent('.clan-h'), /Sửa tay/);
    await s.page.click('#fclan button:not([type=button])');
    await s.page.waitForFunction(() => /Đã lưu chi và thủy tổ/.test(document.body.innerText));
    assert.deepEqual(s.patches.at(-1).branch_order, ['X3', 'Y3']);
    await s.page.waitForSelector('#fclan [name=manual]:checked', { state: 'attached' });
    await s.page.selectOption('#fclan [name=founder_person_id]', 'C');
    assert.match(await s.page.textContent('#clan-view'), /Thủy tổ\s*Đời 2 · Ông Dương Văn Con\s*Sửa tay/);
    await s.page.fill('#fclan [name=branch_gen]', '2');
    assert.deepEqual(await orderTexts(s.page, 1), ['1. Chi Ông Dương Văn Con']);
    await s.page.click('#clan-auto');
    assert.equal(await s.page.isHidden('#clan-man'), true);
    assert.deepEqual(await orderTexts(s.page, 2), ['1. Chi Ông 1 Dương Văn Một', '2. Chi Ông 2 Dương Văn Hai']);
    await s.page.click('#fclan button:not([type=button])');
    await s.page.waitForFunction(() => /Đã lưu chi và thủy tổ/.test(document.body.innerText));
    const last = s.patches.at(-1);
    assert.deepEqual([last.short_name, last.founder_person_id, last.branch_gen, last.branch_order], [null, null, null, null], 'back to automatic');
    assert.deepStrictEqual(s.errors, []);
    await s.ctx.close();
  } finally { await b.close(); }
});

test('member: Chi và thủy tổ is read-only (no form, no ↑↓) and shows the automatic values', { skip }, async () => {
  const b = await launch();
  try {
    const s = await open(b, { roles: { duong: 'member' }, hash: '/duong/cai-dat-dong-ho' });
    await s.page.waitForSelector('#clan');
    await orderTexts(s.page, 2);
    assert.equal(await s.page.locator('#fclan').count(), 0);
    assert.equal(await s.page.locator('#clan [data-up], #clan [data-dn]').count(), 0);
    const t = await s.page.textContent('#clan');
    assert.match(t, /Dương · Phú Mỹ/); assert.match(t, /chia nhánh ở đời 3/); assert.match(t, /Tự động/);
    await s.ctx.close();
  } finally { await b.close(); }
});

test('two families named Họ Dương: chips on the combined Giỗ page say "Dương · Phú Mỹ" and "Dương · An Lạc"', { skip }, async () => {
  const b = await launch();
  try {
    const s = await open(b, { roles: { duong: 'member', anlac: 'member' }, hash: '/tat-ca/gio' });
    await s.page.waitForFunction(() => document.querySelectorAll('.gior').length === 2);
    const chips = await s.page.locator('.gior .tag-n').allTextContents();
    assert.deepEqual([...chips].sort(), ['Dương · An Lạc', 'Dương · Phú Mỹ']);
    if (SHOTS) await s.page.screenshot({ path: path.join(SHOTS, 'clan-chips-390.png') });
    assert.deepStrictEqual(s.errors, []);
    await s.ctx.close();
  } finally { await b.close(); }
});
