// E2E: accounts on one device (phone, 390 px). The real server and a SCRATCH database (migrated and seeded), two
// Google test accounts (owner, member) signed in through POST /api/test/session:
//   GP_TEST_DATABASE_URL=postgres://... NODE_PATH=<dir with playwright> [GP_E2E_CHROME=...] npm run test:e2e (from giapha/server)
// Checks: switching changes the visible role and menu; drafts stay with the account that wrote them; sign out one keeps
// the other; sign out all shows the guest Thêm card. Skipped when the database, Playwright or Chrome is missing.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const TAG = ('TEST-ACC-' + crypto.randomBytes(3).toString('hex')).toLowerCase(); // emails are stored lower-case
const OWNER = `owner-${TAG}@test.local`;
const MEMBER = `member-${TAG}@test.local`;
const OWNER_NAME = 'Chủ họ Acc';
const MEMBER_NAME = 'Thành viên Acc';
let base, pool, srv, personId;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  await pool.query("insert into members (email, name, role, status, family_id) values ($1, $2, 'owner', 'active', 'duong')", [OWNER, OWNER_NAME]);
  await pool.query("insert into members (email, name, role, status, family_id) values ($1, $2, 'member', 'active', 'duong')", [MEMBER, MEMBER_NAME]);
  const { rows } = await pool.query("select id from persons where family_id = 'duong' and not deleted order by version limit 1");
  personId = rows[0]?.id;
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(async () => {
  if (skip) return;
  srv?.close();
  await pool?.query('delete from members where email = any($1)', [[OWNER, MEMBER]]).catch(() => {});
  await pool?.query('delete from user_prefs where email = any($1)', [[OWNER, MEMBER]]).catch(() => {});
  await pool?.end().catch(() => {});
});

// A context signed in to the given accounts, the last one active. Each account is added to the cookie's list.
async function contextWith(browser, emails) {
  let cookie = '';
  for (const email of emails) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ email, name: email === OWNER ? OWNER_NAME : MEMBER_NAME }) });
    assert.equal(r.status, 200);
    cookie = r.headers.get('set-cookie').split(';')[0];
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  const i = cookie.indexOf('=');
  await ctx.addCookies([{ name: cookie.slice(0, i), value: cookie.slice(i + 1), url: base }]);
  return ctx;
}
async function waitPastLoading(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const txt = await page.locator('main').innerText().catch(() => '');
    if (txt && !/Đang tải/.test(txt)) return txt;
    await page.waitForTimeout(150);
  }
  assert.fail('still loading: ' + (await page.locator('main').innerText().catch(() => '')).slice(0, 80));
}
// The Thêm account card shows the role once /api/me and the account list have loaded: wait for that line.
async function waitForCard(page, re) {
  await page.waitForFunction((src) => { const c = document.querySelector('.acct-card'); return !!c && new RegExp(src).test(c.textContent); }, re.source, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll('.mg-h').length > 0, null, { timeout: 8000 });
}
// Opens the account sheet the phone way: the Thêm tab, then the account card (the top bar has no avatar now).
async function openSheet(page) {
  await page.click('#nav a[href$="#more"]');
  await page.waitForSelector('button.acct-open');
  await page.click('button.acct-open');
  await page.waitForSelector('dialog.acct-sh[open]');
}
// Navigation by a switch or a sign-out reloads the page: wait for the new document, then for its content.
async function reloadedAfter(page, action) {
  await Promise.all([page.waitForEvent('load'), action()]);
  await waitPastLoading(page);
}
const headings = (page) => page.$$eval('.mg-h', (els) => els.map((e) => e.textContent.trim()));

test('switching account changes the role and the menu (owner sees Thành viên & quyền, member does not)', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await contextWith(browser, [MEMBER, OWNER]); // owner is active
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/#more');
    await waitForCard(page, /Chủ họ/);
    await page.locator('main .calm', { hasText: 'Thành viên & quyền' }).waitFor();
    assert.match(await page.textContent('.acct-card'), /Chủ họ/);
    await openSheet(page);
    assert.equal(await page.locator('dialog.acct-sh [data-switch]').count(), 2, 'both accounts are listed');
    await Promise.all([page.waitForEvent('load'), page.click(`dialog.acct-sh [data-switch][data-email="${MEMBER}"]`)]);
    await waitForCard(page, /Thành viên/);
    assert.equal(await page.locator('main .calm', { hasText: 'Thành viên & quyền' }).count(), 0, 'member does not see Thành viên & quyền');
    assert.match(await page.textContent('.acct-card'), /Thành viên/);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); }
});

test('drafts stay with the account that wrote them: the other account never sends or sees them', { skip }, async () => {
  if (skip || !personId) return;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await contextWith(browser, [MEMBER, OWNER]); // owner writes a draft
    const page = await ctx.newPage();
    await page.goto(base + '/#/duong/sua/' + personId);
    await waitPastLoading(page);
    const name = page.locator('#fpform input[name="name"]');
    await name.waitFor({ timeout: 8000 });
    await name.fill(`Tên thử ${TAG}`);
    // the draft is written when the page says so: "Đã lưu nháp" is set after the IndexedDB write
    await page.waitForFunction(() => /Đã lưu nháp/.test(document.getElementById('fpstat')?.textContent || ''), null, { timeout: 8000 });
    await page.goto(base + '/#mine');
    await waitPastLoading(page);
    assert.match(await page.locator('main').innerText(), /Bản nháp/, 'the owner has a draft');
    await openSheet(page);
    await reloadedAfter(page, () => page.click(`dialog.acct-sh [data-switch][data-email="${MEMBER}"]`));
    await waitPastLoading(page); // the reload draws a skeleton first: wait for the list before reading it
    assert.doesNotMatch(await page.locator('main').innerText(), /Bản nháp/, 'the member account does not see the owner draft');
    await openSheet(page);
    await reloadedAfter(page, () => page.click(`dialog.acct-sh [data-switch][data-email="${OWNER}"]`));
    await page.evaluate(() => { location.hash = '#mine'; }); // the sheet is opened from Thêm: back to the list with the draft
    await waitPastLoading(page);
    // the list can redraw after the sign-in reload: wait for the draft to be on screen, do not read one snapshot
    await page.waitForFunction(() => /Bản nháp/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 15000 });
    await ctx.close();
  } finally { await browser.close(); }
});

test('a switch right after typing keeps the draft: the pending write is flushed before the reload', { skip }, async () => {
  if (skip || !personId) return;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await contextWith(browser, [MEMBER, OWNER]);
    const page = await ctx.newPage();
    const typed = `Tên nhanh ${TAG}`;
    await page.goto(base + '/#/duong/sua/' + personId);
    await waitPastLoading(page);
    await page.locator('#fpform input[name="name"]').fill(typed);
    await openSheet(page); // no wait: the 800 ms debounce has not fired yet
    await reloadedAfter(page, () => page.click(`dialog.acct-sh [data-switch][data-email="${MEMBER}"]`));
    await openSheet(page);
    await reloadedAfter(page, () => page.click(`dialog.acct-sh [data-switch][data-email="${OWNER}"]`));
    await page.goto(base + '/#/duong/sua/' + personId);
    await waitPastLoading(page);
    await page.locator('button[data-dr-go]').click({ timeout: 8000 });
    assert.equal(await page.locator('#fpform input[name="name"]').inputValue(), typed, 'the typed draft is restored after the switch');
    await ctx.close();
  } finally { await browser.close(); }
});

test('sign out one keeps the other signed in; sign out all shows the guest card', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await contextWith(browser, [MEMBER, OWNER]);
    const page = await ctx.newPage();
    await page.goto(base + '/#more');
    await waitForCard(page, /Chủ họ/);
    await openSheet(page);
    await page.click('dialog.acct-sh [data-out="one"]');
    await page.waitForSelector('dialog.cfm h2');
    assert.equal(await page.textContent('dialog.cfm h2'), 'Đăng xuất khỏi tài khoản này?');
    await Promise.all([page.waitForEvent('load'), page.click('[data-cfm-ok]')]);
    await waitForCard(page, /Thành viên/);
    assert.match(await page.textContent('.acct-card'), new RegExp(MEMBER_NAME));
    await openSheet(page);
    await page.click('dialog.acct-sh [data-out="all"]');
    await page.waitForSelector('dialog.dcf h2');
    assert.match(await page.textContent('dialog.dcf h2'), /tất cả/);
    await Promise.all([page.waitForEvent('load'), page.click('dialog.dcf [data-dcf-ok]')]);
    await page.waitForSelector('main #login', { timeout: 8000 });
    assert.equal(await page.locator('main #login').count(), 1, 'guest: Đăng nhập is offered');
    await ctx.close();
  } finally { await browser.close(); }
});
