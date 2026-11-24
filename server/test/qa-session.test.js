// Tests for scripts/qa-session.js (the QA account and its short-lived session) and the .invalid mail skip.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise). Never a live database.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const SECRET = crypto.randomBytes(24).toString('hex');
const QA_EMAIL = 'qa@giapha.invalid';
let pool, base, close, tmpDir, QA, ACC, mail;

const parse = (argv, extra = {}) => Object.assign(QA.parseArgs(argv), { secret: SECRET, now: Date.now() }, extra);
const quiet = () => {};
const cnt = async (sql, p = []) => (await pool.query(sql, p)).rows[0].n;
async function state() {
  return {
    accounts: await cnt('select count(*)::int n from accounts a where exists (select 1 from identities i where i.account_id = a.id and i.value_norm = $1)', [QA_EMAIL]),
    identities: await cnt('select count(*)::int n from identities where value_norm = $1', [QA_EMAIL]),
    members: await cnt('select count(*)::int n from members where email = $1', [QA_EMAIL]),
    sessions: await cnt('select count(*)::int n from sessions where account_id = (select account_id from identities where type = $1 and value_norm = $2 limit 1)', ['email', QA_EMAIL]),
    audit: await cnt("select count(*)::int n from history where person_id = 'ops:qa-account'"),
  };
}
// Same tables and order as --remove (the rows that reference the account go first).
async function cleanup() {
  const ids = "select account_id from identities where type = 'email' and value_norm = $1";
  await pool.query(`delete from members where email = $1 or account_id in (${ids})`, [QA_EMAIL]);
  await pool.query(`delete from person_managers where email = $1 or account_id in (${ids})`, [QA_EMAIL]);
  await pool.query(`delete from user_prefs where email = $1 or account_id in (${ids})`, [QA_EMAIL]);
  await pool.query(`update suggestions set account_id = null where account_id in (${ids})`, [QA_EMAIL]);
  await pool.query(`delete from accounts where id in (${ids})`, [QA_EMAIL]);
  await pool.query("delete from history where person_id = 'ops:qa-account'");
  await pool.query('delete from mail_log where to_email in ($1, $2)', [QA_EMAIL, 'real.person@example.test']);
}
// The cookie value's decoded body (exp and the session id), for checks. Never printed by the tests.
function decode(value) {
  const [body] = decodeURIComponent(value).split('.');
  return JSON.parse(Buffer.from(body, 'base64url').toString());
}
const getAccount = (value) => fetch(base + '/api/account', { headers: { cookie: 'gp_s=' + value } });

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = SECRET;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  QA = require('../scripts/qa-session');
  ACC = require('../accounts');
  mail = require('../mail');
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-session-test-'));
  await cleanup();
});
test.after(async () => {
  if (skip) return;
  await cleanup();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  await close?.();
  await pool?.end().catch(() => {});
});

test('dry run writes nothing: no account, grant, session, cookie file or audit row', { skip }, async () => {
  const before = await state();
  const out = path.join(tmpDir, 'dry.txt');
  const logs = [];
  await QA.run(pool, parse(['--grant', 'duong', '--role', 'admin', '--mint', '--out', out]), (s) => logs.push(s));
  assert.deepStrictEqual(await state(), before);
  assert.strictEqual(fs.existsSync(out), false, 'no cookie file on a dry run');
  assert.ok(logs.length > 0 && logs.every((l) => l.startsWith('[dry run]')), 'every dry-run line says so');
});

test('apply creates the account and the grant; a second apply changes nothing but its audit row', { skip }, async () => {
  const o = parse(['--apply', '--grant', 'duong', '--role', 'admin']);
  await QA.run(pool, o, quiet);
  const s1 = await state();
  assert.deepStrictEqual({ a: s1.accounts, i: s1.identities, m: s1.members }, { a: 1, i: 1, m: 1 });
  assert.strictEqual(s1.audit, 1, 'one audit row per apply');
  const { rows: [ident] } = await pool.query("select verified_at, is_primary, provider_sub from identities where type = 'email' and value_norm = $1", [QA_EMAIL]);
  assert.ok(ident.verified_at && ident.is_primary && ident.provider_sub === null, 'verified primary email, no provider');
  const { rows: [m] } = await pool.query("select role, status, name, account_id from members where email = $1 and family_id = 'duong'", [QA_EMAIL]);
  assert.deepStrictEqual([m.role, m.status, m.name], ['admin', 'active', 'QA tự động']);
  await QA.run(pool, parse(['--apply', '--grant', 'duong', '--role', 'admin']), quiet);
  const s2 = await state();
  assert.deepStrictEqual({ a: s2.accounts, i: s2.identities, m: s2.members, sess: s2.sessions }, { a: 1, i: 1, m: 1, sess: 0 });
  assert.strictEqual(s2.audit, 2);
});

test('mint: a working session (GET /api/account returns the account); file mode 600; cookie never printed', { skip }, async () => {
  const out = path.join(tmpDir, 'cookie-mint.txt');
  const logs = [];
  await QA.run(pool, parse(['--apply', '--mint', '--ttl', '2h', '--out', out]), (s) => logs.push(s));
  const value = fs.readFileSync(out, 'utf8').trim();
  assert.strictEqual(fs.statSync(out).mode & 0o777, 0o600);
  const printed = logs.join('\n');
  assert.ok(!printed.includes(value) && !printed.includes(value.slice(0, 40)), 'the cookie value is not in the output');
  const r = await getAccount(value);
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  const { rows: [acct] } = await pool.query('select id from accounts a where exists (select 1 from identities i where i.account_id = a.id and i.value_norm = $1)', [QA_EMAIL]);
  assert.strictEqual(j.id, acct.id);
  assert.strictEqual(j.emails.find((e) => e.primary).email, QA_EMAIL);
  const me = await (await fetch(base + '/api/me', { headers: { cookie: 'gp_s=' + value } })).json();
  assert.strictEqual(me.email, QA_EMAIL);
});

test('ttl: the session expires within 2 hours; longer or malformed values are refused', { skip }, async () => {
  assert.strictEqual(QA.parseTtl('2h'), 2 * 3600e3);
  assert.strictEqual(QA.parseTtl('30m'), 30 * 60e3);
  for (const bad of ['3h', '24h', '25h', '0m', '0h', '1d', '', 'x']) {
    assert.throws(() => QA.parseTtl(bad), QA.UsageError, `refused: ${bad}`);
  }
  assert.throws(() => QA.parseArgs(['--mint', '--out', 'x', '--ttl', '3h']), QA.UsageError);
  const out = path.join(tmpDir, 'cookie-ttl.txt');
  const now = Date.now();
  await QA.run(pool, parse(['--apply', '--mint', '--ttl', '30m', '--out', out], { now }), quiet);
  const exp = decode(fs.readFileSync(out, 'utf8').trim()).exp;
  assert.ok(exp > now && exp <= now + 30 * 60e3, 'exp is 30 minutes from the mint');
});

test('revoke: the minted cookie stops working; the account and its grant stay', { skip }, async () => {
  const out = path.join(tmpDir, 'cookie-revoke.txt');
  await QA.run(pool, parse(['--apply', '--mint', '--out', out]), quiet);
  const value = fs.readFileSync(out, 'utf8').trim();
  assert.strictEqual((await getAccount(value)).status, 200);
  const sid = decode(value).accs[0].sid;
  await QA.run(pool, parse(['--apply', '--revoke']), quiet);
  // The server keeps a session's state for 30 s; forget() models that window ending.
  ACC.forget(sid);
  assert.strictEqual((await getAccount(value)).status, 401, 'the revoked session is refused');
  const s = await state();
  assert.deepStrictEqual({ a: s.accounts, m: s.members, sess: s.sessions }, { a: 1, m: 1, sess: 0 });
});

test('mail: nothing is sent to .invalid, even with Brevo configured; a real address still goes out', { skip }, async () => {
  const saved = { k: process.env.BREVO_API_KEY, f: process.env.MAIL_FROM };
  process.env.BREVO_API_KEY = 'test-key-not-real';
  process.env.MAIL_FROM = 'noreply@example.test';
  let calls = 0;
  mail.setTransport(async () => { calls++; return { messageId: 'x' }; });
  try {
    const msg = { kind: 'test', subject: 's', html: '<p>x</p>', text: 'x' };
    assert.strictEqual((await mail.send(pool, { ...msg, to: QA_EMAIL })).status, 'skipped');
    assert.strictEqual(calls, 0, 'no transport call for .invalid');
    const { rows: [row] } = await pool.query('select status, error from mail_log where to_email = $1 order by id desc limit 1', [QA_EMAIL]);
    assert.strictEqual(row.status, 'skipped');
    assert.strictEqual((await mail.send(pool, { ...msg, to: 'real.person@example.test' })).status, 'sent');
    assert.strictEqual(calls, 1);
  } finally {
    mail.setTransport(null);
    if (saved.k === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = saved.k;
    if (saved.f === undefined) delete process.env.MAIL_FROM; else process.env.MAIL_FROM = saved.f;
  }
});

test('remove: deletes the account, memberships and sessions; the cookie is dead; the audit row stays', { skip }, async () => {
  const out = path.join(tmpDir, 'cookie-remove.txt');
  await QA.run(pool, parse(['--apply', '--mint', '--out', out]), quiet);
  const value = fs.readFileSync(out, 'utf8').trim();
  assert.strictEqual((await getAccount(value)).status, 200);
  const sid = decode(value).accs[0].sid;
  const before = await state();
  await QA.run(pool, parse(['--apply', '--remove']), quiet);
  const s = await state();
  assert.deepStrictEqual({ a: s.accounts, i: s.identities, m: s.members, sess: s.sessions }, { a: 0, i: 0, m: 0, sess: 0 });
  assert.strictEqual(s.audit, before.audit + 1);
  const { rows: [h] } = await pool.query("select new_value->>'msg' as msg from history where person_id = 'ops:qa-account' order by id desc limit 1");
  assert.ok(h.msg.startsWith('QA account '), h.msg);
  ACC.forget(sid);
  assert.strictEqual((await getAccount(value)).status, 401);
});

test('a family owner is never changed by --grant; usage errors are refused before any work', { skip }, async () => {
  await QA.run(pool, parse(['--apply', '--grant', 'duong', '--role', 'admin']), quiet);
  await pool.query("update members set role = 'owner' where email = $1 and family_id = 'duong'", [QA_EMAIL]);
  await assert.rejects(QA.run(pool, parse(['--apply', '--grant', 'duong', '--role', 'editor']), quiet), QA.UsageError);
  await cleanup();
  for (const argv of [
    ['--revoke', '--mint', '--out', 'x'],
    ['--revoke', '--remove'],
    ['--grant', 'duong'],
    ['--role', 'admin'],
    ['--grant', '../x', '--role', 'admin'],
    ['--grant', 'duong', '--role', 'owner'],
    ['--mint'],
    ['--bogus'],
  ]) assert.throws(() => QA.parseArgs(argv), QA.UsageError, argv.join(' '));
});

test('main refuses to run without DATABASE_URL (exit 2, nothing else done)', { skip }, async () => {
  const QAmod = require('../scripts/qa-session');
  const code = await QAmod.main(['--apply'], {});
  assert.strictEqual(code, 2);
});
