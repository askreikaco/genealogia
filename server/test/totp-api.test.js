// Two-step sign-in against a SCRATCH database (GP_TEST_DATABASE_URL; skipped otherwise). Real routes, real cookies:
// set up and confirm (fresh sign-in), sign in with a code, a recovery code once, a code once, the attempt limit, a stale
// sign-in refused, a fresh sign-in renewed with a code, and turning it off. TOTP codes are used only where the step is
// known to be new (replay protection), so the file does not depend on the wall clock.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const TR = require('../totp-rules');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const EMAIL = `totp.${TAG}@example.test`;
const SECRET = crypto.randomBytes(24).toString('hex');
const SUB = 'totp-sub-' + TAG;
let base, pool, close;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  const all = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  return { status: r.status, json, all };
}
const cookieNamed = (all, name) => { const c = all.find((x) => x.startsWith(name + '=') && !/Max-Age=0/.test(x)); return c ? c.split(';')[0] : null; };
// The test sign-in (Google-like). With two-step on it returns { needs_2fa } and a pending cookie instead.
const testSignIn = (authAgeMs = 0) => call('POST', '/api/test/session', { email: EMAIL, name: 'Thử TOTP', sub: SUB, auth_age_ms: authAgeMs });
// The same cookie with an older sign-in time (re-signed with the test secret, as the server would): the stale case.
function aged(cookie, ageMs) {
  const v = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  const [body] = v.split('.');
  const s = JSON.parse(Buffer.from(body, 'base64url').toString());
  s.accs[s.a].at = Date.now() - ageMs;
  const b = Buffer.from(JSON.stringify(s)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  return `gp_s=${encodeURIComponent(b + '.' + sig)}`;
}
const accountIdOf = async () => (await pool.query("select account_id from identities where type = 'email' and value_norm = $1", [EMAIL])).rows[0].account_id;

let sessionCookie; let secret; let recovery;
test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = SECRET; process.env.EDITORS = '';
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://localhost:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
});
test.after(async () => { if (skip) return; await close?.(); await pool?.end().catch(() => {}); });

test('set up needs a fresh sign-in; a stale one is asked to sign in again', { skip }, async () => {
  const stale = aged(cookieNamed((await testSignIn()).all, 'gp_s'), 11 * 60e3);
  const r = await call('POST', '/api/account/totp/setup', {}, stale);
  assert.equal(r.status, 401);
  assert.equal(r.json.reauth, true);
});

test('set up returns a secret and an SVG QR; a wrong code is refused; the right one turns it on and gives ten codes', { skip }, async () => {
  sessionCookie = cookieNamed((await testSignIn()).all, 'gp_s');
  const s = await call('POST', '/api/account/totp/setup', {}, sessionCookie);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.match(s.json.secret, /^[A-Z2-7]{32}$/);
  assert.match(s.json.uri, /^otpauth:\/\/totp\//);
  assert.match(s.json.qr, /<svg/);
  secret = TR.base32Decode(s.json.secret);
  assert.equal((await call('POST', '/api/account/totp/confirm', { code: '000000' }, sessionCookie)).status, 401);
  const ok = await call('POST', '/api/account/totp/confirm', { code: TR.hotp(secret, Math.floor(Date.now() / 30e3)) }, sessionCookie);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.recovery_codes.length, 10);
  recovery = ok.json.recovery_codes;
  const { rows: [raw] } = await pool.query('select secret_enc from totp_factors where account_id = $1', [await accountIdOf()]);
  assert.ok(!raw.secret_enc.includes(s.json.secret), 'the secret is not stored in plain text');
  const { rows: [n] } = await pool.query('select count(*)::int as n from recovery_codes where account_id = $1 and used_at is null', [await accountIdOf()]);
  assert.equal(n.n, 10);
});

test('account page: two-step sign-in on with ten codes left', { skip }, async () => {
  const r = await call('GET', '/api/account', undefined, sessionCookie);
  assert.equal(r.status, 200);
  assert.equal(r.json.totp.enabled, true);
  assert.equal(r.json.totp.recovery_left, 10);
});

test('sign-in stops after the first factor; a wrong code is refused; a new step signs in', { skip }, async () => {
  const r = await testSignIn();
  assert.equal(r.json.needs_2fa, true);
  const pending = cookieNamed(r.all, 'gp_2fa');
  assert.ok(pending, 'a pending cookie');
  assert.equal(cookieNamed(r.all, 'gp_s'), null, 'no session before the code');
  assert.deepEqual((await call('GET', '/api/auth/2fa/state', undefined, pending)).json, { pending: true, email: EMAIL });
  assert.equal((await call('POST', '/api/auth/2fa/verify', { code: '000000' }, pending)).status, 401);
  // the confirm used the current step; the next one is new and still inside the window
  const next = TR.hotp(secret, Math.floor(Date.now() / 30e3) + 1);
  const good = await call('POST', '/api/auth/2fa/verify', { code: next }, pending);
  assert.equal(good.status, 200, JSON.stringify(good.json));
  assert.equal(good.json.to, '/');
  assert.ok(cookieNamed(good.all, 'gp_s'), 'the session starts now');
  assert.equal((await call('POST', '/api/auth/2fa/verify', { code: next }, pending)).status, 401, 'a pending cookie is used once');
});

test('a code signs in once: the step just used is refused on the next sign-in', { skip }, async () => {
  const r = await testSignIn();
  const pending = cookieNamed(r.all, 'gp_2fa');
  const { rows: [f] } = await pool.query('select last_step from totp_factors where account_id = $1', [await accountIdOf()]);
  assert.equal((await call('POST', '/api/auth/2fa/verify', { code: TR.hotp(secret, Number(f.last_step)) }, pending)).status, 401);
});

test('a recovery code signs in once; the same one again is refused; the count drops', { skip }, async () => {
  const r = await testSignIn();
  const ok = await call('POST', '/api/auth/2fa/verify', { code: recovery[0].toLowerCase() }, cookieNamed(r.all, 'gp_2fa'));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const r2 = await testSignIn();
  assert.equal((await call('POST', '/api/auth/2fa/verify', { code: recovery[0] }, cookieNamed(r2.all, 'gp_2fa'))).status, 401);
  const acc = await call('GET', '/api/account', undefined, cookieNamed(ok.all, 'gp_s'));
  assert.equal(acc.json.totp.recovery_left, 9);
});

test('five wrong codes in ten minutes block the account, even a right code', { skip }, async () => {
  // earlier failures in this file are older than the window (set back in the row, not slept)
  await pool.query("update totp_factors set fail_count = 0, fail_at = null where account_id = $1", [await accountIdOf()]);
  const r = await testSignIn();
  const pending = cookieNamed(r.all, 'gp_2fa');
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call('POST', '/api/auth/2fa/verify', { code: '111111' }, pending)).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
  assert.equal((await call('POST', '/api/auth/2fa/verify', { code: TR.hotp(secret, Math.floor(Date.now() / 30e3) + 1) }, pending)).status, 429);
});

test('a change needs a fresh sign-in: a stale one is refused with reauth; a fresh one renewed with the code', { skip }, async () => {
  // reauth as the Google callback opens it: a pending row for this session in mode 'reauth' (the cookie holds the token)
  const stale = aged(sessionCookie, 11 * 60e3);
  const refused = await call('DELETE', '/api/account/totp', {}, stale);
  assert.equal(refused.status, 401);
  assert.equal(refused.json.reauth, true);
  // a fresh sign-in is the reauth flow: the code is asked again, then the session time is renewed
  const tok = crypto.randomBytes(24).toString('base64url');
  const sidOf = (cookie) => JSON.parse(Buffer.from(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).split('.')[0], 'base64url')).accs[0].sid;
  const sidFromCookie = sidOf(sessionCookie);
  // time has passed (set back in the row, not slept): the attempt window is over and the earlier step is old
  await pool.query("update totp_factors set fail_count = 0, fail_at = null, last_step = 0 where account_id = $1", [await accountIdOf()]);
  await pool.query("insert into login_2fa (id, account_id, mode, sid, payload, expires_at) values ($1, $2, 'reauth', $3, $4, now() + interval '5 minutes')",
    [require('../accounts').sha(tok), await accountIdOf(), sidFromCookie, { to: '/#tai-khoan?ok=reauth' }]);
  // the browser sends both cookies: the pending token and this device's session
  const v = await call('POST', '/api/auth/2fa/verify', { code: TR.hotp(secret, Math.floor(Date.now() / 30e3) + 1) }, `gp_2fa=${tok}; ${sessionCookie}`);
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.to, '/#tai-khoan?ok=reauth');
});

test('turning it off needs a fresh sign-in, removes the secret and the codes; sign-in is one step again', { skip }, async () => {
  const off = await call('DELETE', '/api/account/totp', {}, sessionCookie);
  assert.equal(off.status, 200, JSON.stringify(off.json));
  const { rows: [n] } = await pool.query('select (select count(*) from totp_factors where account_id = $1)::int as f, (select count(*) from recovery_codes where account_id = $1)::int as r', [await accountIdOf()]);
  assert.deepEqual([n.f, n.r], [0, 0]);
  const plain = await testSignIn();
  assert.ok(cookieNamed(plain.all, 'gp_s'));
});

test('recovery codes can only be made with two-step on', { skip }, async () => {
  const c = cookieNamed((await testSignIn()).all, 'gp_s');
  assert.equal((await call('POST', '/api/account/totp/recovery', {}, c)).status, 400);
});
