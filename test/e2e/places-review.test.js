// E2E, places step 3: an editor adds a place that is not in the list from the picker (pending, linked at once); the
// enrichment step runs on recorded open-data answers (no network); the owner sees "Địa danh chờ duyệt" on the review
// page, accepts and rejects suggestions and verifies the place; the place page then credits GeoNames. An editor who
// is no owner/admin sees no such section. Invented names only.
// Needs a database (GP_TEST_DATABASE_URL, own schema e2e_places_review) + playwright + Chrome, like places.test.js.
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

const OWNER = 'owner-placesrv-e2e@test.local'; const EDITOR = 'editor-placesrv-e2e@test.local';
let base, pool, srv, browser, iso, E;
const FX = (f) => require(path.join(__dirname, '..', '..', 'server', 'test', 'fixtures', 'places', f));
const fetchJson = async (url) => {
  if (url.includes('wbsearchentities')) return FX('wikidata-search.json');
  if (url.startsWith('https://query.wikidata.org/sparql')) return FX('wikidata-sparql.json');
  if (url.includes('geonames.org/searchJSON')) return FX('geonames-search.json');
  throw new Error('unexpected ' + url);
};

test.before(async () => {
  if (skip) return;
  const { isolatedDb } = require('./_isolated-db');
  iso = isolatedDb(DB_URL, 'places_review');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  E = require('../../server/places-enrich');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into persons (id, family_id, data, updated_by) values ('P001','duong',$1,'e2e')", [{ name: 'Dương Văn Tổ Duyệt', sex: 'm', gen: 1, died: '1900', burial: 'Xã Bến Lúa' }]);
  await pool.query(`insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e','duong','owner','active'), ($2,'Biên tập e2e','duong','editor','active')
    on conflict (family_id, email) do nothing`, [OWNER, EDITOR]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close(); srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function newPage({ email, width = 390, scheme = 'light' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  if (email) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  return { ctx, page: await ctx.newPage() };
}
const shot = async (page, name, full = false) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: full }); };

test('editor adds a new place from the picker; owner reviews the open-data suggestions; GeoNames is credited', { skip }, async () => {
  // 1. the editor: nothing found -> "Thêm … làm địa danh mới" -> kind -> linked, pending
  {
    const { ctx, page } = await newPage({ email: EDITOR });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    try {
      await page.goto(base + '/#person/P001');
      await page.waitForSelector('[data-place-pick="burial"]', { timeout: 15000 });
      await page.click('[data-place-pick="burial"]');
      const add = page.locator('dialog.pl-sheet [data-new-place]');
      await add.waitFor({ timeout: 10000 });
      assert.match(await add.innerText(), /Thêm “Xã Bến Lúa” làm địa danh mới/);
      await add.click();
      assert.equal(await page.inputValue('dialog.pl-sheet [data-new-name]'), 'Xã Bến Lúa');
      assert.equal(await page.inputValue('dialog.pl-sheet [data-new-kind]'), 'commune');
      await shot(page, 'places-new-390.png');
      await page.click('dialog.pl-sheet [data-new-save]');
      await page.waitForSelector('dialog.pl-sheet', { state: 'detached', timeout: 10000 });
      await page.locator('a.pl-link').first().waitFor({ timeout: 10000 });
      const pl = (await pool.query("select p.id, p.status from places p join person_places pp on pp.place_id = p.id where pp.person_id='P001' and pp.field='burial'")).rows[0];
      assert.equal(pl.status, 'pending');
      assert.equal((await pool.query("select status from places_enrich_jobs where place_id=$1", [pl.id])).rows[0].status, 'queued');
      // an editor (no owner/admin) sees no curator section
      await page.goto(base + '/#review');
      await page.waitForTimeout(1200);
      assert.equal(await page.locator('#plpend .pl-pend').count(), 0);
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
  // 2. the background step, on recorded answers
  const r = await E.runOnce(pool, { fetchJson, geonamesUser: 'demo' });
  assert.equal(r.status, 'done');
  // 3. the owner reviews
  for (const scheme of ['dark', 'light']) { // dark first: the light pass then decides the suggestions
    const { ctx, page } = await newPage({ email: OWNER, scheme });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    try {
      await page.goto(base + '/#review');
      await page.waitForSelector('#plpend .pl-pend', { timeout: 15000 });
      const sec = page.locator('#plpend .pl-pend');
      assert.match(await sec.innerText(), /Địa danh chờ duyệt/);
      assert.match(await sec.innerText(), /Xã Bến Lúa/);
      assert.match(await sec.innerText(), /Wikidata Q9990001/);
      assert.match(await sec.innerText(), /độ khớp 80%/, 'name + kind + Vietnam; no parent given');
      await shot(page, `places-review-390-${scheme}.png`, true);
      if (scheme === 'dark') { assert.deepEqual(errs, []); continue; }
      const sug = async (re) => sec.locator('.pl-sug', { hasText: re });
      await (await sug(/Wikidata Q9990001/)).locator('[data-psug=accept]').click();
      await page.waitForFunction(() => !/Wikidata Q9990001/.test(document.querySelector('#plpend')?.innerText || ''), null, { timeout: 10000 });
      await (await sug(/Ben Lua Commune/)).locator('[data-psug=accept]').click();
      await page.waitForFunction(() => !/Ben Lua Commune/.test(document.querySelector('#plpend')?.innerText || ''), null, { timeout: 10000 });
      await (await sug(/Làng Bến Thóc/)).locator('[data-psug=reject]').click();
      await page.waitForFunction(() => !/Làng Bến Thóc/.test(document.querySelector('#plpend')?.innerText || ''), null, { timeout: 10000 });
      await sec.locator('[data-pverify]').click();
      await page.waitForFunction(() => !/chưa xác minh/.test(document.querySelector('#plpend')?.innerText || ''), null, { timeout: 10000 });
      const p = (await pool.query("select id, status, wikidata_id from places where wikidata_id='Q9990001'")).rows[0];
      assert.deepEqual([p.status, p.wikidata_id], ['verified', 'Q9990001']);
      // 4. the place page credits GeoNames (a GeoNames name was accepted)
      await page.goto(base + `/#place/${p.id}`);
      await page.waitForSelector('.pl-attr', { timeout: 10000 });
      assert.match(await page.locator('.pl-attr').innerText(), /GeoNames \(CC BY 4\.0\)/);
      assert.match(await page.locator('section[aria-label="Tên qua các thời kỳ"]').innerText(), /Ben Lua Commune/);
      await shot(page, 'places-page-attrib-390.png', true);
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
});
