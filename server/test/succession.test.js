// Integration tests for succession: trusted contacts, inactivity reminders and notice, offers with email codes,
// reclaim, member claims, death reports, family creation, join and contribution notices.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
// Time is injected: the engine takes `now`; routes use the real clock, so the timeline stays ahead of the real clock.
// Brevo is replaced by a fake transport that records every message (nothing is sent). The key is a fake string.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAKE_KEY = 'xkeys-FAKE-succession-' + TAG;
const E = (who) => `${who}.${TAG}@example.test`;
const DAY = 864e5;
const T0 = Date.now();

let base, pool, srv, S, R, mail;
const sent = [];        // every message the fake transport got: { to, subject, text, html }
const cookies = {};
const F = {};           // families by key: { id, slug, name }
const cleanupFamilies = new Set();
const addMonths = (ms, n) => R.addMonths(ms, n);

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
async function sessionFor(email, name) {
  const r = await call('POST', '/api/test/session', { email, name });
  assert.strictEqual(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
async function newFamily(key, { owner = 365, visibility = 'public', months = 12 } = {}) {
  const id = `s${key}${TAG}`.toLowerCase();
  await pool.query('insert into families (id, slug, name, han, visibility, owner_inactive_months) values ($1,$1,$2,$3,$4,$5)', [id, `Họ thử ${key} ${TAG}`, '楊', visibility, months]);
  cleanupFamilies.add(id);
  F[key] = { id, slug: id, name: `Họ thử ${key} ${TAG}` };
  return F[key];
}
async function member(fam, email, role, { approvedYearsAgo = 0, name = null } = {}) {
  await pool.query(`insert into members (email, name, role, status, family_id, approved_at, created_at) values ($1, $2, $3, 'active', $4,
    now() - ($5 || ' years')::interval, now())`, [email, name || email.split('.')[0], role, fam.id, String(approvedYearsAgo)]);
}
const ownerRow = async (fam) => (await pool.query("select * from members where family_id=$1 and role='owner' and status='active'", [fam.id])).rows[0];
const setLastSeen = (fam, when) => pool.query("update members set last_seen_at=$2 where family_id=$1 and role='owner' and status='active'", [fam.id, new Date(when)]);
const lastMail = (to, re) => [...sent].reverse().find((m) => m.to === to && re.test(m.subject + '\n' + m.text));
const tokenIn = (m) => /#(?:offer|trusted)\/([A-Za-z0-9_-]{20,})/.exec(m.text)?.[1];
const codeIn = (m) => /Mã của bạn là: (\d{6})/.exec(m.text)?.[1];
const kindsOf = async (fam) => (await pool.query('select kind from mail_log where family_id=$1 order by id', [fam.id])).rows.map((r) => r.kind);
const reqRow = async (fam) => (await pool.query('select * from handover_requests where family_id=$1 order by id desc limit 1', [fam.id])).rows[0];
const stageOf = async (req) => (await pool.query('select stage from handover_steps where request_id=$1 order by at desc, id desc limit 1', [req.id])).rows[0]?.stage;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  Object.assign(process.env, { BREVO_API_KEY: FAKE_KEY, MAIL_FROM: 'noreply@example.test', PUBLIC_URL: 'https://giapha.test' });
  const { app, pool: p } = require('../server');
  pool = p;
  S = require('../succession'); R = require('../succession-rules'); mail = require('../mail');
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  mail.setTransport(async ({ body }) => { sent.push({ to: body.to[0].email, subject: body.subject, text: body.textContent, html: body.htmlContent }); return { messageId: 'fake-' + sent.length }; });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(async () => {
  if (skip) return;
  mail.setTransport(null);
  const ids = [...cleanupFamilies];
  const emails = [...new Set([...sent.map((m) => m.to), `${TAG}`])];
  await pool.query('delete from mail_log where family_id = any($1) or to_email like $2', [ids, `%${TAG}%`]);
  await pool.query('delete from handover_steps where request_id in (select id from handover_requests where family_id = any($1))', [ids]);
  await pool.query('delete from handover_offers where request_id in (select id from handover_requests where family_id = any($1))', [ids]);
  await pool.query('delete from handover_requests where family_id = any($1)', [ids]);
  await pool.query('delete from trusted_contacts where family_id = any($1)', [ids]);
  await pool.query('delete from suggestions where family_id = any($1)', [ids]);
  await pool.query('delete from history where person_id in (select id from persons where family_id = any($1))', [ids]);
  await pool.query('delete from persons where family_id = any($1)', [ids]);
  await pool.query('delete from members where family_id = any($1) or email like $2', [ids, `%${TAG}%`]);
  await pool.query('delete from relation_migrations where family_id = any($1)', [ids]);
  await pool.query('delete from families where id = any($1)', [ids]);
  void emails;
  await pool.end(); await new Promise((r) => srv.close(r));
});

// ---- trusted contacts ----
test('owner invites up to three contacts; each gets an invite; limits and roles are enforced', { skip }, async () => {
  const fam = await newFamily('main');
  await member(fam, E('owner'), 'owner', { approvedYearsAgo: 3 });
  await member(fam, E('admin'), 'admin', { approvedYearsAgo: 2 });
  await member(fam, E('editor'), 'editor', { approvedYearsAgo: 1 });
  for (const w of ['m1', 'm2', 'm3', 'm4']) await member(fam, E(w), 'member');
  cookies.owner = await sessionFor(E('owner'), 'Chủ thử');
  cookies.admin = await sessionFor(E('admin'), 'Quản trị');
  cookies.m1 = await sessionFor(E('m1'), 'Thành viên một');
  cookies.stranger = await sessionFor(E('stranger'), 'Khách');
  const url = `/api/families/${fam.id}/trusted`;
  assert.strictEqual((await call('POST', url, { email: E('c1'), name: 'Cô Một' }, cookies.admin)).status, 403, 'admin cannot invite');
  assert.strictEqual((await call('POST', url, { email: E('c1'), name: 'Cô Một' }, cookies.m1)).status, 403, 'member cannot invite');
  assert.strictEqual((await call('POST', url, { email: E('c1'), name: 'Cô Một' })).status, 403, 'guest cannot invite');
  assert.strictEqual((await call('POST', url, { email: 'khong-phai-email' }, cookies.owner)).status, 400);
  assert.strictEqual((await call('POST', url, { email: E('owner') }, cookies.owner)).status, 409, 'the owner cannot be their own contact');
  assert.strictEqual((await call('POST', url, { email: E('c1'), name: 'Cô Một' }, cookies.owner)).status, 200);
  const c1 = lastMail(E('c1'), /Người được ủy thác/);
  assert.ok(c1, 'invite mail to C1');
  assert.match(c1.subject, /Mời bạn làm Người được ủy thác/);
  assert.strictEqual((await call('POST', url, { email: E('c1') }, cookies.owner)).status, 409, 'no duplicate');
  assert.strictEqual((await call('POST', url, { email: E('c2'), name: 'Chú Hai' }, cookies.owner)).status, 200);
  assert.strictEqual((await call('POST', url, { email: E('c3'), name: 'Bác Ba' }, cookies.owner)).status, 200);
  assert.strictEqual((await call('POST', url, { email: E('c4') }, cookies.owner)).status, 409, 'at most three');
  const list = (await call('GET', url, undefined, cookies.admin)).json.items;
  assert.deepStrictEqual(list.map((c) => c.status), ['invited', 'invited', 'invited']);
  assert.strictEqual((await call('GET', url, undefined, cookies.m1)).status, 403, 'members do not see contacts');
  F.main.tok1 = tokenIn(c1);
  F.main.tok2 = tokenIn(lastMail(E('c2'), /Người được ủy thác/));
  F.main.tok3 = tokenIn(lastMail(E('c3'), /Người được ủy thác/));
  assert.match(F.main.tok1, /^[A-Za-z0-9_-]{40,}$/);
  F.main.ids = list.map((c) => c.id);
});

test('a contact accepts with the invited Google account only', { skip }, async () => {
  const fam = F.main;
  assert.strictEqual((await call('POST', `/api/trusted/${fam.tok1}/accept`, {})).status, 401, 'needs a Google sign-in');
  cookies.wrong = await sessionFor(E('someone-else'), 'Người khác');
  assert.strictEqual((await call('POST', `/api/trusted/${fam.tok1}/accept`, {}, cookies.wrong)).status, 403);
  cookies.c1 = await sessionFor(E('c1'), 'Cô Một');
  const ok = await call('POST', `/api/trusted/${fam.tok1}/accept`, {}, cookies.c1);
  assert.strictEqual(ok.status, 200, ok.text);
  assert.strictEqual((await call('POST', `/api/trusted/${fam.tok1}/accept`, {}, cookies.c1)).json.already, true);
  const info = (await call('GET', `/api/trusted/${fam.tok1}`)).json;
  assert.strictEqual(info.status, 'accepted');
  assert.strictEqual(info.email.includes(E('c1')), false, 'the invite page never shows the full email');
  assert.strictEqual((await call('GET', '/api/trusted/not-a-real-token-0123456789abcdef')).status, 404);
});

test('order, resend, remove: the old link stops, the list keeps its order', { skip }, async () => {
  const fam = F.main;
  const url = `/api/families/${fam.id}/trusted`;
  const [id1, id2, id3] = fam.ids;
  assert.strictEqual((await call('POST', `${url}/order`, { ids: [id3, id1] }, cookies.owner)).status, 400, 'every contact must be in the new order');
  assert.strictEqual((await call('POST', `${url}/order`, { ids: [id3, id1, id2] }, cookies.owner)).status, 200);
  const order = (await call('GET', url, undefined, cookies.admin)).json.items.map((c) => c.id);
  assert.deepStrictEqual(order, [id3, id1, id2]);
  assert.strictEqual((await call('POST', `${url}/${id2}/resend`, {}, cookies.owner)).status, 200);
  const fresh = tokenIn(lastMail(E('c2'), /Người được ủy thác/));
  assert.notStrictEqual(fresh, fam.tok2);
  assert.strictEqual((await call('GET', `/api/trusted/${fam.tok2}`)).status, 404, 'the old link is dead');
  assert.strictEqual((await call('GET', `/api/trusted/${fresh}`)).json.status, 'invited');
  assert.strictEqual((await call('POST', `${url}/${id3}/remove`, {}, cookies.owner)).status, 200);
  assert.strictEqual((await call('GET', url, undefined, cookies.admin)).json.items.length, 2, 'removed contacts are not listed');
  assert.strictEqual((await call('POST', `${url}/${id3}/remove`, {}, cookies.owner)).status, 404);
  assert.strictEqual((await call('POST', url, { email: E('c4'), name: 'Người Bốn' }, cookies.owner)).status, 200, 'a freed place can be used again');
});

test('the owner banner shows until a contact or another admin is active; succession state by role', { skip }, async () => {
  const fam = F.main;
  const st = (await call('GET', `/api/families/${fam.id}/succession`, undefined, cookies.owner)).json;
  assert.strictEqual(st.owner_banner, false, 'an accepted contact exists');
  assert.strictEqual(st.is_owner, true);
  assert.strictEqual(st.inactive_months, 12);
  assert.deepStrictEqual(st.months_choices, [3, 6, 12, 18]);
  const m1 = (await call('GET', `/api/families/${fam.id}/succession`, undefined, cookies.m1)).json;
  assert.strictEqual(m1.contacts, undefined, 'members do not see the contacts');
  assert.strictEqual(m1.can_report, true);
  const guest = (await call('GET', `/api/families/${fam.id}/succession`)).json;
  assert.strictEqual(guest.can_report, false);
  assert.strictEqual(guest.handover, null);
  // a family with no contacts and only the owner: the banner shows
  const solo = await newFamily('solo');
  await member(solo, E('solo-owner'), 'owner');
  cookies.soloOwner = await sessionFor(E('solo-owner'), 'Chủ đơn');
  assert.strictEqual((await call('GET', `/api/families/${solo.id}/succession`, undefined, cookies.soloOwner)).json.owner_banner, true);
});

// ---- inactivity: reminder, notice, cancel by sign-in ----
test('a reminder one day before the due time goes once; the engine is safe to run again', { skip }, async () => {
  const fam = await newFamily('rem');
  await member(fam, E('rem-owner'), 'owner', { approvedYearsAgo: 2 });
  const due = T0 + 12 * 3600e3;
  await setLastSeen(fam, addMonths(due, -12));
  const before = sent.length;
  const st1 = await S.runEngine(pool, T0, { only: [fam.id] });
  assert.strictEqual(st1.reminders, 1);
  const m = lastMail(E('rem-owner'), /Còn 1 ngày/);
  assert.ok(m, 'the one-day reminder');
  assert.strictEqual(sent.length, before + 1);
  const st2 = await S.runEngine(pool, T0 + 60e3, { only: [fam.id] });
  assert.strictEqual(st2.reminders, 0, 'not sent again');
  assert.strictEqual(sent.length, before + 1);
  assert.deepStrictEqual(await kindsOf(fam), ['owner_reminder']);
});

test('inactive owner: a notice with 14 days; the owner signing in cancels it at once', { skip }, async () => {
  const fam = F.main;
  await setLastSeen(fam, addMonths(T0, -13));
  const st = await S.runEngine(pool, T0, { only: [fam.id] });
  assert.strictEqual(st.notices, 1);
  const req = await reqRow(fam);
  assert.strictEqual(req.status, 'open');
  assert.strictEqual(req.kind, 'inactive');
  assert.strictEqual(await stageOf(req), 'notice');
  assert.strictEqual(new Date(req.deadline_at).getTime(), T0 + 14 * DAY);
  const n = lastMail(E('owner'), /chuyển quyền Chủ họ sau 14 ngày/);
  assert.ok(n, 'the owner gets the notice');
  assert.match(n.text, /giờ Việt Nam/);
  await S.runEngine(pool, T0 + 60e3, { only: [fam.id] });
  assert.strictEqual((await reqRow(fam)).status, 'open', 'a second run does not start another');
  const seen = await call('GET', `/api/families/${fam.id}/succession`, undefined, cookies.owner);
  assert.strictEqual(seen.json.handover, null, 'signing in cancels');
  const after = await reqRow(fam);
  assert.strictEqual(after.status, 'cancelled');
  assert.strictEqual(await stageOf(after), 'cancelled');
});

// ---- offers: chain, codes, accept; reclaim ----
test('after 14 days the offer goes to the first accepted contact; the email code is needed; accepting moves the role', { skip }, async () => {
  const fam = F.main;
  const restart = T0 + DAY;
  await setLastSeen(fam, restart);
  const dueAt = addMonths(restart, 12) + 60e3;
  assert.strictEqual((await S.runEngine(pool, dueAt, { only: [fam.id] })).notices, 1);
  const noticeEnd = dueAt + 14 * DAY;
  assert.strictEqual((await S.runEngine(pool, noticeEnd + 60e3, { only: [fam.id] })).offers, 1);
  const offer = lastMail(E('c1'), /Bạn được mời nhận quyền/);
  assert.ok(offer, 'C1 is first: an accepted contact');
  assert.strictEqual(lastMail(E('admin'), /Bạn được mời nhận quyền/), undefined, 'admins come after the contact');
  const tok = tokenIn(offer);
  assert.strictEqual((await call('POST', `/api/offers/${tok}/code`)).status, 200);
  const code = codeIn(lastMail(E('c1'), /Mã xác nhận/));
  assert.match(code, /^\d{6}$/);
  assert.strictEqual((await call('POST', `/api/offers/${tok}/code`)).status, 429, 'one code a minute');
  const info = (await call('GET', `/api/offers/${tok}`)).json;
  assert.strictEqual(info.family, fam.name);
  assert.strictEqual(info.expired, false);
  assert.ok(!JSON.stringify(info).includes(E('c1')), 'the offer page shows a masked address');
  const wrong = code === '000000' ? '111111' : '000000';
  assert.strictEqual((await call('POST', `/api/offers/${tok}/accept`, { code: wrong })).status, 400, 'a wrong code');
  await pool.query("update handover_offers set code_expires_at = code_expires_at - interval '2 minutes' where token_hash=$1", [R.hashToken(tok)]);
  assert.strictEqual((await call('POST', `/api/offers/${tok}/code`)).status, 200, 'a new code after a minute');
  const code2 = codeIn(lastMail(E('c1'), /Mã xác nhận/));
  const acc = await call('POST', `/api/offers/${tok}/accept`, { code: code2 });
  assert.strictEqual(acc.status, 200, acc.text);
  assert.strictEqual(acc.json.owner, E('c1'));
  const owner = await ownerRow(fam);
  assert.strictEqual(owner.email, E('c1'), 'the contact is the owner now');
  const prev = (await pool.query('select role from members where family_id=$1 and email=$2', [fam.id, E('owner')])).rows[0];
  assert.strictEqual(prev.role, 'admin', 'the previous owner is an admin');
  const req = await reqRow(fam);
  assert.strictEqual(req.status, 'completed');
  assert.strictEqual(req.resolved_by, E('c1'));
  const done = (await pool.query("select data from handover_steps where request_id=$1 and stage='completed'", [req.id])).rows[0].data;
  assert.strictEqual(done.from, E('owner'));
  assert.strictEqual(done.to, E('c1'));
  assert.ok(lastMail(E('c1'), /Bạn là Chủ họ/), 'the new owner is told');
  assert.ok(lastMail(E('owner'), /đã chuyển cho/), 'the previous owner is told, with the 90 days');
  const offers = (await pool.query('select email, status from handover_offers where request_id=$1 order by position', [req.id])).rows;
  assert.deepStrictEqual(offers.map((o) => o.status), ['accepted', 'cancelled', 'cancelled']);
  cookies.ownerNow = cookies.owner;
});

test('the previous owner may take the role back within 90 days, once', { skip }, async () => {
  const fam = F.main;
  const st = (await call('GET', `/api/families/${fam.id}/succession`, undefined, cookies.owner)).json;
  assert.ok(st.reclaim && st.reclaim.until, 'the reclaim window is shown to the previous owner');
  assert.strictEqual(st.my_role, 'admin');
  assert.strictEqual((await call('POST', `/api/families/${fam.id}/reclaim`, {}, cookies.m1)).status, 403, 'only the previous owner');
  assert.strictEqual((await call('POST', `/api/families/${fam.id}/reclaim`, {}, cookies.owner)).status, 200);
  assert.strictEqual((await ownerRow(fam)).email, E('owner'));
  assert.strictEqual((await pool.query('select role from members where family_id=$1 and email=$2', [fam.id, E('c1')])).rows[0].role, 'admin');
  assert.strictEqual((await call('POST', `/api/families/${fam.id}/reclaim`, {}, cookies.owner)).status, 403, 'once');
  assert.ok(lastMail(E('c1'), /đã chuyển cho/), 'the contact is told it went back');
});

test('the reclaim window closes after 90 days (injected clock)', { skip }, async () => {
  const fam = await newFamily('win');
  await member(fam, E('win-owner'), 'owner', { approvedYearsAgo: 2 });
  await member(fam, E('win-c'), 'admin', { approvedYearsAgo: 1 });
  await pool.query("insert into trusted_contacts (family_id, email, name, status, priority, accepted_at) values ($1,$2,'C','accepted',1, now())", [fam.id, E('win-c-contact')]);
  const t = T0 + 40 * DAY;
  await setLastSeen(fam, addMonths(t, -13));
  await S.runEngine(pool, t, { only: [fam.id] });
  await S.runEngine(pool, t + 14 * DAY + 60e3, { only: [fam.id] });
  const tok = tokenIn(lastMail(E('win-c-contact'), /Bạn được mời nhận quyền/));
  const now1 = t + 14 * DAY + 2 * 60e3;
  await S.sendOfferCode(pool, tok, now1);
  const code = codeIn(lastMail(E('win-c-contact'), /Mã xác nhận/));
  await S.acceptOffer(pool, tok, code, now1);
  const done = (await reqRow(fam)).resolved_at;
  const resolved = new Date(done).getTime();
  const inside = await S.reclaimState(pool, fam, E('win-owner'), resolved + 89 * DAY);
  assert.strictEqual(inside.ok, true);
  await assert.rejects(() => S.reclaim(pool, fam, E('win-owner'), resolved + 91 * DAY), (e) => e.status === 410);
  assert.strictEqual((await ownerRow(fam)).email, E('win-c-contact'), 'the late reclaim did not change the owner');
});

// ---- member claim ----
test('no contacts, admins or editors: a member claims; members back it; the claimant becomes the owner', { skip }, async () => {
  const fam = await newFamily('claim');
  await member(fam, E('cl-owner'), 'owner', { approvedYearsAgo: 2 });
  for (const w of ['c-m1', 'c-m2', 'c-m3', 'c-m4']) await member(fam, E(w), 'member');
  for (const w of ['c-m1', 'c-m2', 'c-m3', 'c-m4']) cookies[w] = await sessionFor(E(w), w);
  await setLastSeen(fam, addMonths(T0, -13));
  await S.runEngine(pool, T0, { only: [fam.id] });
  await S.runEngine(pool, T0 + 14 * DAY + 60e3, { only: [fam.id] });
  assert.strictEqual((await reqRow(fam)).status, 'blocked', 'nobody to hand over to');
  const cl = await call('POST', `/api/families/${fam.id}/claim`, {}, cookies['c-m1']);
  assert.strictEqual(cl.status, 200, cl.text);
  const reqId = cl.json.id;
  assert.ok(lastMail(E('cl-owner'), /xin nhận quyền Chủ họ/), 'the owner hears about the claim');
  assert.strictEqual((await call('POST', `/api/families/${fam.id}/claim`, {}, cookies['c-m2']))?.status, 409, 'one claim at a time');
  assert.strictEqual((await call('POST', `/api/handover/${reqId}/back`, {}, cookies['c-m1'])).status, 409, 'the claimant cannot back');
  assert.strictEqual((await call('POST', `/api/handover/${reqId}/back`, {}, cookies.stranger)).status, 403, 'not a member');
  const b1 = await call('POST', `/api/handover/${reqId}/back`, {}, cookies['c-m2']);
  assert.strictEqual(b1.json.backers, 1);
  assert.strictEqual((await call('POST', `/api/handover/${reqId}/back`, {}, cookies['c-m2']))?.json.backers, 1, 'a second backing does not count');
  assert.strictEqual((await call('POST', `/api/handover/${reqId}/back`, {}, cookies['c-m3']))?.json.backers, 2);
  assert.strictEqual((await ownerRow(fam)).email, E('cl-owner'), 'two of three is not enough');
  const b3 = await call('POST', `/api/handover/${reqId}/back`, {}, cookies['c-m4']);
  assert.strictEqual(b3.json.objection, true, 'three backers: the objection window opens');
  assert.strictEqual((await ownerRow(fam)).email, E('cl-owner'), 'no transfer yet');
  assert.strictEqual(await stageOf(await reqRow(fam)), 'objection');
  assert.ok(lastMail(E('cl-owner'), /Đủ người ủng hộ/), 'the owner is told the window is open');
  assert.ok(lastMail(E('c-m3'), /Đủ người ủng hộ/), 'members are told too');
  assert.strictEqual((await call('POST', `/api/handover/${reqId}/back`, {}, cookies['c-m4']))?.status, 409, 'no more backing in the window');
  // the window passes with no objection and no refusal: the claimant becomes the owner
  await S.runEngine(pool, Date.now() + 31 * DAY, { only: [fam.id] });
  assert.strictEqual((await ownerRow(fam)).email, E('c-m1'));
  assert.strictEqual((await pool.query('select role from members where family_id=$1 and email=$2', [fam.id, E('cl-owner')])).rows[0].role, 'admin');
  assert.strictEqual((await reqRow(fam)).status, 'completed');
});

test('during the objection window a member objects and the claim stops; the owner refusing by signing in also stops it', { skip }, async () => {
  const fam = await newFamily('objt');
  await member(fam, E('ob-owner'), 'owner', { approvedYearsAgo: 2 });
  for (const w of ['ob-m1', 'ob-m2', 'ob-m3', 'ob-m4']) { await member(fam, E(w), 'member'); cookies[w] = await sessionFor(E(w), w); }
  cookies.obOwner = await sessionFor(E('ob-owner'), 'Chủ ob');
  await setLastSeen(fam, addMonths(T0, -13));
  await S.runEngine(pool, T0, { only: [fam.id] });
  await S.runEngine(pool, T0 + 14 * DAY + 60e3, { only: [fam.id] });
  assert.strictEqual((await reqRow(fam)).status, 'blocked');
  await member(fam, E('ob-admin'), 'admin', { approvedYearsAgo: 1 }); // an admin exists by the time of the claim: they are told of objections
  const reqId = (await call('POST', `/api/families/${fam.id}/claim`, {}, cookies['ob-m1'])).json.id;
  await call('POST', `/api/handover/${reqId}/back`, {}, cookies['ob-m2']);
  await call('POST', `/api/handover/${reqId}/back`, {}, cookies['ob-m3']);
  await call('POST', `/api/handover/${reqId}/back`, {}, cookies['ob-m4']);
  assert.strictEqual(await stageOf(await reqRow(fam)), 'objection');
  assert.strictEqual((await call('POST', `/api/handover/${reqId}/object`, {}, cookies['ob-m1'])).status, 409, 'the claimant cannot object to their own claim');
  assert.strictEqual((await call('POST', `/api/handover/${reqId}/object`, {}, cookies.stranger)).status, 403, 'not a member');
  assert.strictEqual((await call('POST', `/api/handover/${reqId}/object`, {}, cookies['ob-m2'])).status, 200, 'a member objects');
  assert.strictEqual((await reqRow(fam)).status, 'blocked');
  assert.ok(lastMail(E('ob-admin'), /Có phản đối/), 'the admins are told');
  await S.runEngine(pool, Date.now() + 40 * DAY, { only: [fam.id] });
  assert.strictEqual((await ownerRow(fam)).email, E('ob-owner'), 'an objected claim never transfers');
  // a second claim, the owner signs in during the window: refused
  const fam2 = await newFamily('objt2');
  await member(fam2, E('o2-owner'), 'owner', { approvedYearsAgo: 2 });
  for (const w of ['o2-m1', 'o2-m2', 'o2-m3', 'o2-m4']) { await member(fam2, E(w), 'member'); cookies[w] = await sessionFor(E(w), w); }
  await setLastSeen(fam2, addMonths(T0, -13));
  await S.runEngine(pool, T0, { only: [fam2.id] });
  await S.runEngine(pool, T0 + 14 * DAY + 60e3, { only: [fam2.id] });
  const r2 = (await call('POST', `/api/families/${fam2.id}/claim`, {}, cookies['o2-m1'])).json.id;
  for (const w of ['o2-m2', 'o2-m3', 'o2-m4']) await call('POST', `/api/handover/${r2}/back`, {}, cookies[w]);
  assert.strictEqual(await stageOf(await reqRow(fam2)), 'objection');
  cookies.o2Owner = await sessionFor(E('o2-owner'), 'Chủ o2');
  await call('GET', `/api/families/${fam2.id}/succession`, undefined, cookies.o2Owner);
  assert.strictEqual((await reqRow(fam2)).status, 'cancelled', 'the owner refused by signing in');
  await S.runEngine(pool, Date.now() + 40 * DAY, { only: [fam2.id] });
  assert.strictEqual((await ownerRow(fam2)).email, E('o2-owner'));
});

test('the owner signing in refuses a claim', { skip }, async () => {
  const fam = await newFamily('refuse');
  await member(fam, E('rf-owner'), 'owner', { approvedYearsAgo: 2 });
  await member(fam, E('rf-m1'), 'member');
  cookies.rfOwner = await sessionFor(E('rf-owner'), 'Chủ rf');
  cookies.rfM1 = await sessionFor(E('rf-m1'), 'Thành viên rf');
  const cl = await call('POST', `/api/families/${fam.id}/claim`, {}, cookies.rfM1);
  assert.strictEqual(cl.status, 200, cl.text);
  await call('GET', `/api/families/${fam.id}/succession`, undefined, cookies.rfOwner);
  assert.strictEqual((await reqRow(fam)).status, 'cancelled');
  assert.strictEqual((await ownerRow(fam)).email, E('rf-owner'));
});

test('a claim window of 30 days ends blocked when nobody backs it', { skip }, async () => {
  const fam = await newFamily('expire');
  await member(fam, E('ex-owner'), 'owner', { approvedYearsAgo: 2 });
  await member(fam, E('ex-m1'), 'member');
  await member(fam, E('ex-m2'), 'member');
  cookies.exM1 = await sessionFor(E('ex-m1'), 'ex1');
  const cl = await call('POST', `/api/families/${fam.id}/claim`, {}, cookies.exM1);
  assert.strictEqual(cl.status, 200);
  const later = Date.now() + 31 * DAY;
  await S.runEngine(pool, later, { only: [fam.id] });
  assert.strictEqual((await reqRow(fam)).status, 'blocked');
  assert.strictEqual((await ownerRow(fam)).email, E('ex-owner'));
});

// ---- death report ----
test('a death report: a member reports, only an accepted contact confirms, the contact is offered first', { skip }, async () => {
  const fam = await newFamily('dead');
  await member(fam, E('d-owner'), 'owner', { approvedYearsAgo: 2 });
  await member(fam, E('d-admin'), 'admin', { approvedYearsAgo: 1 });
  await member(fam, E('d-m1'), 'member');
  await pool.query("insert into trusted_contacts (family_id, email, name, status, priority, accepted_at) values ($1,$2,'Cô Dấu','accepted',1, now())", [fam.id, E('d-contact')]);
  cookies.dM1 = await sessionFor(E('d-m1'), 'Thành viên d');
  cookies.dAdmin = await sessionFor(E('d-admin'), 'Quản trị d');
  cookies.dContact = await sessionFor(E('d-contact'), 'Cô Dấu');
  const rep = await call('POST', `/api/families/${fam.id}/handover/report`, { evidence: 'Giấy báo tử số 12', photo_link: 'https://img.test/a.jpg' }, cookies.dM1);
  assert.strictEqual(rep.status, 200, rep.text);
  assert.strictEqual((await call('POST', `/api/families/${fam.id}/handover/report`, { evidence: 'x' }, cookies.dM1)).status, 409, 'one at a time');
  assert.strictEqual((await call('POST', `/api/families/${fam.id}/handover/report`, { photo_link: 'javascript:alert(1)' }, cookies.dM1)).status, 400);
  assert.strictEqual((await call('POST', `/api/families/${fam.id}/handover/report`, {}, cookies.stranger)).status, 403);
  const id = rep.json.id;
  assert.strictEqual((await call('POST', `/api/handover/${id}/confirm`, {}, cookies.dM1)).status, 403, 'a member cannot confirm');
  assert.strictEqual((await call('POST', `/api/handover/${id}/confirm`, {}, cookies.dAdmin)).status, 403, 'with a contact, an admin cannot confirm');
  assert.ok(lastMail(E('d-contact'), /Cần xác nhận một báo cáo/), 'the contact is asked');
  const conf = await call('POST', `/api/handover/${id}/confirm`, {}, cookies.dContact);
  assert.strictEqual(conf.status, 200, conf.text);
  assert.strictEqual(await stageOf(await reqRow(fam)), 'notice');
  assert.ok(lastMail(E('d-owner'), /chuyển quyền Chủ họ sau 14 ngày/), 'the owner gets the notice');
  const t = Date.now();
  assert.strictEqual((await S.runEngine(pool, t + 14 * DAY + 60e3, { only: [fam.id] })).offers, 1);
  const tokC = tokenIn(lastMail(E('d-contact'), /Bạn được mời nhận quyền/));
  assert.ok(tokC, 'the contact gets the first offer');
  const dec = await call('POST', `/api/offers/${tokC}/decline`, {});
  assert.strictEqual(dec.status, 200);
  const tokA = tokenIn(lastMail(E('d-admin'), /Bạn được mời nhận quyền/));
  assert.ok(tokA, 'then the admin');
  assert.strictEqual((await call('POST', `/api/offers/${tokC}/accept`, { code: '000000' })).status, 410, 'a declined offer is closed');
  // the admin asks for a code and guesses wrong five times: the offer closes and the chain ends (nobody else)
  assert.strictEqual((await call('POST', `/api/offers/${tokA}/code`)).status, 200);
  const codeA = codeIn(lastMail(E('d-admin'), /Mã xác nhận/));
  const bad = codeA === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.strictEqual((await call('POST', `/api/offers/${tokA}/accept`, { code: bad })).status, 400);
  assert.strictEqual((await call('POST', `/api/offers/${tokA}/accept`, { code: bad })).status, 429, 'the fifth wrong code closes the offer');
  assert.strictEqual((await call('POST', `/api/offers/${tokA}/accept`, { code: codeA })).status, 410, 'and a right code no longer works');
  assert.strictEqual((await reqRow(fam)).status, 'blocked', 'the chain ran out');
  assert.strictEqual((await ownerRow(fam)).email, E('d-owner'));
  assert.strictEqual((await ownerRow(fam)).email, E('d-owner'));
});

test('the daily run goes once per day, guarded by job_runs (injected times)', { skip }, async () => {
  const job = 'test-' + TAG; // its own job name: the real 'succession' row is not touched
  const first = await S.runDailyIfDue(pool, T0, job);
  assert.ok(first && typeof first.reminders === 'number');
  assert.strictEqual(await S.runDailyIfDue(pool, T0 + 3600e3, job), null, 'an hour later: no');
  assert.ok(await S.runDailyIfDue(pool, T0 + 21 * 3600e3, job), 'after 20 hours: yes');
  await pool.query('delete from job_runs where name=$1', [job]);
});

// ---- families ----
test('creating a family: signed in only; the creator is the owner; a first person; slugs stay unique', { skip }, async () => {
  const name = `Họ Lập ${TAG}`;
  assert.strictEqual((await call('POST', '/api/families', { name })).status, 401);
  cookies.creator = await sessionFor(E('creator'), 'Người Lập');
  assert.strictEqual((await call('POST', '/api/families', {}, cookies.creator)).status, 400, 'a name is needed');
  assert.strictEqual((await call('POST', '/api/families', { name, visibility: 'secret' }, cookies.creator)).status, 400);
  const ok = await call('POST', '/api/families', { name, han: '黎', place: 'Củ Chi', visibility: 'link', first_person: { name: 'Cụ Tổ', sex: 'm' } }, cookies.creator);
  assert.strictEqual(ok.status, 200, ok.text);
  const slug = ok.json.family.slug;
  cleanupFamilies.add(slug);
  assert.match(slug, /^ho-lap-/);
  const mine = (await call('GET', `/api/families/${slug}`, undefined, cookies.creator)).json;
  assert.strictEqual(mine.my_role, 'owner');
  assert.strictEqual(mine.visibility, 'link');
  const row = (await pool.query("select data from persons where family_id=$1", [slug])).rows;
  assert.strictEqual(row.length, 1);
  assert.strictEqual(row[0].data.name, 'Cụ Tổ');
  assert.strictEqual((await pool.query('select count(*)::int n from history where person_id in (select id from persons where family_id=$1)', [slug])).rows[0].n, 1);
  const again = await call('POST', '/api/families', { name }, cookies.creator);
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.json.family.slug, `${slug}-2`, 'same name: a new slug');
  cleanupFamilies.add(again.json.family.slug);
  const noPerson = await call('POST', '/api/families', { name: `Họ trống ${TAG}` }, cookies.creator);
  cleanupFamilies.add(noPerson.json.family.slug);
  assert.strictEqual((await pool.query('select count(*)::int n from persons where family_id=$1', [noPerson.json.family.slug])).rows[0].n, 0, 'the first person is optional');
});

// ---- mail on decisions ----
test('join decisions and contribution decisions are mailed; a contribution is mailed once', { skip }, async () => {
  const fam = await newFamily('mail');
  await member(fam, E('mail-owner'), 'owner', { approvedYearsAgo: 2 });
  cookies.mailOwner = await sessionFor(E('mail-owner'), 'Chủ mail');
  cookies.joinA = await sessionFor(E('join-a'), 'Người A');
  cookies.joinB = await sessionFor(E('join-b'), 'Người B');
  assert.strictEqual((await call('POST', '/api/join', { family: fam.id, first_name: 'An', last_name: 'Nguyễn' }, cookies.joinA)).status, 200);
  assert.strictEqual((await call('POST', '/api/join', { family: fam.id, first_name: 'Bình', last_name: 'Trần' }, cookies.joinB)).status, 200);
  const ids = (await pool.query('select id, email from members where family_id=$1 and status=$2 order by id', [fam.id, 'pending'])).rows;
  const q = `?family=${fam.id}`;
  assert.strictEqual((await call('POST', `/api/members/${ids[0].id}/approve${q}`, { role: 'member' }, cookies.mailOwner)).status, 200);
  assert.strictEqual((await call('POST', `/api/members/${ids[1].id}/reject${q}`, {}, cookies.mailOwner)).status, 200);
  assert.ok(lastMail(E('join-a'), /Bạn đã được vào/), 'approved join mailed');
  assert.ok(lastMail(E('join-b'), /chưa được duyệt/), 'rejected join mailed');
  const sender = E('sender');
  const sug = await call('POST', '/api/suggest', { family: fam.id, changes: { name: 'Dương Thử Nghiệm' }, by_name: 'Người Gửi', by_contact: sender });
  assert.strictEqual(sug.status, 200, sug.text);
  const sid = (await pool.query('select id from suggestions where by_contact=$1', [sender])).rows[0].id;
  assert.strictEqual((await call('POST', `/api/suggestions/${sid}/approve`, {}, cookies.mailOwner)).status, 200);
  assert.ok(lastMail(sender, /Góp ý của bạn đã được duyệt/), 'approval mailed to the sender');
  assert.strictEqual((await pool.query('select notify_pending from suggestions where id=$1', [sid])).rows[0].notify_pending, false);
  const sug2 = await call('POST', '/api/suggest', { family: fam.id, changes: { name: 'Lê Thử Hai' }, by_name: 'Người Gửi', by_contact: E('sender2') });
  assert.strictEqual(sug2.status, 200);
  const sid2 = (await pool.query('select id from suggestions where by_contact=$1', [E('sender2')])).rows[0].id;
  assert.strictEqual((await call('POST', `/api/suggestions/${sid2}/reject`, { reason: 'Thiếu nguồn' }, cookies.mailOwner)).status, 200);
  const rej = lastMail(E('sender2'), /chưa được duyệt/);
  assert.ok(rej && rej.text.includes('Thiếu nguồn'), 'the reason is in the rejection mail');
  assert.strictEqual((await kindsOf(fam)).filter((k) => k === 'contribution').length, 2);
});

test('owner settings: 3, 6, 12 or 18 months, owner only', { skip }, async () => {
  const fam = F.main;
  const url = `/api/families/${fam.id}/succession/settings`;
  assert.strictEqual((await call('POST', url, { owner_inactive_months: 13 }, cookies.owner)).status, 400);
  assert.strictEqual((await call('POST', url, { owner_inactive_months: 6 }, cookies.admin)).status, 403);
  const ok = await call('POST', url, { owner_inactive_months: 18 }, cookies.ownerNow);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await pool.query('select owner_inactive_months from families where id=$1', [fam.id])).rows[0].owner_inactive_months, 18);
  await call('POST', url, { owner_inactive_months: 12 }, cookies.owner);
});

test('no stored mail row or message holds the API key', { skip }, async () => {
  const rows = (await pool.query('select * from mail_log where to_email like $1 or family_id = any($2)', [`%${TAG}%`, [...cleanupFamilies]])).rows;
  assert.ok(rows.length > 10, 'mail was logged');
  assert.ok(!JSON.stringify(rows).includes(FAKE_KEY));
  assert.ok(!sent.some((m) => m.text?.includes(FAKE_KEY) || m.html?.includes(FAKE_KEY)));
  assert.ok(rows.every((r) => ['sent', 'skipped', 'failed', 'queued'].includes(r.status)));
});
