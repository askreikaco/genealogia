// E2E: family settings > Dữ liệu. An owner downloads the GEDCOM file, picks one to import, sees the preview sheet and
// applies it; a member sees the export row only. Needs a SCRATCH database and a Chrome/Chromium:
//   GP_TEST_DATABASE_URL=postgres://... [GP_E2E_CHROME=/usr/bin/google-chrome] NODE_PATH=<dir with playwright> npm run test:e2e (from giapha/server)
// Skipped when either is missing.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `gx-e2e-${TAG}`;
const OWNER = `owner-gx-${TAG}@test.local`;
const MEMBER = `member-gx-${TAG}@test.local`;
const KNOWN = `P${TAG.toUpperCase()}1`;
let base, pool, srv;

const GED = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
  `0 @${KNOWN}@ INDI`, '1 NAME /Nguyễn/ Văn Ất', '1 SEX M', '1 BIRT', '2 DATE 1950',
  '0 @N1@ INDI', '1 NAME /Nguyễn/ Thị Bảy', '1 SEX F', '1 BIRT', '2 DATE 1955', '2 PLAC Đà Nẵng',
  '0 @F1@ FAM', `1 HUSB @${KNOWN}@`, '1 WIFE @N1@', '1 MARR', '2 DATE 1975', '0 TRLR'].join('\n');

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  await pool.query("insert into families (id, slug, name, visibility) values ($1, $1, 'Họ e2e gedcom', 'public')", [FAM]);
  await pool.query("insert into persons (id, family_id, data, updated_by) values ($1, $2, $3, 'test')", [KNOWN, FAM, { name: 'Nguyễn Văn Ất', sex: 'm', born: '1948' }]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1, 'Chủ họ e2e', $2, 'owner', 'active')", [OWNER, FAM]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1, 'Thành viên e2e', $2, 'member', 'active')", [MEMBER, FAM]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(async () => {
  if (skip) return;
  srv?.close();
  if (pool) {
    await pool.query('delete from suggestions where family_id = $1', [FAM]).catch(() => {});
    await pool.query('delete from history where person_id in (select id from persons where family_id = $1)', [FAM]).catch(() => {});
    await pool.query('delete from ops where person_id in (select id from persons where family_id = $1)', [FAM]).catch(() => {});
    await pool.query('delete from couple where family_id = $1', [FAM]).catch(() => {});
    await pool.query('delete from members where family_id = $1', [FAM]).catch(() => {});
    await pool.query('delete from persons where family_id = $1', [FAM]).catch(() => {});
    await pool.query('delete from families where id = $1', [FAM]).catch(() => {});
    await pool.end().catch(() => {});
  }
});

async function signedInContext(browser, email, name) {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name }) });
  assert.equal(r.status, 200);
  const [pair] = r.headers.get('set-cookie').split(';');
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  return ctx;
}
async function openSettings(page) {
  await page.goto(`${base}/#/${FAM}/cai-dat-dong-ho`);
  await page.waitForSelector('#gx', { timeout: 10000 });
}

test('owner exports the family as a GEDCOM file', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await signedInContext(browser, OWNER, 'Chủ họ e2e');
    const page = await ctx.newPage();
    await openSettings(page);
    assert.ok(await page.locator('#gx-export').count() === 1 && await page.locator('#gx-import').count() === 1);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#gx-export')]);
    assert.equal(dl.suggestedFilename(), `${FAM}.ged`);
    const file = await dl.path();
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith('0 HEAD') && text.includes('1 CHAR UTF-8') && text.includes(`0 @${KNOWN}@ INDI`));
    await ctx.close();
  } finally { await browser.close(); }
});

test('owner picks a GEDCOM file, sees the preview sheet, applies it', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await signedInContext(browser, OWNER, 'Chủ họ e2e');
    const page = await ctx.newPage();
    await openSettings(page);
    const chooser = page.waitForEvent('filechooser');
    await page.click('#gx-import');
    await (await chooser).setFiles({ name: 'giapha.ged', mimeType: 'text/plain', buffer: Buffer.from(GED, 'utf8') });
    const sheet = page.locator('dialog.fpanel');
    await sheet.waitFor({ state: 'visible', timeout: 10000 });
    const txt = await sheet.innerText();
    assert.ok(txt.includes('Người mới') && txt.includes('Nhập'), txt.slice(0, 200));
    assert.ok(txt.includes('Nguyễn Thị Bảy'), 'the new person is listed');
    await sheet.locator('#gx-apply').click();
    await page.waitForSelector('dialog.fpanel', { state: 'detached', timeout: 10000 });
    const { rows } = await pool.query("select id, data from persons where family_id = $1 and data->>'name' = 'Nguyễn Thị Bảy'", [FAM]);
    assert.equal(rows.length, 1, 'the new person is in the family');
    assert.equal(rows[0].data.born, '1955');
    await ctx.close();
  } finally { await browser.close(); }
});

test('a member sees the export row but not the import row', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await signedInContext(browser, MEMBER, 'Thành viên e2e');
    const page = await ctx.newPage();
    await openSettings(page);
    assert.equal(await page.locator('#gx-export').count(), 1);
    assert.equal(await page.locator('#gx-import').count(), 0);
    await ctx.close();
  } finally { await browser.close(); }
});
