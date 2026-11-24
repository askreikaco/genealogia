// Integration tests for anonymous suggestions. Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test
// (skipped otherwise, so CI without Postgres still passes). Rows it writes are removed at the end.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const CODE = 'test-code-' + crypto.randomBytes(4).toString('hex');
const TAG = 'TEST-SUG';
let base, pool, close, personId, newId, cookie;

async function call(method, p, body, withCookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(withCookie && cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `Tester:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  personId = 'N' + crypto.randomUUID().slice(0, 13);
  await pool.query("insert into persons (id, data, updated_by) values ($1, $2, 'test')", [personId, { name: 'Người Thử', gen: 4, sex: 'm' }]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const login = await call('POST', '/api/login', { code: CODE });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
});

test.after(async () => {
  if (skip) return;
  await pool.query('delete from suggestions where by_name = $1', [TAG]);
  for (const id of [personId, newId].filter(Boolean)) {
    await pool.query('delete from history where person_id = $1', [id]);
    await pool.query('delete from ops where person_id = $1', [id]);
    await pool.query('delete from persons where id = $1', [id]);
  }
  await pool.end(); await close();
});

test('honeypot filled is rejected and nothing is stored', { skip }, async () => {
  const r = await call('POST', '/api/suggest', { person_id: personId, changes: { place: 'Bot' }, by_name: TAG, website: 'http://spam' });
  assert.equal(r.status, 400);
  const { rows } = await pool.query("select count(*)::int n from suggestions where changes->>'place' = 'Bot'");
  assert.equal(rows[0].n, 0);
});

test('unknown field key is rejected', { skip }, async () => {
  const r = await call('POST', '/api/suggest', { person_id: personId, changes: { hack: 1 }, by_name: TAG });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /hack/);
  const r2 = await call('POST', '/api/suggest', { person_id: personId, changes: { _deleted: true }, by_name: TAG });
  assert.equal(r2.status, 400);
});

test('unknown person and empty changes are rejected', { skip }, async () => {
  assert.equal((await call('POST', '/api/suggest', { person_id: 'P999999', changes: { place: 'X' }, by_name: TAG })).status, 400);
  assert.equal((await call('POST', '/api/suggest', { person_id: personId, changes: {}, by_name: TAG })).status, 400);
});

test('pending suggestion does not leak into public data', { skip }, async () => {
  const r = await call('POST', '/api/suggest', { person_id: personId, changes: { place: 'Noi-Ri-Ng-123' }, note: 'ghi-chu-rieng-XYZ', by_name: TAG, by_contact: 'lien-he-rieng-0909' });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(Number.isInteger(r.json.id) && /^[A-Za-z0-9_-]{32}$/.test(r.json.receipt));
  const pub = await call('GET', '/api/persons?since=0');
  assert.equal(pub.status, 200);
  assert.ok(!pub.text.includes('Noi-Ri-Ng-123'));
  assert.ok(!pub.text.includes('ghi-chu-rieng-XYZ'));
  assert.ok(!pub.text.includes('lien-he-rieng-0909'));
  assert.equal((await call('GET', '/api/suggestions?status=pending')).status, 401); // by_contact is editor-only too
});

test('non-editor cannot review or approve', { skip }, async () => {
  const { rows } = await pool.query("select id from suggestions where note = 'ghi-chu-rieng-XYZ'");
  const sid = rows[0].id;
  assert.equal((await call('POST', `/api/suggestions/${sid}/approve`, {})).status, 401);
  assert.equal((await call('POST', `/api/suggestions/${sid}/reject`, { reason: 'x' })).status, 401);
  const st = await pool.query('select status from suggestions where id=$1', [sid]);
  assert.equal(st.rows[0].status, 'pending');
});

test('editor sees the pending item with current values, approve applies it and records history', { skip }, async () => {
  const list = await call('GET', '/api/suggestions?status=pending', undefined, true);
  assert.equal(list.status, 200);
  const item = list.json.items.find((x) => x.note === 'ghi-chu-rieng-XYZ');
  assert.ok(item, 'pending item listed');
  assert.equal(item.by_contact, 'lien-he-rieng-0909');
  assert.equal(item.changes.length, 1);
  assert.deepEqual([item.changes[0].field, item.changes[0].new, item.changes[0].edited, item.changes[0].status], ['place', 'Noi-Ri-Ng-123', false, 'clean']);
  const ap = await call('POST', `/api/suggestions/${item.id}/approve`, {}, true);
  assert.equal(ap.status, 200, ap.text);
  const p = await pool.query('select data from persons where id=$1', [personId]);
  assert.equal(p.rows[0].data.place, 'Noi-Ri-Ng-123');
  const h = await pool.query("select by_user, field, new_value from history where person_id=$1 and field='place'", [personId]);
  assert.equal(h.rows[0].by_user, `Đề xuất: ${TAG}, duyệt: Tester`);
  assert.equal(h.rows[0].new_value, 'Noi-Ri-Ng-123');
  assert.equal((await call('POST', `/api/suggestions/${item.id}/approve`, {}, true)).status, 409); // not twice
  const pub = await call('GET', '/api/persons?since=0');
  assert.match(pub.text, /Noi-Ri-Ng-123/); // now public, as an approved edit
});

test('approving a new-person suggestion creates the person; reject stores the reason', { skip }, async () => {
  const s1 = await call('POST', '/api/suggest', { person_id: null, changes: { name: 'Người Mới Thử', gen: 5, sex: 'f', parent: personId }, by_name: TAG });
  assert.equal(s1.status, 200);
  const s2 = await call('POST', '/api/suggest', { person_id: personId, changes: { job: 'Nghề thử' }, by_name: TAG });
  assert.equal(s2.status, 200);
  const list = await call('GET', '/api/suggestions?status=pending', undefined, true);
  const mine = list.json.items.filter((x) => x.by_name === TAG);
  const nw = mine.find((x) => x.is_new);
  const rj = mine.find((x) => !x.is_new && x.changes[0].field === 'job');
  const ap = await call('POST', `/api/suggestions/${nw.id}/approve`, {}, true);
  assert.equal(ap.status, 200, ap.text);
  newId = ap.json.person_id;
  const np = await pool.query('select data from persons where id=$1', [newId]);
  assert.equal(np.rows[0].data.name, 'Người Mới Thử');
  const rr = await call('POST', `/api/suggestions/${rj.id}/reject`, { reason: 'Chưa đủ nguồn' }, true);
  assert.equal(rr.status, 200);
  const rows = await pool.query('select status, reason, reviewed_by from suggestions where id=$1', [rj.id]);
  assert.deepEqual(rows.rows[0], { status: 'rejected', reason: 'Chưa đủ nguồn', reviewed_by: 'Tester' });
});

test('visitors are rate limited to 10 suggestions an hour', { skip }, async () => {
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call('POST', '/api/suggest', { person_id: personId, changes: { job: 'Rate ' + i }, by_name: TAG })).status;
  assert.equal(last, 429);
});
