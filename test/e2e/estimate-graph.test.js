// E2E: estimates across generations on Dòng đời. Own family (slug est-<tag>), so the seeded data is not touched.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright>.
// GP_SHOT_DIR=<dir> also writes est-light-390.png and est-dark-390.png (a profile with no dates, Cách tính opened).
// Covers: a profile with no birth year gets "Sinh (ước tính)" from its father and child (grandfather → father → child),
// and "Mất (ước tính)" from "mất lúc 60 tuổi"; "Cách tính" opens the basis; an editor saves the birth estimate as an
// event (date_kind between, note "Ước tính từ …"); the estimate is never written to born/died; no horizontal scroll.
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
const SLUG = `est-${TAG}`;
const OWNER = `owner.${TAG}@test.local`;
const TO = `N${TAG}to1`; const QUYEN = `N${TAG}qu1`; const CON = `N${TAG}co1`; // ids of 10 characters, like the other e2e files
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử ước tính','public')", [SLUG]);
  // grandfather (dated) -> Quyền (no dates, died at 60) -> child (dated)
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$4,$2,$5), ($3,$4,$6,$5), ($7,$4,$8,$5)', [
    TO, { name: 'Dương Văn Tổ', sex: 'm', gen: 1, born: '1800' }, QUYEN,
    SLUG, 'e2e', { name: 'Vương Văn Quyền', sex: 'm', gen: 2, parent: TO, note: 'Con bà vợ 1; mất lúc 60 tuổi' },
    CON, { name: 'Dương Văn Con', sex: 'm', gen: 3, parent: QUYEN, born: '1850' }]);
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
  await pool.query('delete from history where person_id in ($1,$2,$3)', [TO, QUYEN, CON]).catch(() => {});
  await pool.query('delete from ops where person_id in ($1,$2,$3)', [TO, QUYEN, CON]).catch(() => {});
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function newPage(width = 390, scheme = 'light', owner = false) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme });
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
  await page.waitForSelector('.tl2 li.est', { timeout: 20000 });
};
// A toast sits above the bottom nav and hides text while it shows: the screenshot waits until it is gone.
const shot = async (page, name) => { if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await page.waitForFunction(() => !document.querySelector('.toast:not([hidden])'), null, { timeout: 10000 }).catch(() => {}); await page.screenshot({ path: path.join(SHOT, name), fullPage: false }); } };

test('estimated birth and death rows show from the family, Cách tính opens the basis, and no year is written', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, 'light', true);
  try {
    await profile(page, QUYEN);
    await lifeTab(page);
    const birth = page.locator('.tl2 li.est', { hasText: 'Sinh (ước tính)' });
    const death = page.locator('.tl2 li.est', { hasText: 'Mất (ước tính)' });
    assert.equal(await birth.count(), 1, 'one estimated birth row');
    assert.equal(await death.count(), 1, 'one estimated death row (died at 60)');
    assert.match(await birth.innerText(), /khoảng 1815–1835/, 'birth from father 1800 and child 1850');
    assert.match(await birth.innerText(), /ước tính/);
    assert.match(await death.innerText(), /khoảng 1875–1895/, 'death = birth + 60');
    // Cách tính: a tap opens the basis (a disclosure, not a hover)
    await birth.locator('summary', { hasText: 'Cách tính' }).click();
    assert.equal(await birth.locator('details.est-basis').getAttribute('open'), '', 'Cách tính is open');
    const basis = await birth.locator('details.est-basis').innerText();
    assert.match(basis, /cha Dương Văn Tổ/);
    assert.match(basis, /con Dương Văn Con: cha sinh 15–50 năm trước con/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll at 390px');
    await shot(page, 'est-light-390.png');
    assert.deepEqual(errs, [], 'no console errors');
    // the estimate is never written to the person
    const { rows } = await pool.query('select data from persons where id=$1', [QUYEN]);
    assert.equal(rows[0].data.born, undefined); assert.equal(rows[0].data.birth_date, undefined);
  } finally { await ctx.close(); }
});

test('the editor saves the birth estimate as an event (between, with the basis in the note) after the shared confirm', { skip }, async () => {
  const { ctx, page, errs } = await newPage(390, 'dark', true);
  try {
    await profile(page, QUYEN);
    await lifeTab(page);
    const birth = page.locator('.tl2 li.est', { hasText: 'Sinh (ước tính)' });
    await birth.locator('summary', { hasText: 'Cách tính' }).click();
    await shot(page, 'est-dark-390.png');
    await birth.locator('button[data-est-save]').click();
    await page.waitForSelector('dialog.dlg[open] .btn.dng', { timeout: 10000 });
    assert.match(await page.textContent('dialog.dlg[open]'), /Lưu thành sự kiện\?/);
    assert.match(await page.textContent('dialog.dlg[open]'), /Ước tính từ /);
    await page.click('dialog.dlg[open] .btn.dng');
    await page.waitForFunction(() => !document.querySelector('dialog.dlg[open]'), null, { timeout: 10000 });
    await page.waitForSelector('.tl2 li:not(.est)', { timeout: 20000 });
    const { rows } = await pool.query("select type, date_kind, date_from, date_to, description from events where person_id=$1 and type='sinh'", [QUYEN]);
    assert.equal(rows.length, 1, 'one stored birth event');
    assert.equal(rows[0].date_kind, 'between');
    assert.equal(String(rows[0].date_from).slice(0, 4), '1815');
    assert.equal(String(rows[0].date_to).slice(0, 4), '1835');
    assert.match(rows[0].description, /^Ước tính từ /);
    assert.equal(await page.locator('.tl2 li.est', { hasText: 'Sinh (ước tính)' }).count(), 0, 'the stored event replaces the auto row');
    assert.deepEqual(errs, [], 'no console errors');
  } finally { await ctx.close(); }
});
