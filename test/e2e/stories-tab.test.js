// E2E: the Câu chuyện tab. Tabs are Thông tin · Dòng đời · Câu chuyện · Tư liệu; the summary and the stories moved
// off Thông tin to it; ?tab= deep links work and old links open Thông tin; an editor adds a story tagging two people and
// it shows on the owner and on both tagged profiles with "Kể bởi"; a guest does not see a living tagged person;
// the four tabs fit at 360 px and 390 px. Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch>
// NODE_PATH=<dir with playwright>. GP_SHOT_DIR=<dir> also writes the screenshots.
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
const SLUG = `stui-${TAG}`;
const OWNER = `owner.${TAG}@test.local`; const MEMBER = `member.${TAG}@test.local`;
const FATHER = `N${TAG}pa1`; const LIVING = `N${TAG}liv`; const DEAD_CHILD = `N${TAG}ch2`;
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
const TITLE_OLD = 'Ngày giỗ ông nội'; const TITLE_NEW = 'Chuyến về quê';
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử câu chuyện','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$4,$2,$5), ($3,$4,$6,$5), ($7,$4,$8,$5)', [
    FATHER, { name: 'Dương Văn Cha', sex: 'm', gen: 2, born: '1930', died: '1995' }, LIVING,
    SLUG, 'e2e', { name: 'Dương Thị Con', sex: 'f', gen: 3, parent: FATHER, birth_date: '5/3/1962', born: '1962' },
    DEAD_CHILD, { name: 'Dương Thị Mất', sex: 'f', gen: 3, parent: FATHER, born: '1960', died: '2001' }]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$2,'owner','active'), ($3,'Thành viên e2e',$2,'member','active')", [OWNER, SLUG, MEMBER]);
  // the saved summary of LIVING (the auto summary needs events; the edit test changes this one)
  await pool.query("insert into stories (id, family_id, person_id, kind, title, body, created_by) values ($1,$2,$3,'tom_tat','Câu chuyện đời','Bản đầu của tóm tắt.','e2e')", ['S' + crypto.randomBytes(6).toString('hex'), SLUG, LIVING]);
  // one more story of LIVING, told by the owner (the Câu chuyện screenshot shows the summary and two stories)
  await pool.query("insert into stories (id, family_id, person_id, kind, title, body, created_by, created_at) values ($1,$2,$3,'chuyen','Ngày cưới','Ngày cưới được tổ chức ngay tại quê nhà.','Chủ họ e2e', now() - interval '1 day')", ['S' + crypto.randomBytes(6).toString('hex'), SLUG, LIVING]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip || !pool) return;
  await browser?.close();
  srv?.close();
  await pool.query('delete from stories where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from suggestions where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id in ($1,$2,$3)', [FATHER, LIVING, DEAD_CHILD]).catch(() => {});
  await pool.query('delete from ops where person_id in ($1,$2,$3)', [FATHER, LIVING, DEAD_CHILD]).catch(() => {});
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

// A browser page, signed in as the test account (owner or member), or a guest when email is null.
async function newPage(width, email = null, scheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  if (email) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email === OWNER ? 'Chủ họ e2e' : 'Thành viên e2e' }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/^https:\/\/fonts\.g(oogleapis|static)\.com\//.test(m.location().url || '')) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, errs };
}
const goProfile = async (page, id, query = '') => {
  await page.goto(`${base}/#/${SLUG}/person/${id}${query}`);
  await page.waitForSelector('nav.ptabs', { timeout: 20000 });
};
// The tab bar's labels, in order.
const tabLabels = (page) => page.$$eval('nav.ptabs .ptab', (els) => els.map((e) => e.textContent.trim()));
const shot = async (page, name) => {
  if (!SHOT) return;
  fs.mkdirSync(SHOT, { recursive: true });
  await page.waitForFunction(() => !document.querySelector('.toast:not([hidden])'), null, { timeout: 10000 }).catch(() => {});
  await page.screenshot({ path: path.join(SHOT, name), fullPage: false });
};

test('tab order: Thông tin · Dòng đời · Câu chuyện · Tư liệu, and the four tabs fit at 360 and 390 px without page overflow', { skip }, async () => {
  for (const width of [360, 390]) {
    const { ctx, page, errs } = await newPage(width, OWNER);
    try {
      await goProfile(page, FATHER);
      assert.deepEqual(await tabLabels(page), ['Thông tin', 'Dòng đời', 'Câu chuyện', 'Tư liệu']);
      const geo = await page.evaluate(() => {
        const nav = document.querySelector('nav.ptabs');
        return { pageW: document.documentElement.scrollWidth, winW: window.innerWidth, navScroll: nav.scrollWidth, navClient: nav.clientWidth };
      });
      assert.ok(geo.pageW <= geo.winW, `${width} px: the page does not scroll sideways (${geo.pageW} > ${geo.winW})`);
      assert.ok(geo.navScroll <= geo.navClient, `${width} px: the four tabs fit the bar (${geo.navScroll} > ${geo.navClient})`);
      if (SHOT) { // the tab bar header (a clip after a real reload): 360 and 390 px
        fs.mkdirSync(SHOT, { recursive: true }); await page.reload(); await page.waitForSelector('nav.ptabs'); await page.waitForTimeout(400);
        const b = await page.locator('nav.ptabs').boundingBox();
        await page.screenshot({ path: path.join(SHOT, `stories-tabs-${width}.png`), clip: { x: 0, y: Math.max(0, b.y - 60), width, height: b.height + 120 } });
      }
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
});

test('the summary and the stories are on Câu chuyện, not on Thông tin; old and deep links', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, OWNER);
  try {
    // the summary (seeded for LIVING in before): the owner edits it, and the tab shows the new text
    await goProfile(page, LIVING, '?tab=story');
    await page.waitForSelector('[data-sum-edit]');
    await page.click('[data-sum-edit]');
    await page.waitForSelector('dialog.evdlg [data-s="body"]');
    await page.fill('dialog.evdlg [data-s="body"]', 'Gia đình giữ lễ giỗ hằng năm.');
    await page.click('dialog.evdlg [data-stx-save]');
    await page.waitForFunction(() => !document.querySelector('dialog.evdlg'), null, { timeout: 15000 });
    // Thông tin has no stories block (after a real reload)
    await goProfile(page, LIVING);
    await page.reload(); await page.waitForSelector('nav.ptabs');
    await page.waitForFunction(() => document.querySelector('button[data-ptab="info"]')?.getAttribute('aria-selected') === 'true');
    assert.equal(await page.locator('.lifestory, .lifeblock').count(), 0, 'no Câu chuyện đời block on Thông tin');
    await shot(page, 'stories-info-390-light.png');
    // the tab shows it, and the address names the tab
    await page.click('button[data-ptab="story"]');
    await page.waitForSelector('.lifestory');
    assert.match(await page.textContent('.lifestory'), /giữ lễ giỗ/);
    assert.match(page.url(), /person\/[^?]+\?tab=story$/, 'the tab is in the address');
    // a deep link opens the tab; an old link (no tab) opens Thông tin
    await goProfile(page, LIVING, '?tab=story');
    await page.waitForSelector('.lifestory');
    assert.equal(await page.getAttribute('button[data-ptab="story"]', 'aria-selected'), 'true');
    await goProfile(page, LIVING);
    assert.equal(await page.getAttribute('button[data-ptab="info"]', 'aria-selected'), 'true', 'an old link opens Thông tin');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('an editor adds a story tagging two people: it shows on the owner and on both tagged profiles, with Kể bởi', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, OWNER);
  try {
    await goProfile(page, FATHER, '?tab=story');
    await page.waitForSelector('[data-st-add]');
    await page.click('[data-st-add]');
    await page.waitForSelector('dialog.evdlg [data-s="title"]');
    await page.fill('dialog.evdlg [data-s="title"]', TITLE_NEW);
    await page.fill('dialog.evdlg [data-s="body"]', 'Cả nhà về quê dự lễ, ăn cơm cùng nhau.');
    for (const name of ['Dương Thị Mất', 'Dương Thị Con']) {
      await page.fill('dialog.evdlg [data-pk-q]', name);
      await page.click(`dialog.evdlg [data-pk-res] [data-pick]:has-text("${name}")`);
    }
    assert.equal(await page.locator('dialog.evdlg [data-chips] [data-pid]').count(), 2, 'two people tagged');
    await shot(page, 'stories-form-390-light.png');
    await page.click('dialog.evdlg [data-stx-save]');
    await page.waitForFunction(() => !document.querySelector('dialog.evdlg'), null, { timeout: 15000 });
    // the owner's tab: the story, its teller and the tagged people
    await goProfile(page, FATHER, '?tab=story');
    await page.waitForSelector(`article.stry:has-text("${TITLE_NEW}")`);
    const card = page.locator(`article.stry:has-text("${TITLE_NEW}")`);
    assert.match(await card.innerText(), /Kể bởi Chủ họ e2e/, 'Kể bởi on the card');
    assert.match(await card.innerText(), /Với .*Dương Thị Mất/);
    // both tagged people see it on their own Câu chuyện tab
    for (const id of [DEAD_CHILD, LIVING]) {
      await goProfile(page, id, '?tab=story');
      await page.waitForSelector(`article.stry:has-text("${TITLE_NEW}")`, { timeout: 15000 });
    }
    // the summary and two stories of LIVING, newest first, after a real reload (the screenshot)
    await goProfile(page, LIVING, '?tab=story');
    await page.reload(); await page.waitForSelector('nav.ptabs');
    await page.waitForSelector('.lifestory'); await page.waitForSelector('article.stry');
    const titles = await page.$$eval('article.stry h3', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(titles.slice(0, 2), [TITLE_NEW, 'Ngày cưới'], 'newest first');
    await shot(page, 'stories-tab-390-light.png');
    await goProfile(page, FATHER, '?tab=story');
    await page.waitForSelector(`article.stry:has-text("${TITLE_NEW}")`);
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('a member (not an editor) cannot save directly: the story goes to the queue and says so; a guest sees no add button', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, MEMBER);
  try {
    await goProfile(page, FATHER, '?tab=story');
    await page.waitForSelector('[data-st-add]');
    await page.click('[data-st-add]');
    await page.waitForSelector('dialog.evdlg [data-s="title"]');
    assert.match(await page.textContent('dialog.evdlg'), /Quản trị sẽ duyệt/);
    await page.fill('dialog.evdlg [data-s="title"]', 'Góp của thành viên');
    await page.fill('dialog.evdlg [data-s="body"]', 'Chuyện kể của thành viên.');
    await page.click('dialog.evdlg [data-stx-save]');
    await page.waitForFunction(() => !document.querySelector('dialog.evdlg'), null, { timeout: 15000 });
    assert.equal(await page.locator('article.stry:has-text("Góp của thành viên")').count(), 0, 'not shown before approval');
    await page.close();
  } finally { await ctx.close(); }
  const guest = await newPage(390, null);
  try {
    await goProfile(guest.page, FATHER, '?tab=story');
    await guest.page.waitForSelector('.lifestory, #main h1, .emp, .empty', { timeout: 15000 }).catch(() => {});
    assert.equal(await guest.page.locator('[data-st-add]').count(), 0, 'no add button for a guest');
    assert.deepEqual(guest.errs, []);
  } finally { await guest.ctx.close(); }
  assert.deepEqual(errs, []);
});

test('a guest sees the owner\'s story without the living tagged person (the tag is not shown)', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, null);
  try {
    await goProfile(page, FATHER, '?tab=story');
    await page.waitForSelector(`article.stry:has-text("${TITLE_NEW}")`, { timeout: 15000 });
    const text = await page.locator(`article.stry:has-text("${TITLE_NEW}")`).innerText();
    assert.doesNotMatch(text, /Dương Thị Con/, 'a living person is not named to a guest');
    assert.match(text, /Dương Thị Mất/, 'the deceased tagged person is named');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

// The toolbar of the Câu chuyện tab (the shared list bar, as on Dòng đời): search narrows the list live, the filter
// sheet has one choice of who the stories are about or by, "+" is for members only, the summary is never filtered,
// and the four tabs and the bar fit at 360 px. LIVING has the summary and two stories ("Chuyến về quê" tags LIVING,
// "Ngày cưới" is LIVING's own), so each filter has something to show and something to hide.
test('toolbar: search narrows live, each filter works, the summary is not filtered, no match is an empty state', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, OWNER);
  try {
    await goProfile(page, LIVING, '?tab=story');
    await page.waitForSelector('article.stry');
    const shownTitles = () => page.$$eval('article.stry h3', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual((await shownTitles()).sort(), [TITLE_NEW, 'Ngày cưới'].sort(), 'both stories before any filter');
    // search: live, by words in the body
    await page.fill('#stq', 'cưới');
    await page.waitForFunction(() => document.querySelectorAll('article.stry').length === 1);
    assert.deepEqual(await shownTitles(), ['Ngày cưới'], 'the search narrows to the matching story');
    assert.equal(await page.locator('.lifestory').count(), 1, 'the summary stays above the list');
    assert.equal(await page.locator('#stq').inputValue(), 'cưới', 'the search box keeps its text');
    // no match: the empty state of the list
    await page.fill('#stq', 'không có chữ này');
    await page.waitForFunction(() => document.querySelector('#st-body')?.innerText.includes('Không có câu chuyện nào khớp.'));
    assert.equal(await page.locator('article.stry').count(), 0);
    assert.equal(await page.locator('.lifestory').count(), 1, 'the summary is still there');
    await page.fill('#stq', '');
    await page.waitForFunction(() => document.querySelectorAll('article.stry').length === 2);
    // the filter sheet: Về người này (its own stories), then Có nhắc đến (mentions this person), then back to Tất cả
    await page.click('[data-fp]');
    await page.waitForSelector('dialog.fpanel[open]');
    await page.check('dialog.fpanel input[data-st-who="about"]');
    await page.click('dialog.fpanel [data-fpx]');
    await page.waitForFunction(() => document.querySelectorAll('article.stry').length === 1);
    assert.deepEqual(await shownTitles(), ['Ngày cưới'], 'Về người này: only the stories of this person');
    await page.click('[data-fp]');
    await page.check('dialog.fpanel input[data-st-who="tagged"]');
    await page.click('dialog.fpanel [data-fpx]');
    await page.waitForFunction((t) => document.querySelector('article.stry h3')?.textContent.includes(t), TITLE_NEW);
    assert.deepEqual(await shownTitles(), [TITLE_NEW], 'Có nhắc đến: the stories that name this person');
    // "Do tôi kể": the owner told both stories
    await page.click('[data-fp]');
    await page.check('dialog.fpanel input[data-st-who="mine"]');
    await page.click('dialog.fpanel [data-fpx]');
    await page.waitForFunction(() => document.querySelectorAll('article.stry').length === 2);
    assert.equal(await page.locator('.ltags').count(), 1, 'the active filter shows as a chip');
    // the chip removes the filter (Xóa lọc / the chip itself)
    await page.click('.ltags .tag.remove'); // one active filter: its chip removes it
    await page.waitForFunction(() => document.querySelectorAll('article.stry').length === 2);
    assert.equal(await page.locator('.ltags').count(), 0, 'no chips when nothing is filtered');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('toolbar for a guest: no "+", no "Do tôi kể"; at 360 px the bar and the tabs fit with no page overflow', { skip }, async () => {
  const guest = await newPage(360, null);
  try {
    // a living person is hidden from a guest: the deceased owner's tab
    await goProfile(guest.page, FATHER, '?tab=story');
    await guest.page.waitForSelector('#stq');
    assert.equal(await guest.page.locator('[data-st-add]').count(), 0, 'no + for a guest');
    await guest.page.click('[data-fp]');
    await guest.page.waitForSelector('dialog.fpanel[open]');
    assert.equal(await guest.page.locator('dialog.fpanel input[data-st-who="mine"]').count(), 0, 'no "Do tôi kể" for a guest');
    assert.equal(await guest.page.locator('dialog.fpanel input[data-st-who="about"]').count(), 1);
    await guest.page.click('dialog.fpanel [data-fpx]');
    const geo = await guest.page.evaluate(() => ({ pageW: document.documentElement.scrollWidth, winW: window.innerWidth,
      bar: document.querySelector('#st-bar .lbar')?.getBoundingClientRect().right ?? 0, barBox: document.querySelector('#st-bar')?.getBoundingClientRect().right ?? 0 }));
    assert.ok(geo.pageW <= geo.winW, `360 px: the page does not scroll sideways (${geo.pageW} > ${geo.winW})`);
    assert.ok(geo.bar <= geo.barBox + 0.5, 'the toolbar sits inside the bar width');
    assert.deepEqual(guest.errs, []);
  } finally { await guest.ctx.close(); }
});

test('the filter sheet on the Câu chuyện tab (screenshot after a real reload)', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, OWNER);
  try {
    await goProfile(page, LIVING, '?tab=story');
    await page.reload(); await page.waitForSelector('nav.ptabs');
    await page.waitForSelector('article.stry');
    await page.click('[data-fp]');
    await page.waitForSelector('dialog.fpanel[open]');
    await shot(page, 'stories-filter-390.png');
    await page.click('dialog.fpanel [data-fpx]');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});
