// API tests for the custom event name (Khác: Tên sự kiện): saved and shown per event, history summary, validation (80
// characters), and the family's name suggestions (GET /api/events/titles): most used first, privacy by person (a living
// person's names reach members only), and never another family's names. Needs a SCRATCH database (GP_TEST_DATABASE_URL).
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
const FAM = `evtitle-${TAG}`; const FAM2 = `evtitle2-${TAG}`;
const CODE = 'evt-code-' + crypto.randomBytes(4).toString('hex');
const MEMBER = `evt.member.${TAG}@example.test`;
const LIVING = `N${TAG}liv1`; const DEAD = `N${TAG}dead1`; const DEAD2 = `N${TAG}dead2`; const OTHER = `N${TAG}oth1`;
let base, pool, close, editorCookie, memberCookie;
const op = (n) => `evt-op-${TAG}-${n}`;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const ev = (over = {}) => ({ type: 'khac', date_kind: 'exact', date_from: '1950', date_text: '1950', place: '', description: '', people: [], sources: [], is_preferred: true, ...over });
const titlesOf = async (cookie) => (await call('GET', `/api/events/titles?family=${FAM}`, undefined, cookie)).json.titles;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `Tester:${FAM}:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Thử tên sự kiện','public'), ($2,$2,'Họ khác','public')", [FAM, FAM2]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4), ($5,$2,$6,$4), ($7,$2,$8,$4), ($9,$10,$11,$4)', [
    LIVING, FAM, { name: 'Người Sống', sex: 'm', gen: 4, birth_date: '5/3/1962', born: '1962' }, 'test',
    DEAD, { name: 'Người Mất', sex: 'f', gen: 3, born: '1900', died: '1970' },
    DEAD2, { name: 'Người Mất Hai', sex: 'm', gen: 3, born: '1902', died: '1975' },
    OTHER, FAM2, { name: 'Người Họ Khác', sex: 'm', gen: 3, born: '1900', died: '1960' }]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const login = await call('POST', '/api/login', { code: CODE });
  editorCookie = login.headers.get('set-cookie').split(';')[0];
  const ms = await call('POST', '/api/test/session', { email: MEMBER, name: 'Thành viên thử' });
  memberCookie = ms.headers.get('set-cookie').split(';')[0];
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thành viên thử',$2,'member','active')", [MEMBER, FAM]);
});
test.after(async () => {
  if (skip || !pool) return;
  if (close) await close();
  for (const f of [FAM, FAM2]) {
    await pool.query('delete from events where family_id=$1', [f]);
    await pool.query('delete from suggestions where family_id=$1', [f]);
    await pool.query('delete from members where family_id=$1', [f]);
    await pool.query('delete from persons where family_id=$1', [f]);
    await pool.query('delete from families where id=$1', [f]);
  }
  await pool.query('delete from history where person_id in ($1,$2,$3,$4)', [LIVING, DEAD, DEAD2, OTHER]);
  await pool.query('delete from ops where person_id in ($1,$2,$3,$4)', [LIVING, DEAD, DEAD2, OTHER]);
  await pool.end();
});

test('a custom name is saved, read back, and written to the history summary', { skip }, async () => {
  const add = await call('POST', `/api/events?family=${FAM}`, { op_id: op(1), person_id: DEAD, event: ev({ title: '  Đỗ tú tài  ', description: 'Khoa cử năm 1950' }) }, editorCookie);
  assert.equal(add.status, 200, add.text);
  assert.equal(add.json.event.title, 'Đỗ tú tài', 'trimmed');
  const list = await call('GET', `/api/events?family=${FAM}&person=${DEAD}`);
  assert.equal(list.json.items[0].title, 'Đỗ tú tài');
  const h = await pool.query("select new_value from history where person_id=$1 and field='su_kien' order by id desc limit 1", [DEAD]);
  const sum = typeof h.rows[0].new_value === 'string' ? JSON.parse(h.rows[0].new_value) : h.rows[0].new_value;
  assert.equal(sum.title, 'Đỗ tú tài', 'the history summary carries the name');
});

test('the name is kept for any type too; an empty name is stored as none', { skip }, async () => {
  const other = await call('POST', `/api/events?family=${FAM}`, { op_id: op(2), person_id: DEAD, event: ev({ type: 'hoc', description: 'Trường làng', title: 'Lớp Nho' }) }, editorCookie);
  assert.equal(other.status, 200, other.text);
  assert.equal(other.json.event.title, 'Lớp Nho');
  const put = await call('PUT', `/api/events/${other.json.event.id}?family=${FAM}`, { op_id: op(3), event: ev({ type: 'hoc', description: 'Trường làng', title: '' }) }, editorCookie);
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.event.title, '', 'empty name reads back as empty');
});

test('validation: at most 80 characters after trimming; the name must be text', { skip }, async () => {
  const ok80 = await call('POST', `/api/events?family=${FAM}`, { op_id: op(4), person_id: DEAD, event: ev({ title: '  ' + 'á'.repeat(80) + '  ' }) }, editorCookie);
  assert.equal(ok80.status, 200, ok80.text);
  const long = await call('POST', `/api/events?family=${FAM}`, { op_id: op(5), person_id: DEAD, event: ev({ title: 'á'.repeat(81) }) }, editorCookie);
  assert.equal(long.status, 400); assert.match(long.json.error, /80 ký tự/);
  const notText = await call('POST', `/api/events?family=${FAM}`, { op_id: op(6), person_id: DEAD, event: ev({ title: 123 }) }, editorCookie);
  assert.equal(notText.status, 400);
});

test('name suggestions: most used first, from this family only, and the living privacy holds', { skip }, async () => {
  // DEAD: "Xây nhà thờ họ" twice; DEAD2: once; LIVING (a living person): one name no guest may see
  for (const [n, pid, title] of [[10, DEAD, 'Xây nhà thờ họ'], [11, DEAD2, 'Xây nhà thờ họ'], [12, DEAD2, 'Bia mộ tổ'], [13, LIVING, 'Bí mật sống']]) {
    const r = await call('POST', `/api/events?family=${FAM}`, { op_id: op(n), person_id: pid, event: ev({ title }) }, editorCookie);
    assert.equal(r.status, 200, r.text);
  }
  // another family's event: written straight to its row (the test editor signs in to FAM only)
  await pool.query("insert into events (id, family_id, person_id, type, title, date_kind, date_from, people, sources, photos, is_preferred, created_by) values ($1,$2,$3,'khac','Chỉ họ khác','exact','1950','[]','[]','[]',true,'test')", ['E' + crypto.randomBytes(6).toString('hex'), FAM2, OTHER]);

  const guest = await titlesOf(undefined);
  const names = guest.map((t) => t.title);
  assert.equal(guest[0].title, 'Xây nhà thờ họ', 'most used first');
  assert.equal(guest[0].uses, 2);
  assert.ok(names.includes('Đỗ tú tài') && names.includes('Bia mộ tổ'), 'deceased people names reach guests');
  assert.ok(!names.includes('Bí mật sống'), 'a living person name is hidden from guests');
  assert.ok(!names.includes('Chỉ họ khác'), 'another family’s name never shows');

  const member = await titlesOf(memberCookie);
  assert.ok(member.some((t) => t.title === 'Bí mật sống'), 'members see living names');
  assert.ok(!member.some((t) => t.title === 'Chỉ họ khác'));

  const fam2 = (await call('GET', `/api/events/titles?family=${FAM2}`)).json.titles;
  assert.deepEqual(fam2.map((t) => t.title), ['Chỉ họ khác'], 'the other family reads only its own');
});

test('a guest suggestion with a name is approved and keeps the name', { skip }, async () => {
  const sug = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD2, changes: { _ev: { action: 'add', kind: 'event', item: ev({ title: 'Lễ giỗ tổ', description: 'Đầu năm' }) } }, by_name: 'Khách' });
  assert.equal(sug.status, 200, sug.text);
  const list = await call('GET', `/api/suggestions?family=${FAM}`, undefined, editorCookie);
  const item = list.json.items.find((x) => x.person_id === DEAD2 && /Lễ giỗ tổ/.test(x.ev_label || ''));
  assert.ok(item, 'the suggestion is labelled with its name, not "Khác"');
  const ok = await call('POST', `/api/suggestions/${item.id}/approve?family=${FAM}`, {}, editorCookie);
  assert.equal(ok.status, 200, ok.text);
  const after = await call('GET', `/api/events?family=${FAM}&person=${DEAD2}`);
  assert.ok(after.json.items.some((e) => e.title === 'Lễ giỗ tổ'));
});
