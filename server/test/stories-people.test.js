// API tests for stories about several people (migration 043) and the Câu chuyện tab's server side: a member adds a
// story through the suggestion queue, an editor saves directly, a tagged story shows on each tagged person's profile,
// a living tagged person is not shown to guests, the teller of a story is kept, and a tag never crosses families.
// Needs a SCRATCH database (GP_TEST_DATABASE_URL); skipped otherwise.
'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `stp-${TAG}`; const OTHER = `stpx-${TAG}`;
const CODE = 'stp-code-' + crypto.randomBytes(4).toString('hex');
const MEMBER = `stp.member.${TAG}@example.test`;
const TELLER = `stp.teller.${TAG}@example.test`;
const LIVING = `N${TAG}liv1`; const DEAD = `N${TAG}dead1`; const DEAD2 = `N${TAG}dead2`; const ABROAD = `N${TAG}abr1`;
let base, pool, close, editorCookie, memberCookie, tellerCookie;
const op = (n) => `stp-op-${TAG}-${n}`;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const story = (over = {}) => ({ kind: 'chuyen', title: 'Chuyến đi', body: 'Cả nhà cùng đi Huế.', photos: [], people: [], ...over });

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `Tester:${FAM}:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Thử câu chuyện','public'), ($2,$2,'Họ khác','public')", [FAM, OTHER]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4), ($5,$2,$6,$4), ($7,$2,$8,$4), ($9,$10,$11,$4)', [
    LIVING, FAM, { name: 'Người Sống', sex: 'm', gen: 4, birth_date: '5/3/1962', born: '1962' }, 'test',
    DEAD, { name: 'Người Mất', sex: 'f', gen: 3, born: '1900', died: '1970' },
    DEAD2, { name: 'Người Mất Hai', sex: 'm', gen: 3, born: '1902', died: '1972' },
    ABROAD, OTHER, { name: 'Người Họ Khác', sex: 'f', gen: 3, born: '1901', died: '1971' }]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const login = await call('POST', '/api/login', { code: CODE });
  editorCookie = login.headers.get('set-cookie').split(';')[0];
  memberCookie = (await call('POST', '/api/test/session', { email: MEMBER, name: 'Thành viên thử' })).headers.get('set-cookie').split(';')[0];
  tellerCookie = (await call('POST', '/api/test/session', { email: TELLER, name: 'Người Sống' })).headers.get('set-cookie').split(';')[0];
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thành viên thử',$2,'member','active'), ($3,'Người Sống',$2,'member','active')", [MEMBER, FAM, TELLER]);
});
test.after(async () => {
  if (skip || !pool) return;
  if (close) await close();
  for (const f of [FAM, OTHER]) {
    await pool.query('delete from stories where family_id=$1', [f]);
    await pool.query('delete from suggestions where family_id=$1', [f]);
    await pool.query('delete from history where person_id in (select id from persons where family_id=$1)', [f]);
    await pool.query('delete from ops where person_id in (select id from persons where family_id=$1)', [f]);
    await pool.query('delete from members where family_id=$1', [f]);
    await pool.query('delete from persons where family_id=$1', [f]);
    await pool.query('delete from families where id=$1', [f]);
  }
  await pool.end();
});

test('member: no direct write (403); the story goes to the suggestion queue; a guest may suggest text (200)', { skip }, async () => {
  const direct = await call('POST', `/api/stories?family=${FAM}`, { op_id: op(1), person_id: DEAD, story: story() }, memberCookie);
  assert.equal(direct.status, 403);
  const sug = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD, changes: { _ev: { action: 'add', kind: 'story', item: story() } }, by_name: 'x' }, memberCookie);
  assert.equal(sug.status, 200, sug.text);
  const guest = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD, changes: { _ev: { action: 'add', kind: 'story', item: story() } }, by_name: 'Khách' });
  assert.equal(guest.status, 200, guest.text);
  // the guest's text-only story joins the queue beside the member's
  const q = await call('GET', `/api/suggestions?family=${FAM}`, undefined, editorCookie);
  assert.equal(q.json.items.filter((x) => x.ev_label && /câu chuyện/.test(x.ev_label)).length, 2);
  // rejected here, so the approval test below meets the member's story alone
  const rj = await call('POST', `/api/suggestions/${guest.json.id}/reject?family=${FAM}`, { reason: 'test' }, editorCookie);
  assert.equal(rj.status, 200, rj.text);
});

test('editor: saved directly; the teller is the editor; an approved member story is told by the member', { skip }, async () => {
  const add = await call('POST', `/api/stories?family=${FAM}`, { op_id: op(2), person_id: DEAD, story: story({ title: 'Của biên tập' }) }, editorCookie);
  assert.equal(add.status, 200, add.text);
  assert.equal(add.json.story.created_by, 'Tester');
  const q = await call('GET', `/api/suggestions?family=${FAM}`, undefined, editorCookie);
  const item = q.json.items.find((x) => x.ev_label && /câu chuyện/.test(x.ev_label));
  const ok = await call('POST', `/api/suggestions/${item.id}/approve?family=${FAM}`, {}, editorCookie);
  assert.equal(ok.status, 200, ok.text);
  const got = await call('GET', `/api/events?family=${FAM}&person=${DEAD}`);
  const mine = got.json.stories.find((s) => s.title === 'Chuyến đi');
  assert.ok(mine, 'approved story listed');
  assert.equal(mine.created_by, 'Thành viên thử', 'the member who sent it is the teller');
});

test('an editor edit keeps the teller', { skip }, async () => {
  const got = (await call('GET', `/api/events?family=${FAM}&person=${DEAD}`)).json.stories.find((s) => s.title === 'Chuyến đi');
  const put = await call('PUT', `/api/stories/${got.id}?family=${FAM}`, { op_id: op(3), story: story({ title: 'Chuyến đi', body: 'Sửa lại.' }) }, editorCookie);
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.story.created_by, 'Thành viên thử');
  assert.equal(put.json.story.body, 'Sửa lại.');
});

test('a tagged story shows on the owner and on each tagged person (two people)', { skip }, async () => {
  const add = await call('POST', `/api/stories?family=${FAM}`, { op_id: op(4), person_id: DEAD, story: story({ title: 'Hai người', people: [DEAD2, DEAD2, DEAD, LIVING] }) }, editorCookie);
  assert.equal(add.status, 200, add.text);
  assert.deepEqual(add.json.story.people, [DEAD2, LIVING], 'the owner is not repeated; duplicates go');
  const owner = await call('GET', `/api/events?family=${FAM}&person=${DEAD}`);
  const other = await call('GET', `/api/events?family=${FAM}&person=${DEAD2}`);
  assert.ok(owner.json.stories.some((s) => s.title === 'Hai người'), 'on the owner');
  assert.ok(other.json.stories.some((s) => s.title === 'Hai người' && s.person_id === DEAD), 'on the tagged person');
  const member = await call('GET', `/api/events?family=${FAM}&person=${LIVING}`, undefined, memberCookie);
  assert.ok(member.json.stories.some((s) => s.title === 'Hai người'), 'a living tagged person: members see it');
});

test('living tagged person: guests get no such story on their profile and no name for it on the owner', { skip }, async () => {
  const guestLiving = await call('GET', `/api/events?family=${FAM}&person=${LIVING}`);
  assert.equal(guestLiving.json.hidden, true); assert.deepEqual(guestLiving.json.stories, []);
  const guestOwner = await call('GET', `/api/events?family=${FAM}&person=${DEAD}`);
  const s = guestOwner.json.stories.find((x) => x.title === 'Hai người');
  assert.ok(s, 'the deceased owner\'s story is public');
  assert.deepEqual(s.people, [DEAD2], 'the living tagged person is removed for a guest');
});

test('the teller who is a living person is hidden from guests (created_by_hidden); members see the name', { skip }, async () => {
  const sug = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD2, changes: { _ev: { action: 'add', kind: 'story', item: story({ title: 'Của người sống' }) } } }, tellerCookie);
  assert.equal(sug.status, 200, sug.text);
  const q = await call('GET', `/api/suggestions?family=${FAM}`, undefined, editorCookie);
  const item = q.json.items.find((x) => x.ev_label && /Của người sống/.test(x.ev_label));
  assert.ok(item);
  assert.equal((await call('POST', `/api/suggestions/${item.id}/approve?family=${FAM}`, {}, editorCookie)).status, 200);
  const guest = (await call('GET', `/api/events?family=${FAM}&person=${DEAD2}`)).json.stories.find((x) => x.title === 'Của người sống');
  assert.equal(guest.created_by, ''); assert.equal(guest.created_by_hidden, true);
  const member = (await call('GET', `/api/events?family=${FAM}&person=${DEAD2}`, undefined, memberCookie)).json.stories.find((x) => x.title === 'Của người sống');
  assert.equal(member.created_by, 'Người Sống'); assert.equal(member.created_by_hidden, false);
});

test('a tag never crosses families (422 direct, 400 suggestion); an unknown person is refused too', { skip }, async () => {
  const direct = await call('POST', `/api/stories?family=${FAM}`, { op_id: op(5), person_id: DEAD, story: story({ people: [ABROAD] }) }, editorCookie);
  assert.equal(direct.status, 422, direct.text);
  const sug = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD, changes: { _ev: { action: 'add', kind: 'story', item: story({ people: [ABROAD] }) } } }, memberCookie);
  assert.equal(sug.status, 400, sug.text);
  const ghost = await call('POST', `/api/stories?family=${FAM}`, { op_id: op(6), person_id: DEAD, story: story({ people: ['N' + TAG + 'zzzz9'] }) }, editorCookie);
  assert.equal(ghost.status, 422);
  const bad = await call('POST', `/api/stories?family=${FAM}`, { op_id: op(7), person_id: DEAD, story: story({ people: ['javascript:1'] }) }, editorCookie);
  assert.equal(bad.status, 400);
});

test('a summary tags nobody', { skip }, async () => {
  const s = await call('POST', `/api/stories?family=${FAM}`, { op_id: op(8), person_id: DEAD, story: { kind: 'tom_tat', title: 'Câu chuyện đời', body: 'Tóm tắt.', people: [DEAD2] } }, editorCookie);
  assert.equal(s.status, 200, s.text);
  assert.deepEqual(s.json.story.people, []);
});

test('guest story: text and links only; photos are refused for non-members (400), members may attach them', { skip }, async () => {
  const withPhoto = story({ photos: ['https://example.test/a.jpg'] });
  const guestPhoto = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD, changes: { _ev: { action: 'add', kind: 'story', item: withPhoto } }, by_name: 'Khách' });
  assert.equal(guestPhoto.status, 400);
  assert.equal(guestPhoto.json.error, 'Khách chỉ gửi được chữ và đường dẫn; đăng nhập và tham gia dòng họ để tải ảnh.');
  const memberPhoto = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD, changes: { _ev: { action: 'add', kind: 'story', item: withPhoto } }, by_name: 'x' }, memberCookie);
  assert.equal(memberPhoto.status, 200, memberPhoto.text);
});
