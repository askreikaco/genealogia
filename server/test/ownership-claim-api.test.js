// One ownership-claim entry, on a scratch database: POST /api/families/:ref/claim routes by family state.
// Owned family -> succession (refused here: an editor is still in the chain); abandoned family -> claim path: evidence,
// one claim per person (a second person may claim: non-exclusive), owner refused, notice enforced, approval by an app
// admin only, claimant becomes owner after approval. Invented names and .example.test addresses only.
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
const FO = `ocw-${TAG}`; const FB = `ocb-${TAG}`;
const ADMIN = `admin.${TAG}@example.test`; const OWNER_O = `own.${TAG}@example.test`; const ED1 = `ed1.${TAG}@example.test`; const ED2 = `ed2.${TAG}@example.test`;
const OLD = `old.${TAG}@example.test`;
let base, pool, close; const ck = {};

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email.split('.')[0] }) })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.GP_APP_ADMINS = ADMIN;
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ Cao Thử','高','public'), ($2,$2,'Họ Bạch Thử','白','public')", [FO, FB]);
  // FO: an owner seen today and an editor: owned. FB: its only owner not seen for 400 days, editors present: abandoned.
  await pool.query(`insert into members (email, name, role, status, family_id, last_seen_at) values
    ($1,'chủ','owner','active',$2, now()), ($3,'biên tập một','editor','active',$2, now()),
    ($4,'cũ','owner','active',$5, now() - interval '400 days'),
    ($6,'biên tập một','editor','active',$5, now()), ($7,'biên tập hai','editor','active',$5, now())`,
  [OWNER_O, FO, ED1, OLD, FB, ED1, ED2]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  for (const [k, e] of Object.entries({ admin: ADMIN, ed1: ED1, ed2: ED2, old: OLD, owner: OWNER_O })) ck[k] = await session(e);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from notices where family_id = any($1)', [[FO, FB]]);
  await pool.query('delete from mail_log where family_id = any($1)', [[FO, FB]]);
  await pool.query('delete from family_history where family_id = any($1)', [[FO, FB]]);
  await pool.query('delete from tree_claims where family_id = any($1)', [[FO, FB]]);
  await pool.query('delete from handover_requests where family_id = any($1)', [[FO, FB]]);
  await pool.query('delete from members where family_id = any($1)', [[FO, FB]]);
  await pool.query('delete from families where id = any($1)', [[FO, FB]]);
  await close(); await pool.end();
});

test('routing by family state: the settings entry reports the path (succession for owned, claim for abandoned)', { skip }, async () => {
  const o = await call('GET', `/api/families/${FO}/succession`, undefined, ck.ed1);
  assert.equal(o.status, 200, JSON.stringify(o.json));
  assert.equal(o.json.family_state, 'owned'); assert.equal(o.json.claim_path, 'succession');
  const a = await call('GET', `/api/families/${FB}/succession`, undefined, ck.ed1);
  assert.equal(a.json.family_state, 'abandoned'); assert.equal(a.json.claim_path, 'claim');
  assert.equal(a.json.can_claim, true, 'a member of an abandoned tree sees the entry');
});

test('owned family: the entry takes the succession path and is refused while a member is in the chain; no claim row', { skip }, async () => {
  const r = await call('POST', `/api/families/${FO}/claim`, {}, ck.ed1);
  assert.equal(r.status, 409); assert.match(r.json.error, /trao quyền/);
  const n = (await pool.query('select count(*)::int n from tree_claims where family_id=$1', [FO])).rows[0].n;
  assert.equal(n, 0);
});

test('abandoned family: the entry takes the claim path and needs evidence', { skip }, async () => {
  const r = await call('POST', `/api/families/${FB}/claim`, {}, ck.ed1);
  assert.equal(r.status, 400); assert.match(r.json.error, /bằng chứng/);
});

test('no double claims: one person has one open claim; a second person may also claim (non-exclusive board)', { skip }, async () => {
  const first = await call('POST', `/api/families/${FB}/claim`, { evidence: 'Cháu nội đời thứ ba, có sổ gia phả.' }, ck.ed1);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.path, 'claim'); assert.equal(first.json.abandoned, true);
  const again = await call('POST', `/api/families/${FB}/claim`, { evidence: 'thử lại' }, ck.ed1);
  assert.equal(again.status, 409); assert.match(again.json.error, /đã có đơn/);
  const second = await call('POST', `/api/families/${FB}/claim`, { evidence: 'Người cùng chi.' }, ck.ed2);
  assert.equal(second.status, 200, JSON.stringify(second.json));
  const rows = (await pool.query("select count(*)::int n from tree_claims where family_id=$1 and status='notice'", [FB])).rows[0].n;
  assert.equal(rows, 2);
});

test('the owner of an abandoned tree gets no claim path', { skip }, async () => {
  const r = await call('POST', `/api/families/${FB}/claim`, { evidence: 'thử' }, ck.old);
  assert.equal(r.status, 409); assert.match(r.json.error, /Chủ họ của cây/);
});

test('notice enforced and approval required: no approval before 30 days; only an app admin approves; then the claimant owns', { skip }, async () => {
  const id = (await pool.query("select id from tree_claims where family_id=$1 and claimant_email=$2", [FB, ED1])).rows[0].id;
  const early = await call('POST', `/api/app/claims/${id}/approve`, { note: 'sớm' }, ck.admin);
  assert.equal(early.status, 409); assert.match(early.json.error, /30 ngày/);
  const notAdmin = await call('POST', `/api/app/claims/${id}/approve`, { note: 'x' }, ck.ed1);
  assert.equal(notAdmin.status, 403);
  const role1 = (await pool.query('select role from members where family_id=$1 and email=$2', [FB, ED1])).rows[0].role;
  assert.equal(role1, 'editor', 'nothing changes before approval');
  await pool.query("update tree_claims set notice_until = now() - interval '1 day' where id=$1", [id]);
  const ok = await call('POST', `/api/app/claims/${id}/approve`, { note: 'đủ điều kiện' }, ck.admin);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const role2 = (await pool.query('select role from members where family_id=$1 and email=$2', [FB, ED1])).rows[0].role;
  assert.equal(role2, 'owner');
  // Ownership is no longer abandoned for the claim path once a real owner is active again.
  const st = await call('GET', `/api/families/${FB}/succession`, undefined, ck.ed2);
  assert.equal(st.json.family_state, 'owned');
});
