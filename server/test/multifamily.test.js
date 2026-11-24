// Integration tests for multi-family: scoping, visibility (public / link / private), per-family roles, prefs.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = { a: `mfa-${TAG}`, b: `mfb-${TAG}`, c: `mfc-${TAG}` };
const mail = (who) => `${who}.${TAG}@example.test`;
const EMAIL = { ownerA: mail('owner-a'), dual: mail('dual'), memberB: mail('member-b'), editorA: mail('editor-a'), guestish: mail('guest') };
let base, pool, close, cookies = {};
const P = {};

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
async function sessionFor(email, name) {
  const r = await call('POST', '/api/test/session', { email, name });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
async function addFamily(id, name, visibility) {
  await pool.query('insert into families (id, slug, name, han, visibility) values ($1,$1,$2,$3,$4)', [id, name, '楊', visibility]);
}
async function addPerson(id, famId, name) {
  await pool.query('insert into persons (id, data, updated_by, family_id) values ($1,$2,$3,$4)', [id, { name, gen: 3, born: '1950', sex: 'm' }, 'test', famId]);
}
async function addMember(email, famId, role) {
  await pool.query("insert into members (email, name, role, status, family_id) values ($1, $2, $3, 'active', $4)", [email, email.split('@')[0], role, famId]);
}

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await addFamily(FAM.a, 'Họ Thử A ' + TAG, 'public');
  await addFamily(FAM.b, 'Họ Riêng ' + TAG, 'private');
  await addFamily(FAM.c, 'Họ Liên Kết ' + TAG, 'link');
  P.a = 'N' + crypto.randomUUID().slice(0, 13);
  P.b = 'N' + crypto.randomUUID().slice(0, 13);
  P.c = 'N' + crypto.randomUUID().slice(0, 13);
  await addPerson(P.a, FAM.a, 'Người A ' + TAG);
  await addPerson(P.b, FAM.b, 'Người B ' + TAG);
  await addPerson(P.c, FAM.c, 'Người C ' + TAG);
  await addMember(EMAIL.ownerA, FAM.a, 'owner');
  await addMember(EMAIL.dual, FAM.a, 'admin');     // admin in A
  await addMember(EMAIL.dual, FAM.b, 'member');    // only a member in B
  await addMember(EMAIL.memberB, FAM.b, 'owner');  // owner of the private family B
  await addMember(EMAIL.editorA, FAM.a, 'editor');
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  cookies.ownerA = await sessionFor(EMAIL.ownerA, 'Chủ A');
  cookies.dual = await sessionFor(EMAIL.dual, 'Kép');
  cookies.memberB = await sessionFor(EMAIL.memberB, 'Chủ B');
  cookies.editorA = await sessionFor(EMAIL.editorA, 'Biên A');
  cookies.guest = await sessionFor(EMAIL.guestish, 'Khách');
});

test.after(async () => {
  if (skip) return;
  const ids = [P.a, P.b, P.c];
  await pool.query('delete from suggestions where family_id = any($1)', [Object.values(FAM)]);
  await pool.query('delete from members where family_id = any($1)', [Object.values(FAM)]);
  await pool.query('delete from history where person_id = any($1)', [ids]);
  await pool.query('delete from ops where person_id = any($1)', [ids]);
  await pool.query('delete from persons where id = any($1)', [ids]);
  await pool.query('delete from user_prefs where email = any($1)', [Object.values(EMAIL)]);
  await pool.query('delete from families where id = any($1)', [Object.values(FAM)]);
  await pool.end(); await close();
});

test('scoping: a person of family B is not in family A, and the old unscoped URL is duong', { skip }, async () => {
  const a = await call('GET', `/api/persons?since=0&family=${FAM.a}`);
  assert.equal(a.status, 200);
  const ids = a.json.items.map((x) => x.id);
  assert.ok(ids.includes(P.a));
  assert.ok(!ids.includes(P.b), 'family B person must not appear in A');
  assert.equal(a.json.family, FAM.a);
  const old = await call('GET', '/api/persons?since=0');
  assert.equal(old.status, 200);
  assert.ok(!old.json.items.some((x) => x.id === P.a), 'unscoped URL is duong, not A');
});

test('private family: guests get 403 on its people and history; members get them', { skip }, async () => {
  assert.equal((await call('GET', `/api/persons?since=0&family=${FAM.b}`)).status, 403);
  assert.equal((await call('GET', `/api/persons?since=0&family=${FAM.b}`, undefined, cookies.guest)).status, 403);
  assert.equal((await call('GET', `/api/persons?since=0&family=${FAM.b}`, undefined, cookies.dual)).status, 200, 'dual is a member of B');
  assert.equal((await call('GET', `/api/history/${P.b}`)).status, 403);
  assert.equal((await call('GET', `/lich.ics?family=${FAM.b}`)).status, 403);
  const sug = await call('POST', '/api/suggest', { family: FAM.b, person_id: P.b, changes: { note: 'x' } });
  assert.equal(sug.status, 403, 'visitors cannot suggest into a private family');
});

test('families list: public and member families show; link and private do not (unless a member)', { skip }, async () => {
  const guest = await call('GET', `/api/families?q=${encodeURIComponent('Thử A ' + TAG)}`);
  assert.ok(guest.json.items.some((f) => f.id === FAM.a), 'public family matches its name');
  const all = await call('GET', `/api/families?q=${encodeURIComponent(TAG)}`);
  const ids = all.json.items.map((f) => f.id);
  assert.ok(!ids.includes(FAM.b), 'private hidden from guests');
  assert.ok(!ids.includes(FAM.c), 'link family is not listed');
  const mine = await call('GET', `/api/families?q=${encodeURIComponent(TAG)}`, undefined, cookies.memberB);
  assert.ok(mine.json.items.some((f) => f.id === FAM.b && f.my_role === 'owner'), 'members always see their family, with role');
  const a = mine.json.items.find((f) => f.id === FAM.a);
  assert.ok(a && a.my_role === null, 'public A matches the query, but memberB has no role there');
  const withPeople = (await call('GET', `/api/families?q=${encodeURIComponent('Thử A ' + TAG)}`)).json.items.find((f) => f.id === FAM.a);
  assert.equal(withPeople.people, 1);
  assert.equal(withPeople.generations, 1);
  assert.ok(withPeople.updated_at);
});

test('link family: opens by slug only, never appears in the list for a guest', { skip }, async () => {
  const bySlug = await call('GET', `/api/families/${FAM.c}`);
  assert.equal(bySlug.status, 200);
  assert.equal(bySlug.json.visibility, 'link');
  const people = await call('GET', `/api/persons?since=0&family=${FAM.c}`);
  assert.ok(people.json.items.some((x) => x.id === P.c));
  assert.equal((await call('GET', `/api/families/nope-${TAG}`)).status, 404);
});

test('per-family roles: admin in A may edit A, but only a member in B', { skip }, async () => {
  const ok = await call('PATCH', `/api/families/${FAM.a}`, { name: 'Họ Thử A đổi tên ' + TAG }, cookies.dual);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.family.name, 'Họ Thử A đổi tên ' + TAG);
  assert.equal((await call('PATCH', `/api/families/${FAM.b}`, { name: 'x' }, cookies.dual)).status, 403);
  assert.equal((await call('PATCH', `/api/families/${FAM.a}`, { name: 'x' })).status, 401, 'not signed in');
  const roles = (await call('GET', '/api/me', undefined, cookies.dual)).json.roles;
  assert.equal(roles[FAM.a], 'admin');
  assert.equal(roles[FAM.b], 'member');
});

test('visibility change by a non-admin is 403; owner may change it and back', { skip }, async () => {
  assert.equal((await call('PATCH', `/api/families/${FAM.b}`, { visibility: 'public' }, cookies.guest)).status, 403);
  assert.equal((await call('PATCH', `/api/families/${FAM.b}`, { visibility: 'public' }, cookies.dual)).status, 403, 'member of B');
  const bad = await call('PATCH', `/api/families/${FAM.b}`, { visibility: 'secret' }, cookies.memberB);
  assert.equal(bad.status, 400);
  const pub = await call('PATCH', `/api/families/${FAM.b}`, { visibility: 'public' }, cookies.memberB);
  assert.equal(pub.status, 200);
  assert.equal((await call('GET', `/api/persons?since=0&family=${FAM.b}`)).status, 200, 'now public: guests read it');
  const priv = await call('PATCH', `/api/families/${FAM.b}`, { visibility: 'private' }, cookies.memberB);
  assert.equal(priv.status, 200);
  assert.equal((await call('GET', `/api/persons?since=0&family=${FAM.b}`)).status, 403, 'private again');
});

test('ops and members: editor of A cannot write into B; per-person family check', { skip }, async () => {
  const opA = { op_id: 'mf-' + TAG + '-1', id: P.a, fields: { note: 'từ A' }, ts: Date.now() };
  const r1 = await call('POST', `/api/ops?family=${FAM.a}`, { ops: [opA] }, cookies.editorA);
  assert.deepEqual(r1.json.applied, [opA.op_id]);
  const cross = { op_id: 'mf-' + TAG + '-2', id: P.b, fields: { note: 'sang B' }, ts: Date.now() };
  const r2 = await call('POST', `/api/ops?family=${FAM.a}`, { ops: [cross] }, cookies.editorA);
  assert.equal(r2.json.rejected[0].op_id, cross.op_id, 'person of B is rejected from A');
  assert.equal((await call('POST', `/api/ops?family=${FAM.b}`, { ops: [cross] }, cookies.editorA)).status, 403, 'editor of A is no editor of B');
  assert.equal((await call('GET', `/api/members?family=${FAM.a}`, undefined, cookies.editorA)).status, 403);
  const list = await call('GET', `/api/members?family=${FAM.a}`, undefined, cookies.ownerA);
  assert.equal(list.status, 200);
  assert.ok(list.json.items.every((m) => m.email.endsWith('@example.test')));
  assert.equal((await call('GET', `/api/members?family=${FAM.b}`, undefined, cookies.dual)).status, 403, 'dual is only a member in B');
});

test('suggestions are per family: review needs admin of the suggestion family', { skip }, async () => {
  const s = await call('POST', '/api/suggest', { family: FAM.a, person_id: P.a, changes: { note: 'góp ý A ' + TAG }, by_name: 'Khách' });
  assert.equal(s.status, 200, s.text);
  assert.equal((await call('POST', '/api/suggest', { family: FAM.a, person_id: P.b, changes: { note: 'x' } })).status, 400, 'person of B in A');
  const listA = await call('GET', `/api/suggestions?family=${FAM.a}`, undefined, cookies.dual);
  assert.ok(listA.json.items.some((x) => x.id === s.json.id), 'admin of A sees A suggestions');
  const listB = await call('GET', `/api/suggestions?family=${FAM.b}`, undefined, cookies.dual);
  assert.equal(listB.status, 403, 'dual is not admin of B');
  assert.equal((await call('POST', `/api/suggestions/${s.json.id}/reject`, { reason: 'x' }, cookies.memberB)).status, 403, 'owner of B cannot review A');
  const rej = await call('POST', `/api/suggestions/${s.json.id}/reject`, { reason: 'thử' }, cookies.dual);
  assert.equal(rej.status, 200);
});

test('prefs: followed families and default family are stored and checked', { skip }, async () => {
  const put = await call('PUT', '/api/me/prefs', { follows_families: [FAM.a, FAM.c], default_family: FAM.c }, cookies.guest);
  assert.equal(put.status, 200, put.text);
  const got = (await call('GET', '/api/me/prefs', undefined, cookies.guest)).json.prefs;
  assert.deepEqual(got.follows_families, [FAM.a, FAM.c]);
  assert.equal(got.default_family, FAM.c);
  assert.equal((await call('PUT', '/api/me/prefs', { default_family: 'Bad Id!' }, cookies.guest)).status, 400);
  assert.equal((await call('PUT', '/api/me/prefs', { follows_families: 'duong' }, cookies.guest)).status, 400);
  assert.equal((await call('PUT', '/api/me/prefs', { default_family: 'all' }, cookies.guest)).status, 200);
  assert.equal((await call('PUT', '/api/me/prefs', { default_family: '' }, cookies.guest)).status, 200, 'no default is the client start value');
});

test('leave: a member leaves a family; the owner must hand over first; trusted contacts are admin-only', { skip }, async () => {
  assert.equal((await call('POST', `/api/families/${FAM.b}/leave`, {}, cookies.memberB)).status, 409, 'owner must hand over');
  assert.equal((await call('POST', `/api/families/${FAM.b}/leave`, {})).status, 401);
  const left = await call('POST', `/api/families/${FAM.b}/leave`, {}, cookies.dual);
  assert.equal(left.status, 200);
  assert.equal((await call('GET', '/api/me', undefined, cookies.dual)).json.roles[FAM.b], undefined);
  assert.equal((await call('GET', `/api/families/${FAM.b}/trusted`, undefined, cookies.dual)).status, 403);
  const t = await call('GET', `/api/families/${FAM.a}/trusted`, undefined, cookies.dual);
  assert.equal(t.status, 200);
  assert.deepEqual(t.json.items, []);
});
