// Mail: templates (Vietnamese, escaped, no key), the Brevo request shape (fetch stubbed, nothing leaves the test),
// the send log in mail_log (needs the scratch DB; skipped without it). The key used here is a fake string.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mail = require('../mail');
const T = require('../mail-templates');

const FAKE_KEY = 'xkeys-FAKE-0123456789-do-not-use';
const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skipDb = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';

const sample = () => [
  T.trustedInvite({ family: 'Họ <Dương>', inviter: 'Chủ "họ"', name: 'Cô & Chú', url: 'https://g.test/#/trusted/abc', days: 14 }),
  T.ownerReminder({ family: 'Họ Dương', stage: '1m', months: 12, url: 'https://g.test/#/duong/cai-dat-dong-ho' }),
  T.ownerReminder({ family: 'Họ Dương', stage: '1w', months: 12, url: 'https://g.test/#/duong/cai-dat-dong-ho' }),
  T.ownerReminder({ family: 'Họ Dương', stage: '1d', months: 12, url: 'https://g.test/#/duong/cai-dat-dong-ho' }),
  T.handoverNotice({ family: 'Họ Dương', deadline: new Date('2026-12-01T00:00:00Z'), url: 'https://g.test/#/duong/cai-dat-dong-ho', reason: 'inactive' }),
  T.handoverNotice({ family: 'Họ Dương', deadline: new Date('2026-12-01T00:00:00Z'), url: 'https://g.test/#/duong/cai-dat-dong-ho', reason: 'deceased' }),
  T.handoverOffer({ family: 'Họ Dương', expiresAt: new Date('2026-12-15T00:00:00Z'), url: 'https://g.test/#/offer/tok' }),
  T.handoverCode({ family: 'Họ Dương', code: '004271', minutes: 15 }),
  T.confirmRequest({ family: 'Họ Dương', url: 'https://g.test/#/duong/cai-dat-dong-ho' }),
  T.ownerChanged({ family: 'Họ Dương', role: 'new', url: 'https://g.test/#/duong/tree' }),
  T.ownerChanged({ family: 'Họ Dương', role: 'prev', name: 'Người Mới', reclaimUntil: new Date('2027-03-01T00:00:00Z'), url: 'https://g.test/#/duong/cai-dat-dong-ho' }),
  T.claimStarted({ family: 'Họ Dương', claimant: 'Thành viên', deadline: new Date('2026-12-30T00:00:00Z'), url: 'https://g.test/#/duong/cai-dat-dong-ho' }),
  T.contribution({ family: 'Họ Dương', approved: true, personName: 'Dương Văn A', url: 'https://g.test/#/duong/tree' }),
  T.contribution({ family: 'Họ Dương', approved: false, reason: 'Thiếu nguồn', url: null }),
  T.joinDecision({ family: 'Họ Dương', approved: true, url: 'https://g.test/#/duong/tree' }),
  T.joinDecision({ family: 'Họ Dương', approved: false, url: 'https://g.test/#/duong/tree' }),
];

test('every template has a Vietnamese subject, an html and a text body, and no raw markup from data', () => {
  for (const m of sample()) {
    assert.ok(m.subject && m.subject.length < 200, 'subject');
    assert.match(m.html, /^<!doctype html>/);
    assert.ok(m.text.length > 40);
    assert.match(m.text, /[ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/i, 'Vietnamese text');
    assert.ok(!/<script/i.test(m.html));
  }
  const inv = T.trustedInvite({ family: 'Họ <Dương>', inviter: 'Chủ "họ"', name: 'Cô & Chú', url: 'https://g.test/#/trusted/abc' });
  assert.ok(inv.html.includes('Họ &lt;Dương&gt;'), 'family name escaped');
  assert.ok(inv.html.includes('Chủ &quot;họ&quot;'), 'inviter escaped');
  assert.ok(inv.html.includes('Cô &amp; Chú'), 'name escaped');
  assert.ok(!inv.html.includes('Họ <Dương>'));
});

test('the 600 px card and a single link button per action mail', () => {
  const m = T.handoverOffer({ family: 'Họ Dương', expiresAt: new Date('2026-12-15T00:00:00Z'), url: 'https://g.test/#/offer/tok' });
  assert.match(m.html, /width="600"/);
  assert.ok(m.html.includes('href="https://g.test/#/offer/tok"'));
  assert.match(m.text, /hết hạn lúc 15\/12\/2026 07:00 \(giờ Việt Nam\)/, 'deadline shown in Vietnam time');
});

test('no template output contains the API key (even when one is configured)', () => {
  const prev = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = FAKE_KEY;
  try {
    for (const m of sample()) {
      assert.ok(!m.html.includes(FAKE_KEY) && !m.text.includes(FAKE_KEY) && !m.subject.includes(FAKE_KEY));
    }
  } finally { if (prev === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = prev; }
});

test('the Brevo request: POST /v3/smtp/email with the api-key header, sender from env, html and text (fetch stubbed)', async () => {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ messageId: '<m1@brevo>' }), { status: 201 }); };
  Object.assign(process.env, { BREVO_API_KEY: FAKE_KEY, MAIL_FROM: 'noreply@example.test', MAIL_FROM_NAME: 'Gia phả' });
  mail.setTransport(null); // the real Brevo transport
  try {
    const out = await runSend(null);
    assert.strictEqual(out.status, 'sent');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.strictEqual(calls[0].init.method, 'POST');
    assert.strictEqual(calls[0].init.headers['api-key'], FAKE_KEY);
    const body = JSON.parse(calls[0].init.body);
    assert.deepStrictEqual(body.sender, { email: 'noreply@example.test', name: 'Gia phả' });
    assert.deepStrictEqual(body.to, [{ email: 'to@example.test' }]);
    assert.ok(body.htmlContent && body.textContent && body.subject);
  } finally {
    globalThis.fetch = saved.fetch; process.env = saved.env; mail.setTransport(null);
  }
});

test('a Brevo error is logged without the key or the response body', async () => {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } };
  globalThis.fetch = async () => new Response(`bad key ${FAKE_KEY}`, { status: 401 });
  Object.assign(process.env, { BREVO_API_KEY: FAKE_KEY, MAIL_FROM: 'noreply@example.test' });
  mail.setTransport(null);
  try {
    const seen = [];
    const pool = fakePool(seen);
    const out = await mail.send(pool, { kind: 'test', to: 'to@example.test', subject: 'S', html: '<p>x</p>', text: 'x' });
    assert.strictEqual(out.status, 'failed');
    const logged = JSON.stringify(seen);
    assert.ok(!logged.includes(FAKE_KEY), 'the key is never in the log');
    assert.match(logged, /Brevo trả lỗi 401/);
  } finally { globalThis.fetch = saved.fetch; process.env = saved.env; mail.setTransport(null); }
});

test('without BREVO_API_KEY nothing is sent: the attempt is logged as skipped', async () => {
  const saved = { env: { ...process.env } };
  delete process.env.BREVO_API_KEY; process.env.MAIL_FROM = 'noreply@example.test';
  let called = 0;
  mail.setTransport(async () => { called++; return {}; });
  try {
    const seen = [];
    const out = await mail.send(fakePool(seen), { kind: 'test', to: 'to@example.test', subject: 'S', html: '', text: '' });
    assert.strictEqual(out.status, 'skipped');
    assert.strictEqual(called, 0);
    assert.match(JSON.stringify(seen), /BREVO_API_KEY chưa đặt/);
  } finally { process.env = saved.env; mail.setTransport(null); }
});

test('an address that is not an email is not sent and not logged', async () => {
  const seen = [];
  assert.strictEqual((await mail.send(fakePool(seen), { kind: 'x', to: 'khong-phai-email', subject: 'S', html: '', text: '' })).status, 'invalid');
  assert.strictEqual(seen.length, 0);
});

// ---- the DB-backed log (scratch database) ----
let pool;
test.before(async () => {
  if (skipDb) return;
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: URL_, max: 2 });
  for (const f of ['010_mail.sql']) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
});
test.after(async () => { if (pool) await pool.end(); });

test('send logs every attempt in mail_log, a sent message once per dedupe key, and never the key', { skip: skipDb }, async () => {
  const saved = { env: { ...process.env } };
  Object.assign(process.env, { BREVO_API_KEY: FAKE_KEY, MAIL_FROM: 'noreply@example.test' });
  const sent = [];
  mail.setTransport(async ({ body }) => { sent.push(body); return { messageId: 'fake-' + sent.length }; });
  const tag = crypto.randomBytes(4).toString('hex');
  const key = `test-once:${tag}`;
  try {
    const built = []; const build = async () => { built.push(1); return { kind: 'test_once', to: `once.${tag}@example.test`, ...T.joinDecision({ family: 'Họ thử', approved: true, url: 'https://g.test' }) }; };
    assert.strictEqual((await mail.sendOnce(pool, key, build)).status, 'sent');
    assert.strictEqual((await mail.sendOnce(pool, key, build)).status, 'duplicate', 'a sent notice is not sent again');
    assert.strictEqual(built.length, 1, 'the message is not even built again');
    const { rows } = await pool.query("select status, provider_id, to_email, error from mail_log where dedupe_key=$1", [key]);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, 'sent');
    assert.strictEqual(rows[0].provider_id, 'fake-1');
    assert.ok(!JSON.stringify(rows).includes(FAKE_KEY));
    assert.strictEqual(sent.length, 1);
  } finally {
    process.env = saved.env; mail.setTransport(null);
    await pool.query('delete from mail_log where dedupe_key=$1', [key]);
  }
});

test('a skipped notice (no key) is retried later: sendOnce sends it once the key is there', { skip: skipDb }, async () => {
  const saved = { env: { ...process.env } };
  const tag = crypto.randomBytes(4).toString('hex');
  const key = `test-retry:${tag}`;
  delete process.env.BREVO_API_KEY; process.env.MAIL_FROM = 'noreply@example.test';
  mail.setTransport(async () => ({ messageId: 'retry-ok' }));
  try {
    const build = async () => ({ kind: 'test_retry', to: `retry.${tag}@example.test`, subject: 'S', html: '', text: 'x' });
    assert.strictEqual((await mail.sendOnce(pool, key, build)).status, 'skipped');
    process.env.BREVO_API_KEY = FAKE_KEY;
    assert.strictEqual((await mail.sendOnce(pool, key, build)).status, 'sent');
  } finally {
    process.env = saved.env; mail.setTransport(null);
    await pool.query('delete from mail_log where dedupe_key=$1', [key]);
  }
});

// Sends one test message through mail.send with a stub pool (no DB) for the request-shape tests.
function runSend(seen) {
  return mail.send(fakePool(seen || []), { kind: 'test', to: 'to@example.test', subject: 'Tiêu đề', html: '<p>Xin chào</p>', text: 'Xin chào' });
}
// Minimal stand-in for the pool: records the mail_log writes (insert returns an id; update records the status).
function fakePool(seen) {
  let n = 0;
  return {
    query: async (sql, params = []) => {
      seen.push({ sql: sql.slice(0, 30), params });
      if (/^\s*insert into mail_log/.test(sql)) return { rows: [{ id: ++n }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
}
