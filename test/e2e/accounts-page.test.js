// E2E: Thêm › Tài khoản (#tai-khoan) and the account sheet (390 px). Real server + own schema e2e_accounts_page.
// Checks: the sheet opens with focus on its heading (no ring on the close button) and links to the page; the main page is a
// header card and one list of summary rows ("Cách đăng nhập", "Thiết bị đang đăng nhập", "Dòng họ của tôi", "Bảo mật"), a
// "Đăng xuất" button and a quiet "Vùng nguy hiểm" link; each row opens its subpage (#tai-khoan/<sub>) with a back button.
// Every capability is still reachable from a subpage: add and remove an email, unlink Google (menu), a passkey row, sign out
// other devices, sign out. Signed out shows a sign-in button, not a bare error. A stale sign-in asks to confirm first.
// Invented names only.
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
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const OWNER = 'owner-acctpage-e2e@test.local';
const EXTRA = 'second-acctpage@test.local';
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'accounts_page');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into persons (id, family_id, data, updated_by) values ('P001','duong',$1,'e2e') on conflict do nothing", [{ name: 'Dương Văn Tổ Thử', sex: 'm', gen: 1, died: '1900' }]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ Thử','duong','owner','active') on conflict (family_id, email) do nothing", [OWNER]);
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

async function ownerPage({ scheme = 'light', authAge = 0 } = {}) {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ Thử', sub: 'e2e-sub-owner', auth_age_ms: authAge }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, serviceWorkers: 'block' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}
async function anonPage(scheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, serviceWorkers: 'block' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const shot = (page, name) => (SHOT ? page.screenshot({ path: path.join(SHOT, name), fullPage: true }) : null);
// Opens a subpage by hash and waits until the page is drawn (the loading line is gone).
async function openSub(page, hash) {
  await page.goto(base + '/#' + hash);
  await page.waitForSelector('.acc-root');
  await page.waitForLoadState('networkidle'); // the app may draw the page twice: wait for the last draw
  await page.waitForFunction(() => !document.body.innerText.includes('Đang tải'));
}

test('account sheet: focus on the heading, link to Tài khoản', { skip }, async () => {
  const { ctx, page, errors } = await ownerPage();
  try {
    await page.goto(base + '/#more');
    await page.waitForSelector('.mg-who');
    await page.click('button.acct-open');
    await page.waitForSelector('dialog.acct-sh[open]');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'acct-h', 'focus lands on the heading');
    await page.keyboard.press('Tab'); // the close button, focused from the keyboard
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('csw-x')), true);
    const ring = await page.locator('dialog.acct-sh .csw-x').evaluate((el) => getComputedStyle(el).outlineOffset);
    assert.ok(parseFloat(ring) < 0, 'an edge button draws its focus ring inside: ' + ring);
    await page.click('dialog.acct-sh .acc-manage');
    await page.waitForSelector('.acc-root');
    assert.equal(await page.locator('dialog.acct-sh').count(), 0, 'the sheet closed');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

for (const scheme of ['light', 'dark']) {
  test(`account main page (${scheme}): header card, summary rows, sign out, danger zone link`, { skip }, async () => {
    const { ctx, page, errors } = await ownerPage({ scheme });
    try {
      await page.goto(base + '/#more');
      await page.waitForSelector('.acct-manage');
      await page.click('.acct-manage a');
      await page.waitForSelector('.acc-root');
      assert.equal((await page.textContent('#cbtitle')).trim(), 'Tài khoản');
      assert.equal((await page.textContent('.acc-head .acct-tx b')).trim(), 'Chủ họ Thử');
      assert.match(await page.textContent('.acc-head'), new RegExp(OWNER.replace(/\./g, '\\.')));
      // one list of summary rows, each a link to its subpage
      const rows = await page.$$eval('.acc-root > .mg .mg-g a.calm', (els) => els.map((e) => e.getAttribute('href')));
      assert.deepEqual(rows, ['#tai-khoan/dang-nhap', '#tai-khoan/thiet-bi', '#tai-khoan/dong-ho', '#tai-khoan/bao-mat']);
      assert.match(await page.textContent('a[href="#tai-khoan/dang-nhap"]'), /1 email · Google/);
      assert.match(await page.textContent('a[href="#tai-khoan/dong-ho"]'), /Họ Dương · Chủ họ/);
      assert.match(await page.textContent('a[href="#tai-khoan/thiet-bi"]'), /\d+ thiết bị/);
      // no details on the main page
      assert.equal(await page.locator('.acc-root [data-soon]').count(), 0, 'no "Sắp có" rows on the main page');
      assert.equal(await page.locator('[data-add-email], [data-link="google"], [data-out-others]').count(), 0);
      assert.equal((await page.textContent('#logout')).trim(), 'Đăng xuất');
      assert.equal(await page.locator('.acc-root .mg-g a.calm .ibox svg').count(), 4, 'a leading icon on each summary row');
      assert.equal(await page.locator('#logout svg').count(), 1, 'sign out has a log-out icon');
      assert.equal(await page.locator('#logout').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'sign out is outlined, not filled red');
      assert.equal(await page.locator('a.acc-quiet svg').count(), 1, 'danger zone link has a warning icon');
      assert.equal(await page.locator('a.acc-quiet[href="#tai-khoan/vung-nguy-hiem"]').count(), 1);
      await shot(page, `account-main-${scheme}.png`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  });
}

test('subpages: each row opens its page with a back button; every capability is reachable', { skip }, async () => {
  const { ctx, page, errors } = await ownerPage();
  try {
    // sign-in methods: the email form, the Google row, the grouped list, the soon rows
    await openSub(page, 'tai-khoan/dang-nhap');
    assert.equal((await page.textContent('#cbtitle')).trim(), 'Cách đăng nhập');
    assert.equal(await page.locator('#cbback').count(), 1, 'back button on a subpage');
    const subs = await page.$$eval('.acc-root .acc-sub-h', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(subs, ['Email', 'Số điện thoại', 'Passkey', 'Tài khoản liên kết', 'Xác minh 2 bước']);
    for (const s of ['Thêm số điện thoại', 'Apple', 'Zalo', 'Facebook', 'Ứng dụng xác thực', 'Mã khôi phục', 'Tạo passkey trên thiết bị này']) {
      assert.equal(await page.locator('.acc-root [data-soon]', { hasText: s }).count(), 1, 'Sắp có: ' + s);
    }
    assert.equal(await page.locator('[data-soon]').first().isDisabled(), true);
    assert.equal(await page.locator('.acc-root .calm', { hasText: 'Google' }).locator('.tag', { hasText: 'Đã liên kết' }).count(), 1);
    // unlink Google: the ⋯ of the Google row offers "Gỡ liên kết" (not clicked: it is the only sign-in method)
    await page.locator('.acc-root .calm-row', { hasText: 'Đã liên kết' }).locator('[data-idm]').click();
    assert.deepEqual(await page.$$eval('.menu [role=menuitem]', (els) => els.map((e) => e.textContent.trim())), ['Gỡ liên kết']);
    await page.keyboard.press('Escape');
    await shot(page, `account-dang-nhap-light.png`);
    // add an email, then remove it again from its ⋯ menu
    await page.click('[data-add-email]');
    await page.fill('#acc-em', EXTRA);
    await page.click('.acc-form button[type=submit]');
    await page.waitForSelector(`.acc-root .calm:has-text("${EXTRA}")`);
    assert.equal(await page.locator('.acc-root .calm', { hasText: EXTRA }).locator('.tag', { hasText: 'Chưa xác minh' }).count(), 1);
    await page.locator('.calm-row', { hasText: EXTRA }).locator('[data-em]').click();
    assert.deepEqual(await page.$$eval('.menu [role=menuitem]', (els) => els.map((e) => e.textContent.trim())), ['Gửi lại đường dẫn xác minh', 'Gỡ email']);
    await page.click('.menu [role=menuitem]:has-text("Gỡ email")');
    await page.click('dialog.cfm [data-cfm-ok]');
    await page.waitForSelector('text=Đã gỡ email.');
    assert.equal(await page.locator('.acc-root .calm', { hasText: EXTRA }).count(), 0, 'the email is gone');
    // devices: this device, and the sign-out of the other ones
    await openSub(page, 'tai-khoan/thiet-bi');
    assert.equal((await page.textContent('#cbtitle')).trim(), 'Thiết bị đang đăng nhập');
    assert.ok(await page.locator('.acc-root .calm', { hasText: 'Thiết bị này' }).count() >= 1);
    assert.equal(await page.locator('[data-out-others]').count(), 1, 'other devices exist (one per ownerPage call)');
    await page.click('[data-out-others]');
    await page.click('dialog.cfm [data-cfm-ok]');
    await page.waitForSelector('text=Đã đăng xuất các thiết bị khác.');
    assert.equal(await page.locator('[data-out-others]').count(), 0);
    // families with the role
    await openSub(page, 'tai-khoan/dong-ho');
    assert.equal((await page.textContent('#cbtitle')).trim(), 'Dòng họ của tôi');
    assert.match(await page.textContent('.acc-root'), /Họ Dương/);
    assert.ok(await page.locator('.acc-root .calm .tag', { hasText: 'Chủ họ' }).count() >= 1, 'families with the role');
    // security activity
    await openSub(page, 'tai-khoan/bao-mat');
    assert.equal((await page.textContent('#cbtitle')).trim(), 'Bảo mật');
    assert.ok(await page.locator('.acc-root .calm').count() >= 1, 'sign-in history is listed');
    // danger zone: the delete row is "Sắp có"
    await openSub(page, 'tai-khoan/vung-nguy-hiem');
    assert.equal(await page.locator('.acc-root [data-soon]', { hasText: 'Xóa tài khoản' }).count(), 1);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('passkey row and the account name', { skip }, async () => {
  await pool.query("insert into passkeys (cred_id, public_key, transports, account, family_id, label) values ('acct-page-e2e-cred', '\\x00', '{}', $1, 'duong', 'iPhone e2e') on conflict do nothing", ['g:' + OWNER]);
  const { ctx, page, errors } = await ownerPage({ scheme: 'dark' });
  try {
    await openSub(page, 'tai-khoan/dang-nhap');
    assert.match(await page.textContent('.acc-root'), /iPhone e2e/, 'passkey listed');
    await page.goto(base + '/#tai-khoan');
    await page.waitForSelector('a[href="#tai-khoan/dang-nhap"]');
    assert.match(await page.textContent('a[href="#tai-khoan/dang-nhap"]'), /1 thiết bị passkey/);
    await page.click('[data-edit-name]');
    await page.fill('#acc-nm', 'Chủ họ Thử Hai');
    await page.click('.acc-head button[type=submit]');
    await page.waitForSelector('text=Đã lưu tên.');
    assert.equal((await page.textContent('.acc-head .acct-tx b')).trim(), 'Chủ họ Thử Hai');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('signed out: a short line and a Đăng nhập button, no bare error', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page, errors } = await anonPage(scheme);
    try {
      await page.goto(base + '/#tai-khoan');
      await page.waitForSelector('[data-acct="in"]');
      const text = await page.textContent('.acc-root');
      assert.doesNotMatch(text, /Cần đăng nhập\./);
      assert.match(text, /Đăng nhập để xem và đổi email/);
      assert.equal((await page.textContent('[data-acct="in"]')).trim(), 'Đăng nhập');
      await shot(page, `account-signedout-${scheme}.png`);
      await page.click('[data-acct="in"]');
      await page.waitForSelector('dialog.dlg[open] h2');
      assert.match(await page.textContent('dialog.dlg h2'), /Đăng nhập để sửa/);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

test('sign out from the account page returns to the signed-out state', { skip }, async () => {
  const { ctx, page, errors } = await ownerPage();
  try {
    await openSub(page, 'tai-khoan');
    await page.click('#logout');
    await page.click('dialog.cfm [data-cfm-ok]');
    await page.waitForSelector('[data-acct="in"]', { timeout: 10000 });
    assert.doesNotMatch(await page.textContent('.acc-root'), /Cần đăng nhập\./);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('add email after a fresh sign-in; a stale sign-in asks to confirm first', { skip }, async () => {
  let { ctx, page, errors } = await ownerPage();
  try {
    await openSub(page, 'tai-khoan/dang-nhap');
    await page.click('[data-add-email]');
    await page.fill('#acc-em', 'third-acctpage@test.local');
    await page.click('.acc-form button[type=submit]');
    await page.waitForSelector('.acc-root .calm:has-text("third-acctpage@test.local")');
    assert.equal(await page.locator('.acc-root .calm', { hasText: 'third-acctpage@test.local' }).locator('.tag', { hasText: 'Chưa xác minh' }).count(), 1);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
  ({ ctx, page, errors } = await ownerPage({ authAge: 20 * 60e3 }));
  try {
    await openSub(page, 'tai-khoan/dang-nhap');
    await page.click('[data-link="google"]');
    await page.waitForSelector('dialog.cfm[open]');
    assert.match(await page.textContent('dialog.cfm'), /Xác nhận đây là bạn/);
  } finally { await ctx.close(); }
});
