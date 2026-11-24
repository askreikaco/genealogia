// E2E: a profile field with two sourced values shows "2 nguồn khác nhau"; the tag opens a sheet listing each value
// with its source and reliability; an editor chooses the other value and the profile shows it; a guest sees the
// sheet read-only. Invented names only. Needs a database (GP_TEST_DATABASE_URL, own schema e2e_variants) +
// playwright + Chrome, like places.test.js.
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

const OWNER = 'owner-variants-e2e@test.local';
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'variants');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const ins = (id, data) => pool.query("insert into persons (id, family_id, data, updated_by) values ($1,'duong',$2,'e2e')", [id, data]);
  await ins('P001', { name: 'Dương Văn Cụ Thử', sex: 'm', gen: 1, born: '1931', died: '1988', burial: 'Làng Bến Xưa' });
  const v = (field, value, source, quality, chosen) => pool.query("insert into field_variants (person_id, family_id, field, value, source, quality, by_user, chosen) values ('P001','duong',$1,$2,$3,$4,'Người Ghi Thử',$5)", [field, JSON.stringify(value), source, quality, chosen]);
  await v('born', '1931', 'Bia mộ, ảnh chụp 2019', 'cao', true);
  await v('born', '1932', 'Gia phả chữ Hán, trang 14', 'binh_thuong', false);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e','duong','owner','active') on conflict (family_id, email) do nothing", [OWNER]);
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

async function newPage({ signedIn, width = 390, scheme = 'light' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  if (signedIn) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  return { ctx, page: await ctx.newPage() };
}
const shot = async (page, name, full = false) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: full }); };

test('guest: the tag shows on Sinh; the sheet lists both values with sources, read-only', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await newPage({ signedIn: false, scheme });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    try {
      await page.goto(base + '/#person/P001');
      const tag = page.locator('[data-variants="born"]');
      await tag.waitFor({ timeout: 15000 });
      assert.match(await tag.textContent(), /2 nguồn khác nhau/);
      await shot(page, `variants-profile-390-${scheme}.png`);
      await tag.click();
      await page.waitForSelector('dialog.var-sheet[open]');
      const items = page.locator('dialog.var-sheet .var-item');
      assert.equal(await items.count(), 2);
      assert.match(await items.nth(1).textContent(), /Gia phả chữ Hán, trang 14/);
      assert.equal(await page.locator('dialog.var-sheet [data-var-use]').count(), 0, 'no choose button for a guest');
      assert.doesNotMatch(await page.textContent('dialog.var-sheet'), /Người Ghi Thử/, 'recorder hidden from guests');
      await shot(page, `variants-sheet-guest-390-${scheme}.png`);
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
});

test('editor: chooses 1932 in the sheet; the profile shows 1932 and the tag stays', { skip }, async () => {
  const { ctx, page } = await newPage({ signedIn: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(base + '/#person/P001');
    await page.locator('[data-variants="born"]').waitFor({ timeout: 15000 });
    await page.click('[data-variants="born"]');
    await page.waitForSelector('dialog.var-sheet[open]');
    assert.match(await page.textContent('dialog.var-sheet'), /Người Ghi Thử/, 'members see who recorded');
    await shot(page, 'variants-sheet-editor-390-light.png');
    await page.click('dialog.var-sheet [data-var-use]');
    await page.waitForSelector('dialog.var-sheet', { state: 'detached' });
    await page.waitForFunction(() => /1932/.test(document.querySelector('#main .prof + * , #main')?.textContent || ''), null, { timeout: 15000 });
    await page.locator('[data-variants="born"]').waitFor({ timeout: 15000 });
    const row = await page.evaluate(() => { const dt = [...document.querySelectorAll('#main dt')].find((x) => x.textContent === 'Sinh'); return dt?.nextElementSibling?.textContent || ''; });
    assert.match(row, /^1932/, 'Sinh shows the chosen value: ' + row);
    const db = await pool.query("select data->>'born' b from persons where id='P001'");
    assert.equal(db.rows[0].b, '1932');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});
