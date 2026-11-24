// Device data: receipts for anonymous suggestions, account claim, own-suggestion edit/withdraw, per-account prefs.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = 'TEST-DEV-' + crypto.randomBytes(3).toString('hex');
const OWNER = `owner-${TAG}@test.local`.toLowerCase();
const ACC = `acc-${TAG}@test.local`.toLowerCase();
const OTHER = `other-${TAG}@test.local`.toLowerCase();
let base, pool, close, personId;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
async function sessionFor(email) {
  const r = await call('POST', '/api/test/session', { email, name: email.split('@')[0] });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sendAnon = async (changes, note = '') => {
  const r = await call('POST', '/api/suggest', { person_id: personId, changes, by_name: TAG, note });
  assert.equal(r.status, 200, r.text);
  return { id: r.json.id, receipt: r.json.receipt };
};

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  personId = 'N' + crypto.randomUUID().slice(0, 13);
  await pool.query("insert into persons (id, data, updated_by) values ($1, $2, 'test')", [personId, { name: 'Người Thử ' + TAG, gen: 6, sex: 'f' }]);
  await pool.query("insert into members (email, name, role, status) values ($1, 'Chủ Thử', 'owner', 'active')", [OWNER]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
});

test.after(async () => {
  if (skip) return;
  await pool.query('delete from suggestions where by_name = $1', [TAG]);
  await pool.query('delete from history where person_id = $1', [personId]);
  await pool.query('delete from ops where person_id = $1', [personId]);
  await pool.query('delete from persons where id = $1', [personId]);
  await pool.query('delete from user_prefs where email = any($1)', [[OWNER, ACC, OTHER]]);
  await pool.query('delete from members where email = any($1)', [[OWNER, ACC, OTHER]]);
  await pool.end(); await close();
});

test('suggest returns id and receipt; only the receipt hash is stored', { skip }, async () => {
  const s = await sendAnon({ job: 'Nghề A' });
  assert.match(s.receipt, /^[A-Za-z0-9_-]{32}$/);
  const { rows } = await pool.query('select receipt_hash, status from suggestions where id=$1', [s.id]);
  assert.equal(rows[0].receipt_hash, sha(s.receipt));
  assert.equal(rows[0].status, 'pending');
  const plain = await pool.query('select count(*)::int n from suggestions where receipt_hash = $1 or receipt_hash = $2', [s.receipt, s.receipt]);
  assert.equal(plain.rows[0].n, 0);
});

test('mine needs the matching receipt: none, wrong or another row’s receipt show nothing', { skip }, async () => {
  const a = await sendAnon({ job: 'Nghề B' }, 'ghi-chu-B');
  const b = await sendAnon({ job: 'Nghề C' });
  const none = await call('POST', '/api/suggestions/mine', { receipts: [] });
  assert.equal(none.status, 200);
  assert.deepEqual(none.json.items, []);
  const wrong = crypto.randomBytes(24).toString('base64url');
  assert.deepEqual((await call('POST', '/api/suggestions/mine', { receipts: [{ id: a.id, receipt: wrong }] })).json.items, []);
  assert.deepEqual((await call('POST', '/api/suggestions/mine', { receipts: [{ id: a.id, receipt: b.receipt }] })).json.items, []);
  assert.deepEqual((await call('POST', '/api/suggestions/mine', { receipts: [{ id: 'x', receipt: a.receipt }, { id: a.id }] })).json.items, []);
  const ok = await call('POST', '/api/suggestions/mine', { receipts: [{ id: a.id, receipt: a.receipt }] });
  assert.equal(ok.json.items.length, 1);
  const it = ok.json.items[0];
  assert.equal(it.status, 'pending');
  assert.equal(it.person_name, 'Người Thử ' + TAG);
  assert.equal(it.note, 'ghi-chu-B');
  assert.deepEqual(it.changes, { job: 'Nghề B' });
  assert.ok(it.created_at);
  for (const leak of ['by_contact', 'ip_hash', 'receipt_hash', 'by_name', 'account_email']) assert.ok(!(leak in it), leak);
});

test('withdraw needs the receipt; a wrong receipt changes nothing; only while pending', { skip }, async () => {
  const s = await sendAnon({ job: 'Nghề D' });
  assert.equal((await call('POST', `/api/suggestions/${s.id}/withdraw`, { receipt: crypto.randomBytes(24).toString('base64url') })).status, 404);
  assert.equal((await call('POST', `/api/suggestions/${s.id}/withdraw`, {})).status, 404);
  assert.equal((await pool.query('select status from suggestions where id=$1', [s.id])).rows[0].status, 'pending');
  const ok = await call('POST', `/api/suggestions/${s.id}/withdraw`, { receipt: s.receipt });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await pool.query('select status from suggestions where id=$1', [s.id])).rows[0].status, 'withdrawn');
  assert.equal((await call('POST', `/api/suggestions/${s.id}/withdraw`, { receipt: s.receipt })).status, 409);
  const mine = await call('POST', '/api/suggestions/mine', { receipts: [{ id: s.id, receipt: s.receipt }] });
  assert.equal(mine.json.items[0].status, 'withdrawn');
});

test('a reviewed suggestion cannot be withdrawn or edited; reject reason is shown to the sender', { skip }, async () => {
  const s = await sendAnon({ job: 'Nghề E' });
  const owner = await sessionFor(OWNER);
  const rj = await call('POST', `/api/suggestions/${s.id}/reject`, { reason: 'Chưa đủ nguồn' }, owner);
  assert.equal(rj.status, 200, rj.text);
  assert.equal((await call('POST', `/api/suggestions/${s.id}/withdraw`, { receipt: s.receipt })).status, 409);
  assert.equal((await call('PATCH', `/api/suggestions/${s.id}`, { receipt: s.receipt, changes: { job: 'Đổi' } })).status, 409);
  const mine = await call('POST', '/api/suggestions/mine', { receipts: [{ id: s.id, receipt: s.receipt }] });
  assert.equal(mine.json.items[0].status, 'rejected');
  assert.equal(mine.json.items[0].reason, 'Chưa đủ nguồn');
});

test('edit a pending suggestion: receipt required, same checks as suggest, approved ones are locked', { skip }, async () => {
  const s = await sendAnon({ job: 'Nghề F' });
  const wrong = crypto.randomBytes(24).toString('base64url');
  assert.equal((await call('PATCH', `/api/suggestions/${s.id}`, { receipt: wrong, changes: { job: 'Hack' }, note: 'x' })).status, 404);
  assert.deepEqual((await pool.query('select changes from suggestions where id=$1', [s.id])).rows[0].changes, { job: 'Nghề F' });
  assert.equal((await call('PATCH', `/api/suggestions/${s.id}`, { receipt: s.receipt, changes: { hack: 1 } })).status, 400);
  assert.equal((await call('PATCH', `/api/suggestions/${s.id}`, { receipt: s.receipt, changes: {} })).status, 400);
  const ok = await call('PATCH', `/api/suggestions/${s.id}`, { receipt: s.receipt, changes: { job: 'Nghề F mới', place: 'Hà Nội' }, note: 'ghi chú mới' });
  assert.equal(ok.status, 200, ok.text);
  const { rows } = await pool.query('select changes, note, status from suggestions where id=$1', [s.id]);
  assert.deepEqual(rows[0], { changes: { job: 'Nghề F mới', place: 'Hà Nội' }, note: 'ghi chú mới', status: 'pending' });
  const owner = await sessionFor(OWNER);
  assert.equal((await call('POST', `/api/suggestions/${s.id}/approve`, {}, owner)).status, 200);
  assert.equal((await call('PATCH', `/api/suggestions/${s.id}`, { receipt: s.receipt, changes: { job: 'Muộn' } })).status, 409);
});

test('signed-in: suggestions are linked to the account, claim attaches local receipts once', { skip }, async () => {
  const anon = await sendAnon({ job: 'Nghề G' });
  const acc = await sessionFor(ACC);
  // claim needs a Google session
  assert.equal((await call('POST', '/api/me/claim', { receipts: [{ id: anon.id, receipt: anon.receipt }] })).status, 401);
  const claim = await call('POST', '/api/me/claim', { receipts: [{ id: anon.id, receipt: anon.receipt }, { id: anon.id, receipt: 'short' }] }, acc);
  assert.equal(claim.status, 200, claim.text);
  assert.equal(claim.json.matched, 1);
  assert.equal((await pool.query('select account_email from suggestions where id=$1', [anon.id])).rows[0].account_email, ACC);
  // another account cannot take it over
  const other = await sessionFor(OTHER);
  assert.equal((await call('POST', '/api/me/claim', { receipts: [{ id: anon.id, receipt: anon.receipt }] }, other)).json.matched, 0);
  assert.equal((await pool.query('select account_email from suggestions where id=$1', [anon.id])).rows[0].account_email, ACC);
  // a suggestion sent while signed in belongs to the account from the start
  const sent = await call('POST', '/api/suggest', { person_id: personId, changes: { job: 'Nghề H' }, by_name: TAG }, acc);
  assert.equal(sent.status, 200);
  // the account sees its rows with no receipt at all; the other account sees none
  const mine = await call('POST', '/api/suggestions/mine', { receipts: [] }, acc);
  const ids = mine.json.items.map((x) => x.id).sort((x, y) => x - y);
  assert.deepEqual(ids, [anon.id, sent.json.id].sort((x, y) => x - y));
  assert.deepEqual((await call('POST', '/api/suggestions/mine', { receipts: [] }, other)).json.items, []);
  // the account can withdraw its own pending row without a receipt
  assert.equal((await call('POST', `/api/suggestions/${sent.json.id}/withdraw`, {}, acc)).status, 200);
});

test('prefs need a Google session; round-trip; size limit 16 KB; theme must be a known value', { skip }, async () => {
  assert.equal((await call('GET', '/api/me/prefs')).status, 401);
  assert.equal((await call('PUT', '/api/me/prefs', { follows: [] })).status, 401);
  const acc = await sessionFor(ACC);
  const empty = await call('GET', '/api/me/prefs', undefined, acc);
  assert.deepEqual(empty.json, { prefs: {} });
  const prefs = { follows: ['P000001', personId], theme: 'dark', filters: { chi: 'P000001', gio_all: '0' }, recent: ['Nguyễn', 'Dương Văn'] };
  assert.equal((await call('PUT', '/api/me/prefs', prefs, acc)).status, 200);
  assert.deepEqual((await call('GET', '/api/me/prefs', undefined, acc)).json.prefs, prefs);
  assert.equal((await call('PUT', '/api/me/prefs', { theme: 'pink' }, acc)).status, 400);
  assert.equal((await call('PUT', '/api/me/prefs', { follows: ['bad id'] }, acc)).status, 400);
  assert.equal((await call('PUT', '/api/me/prefs', { recent: Array(11).fill('a') }, acc)).status, 400);
  const big = await call('PUT', '/api/me/prefs', { filters: { blob: 'x'.repeat(17 * 1024) } }, acc);
  assert.equal(big.status, 413);
  assert.deepEqual((await call('GET', '/api/me/prefs', undefined, acc)).json.prefs, prefs); // unchanged
});

test('/api/me returns the Google given and family names for the join form (never split from a full name)', { skip }, async () => {
  const email = `names-${TAG}@test.local`;
  const r = await call('POST', '/api/test/session', { email, name: 'Dương Văn Tổ', given_name: 'Tổ', family_name: 'Dương' });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const me = await call('GET', '/api/me', undefined, cookie);
  assert.equal(me.json.given_name, 'Tổ');
  assert.equal(me.json.family_name, 'Dương');
  const plain = await call('POST', '/api/test/session', { email: 'plain-' + email, name: 'Chỉ Tên Đầy Đủ' });
  const me2 = await call('GET', '/api/me', undefined, plain.headers.get('set-cookie').split(';')[0]);
  assert.equal(me2.json.given_name, '');
  assert.equal(me2.json.family_name, '');
});
