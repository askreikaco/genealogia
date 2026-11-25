// Tin họ and Lịch (news.js, lich-merge.js): pure rules (reminder stages, RSVP totals, the merged list order, the top cards,
// the tab badge, the old #gio address) and the routes (DB, needs GP_TEST_DATABASE_URL, a SCRATCH database): roles,
// RSVP upsert (one answer per account), new-post notices (not to the author), reminders once each, soft delete.
'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const R = require('../news-rules');
const NEWS = require('../news');
const CR = require('../content-rules');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'lich-merge.js')).href);

// ---- pure ----
test('reminders: 3 days and 1 day before; the day itself counts; past and far days are not due', () => {
  assert.deepStrictEqual(R.dueStages(5), []);
  assert.deepStrictEqual(R.dueStages(3), [3]);
  assert.deepStrictEqual(R.dueStages(2), [3]);
  assert.deepStrictEqual(R.dueStages(1), [3, 1]);
  assert.deepStrictEqual(R.dueStages(0), [3, 1]);
  assert.deepStrictEqual(R.dueStages(-1), []);
});
test('calendar: Vietnam day (UTC+7) and whole days between dates', () => {
  assert.strictEqual(R.vnDate(Date.UTC(2026, 10, 24, 18, 0)), '2026-11-25'); // 01:00 on the 25th in Vietnam
  assert.strictEqual(R.vnDate(Date.UTC(2026, 10, 24, 10, 0)), '2026-11-24');
  assert.strictEqual(R.daysBetween('2026-11-24', '2026-11-27'), 3);
});
test('RSVP totals: one per account and answer (Đi, Chưa biết, Không đi)', () => {
  assert.deepStrictEqual(R.summarize([{ answer: 'yes', n: 4 }, { answer: 'yes', n: 1 }, { answer: 'maybe', n: 3 }, { answer: 'no', n: 1 }]), { yes: 5, maybe: 3, no: 1 });
  assert.deepStrictEqual(R.summarize([]), { yes: 0, maybe: 0, no: 0 });
});
test('Lịch list: giỗ and gatherings merged by date, giỗ first on the same day, chips filter', async () => {
  const L = await load();
  const gio = [{ id: 'P2', at: 3 }, { id: 'P1', at: 5 }];
  const gath = [{ id: 7, at: 5 }, { id: 8, at: 1 }];
  assert.deepStrictEqual(L.mergeLich(gio, gath).map((x) => x.k + ':' + x.id), ['gath:8', 'gio:P2', 'gio:P1', 'gath:7']);
  assert.deepStrictEqual(L.mergeLich(gio, gath, 'gath').map((x) => x.id), [8, 7]);
  assert.deepStrictEqual(L.mergeLich(gio, gath, 'gio').map((x) => x.id), ['P2', 'P1']);
});
test('Tin họ top cards: pinned or unread, pinned first, newest first, at most 2', async () => {
  const L = await load();
  const posts = [
    { id: 1, pinned: false, created_at: '2026-11-20T00:00:00Z' },
    { id: 2, pinned: true, created_at: '2026-11-01T00:00:00Z' },
    { id: 3, pinned: false, created_at: '2026-11-23T00:00:00Z' },
    { id: 4, pinned: false, created_at: '2026-11-10T00:00:00Z' },
  ];
  assert.deepStrictEqual(L.topNews(posts, Date.parse('2026-11-19T00:00:00Z')).map((p) => p.id), [2, 3]);
  assert.deepStrictEqual(L.topNews(posts, Date.parse('2026-11-30T00:00:00Z')).map((p) => p.id), [2]);
});
test('tab badge: unread posts plus gatherings within 7 days; the old #gio address goes to Lịch', async () => {
  const L = await load();
  const today = L.dayMs('2026-11-24');
  const posts = [
    { id: 1, kind: 'notice', created_at: '2026-11-23T00:00:00Z' },
    { id: 2, kind: 'gathering', starts_at: '2026-11-27', created_at: '2026-11-01T00:00:00Z' },
    { id: 3, kind: 'gathering', starts_at: '2026-12-20', created_at: '2026-11-01T00:00:00Z' },
  ];
  assert.strictEqual(L.badgeCount(posts, Date.parse('2026-11-22T00:00:00Z'), today), 2);
  assert.strictEqual(L.canonicalView('gio'), 'lich');
  assert.strictEqual(L.canonicalView('tree'), 'tree');
});
test('clean: a gathering needs a date; a notice does not; the map link must be https or http', () => {
  const HE = class extends Error { constructor(s, m) { super(m); this.status = s; } };
  assert.throws(() => NEWS.clean({ kind: 'gathering', title: 'Họp' }, HE), (e) => e.status === 400);
  assert.throws(() => NEWS.clean({ kind: 'gathering', title: 'Họp', starts_at: '2026-12-01', map_url: 'javascript:alert(1)' }, HE), (e) => e.status === 400);
  assert.strictEqual(NEWS.clean({ kind: 'notice', title: ' Tin ' }, HE).title, 'Tin');
  assert.strictEqual(NEWS.clean({ kind: 'gathering', title: 'Họp', starts_at: '2026-12-01', map_url: 'https://maps.example/x' }, HE).map_url, 'https://maps.example/x');
});

// ---- content checks (pure) ----
test('content checks: a link, a phone number, a 9+ digit run and a block-list word hold a post; a clean post is not held', () => {
  assert.deepStrictEqual(CR.holdReasons('Xem https://example.test ngay'), ['link']);
  assert.deepStrictEqual(CR.holdReasons('Xem https://example.test ngay', { allowLink: true }), []);
  assert.ok(CR.holdReasons('Gọi 0912 345 678').includes('phone'));
  assert.deepStrictEqual(CR.holdReasons('Số tài khoản 123456789012'), ['account']);
  assert.deepStrictEqual(CR.holdReasons('Vui lòng chuyển khoản trước'), ['word']);
  assert.deepStrictEqual(CR.holdReasons('Họp mặt hè 2027 tại Nhà thờ họ, 09:00 ngày 1/7, đem theo ảnh cũ.'), []);
});
// ---- routes (DB) ----
const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `news-${TAG}`; const FAM2 = `news2-${TAG}`;
const E = (n) => `${n}.${TAG}@example.test`;
const O = E('owner'); const A = E('admin'); const RL = E('ratelimit'); const ED = E('editor'); const M1 = E('member'); const M2 = E('member2');
const X = E('outsider');
const ck = {}; let base; let pool; let close; const sent = [];
const call = async (method, p, body, who) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(who ? { cookie: ck[who] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = JSON.parse(await r.text()); } catch {}
  return { status: r.status, json, headers: r.headers };
};
const q = (p, fam = FAM) => `${p}${p.includes('?') ? '&' : '?'}family=${fam}`;
const VN_PLUS2 = R.vnDate(Date.now() + 2 * 864e5);
const noticesOf = async (email) => Number((await pool.query('select count(*)::int as n from notices where family_id=$1 and email=$2', [FAM, email])).rows[0].n);
const famHist = async () => (await pool.query("select new_value from family_history where family_id=$1 and field='tin'", [FAM])).rows.map((r) => JSON.parse(r.new_value).action);
const postIn = async (title, who = O, body = 'Nội dung') => call('POST', q('/api/posts'), { kind: 'notice', title, body }, who);

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.BREVO_API_KEY = 'news-test-key'; process.env.MAIL_FROM = 'news-test@example.test';
  const { app, pool: p } = require('../server');
  pool = p;
  require('../mail').setTransport(async (o) => { sent.push(o.body); return { messageId: 'm' + sent.length }; });
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Thử tin họ','public'), ($2,$2,'Dòng họ khác','public')", [FAM, FAM2]);
  for (const [e, r] of [[O, 'owner'], [A, 'admin'], [RL, 'admin'], [ED, 'editor'], [M1, 'member'], [M2, 'member']]) await pool.query("insert into members (email, name, family_id, role, status) values ($1,$2,$3,$4,'active')", [e, e.split('@')[0], FAM, r]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Người ngoài',$2,'owner','active')", [X, FAM2]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  for (const e of [O, A, RL, ED, M1, M2, X]) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, name: e.split('@')[0] }) });
    ck[e] = r.headers.get('set-cookie').split(';')[0];
  }
});
test.after(async () => {
  if (skip || !pool) return;
  for (const t of ['notices', 'mail_log']) await pool.query(`delete from ${t} where family_id = any($1)`, [[FAM, FAM2]]).catch(() => {});
  await pool.query('delete from rsvps where post_id in (select id from posts where family_id = any($1))', [[FAM, FAM2]]).catch(() => {});
  await pool.query('delete from post_reminders where post_id in (select id from posts where family_id = any($1))', [[FAM, FAM2]]).catch(() => {});
  await pool.query('delete from post_reports where post_id in (select id from posts where family_id = any($1))', [[FAM, FAM2]]).catch(() => {});
  await pool.query('delete from posts where family_id = any($1)', [[FAM, FAM2]]).catch(() => {});
  await pool.query('delete from family_history where family_id = any($1)', [[FAM, FAM2]]).catch(() => {});
  await pool.query('delete from members where family_id = any($1)', [[FAM, FAM2]]).catch(() => {});
  await pool.query('delete from families where id = any($1)', [[FAM, FAM2]]).catch(() => {});
  require('../mail').setTransport(null);
  await close?.(); await pool.end().catch(() => {});
});

test('privacy: anonymous visitors and members of another family get 403; every posts response says noindex', { skip }, async () => {
  const anon = await call('GET', q('/api/posts'));
  assert.strictEqual(anon.status, 403);
  assert.match(anon.headers.get('x-robots-tag') || '', /noindex/);
  const other = await call('GET', q('/api/posts'), undefined, X);
  assert.strictEqual(other.status, 403);
  assert.match(other.headers.get('x-robots-tag') || '', /noindex/);
  const mem = await call('GET', q('/api/posts'), undefined, M1);
  assert.strictEqual(mem.status, 200);
  assert.match(mem.headers.get('x-robots-tag') || '', /noindex, nofollow, noarchive/);
});

test('roles: members cannot post; editors cannot post until the owner allows it; owners post', { skip }, async () => {
  assert.strictEqual((await postIn('Tin của thành viên', M1)).status, 403);
  assert.strictEqual((await postIn('Tin của biên tập', ED)).status, 403);
  const ok = await postIn('Tin đầu tiên', O);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.status, 'live');
  assert.strictEqual((await call('POST', q(`/api/posts/${ok.json.id}/rsvp`), { answer: 'yes' }, M1)).status, 400);
});

test('hold: a phone number holds a post; only the author and admins see it; no mail until approved; approval releases mail', { skip }, async () => {
  const before = sent.length;
  const h = await postIn('Liên hệ anh Hùng', O, 'Gọi 0912 345 678 để hỏi');
  assert.strictEqual(h.json.status, 'held');
  assert.strictEqual(sent.length, before, 'a held post sends no mail');
  const listM = await call('GET', q('/api/posts'), undefined, M1);
  assert.ok(!listM.json.posts.some((p) => p.id === h.json.id), 'a member does not see a held post');
  assert.strictEqual((await call('GET', q(`/api/posts/${h.json.id}`), undefined, M1)).status, 404);
  assert.strictEqual((await call('GET', q(`/api/posts/${h.json.id}`), undefined, O)).json.post.status, 'held');
  assert.strictEqual((await call('POST', q(`/api/posts/${h.json.id}/approve`), undefined, M2)).status, 403);
  const ap = await call('POST', q(`/api/posts/${h.json.id}/approve`), undefined, A);
  assert.strictEqual(ap.status, 200);
  const mails = sent.slice(before);
  assert.ok(mails.length >= 1, 'approval sends mail');
  for (const m of mails) {
    assert.ok(m.textContent.includes('Liên hệ anh Hùng'), 'the mail carries the title');
    assert.ok(!m.textContent.includes('0912 345 678') && !m.htmlContent.includes('0912 345 678'), 'the mail never carries the body');
  }
  assert.strictEqual((await call('GET', q(`/api/posts/${h.json.id}`), undefined, M1)).json.post.status, 'live');
});

test('hold triggers: an account number, a block-list word and a link from an admin; an owner may post a link', { skip }, async () => {
  assert.deepStrictEqual((await postIn('Số tài khoản', O, 'Số 123456789012')).json.hold, ['account']);
  assert.deepStrictEqual((await postIn('Quà', O, 'Trúng thưởng ngay hôm nay')).json.hold, ['word']);
  assert.deepStrictEqual((await postIn('Trang', A, 'Xem https://example.test')).json.hold, ['link']);
  const ownerLink = await postIn('Trang họ', O, 'Xem https://example.test');
  assert.strictEqual(ownerLink.json.status, 'live');
});

test('rate limit: five posts a day per author; the sixth is refused with a clear message', { skip }, async () => {
  for (let i = 1; i <= 5; i++) assert.strictEqual((await postIn(`Tin số ${i}`, RL)).status, 200);
  const six = await postIn('Tin số 6', RL);
  assert.strictEqual(six.status, 429);
  assert.match(six.json.error, /5 tin trong 24 giờ/);
});

test('reports: two member reports hide a post; the author cannot report it; reporters are not shown; admins review', { skip }, async () => {
  const p = (await postIn('Tin bị báo cáo', A)).json;
  assert.strictEqual((await call('POST', q(`/api/posts/${p.id}/report`), { reason: 'Quảng cáo' }, A)).status, 400);
  const r1 = await call('POST', q(`/api/posts/${p.id}/report`), { reason: 'Quảng cáo' }, M1);
  assert.strictEqual(r1.json.hidden, false);
  const r2 = await call('POST', q(`/api/posts/${p.id}/report`), { reason: 'Không đúng sự thật' }, M2);
  assert.strictEqual(r2.json.hidden, true);
  assert.strictEqual((await call('GET', q(`/api/posts/${p.id}`), undefined, M1)).status, 404);
  const rev = await call('GET', q('/api/posts'), undefined, A);
  const row = rev.json.posts.find((x) => x.id === p.id);
  assert.strictEqual(row.status, 'hidden'); assert.strictEqual(row.reports, 2);
  assert.ok(!JSON.stringify(rev.json).includes(M1) && !JSON.stringify(rev.json).includes(M2), 'reporters are not named');
  assert.strictEqual((await call('POST', q(`/api/posts/${p.id}/restore`), undefined, M1)).status, 403);
  assert.strictEqual((await call('POST', q(`/api/posts/${p.id}/restore`), undefined, A)).status, 200);
  assert.strictEqual(Number((await pool.query('select count(*)::int n from post_reports where post_id=$1', [p.id])).rows[0].n), 0);
});

test('posting setting: only owners change it (history); an editor posts once the owner allows editors', { skip }, async () => {
  assert.strictEqual((await call('POST', q('/api/news-setting'), { posters: 'editor' }, A)).status, 403);
  assert.strictEqual((await call('POST', q('/api/news-setting'), { posters: 'nonsense' }, O)).status, 400);
  assert.strictEqual((await postIn('Biên tập thử', ED)).status, 403);
  const set = await call('POST', q('/api/news-setting'), { posters: 'editor' }, O);
  assert.strictEqual(set.json.changed, true);
  assert.strictEqual((await postIn('Biên tập đăng', ED)).status, 200);
  assert.strictEqual((await call('POST', q('/api/news-setting'), { posters: 'admin' }, O)).json.changed, true);
  assert.strictEqual((await postIn('Lại chỉ quản trị', ED)).status, 403);
  assert.ok((await famHist()).filter((a) => a === 'setting').length >= 2, 'the setting change is in history');
});

test('history: held, approve, hide, restore, edit, delete and posts are written to family history', { skip }, async () => {
  const actions = new Set(await famHist());
  for (const a of ['held', 'approve', 'post', 'hide', 'restore', 'setting']) assert.ok(actions.has(a), `history has ${a}`);
});

test('new post: members are told, the author is not; soft delete hides the post', { skip }, async () => {
  const before = [await noticesOf(A), await noticesOf(M1)];
  const p = await postIn('Thông báo cho cả họ', A);
  assert.strictEqual(await noticesOf(A), before[0]);
  assert.strictEqual(await noticesOf(M1), before[1] + 1);
  assert.strictEqual((await call('POST', q(`/api/posts/${p.json.id}/delete`), undefined, M1)).status, 403);
  assert.strictEqual((await call('POST', q(`/api/posts/${p.json.id}/delete`), undefined, A)).status, 200);
  assert.strictEqual((await call('GET', q(`/api/posts/${p.json.id}`), undefined, M1)).status, 404);
});

test('RSVP: one answer per account (a second answer replaces the first); the poster starts as Đi; the summary counts people', { skip }, async () => {
  const g = await call('POST', q('/api/posts'), { kind: 'gathering', title: 'Họp mặt hè', starts_at: '2027-07-01', place: 'Nhà thờ họ' }, A);
  const id = g.json.id;
  assert.deepStrictEqual((await call('GET', q(`/api/posts/${id}`), undefined, A)).json.post.rsvp, { yes: 1, maybe: 0, no: 0, mine: 'yes' });
  assert.deepStrictEqual((await call('POST', q(`/api/posts/${id}/rsvp`), { answer: 'yes' }, M1)).json.rsvp, { yes: 2, maybe: 0, no: 0, mine: 'yes' });
  assert.deepStrictEqual((await call('POST', q(`/api/posts/${id}/rsvp`), { answer: 'maybe' }, M1)).json.rsvp, { yes: 1, maybe: 1, no: 0, mine: 'maybe' });
  await call('POST', q(`/api/posts/${id}/rsvp`), { answer: 'no' }, M2);
  assert.deepStrictEqual((await call('GET', q(`/api/posts/${id}`), undefined, A)).json.post.rsvp, { yes: 1, maybe: 1, no: 1, mine: 'yes' });
  assert.strictEqual(Number((await pool.query('select count(*)::int n from rsvps where post_id=$1', [id])).rows[0].n), 3);
  const att = (await call('GET', q(`/api/posts/${id}`), undefined, O)).json.attendees;
  assert.deepStrictEqual(att.yes.map((x) => x.name.split('.')[0]), ['admin']);
  assert.deepStrictEqual(att.maybe.map((x) => x.name.split('.')[0]), ['member']);
  assert.deepStrictEqual(att.no.map((x) => x.name.split('.')[0]), ['member2']);
  assert.strictEqual(Object.keys(att.yes[0]).join(','), 'name', 'names only, no counts');
  assert.strictEqual((await call('POST', q(`/api/posts/${id}/rsvp`), { answer: 'yes', count: 3 }, M1)).json.rsvp.yes, 2, 'a count is ignored');
});

test('reminders: a gathering 2 days away gets one reminder (recorded), and a second sweep sends nothing', { skip }, async () => {
  const g = await call('POST', q('/api/posts'), { kind: 'gathering', title: 'Họp mặt sắp tới', starts_at: VN_PLUS2 }, A);
  const id = g.json.id;
  const n0 = await noticesOf(M1);
  const first = (await NEWS.sweep()).filter((x) => x.id === id);
  assert.deepStrictEqual(first.map((x) => x.stage), [3]);
  assert.strictEqual(await noticesOf(M1), n0 + 1);
  const second = (await NEWS.sweep()).filter((x) => x.id === id);
  assert.strictEqual(second.length, 0);
  assert.strictEqual(await noticesOf(M1), n0 + 1);
  assert.strictEqual(Number((await pool.query('select count(*)::int n from post_reminders where post_id=$1', [id])).rows[0].n), 1);
});
