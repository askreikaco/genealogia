// Nhận quản lý API on a scratch database: an unowned tree (reference owner only) and an abandoned tree; the claim with
// evidence, the notice, a second claim refused, withdraw, approval refused before the notice ends, approval by an app
// admin after it (claimant becomes owner, history written), rejection with a reason, an app-admin-only review screen,
// and a pending join link decided by an app admin. Invented names and .test addresses only.
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
const FU = `cmu-${TAG}`; const FA = `cma-${TAG}`; const FJ = `cmj-${TAG}`;
const ADMIN = `admin.${TAG}@example.test`; const ASKER = `asker.${TAG}@example.test`; const ASKER2 = `asker2.${TAG}@example.test`;
const OLD = `old.${TAG}@example.test`; const EDITOR = `editor.${TAG}@example.test`; const JOINER = `joiner.${TAG}@example.test`;
let base, pool, close; const ck = {}; const P = {};
const nid = () => 'N' + crypto.randomUUID().slice(0, 13);

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
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ Đỗ Thử','杜','public'), ($2,$2,'Họ Vương Thử','王','public'), ($3,$3,'Họ Hồ Thử','胡','public')", [FU, FA, FJ]);
  Object.assign(P, { fuPerson: nid(), faPerson: nid(), joinPerson: nid(), joinTarget: nid() });
  const ins = (id, data, fam) => pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3)", [id, data, fam]);
  await ins(P.fuPerson, { name: 'Đỗ Văn Thử', sex: 'm' }, FU);
  await ins(P.faPerson, { name: 'Vương Văn Thử', sex: 'm' }, FA);
  await ins(P.joinPerson, { name: 'Hồ Thị Nối', sex: 'f' }, FJ);
  await ins(P.joinTarget, { name: 'Hồ Thị Nối', sex: 'f' }, FU);
  // FU: only the reference owner (a system account): unowned. FA: one owner not seen for over a year: abandoned.
  await pool.query(`insert into members (email, name, role, status, family_id, last_seen_at) values
    ('reference@giapha.invalid','ref','owner','active',$1,null),
    ($2,'cũ','owner','active',$3, now() - interval '400 days'),
    ($4,'biên tập','editor','active',$3, now()),
    ($5,'biên tập','editor','active',$6, now()),
    ($7,'chủ','owner','active',$6, now())`, [FU, OLD, FA, EDITOR, JOINER, FJ, ADMIN]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  for (const k of ['admin', 'asker', 'asker2', 'editor', 'joiner', 'old']) ck[k] = await session({ admin: ADMIN, asker: ASKER, asker2: ASKER2, editor: EDITOR, joiner: JOINER, old: OLD }[k]);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from person_links where a_family = any($1) or b_family = any($1)', [[FU, FA, FJ]]);
  await pool.query('delete from notices where family_id = any($1)', [[FU, FA, FJ]]);
  await pool.query('delete from mail_log where family_id = any($1)', [[FU, FA, FJ]]);
  await pool.query('delete from family_history where family_id = any($1)', [[FU, FA, FJ]]);
  await pool.query('delete from tree_claims where family_id = any($1)', [[FU, FA, FJ]]);
  await pool.query('delete from members where family_id = any($1)', [[FU, FA, FJ]]);
  await pool.query('delete from history where person_id = any($1)', [Object.values(P)]);
  await pool.query('delete from persons where id = any($1)', [Object.values(P)]);
  await pool.query('delete from families where id = any($1)', [[FU, FA, FJ]]);
  await close(); await pool.end();
});

test('unowned tree (reference owner only): the state is unowned and a signed-in stranger may claim', { skip }, async () => {
  const g = await call('GET', `/api/claims?family=${FU}`, undefined, ck.asker);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.equal(g.json.state, 'unowned'); assert.equal(g.json.can_claim, true); assert.equal(g.json.notice, null);
  const anon = await call('GET', `/api/claims?family=${FU}`);
  assert.equal(anon.json.can_claim, false, 'signed out: cannot claim');
});

test('a claim needs evidence; a member cannot claim; the claim opens a 30-day notice', { skip }, async () => {
  const none = await call('POST', `/api/claims?family=${FU}`, { evidence: '  ' }, ck.asker);
  assert.equal(none.status, 400);
  // (the owner's own refusal is in ownership-claim-api.test.js: a request by the owner refreshes last_seen_at)
  const ok = await call('POST', `/api/claims?family=${FU}`, { evidence: 'Sổ gia phả bản chép tay, trang 3' }, ck.asker);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.abandoned, false);
  const dup = await call('POST', `/api/claims?family=${FU}`, { evidence: 'lần hai' }, ck.asker);
  assert.equal(dup.status, 409, 'one open claim per person');
  const second = await call('POST', `/api/claims?family=${FU}`, { evidence: 'người khác cũng nộp' }, ck.asker2);
  assert.equal(second.status, 200, 'non-exclusive: a second claimant is allowed');
  const g = await call('GET', `/api/claims?family=${FU}`, undefined, ck.asker);
  assert.ok(g.json.notice, 'the public notice is shown');
  assert.equal(g.json.notice.days_left, 30); assert.equal(g.json.my_claim.id, ok.json.id);
  assert.equal(g.json.can_claim, false);
  const anonNotice = await call('GET', `/api/claims?family=${FU}`);
  assert.ok(anonNotice.json.notice, 'the notice is public (no sign-in)');
  assert.equal(anonNotice.json.my_claim, null);
});

test('approval is refused before the notice ends and refused to non-admins', { skip }, async () => {
  const c = (await pool.query("select id from tree_claims where family_id=$1 and claimant_email=$2", [FU, ASKER])).rows[0];
  const early = await call('POST', `/api/app/claims/${c.id}/approve`, {}, ck.admin);
  assert.equal(early.status, 409); assert.match(early.json.error, /30 ngày/);
  const notAdmin = await call('POST', `/api/app/claims/${c.id}/approve`, {}, ck.asker);
  assert.equal(notAdmin.status, 403);
  const list = await call('GET', '/api/app/claims', undefined, ck.asker);
  assert.equal(list.status, 403, 'the review screen is for app admins only');
  assert.equal((await call('GET', '/api/app/claims')).status, 401);
});

test('withdraw: only the claimant; the second claim is withdrawn; then no notice for it', { skip }, async () => {
  const c = (await pool.query("select id from tree_claims where family_id=$1 and claimant_email=$2", [FU, ASKER2])).rows[0];
  assert.equal((await call('POST', `/api/claims/${c.id}/withdraw`, {}, ck.asker)).status, 409, 'not the claimant');
  const w = await call('POST', `/api/claims/${c.id}/withdraw`, {}, ck.asker2);
  assert.equal(w.status, 200, JSON.stringify(w.json));
  const st = (await pool.query('select status from tree_claims where id=$1', [c.id])).rows[0];
  assert.equal(st.status, 'withdrawn');
});

test('after the notice: an app admin approves, the claimant becomes an owner, history and notice are written', { skip }, async () => {
  const c = (await pool.query("select id from tree_claims where family_id=$1 and claimant_email=$2", [FU, ASKER])).rows[0];
  await pool.query("update tree_claims set notice_until = now() - interval '1 day' where id=$1", [c.id]);
  const ok = await call('POST', `/api/app/claims/${c.id}/approve`, { note: 'đủ bằng chứng' }, ck.admin);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.role, 'owner');
  const m = (await pool.query("select role, status from members where family_id=$1 and email=$2", [FU, ASKER])).rows[0];
  assert.deepStrictEqual(m, { role: 'owner', status: 'active' });
  const h = await pool.query("select count(*)::int n from family_history where family_id=$1 and field='quan_ly'", [FU]);
  assert.ok(h.rows[0].n >= 2, 'opening and approval are both in the family history');
  const n = await pool.query('select count(*)::int n from notices where family_id=$1 and email=$2', [FU, ASKER]);
  assert.ok(n.rows[0].n >= 1, 'the claimant has an in-app notice');
  const g = await call('GET', `/api/claims?family=${FU}`, undefined, ck.asker);
  assert.equal(g.json.state, 'owned'); assert.equal(g.json.can_claim, false);
  // the reference owner is still there and was never changed
  const ref = (await pool.query("select role, status from members where family_id=$1 and email='reference@giapha.invalid'", [FU])).rows[0];
  assert.deepStrictEqual(ref, { role: 'owner', status: 'active' });
});

test('abandoned tree: the claim goes to the owners (inactive owner gets the mail, system owner never)', { skip }, async () => {
  const st = await call('GET', `/api/claims?family=${FA}`, undefined, ck.asker);
  assert.equal(st.json.state, 'abandoned'); assert.equal(st.json.can_claim, true);
  const r = await call('POST', `/api/claims?family=${FA}`, { evidence: 'Chủ họ cũ đã mất năm 2019' }, ck.asker);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.abandoned, true);
  const mails = await pool.query("select to_email, status from mail_log where family_id=$1 and kind='tree_claim'", [FA]);
  assert.deepStrictEqual(mails.rows.map((x) => x.to_email), [OLD], 'the old owner is e-mailed');
  assert.equal(mails.rows[0].status, 'skipped', 'no mail key in tests: the attempt is logged');
  const sysMail = await pool.query("select count(*)::int n from mail_log where family_id=$1 and to_email like '%.invalid'", [FA]);
  assert.equal(sysMail.rows[0].n, 0);
});

test('reject needs a reason; the rejection goes to the claimant', { skip }, async () => {
  const c = (await pool.query("select id from tree_claims where family_id=$1 and claimant_email=$2", [FA, ASKER])).rows[0];
  const noReason = await call('POST', `/api/app/claims/${c.id}/reject`, { reason: '' }, ck.admin);
  assert.equal(noReason.status, 409);
  await pool.query("update tree_claims set notice_until = now() - interval '1 day' where id=$1", [c.id]);
  const ok = await call('POST', `/api/app/claims/${c.id}/reject`, { reason: 'Bằng chứng chưa đủ' }, ck.admin);
  assert.equal(ok.status, 200);
  const st = (await pool.query('select status, decision_note from tree_claims where id=$1', [c.id])).rows[0];
  assert.deepStrictEqual(st, { status: 'rejected', decision_note: 'Bằng chứng chưa đủ' });
  const mails = await pool.query("select to_email from mail_log where family_id=$1 and kind='tree_claim' and to_email=$2", [FA, ASKER]);
  assert.equal(mails.rowCount, 1);
});

test('review screen: the admin sees open claims and pending join links; a join link to an unowned tree is decided by an app admin', { skip }, async () => {
  const pending = await call('GET', '/api/app/claims', undefined, ck.admin);
  assert.equal(pending.status, 200, JSON.stringify(pending.json));
  assert.ok(pending.json.claims.some((c) => c.family_id === FA && c.status === 'rejected'));
  const link = await pool.query(`insert into person_links (a_family, a_person, b_family, b_person, status, proposed_by) values ($1,$2,$3,$4,'pending',$5) returning id`,
    [FJ, P.joinPerson, FU, P.joinTarget, JOINER]);
  const lid = link.rows[0].id;
  const shown = (await call('GET', '/api/app/claims', undefined, ck.admin)).json.links.find((x) => x.id === Number(lid));
  assert.ok(shown, 'the pending link is on the review screen');
  const denied = await call('POST', `/api/links/${lid}/accept`, {}, ck.editor);
  assert.equal(denied.status, 403, 'an editor of the other tree cannot accept');
  const ok = await call('POST', `/api/links/${lid}/accept`, {}, ck.admin);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.status, 'accepted');
});
