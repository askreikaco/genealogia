// E2E (owner 2026-11-24): the event editor is a page, not a sheet; delete is apart from Save, in "Thao tác cần cẩn trọng",
// and always goes through the shared destructive confirm (Escape cancels, focus on its heading, red "Xóa vĩnh viễn"
// is never the default); deleting a person asks to type the name. Own family (slug dz-<tag>).
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright>.
// GP_SHOT_DIR=<dir> also writes the screenshots (event page, danger zone, confirm; 390 light and dark).
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
const SLUG = `dz-${TAG}`;
const OWNER = `owner.${TAG}@test.local`;
const P1 = `D${TAG}a1`; const P2 = `D${TAG}b2`;
const NAME2 = 'Dương Văn Thử Xóa';
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử nguy hiểm','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$3,$2,$4), ($5,$3,$6,$4)', [
    P1, { name: 'Dương Văn Sự', sex: 'm', gen: 2, born: '1930', died: '1995' }, SLUG, 'e2e',
    P2, { name: NAME2, sex: 'm', gen: 2, born: '1932', died: '2000' }]);
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
  for (const t of ['events', 'stories', 'suggestions', 'members']) await pool.query(`delete from ${t} where family_id=$1`, [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id in ($1,$2)', [P1, P2]).catch(() => {});
  await pool.query('delete from ops where person_id in ($1,$2)', [P1, P2]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function ownerPage(scheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, errs };
}
const shot = async (page, name, opts = {}) => {
  if (!SHOT) return;
  fs.mkdirSync(SHOT, { recursive: true });
  await page.waitForFunction(() => !document.querySelector('.toast:not([hidden])'), null, { timeout: 10000 }).catch(() => {});
  await page.screenshot({ path: path.join(SHOT, name), ...opts });
};
const addEvent = (page) => page.evaluate(async ([fam, pid]) => {
  const r = await fetch(`/api/events?family=${encodeURIComponent(fam)}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op_id: 'ev-dz' + Date.now().toString(36), person_id: pid, event: { type: 'hoc', date_kind: 'exact', date_from: '1950', date_text: '1950', place: 'Quy Nhơn', description: 'Vào trường làng.', people: [], is_preferred: true,
      sources: [{ title: 'Gia phả viết tay 1950', url: 'https://example.org/gia-pha', quality: 'goc' }] } }) });
  return r.ok ? 200 : `${r.status} ${await r.text()}`;
}, [SLUG, P1]);
const eventCount = (page) => page.evaluate(async ([fam, pid]) => ((await (await fetch(`/api/events?family=${fam}&person=${pid}`, { cache: 'no-store' })).json()).items || []).length, [SLUG, P1]);

test('event edit is a page with back and a sticky Hủy · Lưu bar; delete is in the danger zone and confirmed', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page, errs } = await ownerPage(scheme);
    try {
      await page.goto(`${base}/#/${SLUG}/person/${P1}`);
      await page.waitForSelector('nav.ptabs', { timeout: 20000 });
      if (scheme === 'light') assert.equal(await addEvent(page), 200, 'seed event');
      // the seed went around the app (no cache invalidation): reload so the person's events are fetched again
      if (scheme === 'light') { await page.reload(); await page.waitForSelector('nav.ptabs', { timeout: 20000 }); }
      await page.click('button[data-ptab="life"]');
      await page.waitForSelector('[data-ev-edit]', { timeout: 20000 });
      await page.locator('[data-ev-edit]').first().click();
      await page.waitForSelector('.evpage [data-evx]', { timeout: 15000 });
      assert.match(await page.evaluate(() => location.hash), new RegExp(`/su-kien/${P1}\\?id=`), 'its own route');
      assert.equal(await page.locator('dialog[open]').count(), 0, 'not a sheet');
      assert.ok(await page.locator('#cbback').isVisible(), 'back in the top bar');
      assert.equal(await page.textContent('#cbtitle'), 'Sửa sự kiện');
      const bar = await page.evaluate(() => { const b = document.querySelector('.evpage .evx-acts'); return { pos: getComputedStyle(b).position, txt: b.innerText.replace(/\s+/g, ' ').trim(), danger: b.querySelectorAll('[data-danger], .dng, .dng-o').length }; });
      assert.equal(bar.pos, 'fixed', 'sticky bottom bar');
      assert.equal(bar.txt, 'Hủy Lưu sự kiện');
      assert.equal(bar.danger, 0, 'no destructive button beside Save');
      // the sources sit inside "Thêm chi tiết" (a closed fold unless it holds a value): open it to measure them
      await page.evaluate(() => { document.querySelector('[data-evx] details[data-disc]').open = true; });
      // sources as cards: every field full width on a phone
      const src = await page.evaluate(() => { const c = document.querySelector('.srow').getBoundingClientRect(); return [...document.querySelectorAll('.srow .fld')].map((f) => Math.round(f.getBoundingClientRect().width / (c.width - 32) * 100)); });
      // a free-text citation: title, link, page, quality (E2 added the page field)
      assert.equal(src.length, 4); for (const w of src) assert.ok(w >= 95, `source field full width (${w}%)`);
      assert.ok(await page.locator('.evx-src [data-src-add].btn').isVisible(), '+ Thêm nguồn is an outlined button');
      await shot(page, `event-page-390-${scheme}.png`);
      const del = page.locator('.dzone [data-evp-del]');
      assert.equal(await page.textContent('.dzone .dzone-h'), 'Thao tác cần cẩn trọng');
      await del.scrollIntoViewIfNeeded();
      await shot(page, `danger-zone-390-${scheme}.png`);
      await del.click();
      await page.waitForSelector('dialog#dcf[open]');
      const dlg = await page.evaluate(() => ({ focus: document.activeElement?.id, role: document.querySelector('dialog#dcf').getAttribute('role'), text: document.querySelector('dialog#dcf').innerText, ok: document.querySelector('[data-rds-confirm]').textContent }));
      assert.equal(dlg.focus, 'dcf-title', 'focus on the heading, not on the red button');
      assert.equal(dlg.role, 'alertdialog');
      assert.match(dlg.text, /Không thể hoàn tác/);
      assert.match(dlg.text, /Dương Văn Sự/);
      assert.equal(dlg.ok, 'Xóa vĩnh viễn');
      await shot(page, `confirm-390-${scheme}.png`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog#dcf'));
      assert.equal(await eventCount(page), 1, 'Escape cancels');
      // Enter in the confirm does nothing: focus is on the heading, the red button is never the default
      await del.click();
      await page.waitForSelector('dialog#dcf[open]');
      await page.keyboard.press('Enter'); await page.waitForTimeout(300);
      assert.equal(await page.locator('dialog#dcf[open]').count(), 1);
      assert.equal(await eventCount(page), 1);
      await page.click('dialog#dcf .rds-btn--ghost');
      await page.waitForFunction(() => !document.querySelector('dialog#dcf'));
      if (scheme === 'dark') {
        await del.click();
        await page.click('dialog#dcf [data-rds-confirm]');
        // back on the profile: the address keeps the open tab (?tab=life), so the route match allows the query
        await page.waitForFunction((pid) => new RegExp(`/person/${pid}(\\?tab=[a-z]+)?$`).test(location.hash), P1, { timeout: 15000 });
        assert.equal(await eventCount(page), 0, 'deleted after the confirm');
      } else {
        // Hủy and back both leave the page without saving
        await page.click('.evpage [data-evx-cancel]');
        await page.waitForFunction((pid) => new RegExp(`/person/${pid}(\\?tab=[a-z]+)?$`).test(location.hash), P1, { timeout: 15000 });
        await page.goto(`${base}/#/${SLUG}/su-kien/${P1}`);
        await page.waitForSelector('.evpage [data-evx]', { timeout: 15000 });
        assert.equal(await page.textContent('#cbtitle'), 'Thêm sự kiện');
        assert.equal(await page.locator('.dzone').count(), 0, 'nothing to delete on a new event');
        await page.click('#cbback');
        await page.waitForFunction((pid) => new RegExp(`/person/${pid}(\\?tab=[a-z]+)?$`).test(location.hash), P1, { timeout: 15000 });
      }
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
});

test('person removal: the red last menu item opens the chooser (Gỡ khỏi gia phả), not a one-click delete', { skip }, async () => {
  const { ctx, page, errs } = await ownerPage('light');
  try {
    await page.goto(`${base}/#/${SLUG}/list`);
    await page.waitForSelector(`[data-menu="${P2}"]`, { timeout: 20000 });
    await page.locator(`[data-menu="${P2}"]`).first().click();
    const items = await page.locator('.rds-menu [role=menuitem]').evaluateAll((xs) => xs.map((x) => ({ t: x.textContent, d: x.classList.contains("rds-menu__item--danger") && x.hasAttribute('data-danger') })));
    assert.deepEqual(items[items.length - 1], { t: 'Gỡ khỏi gia phả…', d: true }, 'red, marked, last');
    await page.locator('.rds-menu [role=menuitem]').last().click();
    await page.waitForSelector('dialog.dcs[open]', { timeout: 15000 });
    const text = await page.textContent('dialog.dcs[open]');
    assert.ok(text.includes('Đề nghị gỡ'), 'the vote is offered');
    assert.ok(!text.includes('Nhập nhầm'), 'the fast path is hidden for an old record');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.dcs[open]'));
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

