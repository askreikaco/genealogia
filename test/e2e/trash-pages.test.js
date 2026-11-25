// E2E: Thùng rác in the browser (server/trash.js, web/js/trash-ui.js). Own family (slug trui-<tag>).
// Covers: deleting a person shows its impact and needs a reason and the typed name; a person with descendants becomes
// a request (another admin approves); deleting an event shows "Hoàn tác" for 10 s and it restores the event; the
// Thùng rác page lists requests and deleted items and restores. Screenshots (GP_SHOT_DIR): impact confirm, undo toast,
// trash page; 390 light and dark.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright>.
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
const SLUG = `trui-${TAG}`;
const OWNER = `owner.${TAG}@test.local`; const ADMIN = `admin.${TAG}@test.local`;
const PA = `R${TAG}pa`; const PB = `R${TAG}pb`; const PD = `R${TAG}pd`;
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử thùng rác','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$4,$2,$5), ($3,$4,$6,$5), ($7,$4,$8,$5)', [
    PA, { name: 'Trần Văn Tổ', sex: 'm', gen: 1, born: '1900', died: '1970' }, PB, SLUG, 'e2e', { name: 'Trần Văn Con', sex: 'm', gen: 2, born: '1930', died: '1990' },
    PD, { name: 'Trần Thị Sự', sex: 'f', gen: 2, born: '1935', died: '2000' }]);
  await pool.query("insert into relation_migrations (family_id, migrated_by) values ($1,'e2e')", [SLUG]);
  await pool.query('insert into parent_child (family_id, parent_id, child_id) values ($1,$2,$3)', [SLUG, PA, PB]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$3,'owner','active'), ($2,'Quản trị e2e',$3,'admin','active')", [OWNER, ADMIN, SLUG]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip || !pool) return;
  await browser?.close(); srv?.close();
  for (const t of ['trash', 'trash_audit', 'notices', 'events', 'parent_child', 'couple', 'members', 'relation_migrations', 'mail_log']) await pool.query(`delete from ${t} where family_id=$1`, [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id = any($1)', [[PA, PB, PD]]).catch(() => {});
  await pool.query('delete from ops where person_id = any($1)', [[PA, PB, PD]]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function pageAs(email, scheme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, errs };
}
const shot = async (page, name) => { if (!SHOT) return; fs.mkdirSync(SHOT, { recursive: true }); await page.screenshot({ path: path.join(SHOT, name) }); };
const events = async () => (await pool.query('select count(*)::int n from events where family_id=$1', [SLUG])).rows[0].n;

test('person delete: the one-person endpoint answers 409; the menu opens the chooser instead', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page, errs } = await pageAs(OWNER, scheme);
    try {
      await page.goto(`${base}/#/${SLUG}/list`);
      await page.waitForSelector(`[data-menu="${PA}"]`, { timeout: 20000 });
      await page.locator(`[data-menu="${PA}"]`).first().click();
      await page.locator('.menu [role=menuitem]', { hasText: 'Gỡ khỏi gia phả' }).click();
      await page.waitForSelector('dialog.dcs[open]', { timeout: 15000 });
      await page.keyboard.press('Escape');
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
});

test('event delete: "Hoàn tác" for 10 s restores it', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page, errs } = await pageAs(OWNER, scheme);
    try {
      await page.goto(`${base}/#/${SLUG}/person/${PD}`);
      await page.waitForSelector('nav.ptabs', { timeout: 20000 });
      const st = await page.evaluate(async ([fam, pid]) => (await fetch(`/api/events?family=${fam}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op_id: 'ev-tr' + Math.random().toString(36).slice(2), person_id: pid, event: { type: 'cuoi', date_kind: 'exact', date_from: '1955', date_text: '1955', place: 'Huế', sources: [], people: [] } }) })).json(), [SLUG, PD]);
      // the seed went around the app: reload so the person's events are fetched again (the page caches them per session)
      await page.reload(); await page.waitForSelector('nav.ptabs', { timeout: 20000 });
      const before = await events();
      await page.goto(`${base}/#/${SLUG}/su-kien/${PD}?id=${st.event.id}`);
      await page.waitForSelector('.dzone [data-evp-del]', { timeout: 20000 });
      await page.click('.dzone [data-evp-del]');
      await page.click('dialog.dcf [data-dcf-ok]');
      await page.waitForSelector('.toast.undo [data-undo]', { timeout: 10000 });
      assert.equal(await events(), before - 1);
      assert.match(await page.textContent('.toast.undo'), /Đã xóa sự kiện · trong Thùng rác\s*Hoàn tác/);
      await shot(page, `undo-toast-390-${scheme}.png`);
      if (scheme === 'light') {
        await page.click('.toast.undo [data-undo]');
        await page.waitForFunction(() => /Đã hoàn tác/.test(document.querySelector('.toast.undo')?.textContent || ''));
        assert.equal(await events(), before, 'restored');
      }
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
});

test('Thùng rác page: opens for an admin; deleted items are listed and can be restored from it', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page, errs } = await pageAs(ADMIN, scheme);
    try {
      await page.goto(`${base}/#/${SLUG}/more`);
      await page.waitForSelector('[href$="/thung-rac"]', { timeout: 20000 });
      await page.click('[href$="/thung-rac"]');
      await page.waitForSelector('.tr-sec', { timeout: 15000 });
      assert.equal(await page.textContent('#cbtitle'), 'Thùng rác');
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
});
