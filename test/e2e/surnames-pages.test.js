// E2E: Họ qua các thời kỳ. A guest does not see the origin of a tree (its carried Lý tree is not listed for them); a member
// sees the origin on the Nguyễn tree and the dashed "đổi họ 1232" connector on the Lý clan page; an editor reads the
// person's timeline, adds a mark through the form and it is saved; the owner sets the họ gốc in Cài đặt dòng họ.
// Screenshots 390 x 844 (GP_SHOT_DIR). Invented names only. Needs a scratch database + playwright + Chrome.
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

const FA = 'surn-nguyen-thu'; const FB = 'surn-ly-thu';
const OWNER = 'chu.surn@example.test'; const ED = 'bt.surn@example.test'; const MEM = 'tv.surn@example.test';
const P_ROOT = 'P700101'; const P_KID = 'P700102';
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'surnames');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query(`insert into families (id, slug, name, han, place, visibility, origin_surname, origin_surname_han, origin_year, origin_reason, origin_visibility)
    values ($1,$1,'Họ Nguyễn Thử','阮','Bến Thử','public','Lý','李','1232','Theo gia phả nhánh','members'),
           ($2,$2,'Họ Lý Thử','李','Sông Mây','public',null,null,null,null,'members')`, [FA, FB]);
  const ins = (id, fam, data) => pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, fam, data, 'e2e']);
  await ins(P_ROOT, FA, { name: 'Nguyễn Thử Gốc', sex: 'm', gen: 1, born: '1200', died: '1270', names: [
    { type: 'birth', surname: 'Lý', from: '1200', to: '1232', confidence: 'tradition' },
    { type: 'changed', surname: 'Nguyễn', from: '1232', reason: 'Theo lệnh đổi họ', source: 'gia phả nhánh', confidence: 'tradition' }] });
  await ins(P_KID, FA, { name: 'Nguyễn Thử Con', sex: 'f', gen: 2, parent: P_ROOT, born: '1240', died: '1300' });
  await ins('P700103', FB, { name: 'Lý Văn Gốc Thử', sex: 'm', gen: 1, born: '1190', died: '1250' });
  const mem = (email, role) => pool.query("insert into members (email, name, role, status, family_id) values ($1,$1,$2,'active',$3)", [email, role, FA]);
  await mem(OWNER, 'owner'); await mem(ED, 'editor'); await mem(MEM, 'member');
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,$1,'owner','active',$2)", [OWNER, FB]);
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

async function asUser(email) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  if (email) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: false }); };

test('guest: the Lý clan page does not list the Nguyễn tree that carried Lý; no hints', { skip }, async () => {
  const { ctx, page, errors } = await asUser(null);
  try {
    await page.goto(`${base}/#ho/ly`);
    await page.waitForSelector('.clan-lay', { timeout: 15000 });
    const text = await page.locator('.clan-lay').innerText();
    assert.match(text, /Họ Lý Thử|Sông Mây/);
    assert.doesNotMatch(text, /Nguyễn Thử|đổi họ 1232/);
    assert.equal(await page.locator('.clan-hint').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('member: the Lý clan page shows the carried Nguyễn tree with the dashed connector "đổi họ 1232"; screenshot 390', { skip }, async () => {
  const { ctx, page, errors } = await asUser(MEM);
  try {
    await page.goto(`${base}/#ho/ly`);
    await page.waitForSelector('.clan-lay', { timeout: 15000 });
    const chg = page.locator('.clan-chg');
    await chg.first().waitFor({ timeout: 15000 });
    assert.match(await chg.first().innerText(), /hiện là họ Nguyễn · đổi họ 1232/);
    assert.equal(await page.locator('.clan-chg.tl-dash').count() >= 1, true, 'dashed connector');
    await shot(page, 'surn-1.png');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('editor: the person timeline shows the marks; a new mark is added through the form and saved', { skip }, async () => {
  const { ctx, page, errors } = await asUser(ED);
  try {
    await page.goto(`${base}/#/${FA}/person/${P_ROOT}`);
    await page.waitForSelector('text=Đổi họ', { timeout: 15000 });
    const body = await page.locator('body').innerText();
    assert.match(body, /Họ khi sinh/);
    assert.match(body, /Đổi họ/);
    assert.match(body, /Theo lệnh đổi họ/);
    // A sync that finishes after the form opens re-renders the profile and drops the open form (pre-existing: store.emit -> renderSoon).
    // Wait for the first sync to finish so the click is not undone by it.
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Thêm mốc họ' }).click();
    await page.locator('#surn-form input[name=surname]').fill('Trần');
    await page.locator('#surn-form select[name=type]').selectOption('aka');
    await page.locator('#surn-form input[name=from]').fill('1300');
    await page.locator('#surn-form input[name=source]').fill('bia đá');
    await page.getByRole('button', { name: 'Lưu mốc họ' }).click();
    let names = [];
    for (let i = 0; i < 40 && names.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 250));
      names = (await pool.query('select data->\'names\' n from persons where id=$1', [P_ROOT])).rows[0].n || [];
    }
    assert.equal(names.length, 3, 'the mark is saved on the server');
    assert.equal(names[2].surname, 'Trần');
    await shot(page, 'surn-2.png');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('owner: Cài đặt dòng họ has the họ gốc card with the visibility choice', { skip }, async () => {
  const { ctx, page, errors } = await asUser(OWNER);
  try {
    await page.goto(`${base}/#/${FA}/cai-dat-dong-ho`);
    await page.waitForSelector('#origin-form', { timeout: 15000 });
    assert.equal(await page.locator('#origin-form input[name=origin_surname]').inputValue(), 'Lý');
    assert.equal(await page.locator('#origin-form input[name=origin_visibility]:checked').inputValue(), 'members');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
