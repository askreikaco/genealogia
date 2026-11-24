// API tests for elder access against a SCRATCH database (GP_TEST_DATABASE_URL, skipped otherwise). Role matrix:
// device sign-in by code (approve, single use, expiry, two approvers), managers, devices with remote sign-out, cards.
// Google sign-in is simulated with POST /api/test/session (NODE_ENV=test).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `elder-${TAG}`;
const FAM_OTHER = `elder-o-${TAG}`;
const mail = (w) => `${w}.${TAG}@example.test`;
const EM = { owner: mail('owner'), manager: mail('manager'), member: mail('member'), adminElder: mail('ad'), other: mail('other') };
const P = { elder: 'N' + TAG.toLowerCase() + 'e1', admin: 'N' + TAG.toLowerCase() + 'a1', plain: 'N' + TAG.toLowerCase() + 'p1' };
let base, pool, close, cookieOwner, cookieManager, cookieMember, cookieOther;
const SECRET = crypto.randomBytes(24).toString('hex');

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const cookieFrom = (r) => {
  const all = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const gp = all.find((c) => c && c.startsWith('gp_s=') && !/Max-Age=0/.test(c));
  return gp ? gp.split(';')[0] : null;
};
// Google session for an email (test-only endpoint).
async function signIn(email, name) {
  const r = await call('POST', '/api/test/session', { email, name });
  assert.equal(r.status, 200, r.text);
  return cookieFrom(r);
}
// A device cookie: start a code, approve it with the given signed-in cookie, poll from the device.
async function deviceFor(approverCookie, personId) {
  const s = await call('POST', '/api/device/start', {});
  assert.equal(s.status, 200, s.text);
  const code = s.json.user_code;
  const a = await call('POST', '/api/device/approve', { user_code: code, person_id: personId }, approverCookie);
  assert.equal(a.status, 200, a.text);
  return { code, secret: s.json.device_code, approve: a.json };
}
async function pollFor(secret) { return call('POST', '/api/device/poll', { device_code: secret }); }
// The device's role in a family: /api/me lists roles per family; a family read answers 200 only when it is a member.
const meOf = async (cookie, fam) => {
  const j = (await call('GET', '/api/me', undefined, cookie)).json;
  const r = await call('GET', `/api/persons?family=${fam}&ids=${P.plain}`, undefined, cookie);
  return { role: j.roles?.[fam] || 'guest', readable: r.status === 200, roles: j.roles };
};

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = SECRET;
  process.env.EDITORS = ''; delete process.env.BREVO_API_KEY;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,$2,'楊','private'), ($3,$3,$4,'楊','private')", [FAM, 'Họ thử ' + TAG, FAM_OTHER, 'Họ khác ' + TAG]);
  const addM = (email, role, personId = null, fam = FAM) => pool.query(
    "insert into members (email, name, role, status, family_id, person_id) values ($1,$2,$3,'active',$4,$5)", [email, email.split('.')[0], role, fam, personId]);
  await addM(EM.owner, 'owner');
  await addM(EM.manager, 'editor');
  await addM(EM.member, 'member');
  await addM(EM.other, 'member', null, FAM_OTHER);
  await addM(EM.adminElder, 'admin', P.admin);
  await addM(mail('elder'), 'member', P.elder); // the elder's own member row (linked to the person)
  for (const [id, name] of [[P.elder, 'Cụ Elder'], [P.admin, 'Ông Admin'], [P.plain, 'Bà Plain']]) {
    await pool.query('insert into persons (id, data, family_id) values ($1, $2, $3)', [id, JSON.stringify({ name }), FAM]);
  }
  await pool.query('insert into person_managers (family_id, person_id, email) values ($1,$2,$3), ($1,$4,$3), ($1,$5,$3)', [FAM, P.elder, EM.manager, P.admin, P.plain]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  cookieOwner = await signIn(EM.owner, 'Chủ');
  cookieManager = await signIn(EM.manager, 'Quản lý');
  cookieMember = await signIn(EM.member, 'Thành viên');
  cookieOther = await signIn(EM.other, 'Họ khác');
});

test.after(async () => {
  if (skip) return;
  await pool.query('delete from elder_log where family_id = any($1)', [[FAM, FAM_OTHER]]);
  await pool.query('delete from mail_log where family_id = any($1)', [[FAM, FAM_OTHER]]);
  await pool.query('delete from device_accounts where family_id = any($1)', [[FAM, FAM_OTHER]]);
  await pool.query('delete from sign_in_cards where family_id = any($1)', [[FAM, FAM_OTHER]]);
  await pool.query('delete from device_codes where family_id = any($1) or family_id is null', [[FAM, FAM_OTHER]]);
  await pool.query('delete from person_managers where family_id = any($1)', [[FAM, FAM_OTHER]]);
  await pool.query('delete from persons where family_id = any($1)', [[FAM, FAM_OTHER]]);
  await pool.query('delete from members where family_id = any($1)', [[FAM, FAM_OTHER]]);
  await pool.query('delete from families where id = any($1)', [[FAM, FAM_OTHER]]);
  await close?.(); await pool?.end().catch(() => {});
});

test('device start: a 6-digit code, a poll secret, and a QR of the approve link; the secret is never stored in clear', { skip }, async () => {
  const r = await call('POST', '/api/device/start', {});
  assert.equal(r.status, 200);
  assert.match(r.json.user_code, /^\d{6}$/);
  assert.equal(r.json.expires_in, 600);
  assert.match(r.json.qr_svg, /^<\?xml|^<svg/);
  const { rows } = await pool.query('select secret_hash from device_codes where user_code=$1', [r.json.user_code]);
  assert.ok(rows.every((x) => x.secret_hash !== r.json.device_code), 'only the hash is stored');
});

test('poll: pending until approved, unknown secret is expired, and the elder device gets no cookie while pending', { skip }, async () => {
  const s = await call('POST', '/api/device/start', {});
  const p = await pollFor(s.json.device_code);
  assert.deepEqual(p.json, { status: 'pending' });
  assert.equal(cookieFrom(p), null);
  assert.deepEqual((await pollFor('nope')).json, { status: 'expired' });
});

test('approve: not signed in 401-ish, a member who manages nobody 403, a manager of the person approves once; the device signs in once', { skip }, async () => {
  const s = await call('POST', '/api/device/start', {});
  const anon = await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.elder });
  assert.equal(anon.status, 401);
  const mem = await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.elder }, cookieMember);
  assert.equal(mem.status, 403, 'member is not a manager of this person');
  const ok = await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.elder }, cookieManager);
  assert.equal(ok.status, 200); assert.equal(ok.json.status, 'approved');
  const first = await pollFor(s.json.device_code);
  assert.equal(first.json.status, 'signed_in');
  assert.equal(first.json.name, 'Cụ Elder');
  const dev = cookieFrom(first);
  assert.ok(dev, 'the elder device gets the cookie');
  const again = await pollFor(s.json.device_code);
  assert.equal(again.json.status, 'used', 'single use');
  assert.equal(cookieFrom(again), null);
  const me = await meOf(dev, FAM);
  assert.equal(me.role, 'member');
  assert.equal(me.readable, true, 'a member reads the private family');
  const meJson = (await call('GET', '/api/me', undefined, dev)).json;
  assert.equal(meJson.email, null);
  assert.equal(meJson.editor, null, 'no edit rights on the device');
  // The code cannot be approved again.
  const twice = await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.elder }, cookieManager);
  assert.equal(twice.status, 404);
});

test('expiry: an expired code cannot be polled to sign in or approved', { skip }, async () => {
  const s = await call('POST', '/api/device/start', {});
  await pool.query("update device_codes set expires_at = now() - interval '1 second' where secret_hash = $1", [require('../elder-rules').sha256(s.json.device_code)]);
  assert.deepEqual((await pollFor(s.json.device_code)).json, { status: 'expired' });
  const a = await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.elder }, cookieManager);
  assert.equal(a.status, 404);
});

test('two approvers: an elder with the admin role needs a manager and a different owner or admin', { skip }, async () => {
  const s = await call('POST', '/api/device/start', {});
  // The manager of the admin elder approves first: waiting.
  const first = await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.admin }, cookieManager);
  assert.equal(first.status, 200); assert.equal(first.json.status, 'waiting');
  assert.deepEqual((await pollFor(s.json.device_code)).json, { status: 'pending' });
  // The same manager cannot be the second approver.
  const same = await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.admin }, cookieManager);
  assert.equal(same.status, 403);
  // A member cannot be the second approver even when managed; the owner can.
  const owner = await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.admin }, cookieOwner);
  assert.equal(owner.status, 200); assert.equal(owner.json.status, 'approved');
  assert.equal((await pollFor(s.json.device_code)).json.status, 'signed_in');
  // Each approval is logged and the owner is notified (mail skipped without Brevo, but logged).
  const { rows } = await pool.query("select kind, detail from elder_log where family_id=$1 and kind='approve' and person_id=$2 order by id", [FAM, P.admin]);
  assert.equal(rows.length, 2);
  const mails = await pool.query("select count(*)::int as n from mail_log where family_id=$1 and kind='elder'", [FAM]);
  assert.ok(mails.rows[0].n >= 2, 'owner notified for each approval');
});

test('code listing: a manager sees only the people it manages; an outsider gets 403 for a valid code', { skip }, async () => {
  const s = await call('POST', '/api/device/start', {});
  const m = await call('GET', `/api/device/code/${s.json.user_code}`, undefined, cookieManager);
  assert.equal(m.status, 200);
  const ids = m.json.choices.map((c) => c.id).sort();
  assert.deepEqual(ids, [P.admin, P.elder, P.plain].sort(), 'only the people this manager manages');
  const o = await call('GET', `/api/device/code/${s.json.user_code}`, undefined, cookieOther);
  assert.equal(o.status, 403);
  assert.equal((await call('GET', '/api/device/code/abc', undefined, cookieManager)).status, 400);
});

test('devices: a manager lists and signs out a device remotely; the device is then a guest; a member cannot', { skip }, async () => {
  const s = await call('POST', '/api/device/start', {});
  await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.plain }, cookieOwner);
  const dev = cookieFrom(await pollFor(s.json.device_code));
  const list = await call('GET', `/api/persons/${P.plain}/devices?family=${FAM}`, undefined, cookieManager);
  assert.equal(list.status, 200);
  assert.equal(list.json.devices.length, 1);
  assert.equal(list.json.devices[0].id.length, 32, 'the device id is never a secret');
  assert.equal((await call('GET', `/api/persons/${P.plain}/devices?family=${FAM}`, undefined, cookieMember)).status, 403);
  // The elder device sees its own list (the elder themself).
  assert.equal((await call('GET', `/api/persons/${P.plain}/devices?family=${FAM}`, undefined, dev)).status, 200);
  // A member cannot revoke; the manager can.
  const id = list.json.devices[0].id;
  assert.equal((await call('POST', `/api/devices/${id}/revoke`, {}, cookieMember)).status, 403);
  assert.equal((await call('POST', `/api/devices/${id}/revoke`, {}, cookieManager)).status, 200);
  assert.equal((await meOf(dev, FAM)).readable, false, 'remote sign-out takes effect at once');
  assert.equal((await call('GET', `/api/persons/${P.plain}/devices?family=${FAM}`, undefined, cookieManager)).json.devices.length, 0);
});

test('a device signed in to one family is a guest in another', { skip }, async () => {
  const s = await call('POST', '/api/device/start', {});
  await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.plain }, cookieOwner);
  const dev = cookieFrom(await pollFor(s.json.device_code));
  assert.equal((await meOf(dev, FAM)).role, 'member');
  const other = await meOf(dev, FAM_OTHER);
  assert.equal(other.role, 'guest');
  assert.equal(other.readable, false, 'a private family of another family is closed to the device');
});

test('managers: the owner adds a member, a non-member is refused, a member cannot add; removal works', { skip }, async () => {
  const add = (c, email, on = true) => call('PUT', `/api/persons/${P.plain}/managers?family=${FAM}`, { email, on }, c);
  assert.equal((await add(cookieMember, mail('elder'))).status, 403, 'a member who manages nobody cannot add managers');
  assert.equal((await add(cookieOwner, mail('nobody'))).status, 400, 'not a member of the family');
  assert.equal((await add(cookieOwner, EM.member)).status, 200);
  const list = await call('GET', `/api/persons/${P.plain}/managers?family=${FAM}`, undefined, cookieOwner);
  assert.ok(list.json.managers.some((m) => m.email === EM.member));
  assert.equal((await add(cookieOwner, EM.member, false)).status, 200);
  assert.equal((await call('GET', `/api/persons/${P.plain}/managers?family=${FAM}`, undefined, cookieMember)).status, 403);
  assert.equal((await add(cookieMember, mail('elder'))).status, 403);
});

test('cards: one active card per person; the old token stops working; a use signs the elder device in and is logged', { skip }, async () => {
  const c1 = await call('POST', `/api/persons/${P.plain}/card?family=${FAM}`, {}, cookieManager);
  assert.equal(c1.status, 200);
  assert.match(c1.json.url, /#card=/);
  const tok1 = c1.json.url.split('#card=')[1];
  const c2 = await call('POST', `/api/persons/${P.plain}/card?family=${FAM}`, {}, cookieOwner);
  assert.equal(c2.status, 200);
  const tok2 = c2.json.url.split('#card=')[1];
  assert.equal((await call('POST', '/api/card/use', { token: tok1 })).status, 404, 'old card revoked');
  const g = await call('GET', `/api/persons/${P.plain}/card?family=${FAM}`, undefined, cookieManager);
  assert.equal(g.json.card.id, c2.json.id);
  assert.equal(JSON.stringify(g.json).includes(tok2), false, 'the token is not shown again');
  const use = await call('POST', '/api/card/use', { token: tok2 });
  assert.equal(use.status, 200); assert.equal(use.json.status, 'signed_in');
  const dev = cookieFrom(use);
  assert.equal((await meOf(dev, FAM)).readable, true);
  const row = await pool.query('select uses from sign_in_cards where id=$1', [c2.json.id]);
  assert.equal(row.rows[0].uses, 1);
  assert.equal((await call('POST', '/api/card/use', { token: tok2 })).status, 200, 'the card may be used on another device');
  // Revoke: the token stops working.
  assert.equal((await call('POST', `/api/persons/${P.plain}/card/revoke?family=${FAM}`, {}, cookieManager)).status, 200);
  assert.equal((await call('POST', '/api/card/use', { token: tok2 })).status, 404);
  // A member cannot print; a device cannot print either.
  assert.equal((await call('POST', `/api/persons/${P.plain}/card?family=${FAM}`, {}, cookieMember)).status, 403);
  assert.equal((await call('POST', `/api/persons/${P.plain}/card?family=${FAM}`, {}, dev)).status, 403);
});

test('card use: a bad or missing token is refused, and the tokens are not stored in clear', { skip }, async () => {
  assert.equal((await call('POST', '/api/card/use', { token: 'bogus' })).status, 404);
  assert.equal((await call('POST', '/api/card/use', {})).status, 400);
  const { rows } = await pool.query('select token_hash from sign_in_cards where family_id=$1', [FAM]);
  assert.ok(rows.every((r) => /^[a-f0-9]{64}$/.test(r.token_hash)));
});

test('the admin elder: the second approver gate is enforced for a manager-only approver', { skip }, async () => {
  const s = await call('POST', '/api/device/start', {});
  await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.admin }, cookieManager);
  // The member (not top, not manager of the admin elder) cannot second-approve.
  const m = await call('POST', '/api/device/approve', { user_code: s.json.user_code, person_id: P.admin }, cookieMember);
  assert.equal(m.status, 403);
});
