// E2E: minimal forms A (Thêm chi tiết, the event form, the auto lunar of an exact date). Own family (slug fma-<tag>),
// so the seeded data is not touched. Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch>
// NODE_PATH=<dir with playwright>. GP_SHOT_DIR=<dir> also writes the screenshots (new form closed and open, edit with sources).
// Covers: a new event shows only the five fields (Tên sự kiện only for Khác); Thêm chi tiết is closed and lists nothing;
// an exact date shows "≈ 5/7 ÂL" under Thời gian, fills Âm lịch and saves it; a typed lunar wins; a lunar-only entry
// works for a partial date; editing an event with photos and sources opens the fold with its summary; the ⓘ shows the
// date help; the fold opens from the keyboard; 360 px has no horizontal overflow.
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
const SLUG = `fma-${TAG}`;
const OWNER = `owner.${TAG}@test.local`;
const LIVING = `N${TAG}liv`; const DEAD = `N${TAG}dd1`;
const SRC = 'D' + crypto.randomBytes(6).toString('hex');
const EV_EDIT = 'E' + crypto.randomBytes(6).toString('hex');
const PH1 = crypto.randomBytes(12).toString('hex'); const PH2 = crypto.randomBytes(12).toString('hex');
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử form tối giản','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$3,$2,$4), ($5,$3,$6,$4)', [
    LIVING, { name: 'Dương Thị Sống', sex: 'f', gen: 3, birth_date: '5/3/1962', born: '1962' }, SLUG, 'e2e',
    DEAD, { name: 'Dương Văn Mất', sex: 'm', gen: 2, born: '1930', died: '1995' }]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$2,'owner','active')", [OWNER, SLUG]);
  // an event with a source and two photos: opening it to edit must open the "Thêm chi tiết" fold by itself
  await pool.query("insert into sources (id, family_id, title, kind, created_by) values ($1,$2,'Gia phả họ Dương','gia_pha','e2e')", [SRC, SLUG]);
  await pool.query("insert into events (id, family_id, person_id, type, date_text, date_kind, date_from, people, sources, photos, is_preferred, created_by) values ($1,$2,$3,'hoc','1980','exact','1980','[]',$4,$5,true,'e2e')",
    [EV_EDIT, SLUG, LIVING, JSON.stringify([{ source_id: SRC, title: 'Gia phả họ Dương' }]),
      JSON.stringify([`/api/photos/${PH1}`, `/api/photos/${PH2}`])]);
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
  await pool.query('delete from sources where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from suggestions where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id in ($1,$2)', [LIVING, DEAD]).catch(() => {});
  await pool.query('delete from ops where person_id in ($1,$2)', [LIVING, DEAD]).catch(() => {});
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function newOwnerPage(width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage();
  const errs = [];
  // the test photos are not on disk: their 404s are expected (every other console error still fails the test)
  page.on('console', (m) => { const u = m.location().url || ''; if (m.type() === 'error' && !/^https:\/\/fonts\.g(oogleapis|static)\.com\//.test(u) && !/\/api\/photos\//.test(u)) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, errs };
}
// The event page for a person (add), or for an existing event (edit: ?id=). Waits until the form is drawn.
async function openEventPage(page, personId, eventId = '') {
  await page.goto(`${base}/#/${SLUG}/su-kien/${personId}${eventId ? `?id=${encodeURIComponent(eventId)}` : ''}`);
  await page.waitForSelector('[data-evx]', { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('.skel'), null, { timeout: 20000 }).catch(() => {});
}
// A real reload, then the form again (the screenshots show what a fresh visit shows).
async function reloadForm(page, personId, eventId = '') {
  await page.reload();
  await openEventPage(page, personId, eventId);
}
// The fields a person can see in the event form (inside a closed fold they are not visible).
// (Playwright's visibility: a closed details keeps its content in the DOM, so offsetParent is not enough.)
const visibleFields = async (page) => {
  const out = [];
  for (const el of await page.locator('[data-evx] [data-f]').all()) if (await el.isVisible()) out.push(await el.getAttribute('data-f'));
  return out;
};
const foldOf = (page) => page.locator('[data-evx] details[data-disc]');
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('.toast:not([hidden])'), null, { timeout: 10000 }).catch(() => {});
const shot = async (page, name) => {
  if (!SHOT) return;
  fs.mkdirSync(SHOT, { recursive: true });
  await toastGone(page);
  await page.waitForTimeout(300); // the chevron and the fold finish their transition first
  await page.screenshot({ path: path.join(SHOT, name) });
};
// Waits until the saved event row has the lunar the test expects (the save is asynchronous).
async function waitLunar(dateText, expected) {
  let row = null;
  for (let i = 0; i < 60; i++) {
    const r = await pool.query('select lunar from events where family_id=$1 and date_text=$2 order by created_at desc limit 1', [SLUG, dateText]);
    row = r.rows[0] || null;
    if (row && row.lunar === expected) return row;
    await new Promise((res) => setTimeout(res, 250));
  }
  return row;
}

test('new event: only the five fields show, Thêm chi tiết is closed and lists nothing', { skip }, async () => {
  const { ctx, page, errs } = await newOwnerPage(390);
  try {
    await openEventPage(page, LIVING);
    assert.deepEqual(await visibleFields(page), ['type', 'date_text', 'place', 'description'], 'Loại, Thời gian, Địa điểm, Mô tả (Tên sự kiện is for Khác only)');
    await page.selectOption('[data-evx] select[data-f="type"]', 'khac');
    assert.deepEqual(await visibleFields(page), ['type', 'title', 'date_text', 'place', 'description'], 'Khác shows Tên sự kiện');
    await page.selectOption('[data-evx] select[data-f="type"]', 'sinh');
    const fold = foldOf(page);
    assert.equal(await fold.evaluate((el) => el.open), false, 'closed');
    const sum = (await fold.locator('summary').innerText()).trim();
    assert.equal(sum, 'Thêm chi tiết', 'the closed summary names the fold and lists nothing (no value yet)');
    assert.equal(await page.locator('[data-evx] [data-f="lunar"]').isVisible(), false, 'Âm lịch is inside the fold');
    assert.equal(await page.locator('[data-evx] [data-f="place_new"]').isVisible(), false, 'Tên mới is inside the fold');
    await reloadForm(page, LIVING);
    await shot(page, 'ev-new-closed.png');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('Thêm chi tiết opens from the keyboard and shows the five inner fields', { skip }, async () => {
  const { ctx, page, errs } = await newOwnerPage(390);
  try {
    await openEventPage(page, LIVING);
    const fold = foldOf(page);
    await fold.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await fold.evaluate((el) => el.open), true, 'Enter opens the native summary');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-evx] details[data-disc] [data-f]')].map((el) => el.dataset.f)),
      ['lunar', 'place_new'], 'Âm lịch and Tên mới are the fold\'s fields; people, photos and sources sit there too');
    assert.equal(await page.locator('[data-evx] [data-pk-q]').isVisible(), true, 'Người liên quan is inside the open fold');
    assert.equal(await page.locator('[data-evx] [data-evx-photo]').count(), 1, 'Ảnh is inside the fold');
    assert.equal(await page.locator('[data-evx] [data-src-add]').isVisible(), true, '+ Chọn nguồn is inside the fold');
    await reloadForm(page, LIVING);
    await foldOf(page).locator('summary').click();
    await shot(page, 'ev-new-open.png');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('an exact date shows ≈ ÂL under Thời gian but saves no lunar; a typed lunar is saved; a lunar-only entry needs no date; re-editing stays closed', { skip }, async () => {
  const { ctx, page, errs } = await newOwnerPage(390);
  try {
    // exact day: 15/8/1980 is 5/7 (âm lịch). The hint is for display; nothing is saved from it.
    await openEventPage(page, LIVING);
    await page.fill('[data-evx] input[data-f="date_text"]', '15/8/1980');
    assert.equal((await page.innerText('[data-lunar-hint]')).trim(), '≈ 5/7 ÂL', 'hint under Thời gian');
    assert.equal(await page.inputValue('[data-evx] input[data-f="lunar"]'), '', 'the Âm lịch field is not filled from the date');
    assert.equal((await foldOf(page).locator('summary').innerText()).trim(), 'Thêm chi tiết', 'the closed summary lists no derived lunar');
    await page.fill('[data-evx] textarea[data-f="description"]', 'Ngày cưới');
    await page.click('[data-evx] [data-evx-save]');
    assert.equal((await waitLunar('15/8/1980', ''))?.lunar, '', 'nothing derived is stored');
    const { rows } = await pool.query("select id from events where family_id=$1 and date_text='15/8/1980'", [SLUG]);
    const evId = rows[0].id;

    // re-edit: the fold stays closed (no stored value in it), the hint is still shown
    await openEventPage(page, LIVING, evId);
    assert.equal(await foldOf(page).evaluate((el) => el.open), false, 're-edit: the fold is closed');
    assert.equal((await page.innerText('[data-lunar-hint]')).trim(), '≈ 5/7 ÂL', 're-edit: the hint is shown');

    // typed lunar is saved as typed
    await openEventPage(page, LIVING);
    await page.fill('[data-evx] input[data-f="date_text"]', '25/1/1963');
    await foldOf(page).locator('summary').click();
    assert.equal(await page.inputValue('[data-evx] input[data-f="lunar"]'), '', 'nothing is pre-filled');
    await page.fill('[data-evx] input[data-f="lunar"]', '7/7');
    await page.fill('[data-evx] textarea[data-f="description"]', 'Tết');
    await page.click('[data-evx] [data-evx-save]');
    assert.equal((await waitLunar('25/1/1963', '7/7'))?.lunar, '7/7', 'the typed lunar is saved');

    // partial date: no hint, and a lunar-only entry is kept as typed
    await openEventPage(page, LIVING);
    await page.fill('[data-evx] input[data-f="date_text"]', '1980');
    assert.equal(await page.locator('[data-lunar-hint]').isVisible(), false, 'no lunar for a year only');
    await foldOf(page).locator('summary').click();
    await page.fill('[data-evx] input[data-f="lunar"]', '15 tháng 8');
    await page.fill('[data-evx] textarea[data-f="description"]', 'Chỉ có âm lịch');
    await page.click('[data-evx] [data-evx-save]');
    assert.equal((await waitLunar('1980', '15 tháng 8'))?.lunar, '15 tháng 8', 'lunar-only entry saved');
    await toastGone(page);
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('editing an event with photos and sources opens Thêm chi tiết by itself, with its summary', { skip }, async () => {
  const { ctx, page, errs } = await newOwnerPage(390);
  try {
    await openEventPage(page, LIVING, EV_EDIT);
    const fold = foldOf(page);
    assert.equal(await fold.evaluate((el) => el.open), true, 'open: a photo and a source are inside');
    assert.equal(await page.locator('[data-evx] [data-ph]').count(), 2, 'two photos in the fold');
    assert.equal(await page.locator('[data-evx] [data-src]').count(), 1, 'one source in the fold');
    assert.equal(await page.locator('[data-evx] [data-disc-sum]').textContent().then((t) => t.trim()), '· 2 ảnh · 1 nguồn',
      'the summary lists what is inside');
    await reloadForm(page, LIVING, EV_EDIT);
    await shot(page, 'ev-edit-sources.png');
    // closed by the user: the summary line lists what is inside
    await foldOf(page).locator('summary').click();
    assert.match((await foldOf(page).locator('summary').innerText()), /2 ảnh · 1 nguồn/, 'the closed summary lists the photos and the source');
    await shot(page, 'ev-edit-sources-closed.png');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('the date help is a native tap-to-show ⓘ next to Thời gian; the placeholder keeps the example; a profile ⋯ still opens', { skip }, async () => {
  const { ctx, page, errs } = await newOwnerPage(390);
  try {
    await openEventPage(page, LIVING);
    assert.equal(await page.getAttribute('[data-evx] input[data-f="date_text"]', 'placeholder'), 'vd 1981, 3/1981, 1980–1981');
    const help = page.locator('[data-evx] .evx-help');
    assert.equal(await help.evaluate((el) => el.open), false, 'the help is closed at first');
    await help.locator('summary').click();
    assert.equal(await help.evaluate((el) => el.open), true, 'a tap opens the help');
    assert.match(await help.locator('p').innerText(), /khoảng 1980/, 'the help text');
    await help.locator('summary').click();
    assert.equal(await help.evaluate((el) => el.open), false, 'a second tap closes it');
    // the profile ⋯ menu (the person page) still opens after the event form has been drawn
    await page.goto(`${base}/#/${SLUG}/person/${LIVING}`);
    await page.waitForSelector(`[data-menu="${LIVING}"][data-menu-ctx="prof"]`, { timeout: 20000 });
    await page.click(`[data-menu="${LIVING}"][data-menu-ctx="prof"]`);
    await page.waitForSelector('[role="menu"]', { state: 'visible', timeout: 5000 });
    assert.equal(await page.locator('[role="menu"]').first().isVisible(), true, 'the ⋯ menu opens');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('the event form does not overflow at 360 px, closed or open', { skip }, async () => {
  const { ctx, page, errs } = await newOwnerPage(360);
  try {
    await openEventPage(page, LIVING, EV_EDIT);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok((await overflow()) <= 0, 'open at 360 px: no horizontal scroll');
    await page.evaluate(() => { document.querySelector('[data-evx] details[data-disc]').open = false; });
    assert.ok((await overflow()) <= 0, 'closed at 360 px: no horizontal scroll');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});
