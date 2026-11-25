// E2E: passkeys on the Account page and the sign-in dialog (390 px, dark). Real server, own schema e2e_accounts_passkey,
// a virtual authenticator (CDP WebAuthn.addVirtualAuthenticator: CTAP2, internal, resident keys, user verified).
// Flow: a fresh sign-in adds a passkey from Tài khoản › Cách đăng nhập; sign out; "Đăng nhập bằng passkey" on the sign-in
// dialog signs in with no email typed; the passkey is removed through the danger confirm. Screenshots: GP_SHOT_DIR.
// The page runs on localhost (WebAuthn needs a real host name, not an IP). Invented names only.
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

const OWNER = 'owner-passkey-e2e@test.local';
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'accounts_passkey');
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
  base = `http://localhost:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close(); srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

// A page signed in as the owner with a fresh sign-in (auth age 0), and a virtual platform authenticator on it.
async function ownerWithAuthenticator() {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ Thử', sub: 'e2e-sub-passkey-owner', auth_age_ms: 0 }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', serviceWorkers: 'block' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { ctx, page, errors };
}
const shot = (page, name) => (SHOT ? page.screenshot({ path: path.join(SHOT, name), fullPage: true }) : null);
async function openSub(page, hash) {
  await page.goto(base + '/#' + hash);
  await page.waitForSelector('.acc-root');
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.body.innerText.includes('Đang tải'));
}
const toast = (page, text) => page.waitForSelector(`text=${text}`, { timeout: 10000 });

test('passkey: add from Cách đăng nhập, sign out, sign in with it (no email typed), remove it', { skip }, async () => {
  const { ctx, page, errors } = await ownerWithAuthenticator();
  try {
    await openSub(page, 'tai-khoan/dang-nhap');
    assert.equal(await page.locator('.acc-root [data-pk-id]').count(), 0, 'no passkey yet');
    await page.click('[data-add-passkey]');
    await toast(page, 'Đã thêm passkey.');
    await page.waitForFunction(() => document.querySelectorAll('[data-pk-id]').length === 1);
    const { rows: [acct] } = await pool.query("select account_id from identities where type = 'email' and value_norm = $1 and verified_at is not null", [OWNER]);
    const { rows } = await pool.query('select label, account_id, counter from passkeys where account_id = $1', [acct.account_id]);
    assert.equal(rows.length, 1, 'one passkey stored for the account');
    assert.ok(rows[0].label, 'a device label was stored');
    await openSub(page, 'tai-khoan/dang-nhap');
    assert.match(await page.textContent('.acc-root'), /không cần mật khẩu/, 'the one plain line about passkeys');
    await page.waitForSelector('.toast', { state: 'hidden', timeout: 10000 }); // the toast has gone
    await page.mouse.move(0, 0);
    await shot(page, 'passkey-cach-dang-nhap-390-dark.png');

    // sign out here: the cookie goes, the passkey stays on the authenticator
    await ctx.clearCookies();
    await page.goto(base + '/#tai-khoan');
    await page.waitForSelector('[data-acct="in"]');
    await page.click('[data-acct="in"]');
    await page.waitForSelector('.pk-login:not([hidden])');
    await page.waitForSelector('.toast', { state: 'hidden', timeout: 10000 });
    await shot(page, 'passkey-login-dialog-390-dark.png');
    // the dialog reloads the page once the passkey is accepted
    await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('[data-pk-login]')]);
    await page.waitForLoadState('networkidle');
    const me = await page.evaluate(async () => (await (await fetch('/api/me', { cache: 'no-store' })).json()));
    assert.equal(me.email, OWNER, 'signed in as the passkey owner');

    // remove it through the menu and the danger confirm
    await openSub(page, 'tai-khoan/dang-nhap');
    await page.click('[data-pk-id]');
    await page.click('.rds-menu [role="menuitem"]:has-text("Gỡ passkey")');
    await page.waitForSelector('dialog#dcf[open]');
    await page.click('dialog#dcf [data-rds-confirm]');
    await toast(page, 'Đã gỡ passkey.');
    await page.waitForFunction(() => document.querySelectorAll('[data-pk-id]').length === 0);
    const left = await pool.query('select count(*)::int as n from passkeys where account_id = $1', [acct.account_id]);
    assert.equal(left.rows[0].n, 0, 'removed on the server');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
