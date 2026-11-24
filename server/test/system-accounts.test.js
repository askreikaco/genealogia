// System accounts (.invalid only, e.g. the QA account) are never offered a handover, never confirm a death report,
// never back a claim and are not counted as an active admin. Real admins still are.
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
const QA = 'qa@giapha.invalid';
const SYS_CONTACT = `contact.${TAG}@giapha.invalid`;
const OWNER = `owner.${TAG}@example.test`;
const REAL_ADMIN = `admin.${TAG}@example.test`;
const REAL_EDITOR = `editor.${TAG}@example.test`;
const REAL_CONTACT = `contact.${TAG}@example.test`;
const FAM = `sys${TAG}`;
let pool, S, R, SA, A;

async function cleanup() {
  await pool.query('delete from handover_steps where request_id in (select id from handover_requests where family_id = $1)', [FAM]);
  await pool.query('delete from handover_offers where request_id in (select id from handover_requests where family_id = $1)', [FAM]);
  await pool.query('delete from handover_requests where family_id = $1', [FAM]);
  await pool.query('delete from trusted_contacts where family_id = $1', [FAM]);
  await pool.query('delete from mail_log where family_id = $1', [FAM]);
  await pool.query('delete from members where family_id = $1 or email = $2', [FAM, QA]);
  await pool.query('delete from accounts where id in (select account_id from identities where type = $1 and value_norm = $2)', ['email', QA]);
  await pool.query('delete from families where id = $1', [FAM]);
}

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  S = require('../succession'); R = require('../succession-rules'); SA = require('../system-accounts'); A = require('../accounts');
  await cleanup();
  await pool.query('insert into families (id, slug, name, han, owner_inactive_months) values ($1,$1,$2,$3,12)', [FAM, `Họ hệ thống ${TAG}`, '楊']);
  // the QA account: verified .invalid email, linked to its members rows through account_id (as sign-in does)
  const qaAccount = await A.createWithEmail(pool, QA, 'QA tự động');
  const ins = (email, role, years, accountId = null) => pool.query(
    `insert into members (email, name, role, status, family_id, approved_at, created_at, account_id) values ($1, $2, $3, 'active', $4, now() - ($5 || ' years')::interval, now(), $6)`,
    [email, email.split('@')[0], role, FAM, String(years), accountId]);
  await ins(OWNER, 'owner', 3);
  await ins(QA, 'admin', 2, qaAccount);
  await ins(REAL_ADMIN, 'admin', 1);
  await ins(REAL_EDITOR, 'editor', 1);
  await pool.query("insert into trusted_contacts (family_id, email, name, priority, status) values ($1, $2, 'sys', 1, 'accepted'), ($1, $3, 'real', 2, 'accepted')", [FAM, SYS_CONTACT, REAL_CONTACT]);
});
test.after(async () => {
  if (skip) return;
  await cleanup();
  await pool?.end().catch(() => {});
});

test('isSystemAccount: only-.invalid accounts are system; one real email makes it a person', { skip }, () => {
  assert.strictEqual(SA.isSystemAccount({ emails: [QA] }), true);
  assert.strictEqual(SA.isSystemAccount({ emails: ['QA@Giapha.INVALID'] }), true);
  assert.strictEqual(SA.isSystemAccount({ emails: [QA, REAL_ADMIN] }), false);
  assert.strictEqual(SA.isSystemAccount({ emails: [] }), false);
  assert.strictEqual(SA.isSystemAccount({}), false);
});

test('buildChain: a system admin or contact is left out; the real ones stay in order', { skip }, () => {
  const chain = R.buildChain({
    contacts: [{ email: SYS_CONTACT, priority: 1 }, { email: REAL_CONTACT, priority: 2 }],
    members: [{ email: QA, role: 'admin', tenureMs: 1 }, { email: REAL_ADMIN, role: 'admin', tenureMs: 2 }, { email: REAL_EDITOR, role: 'editor', tenureMs: 3 }],
    ownerEmail: OWNER,
  });
  assert.deepStrictEqual(chain.map((x) => x.email), [REAL_CONTACT, REAL_ADMIN, REAL_EDITOR]);
});

test('the QA admin is not offered a handover; a real admin still is', { skip }, async () => {
  const fam = { id: FAM, slug: FAM, name: 'x', owner_inactive_months: 12 };
  const now = Date.now();
  const chain = await S.chainFor(pool, FAM, OWNER);
  assert.ok(!chain.some((x) => x.email === QA), 'chainFor leaves the QA admin out');
  assert.ok(chain.some((x) => x.email === REAL_ADMIN), 'chainFor keeps the real admin');
  const confirmers = (await S.confirmersOf(pool, FAM)).map((c) => c.email);
  assert.deepStrictEqual(confirmers, [REAL_CONTACT], 'only real accepted contacts confirm; system contact never does');
  assert.strictEqual(await S.canConfirm(pool, FAM, QA), false);
  const id = await S.startInactive(pool, fam, now);
  const req = await S.requestById(pool, id);
  await S.beginOffers(pool, fam, req, now);
  const offered = (await pool.query('select email from handover_offers where request_id = $1 order by position', [id])).rows.map((r) => r.email);
  assert.ok(!offered.includes(QA), `offers: ${offered.join(', ')}`);
  assert.ok(offered.includes(REAL_ADMIN), `offers: ${offered.join(', ')}`);
});

test('the active admin count (SQL used by the app) ignores the QA account', { skip }, async () => {
  const { rows } = await pool.query(`select count(*)::int n from members where family_id = $1 and status = 'active' and role = 'admin' and not ${SA.SYSTEM_MEMBER_SQL}`, [FAM]);
  assert.strictEqual(rows[0].n, 1);
});
