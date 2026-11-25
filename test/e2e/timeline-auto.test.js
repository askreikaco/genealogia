// E2E: Dòng đời automatic rows from the family (birth, death, spouse and children, grandchildren, relatives' deaths).
// Own family (slug tla-<tag>), so the seeded data is not touched. Needs a SCRATCH database:
//   GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright>
// GP_SHOT_DIR=<dir> also writes tl-auto-390.png (the grandfather's Dòng đời).
// Covers: an opened person with relatives shows the derived rows (birth 941, a 3-digit year; spouse's death; own death;
// a grandchild's birth), each marked "tự động"; a child with no recorded year gets no row; a stored event of the same
// type and year replaces the derived row; no horizontal scroll; no console errors.
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

const TAG = crypto.randomBytes(3).toString('hex');
const SLUG = `tla-${TAG}`;
const OWNER = `owner.${TAG}@test.local`;
const T = `N${TAG}gp01`; const V = `N${TAG}bu01`; const C = `N${TAG}co01`; const G = `N${TAG}ch01`; // ids: N + 10 characters
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử tự động','public')", [SLUG]);
  // grandfather (3-digit birth year 941) and his wife (legacy spouse_of), a son with no birth year, the son's son
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$9,$2,$10), ($3,$9,$4,$10), ($5,$9,$6,$10), ($7,$9,$8,$10)', [
    T, { name: 'Ông Trường Tự', sex: 'm', gen: 1, born: '941', died: '1005' }, V,
    { name: 'Bà Vợ Tự', sex: 'f', gen: 1, spouse_of: T, born: '952', died: '1000' },
    C, { name: 'Con Trai Tự', sex: 'm', gen: 2, parent: T, other_parent: V, died: '1030' },
    G, { name: 'Cháu Tự', sex: 'm', gen: 3, parent: C, born: '1000' },
    SLUG, 'e2e']);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$2,'owner','active')", [OWNER, SLUG]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip || !pool) return;
  await browser?.close();
  srv?.close();
  await pool.query('delete from events where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id in ($1,$2,$3,$4)', [T, V, C, G]).catch(() => {});
  await pool.query('delete from ops where person_id in ($1,$2,$3,$4)', [T, V, C, G]).catch(() => {});
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function newPage(width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, colorScheme: 'light' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/^https:\/\/fonts\.g(oogleapis|static)\.com\//.test(m.location().url || '')) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, errs };
}
async function lifeOf(page, id) {
  await page.goto(`${base}/#/${SLUG}/person/${id}`);
  await page.waitForSelector('nav.ptabs', { timeout: 20000 });
  await page.click('button[data-ptab="life"]');
  await page.waitForSelector('#tl-body .tl2', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('#sync')?.textContent.includes('Đã đồng bộ'), null, { timeout: 15000 }).catch(() => {});
}
const rowsText = (page) => page.$$eval('#tl-body .tl2 > li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));

test('the grandfather timeline shows the automatic rows: birth (941), spouse death, own death, estimated child birth, grandchild birth', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390);
  try {
    await lifeOf(page, T);
    const rows = await rowsText(page);
    const find = (re) => rows.filter((t) => re.test(t));
    assert.equal(find(/Ra đời/).length, 1, 'own birth row (a 3-digit year, exact)');
    assert.match(find(/Ra đời/)[0], /941/);
    assert.equal(find(/Ra đời/)[0].includes('ước tính'), false, 'the recorded birth is not an estimate');
    assert.equal(find(/Vợ Bà Vợ Tự mất/).length, 1, 'spouse death row');
    assert.match(find(/Vợ Bà Vợ Tự mất/)[0], /1000/);
    assert.equal(find(/1005 .*Bản thân tự động Mất/).length, 1, 'own death row');
    assert.equal(find(/Con Trai Tự ra đời/).length, 0, 'the child has no recorded birth year: no row (relatives get no estimate)');
    const grand = find(/Cháu Tự ra đời · con của Con Trai Tự/);
    assert.equal(grand.length, 1, 'grandchild birth row');
    assert.match(grand[0], /1000/); assert.match(grand[0], /tự động/);
    // a single grandchild is not a group: no names fold (only the grouped "N cháu ra đời" rows have one)
    const grandRow = page.locator('#tl-body .tl2 > li', { hasText: 'Cháu Tự ra đời' });
    assert.equal(await grandRow.locator('details.tl-why').count(), 0, 'no Xem tên on a single grandchild');
    // every automatic row carries the marker; estimated and exact alike
    const auto = await page.$$eval('#tl-body .tl2 > li.rel', (els) => els.map((e) => e.innerText));
    assert.ok(auto.length >= 4, 'at least four automatic rows');
    assert.ok(auto.every((t) => t.includes('tự động')), 'each automatic row says tự động');
    // dates ascend (undated rows would sit last)
    const years = await page.$$eval('#tl-body .tl2 > li .dt b', (els) => els.map((e) => parseInt(e.textContent.replace(/\D/g, ''), 10)).filter(Boolean));
    assert.deepEqual(years, [...years].sort((a, b) => a - b), 'rows in date order');
    assert.equal(await page.locator('#tl-body button[data-est-save]').count(), 0, 'no save button on the grandfather (his birth is recorded)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll at 390px');
    if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await page.screenshot({ path: path.join(SHOT, 'tl-auto-390.png'), fullPage: true }); }
    assert.deepEqual(errs, [], 'no console errors');
  } finally { await ctx.close(); }
});

test('the editor sees the save button on the own estimate of a person with no birth year; a stored event of the same year replaces the derived row', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390);
  try {
    await lifeOf(page, C);
    assert.equal(await page.locator('#tl-body button[data-est-save]').count(), 1, 'the own birth estimate keeps Lưu thành sự kiện');
    // a stored death on the grandfather in the same year as the derived one: the derived row goes
    const id = 'E' + crypto.randomBytes(6).toString('hex');
    await pool.query("insert into events (id, family_id, person_id, type, date_kind, date_from, date_text, people, sources, created_by) values ($1,$2,$3,'mat','exact','1005','1005','[]','[]','e2e')", [id, SLUG, T]);
    await lifeOf(page, T);
    const rows = await rowsText(page);
    const own = rows.filter((t) => /1005/.test(t) && /Mất/.test(t));
    assert.equal(own.length, 1, 'one death row for the own death');
    assert.equal(own[0].includes('tự động'), false, 'the stored row is shown, not the derived one');
    assert.deepEqual(errs, [], 'no console errors');
  } finally { await ctx.close(); }
});
