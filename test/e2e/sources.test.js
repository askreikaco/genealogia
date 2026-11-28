// E2E: reusable sources and citations (E2) in the browser. Own family (slug srce2e-<tag>).
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright>.
// GP_SHOT_DIR=<dir> also writes the screenshots: form-sources-390.png (the picker open), cite-390.png (the event card
// with its citation line), sources-list-390.png, sources-list-1280.png.
// Covers: the editor adds a new source inside an event, sets its page and quality, saves; the event card shows the
// citation line; a second event picks the same source; "Nguồn tài liệu" lists it with 2 events; no sideways scroll at
// 360 and 390 px; a guest cannot read the list.
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
const SLUG = `srce2e-${TAG}`;
const OWNER = `owner.src.${TAG}@test.local`;
const DEAD_A = `N${TAG}da1`; const DEAD_B = `N${TAG}db2`;
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử nguồn','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$3,$2,$5), ($4,$3,$6,$5)', [
    DEAD_A, { name: 'Dương Văn Nguồn', sex: 'm', gen: 2, born: '1930', died: '1995' }, SLUG, DEAD_B, 'e2e',
    { name: 'Dương Thị Dẫn', sex: 'f', gen: 2, born: '1935', died: '2001' }]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ nguồn',$2,'owner','active')", [OWNER, SLUG]);
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
  await pool.query('delete from history where person_id in ($1,$2)', [DEAD_A, DEAD_B]).catch(() => {});
  await pool.query('delete from ops where person_id in ($1,$2)', [DEAD_A, DEAD_B]).catch(() => {});
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function newPage(width = 390, owner = true) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  if (owner) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ nguồn' }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/^https:\/\/fonts\.g(oogleapis|static)\.com\//.test(m.location().url || '')) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, errs };
}
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('.toast:not([hidden])'), null, { timeout: 10000 }).catch(() => {});
const shot = async (page, name) => { if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await toastGone(page); await page.screenshot({ path: path.join(SHOT, name), fullPage: false }); } };
// The event page for a person (the timeline's add); waits until the editor is drawn and settled.
async function openEventPage(page, id) {
  await page.goto(`${base}/#/${SLUG}/su-kien/${id}`);
  await page.waitForSelector('[data-evx]', { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('.skel'), null, { timeout: 20000 }).catch(() => {});
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

// Sources sit inside "Thêm chi tiết" (a closed native fold on a new event): open it, as a user would before adding one.
// Idempotent (a summary click would toggle it shut again).
const openFold = (page) => page.evaluate(() => { document.querySelector('[data-evx] details[data-disc]').open = true; });

test('the editor adds a new source inside an event, sets its page and quality; the card shows the citation', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, true);
  try {
    await openEventPage(page, DEAD_A);
    await page.selectOption('[data-evx] select[data-f="type"]', 'hoc');
    await page.fill('[data-evx] input[data-f="date_text"]', '1980');
    await page.fill('[data-evx] input[data-f="place"]', 'Huế');
    await page.fill('[data-evx] textarea[data-f="description"]', 'Học trường làng');
    await openFold(page); await page.click('[data-evx] [data-src-add]');
    await page.click('[data-evx] [data-src-newbtn]');
    await page.fill('[data-evx] [data-sr="title"]', 'Gia phả viết tay 1950');
    await page.selectOption('[data-evx] [data-sr="kind"]', 'gia_pha');
    await page.fill('[data-evx] [data-sr="author"]', 'Dương Văn Ất');
    await page.fill('[data-evx] [data-sr="year"]', '1950');
    await page.click('[data-evx] [data-sr-save]');
    await page.waitForSelector('[data-evx] [data-src][data-src-id]', { timeout: 20000 });
    await page.fill('[data-evx] [data-src][data-src-id] [data-sf="page"]', 'tr. 12');
    await page.selectOption('[data-evx] [data-src][data-src-id] [data-sf="quality"]', 'goc');
    await openFold(page); await page.click('[data-evx] [data-src-add]');
    await page.waitForSelector('[data-evx] [data-srcpick]:not([hidden])');
    await shot(page, 'form-sources-390.png');
    await page.click('[data-evx] [data-src-close]');
    await page.click('[data-evx] [data-evx-save]');
    await page.waitForURL(/#\/.*\/person\//, { timeout: 20000 }).catch(() => {});
    await page.goto(`${base}/#/${SLUG}/person/${DEAD_A}`);
    await page.waitForSelector('nav.ptabs', { timeout: 20000 });
    await page.click('button[data-ptab="life"]');
    await page.waitForSelector('.tl2 li', { timeout: 20000 });
    const card = page.locator('.tl2 li', { hasText: 'Học tại Huế' });
    assert.equal(await card.count(), 1, 'the event is on the timeline');
    assert.equal(await card.locator('.src-line').innerText(), 'Gia phả viết tay 1950 · tr. 12', 'the citation line: title and page');
    assert.equal(await noSideScroll(page), true, 'no sideways scroll on the timeline at 390');
    await card.scrollIntoViewIfNeeded();
    await shot(page, 'cite-390.png');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('a second event picks the same source from the list; the Nguồn tài liệu page shows it used twice', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, true);
  try {
    await openEventPage(page, DEAD_B);
    await page.selectOption('[data-evx] select[data-f="type"]', 'nghe');
    await page.fill('[data-evx] textarea[data-f="description"]', 'Thợ dệt');
    await openFold(page); await page.click('[data-evx] [data-src-add]');
    await page.waitForSelector('[data-evx] [data-src-res] [data-src-pick]', { timeout: 20000 });
    await page.fill('[data-evx] [data-src-q]', 'gia phả');
    await page.click('[data-evx] [data-src-res] [data-src-pick]');
    await page.fill('[data-evx] [data-src][data-src-id] [data-sf="page"]', 'mục 3');
    await page.click('[data-evx] [data-evx-save]');
    await page.waitForURL(/#\/.*\/person\//, { timeout: 20000 }).catch(() => {});
    await page.goto(`${base}/#/${SLUG}/nguon-tai-lieu`);
    await page.waitForSelector('[data-sp-id]', { timeout: 20000 });
    const item = page.locator('[data-sp-id]', { hasText: 'Gia phả viết tay 1950' });
    assert.equal(await item.count(), 1, 'the source is listed once');
    assert.match(await item.innerText(), /Dùng ở 2 sự kiện/, 'usage counts both events');
    assert.equal(await item.locator('[data-sp-del]').innerText(), 'Xóa', 'the delete button is labelled Xóa');
    assert.equal(await noSideScroll(page), true, 'no sideways scroll on the list at 390');
    await page.reload({ waitUntil: 'networkidle' }); // a real reload: the screenshot is of a fresh document, not the SPA state
    await page.waitForSelector('[data-sp-id]', { timeout: 20000 });
    await shot(page, 'sources-list-390.png');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
  {
    const c = await newPage(1280, true);
    try {
      await c.page.goto(`${base}/#/${SLUG}/nguon-tai-lieu`);
      await c.page.waitForSelector('[data-sp-id]', { timeout: 20000 });
      await shot(c.page, 'sources-list-1280.png');
    } finally { await c.ctx.close(); }
  }
});

test('360 px: the picker and the list do not scroll sideways; a guest is refused the list', { skip }, async () => {
  const { ctx, page, errs } = await newPage(360, true);
  try {
    await openEventPage(page, DEAD_A);
    await openFold(page); await page.click('[data-evx] [data-src-add]');
    assert.equal(await noSideScroll(page), true, 'the picker at 360');
    await page.goto(`${base}/#/${SLUG}/nguon-tai-lieu`);
    await page.waitForSelector('[data-sp-id]', { timeout: 20000 });
    assert.equal(await noSideScroll(page), true, 'the list at 360');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
  const g = await newPage(390, false);
  try {
    const r = (await fetch(`${base}/api/families/${SLUG}/sources`)).status; // a guest: no session cookie
    assert.equal(r, 401, 'a guest gets no list');
  } finally { await g.ctx.close(); }
});
