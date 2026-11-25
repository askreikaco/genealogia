// API tests for life events and stories: privacy by person, editor CRUD with history, guest/member suggestions,
// approval, idempotent retries, validation. Needs a SCRATCH database (GP_TEST_DATABASE_URL); skipped otherwise.
'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `evapi-${TAG}`;
const CODE = 'ev-code-' + crypto.randomBytes(4).toString('hex');
const MEMBER = `ev.member.${TAG}@example.test`;
const LIVING = `N${TAG}liv1`; const DEAD = `N${TAG}dead1`;
let base, pool, close, editorCookie, memberCookie;
const op = (n) => `ev-op-${TAG}-${n}`;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const ev = (over = {}) => ({ type: 'hoc', date_kind: 'exact', date_from: '1980', date_text: '1980', place: 'TP. Hồ Chí Minh', description: 'Khoa Toán', people: [], sources: [], is_preferred: true, ...over });

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `Tester:${FAM}:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Thử events','public')", [FAM]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4), ($5,$2,$6,$4)', [
    LIVING, FAM, { name: 'Người Sống', sex: 'm', gen: 4, birth_date: '5/3/1962', born: '1962' }, 'test',
    DEAD, { name: 'Người Mất', sex: 'f', gen: 3, born: '1900', died: '1970' }]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const login = await call('POST', '/api/login', { code: CODE });
  editorCookie = login.headers.get('set-cookie').split(';')[0];
  const ms = await call('POST', '/api/test/session', { email: MEMBER, name: 'Thành viên thử' });
  memberCookie = ms.headers.get('set-cookie').split(';')[0];
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thành viên thử',$2,'member','active')", [MEMBER, FAM]);
});
test.after(async () => {
  if (skip || !pool) return;
  if (close) await close();
  await pool.query('delete from events where family_id=$1', [FAM]);
  await pool.query('delete from stories where family_id=$1', [FAM]);
  await pool.query('delete from suggestions where family_id=$1', [FAM]);
  await pool.query('delete from history where person_id in ($1,$2)', [LIVING, DEAD]);
  await pool.query('delete from ops where person_id in ($1,$2)', [LIVING, DEAD]);
  await pool.query('delete from members where family_id=$1', [FAM]);
  await pool.query('delete from persons where family_id=$1', [FAM]);
  await pool.query('delete from families where id=$1', [FAM]);
  await pool.end();
});

test('living person: guests see nothing, members and editors see the events', { skip }, async () => {
  const add = await call('POST', `/api/events?family=${FAM}`, { op_id: op(1), person_id: LIVING, event: ev({ type: 'hoc' }) }, editorCookie);
  assert.equal(add.status, 200, add.text);
  const guest = await call('GET', `/api/events?family=${FAM}&person=${LIVING}`);
  assert.equal(guest.json.hidden, true); assert.deepEqual(guest.json.items, []);
  const member = await call('GET', `/api/events?family=${FAM}&person=${LIVING}`, undefined, memberCookie);
  assert.equal(member.json.hidden, false); assert.equal(member.json.items.length, 1);
  assert.equal(member.json.items[0].description, 'Khoa Toán');
});

test('deceased person: guests see the events of a family that is readable', { skip }, async () => {
  const add = await call('POST', `/api/events?family=${FAM}`, { op_id: op(2), person_id: DEAD, event: ev({ type: 'nghe', date_from: '1950', description: 'Giáo viên' }) }, editorCookie);
  assert.equal(add.status, 200, add.text);
  const guest = await call('GET', `/api/events?family=${FAM}&person=${DEAD}`);
  assert.equal(guest.json.hidden, false); assert.equal(guest.json.items.length, 1);
});

test('role checks: guests get 401, members 403 on direct writes', { skip }, async () => {
  const body = { op_id: op(3), person_id: DEAD, event: ev() };
  assert.equal((await call('POST', `/api/events?family=${FAM}`, body)).status, 401);
  assert.equal((await call('POST', `/api/events?family=${FAM}`, { ...body, op_id: op(3) }, memberCookie)).status, 403);
});

test('editor edit and delete keep history and the author', { skip }, async () => {
  const list = (await call('GET', `/api/events?family=${FAM}&person=${DEAD}`)).json.items;
  const id = list[0].id;
  const put = await call('PUT', `/api/events/${id}?family=${FAM}`, { op_id: op(4), event: ev({ type: 'nghe', date_from: '1950', description: 'Hiệu trưởng' }) }, editorCookie);
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.event.description, 'Hiệu trưởng');
  const hist = await call('GET', `/api/history/${DEAD}`, undefined, editorCookie);
  assert.ok(hist.json.some((h) => h.field === 'su_kien' && h.by_user === 'Tester'), 'history row for the event');
  const del = await call('POST', `/api/events/${id}/delete?family=${FAM}`, { op_id: op(5) }, editorCookie);
  assert.equal(del.status, 200, del.text);
  const after = await call('GET', `/api/events?family=${FAM}&person=${DEAD}`);
  assert.equal(after.json.items.length, 0);
});

test('retried op is applied once; bad dates are refused', { skip }, async () => {
  const body = { op_id: op(6), person_id: DEAD, event: ev({ date_from: '1975' }) };
  const a = await call('POST', `/api/events?family=${FAM}`, body, editorCookie);
  const b = await call('POST', `/api/events?family=${FAM}`, body, editorCookie);
  assert.equal(a.status, 200); assert.equal(b.json.duplicate, true);
  const bad = await call('POST', `/api/events?family=${FAM}`, { op_id: op(7), person_id: DEAD, event: ev({ date_from: '31/02/1990' }) }, editorCookie);
  assert.equal(bad.status, 400);
  const badType = await call('POST', `/api/events?family=${FAM}`, { op_id: op(8), person_id: DEAD, event: ev({ type: 'lạ' }) }, editorCookie);
  assert.equal(badType.status, 400);
});

test('guest suggestion for a deceased person is reviewed and then applied; living person is refused', { skip }, async () => {
  const sug = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD, changes: { _ev: { action: 'add', kind: 'event', item: ev({ type: 'quan_ngu', date_from: '1955', place: 'Tây Ninh' }) } }, by_name: 'Khách' });
  assert.equal(sug.status, 200, sug.text);
  const refused = await call('POST', '/api/suggest', { family: FAM, person_id: LIVING, changes: { _ev: { action: 'add', kind: 'event', item: ev() } } });
  assert.equal(refused.status, 403);
  const bad = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD, changes: { _ev: { action: 'add', kind: 'event', item: ev({ type: 'x' }) } } });
  assert.equal(bad.status, 400);
  const list = await call('GET', `/api/suggestions?family=${FAM}`, undefined, editorCookie);
  const item = list.json.items.find((x) => x.person_id === DEAD && x.ev_label);
  assert.ok(item, 'suggestion listed with its label');
  assert.match(item.ev_label, /Thêm sự kiện: Quân ngũ/);
  const ok = await call('POST', `/api/suggestions/${item.id}/approve?family=${FAM}`, {}, editorCookie);
  assert.equal(ok.status, 200, ok.text);
  const after = await call('GET', `/api/events?family=${FAM}&person=${DEAD}`);
  assert.ok(after.json.items.some((e) => e.type === 'quan_ngu' && e.place === 'Tây Ninh'));
});

test('stories: one summary per person, saved again it updates in place', { skip }, async () => {
  const a = await call('POST', `/api/stories?family=${FAM}`, { op_id: op(20), person_id: LIVING, story: { kind: 'tom_tat', title: 'Câu chuyện đời', body: 'Bản một.', photos: [] } }, editorCookie);
  const b = await call('POST', `/api/stories?family=${FAM}`, { op_id: op(21), person_id: LIVING, story: { kind: 'tom_tat', title: 'Câu chuyện đời', body: 'Bản hai.', photos: [] } }, editorCookie);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(a.json.story.id, b.json.story.id, 'same row');
  const got = await call('GET', `/api/events?family=${FAM}&person=${LIVING}`, undefined, editorCookie);
  assert.equal(got.json.stories.length, 1); assert.equal(got.json.stories[0].body, 'Bản hai.');
  const badPhoto = await call('POST', `/api/stories?family=${FAM}`, { op_id: op(22), person_id: LIVING, story: { title: 'x', body: 'y', photos: ['javascript:alert(1)'] } }, editorCookie);
  assert.equal(badPhoto.status, 400);
});
