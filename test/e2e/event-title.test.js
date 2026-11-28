// E2E: the custom event name (Khác: Tên sự kiện) in the browser. Own family (slug evtt-<tag>), so the seeded data is not touched.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright>.
// GP_SHOT_DIR=<dir> also writes the screenshots (form with the name field and its suggestions, the timeline card with the name).
// Covers: the editor picks type Khác in the person form, the name field shows and the card shows the name (not "Khác");
// a second event (from the timeline) offers the names already used in the family, and a tap fills the field and saves.
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
const SLUG = `evtt-${TAG}`;
const OWNER = `owner.${TAG}@test.local`;
const LIVING = `N${TAG}liv`; const DEAD = `N${TAG}dd1`;
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử tên sự kiện','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$3,$2,$4), ($5,$3,$6,$4)', [
    LIVING, { name: 'Dương Thị Sống', sex: 'f', gen: 3, birth_date: '5/3/1962', born: '1962' }, SLUG, 'e2e',
    DEAD, { name: 'Dương Văn Mất', sex: 'm', gen: 2, born: '1930', died: '1995' }]);
  // names already used in the family: on a deceased person's events (visible to everyone who can read the family)
  const used = [['Xây nhà thờ họ', 1950], ['Xây nhà thờ họ', 1955], ['Đỗ tú tài', 1936]];
  for (const [title, year] of used) {
    await pool.query("insert into events (id, family_id, person_id, type, title, date_kind, date_from, people, sources, photos, is_preferred, created_by) values ($1,$2,$3,'khac',$4,'exact',$5,'[]','[]','[]',true,'e2e')",
      ['E' + crypto.randomBytes(6).toString('hex'), SLUG, DEAD, title, String(year)]);
  }
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
  await pool.query('delete from suggestions where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id in ($1,$2)', [LIVING, DEAD]).catch(() => {});
  await pool.query('delete from ops where person_id in ($1,$2)', [LIVING, DEAD]).catch(() => {});
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function newOwnerPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
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
const lifeTab = async (page, id) => {
  await page.goto(`${base}/#/${SLUG}/person/${id}`);
  await page.waitForSelector('nav.ptabs', { timeout: 20000 });
  await page.click('button[data-ptab="life"]');
  await page.waitForFunction(() => document.querySelector('#tl-body'), null, { timeout: 20000 });
};
// a toast sits above the bottom nav and hides text while it shows: the screenshot waits until it is gone
const shot = async (page, name, locator = null) => {
  if (!SHOT) return;
  fs.mkdirSync(SHOT, { recursive: true });
  await page.waitForFunction(() => !document.querySelector('.toast:not([hidden])'), null, { timeout: 10000 }).catch(() => {});
  if (locator) await locator.screenshot({ path: path.join(SHOT, name) }); else await page.screenshot({ path: path.join(SHOT, name) });
};

test('the editor adds a Khác event with a name in the person form: the field shows, the card shows the name', { skip }, async () => {
  const { ctx, page, errs } = await newOwnerPage();
  try {
    await page.goto(`${base}/#/${SLUG}/sua/${LIVING}`);
    await page.waitForSelector('#fpform', { timeout: 20000 });
    await page.waitForSelector('[data-acc-btn="su"]', { timeout: 20000 });
    for (let i = 0; i < 10 && (await page.getAttribute('[data-acc-btn="su"]', 'aria-expanded')) !== 'true'; i++) {
      await page.click('[data-acc-btn="su"]').catch(() => {});
      await page.waitForTimeout(300);
    }
    await page.waitForSelector('[data-fev-add]', { timeout: 20000 });
    await page.click('[data-fev-add]');
    assert.equal(await page.locator('#fev-ed [data-tt-wrap]').isHidden(), true, 'the name field is hidden for other types');
    await page.selectOption('#fev-ed select[data-f="type"]', 'khac');
    assert.equal(await page.locator('#fev-ed [data-tt-wrap]').isVisible(), true, 'the name field shows for Khác');
    await page.fill('#fev-ed input[data-f="title"]', 'Bia mộ tổ');
    await page.fill('#fev-ed input[data-f="date_text"]', '1975');
    await page.fill('#fev-ed textarea[data-f="description"]', 'Đặt tại nghĩa trang làng');
    await page.click('#fev-ed [data-evx-save]');
    await page.waitForSelector('#fev-list :text("Bia mộ tổ")', { timeout: 20000 });
    await page.click('#fpsave');
    await page.waitForSelector('nav.ptabs', { timeout: 20000 });
    await lifeTab(page, LIVING);
    const card = page.locator('.tl2 li', { hasText: 'Bia mộ tổ' });
    assert.equal(await card.count(), 1, 'the card shows the name as its heading');
    assert.equal(await card.locator('h3').innerText(), 'Bia mộ tổ');
    assert.equal(await page.locator('.tl2 li', { hasText: 'Đặt tại nghĩa trang làng' }).count() > 0, true, 'the description stays in the card');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('a second Khác event offers the names already used in the family; a tap fills the field and saves', { skip }, async () => {
  const { ctx, page, errs } = await newOwnerPage();
  try {
    await page.goto(`${base}/#/${SLUG}/su-kien/${LIVING}`);
    await page.waitForSelector('.evpage [data-evx]', { timeout: 20000 });
    await page.selectOption('.evpage select[data-f="type"]', 'khac');
    await page.click('.evpage input[data-f="title"]');
    await page.waitForSelector('.evpage [data-tt-pick]', { timeout: 20000 });
    const offered = await page.locator('.evpage [data-tt-pick]').allInnerTexts();
    assert.ok(offered.some((t) => t.startsWith('Xây nhà thờ họ')), 'the family’s name is offered: ' + offered.join(' | '));
    assert.ok(offered.some((t) => t.startsWith('Bia mộ tổ')), 'a name used on this person is offered too');
    assert.ok(offered[0].startsWith('Xây nhà thờ họ'), 'most used first');
    // a viewport shot (390x844): the name field with its suggestions open, scrolled into view
    await page.locator('.evpage input[data-f="title"]').scrollIntoViewIfNeeded();
    await page.waitForSelector('.evpage [data-tt-pick]');
    await shot(page, 'form-title-suggestions-390.png');
    await page.click('.evpage [data-tt-pick="Xây nhà thờ họ"]');
    assert.equal(await page.inputValue('.evpage input[data-f="title"]'), 'Xây nhà thờ họ');
    await page.fill('.evpage input[data-f="date_text"]', '1960');
    await page.click('.evpage [data-evx-save]');
    await page.waitForSelector('nav.ptabs', { timeout: 20000 });
    await lifeTab(page, LIVING);
    const card = page.locator('.tl2 li', { hasText: 'Xây nhà thờ họ' });
    assert.equal(await card.count(), 1, 'the second event is on the timeline under its name');
    await shot(page, 'timeline-title-card-390.png', card);
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});
