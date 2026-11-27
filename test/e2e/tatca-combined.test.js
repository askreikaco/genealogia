// E2E: "Tất cả dòng họ" with two families (duong: owner, dong-a: admin). Combined inbox and members with family chips and
// per-family actions; the person form's Dòng họ field; map clusters of mixed families and filter options after a sync;
// the book's update bar. Mocked /api (no database). Needs playwright and Chrome:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/tatca-combined.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { seedPlan, seedPersons } = require('./_book-mock');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !chromium ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;
const WEB = path.join(__dirname, '..', '..', 'web');
const SHOTS = process.env.GP_SHOT_DIR || '';

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const FAMS = {
  duong: { id: 'duong', slug: 'duong', name: 'Họ Dương', han: '楊', visibility: 'public', place: 'Củ Chi', people: 3, generations: 3 },
  'dong-a': { id: 'dong-a', slug: 'dong-a', name: 'Họ Nguyễn', han: '阮', visibility: 'public', place: 'Huế', people: 2, generations: 2 },
};
const ROLES = { duong: 'owner', 'dong-a': 'admin' };
const PERSONS0 = {
  duong: [
    P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0, place: 'Hóc Môn' }),
    P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925', place: 'Củ Chi' }),
    P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 2, born: '1950' }),
  ],
  'dong-a': [
    P('N1', { name: 'Nguyễn Văn Xa', sex: 'm', gen: 3, thu: '1', order: 0, born: '1900' }),
    P('N2', { name: 'Nguyễn Thị Hoa', sex: 'f', gen: 4, thu: '2', parent: 'N1', order: 1, born: '1930', place: 'Củ Chi' }),
  ],
};
const sug = (id, fam, personId, personName, changes) => ({ id, fam, status: 'pending', person_id: personId, is_new: false, person_name: personName,
  changes: changes.map((c) => ({ status: 'clean', current: '', ...c })), note: 'Góp ý thử', by_name: 'Khách ' + fam, by_contact: '',
  created_at: '2026-11-20T08:00:00.000Z', reviewed_by: null, reviewed_at: null, reason: null });
const MEMBER = (id, status, role, name, personId) => ({ id, email: `${name.replace(/\s/g, '').toLowerCase()}@test.local`, name, role, status,
  person_id: personId || null, person_name: personId ? 'Dương Văn Cha' : null, relation: null, rel_person_id: null, rel_name: null, created_at: '2026-11-19T08:00:00.000Z' });

// State of the mocked server for one test: suggestions, members, persons changed since the first pull, calls received.
function fresh() {
  return {
    persons: JSON.parse(JSON.stringify(PERSONS0)), changes: {},
    sugs: { duong: [sug(101, 'duong', 'PA', 'Dương Văn Cha', [{ field: 'job', current: '', proposed: 'Thợ may' }])],
      'dong-a': [sug(201, 'dong-a', 'N2', 'Nguyễn Thị Hoa', [{ field: 'place', current: 'Củ Chi', proposed: 'Huế' }])] },
    members: { duong: [MEMBER(1001, 'active', 'member', 'Chị Lan'), MEMBER(1002, 'pending', 'member', 'Anh Bình', 'PA')],
      'dong-a': [MEMBER(2001, 'active', 'editor', 'Chú Minh'), MEMBER(2002, 'pending', 'member', 'Cô Hạnh')] },
    calls: [],
  };
}

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

// A stand-in for MapLibre (the CDN is blocked here): it counts the maps made and keeps the GeoJSON and the layers it is given.
const MAP_STUB = `(() => {
  window.__maps = []; window.__fc = null; window.__layers = [];
  class Map {
    constructor() { window.__maps.push(this); this.src = {}; }
    on(ev, fn) { if (ev === 'load') setTimeout(() => fn(), 0); return this; }
    addControl() {} resize() {} remove() {} fitBounds() {} flyTo() {} getZoom() { return 8; }
    getCanvas() { return { style: {} }; }
    addSource(id, s) { this.src[id] = { setData: (d) => { if (id === 'pp') window.__fc = d; } }; if (id === 'pp') window.__fc = s.data; }
    getSource(id) { return this.src[id]; }
    addLayer(l) { window.__layers.push(l); }
  }
  class NavigationControl {}
  class Popup { setLngLat() { return this; } setHTML() { return this; } addTo() { return this; } remove() {} }
  window.maplibregl = { Map, NavigationControl, Popup };
})();`;

// A sync redraws the page (the list is drawn again from the store): wait for the state, let the redraws end, wait again.
async function stable(page, fn, arg) {
  await page.waitForFunction(fn, arg); await page.waitForTimeout(400); await page.waitForFunction(fn, arg);
}
// Waits until the families are pulled (the sync indicator says so): every count below depends on it.
async function settled(page) { await page.waitForFunction(() => document.querySelector('#sync')?.textContent.includes('Đã đồng bộ')); }

async function open(browser, { st, width, hash, map = false }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: width < 672 ? 844 : 800 }, deviceScaleFactor: 2 });
  if (map) await ctx.addInitScript(MAP_STUB);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', async (route, req) => {
    const u = new URL(req.url()); const p = u.pathname; const fam = u.searchParams.get('family');
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    if (req.method() !== 'GET') st.calls.push({ method: req.method(), path: p, family: fam, body });
    if (p === '/api/me') return json({ editor: null, role: 'member', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: true, roles: ROLES });
    if (p === '/api/families') return json({ items: Object.values(FAMS).map((f) => ({ ...f, my_role: ROLES[f.id] || null })) });
    if (p.startsWith('/api/families/')) { const f = FAMS[decodeURIComponent(p.split('/').pop())]; return f ? json({ ...f, my_role: ROLES[f.id] || null }) : json({ error: 'Không tìm thấy dòng họ.' }, 404); }
    if (p === '/api/book/outline') return json({ family: fam || 'duong', role: 'owner', v: 1, plan: await seedPlan('') }); // the book in the frame
    if (p === '/api/persons' && u.searchParams.get('ids') !== null) { // the book asks for persons by id
      const ids = u.searchParams.get('ids').split(',').filter(Boolean);
      return json({ items: seedPersons().filter((x) => ids.includes(x.id)), next_since: 1, role: 'owner', family: 'duong' });
    }
    if (p === '/api/persons') {
      const since = Number(u.searchParams.get('since'));
      const items = since === 0 ? st.persons[fam] : (st.changes[fam] || []);
      if (since !== 0) st.changes[fam] = [];
      return json({ items, next_since: since === 0 ? items.length : since + items.length + 1 });
    }
    if (p === '/api/suggestions') {
      const status = u.searchParams.get('status') || 'pending';
      const items = (st.sugs[fam] || []).filter((s) => s.status === status);
      return json({ items, counts: { pending: (st.sugs[fam] || []).filter((s) => s.status === 'pending').length, approved: 0, rejected: 0, withdrawn: 0 } });
    }
    const sm = /^\/api\/suggestions\/(\d+)\/(approve|reject)$/.exec(p);
    if (sm && req.method() === 'POST') {
      for (const list of Object.values(st.sugs)) for (const s of list) if (s.id === Number(sm[1])) s.status = sm[2] === 'approve' ? 'approved' : 'rejected';
      return json({ ok: true });
    }
    if (p === '/api/members') {
      const items = st.members[fam] || [];
      return json({ items, counts: { pending: items.filter((m) => m.status === 'pending').length }, me: 'owner', family: fam });
    }
    const mm = /^\/api\/members\/(\d+)\/(approve|reject|role|remove)$/.exec(p);
    if (mm && req.method() === 'POST') {
      for (const list of Object.values(st.members)) for (const m of list) if (m.id === Number(mm[1])) { if (mm[2] === 'approve') m.status = 'active'; if (mm[2] === 'reject') m.status = 'removed'; }
      return json({ ok: true });
    }
    if (p === '/api/ops' && req.method() === 'POST') return json({ applied: body.ops.map((o) => o.op_id), rejected: [] });
    if (p === '/api/suggest' && req.method() === 'POST') return json({ id: 999, receipt: 'r' });
    if (p === '/api/me/prefs') return json({ prefs: {} });
    return json({});
  });
  await page.goto(base + '/#' + hash);
  await page.waitForSelector('#main', { state: 'attached' });
  await settled(page);
  return { ctx, page, errors };
}

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }); };
const launch = () => chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

test('combined inbox: both families\' items with chips; the status and Dòng họ filters; approve goes to the row\'s family', { skip }, async () => {
  const b = await launch();
  try {
    const st = fresh();
    const { ctx, page, errors } = await open(b, { st, width: 390, hash: '/tat-ca/review' });
    // a sync redraws the page: wait for the settled list (both families' chips and the count)
    await stable(page, () => document.querySelectorAll('#rlist .rv .tag-n').length === 2);
    const chips = await page.locator('#rlist .rv .tag-n').allTextContents();
    assert.deepStrictEqual(chips.sort(), ['Dương', 'Nguyễn']);
    await shot(page, 'duyet-tatca-390.png');
    // Dòng họ filter in the sheet (phone): only the Nguyễn card remains; the tag removes it
    await page.click('[data-fp]');
    await page.selectOption('#rfamp', 'dong-a');
    await page.waitForFunction(() => document.querySelectorAll('#rlist .rv').length === 1);
    assert.match(await page.textContent('.ltags'), /Dòng họ: Nguyễn/);
    await page.keyboard.press('Escape');
    await page.click('.ltags .tag.remove');
    await page.waitForFunction(() => document.querySelectorAll('#rlist .rv').length === 2);
    // approve the Nguyễn suggestion: the request names its own suggestion (201), the card leaves the pending list
    const card = page.locator('#rlist .rv', { has: page.locator('.tag-n', { hasText: 'Nguyễn' }) });
    await card.locator('[data-rv="approve"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#rlist .rv').length === 1);
    const approved = st.calls.filter((c) => /approve$/.test(c.path));
    assert.deepStrictEqual(approved.map((c) => c.path), ['/api/suggestions/201/approve']);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('combined inbox: status filter (approved) lists both families\' approved items', { skip }, async () => {
  const b = await launch();
  try {
    const st = fresh(); st.sugs.duong[0].status = 'approved'; st.sugs['dong-a'][0].status = 'approved';
    const { ctx, page, errors } = await open(b, { st, width: 1280, hash: '/tat-ca/review' });
    await page.selectOption('#rst', 'approved');
    await page.waitForFunction(() => document.querySelectorAll('#rlist .rv').length === 2);
    assert.match(await page.textContent('.ltags'), /Đã duyệt/);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('combined members: pending and members of both families with chips; approve and role act on the row\'s family', { skip }, async () => {
  const b = await launch();
  try {
    const st = fresh();
    const { ctx, page, errors } = await open(b, { st, width: 390, hash: '/tat-ca/members' });
    await page.waitForFunction(() => document.querySelectorAll('.mem-list .mrow').length === 2 && document.querySelectorAll('.msec .pq').length === 2);
    const pendChips = await page.locator('.msec .pq .tag-n').allTextContents();
    assert.deepStrictEqual(pendChips.sort(), ['Dương', 'Nguyễn']);
    assert.equal(await page.locator('.mem-list .mrow .tag-n').count(), 2);
    await shot(page, 'thanh-vien-tatca-390.png');
    // approve the Nguyễn join request: POST /api/members/2002/approve?family=dong-a
    const nguyen = page.locator('.msec .pq', { has: page.locator('.tag-n', { hasText: 'Nguyễn' }) });
    await nguyen.locator('[data-mact="approve"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.msec .pq').length === 1);
    const ap = st.calls.filter((c) => /approve$/.test(c.path));
    assert.deepStrictEqual(ap.map((c) => [c.path, c.family]), [['/api/members/2002/approve', 'dong-a']]);
    // the Dương family filter (sheet): only its rows; Dòng họ select is in the sheet
    await page.click('[data-fp]');
    await page.selectOption('#mfamp2', 'duong');
    await page.waitForFunction(() => document.querySelectorAll('.mem-list .mrow').length === 1);
    await page.keyboard.press('Escape');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('members: the role change of a Nguyễn member is sent to dong-a', { skip }, async () => {
  const b = await launch();
  try {
    const st = fresh();
    const { ctx, page, errors } = await open(b, { st, width: 1280, hash: '/tat-ca/members' });
    await page.waitForSelector('.mem-list .mrow');
    const row = page.locator('.mem-list .mrow', { has: page.locator('.tag-n', { hasText: 'Nguyễn' }) });
    await row.locator('[data-mmenu]').click();
    await page.click('text=Đổi vai trò');
    await page.selectOption('#mrs', 'member');
    await page.locator('dialog[open] button.btn:not(.gh)').click();
    await page.waitForFunction(() => true);
    const role = st.calls.filter((c) => /\/role$/.test(c.path));
    assert.deepStrictEqual(role.map((c) => [c.path, c.family, c.body.role]), [['/api/members/2001/role', 'dong-a', 'member']]);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('person form in "Tất cả": Dòng họ is the first field, defaults to the last used family, and re-scopes the parent picker', { skip }, async () => {
  const b = await launch();
  try {
    const st = fresh();
    // the last family used on this device is dong-a (opened first, then "Tất cả")
    const { ctx, page, errors } = await open(b, { st, width: 390, hash: '/dong-a/list' });
    await page.waitForSelector('.cards .pi-card');
    await page.goto(base + '/#/tat-ca/them');
    await page.waitForSelector('#fpfam');
    assert.equal(await page.locator('#fpform > *').first().locator('#fpfam').count(), 1);
    assert.equal(await page.inputValue('#fpfam'), 'dong-a');
    assert.equal(await page.locator('#fpfam option').count(), 2);
    assert.equal(await page.locator('.famrs').count(), 0); // no family picker step
    await shot(page, 'form-tatca-390.png');
    // parent search: Dương's people are not offered in Nguyễn
    await page.fill('.pk-q', 'Dương');
    await page.waitForSelector('.pk-list:not([hidden]) .sub', { timeout: 3000 }).catch(() => {});
    assert.equal(await page.locator('.pk-list [data-pk]').count(), 0);
    // switch to Dương: its people are offered
    await page.selectOption('#fpfam', 'duong');
    await page.fill('.pk-q', 'Dương');
    await page.waitForSelector('.pk-list [data-pk]');
    const hits = await page.locator('.pk-list [data-pk]').allTextContents();
    assert.ok(hits.some((x) => /Dương Văn Cha/.test(x)));
    await page.click('.pk-list [data-pk]');
    assert.equal(await page.locator('.pk-chosen .pk-name').count(), 1);
    // switching back clears the parent: it belongs to Dương
    await page.selectOption('#fpfam', 'dong-a');
    assert.equal(await page.locator('.pk-chosen').count(), 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('person form in "Tất cả": a new person is saved into the family chosen on the form', { skip }, async () => {
  const b = await launch();
  try {
    const st = fresh();
    const { ctx, page, errors } = await open(b, { st, width: 1280, hash: '/tat-ca/them' });
    await page.waitForSelector('#fpfam');
    await page.selectOption('#fpfam', 'dong-a');
    await page.fill('[name=name]', 'Nguyễn Văn Mới');
    await page.click('#fpsave');
    await page.waitForFunction(() => location.hash.includes('/dong-a/person/'));
    // the outbox POST follows the local write (sync() is not awaited by edit): wait for it, then assert
    for (let i = 0; i < 100 && !st.calls.some((c) => c.path === '/api/ops'); i++) await new Promise((r) => setTimeout(r, 100));
    const ops = st.calls.filter((c) => c.path === '/api/ops');
    assert.equal(ops.length, 1);
    assert.equal(ops[0].body.family, 'dong-a');
    assert.equal(ops[0].body.ops[0].family, 'dong-a');
    assert.equal(ops[0].body.ops[0].fields.name, 'Nguyễn Văn Mới');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('map: a cluster with two families is neutral; single-family clusters keep their colour; legend says "Nhiều dòng họ"', { skip }, async () => {
  const b = await launch();
  try {
    const st = fresh();
    const { ctx, page, errors } = await open(b, { st, width: 1280, hash: '/tat-ca/map', map: true });
    await page.waitForFunction(() => window.__fc && window.__fc.features.length >= 2);
    const feats = await page.evaluate(() => window.__fc.features.map((f) => f.properties));
    const mixed = feats.filter((f) => f.n === 2); // Củ Chi: Dương Văn Cha and Nguyễn Thị Hoa
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0].fi, -1);
    const solo = feats.find((f) => f.n === 1 && f.fi === 0); // Hóc Môn: Ông Tổ, Họ Dương (first in scope)
    assert.ok(solo);
    const expr = await page.evaluate(() => window.__layers.find((l) => l.id === 'c').paint['circle-color']);
    assert.equal(expr[expr.length - 1], '#8d8d8d'); // the neutral default of the match
    assert.equal(expr[3], '#0f62fe'); // family 0 keeps its colour (key 0 -> its palette colour)
    assert.match(await page.textContent('.legend'), /Nhiều dòng họ/);
    await shot(page, 'map-mixed-1280.png');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('map: after a sync the Đời filter gains the new generation; the map instance is not recreated', { skip }, async () => {
  const b = await launch();
  try {
    const st = fresh();
    const { ctx, page, errors } = await open(b, { st, width: 1280, hash: '/duong/map', map: true });
    await page.click('[data-fp]'); // the filter sheet holds the Chi and Đời lists
    await page.waitForSelector('#mgen');
    assert.equal(await page.locator('#mgen option', { hasText: /^8$/ }).count(), 0);
    assert.equal(await page.evaluate(() => window.__maps.length), 1);
    // a new person of generation 8 comes in from the server
    st.changes.duong = [P('N8', { name: 'Dương Văn Tám', sex: 'm', gen: 8, thu: '1', parent: 'K1', order: 1, place: 'Củ Chi' })];
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => [...document.querySelectorAll('#mgen option')].some((o) => o.textContent === '8'));
    assert.equal(await page.evaluate(() => window.__maps.length), 1);
    await page.click('[data-fp]'); // a sync redraws the page and closes the sheet
    await page.selectOption('#mgen', '8');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#mcount')?.textContent.includes('1 người khớp'));
    assert.equal(await page.evaluate(() => window.__maps.length), 1);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('book: a change in the family after the book loaded shows "Có cập nhật — Tải lại"; reload clears it', { skip }, async () => {
  const b = await launch();
  try {
    const st = fresh();
    const { ctx, page, errors } = await open(b, { st, width: 390, hash: '/duong/book' });
    await page.waitForSelector('iframe.bookfr');
    assert.equal(await page.locator('.bkupd').count(), 0);
    st.changes.duong = [P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1926', place: 'Củ Chi' })];
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForSelector('.bkupd');
    assert.match(await page.textContent('.bkupd'), /Có cập nhật —\s*Tải lại/);
    assert.equal(await page.locator('iframe.bookfr').count(), 1); // the book is not reloaded by itself
    await shot(page, 'book-update-390.png');
    await page.click('#bkreload');
    await page.waitForFunction(() => document.querySelectorAll('.bkupd').length === 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});
