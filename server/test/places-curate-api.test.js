// Places step 3 on a scratch database: an editor adds a place (pending, one enrichment job); the worker step runs
// on recorded open-data answers (no network); a curator accepts or rejects each suggestion, an accepted one only
// fills an empty field (our copy wins); GeoNames data is credited; failures back off and stop after 3 tries; the VN
// import seeds units from a local file and is idempotent. Invented names only.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const E = require('../places-enrich');
const { importUnits } = require('../scripts/places-import-vn');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FA = 'plc-' + TAG;
const OWNER = `own.${TAG}@example.test`; const ED = `ed.${TAG}@example.test`; const OUT = `out.${TAG}@example.test`;
let base, pool, close; const ck = {}; const ID = {};
const FX = (f) => require(path.join(__dirname, 'fixtures', 'places', f));
const fetchJson = async (url) => {
  if (url.includes('wbsearchentities')) return FX('wikidata-search.json');
  if (url.startsWith('https://query.wikidata.org/sparql')) return FX('wikidata-sparql.json');
  if (url.includes('geonames.org/searchJSON')) return FX('geonames-search.json');
  throw new Error('unexpected ' + url);
};

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ Thử Địa Danh','試','public')", [FA]);
  await pool.query(`insert into members (email, name, role, status, family_id) values ($1,'o','owner','active',$3), ($2,'e','editor','active',$3)`, [OWNER, ED, FA]);
  // leftovers of an earlier run would hold the fixture ids (unique): clear them
  await pool.query("delete from places where wikidata_id = 'Q9990001' or geonames_id = 9990101");
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.owner = await session(OWNER); ck.ed = await session(ED); ck.out = await session(OUT);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from places where created_by = any($1)', [[OWNER, ED]]);
  await pool.query('delete from members where family_id = $1', [FA]);
  await pool.query('delete from families where id = $1', [FA]);
  await close(); await pool.end();
});

test('an editor adds a place: pending, one job queued; the same name again returns it; guests and outsiders refused', { skip }, async () => {
  const r = await call('POST', '/api/places', { family: FA, name: 'Xã Bến Lúa', kind: 'commune' }, ck.ed);
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.status, 'pending'); assert.equal(r.json.existing, false);
  ID.place = r.json.id;
  const jobs = (await pool.query('select status, tries from places_enrich_jobs where place_id=$1', [ID.place])).rows;
  assert.deepEqual(jobs, [{ status: 'queued', tries: 0 }]);
  const again = await call('POST', '/api/places', { family: FA, name: 'xã bến lúa', kind: 'commune' }, ck.ed);
  assert.deepEqual([again.json.id, again.json.existing], [ID.place, true]);
  assert.equal((await call('POST', '/api/places', { family: FA, name: 'Xã Khác', kind: 'commune' })).status, 401);
  assert.equal((await call('POST', '/api/places', { family: FA, name: 'Xã Khác', kind: 'commune' }, ck.out)).status, 403);
  assert.equal((await call('POST', '/api/places', { family: FA, name: 'X', kind: 'commune' }, ck.ed)).status, 400);
  assert.equal((await call('POST', '/api/places', { family: FA, name: 'Xã Khác', kind: 'planet' }, ck.ed)).status, 400);
});

test('worker step on recorded answers: suggestions from both sources, job done; nothing else due', { skip }, async () => {
  await pool.query("update places_enrich_jobs set next_at = now() - interval '1 second' where place_id=$1", [ID.place]);
  const r = await E.runOnce(pool, { fetchJson, geonamesUser: 'demo' });
  assert.equal(r.status, 'done'); assert.equal(r.suggestions, 6);
  assert.equal((await pool.query('select status from places_enrich_jobs where place_id=$1', [ID.place])).rows[0].status, 'done');
  const s = (await pool.query('select source, field from place_suggestions where place_id=$1 order by source, field', [ID.place])).rows.map((x) => `${x.source}:${x.field}`);
  assert.deepEqual(s, ['geonames:coords', 'geonames:geonames_id', 'geonames:name', 'wikidata:coords', 'wikidata:name', 'wikidata:wikidata_id']);
});

test('curator queue: editors refused; owner sees the place with its suggestions', { skip }, async () => {
  assert.equal((await call('GET', '/api/places/pending')).status, 401);
  assert.equal((await call('GET', '/api/places/pending', undefined, ck.ed)).status, 403);
  const r = await call('GET', '/api/places/pending', undefined, ck.owner);
  assert.equal(r.status, 200);
  const it = r.json.items.find((x) => x.id === ID.place);
  assert.ok(it && it.name === 'Xã Bến Lúa' && it.suggestions.length === 6);
  assert.ok(!('created_by' in it), 'no editor email in the queue');
  ID.sug = Object.fromEntries(it.suggestions.map((x) => [`${x.source}:${x.field}`, x.id]));
});

test('accept fills empty fields only; a second value for a filled field is kept out; names carry source + licence', { skip }, async () => {
  const acc = (k) => call('POST', `/api/place-suggestions/${ID.sug[k]}/accept`, undefined, ck.owner);
  assert.deepEqual((await acc('wikidata:wikidata_id')).json, { ok: true, status: 'accepted', applied: true });
  assert.equal((await acc('geonames:coords')).json.applied, true);
  const second = await acc('wikidata:coords');
  assert.deepEqual([second.json.status, second.json.applied], ['rejected', false], 'coordinates were filled already: ours wins');
  assert.equal((await acc('geonames:name')).json.applied, true);
  assert.equal((await call('POST', `/api/place-suggestions/${ID.sug['wikidata:name']}/reject`, undefined, ck.owner)).json.status, 'rejected');
  assert.equal((await acc('wikidata:name')).status, 409, 'decided once');
  assert.equal((await call('POST', `/api/place-suggestions/${ID.sug['geonames:geonames_id']}/accept`, undefined, ck.ed)).status, 403);
  const p = (await pool.query('select wikidata_id, lat, lon, coords_source from places where id=$1', [ID.place])).rows[0];
  assert.deepEqual(p, { wikidata_id: 'Q9990001', lat: 10.751, lon: 106.502, coords_source: 'geonames' });
  const n = (await pool.query("select name, source, licence, is_primary from place_names where place_id=$1 and source like 'geonames:%'", [ID.place])).rows;
  assert.deepEqual(n, [{ name: 'Ben Lua Commune', source: 'geonames:9990101', licence: 'CC-BY-4.0', is_primary: false }]);
});

test('place page credits GeoNames; verify makes the place public', { skip }, async () => {
  assert.equal((await call('GET', `/api/places/${ID.place}`)).status, 404, 'pending: hidden from guests');
  const r = await call('GET', `/api/places/${ID.place}`, undefined, ck.ed);
  assert.deepEqual(r.json.attribution.map((a) => a.source), ['geonames']);
  assert.equal((await call('POST', `/api/places/${ID.place}/verify`, undefined, ck.ed)).status, 403);
  assert.equal((await call('POST', `/api/places/${ID.place}/verify`, undefined, ck.owner)).status, 200);
  assert.equal((await call('GET', `/api/places/${ID.place}`)).status, 200);
});

test('a failing lookup backs off, then stops after 3 tries', { skip }, async () => {
  const r = await call('POST', '/api/places', { family: FA, name: `Xóm Lỗi ${TAG}`, kind: 'hamlet' }, ck.ed);
  const id = r.json.id; const bad = async () => { throw new Error('HTTP 503 from example'); };
  const step = async () => {
    await pool.query("update places_enrich_jobs set next_at = now() - interval '1 second' where place_id=$1 and status='queued'", [id]);
    return E.runOnce(pool, { fetchJson: bad });
  };
  assert.equal((await step()).status, 'queued');
  const j1 = (await pool.query('select tries, next_at > now() as later, last_error from places_enrich_jobs where place_id=$1', [id])).rows[0];
  assert.deepEqual([j1.tries, j1.later, j1.last_error], [1, true, 'HTTP 503 from example']);
  assert.equal((await step()).status, 'queued');
  assert.equal((await step()).status, 'failed');
  assert.equal((await pool.query('select status, tries from places_enrich_jobs where place_id=$1', [id])).rows[0].tries, 3);
});

test('VN import from a local file: creates units with parents and old names; a second run changes nothing', { skip }, async () => {
  const units = FX('vn-units.json').units;
  const c = await pool.connect();
  try {
    await c.query('begin');
    const a = await importUnits(c, units, { source: 'import:test' });
    assert.deepEqual(a, { created: 3, filled: 0, names: 4, parents: 2, unchanged: 0 });
    const b = await importUnits(c, units, { source: 'import:test' });
    assert.deepEqual(b, { created: 0, filled: 0, names: 0, parents: 0, unchanged: 3 });
    const d = (await c.query("select p.status, p.wikidata_id from places p where p.official_code='T99-2'")).rows[0];
    assert.deepEqual(d, { status: 'verified', wikidata_id: 'Q9990301' });
    await assert.rejects(importUnits(c, [{ code: 'Z1', name: 'X', kind: 'district', parent_code: 'NOPE' }]), /parent NOPE not found/);
  } finally { await c.query('rollback'); c.release(); }
});
