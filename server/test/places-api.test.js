// Places gazetteer read API on a scratch database: search by today's and historical names without accents, label
// with today's parents, pending places hidden from guests, one place with its names / parents / changes.
// Invented names only. Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const R = require('../places-rules');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
let base, pool, close, cookie; const ID = {};

async function get(p, ck) {
  const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} });
  return { status: r.status, json: await r.json().catch(() => null) };
}

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const place = async (kind, status = 'verified') => (await pool.query('insert into places (kind, status, created_by) values ($1,$2,$3) returning id', [kind, status, 'test-' + TAG])).rows[0].id;
  const name = (id, n, from, to, primary = true, lang = 'vi') => pool.query(
    'insert into place_names (place_id, name, name_fold, lang, valid_from, valid_to, is_primary) values ($1,$2,$3,$4,$5,$6,$7)', [id, n, R.fold(n), lang, from, to, primary]);
  ID.prov = await place('province'); ID.dist = await place('district'); ID.com = await place('commune'); ID.newProv = await place('province');
  ID.pend = await place('village', 'pending');
  await name(ID.prov, `Tỉnh Mây ${TAG}`, '1832', '2025-06-30');
  await name(ID.newProv, `Tỉnh Sông Lớn ${TAG}`, '2025-07-01', null);
  await name(ID.dist, `Huyện Đồi ${TAG}`, '1900', '2025-06-30');
  await name(ID.com, `Xã Bến Lúa ${TAG}`, '1956', null);
  await name(ID.com, `Làng Bến Thóc ${TAG}`, '1700', '1956', false);
  await name(ID.com, `渡谷 ${TAG}`, '1700', '1956', false, 'han');
  await name(ID.pend, `Xóm Chờ ${TAG}`, null, null);
  await pool.query(`insert into place_parents (place_id, parent_id, valid_from, valid_to) values
    ($1,$2,'1956','2025-06-30'), ($1,$3,'2025-07-01',null), ($2,$4,'1900','2025-06-30')`, [ID.com, ID.dist, ID.newProv, ID.prov]);
  await pool.query("insert into place_events (place_id, date, kind, other_place_id) values ($1,'2025-07-01','merged_into',$2)", [ID.prov, ID.newProv]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  cookie = (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `p.${TAG}@example.test`, name: 'p' }) })).headers.get('set-cookie').split(';')[0];
});
test.after(async () => {
  if (skip) return;
  await pool.query("delete from places where created_by = $1", ['test-' + TAG]);
  await close(); await pool.end();
});

test('search: today\'s name without accents; label uses today\'s parents', { skip }, async () => {
  const r = await get(`/api/places?q=${encodeURIComponent('xa ben lua ' + TAG)}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.items.length, 1);
  const it = r.json.items[0];
  assert.equal(it.id, ID.com); assert.equal(it.name, `Xã Bến Lúa ${TAG}`);
  assert.equal(it.label, `Xã Bến Lúa ${TAG}, Tỉnh Sông Lớn ${TAG}`, 'after the reform: no district, the new province');
  assert.ok(!it.matched_era);
});

test('search: a historical name finds the place and says which era matched', { skip }, async () => {
  const r = await get(`/api/places?q=${encodeURIComponent('Lang Ben Thoc ' + TAG)}`);
  assert.equal(r.json.items.length, 1);
  assert.equal(r.json.items[0].id, ID.com);
  assert.equal(r.json.items[0].matched, `Làng Bến Thóc ${TAG}`);
  assert.deepEqual(r.json.items[0].matched_era, ['1700', '1956']);
  assert.equal(r.json.items[0].name, `Xã Bến Lúa ${TAG}`, 'shows today\'s name');
});

test('search: short queries return nothing; pending places only for signed-in people', { skip }, async () => {
  assert.deepEqual((await get('/api/places?q=x')).json.items, []);
  assert.equal((await get(`/api/places?q=${encodeURIComponent('xom cho ' + TAG)}`)).json.items.length, 0);
  assert.equal((await get(`/api/places?q=${encodeURIComponent('xom cho ' + TAG)}`, cookie)).json.items.length, 1);
  assert.equal((await get(`/api/places/${ID.pend}`)).status, 404);
  assert.equal((await get(`/api/places/${ID.pend}`, cookie)).status, 200);
});

test('one place: names over time, parents over time, changes; bad ids refused', { skip }, async () => {
  const r = await get(`/api/places/${ID.com}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.names.length, 3);
  assert.deepEqual(r.json.parents.map((x) => x.name), [`Huyện Đồi ${TAG}`, `Tỉnh Sông Lớn ${TAG}`]);
  const prov = await get(`/api/places/${ID.prov}`);
  assert.equal(prov.json.events[0].kind, 'merged_into');
  assert.equal(prov.json.events[0].other_name, `Tỉnh Sông Lớn ${TAG}`);
  assert.equal(prov.json.name, `Tỉnh Mây ${TAG}`, 'a closed name is still shown when it is the only one');
  assert.equal((await get('/api/places/abc')).status, 400);
  assert.equal((await get('/api/places/999999999')).status, 404);
});
