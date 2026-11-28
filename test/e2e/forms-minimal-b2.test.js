// E2E: minimal forms B2 (the person form's "Thêm chi tiết"): Nơi sống, Nghề, Học vấn and Tôn giáo are timeline events. Own
// family (slug fmb2-<tag>). Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch> (name contains scratch,
// e2e or giapha_ci); NODE_PATH=<dir with playwright>. GP_SHOT_DIR=<dir> also writes the screenshots (the edit with the fold
// open: the links and a "Hiện tại" value; the profile Thông tin with the current values).
// Covers: a new person shows no links (a hint until saved); the edit's fold shows "+ Nơi sống / + Nghề nghiệp / + Học vấn /
// + Tôn giáo" and "Hiện tại" with "Chuyển thành sự kiện", and no place/job/religion input; a link opens the event editor with
// its type; saving returns to the profile, where Thông tin shows the event as the current value and the old field is kept;
// "Chuyển thành sự kiện" prefills the field's text; "Bỏ giá trị này" clears the field on save; a member's link sends an event
// suggestion; 360 px has no horizontal overflow.
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
const SLUG = `fmb2-${TAG}`;
const OWNER = `owner.${TAG}@test.local`;
const MEMBER = `member.${TAG}@test.local`;
const P1 = `N${TAG}p1`; const P2 = `N${TAG}p2`;
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử form B2','public')", [SLUG]);
  // P1: the old fields hold a place, a job and a religion (no events yet); P2: a place, for the member's suggestion
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$3,$2,$4), ($5,$3,$6,$4)', [
    P1, { name: 'Dương Văn Hương', sex: 'm', gen: 3, born: '1950', place: 'Củ Chi', job: 'Kỹ sư', religion: 'Công giáo' }, SLUG, 'e2e',
    P2, { name: 'Dương Thị Lan', sex: 'f', gen: 3, born: '1952', place: 'Hóc Môn' }]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$2,'owner','active'), ($3,'Thành viên e2e',$2,'member','active')",
    [OWNER, SLUG, MEMBER]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip || !pool) return;
  await browser?.close();
  srv?.close();
  await pool.query('delete from suggestions where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id in (select id from persons where family_id=$1)', [SLUG]).catch(() => {});
  await pool.query('delete from ops where person_id in (select id from persons where family_id=$1)', [SLUG]).catch(() => {});
  await pool.query('delete from events where person_id in (select id from persons where family_id=$1)', [SLUG]).catch(() => {});
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

// A page signed in as the email (no email: a guest). Console and page errors are collected.
async function pageAs(email = '', width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  if (email) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: 'Thử' }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { const u = m.location().url || ''; if (m.type() === 'error' && !/^https:\/\/fonts\.g(oogleapis|static)\.com\//.test(u)) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && !/^https:\/\/(fonts\.g|cdn)/.test(r.url())) errs.push(`HTTP ${r.status()} ${r.url().replace(base, '')}`); });
  return { ctx, page, errs };
}
const owner = (w) => pageAs(OWNER, w);
async function openForm(page, route) {
  await page.goto(`${base}/#/${SLUG}/${route}`);
  await page.waitForSelector('#fpform', { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('.skel'), null, { timeout: 20000 }).catch(() => {});
}
const foldOf = (page) => page.locator('#fpform [data-fp-fold] > details');
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('.toast:not([hidden])'), null, { timeout: 10000 }).catch(() => {});
const shot = async (page, name) => {
  if (!SHOT) return;
  fs.mkdirSync(SHOT, { recursive: true });
  await toastGone(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT, name) });
};
// The profile's text (main) shows the expected line; on a miss the page text is printed for the reader.
async function expectMain(page, re) {
  const ok = await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('main')?.innerText || ''), re.source, { timeout: 20000 }).then(() => true, () => false);
  if (!ok) console.log('MAIN TEXT:', (await page.innerText('main').catch(() => '')).slice(0, 1200));
  assert.ok(ok, `the profile shows ${re}`);
}
const row = async (id) => (await pool.query('select data from persons where id=$1', [id])).rows[0].data;
const eventsOf = async (id, type) => (await pool.query('select type, place, description, date_from from events where person_id=$1 and type=$2', [id, type])).rows;
const waitFor = async (fn, tries = 60) => { for (let i = 0; i < tries; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

test('a new person: no links yet, only a hint (events need a saved person)', { skip }, async () => {
  const { ctx, page, errs } = await owner(390);
  try {
    await openForm(page, 'them');
    assert.equal(await page.locator('#fpform [data-fp-evs] a').count(), 0, 'no event link before the person is saved');
    assert.match(await page.locator('#fpform [data-fp-evs]').textContent(), /Lưu người này trước/, 'the hint says to save first');
    assert.equal(await page.locator('#fpform input[name="place"], #fpform input[name="job"], #fpform input[name="religion"]').count(), 0, 'no place, job or religion input');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('the edit fold shows the four links and "Hiện tại" with "Chuyển thành sự kiện"; the old fields are not inputs', { skip }, async () => {
  const { ctx, page, errs } = await owner(390);
  try {
    await openForm(page, `sua/${P1}`);
    assert.equal(await foldOf(page).evaluate((el) => el.open), true, 'the fold opens: its fields hold values');
    const links = (await page.locator('#fpform [data-fp-evs] .fp-links a').allInnerTexts()).map((t) => t.trim());
    assert.deepEqual(links, ['+ Nơi sống', '+ Nghề nghiệp', '+ Học vấn', '+ Tôn giáo'], 'the four links, in this order');
    const cur = (await page.locator('#fpform [data-fp-evs] .fp-cur').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    assert.equal(cur.length, 3, 'a "Hiện tại" line for each field that holds a value');
    assert.match(cur[0], /Hiện tại: Củ Chi · Chuyển thành sự kiện/);
    assert.match(cur[1], /Hiện tại: Kỹ sư/);
    assert.match(cur[2], /Hiện tại: Công giáo/);
    assert.equal(await page.locator('#fpform input[name="place"], #fpform input[name="job"], #fpform input[name="religion"]').count(), 0, 'the three fields are text now, not inputs');
    await page.reload(); // a real reload, then the shot
    await page.waitForSelector('#fpform [data-fp-evs]', { timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.skel'), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(300); // the form settles after its first draw (the links are drawn again on each change)
    await page.locator('#fpform [data-fp-evs]').scrollIntoViewIfNeeded();
    await shot(page, 'edit-person-links.png');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('"+ Nơi sống" opens the event editor with the type; saving returns to the profile and Thông tin shows the event; the old field stays', { skip }, async () => {
  const { ctx, page, errs } = await owner(390);
  try {
    await openForm(page, `sua/${P1}`);
    await page.locator('#fpform [data-fp-evs] a', { hasText: '+ Nơi sống' }).click();
    await page.waitForFunction(() => location.hash.includes('su-kien/'), null, { timeout: 20000 });
    assert.match(page.url(), /type=chuyen_nha/, 'the link names the type');
    await page.waitForSelector('[data-evx]', { timeout: 20000 });
    assert.equal(await page.locator('[data-evx] select[data-f="type"]').inputValue(), 'chuyen_nha', 'the type is preselected');
    assert.equal((await page.locator('[data-evx] input[data-f="place"]').inputValue()), '', 'a "+" link starts with no place');
    await page.fill('[data-evx] input[data-f="date_text"]', '2008');
    await page.fill('[data-evx] input[data-f="place"]', 'Hà Nội');
    await page.click('[data-evx-save]');
    await page.waitForFunction(() => location.hash.includes('person/') && !location.hash.includes('su-kien'), null, { timeout: 20000 });
    assert.ok(!/tab=life/.test(await page.evaluate(() => location.hash)), 'back on the profile, not on Dòng đời');
    await expectMain(page, /Hà Nội\s*\(từ 2008\)/);
    const events = await eventsOf(P1, 'chuyen_nha');
    assert.equal(events.length, 1, 'one move event is stored');
    assert.equal((await row(P1)).place, 'Củ Chi', 'the old field is not cleared by saving the event');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('"Chuyển thành sự kiện" prefills the job text; "+ Học vấn" opens the education type', { skip }, async () => {
  const { ctx, page, errs } = await owner(390);
  try {
    await openForm(page, `sua/${P1}`);
    await page.locator('#fpform [data-fp-evs] .fp-cur').nth(1).locator('a', { hasText: 'Chuyển thành sự kiện' }).click();
    await page.waitForSelector('[data-evx]', { timeout: 20000 });
    assert.equal(await page.locator('[data-evx] select[data-f="type"]').inputValue(), 'nghe', 'the type is Nghề nghiệp');
    assert.equal(await page.locator('[data-evx] textarea[data-f="description"]').inputValue(), 'Kỹ sư', 'the description is the field text');
    await page.fill('[data-evx] input[data-f="date_text"]', '2010');
    await page.click('[data-evx-save]');
    await expectMain(page, /Kỹ sư\s*\(từ 2010\)/);
    assert.equal((await eventsOf(P1, 'nghe')).length, 1, 'the job event is stored');
    await shot(page, 'profile-current-values.png');
    // the education link: its type, no field behind it
    await openForm(page, `sua/${P1}`);
    await page.locator('#fpform [data-fp-evs] a', { hasText: '+ Học vấn' }).click();
    await page.waitForSelector('[data-evx]', { timeout: 20000 });
    assert.equal(await page.locator('[data-evx] select[data-f="type"]').inputValue(), 'hoc');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('"Bỏ giá trị này" clears the old field on save (editors only)', { skip }, async () => {
  const { ctx, page, errs } = await owner(390);
  try {
    await openForm(page, `sua/${P1}`);
    await page.locator('#fpform [data-fp-clear="religion"]').click();
    assert.equal(await page.locator('#fpform [data-fp-evs] .fp-cur', { hasText: 'Công giáo' }).count(), 0, 'the value is gone from the page');
    await page.click('#fpsave');
    assert.ok(await waitFor(async () => !(await row(P1)).religion), 'the saved religion is empty');
    assert.equal((await row(P1)).job, 'Kỹ sư', 'the other old fields are kept');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('a member: the links send event suggestions (the editor says the editors will review)', { skip }, async () => {
  const m = await pageAs(MEMBER, 390);
  try {
    await openForm(m.page, `sua/${P2}`);
    if (!(await foldOf(m.page).evaluate((d) => d.open))) await m.page.locator('#fpform [data-fp-fold] summary').click();
    assert.equal((await m.page.locator('#fpsave').innerText()).trim(), 'Gửi góp ý', 'the save button sends a suggestion');
    await m.page.locator('#fpform [data-fp-evs] a', { hasText: '+ Nơi sống' }).click();
    await m.page.waitForSelector('[data-evx]', { timeout: 20000 });
    assert.match(await m.page.locator('main').innerText(), /Quản trị sẽ duyệt/, 'the event page says the editors review it');
    await m.page.fill('[data-evx] input[data-f="place"]', 'Bình Chánh');
    await m.page.click('[data-evx-save]');
    assert.ok(await waitFor(async () => (await pool.query("select count(*)::int as n from suggestions where family_id=$1 and person_id=$2 and changes ? '_ev'", [SLUG, P2])).rows[0].n >= 1), 'the event suggestion is stored');
    assert.deepEqual(m.errs, []);
  } finally { await m.ctx.close(); }
});

test('360 px: the edit with the fold open and its links has no horizontal overflow', { skip }, async () => {
  const { ctx, page, errs } = await owner(360);
  try {
    await openForm(page, `sua/${P1}`);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok((await overflow()) <= 0, 'the page fits');
    assert.equal(await foldOf(page).evaluate((el) => el.open), true, 'the fold is open');
    assert.ok((await overflow()) <= 0, 'the fold and its links fit');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});
