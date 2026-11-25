// P1 living-person privacy: a living person's places and history go to members only (the events rule, seeLife), and an
// editor code of one tree does not accept a link into another tree. Needs a SCRATCH database:
// GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise). Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const PUB = `lvp-${TAG}`; const PUB2 = `lvq-${TAG}`;
const OWNER = `owner.${TAG}@example.test`; const OUT = `out.${TAG}@example.test`;
const CODE = 'p1-code-' + crypto.randomBytes(4).toString('hex');
let base, pool, close, placeId;
const ck = {}; const P = {};
const nid = () => 'N' + crypto.randomUUID().slice(0, 13);

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, headers: r.headers };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `Tester:${PUB}:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query(`insert into families (id, slug, name, han, visibility) values ($1,$1,'Privacy Test One','','public'), ($2,$2,'Privacy Test Two','','public')`, [PUB, PUB2]);
  Object.assign(P, { living: nid(), dead: nid(), other: nid() });
  const ins = (id, data, fam) => pool.query('insert into persons (id, data, updated_by, family_id) values ($1,$2,$3,$4)', [id, data, 'test', fam]);
  await ins(P.living, { name: 'Living Test Person', sex: 'm', born: '1980' }, PUB);
  await ins(P.dead, { name: 'Deceased Test Person', sex: 'f', born: '1900', died: '1950' }, PUB);
  await ins(P.other, { name: 'Other Test Person', sex: 'f', born: '1901', died: '1951' }, PUB2);
  await pool.query(`insert into members (email, name, role, status, family_id) values ($1,'o','owner','active',$2), ($1,'o','owner','active',$3)`, [OWNER, PUB, PUB2]);
  const pl = await pool.query("insert into places (kind, status, created_by) values ('village','verified','test-" + TAG + "') returning id");
  placeId = pl.rows[0].id;
  await pool.query("insert into place_names (place_id, name, name_fold, lang) values ($1, 'Village Test Place', 'village test place', 'en')", [placeId]);
  for (const id of [P.living, P.dead]) {
    await pool.query("insert into person_places (person_id, field, place_id, as_written) values ($1,'birth_place',$2,'Village Test Place')", [id, placeId]);
    await pool.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'born',$2,$3,'test')", [id, JSON.stringify('1970'), JSON.stringify('1980')]);
  }
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.owner = await session(OWNER); ck.out = await session(OUT);
});
test.after(async () => {
  if (skip) return;
  const ids = Object.values(P);
  await pool.query('delete from person_links where a_family = any($1) or b_family = any($1)', [[PUB, PUB2]]);
  await pool.query('delete from person_places where person_id = any($1)', [ids]);
  await pool.query('delete from history where person_id = any($1)', [ids]);
  await pool.query('delete from persons where id = any($1)', [ids]);
  await pool.query('delete from places where id = $1', [placeId]);
  await pool.query('delete from members where family_id = any($1)', [[PUB, PUB2]]);
  await pool.query('delete from families where id = any($1)', [[PUB, PUB2]]);
  await close(); await pool.end();
});

test('living person: places hidden from a guest and a signed-in non-member; members see them; deceased stays visible', { skip }, async () => {
  const anon = await call('GET', `/api/persons/${P.living}/places?family=${PUB}`);
  assert.equal(anon.status, 200);
  assert.equal(anon.json.items.length, 0, 'anonymous guest: living place fields hidden');
  assert.equal(anon.json.hidden, true);
  const out = await call('GET', `/api/persons/${P.living}/places?family=${PUB}`, undefined, ck.out);
  assert.equal(out.json.items.length, 0, 'signed-in non-member: living place fields hidden');
  const mem = await call('GET', `/api/persons/${P.living}/places?family=${PUB}`, undefined, ck.owner);
  assert.equal(mem.json.items.length, 1, 'member: living place field present');
  assert.equal(mem.json.items[0].field, 'birth_place');
  const dead = await call('GET', `/api/persons/${P.dead}/places?family=${PUB}`);
  assert.equal(dead.json.items.length, 1, 'deceased person: place field visible to a guest');
});

test('living person: not listed at a place for a guest; members see them; deceased listed for a guest', { skip }, async () => {
  const anon = await call('GET', `/api/places/${placeId}/people?family=${PUB}`);
  assert.equal(anon.status, 200);
  const anonIds = anon.json.items.map((x) => x.person_id);
  assert.ok(!anonIds.includes(P.living), 'anonymous guest: living person absent from the place');
  assert.ok(anonIds.includes(P.dead), 'deceased person still listed for a guest');
  const mem = await call('GET', `/api/places/${placeId}/people?family=${PUB}`, undefined, ck.owner);
  assert.ok(mem.json.items.map((x) => x.person_id).includes(P.living), 'member: living person listed');
});

test('living person: history hidden from a guest; members see it; deceased history visible to a guest', { skip }, async () => {
  const anon = await call('GET', `/api/history/${P.living}`);
  assert.equal(anon.status, 200);
  assert.deepEqual(anon.json, [], 'anonymous guest: living history hidden');
  const out = await call('GET', `/api/history/${P.living}`, undefined, ck.out);
  assert.deepEqual(out.json, [], 'signed-in non-member: living history hidden');
  const mem = await call('GET', `/api/history/${P.living}`, undefined, ck.owner);
  assert.ok(mem.json.length >= 1, 'member: living history present');
  const dead = await call('GET', `/api/history/${P.dead}`);
  assert.ok(dead.json.length >= 1, 'deceased history visible to a guest');
});

test('editor code of one tree does not accept a link into another tree it does not manage', { skip }, async () => {
  const cookie = (await call('POST', '/api/login', { code: CODE })).headers.get('set-cookie').split(';')[0];
  const r = await call('POST', '/api/links', { family: PUB, person: P.dead, other_family: PUB2, other_person: P.other, reason: 'p1 test' }, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.status, 'pending', 'the code is not the owner of the other tree: the link waits');
  const ok = await call('POST', `/api/links/${r.json.id}/accept`, undefined, ck.owner);
  assert.equal(ok.status, 200, 'the owner of the other tree decides');
  assert.equal(ok.json.status, 'accepted');
});
