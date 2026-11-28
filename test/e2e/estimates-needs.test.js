// E2E, estimated years and the Cần bổ sung page on a real server (scratch DB, own schema): the profile shows "≈ range ·
// ước tính" for a person without a birth year and nothing for one with a birth year; the tree and the lists show it; the
// Kiểm tra dữ liệu page has Cần xem lại for editors and Cần bổ sung thông tin for members (Góp ý opens that person's
// form); no horizontal scroll at 360 px. Strings are read from web/js/needs-vi.js and consistency-vi.js (never typed).
// Needs GP_TEST_DATABASE_URL (scratch DB) + playwright + Chrome. Invented names only. GP_SHOT_DIR: screenshots.
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

const WEB = path.join(__dirname, '..', '..', 'web', 'js');
const NEEDS = eval('(' + fs.readFileSync(path.join(WEB, 'needs-vi.js'), 'utf8').match(/NEEDS_VI = (\{[\s\S]*\});/)[1] + ')');
const CSV = JSON.parse(fs.readFileSync(path.join(WEB, 'consistency-vi.js'), 'utf8').match(/^export const VI = ([\s\S]*);\n$/)[1]);

const FAM = 'ncd';
const OWNER = 'owner-needs-e2e@test.local'; const MEMBER = 'member-needs-e2e@test.local';
const ID = { G1: 'NG1', K1: 'NK1', MO: 'NMO', CH: 'NCH', DU1: 'NDU1', DU2: 'NDU2', W1: 'NW1' };
let base, pool, srv, browser, iso;

test.before(async () => {
  if (skip) return;
  const { isolatedDb } = require('./_isolated-db');
  iso = isolatedDb(DB_URL, 'estimates_needs');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ thử ước tính','X','public')", [FAM]);
  const ins = (key, data) => pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [ID[key], FAM, data, 'e2e']);
  await ins('G1', { name: 'Test Gốc', sex: 'm', born: '1850', died: '1900', gen: 1 });
  await ins('K1', { name: 'Test Kế', sex: 'm', parent: ID.G1, gen: 2, verify: 'Cần ghi năm sinh' });
  await ins('MO', { name: 'Test Mẹ', sex: 'f', born: '1950', gen: 1 });
  await ins('CH', { name: 'Test Con', sex: 'm', born: '1900', parent: ID.MO, gen: 2 });
  await ins('DU1', { name: 'Trần Du', sex: 'm', parent: ID.G1, gen: 2, born: '1880' });
  await ins('DU2', { name: 'TRAN  du', sex: 'm', parent: ID.G1, gen: 2 });
  await ins('W1', { name: 'Test Lạc', sex: '' });
  await pool.query(`insert into members (email, name, family_id, role, status) values ($1,'Chu ho e2e',$3,'owner','active'),
    ($2,'Thanh vien e2e',$3,'member','active')`, [OWNER, MEMBER, FAM]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((res) => srv.on('listening', res));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close(); srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function newPage({ email, width = 390, scheme = 'light' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  if (email) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  return { ctx, page: await ctx.newPage() };
}
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: false }); };
const text = (page) => page.evaluate(() => document.body.innerText);
// Waits until the predicate holds and still holds after a short pause: the app can paint a page twice on load (a skeleton,
// then the page), so a single match can be the first paint.
async function settled(page, fn, arg = null) {
  for (let i = 0; i < 40; i++) {
    await page.waitForFunction(fn, arg, { timeout: 20000 });
    await page.waitForTimeout(400);
    if (await page.evaluate(fn, arg)) return;
  }
  throw new Error('page did not settle');
}

test('profile: a person without a birth year shows "≈ range · ước tính"; a person with a birth year shows none', { skip }, async () => {
  const { ctx, page } = await newPage({ email: MEMBER });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(`${base}/#/${FAM}/person/${ID.K1}`);
    await page.waitForSelector('.prof-est', { timeout: 20000 });
    const line = await page.locator('.prof-est').first().innerText();
    assert.ok(line.includes('≈ 1865–1900') && line.includes(NEEDS.est_label), `estimate line: ${line}`);
    // closed by default; the screenshot is taken before anyone opens it
    assert.strictEqual(await page.locator('.est-why').first().evaluate((e) => e.open), false, 'Cách tính starts closed');
    await shot(page, 'profile-estimate-390-light.png');
    // the basis opens under "Cách tính ›" (tap or click)
    // the profile can repaint once after its events load, which closes the details: tap again until it stays open
    const openBasis = (t) => { const w = document.querySelector('.est-why'); return !!w && w.open && w.querySelector('.est-why-line')?.innerText.includes(t); };
    let opened = false;
    for (let i = 0; i < 8 && !opened; i++) {
      await page.locator('.est-why summary').first().click();
      opened = await page.waitForFunction(openBasis, 'năm sau', { timeout: 1500 }).then(() => true, () => false);
    }
    assert.ok(opened, 'the basis opens under Cách tính');
    await page.goto(`${base}/#/${FAM}/person/${ID.G1}`);
    await page.waitForSelector('h1', { timeout: 20000 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.prof-est').count(), 0, 'no estimate for a person with a birth year');
    assert.deepStrictEqual(errs, [], 'no page errors');
  } finally { await ctx.close(); }
});

test('tree and lists: the estimate shows on the tree card and in the list rows', { skip }, async () => {
  const { ctx, page } = await newPage({ email: MEMBER, width: 1280 });
  try {
    await page.goto(`${base}/#/${FAM}/tree`);
    // the tree chart card of the person without a birth year (data-sel) carries the estimate in its meta line
    await page.waitForFunction((id) => !!document.querySelector(`[data-sel="${id}"]`), ID.K1, { timeout: 20000 });
    const card = await page.evaluate((id) => document.querySelector(`[data-sel="${id}"]`).textContent, ID.K1);
    assert.ok(card.includes('≈ 1865–1900'), `tree card: ${card}`);
    const gp = await page.evaluate((id) => document.querySelector(`[data-sel="${id}"]`).textContent, ID.G1);
    assert.ok(!gp.includes('≈'), 'no estimate on a card with both years');
    await page.goto(`${base}/#/${FAM}/list`);
    await page.waitForFunction(() => (document.body.innerText || '').includes('≈ 1865–1900'), null, { timeout: 20000 });
  } finally { await ctx.close(); }
  // the phone tree (390 px, light) for the screenshot: the estimate on the card of the person without a birth year
  const phone = await newPage({ email: MEMBER, width: 390 });
  try {
    await phone.page.goto(`${base}/#/${FAM}/tree`);
    await settled(phone.page, () => (document.body.innerText || '').includes('≈ 1865–1900'));
    await shot(phone.page, 'tree-card-390-light.png');
  } finally { await phone.ctx.close(); }
});

test('Kiểm tra dữ liệu, member: Cần bổ sung thông tin only, with the estimate and Góp ý that opens that person', { skip }, async () => {
  const { ctx, page } = await newPage({ email: MEMBER, width: 390 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(`${base}/#/${FAM}/consistency`);
    await settled(page, () => { const l = document.querySelector('#nd-list'); return !!l && l.innerText.includes('Test Kế') && l.innerText.includes('Góp ý'); });
    const box = await text(page);
    assert.ok(box.includes(NEEDS.section_needs), 'the needs section');
    assert.ok(!box.includes(NEEDS.section_review), 'no review section for a member');
    assert.ok(!box.includes(CSV.rule_death_before_birth), 'no review issue for a member');
    // the page can repaint once after the first paint: wait for the button itself, then act on it
    const btn = page.locator('[data-cs=suggest][data-id="' + ID.K1 + '"]');
    await btn.waitFor({ state: 'visible', timeout: 20000 });
    await shot(page, 'needs-member-390-light.png');
    await btn.click();
    await page.waitForFunction((id) => location.hash.includes('/sua/' + id), ID.K1, { timeout: 15000 });
    assert.deepStrictEqual(errs, [], 'no page errors');
  } finally { await ctx.close(); }
});

test('Kiểm tra dữ liệu, editor: Cần xem lại with the rule issues and the basis, then Cần bổ sung thông tin', { skip }, async () => {
  const { ctx, page } = await newPage({ email: OWNER, width: 390 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(`${base}/#/${FAM}/consistency`);
    await settled(page, (t) => { const c = document.querySelector('#csbox'); return !!c && c.innerText.includes(t) && c.innerText.includes('Test Kế'); }, NEEDS.rule_year_conflict);
    const box = await text(page);
    for (const k of ['rule_year_conflict', 'rule_possible_duplicate', 'rule_missing_sex', 'rule_verify_note']) assert.ok(box.includes(NEEDS[k]), k);
    assert.ok(box.includes(NEEDS.section_needs));
    assert.ok(box.includes(NEEDS.basis + ':'), 'the basis is listed under the year conflict');
    assert.ok(box.includes('Cần ghi năm sinh'), 'the verify note is shown');
    await shot(page, 'needs-editor-390-light.png');
    assert.deepStrictEqual(errs, [], 'no page errors');
  } finally { await ctx.close(); }
});

test('no horizontal scroll at 360 px on the profile and the Kiểm tra dữ liệu page', { skip }, async () => {
  const { ctx, page } = await newPage({ email: MEMBER, width: 360 });
  try {
    for (const p of [`/#/${FAM}/person/${ID.K1}`, `/#/${FAM}/consistency`]) {
      await page.goto(base + p);
      await page.waitForTimeout(800);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, `${p} overflows by ${over}px`);
    }
  } finally { await ctx.close(); }
});
