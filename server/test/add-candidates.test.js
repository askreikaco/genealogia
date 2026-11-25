// The add flow's duplicate check (web/js/addflow.js): candidatesFor (match-rules, pure) and POST /api/persons/candidates
// (match-routes) on a scratch database: same scoring as the dupes tool, a guest sees deceased people only, a private
// tree is not read by a guest. Invented names only. The API part needs GP_TEST_DATABASE_URL (a SCRATCH database).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const R = require('../match-rules');

test('candidatesFor: the same name, sex and birth year is a candidate; a namesake of another generation is not', () => {
  const people = [
    R.toCtx('P1', 'fa', { name: 'Lý Văn Minh', sex: 'm', born: '1950' }),
    R.toCtx('P2', 'fa', { name: 'Lý Văn Minh', sex: 'm', born: '1985' }), // another generation
    R.toCtx('P3', 'fa', { name: 'Lý Thị Minh', sex: 'f', born: '1950' }), // other sex and given name
  ];
  const hits = R.candidatesFor(people, { name: 'Lý Văn Minh', sex: 'm', born: '1950' });
  assert.deepStrictEqual(hits.map((h) => h.id), ['P1']);
  assert.ok(hits[0].score >= R.MIN, `score ${hits[0].score} at or above the bar`);
});

test('candidatesFor: a name alone (no other evidence) stays below the bar', () => {
  const people = [R.toCtx('P1', 'fa', { name: 'Hồ Văn Nam', sex: 'm' })];
  assert.deepStrictEqual(R.candidatesFor(people, { name: 'Hồ Văn Nam', sex: 'm' }), []);
});

test('candidatesFor: a different family name never matches; an empty name matches nobody', () => {
  const people = [R.toCtx('P1', 'fa', { name: 'Ngô Văn Thuận', sex: 'm', born: '1960' })];
  assert.deepStrictEqual(R.candidatesFor(people, { name: 'Đoàn Văn Thuận', sex: 'm', born: '1960' }), []);
  assert.deepStrictEqual(R.candidatesFor(people, { name: '', sex: 'm', born: '1960' }), []);
});

test('candidatesFor: best first and at most the limit', () => {
  const people = [1, 2, 3].map((i) => R.toCtx('Q' + i, 'fa', { name: 'Trịnh Văn Hải', sex: 'm', born: '1971' }));
  const all = R.candidatesFor(people, { name: 'Trịnh Văn Hải', sex: 'm', born: '1971' }, { limit: 10 });
  assert.equal(all.length, 3);
  const hits = R.candidatesFor(people, { name: 'Trịnh Văn Hải', sex: 'm', born: '1971' }, { limit: 2 });
  assert.equal(hits.length, 2);
  assert.ok(hits[0].score >= hits[1].score);
});

// ---- the endpoint, on a scratch database ----
const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FA = `cpa-${TAG}`; const FP = `cpp-${TAG}`;
const ED = `ed.${TAG}@example.test`;
let base; let pool; let close; const ck = {}; const ids = {};
const nid = () => 'N' + crypto.randomUUID().slice(0, 13);

async function post(p, body, cookie) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query(`insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ Lý Thử','李','public'), ($2,$2,'Họ Lý Riêng','李','private')`, [FA, FP]);
  Object.assign(ids, { live: nid(), dead: nid(), other: nid(), priv: nid() });
  const ins = (id, data, fam) => pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3)", [id, data, fam]);
  await ins(ids.live, { name: 'Lý Văn Sống', sex: 'm', born: '1960' }, FA);
  await ins(ids.dead, { name: 'Lý Văn Mất', sex: 'm', born: '1930', died: '1990' }, FA);
  await ins(ids.other, { name: 'Lý Văn Tách', sex: 'm', born: '1970' }, FA);
  await ins(ids.priv, { name: 'Lý Văn Kín', sex: 'm', born: '1955' }, FP);
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,'e','editor','active',$2)", [ED, FA]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.ed = await session(ED);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from members where family_id = any($1)', [[FA, FP]]);
  await pool.query('delete from history where person_id = any($1)', [Object.values(ids)]);
  await pool.query('delete from persons where id = any($1)', [Object.values(ids)]);
  await pool.query('delete from families where id = any($1)', [[FA, FP]]);
  await close(); await pool.end();
});

const data = { name: 'Lý Văn Sống', sex: 'm', born: '1960' };

test('endpoint: an editor sees the living match of the same tree, scored', { skip }, async () => {
  const r = await post('/api/persons/candidates', { family: FA, data }, ck.ed);
  assert.equal(r.status, 200);
  assert.equal(r.json.items[0].id, ids.live);
  assert.ok(r.json.items[0].score >= R.MIN);
  assert.equal(r.json.items[0].name, 'Lý Văn Sống');
  assert.ok(!r.json.items.some((x) => x.id === ids.priv), 'no person of another tree');
});

test('endpoint: a guest sees deceased matches only, never a living person', { skip }, async () => {
  const living = await post('/api/persons/candidates', { family: FA, data }, undefined);
  assert.equal(living.status, 200);
  assert.deepStrictEqual(living.json.items, [], 'the living match is hidden from a guest');
  const dead = await post('/api/persons/candidates', { family: FA, data: { name: 'Lý Văn Mất', sex: 'm', born: '1930' } }, undefined);
  assert.equal(dead.json.items[0].id, ids.dead, 'a deceased match is shown');
});

test('endpoint: a guest cannot read a private tree (403); an empty name gives no candidates', { skip }, async () => {
  const priv = await post('/api/persons/candidates', { family: FP, data }, undefined);
  assert.equal(priv.status, 403);
  const none = await post('/api/persons/candidates', { family: FA, data: { name: '', born: '1960' } }, ck.ed);
  assert.deepStrictEqual(none.json.items, []);
});
