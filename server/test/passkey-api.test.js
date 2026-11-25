// Passkeys and "thay mặt" (act-as) against a SCRATCH database (GP_TEST_DATABASE_URL, skipped otherwise).
// A software authenticator signs with a FIXED P-256 test key (below) and builds WebAuthn attestation/assertion
// objects exactly as a platform authenticator does (fmt 'none'); @simplewebauthn/server does the verification.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `pk-${TAG}`;
const mail = (w) => `${w}.${TAG}@example.test`;
const EM = { owner: mail('owner'), manager: mail('manager'), member: mail('member'), elder: mail('elder') };
const PID = 'N' + TAG.toLowerCase() + 'p1';
const SECRET = crypto.randomBytes(24).toString('hex');
let base, pool, close;

// ---- software authenticator (test vector: fixed key, fixed credential id) ----
const JWK = { kty: 'EC', x: 'jFW6mtGeJS6WRW87kAq9TSdADOCJ8M6DgTP6FfN8GBs', y: 'xC9jZmeUk_1XOCj-e1ZTHGkV3aEMysXJMI5xurCZSvE', crv: 'P-256', d: 'BYtKe3COWAxlaZxVOCVVeug8yFl9m-Nhu6IAFhuWCVc' };
const PRIV = crypto.createPrivateKey({ key: JWK, format: 'jwk' });
const CRED0 = Buffer.from('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20', 'hex');
const CRED = CRED0;
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
// Minimal CBOR encoder: unsigned/negative ints, byte and text strings, maps (Map keeps int keys), arrays.
function cbor(v) {
  const head = (major, n) => (n < 24 ? [(major << 5) | n] : n < 256 ? [(major << 5) | 24, n] : [(major << 5) | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return Buffer.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(head(2, v.length)), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([Buffer.from(head(3, b.length)), b]); }
  if (v instanceof Map) return Buffer.concat([Buffer.from(head(5, v.size)), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported');
}
function authenticator(rpID, origin, CRED = CRED0) {
  let counter = 0;
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    credId: b64u(CRED),
    register(options) {
      const cdj = clientData('webauthn.create', options.challenge);
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(JWK.x, 'base64url')], [-3, Buffer.from(JWK.y, 'base64url')]]);
      const authData = Buffer.concat([sha(rpID), Buffer.from([0x45]), u32(0), Buffer.alloc(16), Buffer.from([0, CRED.length]), CRED, cbor(cose)]);
      const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: b64u(CRED), rawId: b64u(CRED), type: 'public-key', response: { clientDataJSON: b64u(cdj), attestationObject: b64u(att), transports: ['internal'] }, clientExtensionResults: {} };
    },
    assert(options, { signCounter, tamper = false } = {}) {
      const n = signCounter ?? ++counter;
      const cdj = clientData('webauthn.get', options.challenge);
      const authData = Buffer.concat([sha(rpID), Buffer.from([0x05]), u32(n)]);
      const sig = crypto.sign('sha256', Buffer.concat([authData, sha(cdj)]), PRIV);
      if (tamper) sig[sig.length - 1] ^= 1;
      return { id: b64u(CRED), rawId: b64u(CRED), type: 'public-key', response: { clientDataJSON: b64u(cdj), authenticatorData: b64u(authData), signature: b64u(sig) }, clientExtensionResults: {} };
    },
  };
}
// HTTP helpers. The software authenticator works for the host the test server is on.
async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, headers: r.headers };
}
const cookieFrom = (r) => { const all = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]; const gp = all.find((c) => c && c.startsWith('gp_s=') && !/Max-Age=0/.test(c)); return gp ? gp.split(';')[0] : null; };
async function signIn(email, name) { const r = await call('POST', '/api/test/session', { email, name }); assert.equal(r.status, 200); return cookieFrom(r); }

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = SECRET; process.env.EDITORS = '';
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ passkey','楊','private')", [FAM]);
  for (const [e, role] of [[EM.owner, 'owner'], [EM.manager, 'editor'], [EM.member, 'member'], [EM.elder, 'member']]) {
    await pool.query("insert into members (email, name, role, status, family_id) values ($1,$2,$3,'active',$4)", [e, e.split('.')[0], role, FAM]);
  }
  await pool.query('insert into persons (id, data, family_id) values ($1, $2, $3)', [PID, JSON.stringify({ name: 'Cụ Passkey' }), FAM]);
  await pool.query('insert into person_managers (family_id, person_id, email) values ($1,$2,$3)', [FAM, PID, EM.manager]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from passkeys where family_id = $1', [FAM]);
  await pool.query('delete from passkey_challenges where family_id = $1', [FAM]);
  await pool.query('delete from elder_log where family_id = $1', [FAM]);
  await pool.query('delete from device_accounts where family_id = $1', [FAM]);
  await pool.query('delete from sign_in_cards where family_id = $1', [FAM]);
  await pool.query('delete from person_managers where family_id = $1', [FAM]);
  await pool.query('delete from persons where family_id = $1', [FAM]);
  await pool.query('delete from members where family_id = $1', [FAM]);
  await pool.query('delete from families where id = $1', [FAM]);
  await close?.(); await pool?.end().catch(() => {});
});

test('register: needs a signed-in account; options, then a verified attestation stores the passkey once', { skip }, async () => {
  const anon = await call('POST', '/api/passkey/register/options', {});
  assert.equal(anon.status, 401);
  const cm = await signIn(EM.member, 'Thành viên');
  const o = await call('POST', `/api/passkey/register/options?family=${FAM}`, {}, cm);
  assert.equal(o.status, 200);
  assert.match(o.json.options.challenge, /^[A-Za-z0-9_-]{20,}$/);
  const auth = authenticator('127.0.0.1', base);
  const v = await call('POST', `/api/passkey/register/verify?family=${FAM}`, { ch: o.json.ch, response: auth.register(o.json.options) }, cm);
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const { rows } = await pool.query("select account, length(public_key) as n from passkeys where cred_id=$1", [b64u(CRED)]);
  assert.equal(rows[0].account, 'g:' + EM.member);
  assert.ok(rows[0].n > 40, 'the public key is stored');
  // The challenge is one-time: the same answer again is refused.
  const again = await call('POST', `/api/passkey/register/verify?family=${FAM}`, { ch: o.json.ch, response: auth.register(o.json.options) }, cm);
  assert.equal(again.status, 400);
});

test('sign in with the passkey: a Google account gets its cookie; replay, a bad signature and a counter that goes back are refused', { skip }, async () => {
  const auth = authenticator('127.0.0.1', base);
  const o1 = await call('POST', '/api/passkey/login/options', {});
  const ok = await call('POST', '/api/passkey/login/verify', { ch: o1.json.ch, response: auth.assert(o1.json.options) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const cookie = cookieFrom(ok);
  assert.ok(cookie, 'the cookie is set');
  const me = await call('GET', '/api/me', undefined, cookie);
  assert.equal(me.json.email, EM.member);
  // Replay of the same challenge.
  const replay = await call('POST', '/api/passkey/login/verify', { ch: o1.json.ch, response: auth.assert(o1.json.options) });
  assert.equal(replay.status, 400);
  // A tampered signature.
  const o2 = await call('POST', '/api/passkey/login/options', {});
  const bad = await call('POST', '/api/passkey/login/verify', { ch: o2.json.ch, response: auth.assert(o2.json.options, { tamper: true }) });
  assert.equal(bad.status, 401);
  // A counter that does not grow (the stored counter is 1 now): refused.
  const o3 = await call('POST', '/api/passkey/login/options', {});
  const back = await call('POST', '/api/passkey/login/verify', { ch: o3.json.ch, response: auth.assert(o3.json.options, { signCounter: 1 }) });
  assert.equal(back.status, 401, 'a copied authenticator is refused');
});

test('device passkey: an elder device registers one, signs in with it, and loses it when the manager signs the device out', { skip }, async () => {
  const mgr = await signIn(EM.manager, 'Quản lý');
  const card = await call('POST', `/api/persons/${PID}/card?family=${FAM}`, {}, mgr);
  assert.equal(card.status, 200);
  const use = await call('POST', '/api/card/use', { token: card.json.url.split('#card=')[1] });
  assert.equal(use.status, 200);
  const dev = cookieFrom(use);
  const auth = authenticator('127.0.0.1', base, crypto.randomBytes(32));
  const o = await call('POST', `/api/passkey/register/options?family=${FAM}`, {}, dev);
  assert.equal(o.status, 200);
  const v = await call('POST', `/api/passkey/register/verify?family=${FAM}`, { ch: o.json.ch, response: auth.register(o.json.options) }, dev);
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const row = await pool.query("select account from passkeys where cred_id=$1", [auth.credId]);
  assert.match(row.rows[0].account, /^d:[a-f0-9]{32}$/);
  // A new browser signs in with it: the device session comes back.
  const o2 = await call('POST', '/api/passkey/login/options', {});
  const ok = await call('POST', '/api/passkey/login/verify', { ch: o2.json.ch, response: auth.assert(o2.json.options) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const devAgain = cookieFrom(ok);
  const me = await call('GET', '/api/me', undefined, devAgain);
  assert.equal(me.json.roles[FAM], 'member');
  // The manager signs the device out: the passkey stops working.
  const dl = await pool.query('select id from device_accounts where family_id=$1 and revoked_at is null', [FAM]);
  assert.equal((await call('POST', `/api/devices/${dl.rows[0].id}/revoke`, {}, mgr)).status, 200);
  const o3 = await call('POST', '/api/passkey/login/options', {});
  const gone = await call('POST', '/api/passkey/login/verify', { ch: o3.json.ch, response: auth.assert(o3.json.options) });
  assert.equal(gone.status, 401);
});

test('thay mặt: the manager writes on behalf of the person (history says so); a member who manages nobody cannot', { skip }, async () => {
  const mgr = await signIn(EM.manager, 'Quản lý');
  const mem = await signIn(EM.member, 'Thành viên');
  const ok = await call('POST', `/api/persons/${PID}/act-as?family=${FAM}`, {}, mgr);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.name, 'Cụ Passkey');
  const write = (cookie, tag) => fetch(base + `/api/ops?family=${FAM}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-act-as': PID }, body: JSON.stringify({ ops: [{ op_id: 'as-' + tag + TAG, id: PID, fields: { place: 'Nơi ' + tag }, ts: Date.now() }] }) });
  const r1 = await write(mgr, 'm');
  if (r1.status !== 200) console.log('R1', await r1.text());
  assert.equal(r1.status, 200);
  const h = await pool.query("select by_user from history where person_id=$1 and new_value::text like '%Nơi m%' order by at desc limit 1", [PID]);
  assert.equal(h.rows[0].by_user, 'manager · thay mặt Cụ Passkey', 'the history row names the manager and the person');
  // The member is not a manager of this person: the header is refused.
  const r2 = await write(mem, 'x');
  assert.equal(r2.status, 403);
  // And a plain write by the manager (no header) is not tagged.
  const plain = await call('POST', `/api/ops?family=${FAM}`, { ops: [{ op_id: 'plain-' + TAG, id: PID, fields: { place: 'Nơi plain' }, ts: Date.now() }] }, mgr);
  assert.equal(plain.status, 200);
  const hp = await pool.query("select by_user from history where person_id=$1 and new_value::text like '%Nơi plain%' limit 1", [PID]);
  assert.equal(hp.rows[0].by_user.includes('thay mặt'), false);
});

test('fresh sign-in: a Google account adds a passkey only after a sign-in within ten minutes', { skip }, async () => {
  const stale = cookieFrom(await call('POST', '/api/test/session', { email: EM.owner, name: 'Chủ', auth_age_ms: 11 * 60e3 }));
  const o = await call('POST', `/api/passkey/register/options?family=${FAM}`, {}, stale);
  assert.equal(o.status, 401);
  assert.equal(o.json.reauth, true, 'the page is told to confirm the sign-in first');
  const fresh = await signIn(EM.owner, 'Chủ');
  const ok = await call('POST', `/api/passkey/register/options?family=${FAM}`, {}, fresh);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.options.authenticatorSelection.residentKey, 'required', 'a discoverable key: sign-in needs no email');
  assert.equal(ok.json.options.authenticatorSelection.userVerification, 'required');
});

test('discoverable sign-in: the options name no credential; a challenge past its expiry is refused', { skip }, async () => {
  const o = await call('POST', '/api/passkey/login/options', {});
  assert.ok(!o.json.options.allowCredentials || o.json.options.allowCredentials.length === 0, 'no credential list');
  assert.equal(o.json.options.userVerification, 'required');
  await pool.query("update passkey_challenges set expires_at = now() - interval '1 second' where id = $1", [o.json.ch]);
  const late = await call('POST', '/api/passkey/login/verify', { ch: o.json.ch, response: authenticator('127.0.0.1', base).assert(o.json.options) });
  assert.equal(late.status, 400, 'an expired challenge is refused');
});

test('remove a passkey: refused as the last way to sign in, allowed while Google stays, needs a fresh sign-in', { skip }, async () => {
  const cm = await signIn(EM.member, 'Thành viên');
  const account = async () => (await call('GET', '/api/account', undefined, cm)).json;
  const a0 = await account();
  const google = a0.linked.find((x) => x.type === 'google');
  assert.ok(google, 'the member has a Google sign-in');
  const { rows: [pk] } = await pool.query('select id from passkeys where cred_id = $1', [b64u(CRED)]);
  const stale = cookieFrom(await call('POST', '/api/test/session', { email: EM.member, name: 'Thành viên', auth_age_ms: 11 * 60e3 }));
  const st = await call('DELETE', `/api/account/passkeys/${pk.id}`, {}, stale);
  assert.equal(st.status, 401);
  assert.equal(st.json.reauth, true);
  const del = await call('DELETE', `/api/account/passkeys/${pk.id}`, {}, cm);
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal((await account()).passkeys.length, 0);
  // Google is now the only way in: it cannot go.
  const gBlocked = await call('DELETE', `/api/account/identities/${google.id}`, {}, cm);
  assert.equal(gBlocked.status, 409);
  // Add a passkey back; with it, Google may go, and then the passkey is the last way in and cannot.
  const o = await call('POST', `/api/passkey/register/options?family=${FAM}`, {}, cm);
  const v = await call('POST', `/api/passkey/register/verify?family=${FAM}`, { ch: o.json.ch, response: authenticator('127.0.0.1', base).register(o.json.options) }, cm);
  assert.equal(v.status, 200, JSON.stringify(v.json));
  const { rows: [again] } = await pool.query('select id from passkeys where cred_id = $1', [b64u(CRED)]);
  const gOk = await call('DELETE', `/api/account/identities/${google.id}`, {}, cm);
  assert.equal(gOk.status, 200, JSON.stringify(gOk.json));
  const last = await call('DELETE', `/api/account/passkeys/${again.id}`, {}, cm);
  assert.equal(last.status, 409);
  assert.match(last.json.error, /cách đăng nhập duy nhất/);
});

test('migration 027: a passkey saved without account_id gets its account from the verified email; running it again changes nothing', { skip }, async () => {
  await signIn(EM.elder, 'Người thân');
  const { rows: [ac] } = await pool.query("select account_id from identities where type = 'email' and value_norm = $1 and verified_at is not null", [EM.elder]);
  assert.ok(ac, 'the elder account exists');
  const legacy = 'legacy-' + TAG;
  await pool.query("insert into passkeys (cred_id, public_key, counter, transports, account, account_id, family_id, label) values ($1, '\\x00', 0, '{}', $2, null, $3, 'Cũ')", [legacy, 'g:' + EM.elder, FAM]);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '027_passkeys_account.sql'), 'utf8');
  await pool.query(sql);
  await pool.query(sql);
  const { rows } = await pool.query('select account_id from passkeys where cred_id = $1', [legacy]);
  assert.equal(rows[0].account_id, ac.account_id);
});
