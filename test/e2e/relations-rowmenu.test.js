// E2E: the list row ⋯ "Thêm con / Thêm anh chị em / Thêm cha / mẹ / Vợ / chồng" in a family whose relations live in the
// relation table (Dương). Needs a database (GP_TEST_DATABASE_URL), own schema (e2e_relrowmenu), like relations.test.js:
//   GP_TEST_DATABASE_URL=postgres://.../<scratch> [GP_E2E_CHROME=/usr/bin/google-chrome] NODE_PATH=<dir with playwright>
// Bug it guards: the row actions put the legacy `parent` / spouse field on the new person; the server refuses that in a
// relation-table family, so "Thêm con" from a list row failed. Now: the person form (generation, family name, order
// prefilled, no parent), then the relation sheet at its last step; the relation sets the parent.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !/scratch|e2e|giapha_ci/.test(DB_URL) ? 'GP_TEST_DATABASE_URL must name a scratch database (contains "scratch", "e2e" or giapha_ci)'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const OWNER = 'owner-rowmenu-e2e@test.local';
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'test', 'fixtures', 'copy-shaped.json'), 'utf8'));

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'relrowmenu');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', '..', 'server', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'migrations', f), 'utf8'));
  for (const r of FIX.filter((x) => x.id !== 'P009')) await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [r.id, 'duong', r.data, 'e2e']);
  // relations move into the table (as in production): from now on the server refuses parent / spouse fields on a person
  const B = require('../../server/scripts/rel-backfill');
  await B.apply(pool, await B.plan(pool, await B.loadFamily(pool, 'duong')), { backupDir: fs.mkdtempSync(require('os').tmpdir() + '/relrow-'), by: 'e2e' });
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e','duong','owner','active') on conflict (family_id, email) do nothing", [OWNER]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close();
  srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function ownerPage(width = 390) {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

test('list row ⋯ "Thêm con" in a relation-table family: form without parent, then the relation; the child shows in Quan hệ', { skip }, async () => {
  const { ctx, page, errors } = await ownerPage(390);
  try {
    await page.goto(base + '/#list');
    await page.waitForSelector('[data-menu="P001"]', { timeout: 15000 });
    await page.locator('[data-menu="P001"]').first().click();
    await page.locator('.menu [data-act="child"][data-id="P001"]').click();
    // the basic form (web/js/addflow.js): name, sex, dates; the generation from the parent is saved with it, no parent field
    await page.waitForSelector('#add-f input[name=name]', { timeout: 8000 });
    await page.locator('#add-f input[name=name]').fill('Dương Văn Hàng');
    await page.locator('#add-f select[name=sex]').selectOption('m');
    await page.locator('#add-f button[type=submit]').click();
    // the relation sheet opens at its last step for the new person
    await page.waitForSelector('.rel-sheet #ord', { timeout: 10000 });
    assert.equal(await page.locator('.rel-sheet .err').count(), 0, 'no error on the relation sheet');
    await page.locator('button[data-kind="ruot"]').click();
    await page.locator('button[data-save]').click();
    await page.waitForFunction(() => document.querySelector('.rel-sheet h2')?.textContent === 'Đã lưu', null, { timeout: 10000 });
    await page.locator('button[data-x]').first().click();
    // server side: the new person exists, and a parent-child relation links P001 to them
    const { rows } = await pool.query("select id, data from persons where family_id = 'duong' and data->>'name' = 'Dương Văn Hàng'");
    assert.equal(rows.length, 1, 'the new person was saved once');
    const rel = await pool.query("select count(*)::int n from parent_child where family_id = 'duong' and parent_id = 'P001' and child_id = $1", [rows[0].id]);
    assert.equal(rel.rows[0].n, 1, 'one parent-child relation P001 -> new child');
    // and the profile shows the child under Con
    await page.goto(base + '/#person/P001');
    await page.waitForSelector('section.relsec', { timeout: 10000 });
    assert.match(await page.locator('section.relsec').innerText(), /Dương Văn Hàng/);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('⋯ menus toggle: a second tap on the same ⋯ closes it; Escape closes and returns focus; another ⋯ switches', { skip }, async () => {
  const { ctx, page, errors } = await ownerPage(390);
  try {
    await page.goto(base + '/#list');
    await page.waitForSelector('[data-menu]', { timeout: 15000 });
    const triggers = page.locator('[data-menu]');
    const a = triggers.nth(3); // a row in the middle of the list, clear of the sticky bars
    await a.scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, -200));
    await a.click();
    assert.equal(await page.locator('.menu').count(), 1, 'opens');
    assert.equal(await a.getAttribute('aria-expanded'), 'true');
    assert.equal(await a.getAttribute('aria-haspopup'), 'menu');
    await a.click();
    assert.equal(await page.locator('.menu').count(), 0, 'a second tap on the same ⋯ closes it');
    assert.equal(await a.getAttribute('aria-expanded'), 'false');
    await a.click();
    assert.equal(await page.locator('.menu').count(), 1, 'and opens again');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.menu').count(), 0, 'Escape closes');
    assert.equal(await a.evaluate((el) => el === document.activeElement), true, 'focus is back on the ⋯');
    await a.click();
    const t1 = await page.locator('.menu .mh').first().textContent();
    // another ⋯ that the open menu does not cover (a real tap can only reach a visible one)
    const bi = await page.evaluate(() => [...document.querySelectorAll('[data-menu]')].findIndex((el, i) => {
      const r = el.getBoundingClientRect(); if (i === 3 || r.bottom < 60 || r.top > innerHeight - 70) return false;
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t === el || el.contains(t);
    }));
    assert.ok(bi >= 0, 'a second visible ⋯');
    const b = triggers.nth(bi);
    await b.click();
    assert.equal(await page.locator('.menu').count(), 1, 'one menu at a time');
    assert.notEqual(await page.locator('.menu .mh').first().textContent(), t1, 'the other ⋯ switches to its own menu');
    assert.equal(await a.getAttribute('aria-expanded'), 'false');
    assert.equal(await b.getAttribute('aria-expanded'), 'true');
    await page.mouse.click(5, 300);
    assert.equal(await page.locator('.menu').count(), 0, 'a tap outside closes');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
