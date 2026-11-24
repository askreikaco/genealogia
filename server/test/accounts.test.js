// Integration tests for accounts on one device: the signed-in list, switch, sign-out one / all, roles per family,
// isolation of each account's own memberships, the 5-account limit, the same-site guard and the editor-code account.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
// Google sign-in is simulated with POST /api/test/session (adds to the cookie's list when one is sent).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = { a: `acc-a-${TAG}`, b: `acc-b-${TAG}`, c: `acc-c-${TAG}`, d: `acc-d-${TAG}` };
const mail = (who) => `${who}.${TAG}@example.test`;
const EMAIL = { owner: mail('owner'), editor: mail('editor'), member: mail('member'), guest: mail('guest'), extra1: mail('x1'), extra2: mail('x2'), extra3: mail('x3') };
const CODE = 'code-' + TAG;
let base, pool, close;
const SECRET = crypto.randomBytes(24).toString('hex');
const keyOf = (email) => 'g-' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 24);

async function call(method, p, body, cookie, extra = {}) {
  const r = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
// The cookie string (gp_s=...) from a response's Set-Cookie, for the next request.
const cookieFrom = (r) => {
  const all = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const gp = all.find((c) => c && c.startsWith('gp_s=') && !/Max-Age=0/.test(c));
  return gp ? gp.split(';')[0] : null;
};
async function addAs(email, name, cookie) {
  const r = await call('POST', '/api/test/session', { email, name }, cookie);
  assert.equal(r.status, 200, r.text);
  return cookieFrom(r);
}
const me = async (cookie) => (await call('GET', '/api/me', undefined, cookie)).json;
const listOf = async (cookie) => (await call('GET', '/api/accounts', undefined, cookie)).json;
async function addFamily(id, name, visibility) {
  await pool.query('insert into families (id, slug, name, han, visibility) values ($1,$1,$2,$3,$4)', [id, name, '楊', visibility]);
}
async function addMember(email, famId, role, name) {
  await pool.query("insert into members (email, name, role, status, family_id) values ($1, $2, $3, 'active', $4)", [email, name, role, famId]);
}

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = SECRET;
  process.env.EDITORS = `Biên tập thử:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await addFamily(FAM.a, 'Họ Củ Chi ' + TAG, 'public');
  await addFamily(FAM.b, 'Họ Riêng ' + TAG, 'private');
  await addFamily(FAM.c, 'Họ Liên Kết ' + TAG, 'link');
  await addFamily(FAM.d, 'Họ Bình Dương ' + TAG, 'public');
  // owner: owner of A, member of B (private). editor: editor of A, admin of C. member: member of A only. guest: none.
  await addMember(EMAIL.owner, FAM.a, 'owner', 'Chủ Thử');
  await addMember(EMAIL.owner, FAM.b, 'member', 'Chủ Thử');
  await addMember(EMAIL.editor, FAM.a, 'editor', 'Biên Tập');
  await addMember(EMAIL.editor, FAM.c, 'admin', 'Biên Tập');
  await addMember(EMAIL.member, FAM.a, 'member', 'Thành Viên');
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
});

test.after(async () => {
  if (skip) return;
  await pool.query('delete from members where email = any($1)', [Object.values(EMAIL)]);
  await pool.query('delete from families where id = any($1)', [Object.values(FAM)]);
  await pool.query('delete from user_prefs where email = any($1)', [Object.values(EMAIL)]);
  await close?.();
  await pool?.end().catch(() => {});
});

test('one account: a session cookie with no list reads as a list of one, with its account key', { skip }, async () => {
  const c = await addAs(EMAIL.owner, 'Chủ Thử');
  const m = await me(c);
  assert.equal(m.email, EMAIL.owner);
  assert.equal(m.acct, keyOf(EMAIL.owner));
  assert.equal(m.accounts, 1);
  const l = await listOf(c);
  assert.equal(l.items.length, 1);
  assert.equal(l.active, keyOf(EMAIL.owner));
  assert.equal(l.max, 5);
});

test('add: a second Google account joins the list and becomes active; the first stays signed in', { skip }, async () => {
  let c = await addAs(EMAIL.owner, 'Chủ Thử');
  c = await addAs(EMAIL.editor, 'Biên Tập', c);
  const l = await listOf(c);
  assert.equal(l.items.length, 2);
  assert.equal(l.active, keyOf(EMAIL.editor), 'the newly added account is active');
  assert.deepEqual(l.items.map((x) => x.email).sort(), [EMAIL.editor, EMAIL.owner].sort());
  // adding the same account again refreshes it, not a duplicate
  c = await addAs(EMAIL.owner, 'Chủ Thử', c);
  assert.equal((await listOf(c)).items.length, 2);
});

test('roles differ per family: each account lists only its own memberships and roles', { skip }, async () => {
  let c = await addAs(EMAIL.owner, 'Chủ Thử');
  c = await addAs(EMAIL.editor, 'Biên Tập', c);
  c = await addAs(EMAIL.member, 'Thành Viên', c);
  const l = await listOf(c);
  const by = Object.fromEntries(l.items.map((x) => [x.email, x]));
  const roles = (x) => Object.fromEntries(x.memberships.map((m) => [m.family.id, m.role]));
  assert.deepEqual(roles(by[EMAIL.owner]), { [FAM.a]: 'owner', [FAM.b]: 'member' });
  assert.deepEqual(roles(by[EMAIL.editor]), { [FAM.a]: 'editor', [FAM.c]: 'admin' });
  assert.deepEqual(roles(by[EMAIL.member]), { [FAM.a]: 'member' });
  // no leakage: the owner's row never names the editor's family C, and the editor's row never names owner-only data
  assert.ok(!JSON.stringify(by[EMAIL.owner]).includes(EMAIL.editor));
  assert.ok(!JSON.stringify(by[EMAIL.member]).includes(FAM.b), 'a private family the account is not in is not listed');
  // /api/me is the active account only
  const m = await me(c);
  assert.equal(m.roles[FAM.a], 'member');
  assert.equal(m.roles[FAM.c], undefined);
});

test('switch: the active account changes what the server allows (members page: owner yes, editor no)', { skip }, async () => {
  let c = await addAs(EMAIL.owner, 'Chủ Thử');
  c = await addAs(EMAIL.editor, 'Biên Tập', c);
  const denied = await call('GET', `/api/members?family=${FAM.a}`, undefined, c);
  assert.equal(denied.status, 403, 'editor may not manage members');
  const sw = await call('POST', '/api/accounts/switch', { email: EMAIL.owner, family: FAM.a }, c);
  assert.equal(sw.status, 200, sw.text);
  assert.equal(sw.json.active, keyOf(EMAIL.owner));
  assert.equal(sw.json.family, FAM.a, 'the family on screen stays when the new account can see it');
  c = cookieFrom(sw) || c;
  const ok = await call('GET', `/api/members?family=${FAM.a}`, undefined, c);
  assert.equal(ok.status, 200, 'owner may manage members');
  assert.equal((await me(c)).email, EMAIL.owner);
});

test('switch lands on the account default when it cannot see the family on screen', { skip }, async () => {
  let c = await addAs(EMAIL.editor, 'Biên Tập');
  c = await addAs(EMAIL.owner, 'Chủ Thử', c); // owner is in private family B, editor is not
  // editor asks for private family B: not visible, so it lands on its own first family (A, by name)
  const r = await call('POST', '/api/accounts/switch', { email: EMAIL.editor, family: FAM.b }, c);
  assert.equal(r.status, 200);
  assert.equal(r.json.family, FAM.a);
  c = cookieFrom(r) || c;
  // the owner, who is a member of B, keeps B
  const r2 = await call('POST', '/api/accounts/switch', { email: EMAIL.owner, family: FAM.b }, c);
  assert.equal(r2.json.family, FAM.b);
});

test('a guest with no membership never lands on a private family; it lands on the default family', { skip }, async () => {
  let c = await addAs(EMAIL.guest, 'Khách Thử');
  c = await addAs(EMAIL.owner, 'Chủ Thử', c);
  const r = await call('POST', '/api/accounts/switch', { email: EMAIL.guest, family: FAM.b }, c);
  assert.equal(r.status, 200);
  assert.equal(r.json.family, 'duong', 'guest has no membership: private family refused, default family used');
});

test('switching to an account that is not on this device is refused', { skip }, async () => {
  const c = await addAs(EMAIL.owner, 'Chủ Thử');
  const r = await call('POST', '/api/accounts/switch', { email: EMAIL.extra1 }, c);
  assert.equal(r.status, 404);
  const r2 = await call('POST', '/api/accounts/switch', { email: EMAIL.owner }, undefined);
  assert.equal(r2.status, 401, 'no session: nothing to switch');
});

test('limit: at most five accounts on one device; the sixth add is refused with a message', { skip }, async () => {
  let c = await addAs(EMAIL.owner, 'Chủ Thử');
  c = await addAs(EMAIL.editor, 'Biên Tập', c);
  c = await addAs(EMAIL.member, 'Thành Viên', c);
  c = await addAs(EMAIL.extra1, 'Một', c);
  c = await addAs(EMAIL.extra2, 'Hai', c);
  assert.equal((await listOf(c)).items.length, 5);
  const r = await call('POST', '/api/test/session', { email: EMAIL.extra3, name: 'Ba' }, c);
  assert.equal(r.status, 409);
  assert.match(r.json.error, /5 tài khoản/);
  // a refresh of an account already on the list is not a new one
  const r2 = await call('POST', '/api/test/session', { email: EMAIL.extra2, name: 'Hai' }, c);
  assert.equal(r2.status, 200);
});

test('sign out one: the other account stays signed in and becomes active when the active one is removed', { skip }, async () => {
  let c = await addAs(EMAIL.owner, 'Chủ Thử');
  c = await addAs(EMAIL.editor, 'Biên Tập', c);
  const r = await call('POST', '/api/accounts/signout', { email: EMAIL.editor }, c);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.accounts, 1);
  assert.equal(r.json.active, keyOf(EMAIL.owner));
  c = cookieFrom(r) || c;
  const l = await listOf(c);
  assert.deepEqual(l.items.map((x) => x.email), [EMAIL.owner]);
  assert.equal((await me(c)).email, EMAIL.owner, 'the other account is still signed in');
});

test('sign out all: clears the cookie and the list; a bad cookie signs nobody in', { skip }, async () => {
  let c = await addAs(EMAIL.owner, 'Chủ Thử');
  c = await addAs(EMAIL.editor, 'Biên Tập', c);
  const r = await call('POST', '/api/accounts/signout', { all: true }, c);
  assert.equal(r.status, 200);
  assert.equal(r.json.accounts, 0);
  assert.equal(r.json.active, null);
  const cleared = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  assert.ok(cleared.some((x) => x.startsWith('gp_s=') && /Max-Age=0/.test(x)));
  assert.deepEqual((await listOf(undefined)).items, []);
  // a tampered cookie (body changed, signature kept) is not a session
  const good = c.split('=')[1];
  const [body, sig] = decodeURIComponent(good).split('.');
  const forged = Buffer.from(JSON.stringify({ accs: [{ k: 'g', email: EMAIL.owner, name: 'Giả' }], a: 0, exp: Date.now() + 1e6 })).toString('base64url');
  assert.notEqual(forged, body);
  assert.deepEqual((await listOf(`gp_s=${encodeURIComponent(forged + '.' + sig)}`)).items, []);
});

test('editor-code account: its own pseudo-account "Mã biên tập" with admin in every family, other accounts kept', { skip }, async () => {
  let c = await addAs(EMAIL.member, 'Thành Viên');
  const login = await call('POST', '/api/login', { code: CODE }, c);
  assert.equal(login.status, 200, login.text);
  c = cookieFrom(login) || c;
  const l = await listOf(c);
  const code = l.items.find((x) => x.kind === 'code');
  assert.ok(code, 'the code account is on the list');
  assert.equal(code.name, 'Mã biên tập');
  assert.equal(code.email, null);
  assert.equal(code.active, true);
  assert.ok(code.memberships.every((m) => m.role === 'admin'));
  assert.equal(l.items.length, 2);
  // switch back to the Google account: the code account is no longer the active one
  const sw = await call('POST', '/api/accounts/switch', { email: EMAIL.member, family: FAM.a }, c);
  assert.equal(sw.status, 200);
  c = cookieFrom(sw) || c;
  assert.equal((await me(c)).email, EMAIL.member);
  assert.equal((await me(c)).roles[FAM.a], 'member');
  // and sign the code account out on its own
  const out = await call('POST', '/api/accounts/signout', { code: true }, c);
  assert.equal(out.json.accounts, 1);
  c = cookieFrom(out) || c;
  assert.equal((await listOf(c)).items.length, 1);
});

test('same-site guard: cross-site Origin, cross-site fetch metadata and non-JSON bodies are refused on account changes', { skip }, async () => {
  const c = await addAs(EMAIL.owner, 'Chủ Thử');
  const cross = await call('POST', '/api/accounts/switch', { email: EMAIL.owner }, c, { origin: 'https://evil.example' });
  assert.equal(cross.status, 403);
  const site = await call('POST', '/api/accounts/signout', { email: EMAIL.owner }, c, { 'sec-fetch-site': 'cross-site' });
  assert.equal(site.status, 403);
  const plain = await call('POST', '/api/accounts/switch', 'email=x', c, { 'content-type': 'text/plain' });
  assert.equal(plain.status, 415);
  const same = await call('POST', '/api/accounts/switch', { email: EMAIL.owner }, c, { origin: base, 'sec-fetch-site': 'same-origin' });
  assert.equal(same.status, 200);
});

test('a legacy one-account cookie (signed, no list) still signs that account in', { skip }, async () => {
  const body = Buffer.from(JSON.stringify({ name: 'Chủ Thử', email: EMAIL.owner, gn: 'Thử', fn: 'Chủ', exp: Date.now() + 1e6 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const c = `gp_s=${encodeURIComponent(body + '.' + sig)}`;
  const m = await me(c);
  assert.equal(m.email, EMAIL.owner);
  assert.equal(m.given_name, 'Thử');
  assert.equal(m.accounts, 1);
});
