// Clan step 1 on the families API: short name, founder (thủy tổ), quê gốc, branch generation, manual branch order.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `clan-${TAG}`; const OTHER = `clan2-${TAG}`;
const ADMIN = `admin.${TAG}@example.test`; const EDITOR = `editor.${TAG}@example.test`;
let base, pool, close; const cookies = {}; const P = {};

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const [id, name] of [[FAM, 'Họ Dương'], [OTHER, 'Họ Dương']]) await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,$2,'楊','public')", [id, name]);
  P.root = 'N' + crypto.randomUUID().slice(0, 13); P.elsewhere = 'N' + crypto.randomUUID().slice(0, 13);
  await pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3), ($4,$5,'test',$6)",
    [P.root, { name: 'Ông Tổ ' + TAG, gen: 1, sex: 'm' }, FAM, P.elsewhere, { name: 'Người khác ' + TAG, gen: 1, sex: 'm' }, OTHER]);
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,'a','admin','active',$3), ($2,'e','editor','active',$3)", [ADMIN, EDITOR, FAM]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  cookies.admin = await session(ADMIN); cookies.editor = await session(EDITOR);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from members where family_id = any($1)', [[FAM, OTHER]]);
  await pool.query('delete from history where person_id = any($1)', [Object.values(P)]);
  await pool.query('delete from persons where id = any($1)', [Object.values(P)]);
  await pool.query('delete from families where id = any($1)', [[FAM, OTHER]]);
  await close(); await pool.end();
});

test('admin saves the overrides; GET returns them; null = automatic', { skip }, async () => {
  const before = await call('GET', `/api/families/${FAM}`, undefined, cookies.admin);
  assert.equal(before.json.branch_gen, null); assert.equal(before.json.short_name, null); assert.equal(before.json.branch_order, null);
  const r = await call('PATCH', `/api/families/${FAM}`, { short_name: 'Dương · Phú Mỹ', founder_person_id: P.root, origin_place: 'Phú Mỹ', branch_gen: 4, branch_order: ['b', 'a', 'b'] }, cookies.admin);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const g = await call('GET', `/api/families/${FAM}`, undefined, cookies.admin);
  assert.equal(g.json.short_name, 'Dương · Phú Mỹ'); assert.equal(g.json.founder_person_id, P.root); assert.equal(g.json.origin_place, 'Phú Mỹ');
  assert.equal(g.json.branch_gen, 4); assert.deepEqual(g.json.branch_order, ['b', 'a'], 'duplicates dropped');
  const reset = await call('PATCH', `/api/families/${FAM}`, { branch_order: null, short_name: '', founder_person_id: '', branch_gen: null }, cookies.admin);
  assert.equal(reset.status, 200, JSON.stringify(reset.json));
  for (const k of ['branch_order', 'short_name', 'founder_person_id', 'branch_gen']) assert.equal(reset.json.family[k], null, k + ' back to automatic');
  assert.equal(reset.json.family.origin_place, 'Phú Mỹ', 'quê gốc is kept');
});

test('validation: founder must be in this family, generation 1-30, order a list of ids; editors cannot edit', { skip }, async () => {
  assert.equal((await call('PATCH', `/api/families/${FAM}`, { founder_person_id: P.elsewhere }, cookies.admin)).status, 400);
  assert.equal((await call('PATCH', `/api/families/${FAM}`, { branch_gen: 0 }, cookies.admin)).status, 400);
  assert.equal((await call('PATCH', `/api/families/${FAM}`, { branch_gen: 'x' }, cookies.admin)).status, 400);
  assert.equal((await call('PATCH', `/api/families/${FAM}`, { branch_order: 'a,b' }, cookies.admin)).status, 400);
  assert.equal((await call('PATCH', `/api/families/${FAM}`, { branch_order: [1, 2] }, cookies.admin)).status, 400);
  assert.equal((await call('PATCH', `/api/families/${FAM}`, { short_name: 'x' }, cookies.editor)).status, 403);
});

test('search also matches the short name and quê gốc', { skip }, async () => {
  await call('PATCH', `/api/families/${FAM}`, { short_name: 'Dương Văn tộc ' + TAG, origin_place: 'Long Thạnh ' + TAG }, cookies.admin);
  const a = await call('GET', '/api/families?q=' + encodeURIComponent('văn tộc ' + TAG));
  assert.ok(a.json.items.some((f) => f.id === FAM));
  const b = await call('GET', '/api/families?q=' + encodeURIComponent('long thạnh ' + TAG));
  assert.ok(b.json.items.some((f) => f.id === FAM));
});
