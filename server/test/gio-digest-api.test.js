// Giỗ reminder e-mail (N1), API and sender against a SCRATCH database (GP_TEST_DATABASE_URL; skipped otherwise).
// Real routes and cookies. The mail transport is a recorder (mail.setTransport): nothing leaves the test.
// Covers: the toggle persists (default off), the unsubscribe token, one digest per account per week (stored), the
// opt-out, followed-only, and no family the account cannot read. Invented names and addresses only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const EMAIL = `digest.${TAG}@example.test`;
const OTHER = `digest-other.${TAG}@example.test`;
const SECRET = crypto.randomBytes(24).toString('hex');
const DIGEST_SECRET = 'digest-test-secret-' + crypto.randomBytes(12).toString('hex');
const FAM = `dg${TAG}`; const PRIV = `dgp${TAG}`;
const PID = () => 'P' + (100000 + Math.floor(Math.random() * 800000));
const P_IN = PID(); const P_OUT = PID(); const P_PRIV = PID(); const P_LIVING = PID();
const NOW = new Date('2027-01-25T01:00:00Z'); // Monday 08:00, Vietnam
let base, pool, close, mail, GD, lunar, cookie;
const sent = [];

async function call(method, p, body, ck) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(ck ? { cookie: ck } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  const all = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  return { status: r.status, json, text, all };
}
const cookieNamed = (all, name) => { const c = all.find((x) => x.startsWith(name + '=') && !/Max-Age=0/.test(x)); return c ? c.split(';')[0] : null; };

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = SECRET; process.env.EDITORS = '';
  process.env.GP_DIGEST_SECRET = DIGEST_SECRET; process.env.BREVO_API_KEY = 'fake-key-for-tests'; process.env.MAIL_FROM = 'noreply@example.test';
  process.env.PUBLIC_URL = 'https://gp.example.test';
  const { app, pool: p } = require('../server');
  pool = p;
  mail = require('../mail');
  GD = require('../gio-digest');
  lunar = await GD.loadLunar();
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  mail.setTransport(async ({ body }) => { sent.push(body); return { messageId: 'test-' + sent.length }; });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://localhost:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,$2,'public'), ($3,$3,$4,'private')", [FAM, 'Họ thử nghiệm', PRIV, 'Họ kín thử nghiệm']);
  await pool.query("insert into persons (id, family_id, data) values ($1,$2,$3), ($4,$2,$5), ($6,$7,$8), ($9,$2,$10)", [
    P_IN, FAM, { name: 'Thử Một', death_lunar: '1/1' },
    P_OUT, { name: 'Thử Hai', death_lunar: '1/1' },
    P_PRIV, PRIV, { name: 'Thử Ba', death_lunar: '1/1' },
    P_LIVING, { name: 'Thử Bốn', death_lunar: '1/1', living: 'living' }]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thử',$2,'member','active')", [EMAIL, FAM]);
  const s = await call('POST', '/api/test/session', { email: EMAIL, name: 'Thử Giỗ', sub: 'digest-sub-' + TAG });
  cookie = cookieNamed(s.all, 'gp_s');
});
test.after(async () => {
  if (skip) return;
  await pool?.query('delete from mail_log where to_email = any($1)', [[EMAIL, OTHER]]).catch(() => {});
  await pool?.query('delete from user_prefs where email = any($1)', [[EMAIL, OTHER]]).catch(() => {});
  await pool?.query('delete from members where email = $1', [EMAIL]).catch(() => {});
  await pool?.query('delete from persons where id = any($1)', [[P_IN, P_OUT, P_PRIV, P_LIVING]]).catch(() => {});
  await pool?.query('delete from families where id = any($1)', [[FAM, PRIV]]).catch(() => {});
  await pool?.query("delete from job_runs where name = 'gio-digest'").catch(() => {});
  mail?.setTransport(null);
  await close?.(); await pool?.end().catch(() => {});
});

test('the toggle is off by default, needs a Google sign-in, and persists', { skip }, async () => {
  assert.equal((await call('GET', '/api/me/digest')).status, 401, 'signed out refused');
  const off = await call('GET', '/api/me/digest', undefined, cookie);
  assert.equal(off.status, 200);
  assert.equal(off.json.enabled, false, 'default OFF');
  assert.equal((await call('PUT', '/api/me/digest', { enabled: 'yes' }, cookie)).status, 400, 'only a boolean');
  assert.equal((await call('PUT', '/api/me/digest', { enabled: true }, cookie)).status, 200);
  assert.equal((await call('GET', '/api/me/digest', undefined, cookie)).json.enabled, true, 'persisted');
});

test('followed people only: the weekly digest lists the followed giỗ, not a living or unfollowed one', { skip }, async () => {
  const p = await call('PUT', '/api/me/prefs', { follows: [P_IN, P_LIVING] }, cookie);
  assert.equal(p.status, 200);
  await pool.query("insert into persons (id, family_id, data) values ($1, $2, $3)", [PID(), FAM, { name: 'Thử Năm', death_lunar: '1/1' }]).catch(() => {});
  const stats = await GD.runDigestIfDue(pool, NOW, { mailer: mail, lunar });
  assert.ok(stats && stats.sent >= 1, 'sent');
  const mine = sent.filter((m) => m.to[0].email === EMAIL);
  assert.equal(mine.length, 1, 'one mail to the account');
  const html = mine[0].htmlContent;
  assert.equal((html.match(/Giỗ 1\/1 âm lịch/g) || []).length, 1, 'one followed giỗ (the living one is left out)');
  assert.ok(html.includes('06/02/2027'), 'Tết 2027 is 6 Feb 2027');
  assert.ok(html.includes('Thử Một') && !html.includes('Thử Bốn'), 'followed name in, living name out');
  assert.ok(!html.includes('Thử Hai') && !html.includes('Thử Ba'), 'unfollowed and private family out');
  assert.ok(html.includes('/api/digest/unsubscribe?t='), 'unsubscribe link present');
});

test('one digest per account per week: the slot and the stored last send both block a second one', { skip }, async () => {
  assert.equal(await GD.runDigestIfDue(pool, NOW, { mailer: mail, lunar }), null, 'this slot already ran');
  await pool.query("delete from job_runs where name = 'gio-digest'");
  const again = await GD.runDigestIfDue(pool, NOW, { mailer: mail, lunar });
  assert.equal(sent.filter((m) => m.to[0].email === EMAIL).length, 1, 'the stored send blocks it');
  assert.equal(again.sent, 0);
});

test('the unsubscribe link turns the toggle off; a bad token changes nothing', { skip }, async () => {
  const bad = await call('GET', '/api/digest/unsubscribe?t=' + GD.signUnsub(EMAIL, 'wrong-secret-0123456789abcdef'));
  assert.equal(bad.status, 400);
  assert.equal((await call('GET', '/api/me/digest', undefined, cookie)).json.enabled, true, 'still on');
  const ok = await call('GET', '/api/digest/unsubscribe?t=' + GD.signUnsub(EMAIL, DIGEST_SECRET));
  assert.equal(ok.status, 200);
  assert.match(ok.text, /Đã tắt email nhắc giỗ/);
  assert.equal((await call('GET', '/api/me/digest', undefined, cookie)).json.enabled, false, 'off');
});

test('opt-out is respected: an account that is off gets no mail on the next slot', { skip }, async () => {
  await pool.query("delete from job_runs where name = 'gio-digest'");
  const before = sent.length;
  const later = new Date('2027-02-01T01:00:00Z');
  await GD.runDigestIfDue(pool, later, { mailer: mail, lunar });
  assert.equal(sent.slice(before).filter((m) => m.to[0].email === EMAIL).length, 0);
});
