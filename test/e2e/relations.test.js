// E2E: relationships in the browser. Needs a database (GP_TEST_DATABASE_URL); it runs in its own schema (e2e_relations):
//   GP_TEST_DATABASE_URL=postgres://.../<scratch> [GP_E2E_CHROME=/usr/bin/google-chrome] NODE_PATH=<dir with playwright>
//   npm run test:e2e (from giapha/server). GP_SHOT_DIR=<dir> also writes the screenshots of the design review.
// Covers: add spouse #3 (step 1-3, new person), add child to the second wife, relative couple (neutral note),
// own-ancestor link blocked with the chain, edit + remove, private link hidden from a guest, no Hán on the type picker.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const SHOT = process.env.GP_SHOT_DIR || '';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !/scratch|e2e|giapha_ci/.test(DB_URL) ? 'GP_TEST_DATABASE_URL must name a scratch database (contains "scratch", "e2e" or giapha_ci)'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const OWNER = 'owner-rel-e2e@test.local';
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'test', 'fixtures', 'copy-shaped.json'), 'utf8'));

test.before(async () => {
  if (skip) return;
  // own schema: this file's rows are the only ones it sees (see _isolated-db.js); the copy-shaped fixture goes in as 'duong'
  iso = isolatedDb(DB_URL, 'relations');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', '..', 'server', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'migrations', f), 'utf8'));
  // P009 has a missing parent on purpose in the fixture (a backfill anomaly); it would become the first root of the tree
  for (const r of FIX.filter((x) => x.id !== 'P009')) await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [r.id, 'duong', r.data, 'e2e']);
  const B = require('../../server/scripts/rel-backfill');
  await B.apply(pool, await B.plan(pool, await B.loadFamily(pool, 'duong')), { backupDir: fs.mkdtempSync(require('os').tmpdir() + '/rele2e-'), by: 'e2e' });
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e','duong','owner','active') on conflict (family_id, email) do nothing", [OWNER]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close();
  srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function ownerPage(width = 390, scheme = 'light') {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage();
  return { ctx, page, cookie: pair };
}
async function openProfile(page, id) {
  await page.goto(base + '/#person/' + id);
  await page.waitForSelector('nav.ptabs', { timeout: 10000 });
  // Quan hệ is on the Thông tin tab (no separate tab)
  await page.waitForSelector('section.relsec', { timeout: 10000 });
}
const txt = (page) => page.locator('#main').innerText();
// Quan hệ row ⋯ (editors) -> one menu item
async function openRelMenu(page, name, item) {
  await page.getByRole('button', { name: `Tùy chọn cho ${name}` }).first().click();
  await page.locator('.menu [role=menuitem]', { hasText: item }).click();
}
async function addFlow(page, id, type) {
  await page.locator('button[data-rel-add]').click();
  await page.locator(`button[data-type="${type}"]`).click();
}
const seq = async (page, ms = 250) => page.waitForTimeout(ms);

test('profile: Quan hệ section at phone width, no horizontal scroll, no Hán on the type picker', { skip }, async () => {
  const { ctx, page } = await ownerPage(390);
  try {
    await openProfile(page, 'P001');
    const t = await txt(page);
    assert.match(t, /Giả Ngọc Giao/); assert.match(t, /Giả Thanh Huệ/); assert.match(t, /Vợ thứ 2/);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, 'no horizontal page scroll: ' + sw);
    await page.locator('button[data-rel-add]').click();
    const types = await page.locator('.rel-types').innerText();
    assert.doesNotMatch(types, /[㐀-鿿豈-﫿]/, 'type picker has no Hán characters');
    assert.equal(await page.locator('.rel-types button').count(), 4);
    if (SHOT) await page.locator('.rel-sheet').screenshot({ path: path.join(SHOT, 'add-rel-1-390.png') });
  } finally { await ctx.close(); }
});

test('add spouse #3 (step 1-3, new person) shows in the profile in order; a second wife gets a child', { skip }, async () => {
  const { ctx, page } = await ownerPage(390);
  try {
    await openProfile(page, 'P001');
    await addFlow(page, 'P001', 'spouse');
    await page.locator('#rel-q').fill('Đoàn Thị Thu');
    // "Tạo người mới" opens the person form, prefilled (wife: sex opposite); the relation sheet follows the save
    await page.locator('button[data-newp]').click();
    await page.waitForSelector('#add-f input[name=name]');
    assert.equal(await page.locator('#add-f select[name=sex]').inputValue(), 'f', 'prefilled sex');
    await page.locator('#add-f input[name=name]').fill('Đoàn Thị Thu');
    await page.locator('#add-f button[type=submit]').click();
    await page.waitForSelector('.rel-sheet #ys', { timeout: 8000 });
    await page.locator('button[data-kind="cuoi"]').click();
    await page.locator('#ys').fill('1995'); await page.locator('#ord').fill('3');
    await page.locator('button[data-save]').click();
    // the relation sheet's own heading: the person form also shows a 'Đã lưu' toast before the relation is saved
    await page.waitForFunction(() => document.querySelector('.rel-sheet h2')?.textContent === 'Đã lưu', null, { timeout: 8000 });
    await page.locator('button[data-x]').first().click();
    await openProfile(page, 'P001');
    const t = await txt(page);
    assert.match(t, /Đoàn Thị Thu/); assert.match(t, /Vợ thứ 3 · cưới 1995/);
    // second wife (Giả Thanh Huệ, P003) gets a son
    await openProfile(page, 'P003');
    await addFlow(page, 'P003', 'child');
    await page.locator('#rel-q').fill('Vương Thị Quý');
    await page.locator('button[data-newp]').click();
    await page.waitForSelector('#add-f input[name=name]');
    await page.locator('#add-f input[name=name]').fill('Vương Thị Quý');
    await page.locator('#add-f select[name=sex]').selectOption('m');
    await page.locator('#add-f button[type=submit]').click();
    await page.waitForSelector('.rel-sheet #ord', { timeout: 8000 });
    await page.locator('button[data-kind="ruot"]').click();
    await page.locator('#ord').fill('1');
    await page.locator('button[data-save]').click();
    // the relation sheet's own heading: the person form also shows a 'Đã lưu' toast before the relation is saved
    await page.waitForFunction(() => document.querySelector('.rel-sheet h2')?.textContent === 'Đã lưu', null, { timeout: 8000 });
    await page.locator('button[data-x]').first().click();
    await openProfile(page, 'P003');
    assert.match(await txt(page), /Vương Thị Quý/);
  } finally { await ctx.close(); }
});

test('relative couple: a neutral note, not a block; own-ancestor link blocked with the chain', { skip }, async () => {
  const { ctx, page } = await ownerPage(390);
  try {
    await openProfile(page, 'P004');
    await addFlow(page, 'P004', 'spouse');
    await page.locator('#rel-q').fill('Giả Mỹ Nhàn');
    await page.locator('.calm[data-pick="P005"]').click();
    await page.locator('button[data-next]').click();
    await page.locator('button[data-kind="ban_doi"]').click();
    await page.locator('button[data-save]').click();
    // the relation sheet's own heading: the person form also shows a 'Đã lưu' toast before the relation is saved
    await page.waitForFunction(() => document.querySelector('.rel-sheet h2')?.textContent === 'Đã lưu', null, { timeout: 8000 });
    assert.match(await txt(page), /anh chị em trong cây/);
    await page.locator('button[data-x]').first().click();

    await openProfile(page, 'P001');
    await addFlow(page, 'P001', 'parent');
    await page.locator('#rel-q').fill('Giả Công Trí');
    await page.locator('.calm[data-pick="P007"]').click();
    await page.locator('button[data-next]').click();
    await page.locator('button[data-save]').click();
    await page.waitForSelector('.err', { timeout: 8000 });
    const err = await page.locator('.err').innerText();
    assert.match(err, /đã là tổ tiên của/);
    assert.match(err, /Giả Công Trí/);
  } finally { await ctx.close(); }
});

test('a relation row opens that person\'s profile; ⋯ holds Sửa quan hệ; no chevron beside ⋯', { skip }, async () => {
  const { ctx, page } = await ownerPage(390);
  try {
    await openProfile(page, 'P001');
    const box = page.locator('.relrows .calm-row', { hasText: 'Giả Ngọc Giao' }).first();
    const row = box.locator('a.calm');
    assert.equal(await row.evaluate((a) => !!a.querySelector('button, a')), false, 'no nested interactive element in the row');
    assert.equal(await row.locator('svg.calm-c').count(), 0, 'no chevron on a row that has ⋯');
    assert.equal(await page.locator('.relrows a.calm[data-rel-edit], .relrows button.calm').count(), 0, 'rows are links');
    if (SHOT) await page.screenshot({ path: path.join(SHOT, 'quanhe-more-390.png'), fullPage: false, clip: await page.locator('section.relsec').boundingBox() });
    await box.getByRole('button', { name: 'Tùy chọn cho Giả Ngọc Giao' }).click();
    await page.waitForSelector('.menu [role=menuitem]');
    assert.deepEqual(await page.locator('.menu [role=menuitem]').allInnerTexts(), ['Sửa quan hệ', 'Xem trên cây', 'Xóa quan hệ']);
    if (SHOT) await page.screenshot({ path: path.join(SHOT, 'quanhe-menu-390.png') });
    await page.locator('.menu [role=menuitem]', { hasText: 'Sửa quan hệ' }).click();
    await page.waitForSelector('.rel-sheet[open]');
    await page.keyboard.press('Escape');
    await openProfile(page, 'P001');
    await page.locator('.relrows a.calm', { hasText: 'Giả Ngọc Giao' }).first().click();
    await page.waitForFunction(() => /person\//.test(location.hash) && !/P001$/.test(location.hash), null, { timeout: 8000 });
    assert.equal(await page.locator('.rel-sheet[open]').count(), 0, 'tapping the name does not open the edit sheet');
  } finally { await ctx.close(); }
});

test('edit a spouse kind, then remove the relation after a confirm (history kept)', { skip }, async () => {
  const { ctx, page } = await ownerPage(390);
  try {
    await openProfile(page, 'P001');
    await openRelMenu(page, 'Giả Ngọc Giao', 'Sửa quan hệ');
    await page.waitForSelector('.rel-sheet');
    if (SHOT) await page.locator('.rel-sheet').screenshot({ path: path.join(SHOT, 'edit-rel-390.png') });
    await page.locator('.rel-sheet button[data-kind="vo_le"]').click();
    await page.locator('.rel-sheet button[data-save]').click();
    await page.waitForFunction(() => !document.querySelector('.rel-sheet')?.open, null, { timeout: 8000 }).catch(() => {});
    await openProfile(page, 'P001');
    assert.match(await txt(page), /Giả Ngọc Giao[\s\S]*vợ lẽ|vợ lẽ/);
    // remove: row ⋯ Xóa quan hệ opens the shared destructive confirm
    await openRelMenu(page, 'Giả Ngọc Giao', 'Xóa quan hệ');
    await page.locator('dialog#dcf [data-rds-confirm]').click();
    await page.waitForFunction(() => !document.querySelector('dialog#dcf'), null, { timeout: 8000 }); // closes once the removal is saved
    await openProfile(page, 'P001');
    // the spouse row is gone; a child's line may still name her as mother (parent links are separate records)
    const spouseRows = await page.locator('.relrows a.calm', { hasText: 'Giả Ngọc Giao' }).count();
    assert.equal(spouseRows, 0, 'removed spouse no longer listed');
    const h = await pool.query("select count(*)::int n from history where person_id='P001' and new_value::text like '%Gỡ quan hệ%' or old_value::text like '%Gỡ quan hệ%'");
    assert.ok(h.rows[0].n >= 1, 'history keeps the removal');
  } finally { await ctx.close(); }
});

test('pedigree: a repeated ancestor is a link to where it was drawn; the tree shows the wives in order', { skip }, async () => {
  const { ctx, page, cookie } = await ownerPage(1280);
  try {
    // a child of two siblings (P004 and P005 share the grandparent P001 on both sides)
    const id = 'Ne2epedi01';
    const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b) });
    const o = await post('/api/ops', { family: 'duong', ops: [{ op_id: 'e2e-' + id, id, fields: { name: 'Dương Văn Chắt', sex: 'm', gen: 5, born: '2001' }, ts: Date.now() }] });
    assert.equal(o.status, 200);
    await S_sync_wait(page, base);
    for (const parent of ['P004', 'P005']) {
      const r = await post('/api/relations', { family: 'duong', op_id: 'e2e-pc-' + parent + id, action: 'add', kind: 'parent_child', parent_id: parent, child_id: id, pc_kind: 'ruot' });
      assert.equal(r.status, 200, await r.text());
    }
    await openProfile(page, id);
    const t = await txt(page);
    assert.match(t, /Tổ tiên/);
    assert.match(t, /↗ xem ở nhánh/);
    if (SHOT) await page.locator('section', { hasText: 'Tổ tiên' }).screenshot({ path: path.join(SHOT, 'pedigree-collapse-1280.png') });
    await page.goto(base + '/#tree/@P001');
    await page.waitForSelector('.tdesk svg.tchart', { timeout: 10000 });
    await page.waitForFunction(() => /Giả Văn An/.test(document.querySelector('.tdesk svg.tchart')?.textContent || ''), null, { timeout: 8000 });
    const tree = await page.locator('.tdesk svg.tchart').textContent();
    assert.match(tree, /Vợ: |Chồng: /);
    if (SHOT) await page.locator('.tdesk svg.tchart').screenshot({ path: path.join(SHOT, 'tree-2-wives-1280.png') });
    if (SHOT) { await openProfile(page, 'P001'); await page.locator('section.relsec').screenshot({ path: path.join(SHOT, 'quanhe-1280.png') }); }
  } finally { await ctx.close(); }
});

async function S_sync_wait(page, base) { void page; void base; await new Promise((r) => setTimeout(r, 400)); }

test('private link: members see it, a guest does not', { skip }, async () => {
  await pool.query("insert into couple (family_id, a_id, b_id, kind, private, note) values ('duong','P006','P008','khac', true, 'test')").catch(() => {});
  const { ctx, page } = await ownerPage(390);
  try {
    await openProfile(page, 'P006');
    assert.match(await txt(page), /riêng tư/);
  } finally { await ctx.close(); }
  const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gp = await guest.newPage();
  try {
    await gp.goto(base + '/#person/P006');
    await gp.waitForSelector('#main', { timeout: 10000 });
    await seq(gp, 800);
    assert.doesNotMatch(await gp.locator('#main').innerText(), /riêng tư/);
    assert.equal(await gp.locator('button[data-rel-more]').count(), 0);
  } finally { await guest.close(); }
  await pool.query("delete from couple where family_id='duong' and private = true and note='test'");
});

// Design shots for the review (GP_SHOT_DIR): full profile at 390 light and dark, 1280, and the tree with two wives.
test('design shots: Quan hệ full page (390 light and dark, 1280) and the tree with two wives', { skip: skip || !SHOT }, async () => {
  for (const [width, scheme, file] of [[390, 'light', 'quanhe-390.png'], [390, 'dark', 'quanhe-390-dark.png'], [1280, 'light', 'quanhe-1280.png']]) {
    const { ctx, page } = await ownerPage(width, scheme);
    try {
      await openProfile(page, 'P001');
      await page.waitForFunction(() => document.querySelectorAll('.calm').length > 0);
      await page.screenshot({ path: path.join(SHOT, file), fullPage: true });
    } finally { await ctx.close(); }
  }
  const { ctx, page } = await ownerPage(1280);
  try {
    await page.goto(base + '/#tree/@P001');
    await page.waitForSelector('.tdesk svg.tchart', { timeout: 10000 });
    await page.waitForFunction(() => /Giả Văn An/.test(document.querySelector('.tdesk svg.tchart')?.textContent || ''), null, { timeout: 8000 });
    await page.locator('.tdesk svg.tchart').screenshot({ path: path.join(SHOT, 'tree-2-wives-1280.png') });
  } finally { await ctx.close(); }
});
