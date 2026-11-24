// E2E: an editor links a person's place field to a shared place from the profile (the picker finds it by an old
// name too); the text as written stays; the text then opens the place page with names over time, parents and the
// people of this family linked to it. A guest sees the link but no "Gắn địa danh" button. Invented names only.
// Needs a database (GP_TEST_DATABASE_URL, own schema e2e_places) + playwright + Chrome, like links.test.js.
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

const OWNER = 'owner-places-e2e@test.local';
let base, pool, srv, browser, iso; const ID = {};
const { isolatedDb } = require('./_isolated-db');
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'places');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const place = async (kind) => (await pool.query("insert into places (kind, status, created_by) values ($1,'verified','e2e') returning id", [kind])).rows[0].id;
  const name = (id, n, from, to, primary = true) => pool.query('insert into place_names (place_id, name, name_fold, valid_from, valid_to, is_primary) values ($1,$2,$3,$4,$5,$6)', [id, n, fold(n), from, to, primary]);
  ID.prov = await place('province'); ID.com = await place('commune');
  await name(ID.prov, 'Tỉnh Sông Thử', '1976', null);
  await name(ID.com, 'Xã Bến Thử', '1956', null);
  await name(ID.com, 'Làng Bến Xưa', '1700', '1956', false);
  await pool.query("insert into place_parents (place_id, parent_id, valid_from) values ($1,$2,'1976')", [ID.com, ID.prov]);
  const ins = (id, data) => pool.query("insert into persons (id, family_id, data, updated_by) values ($1,'duong',$2,'e2e')", [id, data]);
  await ins('P001', { name: 'Dương Văn Tổ Thử', sex: 'm', gen: 1, died: '1900', burial: 'làng Bến Xưa' });
  await ins('P002', { name: 'Dương Văn Con Thử', sex: 'm', gen: 2, parent: 'P001', died: '1950', place: 'Bến Thử' });
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e','duong','owner','active') on conflict (family_id, email) do nothing", [OWNER]);
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

async function newPage({ signedIn, width = 390, scheme = 'light' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  if (signedIn) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  return { ctx, page: await ctx.newPage() };
}
const shot = async (page, name, full = false) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: full }); };

test('editor links An táng by an old name; text kept; the place page lists names over time and the people', { skip }, async () => {
  const { ctx, page } = await newPage({ signedIn: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(base + '/#person/P001');
    await page.waitForSelector('[data-place-pick="burial"]', { timeout: 15000 });
    await page.click('[data-place-pick="burial"]');
    await page.waitForSelector('dialog.pl-sheet[open]');
    assert.equal(await page.inputValue('dialog.pl-sheet input[name=q]'), 'làng Bến Xưa', 'prefilled with the text as written');
    await page.fill('dialog.pl-sheet input[name=q]', 'ben xua');
    const opt = page.locator(`dialog.pl-sheet [data-place="${ID.com}"]`);
    await opt.waitFor({ timeout: 10000 });
    assert.match(await opt.innerText(), /Xã Bến Thử/, "today's name");
    assert.match(await opt.innerText(), /trước đây: Làng Bến Xưa/, 'the old name that matched');
    await shot(page, 'places-picker-390.png');
    await opt.click();
    await page.waitForSelector('dialog.pl-sheet', { state: 'detached', timeout: 10000 });
    const link = page.locator('a.pl-link').first();
    await link.waitFor({ timeout: 10000 });
    assert.equal(await link.innerText(), 'làng Bến Xưa', 'the text as written stays');
    assert.match(await page.locator('dd', { has: link }).innerText(), /nay Xã Bến Thử, Tỉnh Sông Thử/);
    const row = await pool.query("select place_id, as_written from person_places where person_id='P001' and field='burial'");
    assert.equal(row.rows[0].place_id, ID.com); assert.equal(row.rows[0].as_written, 'làng Bến Xưa');
    const p = await pool.query("select data->>'burial' b from persons where id='P001'");
    assert.equal(p.rows[0].b, 'làng Bến Xưa', 'persons.data never rewritten');
    assert.equal((await pool.query("select count(*)::int n from history where person_id='P001' and field='dia_danh'")).rows[0].n, 1);
    await shot(page, 'places-profile-390.png');
    // a second person linked by API, then the place page shows both
    const ck = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const r = await fetch(base + '/api/persons/P002/places', { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck }, body: JSON.stringify({ family: 'duong', field: 'place', place_id: ID.com }) });
    assert.equal(r.status, 200);
    await link.click();
    await page.waitForFunction((id) => location.hash.endsWith('place/' + id), ID.com, { timeout: 10000 });
    await page.waitForSelector('section[aria-label="Tên qua các thời kỳ"] li.band', { timeout: 10000 });
    assert.equal(await page.locator('h1').first().innerText(), 'Xã Bến Thử');
    const names = await page.locator('section[aria-label="Tên qua các thời kỳ"]').innerText();
    assert.match(names, /Làng Bến Xưa/); assert.match(names, /1700–1956/); assert.match(names, /1956–nay/);
    assert.match(await page.locator('section[aria-label="Thuộc đơn vị"]').innerText(), /Thuộc Tỉnh Sông Thử/);
    const people = page.locator('section[aria-label="Người trong họ"] .calm');
    assert.equal(await people.count(), 2);
    assert.match(await page.locator('section[aria-label="Người trong họ"]').innerText(), /An táng/);
    await shot(page, 'places-page-390.png', true);
    await people.first().click();
    await page.waitForFunction(() => /person\//.test(location.hash), null, { timeout: 10000 });
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('guest: the linked text opens the place page; no picker button; the write API refuses', { skip }, async () => {
  const { ctx, page } = await newPage({ signedIn: false });
  try {
    await page.goto(base + '/#person/P002');
    await page.waitForSelector('a.pl-link', { timeout: 15000 });
    assert.equal(await page.locator('[data-place-pick]').count(), 0, 'no picker for a guest');
    const r = await fetch(base + `/api/persons/P002/places`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: 'duong', field: 'place', place_id: ID.prov }) });
    assert.equal(r.status, 401);
    const d = await fetch(base + `/api/persons/P002/places/place?family=duong`, { method: 'DELETE' });
    assert.equal(d.status, 401);
    const bad = await fetch(base + `/api/persons/P002/places`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: 'duong', field: 'address', place_id: ID.prov }) });
    assert.equal(bad.status, 400, 'address stays free text');
    for (const scheme of ['light', 'dark']) {
      const c = await newPage({ signedIn: false, scheme });
      try {
        await c.page.goto(base + `/#place/${ID.com}`);
        await c.page.waitForSelector('section[aria-label="Người trong họ"] .calm', { timeout: 15000 });
        await shot(c.page, `places-page-guest-390-${scheme}.png`, true);
      } finally { await c.ctx.close(); }
    }
  } finally { await ctx.close(); }
});
