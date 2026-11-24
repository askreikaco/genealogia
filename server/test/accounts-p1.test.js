// Accounts P1: one account with many identities, server sessions, the Account page API, the backfill script.
// Rules run anywhere; the API part needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
// Google sign-in is simulated with POST /api/test/session ({ email, sub?, auth_age_ms? }); the mailed verification
// link is simulated by making a token with accounts.newToken (mail is not configured in tests).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const A = require('../accounts');

// ---------- rules (no database) ----------
test('rules: ip prefix, device label, re-auth window', () => {
  assert.equal(A.ipPrefix('203.0.113.77'), '203.0.113.0/24');
  assert.equal(A.ipPrefix('::ffff:198.51.100.9'), '198.51.100.0/24');
  assert.equal(A.ipPrefix('2001:db8:abcd:12::1'), '2001:db8:abcd::/48');
  assert.equal(A.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'iPhone · Safari');
  assert.equal(A.deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'), 'Windows · Chrome');
  const now = 1e12;
  assert.equal(A.fresh(now - 9 * 60e3, now), true);
  assert.equal(A.fresh(now - 11 * 60e3, now), false);
  assert.equal(A.fresh(0, now), false);
});
test('rules: keep one sign-in method and one verified email; primary must be verified', () => {
  const ids = [
    { id: 1, type: 'email', value_norm: 'a@x.vn', verified_at: 't', is_primary: true },
    { id: 2, type: 'email', value_norm: 'b@x.vn', verified_at: null, is_primary: false },
    { id: 3, type: 'google', value_norm: 'a@x.vn', provider_sub: 's', verified_at: 't' },
  ];
  assert.match(A.removeBlock(ids, 1), /email chính/);
  assert.equal(A.removeBlock(ids, 2), '');
  assert.match(A.removeBlock(ids, 3), /duy nhất/);
  assert.equal(A.removeBlock(ids, 3, 1), '', 'a passkey is another sign-in method');
  assert.equal(A.signInCount(ids, 2), 3);
  assert.equal(A.canBePrimary(ids, 2), false);
  const two = [...ids, { id: 4, type: 'email', value_norm: 'c@x.vn', verified_at: 't', is_primary: false }];
  assert.equal(A.canBePrimary(two, 4), true);
  assert.equal(A.removeBlock(two, 4), '');
  assert.match(A.removeBlock([{ id: 1, type: 'email', value_norm: 'a', verified_at: 't', is_primary: false }], 1), /ít nhất một email/);
});
test('rules: rate limit counts per key and window', () => {
  const k = 'test:' + crypto.randomBytes(4).toString('hex');
  for (let i = 0; i < 3; i++) assert.equal(A.hit(k, 3, 1000, 5000), true);
  assert.equal(A.hit(k, 3, 1000, 5000), false);
  assert.equal(A.hit(k, 3, 1000, 7000), true, 'a new window');
});

// ---------- API (scratch database) ----------
const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `acct-p1-${TAG}`;
const mail = (w) => `${w}.${TAG}@example.test`;
const SECRET = crypto.randomBytes(24).toString('hex');
let base, pool, close, backfill;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const setCookie = (r) => {
  const all = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const gp = all.find((c) => c && c.startsWith('gp_s='));
  if (!gp) return undefined; return /Max-Age=0/.test(gp) ? '' : gp.split(';')[0];
};
async function signIn(email, extra = {}, cookie) {
  const r = await call('POST', '/api/test/session', { email, name: 'Người ' + email.slice(0, 4), ...extra }, cookie);
  assert.equal(r.status, 200, r.text);
  return { cookie: setCookie(r), account: r.json.account };
}
const acct = async (cookie) => call('GET', '/api/account', undefined, cookie);
// simulate opening the mailed link for an email the account just added
async function verify(accountId, email) {
  const tok = await A.newToken(pool, accountId, 'email_verify', email, A.VERIFY_MS);
  return call('GET', '/api/account/email/verify?t=' + encodeURIComponent(tok));
}

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = SECRET;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  backfill = require('../scripts/accounts-backfill');
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,$2,'楊','private')", [FAM, 'Họ Thử P1 ' + TAG]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from members where family_id = $1', [FAM]);
  await pool.query('delete from families where id = $1', [FAM]);
  await pool.query("delete from accounts where id in (select account_id from identities where value_norm like $1)", ['%.' + TAG + '@example.test']);
  await close(); await pool.end();
});

test('Google sign-in makes one account (verified primary email + Google id) and a server session', { skip }, async () => {
  const em = mail('first');
  const { cookie, account } = await signIn(em, { sub: 'sub-first-' + TAG });
  const r = await acct(cookie);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.id, account);
  assert.deepEqual(r.json.emails.map((e) => [e.email, e.primary, e.verified]), [[em, true, true]]);
  assert.equal(r.json.linked.length, 1); assert.equal(r.json.linked[0].type, 'google');
  assert.equal(r.json.methods, 1);
  assert.equal(r.json.sessions.length, 1); assert.equal(r.json.sessions[0].current, true);
  assert.match(r.json.sessions[0].id, /^[0-9a-f]{20}$/, 'a handle, never the session id');
  assert.ok(r.json.events.some((e) => e.kind === 'account_created'));
  // the same Google id again (another device) = the same account, a second session
  const again = await signIn(em, { sub: 'sub-first-' + TAG });
  assert.equal(again.account, account);
  assert.equal((await acct(cookie)).json.sessions.length, 2);
});

test('sensitive changes need a sign-in within 10 minutes (reauth)', { skip }, async () => {
  const em = mail('stale');
  const { cookie } = await signIn(em, { auth_age_ms: 11 * 60e3 });
  const r = await call('POST', '/api/account/emails', { email: mail('stale2') }, cookie);
  assert.equal(r.status, 401); assert.equal(r.json.reauth, true);
  const ok = await signIn(mail('fresh9'), { auth_age_ms: 9 * 60e3 });
  assert.equal((await call('POST', '/api/account/emails', { email: mail('fresh9b') }, ok.cookie)).status, 200);
});

test('added email: unverified until the link; then it carries its roles; no enumeration', { skip }, async () => {
  const em = mail('main'); const em2 = mail('second');
  await pool.query("insert into members (email, name, role, status, family_id) values ($1, 'Thử', 'editor', 'active', $2)", [em2, FAM]);
  const { cookie, account } = await signIn(em);
  assert.equal((await call('GET', '/api/me?family=' + FAM, undefined, cookie)).json.roles[FAM], undefined, 'no role yet');
  const add = await call('POST', '/api/account/emails', { email: em2 }, cookie);
  assert.equal(add.status, 200, add.text); assert.deepEqual(add.json, { ok: true, sent: true });
  let a = (await acct(cookie)).json;
  assert.deepEqual(a.emails.map((e) => [e.email, e.verified]), [[em, true], [em2, false]]);
  assert.equal((await call('GET', '/api/me', undefined, cookie)).json.roles[FAM], undefined, 'an unverified email gives nothing');
  const v = await verify(account, em2);
  assert.equal(v.status, 302); assert.match(v.headers.get('location'), /#tai-khoan\?ok=email/);
  a = (await acct(cookie)).json;
  assert.deepEqual(a.emails.map((e) => [e.email, e.verified]), [[em, true], [em2, true]]);
  assert.equal((await call('GET', '/api/me', undefined, cookie)).json.roles[FAM], 'editor', 'roles of the verified email');
  assert.equal((await pool.query('select account_id from members where email = $1', [em2])).rows[0].account_id, account, 'members row filled');
  assert.ok(a.families.some((f) => f.slug === FAM && f.role === 'editor'));
  // a link used twice, or expired, is refused
  const tok = await A.newToken(pool, account, 'email_verify', em2, -1000);
  assert.match((await call('GET', '/api/account/email/verify?t=' + tok)).headers.get('location'), /err=/);
  // another account adding the same (now verified) email: same answer, and its link is refused
  const other = await signIn(mail('other'));
  const add2 = await call('POST', '/api/account/emails', { email: em2 }, other.cookie);
  assert.deepEqual([add2.status, add2.json], [200, { ok: true, sent: true }], 'no account enumeration');
  const v2 = await verify(other.account, em2);
  assert.match(decodeURIComponent(v2.headers.get('location')), /thuộc một tài khoản khác/);
  assert.equal((await call('GET', '/api/me', undefined, other.cookie)).json.roles[FAM], undefined);
});

test('remove rules: primary, last verified email, last sign-in method; primary switch', { skip }, async () => {
  const em = mail('rm'); const em2 = mail('rm2');
  const { cookie, account } = await signIn(em);
  await call('POST', '/api/account/emails', { email: em2 }, cookie); await verify(account, em2);
  let a = (await acct(cookie)).json;
  const first = a.emails.find((e) => e.email === em); const second = a.emails.find((e) => e.email === em2);
  const g = a.linked[0];
  let r = await call('DELETE', '/api/account/identities/' + first.id, {}, cookie);
  assert.equal(r.status, 409); assert.match(r.json.error, /email chính/);
  r = await call('DELETE', '/api/account/identities/' + g.id, {}, cookie);
  assert.equal(r.status, 409); assert.match(r.json.error, /duy nhất/);
  assert.equal((await call('POST', `/api/account/emails/${second.id}/primary`, {}, cookie)).status, 200);
  assert.equal((await call('DELETE', '/api/account/identities/' + first.id, {}, cookie)).status, 200);
  a = (await acct(cookie)).json;
  assert.deepEqual(a.emails.map((e) => [e.email, e.primary]), [[em2, true]]);
  r = await call('DELETE', '/api/account/identities/' + a.emails[0].id, {}, cookie);
  assert.equal(r.status, 409, 'the only (primary) email stays');
  assert.ok(a.events.some((e) => e.kind === 'email_removed'));
  // an unverified email cannot be primary
  await call('POST', '/api/account/emails', { email: mail('rm3') }, cookie);
  a = (await acct(cookie)).json;
  const un = a.emails.find((e) => !e.verified);
  assert.equal((await call('POST', `/api/account/emails/${un.id}/primary`, {}, cookie)).status, 400);
});

test('devices: sign out others signs the other device out; sign out this device clears it', { skip }, async () => {
  const em = mail('dev');
  const phone = await signIn(em, { sub: 'sub-dev-' + TAG });
  const laptop = await signIn(em, { sub: 'sub-dev-' + TAG });
  assert.equal((await call('GET', '/api/me', undefined, laptop.cookie)).json.email, em);
  const r = await call('POST', '/api/account/sessions/revoke-others', {}, phone.cookie);
  assert.deepEqual([r.status, r.json.n], [200, 1]);
  const me = (await call('GET', '/api/me', undefined, laptop.cookie)).json;
  assert.equal(me.email, null, 'the laptop is signed out'); assert.equal(me.accounts, 0);
  assert.equal((await acct(laptop.cookie)).status, 401);
  const a = (await acct(phone.cookie)).json;
  assert.equal(a.sessions.length, 1);
  const out = await call('POST', `/api/account/sessions/${a.sessions[0].id}/revoke`, {}, phone.cookie);
  assert.equal(out.json.current, true); assert.equal(setCookie(out), '', 'cookie cleared');
  assert.equal((await call('GET', '/api/me', undefined, phone.cookie)).json.email, null);
});

test('sign out on the device ends its server session', { skip }, async () => {
  const em = mail('logout');
  const { cookie, account } = await signIn(em);
  await call('POST', '/api/logout', {}, cookie);
  const { rows } = await pool.query('select count(*)::int as n from sessions where account_id = $1 and revoked_at is null', [account]);
  assert.equal(rows[0].n, 0);
  assert.equal((await call('GET', '/api/me', undefined, cookie)).json.email, null, 'the old cookie no longer works');
});

test('cookies from before accounts get their account on first use (email fallback keeps roles meanwhile)', { skip }, async () => {
  const em = mail('legacy');
  await pool.query("insert into members (email, name, role, status, family_id) values ($1, 'Cũ', 'member', 'active', $2)", [em, FAM]);
  const body = Buffer.from(JSON.stringify({ accs: [{ k: 'g', email: em, name: 'Cũ' }], a: 0, exp: Date.now() + 86400e3 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const old = 'gp_s=' + encodeURIComponent(body + '.' + sig);
  assert.equal((await call('GET', '/api/me', undefined, old)).json.roles[FAM], 'member', 'email fallback');
  const r = await acct(old);
  assert.equal(r.status, 200, r.text);
  assert.ok(setCookie(r), 'cookie upgraded with account + session');
  assert.equal(r.json.fresh, false, 'unknown sign-in time: sensitive changes ask for a fresh sign-in');
  assert.equal((await pool.query('select account_id from members where email = $1', [em])).rows[0].account_id, r.json.id);
});

test('roles resolve by account id even when the member row email is not one of its emails', { skip }, async () => {
  const em = mail('byid');
  const { cookie, account } = await signIn(em);
  await pool.query("insert into members (email, name, role, status, family_id, account_id) values ($1, 'Theo id', 'admin', 'active', $2, $3)", [mail('renamed'), FAM, account]);
  assert.equal((await call('GET', '/api/me', undefined, cookie)).json.roles[FAM], 'admin');
});

test('adding emails is rate limited per account', { skip }, async () => {
  const { cookie } = await signIn(mail('rl'));
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/account/emails', { email: mail('rl' + i) }, cookie)).status, 200);
  assert.equal((await call('POST', '/api/account/emails', { email: mail('rl9') }, cookie)).status, 429);
});

test('backfill: one account per email with proof of sign-in; dry run writes nothing; idempotent', { skip }, async () => {
  const seen = mail('bf-seen'); const invited = mail('bf-invited');
  await pool.query("insert into members (email, name, role, status, family_id, last_seen_at) values ($1, 'Đã vào', 'member', 'active', $2, now())", [seen, FAM]);
  await pool.query("insert into members (email, name, role, status, family_id) values ($1, 'Mới mời', 'member', 'active', $2)", [invited, FAM]);
  const quiet = () => {};
  const dry = await backfill.run({ apply: false, pool, log: quiet });
  assert.ok(dry.created >= 1);
  assert.equal(await A.byEmail(pool, seen), null, 'dry run wrote nothing');
  const out = await backfill.run({ apply: true, pool, log: quiet });
  const id = await A.byEmail(pool, seen);
  assert.ok(id && out.created >= 1);
  assert.equal(await A.byEmail(pool, invited), null, 'no proof of sign-in: no account yet');
  assert.equal((await pool.query('select account_id from members where email = $1', [seen])).rows[0].account_id, id);
  const again = await backfill.run({ apply: true, pool, log: quiet });
  assert.equal(again.created, 0, 'idempotent');
});

test('Account page API is not for editor-code or anonymous sessions', { skip }, async () => {
  assert.equal((await acct()).status, 401);
});
