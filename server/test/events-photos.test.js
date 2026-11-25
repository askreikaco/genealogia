// API tests for photos on life events: attach 1+ photos, remove one, editor-only writes, visibility by person,
// member suggestion with photos. Needs a SCRATCH database (GP_TEST_DATABASE_URL); skipped otherwise.
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
const FAM = `evph-${TAG}`;
const CODE = 'evph-code-' + crypto.randomBytes(4).toString('hex');
const MEMBER = `evph.member.${TAG}@example.test`;
const LIVING = `N${TAG}liv1`; const DEAD = `N${TAG}dead1`;
const PH1 = '/api/photos/' + crypto.randomBytes(12).toString('hex');
const PH2 = '/api/photos/' + crypto.randomBytes(12).toString('hex');
const LINK = 'https://example.test/anh-gia-pha.jpg';
let base, pool, close, editorCookie, memberCookie, livingEvent, deadEvent;
const ACC = { PHL: crypto.randomBytes(12).toString('hex'), PHS: crypto.randomBytes(12).toString('hex'), PHD: crypto.randomBytes(12).toString('hex'), PHP: crypto.randomBytes(12).toString('hex'), PHU: crypto.randomBytes(12).toString('hex') };
const STORY = 'S' + crypto.randomBytes(6).toString('hex');
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const op = (n) => `evph-op-${TAG}-${n}`;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const ev = (over = {}) => ({ type: 'hoc', date_kind: 'exact', date_from: '1980', date_text: '1980', place: 'TP. Hồ Chí Minh', description: 'Khoa Toán', people: [], sources: [], photos: [], is_preferred: true, ...over });

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `Tester:${FAM}:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Thử ảnh sự kiện','public')", [FAM]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4), ($5,$2,$6,$4)', [
    LIVING, FAM, { name: 'Người Sống', sex: 'm', gen: 4, birth_date: '5/3/1962', born: '1962' }, 'test',
    DEAD, { name: 'Người Mất', sex: 'f', gen: 3, born: '1900', died: '1970' }]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const login = await call('POST', '/api/login', { code: CODE });
  editorCookie = login.headers.get('set-cookie').split(';')[0];
  const ms = await call('POST', '/api/test/session', { email: MEMBER, name: 'Thành viên ảnh' });
  memberCookie = ms.headers.get('set-cookie').split(';')[0];
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thành viên ảnh',$2,'member','active')", [MEMBER, FAM]);
  // photos written straight to the table: a living person's event and story, a deceased person's event and photo, one no record shows
  for (const k of Object.keys(ACC)) await pool.query('insert into photos (id, mime, bytes, by_user) values ($1,$2,$3,$4)', [ACC[k], 'image/png', PNG1, 'test']);
  await pool.query('update persons set data = data || $2 where id=$1', [DEAD, { photo: '/api/photos/' + ACC.PHP }]);
});
test.after(async () => {
  if (skip || !pool) return;
  if (close) await close();
  await pool.query('delete from events where family_id=$1', [FAM]);
  await pool.query('delete from stories where family_id=$1', [FAM]);
  await pool.query('delete from photos where id = any($1)', [Object.values(ACC)]);
  await pool.query('delete from suggestions where family_id=$1', [FAM]);
  await pool.query('delete from history where person_id in ($1,$2)', [LIVING, DEAD]);
  await pool.query('delete from ops where person_id in ($1,$2)', [LIVING, DEAD]);
  await pool.query('delete from members where family_id=$1', [FAM]);
  await pool.query('delete from persons where family_id=$1', [FAM]);
  await pool.query('delete from families where id=$1', [FAM]);
  await pool.end();
});

test('editor attaches two photos (upload and link) to an event; the list returns them', { skip }, async () => {
  const add = await call('POST', `/api/events?family=${FAM}`, { op_id: op(1), person_id: LIVING, event: ev({ photos: [PH1, LINK] }) }, editorCookie);
  assert.equal(add.status, 200, add.text);
  assert.deepEqual(add.json.event.photos, [PH1, LINK]);
  livingEvent = add.json.event.id;
  const list = await call('GET', `/api/events?family=${FAM}&person=${LIVING}`, undefined, editorCookie);
  assert.deepEqual(list.json.items[0].photos, [PH1, LINK]);
});

test('editor removes one photo with an edit; the event keeps the other', { skip }, async () => {
  const put = await call('PUT', `/api/events/${livingEvent}?family=${FAM}`, { op_id: op(2), event: ev({ photos: [LINK] }) }, editorCookie);
  assert.equal(put.status, 200, put.text);
  assert.deepEqual(put.json.event.photos, [LINK]);
  const none = await call('PUT', `/api/events/${livingEvent}?family=${FAM}`, { op_id: op(3), event: ev({ photos: [] }) }, editorCookie);
  assert.deepEqual(none.json.event.photos, []);
});

test('photo links are checked: only http(s) or an uploaded photo path, at most 10', { skip }, async () => {
  const bad = (photos, n) => call('POST', `/api/events?family=${FAM}`, { op_id: op(n), person_id: DEAD, event: ev({ photos }) }, editorCookie);
  assert.equal((await bad(['javascript:alert(1)'], 10)).status, 400);
  assert.equal((await bad(['/api/photos/../../etc/passwd'], 11)).status, 400);
  assert.equal((await bad(Array(11).fill(LINK), 12)).status, 400);
  assert.equal((await bad('not-a-list', 13)).status, 400);
});

test('only editors write photos: guests get 401, members 403', { skip }, async () => {
  const body = { op_id: op(20), person_id: DEAD, event: ev({ photos: [PH2] }) };
  assert.equal((await call('POST', `/api/events?family=${FAM}`, body)).status, 401);
  assert.equal((await call('POST', `/api/events?family=${FAM}`, { ...body, op_id: op(21) }, memberCookie)).status, 403);
  assert.equal((await call('PUT', `/api/events/${livingEvent}?family=${FAM}`, { op_id: op(22), event: ev({ photos: [PH2] }) })).status, 401);
});

test('visibility follows the person: a living person\'s photos are hidden from guests, shown to members', { skip }, async () => {
  await call('PUT', `/api/events/${livingEvent}?family=${FAM}`, { op_id: op(23), event: ev({ photos: [PH1] }) }, editorCookie);
  const guest = await call('GET', `/api/events?family=${FAM}&person=${LIVING}`);
  assert.equal(guest.json.hidden, true); assert.deepEqual(guest.json.items, []);
  assert.doesNotMatch(guest.text, /anh-gia-pha|api\/photos/, 'no photo link leaves the server for a guest');
  const member = await call('GET', `/api/events?family=${FAM}&person=${LIVING}`, undefined, memberCookie);
  assert.deepEqual(member.json.items[0].photos, [PH1]);
});

test('a deceased person\'s photo is visible to guests of the family', { skip }, async () => {
  const add = await call('POST', `/api/events?family=${FAM}`, { op_id: op(30), person_id: DEAD, event: ev({ type: 'nghe', date_from: '1950', description: 'Giáo viên', photos: [LINK] }) }, editorCookie);
  assert.equal(add.status, 200, add.text);
  deadEvent = add.json.event.id;
  const guest = await call('GET', `/api/events?family=${FAM}&person=${DEAD}`);
  assert.equal(guest.json.hidden, false);
  assert.deepEqual(guest.json.items.find((x) => x.id === deadEvent).photos, [LINK]);
});

test('a member suggestion with a photo is refused as a photo upload but reviewed like any event', { skip }, async () => {
  const sug = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD, changes: { _ev: { action: 'add', kind: 'event', item: ev({ type: 'quan_ngu', date_from: '1955', photos: [LINK] }) } }, by_name: 'Thành viên ảnh' }, memberCookie);
  assert.equal(sug.status, 200, sug.text);
  const bad = await call('POST', '/api/suggest', { family: FAM, person_id: DEAD, changes: { _ev: { action: 'add', kind: 'event', item: ev({ photos: ['data:image/png;base64,AAAA'] }) } } }, memberCookie);
  assert.equal(bad.status, 400);
  const list = await call('GET', `/api/suggestions?family=${FAM}`, undefined, editorCookie);
  const item = list.json.items.find((x) => x.person_id === DEAD && x.ev_label && /Quân ngũ/.test(x.ev_label));
  assert.ok(item, 'suggestion listed');
  const ok = await call('POST', `/api/suggestions/${item.id}/approve?family=${FAM}`, {}, editorCookie);
  assert.equal(ok.status, 200, ok.text);
  const after = await call('GET', `/api/events?family=${FAM}&person=${DEAD}`);
  assert.ok(after.json.items.some((e) => e.type === 'quan_ngu' && e.photos.length === 1 && e.photos[0] === LINK));
});

test('exactly ten photos are accepted', { skip }, async () => {
  const many = Array.from({ length: 10 }, (_, i) => `https://example.test/${i}.jpg`);
  const put = await call('PUT', `/api/events/${deadEvent}?family=${FAM}`, { op_id: op(40), event: ev({ type: 'nghe', date_from: '1950', photos: many }) }, editorCookie);
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.event.photos.length, 10);
});

// Photo reads: a photo is served only to a viewer who may see a record that shows it (living = members, deceased =
// readable family), 404 otherwise; a guest-visible photo is public-cacheable, any other private.
const photoGet = (id, cookie) => fetch(base + '/api/photos/' + id, { headers: cookie ? { cookie } : {} });
test('living person: an event photo and a story photo are served to members and editors only (404 to guests and strangers)', { skip }, async () => {
  await pool.query('update events set photos=$2 where id=$1', [livingEvent, JSON.stringify(['/api/photos/' + ACC.PHL])]);
  await pool.query('insert into stories (id, family_id, person_id, kind, title, body, photos) values ($1,$2,$3,$4,$5,$6,$7)', [STORY, FAM, LIVING, 'chuyen', 'Chuyện', 'Nội dung', JSON.stringify(['/api/photos/' + ACC.PHS])]);
  const stranger = (await call('POST', '/api/test/session', { email: `stranger.${TAG}@example.test`, name: 'Khách lạ' })).headers.get('set-cookie').split(';')[0];
  for (const id of [ACC.PHL, ACC.PHS]) {
    assert.equal((await photoGet(id)).status, 404, 'guest');
    assert.equal((await photoGet(id, stranger)).status, 404, 'signed-in stranger');
    const m = await photoGet(id, memberCookie);
    assert.equal(m.status, 200, 'member');
    assert.match(m.headers.get('cache-control'), /^private/, 'restricted photo is not cached publicly');
    assert.equal((await photoGet(id, editorCookie)).status, 200, 'editor');
  }
});
test('deceased person: an event photo is served to guests and cached publicly; the person photo too', { skip }, async () => {
  await pool.query('update events set photos=$2 where id=$1', [deadEvent, JSON.stringify(['/api/photos/' + ACC.PHD])]);
  for (const id of [ACC.PHD, ACC.PHP]) {
    const g = await photoGet(id);
    assert.equal(g.status, 200, 'guest');
    assert.match(g.headers.get('cache-control'), /immutable/, 'public photo is cached');
    assert.equal((await photoGet(id, memberCookie)).status, 200, 'member');
  }
});
test('a photo no record shows is served to nobody (not even editors); a bad id is 404', { skip }, async () => {
  assert.equal((await photoGet(ACC.PHU)).status, 404, 'guest');
  assert.equal((await photoGet(ACC.PHU, editorCookie)).status, 404, 'editor');
  assert.equal((await photoGet('zz')).status, 404);
});
test('a private family hides its photos from guests; members still see them', { skip }, async () => {
  await pool.query("update families set visibility='private' where id=$1", [FAM]);
  try {
    assert.equal((await photoGet(ACC.PHD)).status, 404, 'guest of a private family');
    assert.equal((await photoGet(ACC.PHD, memberCookie)).status, 200, 'member of the private family');
  } finally { await pool.query("update families set visibility='public' where id=$1", [FAM]); }
});
