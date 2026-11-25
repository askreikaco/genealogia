// E2E: link the same person across two family trees (owner of both: linked at once), then both profiles show
// "Cũng có trong cây" and navigate to each other; the tree chart marks the linked person. Invented names only.
// Needs a database (GP_TEST_DATABASE_URL, own schema e2e_links) + playwright + Chrome, like relations.test.js.
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

const OWNER = 'owner-links-e2e@test.local';
const FB = 'ho-thu-lk';
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'links');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ Thư Thử','舒','public') on conflict do nothing", [FB]);
  const ins = (id, fam, data) => pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, fam, data, 'e2e']);
  await ins('P001', 'duong', { name: 'Dương Văn Tổ Thử', sex: 'm', gen: 1, died: '1900' });
  await ins('P002', 'duong', { name: 'Dương Văn Con Thử', sex: 'm', gen: 2, parent: 'P001' });
  await ins('N-sp-p002-1', 'duong', { name: 'Thư Thị Lan Thử', sex: 'f', spouse_of: 'P002', born: '1972' });
  await ins('Nthulan000001', FB, { name: 'Thư Thị Lan Thử', sex: 'f', gen: 3, born: '1972' });
  for (const fam of ['duong', FB]) await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$2,'owner','active') on conflict (family_id, email) do nothing", [OWNER, fam]);
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

async function ownerPage(width = 390) {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  return { ctx, page: await ctx.newPage() };
}
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: false }); };

test('owner of both trees links a person; both profiles show "Cũng có trong cây" and navigate', { skip }, async () => {
  const { ctx, page } = await ownerPage();
  try {
    await page.goto(base + '/#person/N-sp-p002-1');
    await page.waitForSelector('section.relsec', { timeout: 15000 });
    await page.locator('.acts2 [data-menu]').first().click();
    await page.locator('.rds-menu [data-act="xlink"]').click();
    await page.waitForSelector('dialog.xlink-sheet[open]');
    await page.selectOption('dialog.xlink-sheet select[name=fam]', FB);
    await page.fill('dialog.xlink-sheet input[name=q]', 'thu thi lan');
    await page.waitForSelector('dialog.xlink-sheet [data-pick="Nthulan000001"]', { timeout: 10000 });
    await page.click('dialog.xlink-sheet [data-pick="Nthulan000001"]');
    await page.fill('dialog.xlink-sheet input[name=reason]', 'cùng tên, năm sinh');
    await shot(page, 'link1-sheet-390.png');
    await page.click('dialog.xlink-sheet [data-save]');
    await page.waitForSelector('dialog.xlink-sheet', { state: 'detached', timeout: 10000 });
    await page.waitForSelector('a.xlink', { timeout: 10000 });
    assert.match(await page.locator('a.xlink').innerText(), /Cũng có trong cây/);
    await shot(page, 'link1-profile-390.png');
    await page.click('a.xlink');
    await page.waitForFunction((id) => location.hash.includes(id), 'Nthulan000001', { timeout: 10000 });
    await page.waitForSelector('a.xlink', { timeout: 15000 });
    assert.match(await page.locator('a.xlink').innerText(), /Cũng có trong cây/);
    const h = await pool.query("select count(*)::int n from history where field='lien_ket'");
    assert.equal(h.rows[0].n, 2, 'history on both persons');
  } finally { await ctx.close(); }
});

test('tree chart marks the linked person', { skip }, async () => {
  const { ctx, page } = await ownerPage(1280);
  try {
    await page.goto(base + '/#/' + FB + '/tree');
    await page.waitForSelector('svg.tchart', { timeout: 15000 });
    await page.waitForSelector('svg.tchart [data-sel="Nthulan000001"] .clk', { timeout: 15000 });
    await shot(page, 'link1-tree-1280.png');
  } finally { await ctx.close(); }
});
