// E2E: the clan page #ho/<surname> for a guest: linked trees grouped (oldest founder first, ⇄ shared count), an
// unlinked tree apart, a private tree only as "+1 cây riêng tư"; entry from the profile's "Cũng có trong cây" line and
// from a Tìm dòng họ card. Screenshots 390 light/dark and 1280. Invented names only.
// Needs a database (GP_TEST_DATABASE_URL, own schema e2e_clanview) + playwright + Chrome, like links.test.js.
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

const FA = 'kha-ben-thu'; const FB = 'kha-song-thu'; const FC = 'kha-go-thu'; const FP = 'kha-kin-thu';
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'clanview');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const fam = (id, name, place, vis) => pool.query('insert into families (id, slug, name, han, place, visibility) values ($1,$1,$2,$3,$4,$5) on conflict do nothing', [id, name, '柯', place, vis]);
  await fam(FA, 'Họ Kha Bến Thử', 'Bến Thử', 'public'); await fam(FB, 'Họ Kha Sông Thử', 'Sông Mây', 'public');
  await fam(FC, 'Họ Kha Gò Thử', 'Gò Trúc', 'public'); await fam(FP, 'Họ Kha Kín Thử', 'Kín', 'private');
  const ins = (id, fam, data) => pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, fam, data, 'e2e']);
  await ins('KA1', FA, { name: 'Kha Văn Cụ Thử', sex: 'm', gen: 1, born: '1820', died: '1890' });
  await ins('KA2', FA, { name: 'Kha Thị Chung Thử', sex: 'f', gen: 2, parent: 'KA1', born: '1860', died: '1930' });
  await ins('KB1', FB, { name: 'Kha Văn Tổ Thử', sex: 'm', gen: 1, born: '1760', died: '1830' });
  await ins('KB2', FB, { name: 'Kha Thị Chung Thử', sex: 'f', gen: 3, born: '1860', died: '1930' });
  await ins('KC1', FC, { name: 'Kha Văn Gò Thử', sex: 'm', gen: 1, born: '1880', died: '1950' });
  await ins('KP1', FP, { name: 'Kha Văn Kín Thử', sex: 'm', gen: 1, born: '1700', died: '1770' });
  await pool.query("insert into person_links (a_family, a_person, b_family, b_person, status) values ($1,'KA2',$2,'KB2','accepted')", [FA, FB]);
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

async function guestPage(width = 390, colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: true }); };

test('guest: profile "Cũng có trong cây" -> Xem cả họ Kha -> clan page grouped, private tree only counted', { skip }, async () => {
  const { ctx, page, errors } = await guestPage();
  try {
    await page.goto(`${base}/#/${FA}/person/KA2`);
    await page.waitForSelector('a.xlink', { timeout: 15000 });
    const into = page.locator('.xlinks a.clan-in');
    assert.equal(await into.count(), 1, 'clan link under the link line');
    assert.match(await into.innerText(), /Xem cả họ Kha/);
    await into.click();
    await page.waitForFunction(() => location.hash === '#ho/kha', null, { timeout: 10000 });
    await page.waitForSelector('.clan-lay', { timeout: 15000 });
    assert.match(await page.textContent('#cbtitle'), /Họ Kha/);
    const groups = page.locator('.clan-clu:not(.clan-un)');
    assert.equal(await groups.count(), 1);
    const rows = await groups.first().locator('[data-clan-tree]').evaluateAll((els) => els.map((e) => e.dataset.clanTree));
    assert.deepEqual(rows, [FB, FA], 'oldest founder first');
    assert.match(await groups.first().innerText(), /⇄\s*1 người chung/);
    const un = page.locator('.clan-un');
    assert.deepEqual(await un.locator('[data-clan-tree]').evaluateAll((els) => els.map((e) => e.dataset.clanTree)), [FC]);
    assert.match(await un.locator('.clan-priv').innerText(), /\+1 cây riêng tư/);
    assert.ok(!(await page.locator('main').innerText()).includes('Kín'), 'private tree never named');
    await shot(page, 'clan-view-390-light.png');
    await page.locator(`[data-clan-tree="${FC}"]`).click();
    await page.waitForFunction((f) => location.hash === `#/${f}/tree`, FC, { timeout: 10000 });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('the all-families tree (old Tìm dòng họ) links the clan page; dark 390 and 1280 screenshots', { skip }, async () => {
  const { ctx, page, errors } = await guestPage();
  try {
    await page.goto(`${base}/#tim-dong-ho`); // old route: redirects to the all-families tree
    await page.waitForFunction(() => location.hash === '#/tat-ca/tree', null, { timeout: 10000 });
    await page.fill('#fq', 'Kha Gò');
    await page.waitForSelector('#flist a.calm[href="#/kha-go-thu/tree"]', { timeout: 15000 });
    // the clan link counts the surname over every family, not only the search hits (Kha has three here)
    assert.ok(await page.locator('#flist a.cay-clan[href="#ho/kha"]').count() >= 1);
    // no "Mở" or "Xem trước" buttons anywhere on the page
    assert.equal(await page.locator('#flist').getByRole('link', { name: 'Xem trước' }).count(), 0);
    assert.equal(await page.locator('#flist').getByRole('link', { name: 'Mở', exact: true }).count(), 0);
    await page.fill('#fq', 'Kha');
    await page.waitForSelector('#flist a.cay-clan[href="#ho/kha"]', { timeout: 15000 });
    assert.match(await page.locator('#flist a.cay-clan[href="#ho/kha"]').first().innerText(), /Xem cả họ Kha/);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
  for (const [w, scheme, name] of [[390, 'dark', 'clan-view-390-dark.png'], [1280, 'light', 'clan-view-1280-light.png']]) {
    const c = await guestPage(w, scheme);
    try {
      await c.page.goto(`${base}/#ho/kha`);
      await c.page.waitForSelector('.clan-lay [data-clan-tree]', { timeout: 15000 });
      await shot(c.page, name);
      assert.deepEqual(c.errors, []);
    } finally { await c.ctx.close(); }
  }
});
