// E2E: two-step sign-in (TOTP) on the Account page and the sign-in step, 390 px, light. Real server, own schema e2e_totp.
// Flow: a fresh sign-in turns it on from Tài khoản › Bảo mật (QR and secret; a wrong code is refused; the right one shows
// ten recovery codes once); sign out; a sign-in stops at the code prompt; a wrong code is refused; a code signs in; sign
// out; a recovery code signs in once; turning it off uses the danger confirm. Screenshots: GP_SHOT_DIR.
// The Google step is replaced by /api/test/session (as in the other account tests); the code is computed from the secret
// the page shows, for a step later than the last one used (the server refuses a step twice).
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

const OWNER = 'owner-totp-e2e@test.local';
const TR = require('../../server/totp-rules');
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'totp');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
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

const shot = (page, name) => (SHOT ? page.screenshot({ path: path.join(SHOT, name), fullPage: true }) : null);
const toast = (page, text) => page.waitForSelector(`text=${text}`, { timeout: 10000 });
const accountIdOf = async () => (await pool.query("select account_id from identities where type = 'email' and value_norm = $1 and verified_at is not null", [OWNER])).rows[0].account_id;
// The test sign-in in the browser (cookies land in its context). Returns the JSON: { needs_2fa } when two-step is on.
const testSignIn = (page, authAgeMs = 0) => page.evaluate(async ({ url, email, auth_age_ms }) => {
  const r = await fetch(url + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: 'Chủ họ Thử', sub: 'e2e-sub-totp-owner', auth_age_ms }) });
  return { status: r.status, json: await r.json() };
}, { url: base, email: OWNER, auth_age_ms: authAgeMs });
// Fills the sign-in step and waits for its answer and the move on (the app leaves #dang-nhap-2fa when the sign-in is done).
async function submitCode(page, value) {
  await page.fill('.twostep-form input', value);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/auth/2fa/verify') && r.request().method() === 'POST'),
    page.click('.twostep-form button[type=submit]'),
  ]);
  return resp;
}
// A code for a step the account has not used yet, inside the window of now.
async function freshCode(secret) {
  const { rows: [f] } = await pool.query('select last_step from totp_factors where account_id = $1', [await accountIdOf()]);
  const cur = Math.floor(Date.now() / 30e3);
  const step = Math.max(cur, Number(f.last_step) + 1);
  assert.ok(step <= cur + 1, 'a new step inside the window');
  return TR.hotp(TR.base32Decode(secret), step);
}

test('two-step sign-in: set up from Bảo mật, sign in with a code, sign in with a recovery code, turn it off', { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', serviceWorkers: 'block' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    // ---- set up ----
    await page.goto(base + '/#tree'); // the sign-in call runs from the app's own origin
    assert.equal((await testSignIn(page)).status, 200);
    await page.goto(base + '/#tai-khoan/bao-mat');
    await page.waitForSelector('.acc-root');
    await page.waitForFunction(() => !document.body.innerText.includes('Đang tải'));
    assert.match(await page.textContent('.acc-root'), /Chưa bật/);
    await page.click('a[href="#tai-khoan/xac-minh"]');
    await page.waitForSelector('[data-totp-on]');
    await page.click('[data-totp-on]');
    await page.waitForSelector('[data-totp-form]');
    await page.waitForSelector('.totp-qr svg');
    const secret = (await page.textContent('.totp-secret')).replace(/\s+/g, '');
    assert.match(secret, /^[A-Z2-7]{32}$/);
    await shot(page, 'totp-enroll-390.png');
    // a wrong code is refused and nothing is turned on
    await page.fill('#totp-code', '000000');
    await page.click('[data-totp-form] button[type=submit]');
    await toast(page, 'Mã chưa đúng');
    assert.equal(await pool.query('select enabled from totp_factors where account_id = $1', [await accountIdOf()]).then((r) => r.rows[0].enabled), false);
    // the right one turns it on and shows the recovery codes once
    await page.fill('#totp-code', TR.hotp(TR.base32Decode(secret), Math.floor(Date.now() / 30e3)));
    await page.click('[data-totp-form] button[type=submit]');
    await page.waitForSelector('.totp-codes li');
    const codes = await page.$$eval('.totp-codes code', (els) => els.map((e) => e.textContent.trim()));
    assert.equal(codes.length, 10);
    assert.ok(codes.every((c) => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)), 'XXXX-XXXX codes');
    await shot(page, 'totp-recovery-codes-390.png');
    await page.click('[data-codes-done]');
    await page.waitForSelector('[data-totp-off]');
    const stored = await pool.query('select count(*)::int as n from recovery_codes where account_id = $1 and used_at is null', [await accountIdOf()]);
    assert.equal(stored.rows[0].n, 10);

    // ---- sign out, then sign in with a code ----
    await ctx.clearCookies();
    const first = await testSignIn(page);
    assert.equal(first.json.needs_2fa, true, 'the first factor is not enough');
    await page.goto(base + '/#dang-nhap-2fa');
    await page.waitForSelector('.twostep-form input');
    assert.match(await page.textContent('.acc-root'), new RegExp(OWNER.replace(/\./g, '\\.')));
    await shot(page, 'totp-code-prompt-390.png');
    assert.equal((await submitCode(page, '999999')).status(), 401);
    await page.waitForSelector('.acc-out .err:not([hidden])');
    const ok = await submitCode(page, await freshCode(secret));
    assert.equal(ok.status(), 200);
    await page.waitForURL((u) => !u.toString().includes('dang-nhap-2fa'), { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    let me = await page.evaluate(async () => (await (await fetch('/api/me', { cache: 'no-store' })).json()));
    assert.equal(me.email, OWNER, 'signed in after the code');

    // ---- sign out, then sign in with a recovery code (once) ----
    await ctx.clearCookies();
    assert.equal((await testSignIn(page)).json.needs_2fa, true);
    await page.goto(base + '/#dang-nhap-2fa');
    await page.waitForSelector('.twostep-form input');
    assert.equal((await submitCode(page, codes[0].toLowerCase())).status(), 200);
    await page.waitForURL((u) => !u.toString().includes('dang-nhap-2fa'), { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    me = await page.evaluate(async () => (await (await fetch('/api/me', { cache: 'no-store' })).json()));
    assert.equal(me.email, OWNER, 'signed in with a recovery code');
    const left = await pool.query('select count(*)::int as n from recovery_codes where account_id = $1 and used_at is null', [await accountIdOf()]);
    assert.equal(left.rows[0].n, 9, 'one recovery code used');

    // ---- turn it off: the danger confirm, and it is one step again ----
    await page.goto(base + '/#tai-khoan/xac-minh');
    await page.waitForSelector('[data-totp-off]');
    await page.click('[data-totp-off]');
    await page.waitForSelector('dialog.dcf[open]');
    await page.click('dialog.dcf [data-dcf-ok]');
    await toast(page, 'Đã tắt xác minh 2 bước.');
    const off = await pool.query('select (select count(*) from totp_factors where account_id = $1)::int as f, (select count(*) from recovery_codes where account_id = $1)::int as r', [await accountIdOf()]);
    assert.deepEqual([off.rows[0].f, off.rows[0].r], [0, 0], 'secret and codes removed');
    await ctx.clearCookies();
    const plain = await testSignIn(page);
    assert.equal(plain.json.needs_2fa, undefined, 'one step again');
    assert.ok((await ctx.cookies()).some((c) => c.name === 'gp_s'), 'signed in with the first factor');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
