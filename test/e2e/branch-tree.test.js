// E2E: "Tạo cây cho nhánh này" in the browser. Needs a database (GP_TEST_DATABASE_URL, own schema e2e_branch):
//   GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright> npm run test:e2e (from server/)
// GP_SHOT_DIR=<dir> also writes btree-create.png and btree-view.png (390 x 844). Invented names only.
// Covers: the owner opens the person's ⋯ menu, creates a branch (the sheet counts its people), the branch tree shows the
// branch's people live (a home edit shows at once), the home root shows "Có cây nhánh", a member of the home tree
// (not of the branch) does not see it, and delete keeps every person.
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

const HOME = 'bte2e';
const OWNER = 'owner-branch-e2e@test.local'; const MEM = 'member-branch-e2e@test.local';
const P = { root: 'Nbte2e-root', c1: 'Nbte2e-c1', sp: 'Nbte2e-sp', gc: 'Nbte2e-gc', other: 'Nbte2e-other' };
let base, pool, srv, browser, iso, BRANCH = null;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'branch');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility, color) values ($1,$1,'Họ Lâm Nhánh E2E','林','public','#2f5d8a')", [HOME]);
  const ins = (id, data) => pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, HOME, data, 'e2e']);
  await ins(P.root, { name: 'Lâm Văn Tổ E2E', sex: 'm', born: '1900', died: '1960' });
  await ins(P.c1, { name: 'Lâm Văn Hai E2E', sex: 'm', born: '1925', parent: P.root });
  await ins(P.sp, { name: 'Trần Thị Ba E2E', sex: 'f', born: '1928', spouse_of: P.c1 });
  await ins(P.gc, { name: 'Lâm Văn Tư E2E', sex: 'm', born: '1950', parent: P.c1 });
  await ins(P.other, { name: 'Nguyễn Văn Khác E2E', sex: 'm', born: '1930' });
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$3,'owner','active'), ($2,'Thành viên e2e',$3,'member','active')", [OWNER, MEM, HOME]);
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

async function page393(email, width = 390) {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  return { ctx, page: await ctx.newPage() };
}
const seq = (page, ms = 300) => page.waitForTimeout(ms);

test('owner creates a branch from the ⋯ menu; the branch tree shows its people live', { skip, timeout: 120000 }, async () => {
  const { ctx, page } = await page393(OWNER);
  try {
    await page.goto(`${base}/#/${HOME}/person/${P.root}`);
    await page.waitForSelector('nav.ptabs', { timeout: 15000 });
    await page.locator(`[data-menu="${P.root}"][data-menu-ctx="prof"]`).click();
    await page.locator('.rds-menu [role=menuitem]', { hasText: 'Tạo cây cho nhánh này' }).click();
    const sheet = page.locator('dialog.btree-sheet');
    await sheet.waitFor({ timeout: 10000 });
    await page.waitForFunction(() => /Cây sẽ có 4 người/.test(document.querySelector('dialog.btree-sheet [data-count]')?.textContent || ''), null, { timeout: 10000 });
    if (SHOT) await page.screenshot({ path: path.join(SHOT, 'btree-create.png') });
    await sheet.locator('input[name=name]').fill('Nhánh Lâm Tổ E2E');
    await sheet.locator('button[data-save]').click();
    // the app reloads the page after a create (membership list): read the id from the hash in the same wait
    const hit = await page.waitForFunction(() => { const m = /#\/(br-[0-9a-f]{10})\/tree/.exec(location.hash); return m ? m[1] : null; }, null, { timeout: 15000 });
    BRANCH = await hit.jsonValue();
    await page.waitForSelector('.btree-bar', { timeout: 15000 });
    const body = await page.locator('#main').innerText();
    assert.match(body, /Cây nhánh/);
    for (const n of ['Lâm Văn Tổ E2E', 'Lâm Văn Hai E2E', 'Trần Thị Ba E2E', 'Lâm Văn Tư E2E']) assert.ok(body.includes(n), `branch shows ${n}`);
    assert.ok(!body.includes('Nguyễn Văn Khác E2E'), 'a person outside the branch is not shown');
    // a home edit shows in the branch at once: rename the grandchild at home, reload the branch
    await pool.query("update persons set data = jsonb_set(data, '{name}', '\"Lâm Văn Tư Đổi E2E\"'), version = nextval('persons_version') where id = $1", [P.gc]);
    await page.goto(`${base}/#/${BRANCH}/tree`);
    await page.reload(); // a fresh load: the membership list and the people of the branch
    await page.waitForFunction(() => document.querySelector('#main')?.innerText.includes('Lâm Văn Tư Đổi E2E'), null, { timeout: 15000 });
    if (SHOT) await page.screenshot({ path: path.join(SHOT, 'btree-view.png') });
    // the home root shows the link to its branch
    await page.goto(`${base}/#/${HOME}/person/${P.root}`);
    await page.reload();
    await page.waitForSelector('nav.ptabs', { timeout: 15000 });
    await page.waitForFunction(() => /Có cây nhánh/.test(document.querySelector('#main')?.innerText || ''), null, { timeout: 15000 });
  } finally { await ctx.close(); }
});

test('a home member who is not in the branch does not see it; the branch is private to its members', { skip, timeout: 120000 }, async () => {
  const list = await fetch(`${base}/api/branch-trees?family=${HOME}`, { headers: {} });
  assert.equal(list.status, 200);
  const { ctx, page } = await page393(MEM);
  try {
    await page.goto(`${base}/#/${HOME}/person/${P.root}`);
    await page.waitForSelector('nav.ptabs', { timeout: 15000 });
    await seq(page, 800);
    assert.ok(!(await page.locator('#main').innerText()).includes('Có cây nhánh'), 'no branch link for a plain member');
    await page.goto(`${base}/#/${BRANCH}/tree`);
    await seq(page, 1500);
    assert.ok(!(await page.locator('#main').innerText()).includes('Lâm Văn Hai E2E'), 'the branch is not shown to a non-member');
  } finally { await ctx.close(); }
});

test('offline: a branch opened once still shows its people with no connection', { skip, timeout: 120000 }, async () => {
  const { ctx, page } = await page393(OWNER);
  try {
    await page.goto(`${base}/#/${BRANCH}/tree`);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#main')?.innerText.includes('Lâm Văn Hai E2E'), null, { timeout: 15000 });
    await seq(page, 800); // the device cache is written after the pull
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#main')?.innerText.includes('Lâm Văn Hai E2E'), null, { timeout: 15000 });
  } finally { await ctx.close(); }
});

test('delete the branch: the tree goes, every person stays at home', { skip, timeout: 120000 }, async () => {
  const before = (await pool.query('select count(*)::int n from persons where family_id = $1', [HOME])).rows[0].n;
  const { ctx, page } = await page393(OWNER);
  try {
    await page.goto(`${base}/#/${BRANCH}/tree`);
    await page.waitForSelector('[data-bt-del]', { timeout: 15000 });
    await page.locator('[data-bt-del]').click();
    const dlg = page.locator('dialog[open]').first();
    await dlg.waitFor({ timeout: 10000 });
    await dlg.getByRole('button', { name: /Xóa cây nhánh/ }).click();
    await page.waitForFunction(() => location.hash.includes('/bte2e') === false || !location.hash.includes('br-'), null, { timeout: 15000 });
    await seq(page, 500);
  } finally { await ctx.close(); }
  const left = (await pool.query('select id from families where id = $1', [BRANCH])).rows.length;
  assert.equal(left, 0, 'branch row removed');
  const after = (await pool.query('select count(*)::int n from persons where family_id = $1', [HOME])).rows[0].n;
  assert.equal(after, before, 'no person removed');
});
