// E2E: elder access in two browser contexts (the elder's device and a manager's), real server, SCRATCH database.
// Device sign-in by code end to end, the shared sheet (bottom on phone), managed devices with remote sign-out
// (row menu, confirm), the printed card and its use on a new device. Screenshots at 390 and 1280 with GP_SHOT_DIR.
//   GP_TEST_DATABASE_URL=postgres://... NODE_PATH=<dir with playwright> [GP_E2E_CHROME=...] [GP_SHOT_DIR=<dir>] npm run test:e2e
// Skipped when the database, Playwright or Chrome is missing.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const SHOT = process.env.GP_SHOT_DIR || '';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run' : !chromium ? 'playwright not installed (NODE_PATH)' : false;
const WIDTHS = [390, 1280];
let personName = '';

const TAG = crypto.randomBytes(3).toString('hex');
const MANAGER = `manager-${TAG}@test.local`;
let base, pool, srv, personId, otherId, otherName;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  await pool.query("insert into members (email, name, role, status, family_id) values ($1, 'Quản lý E2E', 'editor', 'active', 'duong')", [MANAGER]);
  const { rows } = await pool.query("select id from persons where family_id = 'duong' and not deleted order by version limit 1");
  personId = rows[0].id;
  await pool.query("insert into person_managers (family_id, person_id, email) values ('duong', $1, $2)", [personId, MANAGER]);
  // A second managed person: the approve sheet then shows the search instead of a single name.
  const second = await pool.query("select id, data->>'name' as name from persons where family_id = 'duong' and not deleted and id <> $1 order by version limit 1", [personId]);
  otherId = second.rows[0].id; otherName = second.rows[0].name;
  personName = (await pool.query("select data->>'name' as name from persons where id = $1", [personId])).rows[0].name || personId;
  await pool.query("insert into person_managers (family_id, person_id, email) values ('duong', $1, $2)", [otherId, MANAGER]);
  // The scratch DB may hold devices and cards from an earlier run for this person: start clean.
  await pool.query('delete from device_accounts where family_id = $1 and person_id = $2', ['duong', personId]);
  await pool.query('delete from sign_in_cards where family_id = $1 and person_id = $2', ['duong', personId]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(async () => {
  if (skip) return;
  srv?.close();
  await pool?.query('delete from device_accounts where family_id = $1 and person_id = $2', ['duong', personId]).catch(() => {});
  await pool?.query('delete from sign_in_cards where family_id = $1 and person_id = $2', ['duong', personId]).catch(() => {});
  await pool?.query('delete from elder_log where actor = $1', [MANAGER]).catch(() => {});
  await pool?.query('delete from person_managers where email = $1', [MANAGER]).catch(() => {});
  await pool?.query('delete from device_accounts where family_id = $1 and person_id = $2', ['duong', otherId]).catch(() => {});
  await pool?.query('delete from members where email = $1', [MANAGER]).catch(() => {});
  await pool?.end().catch(() => {});
});

const viewport = (w) => ({ width: w, height: w < 600 ? 844 : 900 });
async function newContext(browser, w, cookie) {
  const ctx = await browser.newContext({ viewport: viewport(w), deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  if (cookie) { const i = cookie.indexOf('='); await ctx.addCookies([{ name: cookie.slice(0, i), value: cookie.slice(i + 1), url: base }]); }
  return ctx;
}
// Manager context: a Google session through the test endpoint.
async function managerContext(browser, w) {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: MANAGER, name: 'Quản lý E2E' }) });
  assert.equal(r.status, 200);
  return newContext(browser, w, r.headers.get('set-cookie').split(';')[0]);
}
const shot = async (page, w, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, `${name}-${w}.png`) }); };
// /api/me from the page; retries while the page reloads (sign-in reloads the app).
async function meOf(page) {
  for (let i = 0; i < 20; i++) {
    try { return await page.evaluate(() => fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())); } catch { await page.waitForTimeout(300); }
  }
  return {};
}
// Opens the sign-in code screen from the More page (phone and desktop both route there).
async function openCodeScreen(page) {
  await page.goto(base + '/#more');
  await page.click('#login');
  await page.click('[data-elder]');
  await shot(page, page.viewportSize().width, 'other-sheet');
  await page.click('[data-code]');
  await page.waitForFunction(() => /^\d{3} \d{3}$/.test(document.querySelector('.elder-code')?.textContent.trim() || ''));
}

test('device sign-in by code: the elder sees a code, the manager approves, the device signs in once', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    for (const w of WIDTHS) {
      const elder = await (await newContext(browser, w)).newPage();
      await openCodeScreen(elder);
      const code = (await elder.locator('.elder-code').innerText()).replace(/\s/g, '');
      assert.match(code, /^\d{6}$/);
      assert.ok(await elder.locator('.elder-code').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)) >= 40, 'code at least 40 px');
      await shot(elder, w, 'elder-code');

      const mgr = await (await managerContext(browser, w)).newPage();
      await mgr.goto(base + `/#approve=${code}`);
      await mgr.waitForSelector('dialog[open] [data-ok]');
      if (await mgr.locator('dialog[open] input[name=q]').count()) {
        await shot(mgr, w, 'approve-search');
        await mgr.fill('dialog[open] input[name=q]', personName.split(' ').slice(-1)[0]);
        await mgr.click('dialog[open] [data-pick]');
      }
      if (w < 600) {
        const box = await mgr.locator('dialog.rel-sheet[open]').boundingBox();
        const vp = viewport(w);
        assert.ok(Math.abs(box.y + box.height - vp.height) < 2 && box.width >= vp.width - 1, 'phone: the sheet is a bottom sheet');
      }
      await shot(mgr, w, 'approve');
      await mgr.click('dialog[open] [data-ok]');
      await mgr.waitForSelector('dialog[open] h2:has-text("Đã cho phép")');

      // The elder's poll picks the approval up and reloads: the device is a member of the family, with no email.
      let me = await meOf(elder);
      for (let i = 0; i < 40 && me.roles?.duong !== 'member'; i++) { await elder.waitForTimeout(500); me = await meOf(elder); }
      assert.equal(me.roles?.duong, 'member', 'the device is a member of the family it signed in to');
      assert.equal(me.email, null, 'the device has no email');
      assert.equal(me.editor, null, 'no editing from the device');
    }
  } finally { await browser.close(); }
});

test('manager: managed devices (row menu, confirm, remote sign-out) and the printed card that signs a new device in', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    for (const w of WIDTHS) {
      const mgr = await (await managerContext(browser, w)).newPage();
      await mgr.goto(base + `/#person/${personId}`);
      await mgr.waitForSelector(`button[data-menu="${personId}"]`, { timeout: 15000 });
      await mgr.click(`button[data-menu="${personId}"]`);
      await mgr.click('button[data-act="devices"]');
      await mgr.waitForSelector('dialog[open] .calm, dialog[open]:has-text("Chưa có thiết bị nào")');
      await shot(mgr, w, 'devices');
      // Sign out every listed device through the row menu and its confirm.
      while (await mgr.locator('dialog[open] [data-more]').count()) {
        await mgr.locator('dialog[open] [data-more]').first().click();
        await mgr.click('dialog[open] [data-cfm-ok]');
        await mgr.waitForTimeout(400);
      }
      await mgr.waitForSelector('dialog[open]:has-text("Chưa có thiết bị nào")');
      await mgr.keyboard.press('Escape');

      // Act on behalf of the person: the banner shows; a write would carry the tag (covered by the API tests).
      await mgr.click(`button[data-menu="${personId}"]`);
      await mgr.click('button[data-act="actas"]');
      await mgr.waitForSelector('.elder-as');
      await shot(mgr, w, 'act-as');
      await mgr.evaluate(() => document.querySelector('.elder-as [data-end]').click());
      await mgr.waitForSelector('.elder-as', { state: 'detached' });

      await mgr.click(`button[data-menu="${personId}"]`);
      await mgr.click('button[data-act="card"]');
      await mgr.waitForSelector('dialog[open] [data-pr]');
      const [resp] = await Promise.all([
        mgr.waitForResponse((x) => x.url().includes(`/api/persons/${personId}/card`) && x.request().method() === 'POST'),
        mgr.click('dialog[open] [data-pr]'),
      ]);
      const card = await resp.json();
      assert.match(card.url, /#card=/);
      await mgr.waitForSelector('.elder-print .elder-qr svg');
      assert.ok(await mgr.locator('.elder-print .elder-card-url').isVisible(), 'the address shows under the QR');
      await shot(mgr, w, 'card-print');
      if (w === WIDTHS[0]) {
        const device = await (await newContext(browser, w)).newPage();
        await device.goto(base + '/#' + card.url.split('#')[1]);
        await device.waitForSelector('dialog[open] [data-ok]');
        await device.click('dialog[open] [data-ok]');
        let me = await meOf(device);
        for (let i = 0; i < 20 && me.roles?.duong !== 'member'; i++) { await device.waitForTimeout(500); me = await meOf(device); }
        assert.equal(me.roles?.duong, 'member', 'the card signs the new device in');
      }
      await mgr.close();
    }
  } finally { await browser.close(); }
});

test('passkey: the offer after sign-in registers a virtual authenticator, then signing in with it works', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: MANAGER, name: 'Quản lý E2E' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const host = new URL(base).port;
    const pkBase = `http://localhost:${host}`;
    const ctx = await browser.newContext({ viewport: viewport(390), deviceScaleFactor: 2, serviceWorkers: 'block' });
    await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
    const i = cookie.indexOf('=');
    await ctx.addCookies([{ name: cookie.slice(0, i), value: cookie.slice(i + 1), url: pkBase }]);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(pkBase + '/#more');
    await page.waitForSelector('.elder-offer [data-yes]', { timeout: 15000 });
    // The offer is inline in the page flow: never fixed, and nothing it sits over can be covered. Every visible button and link
    // in the page must be the element at its own centre (elementFromPoint), with the offer present.
    const flow = await page.evaluate(() => {
      const offer = document.querySelector('.elder-offer');
      const pos = getComputedStyle(offer).position;
      const bad = [];
      for (const el of document.querySelectorAll('#main button, #main a[href]')) {
        el.scrollIntoView({ block: 'center' }); // off-screen points have no element: measure each control in view
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(hit === el || el.contains(hit))) bad.push((el.textContent || '').trim().slice(0, 30));
      }
      return { pos, bad };
    });
    assert.notEqual(flow.pos, 'fixed', 'the offer is in the page flow');
    assert.deepEqual(flow.bad, [], 'no button is covered by the offer');
    await shot(page, 390, 'passkey-offer');
    await page.setViewportSize({ width: 1280, height: 900 });
    await shot(page, 1280, 'passkey-offer');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('.elder-offer [data-yes]');
    await page.waitForSelector('.elder-offer', { state: 'detached', timeout: 15000 });
    const count = await page.evaluate(() => fetch('/api/passkey/mine', { cache: 'no-store' }).then((x) => x.json()));
    assert.equal(count.count, 1, 'one passkey registered');
    // Sign out, then sign in with the passkey from the sign-in page ("Cách khác").
    await page.evaluate(() => fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    await page.goto(pkBase + '/#more');
    await page.reload();
    await page.waitForSelector('#login', { timeout: 15000 });
    await page.click('#login');
    await page.click('[data-elder]');
    await page.click('[data-pk]');
    let me = { email: null };
    for (let k = 0; k < 40 && me.email !== MANAGER; k++) { await page.waitForTimeout(500); me = await page.evaluate(() => fetch('/api/me', { cache: 'no-store' }).then((x) => x.json())); }
    assert.equal(me.email, MANAGER, 'signed in with the passkey');
    await ctx.close();
  } finally { await browser.close(); }
});
