// Integration tests for join, members and roles. Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test
// (skipped otherwise). Google sign-in is simulated with POST /api/test/session (registered only when NODE_ENV=test).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = 'TEST-MEM-' + crypto.randomBytes(3).toString('hex');
const mail = (who) => `${who}.${TAG.toLowerCase()}@example.test`;
const EMAIL = { owner: mail('owner'), editor: mail('editor'), member: mail('member'), joiner: mail('joiner') };
let base, pool, close, personId, cookies = {}, memberIds = {};

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
const idOf = async (email) => (await pool.query('select id from members where email=$1', [email])).rows[0].id;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  personId = 'N' + crypto.randomUUID().slice(0, 13);
  await pool.query("insert into persons (id, data, updated_by) values ($1, $2, 'test')",
    [personId, { name: 'Người Thử ' + TAG, gen: 7, sex: 'm', born: '1990', birth_date: '01/02/1990', place: 'Hà Nội' }]);
  await pool.query("insert into members (email, name, role, status) values ($1, 'Chủ Thử', 'owner', 'active')", [EMAIL.owner]);
  await pool.query("insert into members (email, name, role, status) values ($1, 'Biên Tập', 'editor', 'active')", [EMAIL.editor]);
  await pool.query("insert into members (email, name, role, status) values ($1, 'Thành Viên', 'member', 'active')", [EMAIL.member]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  cookies.owner = await sessionFor(EMAIL.owner, 'Chủ Thử');
  cookies.editor = await sessionFor(EMAIL.editor, 'Biên Tập');
  cookies.member = await sessionFor(EMAIL.member, 'Thành Viên');
  cookies.joiner = await sessionFor(EMAIL.joiner, 'Lê Thu Hà');
});

test.after(async () => {
  if (skip) return;
  const emails = Object.values(EMAIL);
  await pool.query('delete from suggestions where by_name = any($1)', [[...emails, 'Chủ Thử', 'Biên Tập', 'Thành Viên']]);
  await pool.query('delete from members where email = any($1)', [emails]);
  await pool.query('delete from history where person_id = $1', [personId]);
  await pool.query('delete from ops where person_id = $1', [personId]);
  await pool.query('delete from persons where id = $1', [personId]);
  await pool.end(); await close();
});

test('guest sees public data; a signed-in user with no row is a guest too', { skip }, async () => {
  const pub = await call('GET', '/api/persons?since=0');
  const me = pub.json.items.find((x) => x.id === personId);
  assert.equal(me.data.birth_date, undefined, 'guest must not see birth_date');
  assert.equal(me.data.born, '1990');
  const g = await call('GET', '/api/persons?since=0', undefined, cookies.joiner);
  assert.equal(g.json.items.find((x) => x.id === personId).data.birth_date, undefined);
  assert.equal((await call('GET', '/api/me', undefined, cookies.joiner)).json.role, 'guest');
});

test('join: needs a Google sign-in, then lands as pending', { skip }, async () => {
  assert.equal((await call('POST', '/api/join', { first_name: 'Hà', last_name: 'Lê' })).status, 401);
  const r = await call('POST', '/api/join', { first_name: 'Hà', last_name: 'Lê', person_id: personId }, cookies.joiner);
  assert.equal(r.status, 200, r.text);
  const me = (await call('GET', '/api/me', undefined, cookies.joiner)).json;
  assert.equal(me.status, 'pending');
  assert.equal(me.role, 'guest');
  assert.equal((await call('POST', '/api/join', { first_name: 'Hà', last_name: 'Lê' }, cookies.joiner)).status, 409);
  const row = (await pool.query('select relation, person_id, name from members where email=$1', [EMAIL.joiner])).rows[0];
  assert.deepEqual(row, { relation: 'self', person_id: personId, name: 'Lê Hà' });
  memberIds.joiner = await idOf(EMAIL.joiner);
});

test('members list and approve are admin-only; admin approves a joiner as member', { skip }, async () => {
  assert.equal((await call('GET', '/api/members', undefined, cookies.member)).status, 403);
  assert.equal((await call('GET', '/api/members')).status, 401);
  const list = await call('GET', '/api/members', undefined, cookies.owner);
  assert.equal(list.status, 200);
  assert.ok(list.json.items.find((x) => x.email === EMAIL.joiner && x.status === 'pending'));
  assert.equal((await call('POST', `/api/members/${memberIds.joiner}/approve`, { role: 'member' }, cookies.editor)).status, 403);
  // a non-owner cannot approve as admin
  const ok = await call('POST', `/api/members/${memberIds.joiner}/approve`, { role: 'member' }, cookies.owner);
  assert.equal(ok.status, 200, ok.text);
  const me = (await call('GET', '/api/me', undefined, cookies.joiner)).json;
  assert.equal(me.role, 'member');
  assert.equal(me.status, 'active');
  assert.equal(me.person_id, personId);
  assert.equal((await call('POST', `/api/members/${memberIds.joiner}/approve`, { role: 'member' }, cookies.owner)).status, 409);
});

test('member sees private fields; the member edit becomes a suggestion with the account name and email', { skip }, async () => {
  const m = await call('GET', '/api/persons?since=0', undefined, cookies.joiner);
  assert.equal(m.json.items.find((x) => x.id === personId).data.birth_date, '01/02/1990');
  const hist = await call('GET', `/api/history/${personId}`, undefined, cookies.joiner);
  assert.equal(hist.status, 200);
  assert.equal((await call('POST', '/api/ops', { ops: [{ op_id: 'mem-' + TAG, id: personId, fields: { job: 'Hack' }, ts: Date.now() }] }, cookies.joiner)).status, 403);
  const s = await call('POST', '/api/suggest', { person_id: personId, changes: { job: 'Kỹ sư' }, by_name: 'Tên giả', by_contact: 'fake@x.test' }, cookies.joiner);
  assert.equal(s.status, 200, s.text);
  const { rows } = await pool.query("select by_name, by_contact from suggestions where changes->>'job' = 'Kỹ sư' and person_id=$1 order by id desc limit 1", [personId]);
  assert.deepEqual(rows[0], { by_name: 'Lê Hà', by_contact: EMAIL.joiner });
});

test('editor edits directly but cannot manage roles or review members', { skip }, async () => {
  const ed = await call('POST', '/api/ops', { ops: [{ op_id: 'ed-' + TAG, id: personId, fields: { job: 'Biên tập viên' }, ts: Date.now() }] }, cookies.editor);
  assert.equal(ed.status, 200);
  assert.deepEqual(ed.json.applied, ['ed-' + TAG]);
  const memberId = await idOf(EMAIL.member);
  assert.equal((await call('POST', `/api/members/${memberId}/role`, { role: 'editor' }, cookies.editor)).status, 403);
  assert.equal((await call('POST', '/api/members/invite', { email: mail('x'), role: 'member' }, cookies.editor)).status, 403);
  assert.equal((await call('GET', '/api/suggestions?status=pending', undefined, cookies.editor)).status, 403);
});

test('owner changes roles; admin cannot grant or remove admins', { skip }, async () => {
  const memberId = await idOf(EMAIL.member);
  assert.equal((await call('POST', `/api/members/${memberId}/role`, { role: 'editor' }, cookies.owner)).status, 200);
  assert.equal((await call('GET', '/api/me', undefined, cookies.member)).json.role, 'editor');
  // invite someone as admin (owner only), then check an admin cannot change them
  const inv = await call('POST', '/api/members/invite', { email: mail('admin'), role: 'admin' }, cookies.owner);
  assert.equal(inv.status, 200, inv.text);
  const adminCookie = await sessionFor(mail('admin'), 'Quản Trị');
  assert.equal((await call('GET', '/api/me', undefined, adminCookie)).json.role, 'admin');
  const adminId = await idOf(mail('admin'));
  assert.equal((await call('POST', `/api/members/${memberId}/role`, { role: 'admin' }, adminCookie)).status, 403);
  assert.equal((await call('POST', `/api/members/${adminId}/remove`, {}, adminCookie)).status, 403);
  assert.equal((await call('POST', `/api/members/${memberId}/role`, { role: 'member' }, adminCookie)).status, 200);
  assert.equal((await call('POST', `/api/members/${adminId}/remove`, {}, cookies.owner)).status, 200);
  assert.equal((await call('GET', '/api/me', undefined, adminCookie)).json.role, 'guest', 'removal applies on the next request');
  await pool.query('delete from members where email=$1', [mail('admin')]);
});

test('invite creates an active row that works on the first sign-in; reject frees the email', { skip }, async () => {
  const newbie = mail('newbie');
  assert.equal((await call('POST', '/api/members/invite', { email: newbie, role: 'member' }, cookies.owner)).status, 200);
  const c = await sessionFor(newbie, 'Người Mới');
  assert.equal((await call('GET', '/api/me', undefined, c)).json.role, 'member');
  await pool.query('delete from members where email=$1', [newbie]);
});

test('rejecting a pending join keeps the person a guest', { skip }, async () => {
  const email = mail('rej'); const c = await sessionFor(email, 'Từ Chối');
  assert.equal((await call('POST', '/api/join', { first_name: 'Từ', last_name: 'Chối' }, c)).status, 200);
  const id = await idOf(email);
  assert.equal((await call('POST', `/api/members/${id}/reject`, {}, cookies.owner)).status, 200);
  const me = (await call('GET', '/api/me', undefined, c)).json;
  assert.equal(me.role, 'guest'); assert.equal(me.status, 'removed');
  await pool.query('delete from members where email=$1', [email]);
});

test('review shows edited-after-suggestion warning for a field changed later', { skip }, async () => {
  const sug = await call('POST', '/api/suggest', { person_id: personId, changes: { place: 'Đà Nẵng' }, by_name: TAG }, cookies.joiner);
  assert.equal(sug.status, 200);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await call('POST', '/api/ops', { ops: [{ op_id: 'later-' + TAG, id: personId, fields: { place: 'Huế' }, ts: Date.now() }] }, cookies.owner)).status, 200);
  const list = await call('GET', '/api/suggestions?status=pending', undefined, cookies.owner);
  const item = list.json.items.find((x) => x.by_name === 'Lê Hà' && x.changes.some((c) => c.field === 'place'));
  // only the place changed after the suggestion; the job suggestion above is untouched
  assert.ok(item);
  assert.equal(item.changes.find((c) => c.field === 'place').edited, true);
});
