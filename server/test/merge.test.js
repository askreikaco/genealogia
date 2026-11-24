// 3-way approve: clean fields apply, conflict fields need a choice, partial approve, custom values.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = 'TEST-MRG-' + crypto.randomBytes(3).toString('hex');
const OWNER = `owner-${TAG}@test.local`.toLowerCase();
let base, pool, close, personId, owner;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const data = async () => (await pool.query('select data from persons where id=$1', [personId])).rows[0].data;
const editByOwnerDirectly = (fields) => pool.query('update persons set data = data || $2::jsonb where id=$1', [personId, JSON.stringify(fields)]);
const send = async (changes) => {
  const r = await call('POST', '/api/suggest', { person_id: personId, changes, by_name: TAG });
  assert.equal(r.status, 200, r.text);
  return r.json.id;
};
const listed = async (id) => { const r = await call('GET', '/api/suggestions?status=pending', undefined, owner); assert.ok(r.json && r.json.items, 'list: ' + r.status + ' ' + r.text.slice(0, 120)); return r.json.items.find((x) => x.id === id); };

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  personId = 'N' + crypto.randomUUID().slice(0, 13);
  await pool.query("insert into persons (id, data, updated_by) values ($1, $2, 'test')", [personId, { name: 'Người Trộn ' + TAG, gen: 5, sex: 'm' }]);
  await pool.query("insert into members (email, name, role, status) values ($1, 'Chủ Thử', 'owner', 'active')", [OWNER]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const r = await call('POST', '/api/test/session', { email: OWNER, name: 'Chủ Thử' });
  owner = r.headers.get('set-cookie').split(';')[0];
});

test.after(async () => {
  if (skip) return;
  await pool.query('delete from suggestions where by_name = $1', [TAG]);
  await pool.query('delete from history where person_id = $1', [personId]);
  await pool.query('delete from ops where person_id = $1', [personId]);
  await pool.query('delete from persons where id = $1', [personId]);
  await pool.query('delete from members where email = $1', [OWNER]);
  await pool.end(); await close();
});

test('clean fields apply by default (no choice needed)', { skip }, async () => {
  const id = await send({ job: 'Nghề một' });
  const item = await listed(id);
  assert.equal(item.changes[0].status, 'clean');
  assert.equal(item.changes[0].base, null);
  assert.equal(item.changes[0].current, null);
  const ap = await call('POST', `/api/suggestions/${id}/approve`, {}, owner);
  assert.equal(ap.status, 200, ap.text);
  assert.equal((await data()).job, 'Nghề một');
});

test('a conflict field needs a choice (400 without it); choosing current keeps the edit', { skip }, async () => {
  const id = await send({ job: 'Nghề hai' });
  await editByOwnerDirectly({ job: 'Sửa tay' });
  const item = await listed(id);
  assert.equal(item.changes[0].status, 'conflict');
  assert.equal(item.changes[0].base, 'Nghề một'); // what the job was when sent
  assert.equal(item.changes[0].current, 'Sửa tay');
  assert.equal(item.changes[0].proposed, 'Nghề hai');
  const none = await call('POST', `/api/suggestions/${id}/approve`, {}, owner);
  assert.equal(none.status, 400);
  assert.match(none.json.error, /job/);
  assert.equal((await pool.query('select status from suggestions where id=$1', [id])).rows[0].status, 'pending');
  const keep = await call('POST', `/api/suggestions/${id}/approve`, { fields: { job: 'current' } }, owner);
  assert.equal(keep.status, 400, 'only current leaves nothing to apply');
  const ap = await call('POST', `/api/suggestions/${id}/approve`, { fields: { job: 'current', gen: 'current' } }, owner);
  assert.equal(ap.status, 400, 'a field not in the suggestion is refused');
});

test('custom value is applied after validation', { skip }, async () => {
  const id = await send({ job: 'Nghề ba' });
  await editByOwnerDirectly({ job: 'Sửa tay lần hai' });
  const bad = await call('POST', `/api/suggestions/${id}/approve`, { fields: { job: { custom: 123 } } }, owner);
  assert.equal(bad.status, 400);
  const ap = await call('POST', `/api/suggestions/${id}/approve`, { fields: { job: { custom: 'Tự nhập' } } }, owner);
  assert.equal(ap.status, 200, ap.text);
  assert.equal((await data()).job, 'Tự nhập');
});

test('partial approve applies only the fields chosen as proposed', { skip }, async () => {
  const id = await send({ job: 'Nghề bốn', place: 'Hà Nội' });
  const ap = await call('POST', `/api/suggestions/${id}/approve`, { fields: { place: 'current' } }, owner);
  assert.equal(ap.status, 200, ap.text);
  const d = await data();
  assert.equal(d.job, 'Nghề bốn');
  assert.equal(d.place, undefined);
  const { rows } = await pool.query('select status from suggestions where id=$1', [id]);
  assert.equal(rows[0].status, 'approved');
});
