// E2E: the profile ⋯ (rowMenu, ctx 'prof') adds relatives in a legacy-relations family, the same way the list row ⋯ does.
//   legacy family        Quan hệ is read-only there, so the profile ⋯ shows Thêm cha / mẹ, Thêm con, Thêm anh chị em;
//                        "Thêm con" opens the search-first add flow (addflow.js) titled for the person.
//   relation-table fam.  unchanged: the profile ⋯ has no add-relative items (Quan hệ "＋ Thêm quan hệ" adds them).
// Invented names only. Mocked API, no database:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] node --test test/e2e/profile-add-relative.test.js
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
// the legacy data: parent links live on the person (data.parent), as in a legacy family
const PERSONS = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 1, born: '1950' }),
  P('K2', { name: 'Dương Thị Hai', sex: 'f', gen: 7, thu: '2', parent: 'PA', order: 2, born: '1952', died: '2001' }),
];
const PC = (id, parent, child, order) => ({ id, parent_id: parent, child_id: child, kind: 'ruot', birth_order: order, private: false });
const REL_LEGACY = { source: 'legacy', parent_child: [], couple: [] };
const REL_TABLE = { source: 'table', parent_child: [PC(1, 'PR', 'PA', 1), PC(2, 'PA', 'K1', 1), PC(3, 'PA', 'K2', 2)], couple: [] };
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

// An editor on the Dương family with the given relation source. log.errors: page errors.
async function open(browser, rel, hash) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const log = { errors: [] };
  page.on('pageerror', (e) => log.errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: 'Tester', role: 'editor', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: 'editor' } });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') {
      const since = u.searchParams.get('since'); const ids = u.searchParams.get('ids');
      if (ids) return json({ items: PERSONS.filter((x) => ids.split(',').includes(x.id)), rel });
      return json(since === '0' || since === null ? { items: PERSONS, next_since: 1, rel } : { items: [], next_since: Number(since), rel });
    }
    if (p === '/api/persons/candidates') return json({ items: [] });
    if (p === '/api/ops') { const b = req.postDataJSON(); return json({ applied: b.ops.map((o) => o.op_id), rejected: [] }); }
    if (p === '/api/events') return json({ items: [], stories: [] });
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + '/#/duong/' + hash);
  await page.waitForTimeout(400);
  return { page, ctx, log };
}

test('legacy family: the profile ⋯ shows Thêm cha / mẹ, Thêm con, Thêm anh chị em; Thêm con opens the search-first flow', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, log } = await open(b, REL_LEGACY, 'person/K1');
    await page.waitForSelector('button.ib[data-menu="K1"][data-menu-ctx="prof"]', { timeout: 10000 });
    await page.click('button.ib[data-menu="K1"][data-menu-ctx="prof"]');
    await page.waitForSelector('.menu', { timeout: 5000 });
    const labels = await page.locator('.menu [data-act]').allTextContents();
    assert.ok(labels.includes('Thêm con'), 'Thêm con is in the profile ⋯ (menu: ' + labels.join(' | ') + ')');
    assert.ok(labels.includes('Thêm anh chị em'), 'Thêm anh chị em is in the profile ⋯');
    assert.ok(labels.includes('Thêm cha / mẹ'), 'Thêm cha / mẹ is in the profile ⋯');
    // the menu does not repeat what the page shows
    assert.ok(!labels.includes('Sửa thông tin') && !labels.includes('Xem hồ sơ'), 'no Sửa / Xem hồ sơ in the profile ⋯');
    await page.click('.menu [data-act="child"][data-id="K1"]');
    // the search-first add flow (step 1): the search box, titled for this person
    await page.waitForSelector('#add-q', { timeout: 8000 });
    assert.match(await page.locator('.rel-head h2').first().textContent(), /Thêm con của Dương Văn Một/);
    await page.fill('#add-q', 'dương văn một');
    await page.waitForSelector('.add-res [data-pick="K1"]');
    assert.equal(log.errors.length, 0, 'no page errors: ' + log.errors.join('; '));
    await ctx.close();
  } finally { await b.close(); }
});

test('relation-table family: the profile ⋯ has no add-relative items (Quan hệ adds them), unchanged', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, log } = await open(b, REL_TABLE, 'person/K1');
    await page.waitForSelector('button.ib[data-menu="K1"][data-menu-ctx="prof"]', { timeout: 10000 });
    await page.click('button.ib[data-menu="K1"][data-menu-ctx="prof"]');
    await page.waitForSelector('.menu', { timeout: 5000 });
    const labels = await page.locator('.menu [data-act]').allTextContents();
    for (const l of ['Thêm con', 'Thêm anh chị em', 'Thêm cha / mẹ', 'Thêm vợ / chồng', 'Sửa thông tin']) {
      assert.ok(!labels.includes(l), `"${l}" is not in the profile ⋯ of a relation-table family`);
    }
    assert.ok(labels.includes('Liên kết với người ở cây khác'), 'the editor items remain');
    await page.keyboard.press('Escape');
    // Quan hệ keeps its own add: the "Thêm quan hệ" button is there for an editor
    await page.waitForSelector('[data-rel-add]', { timeout: 8000 });
    assert.equal(await page.locator('[data-rel-add]').count() > 0, true, 'Quan hệ "Thêm quan hệ" is present');
    assert.equal(log.errors.length, 0, 'no page errors: ' + log.errors.join('; '));
    await ctx.close();
  } finally { await b.close(); }
});
