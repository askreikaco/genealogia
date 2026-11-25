// E2E: photos on life events and offline event edits. Own family (slug evph-<tag>). Needs a SCRATCH database:
// GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright>. GP_SHOT_DIR=<dir> writes
// ev2-photo.png (a living person's timeline with a photo event, 390x844).
// Covers: the editor adds an event with a photo on the event page and it shows on Dòng đời with the photo; a guest
// sees no photo of a living person; offline the editor saves an event (it shows as "Chưa gửi"), and when the network
// is back the event is on the server, the mark is gone and the row is shown once.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
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
const SLUG = `evph-${TAG}`;
const OWNER = `owner.${TAG}@test.local`;
const LIVING = `N${TAG}liv`;
const DEAD = `N${TAG}dd1`;
// A 1x1 PNG (a real image the browser can decode before it is resized and uploaded).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser, pngPath;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử ảnh sự kiện','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$3,$2,$6), ($4,$3,$5,$6)', [
    LIVING, { name: 'Dương Thị Sống', sex: 'f', gen: 4, birth_date: '5/3/1962', born: '1962' }, SLUG, DEAD,
    { name: 'Dương Văn Mất', sex: 'm', gen: 3, born: '1930', died: '1995' }, 'e2e']);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$2,'owner','active')", [OWNER, SLUG]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  pngPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evph-')), 'anh.png');
  fs.writeFileSync(pngPath, PNG);
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip || !pool) return;
  await browser?.close();
  srv?.close();
  await pool.query('delete from events where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id in ($1,$2)', [LIVING, DEAD]).catch(() => {});
  await pool.query('delete from ops where person_id in ($1,$2)', [LIVING, DEAD]).catch(() => {});
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
  try { fs.rmSync(path.dirname(pngPath), { recursive: true, force: true }); } catch {}
});

async function newPage(width = 390, owner = false) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  if (owner) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
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
  await page.waitForFunction(() => document.querySelector('#tl-body') || /chỉ thành viên xem được/.test(document.querySelector('#main')?.innerText || ''), null, { timeout: 20000 });
};
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('.toast:not([hidden])'), null, { timeout: 10000 }).catch(() => {});
// Opens the event page for a person (the timeline's add), fills the form and returns the page.
async function openEventPage(page, id) {
  await page.goto(`${base}/#/${SLUG}/su-kien/${id}`);
  await page.waitForSelector('[data-evx]', { timeout: 20000 });
  // the page draws again once its events have loaded: wait for that before typing into it
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('.skel'), null, { timeout: 20000 }).catch(() => {});
}

test('the editor attaches a photo to an event; it shows on Dòng đời with the photo; a guest does not see it', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, true);
  try {
    await openEventPage(page, LIVING);
    await page.selectOption('[data-evx] select[data-f="type"]', 'hoc');
    await page.fill('[data-evx] input[data-f="date_text"]', '1980');
    await page.fill('[data-evx] input[data-f="place"]', 'TP. Hồ Chí Minh');
    await page.fill('[data-evx] textarea[data-f="description"]', 'Tốt nghiệp');
    // a late redraw can drop the file: pick it again until the photo is in the form
    for (let i = 0; i < 3; i++) {
      await page.setInputFiles('[data-evx] [data-evx-photo]', pngPath);
      if (await page.waitForFunction(() => document.querySelector('[data-evx] [data-phs] [data-ph]'), null, { timeout: 8000 }).then(() => true, () => false)) break;
    }
    await page.waitForFunction(() => document.querySelector('[data-evx] [data-phs] [data-ph]') || /Tối đa|mạng|quyền|lỗi/i.test(document.querySelector('[data-evx-photomsg]')?.textContent || ''), null, { timeout: 20000 });
    assert.equal(await page.locator('[data-evx] [data-phs] [data-ph]').count(), 1, 'photo added in the editor: ' + (await page.textContent('[data-evx-photomsg]')));
    await page.click('[data-evx] [data-evx-save]');
    await lifeTab(page, LIVING);
    const row = page.locator('.tl2 li', { hasText: 'Tốt nghiệp' });
    await row.first().waitFor({ timeout: 20000 });
    assert.equal(await row.count(), 1, 'event on the timeline');
    assert.equal(await row.locator('.ev-ph img').count(), 1, 'the photo is on the event card');
    assert.match(await row.innerText(), /Học hành/, 'the type chosen in the form is kept');
    const src = await row.locator('.ev-ph img').getAttribute('src');
    assert.match(src, /^\/api\/photos\/[0-9a-f]{24}$/);
    const img = await page.request.get(base + src);
    assert.equal(img.status(), 200, 'the photo is served');
    await toastGone(page);
    if (SHOT) {
      // the card with its photo, in view under the sticky bar, 390x844
      await row.first().evaluate((el) => el.scrollIntoView({ block: 'start' })); await page.evaluate(() => window.scrollBy(0, -120));
      await page.waitForTimeout(300); fs.mkdirSync(SHOT, { recursive: true }); await page.screenshot({ path: path.join(SHOT, 'ev2-photo.png') });
    }
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }

  const guest = await newPage(390, false);
  try {
    await guest.page.goto(`${base}/#/${SLUG}/person/${LIVING}`);
    await guest.page.waitForSelector("#main h1", { timeout: 20000 });
    assert.equal(await guest.page.locator("nav.ptabs").count(), 0, "a living person: no tabs for a guest");
    assert.equal(await guest.page.locator('.ev-ph img').count(), 0, 'no photo for a guest');
    assert.deepEqual(guest.errs, []);
  } finally { await guest.ctx.close(); }
});

test('offline the editor saves an event: it shows as "Chưa gửi", and after the network is back it is on the server once', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, true);
  try {
    await lifeTab(page, DEAD); // the page has loaded once, so the app and its data are on the device
    await ctx.setOffline(true);
    await openEventPage(page, DEAD);
    await page.selectOption('[data-evx] select[data-f="type"]', 'nghe');
    await page.fill('[data-evx] input[data-f="date_text"]', '1960');
    await page.fill('[data-evx] textarea[data-f="description"]', 'Viết sổ gia phả');
    await page.click('[data-evx] [data-evx-save]');
    await page.waitForFunction(() => /Chưa gửi/.test(document.querySelector('#main')?.innerText || '') || /Chưa gửi|tiếp theo|khi có mạng/.test(document.querySelector('.toast')?.innerText || ''), null, { timeout: 20000 });
    await lifeTab(page, DEAD);
    const pending = page.locator('.tl2 li', { hasText: 'Viết sổ gia phả' });
    await pending.first().waitFor({ timeout: 20000 });
    assert.equal(await pending.count(), 1, 'the queued event is drawn once');
    assert.match(await pending.innerText(), /Chưa gửi/, 'marked as not sent yet');
    const before = await pool.query('select count(*)::int as n from events where person_id=$1 and description=$2', [DEAD, 'Viết sổ gia phả']);
    assert.equal(before.rows[0].n, 0, 'not on the server while offline');

    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    let n = 0;
    for (let i = 0; i < 60 && n === 0; i++) {
      await page.waitForTimeout(500);
      n = (await pool.query('select count(*)::int as n from events where person_id=$1 and description=$2', [DEAD, 'Viết sổ gia phả'])).rows[0].n;
    }
    assert.equal(n, 1, 'sent once after the network came back');
    await lifeTab(page, DEAD);
    await page.waitForTimeout(500);
    const rows = page.locator('.tl2 li', { hasText: 'Viết sổ gia phả' });
    assert.equal(await rows.count(), 1, 'shown once, from the server');
    assert.doesNotMatch(await rows.innerText(), /Chưa gửi/, 'no pending mark after the sync');
    // the failed requests while offline are the point of the test; anything else is a bug
    assert.deepEqual(errs.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource|NetworkError/.test(e)), []);
  } finally { await ctx.close(); }
});

test('offline reading: a timeline loaded online is still shown offline after a reload (from the device)', { skip }, async () => {
  await pool.query("insert into events (id, family_id, person_id, type, date_text, date_kind, date_from, description, people, sources, photos, created_by) values ($1,$2,$3,'nghe','1955','exact','1955','Dạy học Bến Tre','[]','[]','[]','e2e')", ['E' + crypto.randomBytes(6).toString('hex'), SLUG, DEAD]);
  const { ctx, page, errs } = await newPage(390, true);
  try {
    await lifeTab(page, DEAD);
    await page.waitForSelector('.tl2 li:has-text("Dạy học Bến Tre")', { timeout: 20000 });
    await page.waitForTimeout(1000); // the read is kept on the device after it is drawn
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('nav.ptabs', { timeout: 30000 });
    await page.click('button[data-ptab="life"]');
    await page.waitForSelector('.tl2 li:has-text("Dạy học Bến Tre")', { timeout: 20000 });
    assert.match(await page.textContent('#main'), /đang xem dữ liệu đã lưu trên máy/, 'says the timeline is from the device');
    assert.deepEqual(errs.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource|NetworkError|status of (401|403|404)/.test(e)), []);
  } finally { await ctx.close(); }
});
