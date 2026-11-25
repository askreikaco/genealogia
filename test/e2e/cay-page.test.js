// E2E: the all-families tree page #/tat-ca/tree (the old "Tìm dòng họ" page merged in). Guest and a member: old
// #tim-dong-ho redirects here, "Dòng họ của bạn" (followed or member) rows open the tree, "Khám phá · công khai" rows open
// the preview and "Theo dõi" moves a family up, search filters both sections, the clan link only for a surname with
// more than one family, the dashed "Lập gia phả mới" card. Screenshots 390 light (guest) and dark (member) when GP_SHOT_DIR
// is set. Invented names only. Needs a database (GP_TEST_DATABASE_URL, own schema e2e_caypage), playwright and Chrome.
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

const KB = 'cay-kha-ben'; const KS = 'cay-kha-song'; const PG = 'cay-phan-go'; const PV = 'cay-kin-kin'; const HV = 'cay-hoang-vn'; const HJ = 'cay-hoang-jp';
const MEMBER = 'cay.member@example.test';
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'caypage');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const fam = (id, name, place, vis, han) => pool.query('insert into families (id, slug, name, han, place, visibility) values ($1,$1,$2,$3,$4,$5) on conflict do nothing', [id, name, han, place, vis]);
  await fam(KB, 'Họ Kha Bến Thử', 'Bến Thử', 'public', '柯'); await fam(KS, 'Họ Kha Sông Thử', 'Sông Mây', 'public', '柯');
  await fam(PG, 'Họ Phan Gò Thử', 'Gò Trúc', 'public', '潘'); await fam(PV, 'Họ Kín Thử', 'Kín', 'private', '金');
  // a Vietnamese Họ Hoàng and a Japanese reference tree of the same surname text: the JP row never links to the clan
  await pool.query("insert into families (id, slug, name, place, visibility, country) values ($1,$1,'Họ Hoàng Thử','Thử','public','VN'), ($2,$2,'Hoàng tộc Nhật Bản (tham khảo)','','public','JP') on conflict do nothing", [HV, HJ]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thành viên e2e',$2,'member','active') on conflict (family_id, email) do nothing", [MEMBER, KB]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close(); srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function context(width = 390, colorScheme = 'light', email = '') {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme, serviceWorkers: 'block' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  if (email) {
    const r = await fetch(`${base}/api/test/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: 'Thành viên e2e' }) });
    assert.strictEqual(r.status, 200);
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: true }); };
// The list can repaint (a re-render starts another search): wait until it shows rows and holds still for a moment.
const settle = async (page, want) => {
  for (let i = 0; i < 60; i++) {
    const t = await page.locator('#flist').textContent().catch(() => '');
    if (t && !/Đang tìm/.test(t) && want.every((w) => t.includes(w))) { await page.waitForTimeout(400); if ((await page.locator('#flist').textContent().catch(() => '')) === t) return; }
    await page.waitForTimeout(150);
  }
  throw new Error('the list did not settle: ' + (await page.locator('#flist').textContent().catch(() => '')).slice(0, 200));
};
const rows = (page, sec) => page.locator(`#flist .cay-h:has-text("${sec}") + .cay-list .cay-item a.calm`);

test('old #tim-dong-ho redirects to the all-families tree; sections, search, preview rows, no duplicate buttons', { skip }, async () => {
  const { ctx, page, errors } = await context();
  try {
    await page.goto(`${base}/#tim-dong-ho`);
    await page.waitForFunction(() => location.hash === '#/tat-ca/tree', null, { timeout: 10000 });
    await settle(page, ['Kha Bến', 'Phan Gò']);
    // the family list is redrawn on every store sync: wait for the sync to settle before counting (count() does not wait)
    await page.waitForFunction(() => document.querySelector('#sync')?.textContent.includes('Đã đồng bộ'), null, { timeout: 15000 });
    await page.locator('#flist .cay-h', { hasText: 'Khám phá · công khai' }).first().waitFor({ state: 'visible' });
    // guest: nothing followed here, so the public families are in "Khám phá"; the private one is not listed
    assert.ok(await page.locator('#flist .cay-h', { hasText: 'Khám phá · công khai' }).count() === 1, await page.locator('#flist').innerText());
    assert.equal(await page.locator('#flist').getByText('Kín', { exact: false }).count(), 0, 'private family not listed to a guest');
    assert.equal(await rows(page, 'Khám phá').count(), 5);
    // one clan link for the surname (shown once, under its first row); none for Phan
    assert.equal(await page.locator('#flist a.cay-clan[href="#ho/kha"]').count(), 1);
    assert.equal(await page.locator('#flist a.cay-clan[href="#ho/phan"]').count(), 0);
    // Hoàng: the VN family is alone in its clan (no link); the JP family is never in it (no link)
    assert.equal(await page.locator('#flist a.cay-clan[href="#ho/hoang"]').count(), 0);
    assert.equal(await page.locator('#flist .cay-item', { hasText: 'Hoàng tộc' }).locator('a.cay-clan').count(), 0);
    assert.equal(await page.locator('#flist').getByRole('link', { name: 'Xem trước' }).count(), 0);
    assert.equal(await page.locator('#flist').getByRole('link', { name: 'Mở', exact: true }).count(), 0);
    // search filters both sections
    await page.fill('#fq', 'Gò');
    await page.waitForFunction(() => document.querySelectorAll('#flist .cay-item').length === 1, null, { timeout: 10000 });
    assert.equal(await page.locator('#flist a.cay-clan').count(), 0);
    await page.fill('#fq', 'Gò Trúc'); // quê quán
    await page.waitForFunction(() => document.querySelectorAll('#flist .cay-item').length === 1, null, { timeout: 10000 });
    // a preview row opens the family's page; the create card is there
    await page.fill('#fq', '');
    await page.waitForFunction(() => document.querySelectorAll('#flist .cay-item').length >= 3, null, { timeout: 10000 });
    assert.equal(await page.locator('#flist a[href="#lap-gia-pha"]').count(), 1);
    await rows(page, 'Khám phá').first().click();
    await page.waitForFunction(() => /#\/cay-[a-z-]+\/tree$/.test(location.hash), null, { timeout: 10000 });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
  for (const [scheme, name] of [['light', 'cay-guest-390-light.png'], ['dark', 'cay-guest-390-dark.png']]) {
    const c = await context(390, scheme);
    try {
      await c.page.goto(`${base}/#/tat-ca/tree`);
      await c.page.waitForSelector('#flist .cay-h:has-text("Khám phá")', { timeout: 15000 });
      await c.page.waitForSelector('#flist a.calm:has-text("Phan Gò")', { timeout: 15000 });
      await shot(c.page, name);
    } finally { await c.ctx.close(); }
  }
});

test('a member: "Dòng họ của bạn" row opens the tree; Theo dõi on a preview row moves the family up; dark 390 screenshot', { skip }, async () => {
  const { ctx, page, errors } = await context(390, 'dark', MEMBER);
  try {
    await page.goto(`${base}/#/tat-ca/tree`);
    // the signed-in list can paint once before the session's follows are known: wait for the member's row
    await settle(page, ['Dòng họ của bạn', 'Kha Bến', 'Phan Gò']);
    const mine = rows(page, 'Dòng họ của bạn');
    assert.ok(await mine.filter({ hasText: 'Kha Bến' }).count() === 1, 'the member\'s family is in "Dòng họ của bạn"');
    const before = await mine.count();
    await page.waitForSelector(`#flist [data-fam-follow="${PG}"]`, { timeout: 10000 });
    assert.ok(await page.locator('#flist [data-fam-follow]').count() >= 2, await page.locator('#flist').innerText());
    await page.click(`#flist [data-fam-follow="${PG}"]`);
    await page.waitForFunction((n) => document.querySelectorAll('#flist .cay-item').length > n || document.querySelectorAll('#flist .cay-h').length > 0 && /Dòng họ của bạn · 2/.test(document.querySelector('#flist').innerText), before, { timeout: 10000 });
    await settle(page, ['Phan Gò', 'Kha Bến']);
    assert.equal(await rows(page, 'Dòng họ của bạn').count(), before + 1);
    assert.ok(await rows(page, 'Dòng họ của bạn').filter({ hasText: 'Phan Gò' }).count() === 1, 'followed family moved up');
    await shot(page, 'cay-member-390-dark.png');
    const light = await context(390, 'light', MEMBER);
    try {
      await light.page.goto(`${base}/#/tat-ca/tree`);
      await settle(light.page, ['Dòng họ của bạn', 'Kha Bến', 'Phan Gò']);
      await shot(light.page, 'cay-member-390-light.png');
    } finally { await light.ctx.close(); }
    await rows(page, 'Dòng họ của bạn').filter({ hasText: 'Kha Bến' }).click();
    await page.waitForFunction((h) => location.hash === h, `#/${KB}/tree`, { timeout: 10000 });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
