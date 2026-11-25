// Personal calendar feed (news-cal.js): pure rules (statuses, stable UIDs, no body text, the rate limit) and the feed over
// HTTP (DB, needs GP_TEST_DATABASE_URL, a SCRATCH database): token auth (wrong or revoked link: 404), content filtering
// (Đi = CONFIRMED, Chưa biết = TENTATIVE, Không đi and no answer are left out), giỗ dates of followed persons only,
// headers (noindex, private), the last fetch recorded for the Lịch prompt, and the poster's default Đi.
'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CAL = require('../news-cal');

// ---- pure ----
test('feed rules: Đi is CONFIRMED, Chưa biết TENTATIVE; stable UIDs; no body text or names in the event', () => {
  const now = new Date(2026, 10, 24);
  const rows = [
    { id: 7, title: 'Họp mặt hè', place: 'Nhà thờ họ', time: '09:00', starts_at: '2027-07-01', slug: 'duong', answer: 'yes' },
    { id: 8, title: 'Họp mặt thu', place: '', time: '', starts_at: '2027-10-01', slug: 'duong', answer: 'maybe' },
  ];
  const ev = CAL.gatheringEvents(rows, { host: 'giapha.example.test', base: 'https://giapha.example.test', now });
  assert.strictEqual(ev.length, 2);
  assert.match(ev[0], /UID:post-7@giapha\.example\.test/);
  assert.match(ev[0], /STATUS:CONFIRMED/);
  assert.match(ev[1], /STATUS:TENTATIVE/);
  assert.match(ev[0], /DTSTART;TZID=Asia\/Ho_Chi_Minh:20270701T090000/);
  assert.match(ev[1], /DTSTART;VALUE=DATE:20271001/);
  assert.ok(!ev.join('\n').includes('Nội dung'), 'no body text');
  assert.deepStrictEqual(CAL.gatheringEvents(rows, { host: 'giapha.example.test', base: 'https://giapha.example.test', now }), ev, 'same rows, same events');
});

test('feed rate limit: sixty requests in ten minutes per address, then refused', () => {
  const ip = '198.51.100.' + Math.floor(Math.random() * 200);
  const t0 = Date.now();
  for (let i = 0; i < CAL.RATE.max; i++) assert.strictEqual(CAL.rateLimited(ip, t0 + i), false);
  assert.strictEqual(CAL.rateLimited(ip, t0 + CAL.RATE.max), true);
  assert.strictEqual(CAL.rateLimited(ip, t0 + CAL.RATE.windowMs + 1e6), false, 'a new window starts after ten minutes');
});

test('feed tokens are stored only as a hash', () => {
  const t = crypto.randomBytes(32).toString('base64url');
  assert.strictEqual(t.length, 43);
  assert.match(CAL.sha(t), /^[0-9a-f]{64}$/);
  assert.notStrictEqual(CAL.sha(t), t);
});

// ---- routes (DB) ----
const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `cal-${TAG}`;
const E = (n) => `${n}.${TAG}@example.test`;
const O = E('owner'); const M1 = E('member'); const M2 = E('member2'); const F = E('fresh');
const ck = {}; let base; let pool; let close; const PID = 'P' + String(100000 + Math.floor(Math.random() * 800000));
const call = async (method, p, body, who) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(who ? { cookie: ck[who] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = JSON.parse(await r.text()); } catch {}
  return { status: r.status, json, headers: r.headers };
};
const q = (p) => `${p}${p.includes('?') ? '&' : '?'}family=${FAM}`;
const feedPath = (url) => new URL(url).pathname;
const feed = (p) => fetch(base + p).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.text() }));

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.BREVO_API_KEY = 'cal-test-key'; process.env.MAIL_FROM = 'cal-test@example.test';
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Lịch thử','public')", [FAM]);
  for (const [e, r] of [[O, 'owner'], [M1, 'member'], [M2, 'member'], [F, 'member']]) await pool.query("insert into members (email, name, family_id, role, status) values ($1,$2,$3,$4,'active')", [e, e.split('@')[0], FAM, r]);
  await pool.query("insert into persons (id, data, family_id) values ($1, '{\"name\":\"Thử\",\"sex\":\"m\",\"gen\":3,\"gio_lunar\":\"15/7\"}', $2)", [PID, FAM]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  for (const e of [O, M1, M2, F]) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, name: e.split('@')[0] }) });
    ck[e] = r.headers.get('set-cookie').split(';')[0];
  }
});
test.after(async () => {
  if (skip || !pool) return;
  await pool.query('delete from rsvps where post_id in (select id from posts where family_id = $1)', [FAM]).catch(() => {});
  await pool.query('delete from posts where family_id = $1', [FAM]).catch(() => {});
  await pool.query('delete from cal_tokens where family_id = $1', [FAM]).catch(() => {});
  await pool.query('delete from persons where family_id = $1', [FAM]).catch(() => {});
  await pool.query('delete from family_history where family_id = $1', [FAM]).catch(() => {});
  await pool.query('delete from members where family_id = $1', [FAM]).catch(() => {});
  await pool.query('delete from families where id = $1', [FAM]).catch(() => {});
  await close?.(); await pool.end().catch(() => {});
});

const gathering = async (title, date, who = O) => (await call('POST', q('/api/posts'), { kind: 'gathering', title, starts_at: date, place: 'Nhà thờ họ', body: 'Nội dung' }, who)).json.id;

test('feed auth: a link works without signing in; a wrong or replaced (revoked) link is 404', { skip }, async () => {
  const made = await call('POST', q('/api/cal-token'), { follows: [] }, M1);
  assert.strictEqual(made.status, 200);
  const path1 = feedPath(made.json.url);
  assert.match(path1, /^\/cal\/[A-Za-z0-9_-]{43}\.ics$/);
  assert.strictEqual((await feed(path1)).status, 200, 'no cookie needed');
  assert.strictEqual((await feed('/cal/' + 'x'.repeat(43) + '.ics')).status, 404, 'wrong token');
  const stored = (await pool.query('select token_hash from cal_tokens where family_id = $1', [FAM])).rows;
  assert.ok(!JSON.stringify(stored).includes(path1.slice(5, -4)), 'the token itself is not stored');
  const again = await call('POST', q('/api/cal-token'), { follows: [] }, M1);
  assert.strictEqual((await feed(path1)).status, 404, 'the replaced link is revoked');
  assert.strictEqual((await feed(feedPath(again.json.url))).status, 200);
});

test('feed headers: noindex and private; the calendar type', { skip }, async () => {
  const made = await call('POST', q('/api/cal-token'), { follows: [] }, O);
  const r = await feed(feedPath(made.json.url));
  assert.strictEqual(r.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.strictEqual(r.headers.get('cache-control'), 'private');
  assert.match(r.headers.get('content-type'), /^text\/calendar/);
  assert.match(r.body, /^BEGIN:VCALENDAR\r\n/);
});

test('feed content: Đi and Chưa biết are in (CONFIRMED / TENTATIVE); Không đi and no answer are left out; the poster is Đi', { skip }, async () => {
  const g1 = await gathering('Họp mặt một', '2027-07-01');
  const g2 = await gathering('Họp mặt hai', '2027-08-01');
  const g3 = await gathering('Họp mặt ba', '2027-09-01');
  await gathering('Họp mặt bốn', '2027-10-01');
  await call('POST', q(`/api/posts/${g1}/rsvp`), { answer: 'yes' }, M1);
  await call('POST', q(`/api/posts/${g2}/rsvp`), { answer: 'maybe' }, M1);
  await call('POST', q(`/api/posts/${g3}/rsvp`), { answer: 'no' }, M1);
  const made = await call('POST', q('/api/cal-token'), { follows: [] }, M1);
  const body = (await feed(feedPath(made.json.url))).body;
  assert.match(body, new RegExp(`UID:post-${g1}@[^\\r]+\\r\\nDTSTAMP[^\\r]*\\r\\nSTATUS:CONFIRMED`));
  assert.match(body, new RegExp(`UID:post-${g2}@[^\\r]+\\r\\nDTSTAMP[^\\r]*\\r\\nSTATUS:TENTATIVE`));
  assert.ok(!body.includes(`post-${g3}@`), 'Không đi is left out');
  assert.strictEqual((body.match(/BEGIN:VEVENT/g) || []).length, 2 + (body.match(/UID:gio-/g) || []).length, 'two gatherings and the giỗ dates only');
  assert.ok(!body.includes('Nội dung'), 'no body text');
  const owner = await call('POST', q('/api/cal-token'), { follows: [] }, O);
  const obody = (await feed(feedPath(owner.json.url))).body;
  assert.match(obody, /UID:post-\d+@[^\r]+\r\nDTSTAMP[^\r]*\r\nSTATUS:CONFIRMED/, 'the poster is Đi by default');
});

test('feed giỗ: only followed persons, two years, stable UIDs (person id and year), no name in the event', { skip }, async () => {
  const made = await call('POST', q('/api/cal-token'), { follows: [] }, M2);
  const pth = feedPath(made.json.url);
  assert.ok(!(await feed(pth)).body.includes('UID:gio-'), 'not followed, no giỗ dates');
  await call('PUT', q('/api/cal-token/follows'), { follows: [PID] }, M2);
  const y0 = new Date().getFullYear();
  const body1 = (await feed(pth)).body; const body2 = (await feed(pth)).body;
  assert.ok(body1.includes(`UID:gio-${PID}-${y0 + 1}@`), 'the next year is in');
  assert.ok(!body1.includes(`UID:gio-${PID}-${y0 + 3}@`), 'not beyond two years');
  assert.deepStrictEqual(body1.match(/UID:[^\r]+/g), body2.match(/UID:[^\r]+/g), 'stable UIDs between fetches');
  assert.ok(!body1.includes('Thử'), 'the name is not in the event');
});

test('Lịch prompt: a recorded feed fetch means subscribed; before the first fetch the link exists but is not subscribed', { skip }, async () => {
  assert.strictEqual((await call('GET', q('/api/cal-token'), undefined, F)).json.exists, false, 'no link yet');
  const made = await call('POST', q('/api/cal-token'), { follows: [] }, F);
  const before = await call('GET', q('/api/cal-token'), undefined, F);
  assert.strictEqual(before.json.exists, true);
  assert.strictEqual(before.json.subscribed, false, 'no fetch recorded: the prompt may show');
  await feed(feedPath(made.json.url));
  const after = await call('GET', q('/api/cal-token'), undefined, F);
  assert.strictEqual(after.json.subscribed, true);
  assert.ok(after.json.last_fetch_at);
});
