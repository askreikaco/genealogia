// Integration: the stories of each entry in GET /api/book/outline. A living person's stories go to members only; a deceased
// person's go to anyone who can read the family. Needs GP_TEST_DATABASE_URL (scratch DB), skipped otherwise.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = 'test-entries-' + TAG;
const MEMBER = `member.entries.${TAG}@example.test`;
const LIVING = 'N' + crypto.randomUUID().slice(0, 13);
const DEAD = 'N' + crypto.randomUUID().slice(0, 13);
let base; let pool; let close; let cookie = '';

async function outline(cookieHdr) {
  const r = await fetch(`${base}/api/book/outline?family=${FAM}`, { headers: cookieHdr ? { cookie: cookieHdr } : {} });
  return { status: r.status, json: r.status === 200 ? await r.json() : null };
}
// The text of one entry in the plan (null when the entry has none or is not printed).
function entryTxt(plan, id) {
  for (const pg of plan.pages) for (const col of pg.cols || []) for (const it of col) if (it[0] === 1 && it[1] === id) return it[4];
  return undefined;
}

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1, $1, 'Dòng họ thử', 'public')", [FAM]);
  await pool.query("insert into persons (id, data, updated_by, family_id) values ($1, $2, 'test', $3)",
    [LIVING, { name: 'Người Sống ' + TAG, gen: 1, sex: 'f', born: '1960', living: 'living' }, FAM]);
  await pool.query("insert into persons (id, data, updated_by, family_id) values ($1, $2, 'test', $3)",
    [DEAD, { name: 'Người Mất ' + TAG, gen: 1, sex: 'm', born: '1900', died: '1970', living: 'dead' }, FAM]);
  await pool.query("insert into stories (id, family_id, person_id, kind, title, body) values ($1,$2,$3,'chuyen','Chuyện riêng','Đoạn một.\n\nĐoạn hai.')",
    ['S' + crypto.randomBytes(6).toString('hex'), FAM, LIVING]);
  await pool.query("insert into stories (id, family_id, person_id, kind, title, body) values ($1,$2,$3,'chuyen','','Chuyện người mất.')",
    ['S' + crypto.randomBytes(6).toString('hex'), FAM, DEAD]);
  await pool.query("insert into stories (id, family_id, person_id, kind, title, body) values ($1,$2,$3,'tom_tat','','Tóm tắt đã lưu.')",
    ['S' + crypto.randomBytes(6).toString('hex'), FAM, DEAD]);
  await pool.query("insert into members (family_id, email, name, role, status) values ($1, $2, 'Thành Viên Thử', 'member', 'active')", [FAM, MEMBER]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const s = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: MEMBER, name: 'Thành Viên Thử' }) });
  cookie = (s.headers.get('set-cookie') || '').split(';')[0];
});

test.after(async () => {
  if (skip) return;
  await pool.query('delete from members where email = $1', [MEMBER]);
  await pool.query('delete from stories where family_id = $1', [FAM]);
  await pool.query('delete from persons where family_id = $1', [FAM]);
  await pool.query('delete from families where id = $1', [FAM]);
  await close(); await pool.end();
});

test('a living person\'s stories are hidden from guests and printed for members', { skip }, async () => {
  const guest = await outline('');
  assert.equal(guest.status, 200);
  assert.equal(entryTxt(guest.json.plan, LIVING)?.st?.length || 0, 0, 'guest gets no stories of a living person');
  const member = await outline(cookie);
  const txt = entryTxt(member.json.plan, LIVING);
  assert.deepEqual(txt.st.map((x) => x.t), ['Đoạn một.', 'Đoạn hai.'], 'member gets the story paragraphs');
});

test('a deceased person\'s saved summary and stories are printed for guests', { skip }, async () => {
  const guest = await outline('');
  const txt = entryTxt(guest.json.plan, DEAD);
  assert.deepEqual(txt.st.map((x) => x.t), ['Tóm tắt đã lưu.', 'Chuyện người mất.'], 'the saved summary, then the story, both public');
});

test('the cache follows a new story: the outline changes when a story is added', { skip }, async () => {
  const before = await outline('');
  await pool.query("insert into stories (id, family_id, person_id, kind, title, body) values ($1,$2,$3,'chuyen','','Thêm vào.')",
    ['S' + crypto.randomBytes(6).toString('hex'), FAM, DEAD]);
  const after = await outline('');
  assert.ok(entryTxt(after.json.plan, DEAD).st.some((x) => /Thêm vào\./.test(x.t)), 'new story appears at once');
  assert.notEqual(JSON.stringify(before.json.plan), JSON.stringify(after.json.plan));
});
