// E2E: life events and stories in the browser. Own family (slug evui-<tag>), so the seeded data is not touched.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright>.
// GP_SHOT_DIR=<dir> also writes the screenshots (form events 390, timeline 390 light and dark, timeline 1280).
// Covers: a guest sees no events of a living person (and a suggestion is refused); the editor adds an event in the
// person form (saved with the form), it appears on Dòng đời with its age; a deceased person's family events
// (child and grandchild born) show and the "Con cháu" switch hides them; the "Lịch sử" switch adds wars, reign bands and
// events inside the life; Câu chuyện đời edit is saved and shown again.
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
const SLUG = `evui-${TAG}`;
const OWNER = `owner.${TAG}@test.local`;
const DEAD_PARENT = `N${TAG}pa1`; const LIVING = `N${TAG}liv`; const DEAD_CHILD = `N${TAG}ch2`; const GRAND = `N${TAG}gc3`;
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử e2e','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$4,$2,$5), ($3,$4,$6,$5), ($7,$4,$8,$5), ($9,$4,$10,$5)', [
    DEAD_PARENT, { name: 'Dương Văn Cha', sex: 'm', gen: 2, born: '1930', died: '1995' }, LIVING,
    SLUG, 'e2e', { name: 'Dương Thị Con', sex: 'f', gen: 3, parent: DEAD_PARENT, birth_date: '5/3/1962', born: '1962' },
    DEAD_CHILD, { name: 'Dương Thị Mất', sex: 'f', gen: 3, parent: DEAD_PARENT, born: '1960', died: '2001' },
    GRAND, { name: 'Nguyễn Văn Cháu', sex: 'm', gen: 4, parent: DEAD_CHILD, born: '1985', died: '2005' }]);
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
  await pool.query('delete from stories where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from suggestions where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id in ($1,$2,$3,$4)', [DEAD_PARENT, LIVING, DEAD_CHILD, GRAND]).catch(() => {});
  await pool.query('delete from ops where person_id in ($1,$2,$3,$4)', [DEAD_PARENT, LIVING, DEAD_CHILD, GRAND]).catch(() => {});
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function newPage(width = 390, scheme = 'light', owner = false) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
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
const profile = async (page, id) => {
  await page.goto(`${base}/#/${SLUG}/person/${id}`);
  await page.waitForSelector('nav.ptabs', { timeout: 20000 });
};
const lifeTab = async (page) => {
  await page.click('button[data-ptab="life"]');
  await page.waitForFunction(() => document.querySelector('#tl-body') || /chỉ thành viên xem được/.test(document.querySelector('#main')?.innerText || ''), null, { timeout: 20000 });
};
// A toast sits above the bottom nav and hides text while it shows: the screenshot waits until it is gone.
const shot = async (page, name) => { if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await page.waitForFunction(() => !document.querySelector('.toast:not([hidden])'), null, { timeout: 10000 }).catch(() => {}); await page.screenshot({ path: path.join(SHOT, name), fullPage: false }); } };

test('a guest sees no events of a living person, and a suggestion for one is refused', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, 'light', false);
  try {
    await page.goto(`${base}/#/${SLUG}/person/${LIVING}`);
    await page.waitForSelector("#main h1", { timeout: 20000 });
    assert.equal(await page.locator("nav.ptabs").count(), 0, "a living person: no tabs for a guest");
    assert.equal(await page.locator(".tl2 li").count(), 0, "no timeline rows for a guest");
    const refused = await page.evaluate(async ([fam, id]) => (await fetch('/api/suggest', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ family: fam, person_id: id, changes: { _ev: { action: 'add', kind: 'event', item: { type: 'hoc', date_kind: 'exact', date_from: '1990', sources: [] } } } }) })).status, [SLUG, LIVING]);
    assert.equal(refused, 403);
    assert.deepEqual(errs.filter((e) => !/status of 403/.test(e)), [], 'the 403 above is the refusal this test asks for');
  } finally { await ctx.close(); }
});

test('the editor adds an event in the form, it shows on Dòng đời with the age; family events filter', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, 'light', true);
  try {
    await page.goto(`${base}/#/${SLUG}/sua/${LIVING}`);
    await page.waitForSelector('#fpform', { timeout: 20000 });
    // a sync can redraw the form once more after it appears: open the section again until it is open
    await page.waitForSelector('[data-acc-btn="su"]', { timeout: 20000 });
    for (let i = 0; i < 10 && (await page.getAttribute('[data-acc-btn="su"]', 'aria-expanded')) !== 'true'; i++) {
      await page.click('[data-acc-btn="su"]').catch(() => {});
      await page.waitForTimeout(300);
    }
    await page.waitForSelector('[data-fev-add]', { timeout: 20000 });
    await page.click('[data-fev-add]');
    await page.selectOption('#fev-ed select[data-f="type"]', 'hoc');
    await page.fill('#fev-ed input[data-f="date_text"]', '1980');
    await page.fill('#fev-ed input[data-f="place"]', 'TP. Hồ Chí Minh');
    await page.fill('#fev-ed textarea[data-f="description"]', 'Khoa Toán');
    await shot(page, 'form-events-390.png');
    await page.click('#fev-ed [data-evx-save]');
    await page.waitForSelector('#fev-list :text("Học tại TP. Hồ Chí Minh")');
    await page.click('#fpsave');
    await page.waitForSelector('nav.ptabs', { timeout: 20000 });
    await lifeTab(page);
    const row = page.locator('.tl2 li', { hasText: 'Học tại TP. Hồ Chí Minh' });
    assert.equal(await row.count(), 1, 'event on the timeline');
    assert.match(await row.innerText(), /~18 tuổi/, 'age from the full birth date and the year of the event');
    const birthRow = page.locator('.tl2 li.rel', { hasText: 'Ra đời' }).first();
    assert.doesNotMatch(await birthRow.innerText(), /tuổi/, 'no age on the own-birth row');
    await shot(page, 'timeline-390-light.png');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('automatic events: the child and the grandchild born show on the parent line; Con cháu hides them; remembered', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, 'light', false);
  try {
    await profile(page, DEAD_PARENT);
    await lifeTab(page);
    const fam = page.locator('.tl2 li.rel', { hasText: 'Con Dương Thị Mất ra đời' });
    assert.equal(await fam.count(), 1, 'child born is an automatic event');
    assert.equal(await page.locator('.tl2 li.rel', { hasText: 'Cháu Nguyễn Văn Cháu ra đời · con của Dương Thị Mất' }).count(), 1, 'grandchild born');
    assert.equal(await page.locator('.tl2 li.rel', { hasText: 'Ra đời' }).first().isVisible(), true, 'own birth anchor');
    const before = await page.textContent('.tl-count');
    await page.click('[data-fp]');
    // the switch is a styled label around a native checkbox: click the visible label, then check the state
    await page.locator('label.swt', { has: page.locator('input[data-tl-f="desc"]') }).click();
    assert.equal(await page.locator('input[data-tl-f="desc"]').isChecked(), false, 'the switch is off');
    await page.click('dialog.fpanel [data-fpx]');
    assert.equal(await page.locator('.tl2 li.rel', { hasText: 'ra đời · con của' }).count(), 0, 'grandchild hidden by the filter');
    assert.equal(await page.locator('.tl2 li.rel', { hasText: 'Con Dương Thị Mất ra đời' }).count(), 0, 'child hidden by the filter');
    assert.notEqual(await page.textContent('.tl-count'), before);
    const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem('gp_tl') || '{}').desc);
    assert.equal(remembered, false, 'filter remembered on this device');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
  // history switch: on by default -> wars and reign bands inside the life (1930–1995), outside ones absent; the switch hides them, remembered
  {
    const c = await newPage(390, 'light', false);
    try {
      await profile(c.page, DEAD_PARENT);
      await lifeTab(c.page);
      assert.ok(await c.page.locator('.tl2 li.hist').count() > 0, 'history on by default');
      {
        // no history row is a scroll box and its label is fully shown, also when labels wrap on a narrow phone
        const clipped = () => c.page.locator('.tl2 li.hist').evaluateAll((els) => els.filter((el) => {
          const cs = getComputedStyle(el); const lab = el.querySelector('.tl-band') || el;
          const r = el.getBoundingClientRect(); const l = lab.getBoundingClientRect();
          return /auto|scroll/.test(cs.overflowY) || cs.maxHeight !== 'none' || lab.scrollHeight - lab.clientHeight > 1 || l.bottom - r.bottom > 1;
        }).map((el) => el.textContent.trim().slice(0, 40)));
        assert.deepEqual(await clipped(), [], 'history rows never scroll on their own');
        const vp = c.page.viewportSize(); await c.page.setViewportSize({ width: 300, height: vp.height });
        assert.deepEqual(await clipped(), [], 'long labels wrap and stay fully visible at 300 px');
        await c.page.setViewportSize(vp);
      }
      assert.match(await c.page.locator('.tl2 li.hist', { hasText: 'Tuyên ngôn độc lập' }).textContent(), /tuổi/, 'a history row shows the age at that time');
      assert.equal(await c.page.locator('.tl2 li.hist .card').count(), 0, 'history rows use the band strip, not cards');
      assert.ok(await c.page.locator('.tl2 li.hist .tag', { hasText: 'Lịch sử' }).count() > 0, 'tagged Lịch sử');
      assert.equal(await c.page.locator('.tl2 li.band', { hasText: 'Nguồn ›' }).count(), 0, 'no separate source link');
      { // a person named in a family event links to their profile
        const a = c.page.locator('.tl2 li.rel h3 a.tl-pp').first();
        assert.ok(await a.count() > 0, 'family event names are links');
        assert.match(await a.getAttribute('href'), /person\//);
      }
      assert.ok(await c.page.locator('.tl2 li.hist a.tl-band[href*="wikipedia"][target="_blank"]').count() > 0, 'each keeps its source link');
      assert.equal(await c.page.locator('.tl2 li.hist', { hasText: 'Tuyên ngôn độc lập' }).count(), 1, 'a key event inside the life');
      assert.equal(await c.page.locator('.tl2 li.hist', { hasText: 'Hiệp định Genève ký kết' }).count(), 0, 'minor events are left out (key list only)');
      assert.equal(await c.page.locator('.tl2 li.hist', { hasText: 'Kết thúc: Chiến tranh Việt Nam' }).count(), 1, 'a war end inside the life');
      assert.equal(await c.page.locator('.tl2 li.band', { hasText: 'Thời vua Bảo Đại' }).count(), 1, 'a reign band overlapping the life');
      assert.equal(await c.page.locator('.tl2 li.hist', { hasText: 'Việt Nam gia nhập WTO' }).count(), 0, 'after the death');
      assert.match(await c.page.textContent('.tl-count'), /mốc lịch sử/);
      if (SHOT) await c.page.screenshot({ path: path.join(SHOT, 'timeline-history-390.png'), fullPage: true }); // the whole life with its history rows
      await c.page.click('[data-fp]');
      await shot(c.page, 'timeline-filter-390.png');
      await c.page.locator('label.swt', { has: c.page.locator('input[data-tl-f="hist"]') }).click();
      await c.page.click('dialog.fpanel [data-fpx]');
      assert.equal(await c.page.locator('.tl2 li.hist').count(), 0, 'the switch hides history');
      assert.equal(await c.page.locator('.tl2 li.band').count(), 0, 'and the bands');
      assert.equal(await c.page.evaluate(() => JSON.parse(localStorage.getItem('gp_tl') || '{}').hist), false, 'remembered on this device');
    } finally { await c.ctx.close(); }
  }
  // screenshots of the same page: dark at 390 px, and the desktop layout
  for (const [w, scheme, name] of [[390, 'dark', 'timeline-390-dark.png'], [1280, 'light', 'timeline-1280.png']]) {
    const c = await newPage(w, scheme, false);
    try {
      await profile(c.page, DEAD_PARENT);
      await lifeTab(c.page);
      await shot(c.page, name);
    } finally { await c.ctx.close(); }
  }
});

test('Câu chuyện đời: an edit is saved and shown again', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, 'light', true);
  try {
    await profile(page, LIVING);
    await page.click('button[data-ptab="info"]'); // Câu chuyện đời is on Thông tin, under the facts and contact
    await page.waitForSelector('[data-sum-edit]');
    await page.click('[data-sum-edit]');
    await page.waitForSelector('dialog.evdlg [data-s="body"]');
    await page.fill('dialog.evdlg [data-s="body"]', 'Bản kể của gia đình.');
    await page.click('dialog.evdlg [data-stx-save]');
    await page.waitForFunction(() => !document.querySelector('dialog.evdlg'), null, { timeout: 15000 });
    await profile(page, LIVING);
    await page.click('button[data-ptab="info"]');
    assert.match(await page.textContent('.lifestory'), /Bản kể của gia đình\./);
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});
