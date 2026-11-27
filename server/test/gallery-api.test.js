// API tests for the gallery per person (G1): add, list, set profile, caption and year, remove to the trash and restore,
// the 20-photo limit, the old single `photo` migrated, privacy of a living person's photos (404 to non-members).
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
const FAM = `gal-${TAG}`;
const CODE = 'gal-code-' + crypto.randomBytes(4).toString('hex');
const MEMBER = `gal.member.${TAG}@example.test`;
const LIVING = `N${TAG}liv1`; const DEAD = `N${TAG}dead1`; const OLD = `N${TAG}old1`;
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
let base, pool, close, editorCookie, memberCookie;
// Uploaded photos: rows in the photos table (the bytes are served only while a record shows them); the test takes one per use.
const ids = []; const FREE = [];
const up = () => { if (!FREE.length) throw new Error('out of test photos'); return '/api/photos/' + FREE.pop(); };

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const gal = (pid, cookie) => call('GET', `/api/persons/${pid}/photos?family=${FAM}`, undefined, cookie);
const add = (pid, body, cookie = editorCookie) => call('POST', `/api/persons/${pid}/photos?family=${FAM}`, body, cookie);
const data = async (pid) => (await pool.query('select data from persons where id=$1 and family_id=$2', [pid, FAM])).rows[0].data;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `Tester:${FAM}:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Thử thư viện ảnh','public')", [FAM]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4), ($5,$2,$6,$4), ($7,$2,$8,$4)', [
    LIVING, FAM, { name: 'Người Sống', sex: 'm', gen: 4, born: '1962' }, 'test',
    DEAD, { name: 'Người Mất', sex: 'f', gen: 3, born: '1900', died: '1970' },
    OLD, { name: 'Người Có Ảnh Cũ', sex: 'm', gen: 3, born: '1910', died: '1980', photo: null }]);
  for (let i = 0; i < 60; i++) { const id = crypto.randomBytes(12).toString('hex'); ids.push(id); FREE.push(id); }
  for (const id of ids) await pool.query('insert into photos (id, mime, bytes, by_user) values ($1,$2,$3,$4)', [id, 'image/png', PNG1, 'test']);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const login = await call('POST', '/api/login', { code: CODE });
  editorCookie = login.headers.get('set-cookie').split(';')[0];
  const ms = await call('POST', '/api/test/session', { email: MEMBER, name: 'Thành viên ảnh' });
  memberCookie = ms.headers.get('set-cookie').split(';')[0];
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thành viên ảnh',$2,'member','active')", [MEMBER, FAM]);
});
test.after(async () => {
  if (skip || !pool) return;
  if (close) await close();
  await pool.query('delete from trash where family_id=$1', [FAM]);
  await pool.query('delete from person_photos where family_id=$1', [FAM]);
  await pool.query('delete from photos where id = any($1)', [ids]);
  await pool.query('delete from history where person_id in ($1,$2,$3)', [LIVING, DEAD, OLD]);
  await pool.query('delete from ops where person_id in ($1,$2,$3)', [LIVING, DEAD, OLD]);
  await pool.query('delete from members where family_id=$1', [FAM]);
  await pool.query('delete from persons where family_id=$1', [FAM]);
  await pool.query('delete from families where id=$1', [FAM]);
  await pool.end();
});

test('add: the first photo is the profile photo (data.photo follows); caption and year are kept', { skip }, async () => {
  const a = up();
  const r = await add(LIVING, { url: a, caption: 'Ảnh cưới', year: 1985 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.photo.is_profile, true);
  assert.equal(r.json.profile, a);
  assert.equal((await data(LIVING)).photo, a, 'data.photo mirrors the profile photo');
  const list = await gal(LIVING, editorCookie);
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.items.map((x) => [x.url, x.caption, x.year, x.is_profile]), [[a, 'Ảnh cưới', 1985, true]]);
  assert.equal(list.json.max, 20);
});

test('add: a second photo is not the profile; a link (https) works too; bad input is refused', { skip }, async () => {
  const b = 'https://example.test/anh-gia-pha-2.jpg';
  const r = await add(LIVING, { url: b, caption: '', year: '' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.photo.is_profile, false);
  assert.equal(r.json.profile, undefined);
  assert.equal(r.json.photo.year, null);
  assert.equal((await add(LIVING, { url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await add(LIVING, { url: up(), year: 1700 })).status, 400, 'year before 1800 is refused');
  assert.equal((await add(LIVING, { url: up(), year: 2999 })).status, 400, 'a future year is refused');
  assert.equal((await add(LIVING, { url: up(), caption: 'x'.repeat(201) })).status, 400, 'caption over 200 is refused');
  assert.equal((await add(LIVING, { url: '/api/photos/../../etc' })).status, 400);
  assert.equal((await gal(LIVING, editorCookie)).json.items.length, 2);
});

test('limit: 20 photos per person; the 21st is refused with "Tối đa 20 ảnh."', { skip }, async () => {
  for (let i = 3; i <= 20; i++) assert.equal((await add(LIVING, { url: up(), caption: `Ảnh ${i}` })).status, 200, `photo ${i}`);
  const list = await gal(LIVING, editorCookie);
  assert.equal(list.json.items.length, 20);
  const over = await add(LIVING, { url: up() });
  assert.equal(over.status, 400);
  assert.equal(over.json.error, 'Tối đa 20 ảnh.');
});

test('set profile: another photo becomes the profile; the old one stops; data.photo follows; exactly one profile', { skip }, async () => {
  const list = (await gal(LIVING, editorCookie)).json.items;
  const target = list[4];
  const r = await call('POST', `/api/persons/${LIVING}/photos/${target.id}/profile?family=${FAM}`, {}, editorCookie);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.profile, target.url);
  assert.equal((await data(LIVING)).photo, target.url);
  const after = (await gal(LIVING, editorCookie)).json.items;
  assert.equal(after.filter((x) => x.is_profile).length, 1);
  assert.equal(after.find((x) => x.is_profile).id, target.id);
  assert.equal((await call('POST', `/api/persons/${LIVING}/photos/${'0'.repeat(24)}/profile?family=${FAM}`, {}, editorCookie)).status, 404);
});

test('caption and year are edited; the photo itself stays', { skip }, async () => {
  const list = (await gal(LIVING, editorCookie)).json.items;
  const p = list[1];
  const r = await call('PUT', `/api/persons/${LIVING}/photos/${p.id}?family=${FAM}`, { caption: 'Sửa chú thích', year: '1990' }, editorCookie);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.photo.caption, 'Sửa chú thích');
  assert.equal(r.json.photo.year, 1990);
  assert.equal(r.json.photo.url, p.url);
  assert.equal((await call('PUT', `/api/persons/${LIVING}/photos/${p.id}?family=${FAM}`, { caption: 'a', year: 'abc' }, editorCookie)).status, 400);
});

test('remove goes to the trash; removing the profile photo moves the profile; restore brings the photo and the profile back', { skip }, async () => {
  const before = (await gal(LIVING, editorCookie)).json.items;
  const profile = before.find((x) => x.is_profile);
  const r = await call('POST', `/api/persons/${LIVING}/photos/${profile.id}/delete?family=${FAM}`, {}, editorCookie);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.deleted.id, profile.id);
  assert.ok(r.json.trash_id, 'a trash id is returned');
  const left = (await gal(LIVING, editorCookie)).json.items;
  assert.equal(left.length, 19);
  assert.ok(!left.some((x) => x.id === profile.id));
  assert.equal(left.filter((x) => x.is_profile).length, 1, 'another photo took the profile');
  assert.equal((await data(LIVING)).photo, r.json.profile);
  const t = await pool.query('select kind, item_id, state from trash where id=$1', [r.json.trash_id]);
  assert.deepEqual(t.rows[0], { kind: 'photo', item_id: profile.id, state: 'trash' });
  // the removed photo is no longer served (no record shows it)
  const img = await call('GET', profile.url, undefined, editorCookie);
  assert.equal(img.status, 404, 'a removed photo is not served');
  const restored = await call('POST', `/api/trash/${r.json.trash_id}/restore?family=${FAM}`, {}, editorCookie);
  assert.equal(restored.status, 200, restored.text);
  const back = (await gal(LIVING, editorCookie)).json.items;
  assert.equal(back.length, 20);
  assert.equal(back.find((x) => x.id === profile.id).is_profile, true, 'the restored photo is the profile again');
  assert.equal(back.filter((x) => x.is_profile).length, 1);
  assert.equal((await data(LIVING)).photo, profile.url);
  assert.equal((await call('GET', profile.url, undefined, editorCookie)).status, 200);
});

test('privacy: a living person\'s gallery and photos are 404 to guests and non-members; members and editors see them', { skip }, async () => {
  const list = (await gal(LIVING, editorCookie)).json.items;
  const p = list[0];
  assert.equal((await gal(LIVING)).status, 404, 'guest: the gallery of a living person is not shown');
  assert.equal((await gal(LIVING, memberCookie)).status, 200, 'member sees it');
  const guestImg = await call('GET', p.url);
  assert.equal(guestImg.status, 404, 'guest: the photo itself is 404');
  assert.doesNotMatch((await gal(LIVING)).text, /api\/photos|anh-gia-pha/, 'no photo link leaves the server for a guest');
  assert.equal((await call('GET', p.url, undefined, memberCookie)).status, 200, 'member: the photo is served');
});

test('a deceased person\'s gallery is shown to guests of the family', { skip }, async () => {
  const a = up();
  assert.equal((await add(DEAD, { url: a, caption: 'Ảnh cũ', year: 1950 })).status, 200);
  const guest = await gal(DEAD);
  assert.equal(guest.status, 200);
  assert.equal(guest.json.items[0].url, a);
  assert.equal((await call('GET', a)).status, 200, 'the photo of a deceased person is served to guests');
});

test('only editors write: guests get 401, members 403; the image of an unknown id is 404', { skip }, async () => {
  assert.equal((await add(DEAD, { url: up() }, null)).status, 401);
  assert.equal((await add(DEAD, { url: up() }, memberCookie)).status, 403);
  assert.equal((await call('POST', `/api/persons/${DEAD}/photos/x/delete?family=${FAM}`, {}, memberCookie)).status, 403);
  assert.equal((await call('GET', '/api/photos/' + '0'.repeat(24))).status, 404);
});

test('migration: an old single `photo` becomes the profile photo of the gallery, once (re-running changes nothing)', { skip }, async () => {
  const old = up();
  await pool.query("update persons set data = jsonb_set(data, '{photo}', to_jsonb($2::text)) where id=$1 and family_id=$3", [OLD, old, FAM]);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '040_person_photos.sql'), 'utf8');
  await pool.query(sql);
  await pool.query(sql);
  const rows = (await pool.query('select url, is_profile from person_photos where family_id=$1 and person_id=$2', [FAM, OLD])).rows;
  assert.deepEqual(rows, [{ url: old, is_profile: true }], 'one row, the profile photo, after two runs');
  assert.equal((await data(OLD)).photo, old, 'the old photo field stays readable');
  const shown = await gal(OLD);
  assert.equal(shown.json.items[0].url, old);
});

test('the form\'s photo field goes through the gallery: a new link is added and becomes the profile; an existing one is reused; empty clears the profile', { skip }, async () => {
  const op = (n, photo) => call('POST', `/api/ops?family=${FAM}`, { ops: [{ op_id: `gal-form-${TAG}-${n}`, id: DEAD, fields: { photo } }] }, editorCookie);
  const before = (await gal(DEAD, editorCookie)).json.items;
  assert.equal(before.length, 1);
  const first = before[0];
  const fresh = up();
  const r1 = await op(1, fresh);
  assert.deepEqual(r1.json.applied, [`gal-form-${TAG}-1`], JSON.stringify(r1.json));
  let list = (await gal(DEAD, editorCookie)).json.items;
  assert.equal(list.length, 2, 'the new link is a gallery photo');
  assert.equal(list.find((x) => x.is_profile).url, fresh, 'and the profile photo');
  assert.equal((await data(DEAD)).photo, fresh, 'data.photo follows the profile');
  const r2 = await op(2, first.url); // an existing photo of the gallery: reused, not added
  assert.deepEqual(r2.json.applied, [`gal-form-${TAG}-2`]);
  list = (await gal(DEAD, editorCookie)).json.items;
  assert.equal(list.length, 2, 'no duplicate row');
  assert.equal(list.find((x) => x.is_profile).url, first.url);
  assert.equal((await data(DEAD)).photo, first.url);
  const r3 = await op(3, '');
  assert.deepEqual(r3.json.applied, [`gal-form-${TAG}-3`]);
  list = (await gal(DEAD, editorCookie)).json.items;
  assert.equal(list.length, 2, 'the gallery photos stay');
  assert.equal(list.filter((x) => x.is_profile).length, 0, 'no profile photo');
  assert.equal((await data(DEAD)).photo, undefined, 'data.photo is removed');
});

test('the form\'s photo field respects the 20-photo limit: the op is rejected with the reason, nothing changes', { skip }, async () => {
  const full = (await gal(LIVING, editorCookie)).json.items;
  assert.equal(full.length, 20);
  const before = (await data(LIVING)).photo;
  const r = await call('POST', `/api/ops?family=${FAM}`, { ops: [{ op_id: `gal-full-${TAG}`, id: LIVING, fields: { photo: up() } }] }, editorCookie);
  assert.deepEqual(r.json.applied, []);
  assert.deepEqual(r.json.rejected, [{ op_id: `gal-full-${TAG}`, reason: 'Tối đa 20 ảnh.' }]);
  assert.equal((await gal(LIVING, editorCookie)).json.items.length, 20);
  assert.equal((await data(LIVING)).photo, before, 'the person is unchanged');
});
