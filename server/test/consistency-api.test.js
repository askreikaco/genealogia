// Consistency checker API (consistency-routes.js) on a scratch database: members see the issues, guests and
// non-members are refused, an editor can ignore an issue and bring it back (ignore round-trip), a member cannot.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise). Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FA = `cka-${TAG}`; const FP = `ckp-${TAG}`;
const OWNER = `owner.${TAG}@example.test`; const ED = `ed.${TAG}@example.test`; const MEM = `mem.${TAG}@example.test`; const OUT = `out.${TAG}@example.test`;
const P = { dead: 'C' + crypto.randomUUID().slice(0, 12), kid: 'C' + crypto.randomUUID().slice(0, 12) };
let base, pool, close; const ck = {};

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
  await pool.query(`insert into families (id, slug, name, han, visibility) values ($1,$1,'Ho Thu Cong Khai','X','public'), ($2,$2,'Ho Thu Rieng','X','private')`, [FA, FP]);
  // the dead person is born 1950 and died 1940: death before birth (error)
  await pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3), ($4,$5,'test',$3)",
    [P.dead, { name: 'Test Dead', sex: 'm', born: '1950', died: '1940' }, FA, P.kid, { name: 'Test Kid', sex: 'm', born: '1980' }]);
  await pool.query(`insert into members (email, name, role, status, family_id) values ($1,'o','owner','active',$4), ($2,'e','editor','active',$4), ($3,'m','member','active',$4), ($1,'o','owner','active',$5)`, [OWNER, ED, MEM, FA, FP]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.ed = await session(ED); ck.mem = await session(MEM); ck.out = await session(OUT);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from consistency_ignores where tree_id = any($1)', [[FA, FP]]);
  await pool.query('delete from members where family_id = any($1)', [[FA, FP]]);
  await pool.query('delete from persons where id = any($1)', [Object.values(P)]);
  await pool.query('delete from families where id = any($1)', [[FA, FP]]);
  await close(); await pool.end();
});

test('guest is refused (401) and a signed-in non-member gets 403, no issues shown', { skip }, async () => {
  const g = await call('GET', `/api/trees/${FA}/consistency`);
  assert.strictEqual(g.status, 401); assert.ok(!g.json.issues);
  const o = await call('GET', `/api/trees/${FA}/consistency`, undefined, ck.out);
  assert.strictEqual(o.status, 403); assert.ok(!o.json.issues);
});
test('member sees the death-before-birth error and counts', { skip }, async () => {
  const r = await call('GET', `/api/trees/${FA}/consistency`, undefined, ck.mem);
  assert.strictEqual(r.status, 200);
  const hit = r.json.issues.find((i) => i.rule === 'death_before_birth');
  assert.ok(hit); assert.strictEqual(hit.severity, 'error'); assert.deepStrictEqual(hit.personIds, [P.dead]);
  assert.ok(r.json.counts.error >= 1);
});
test('ignore round-trip: an editor hides the issue, it moves to ignored, and DELETE brings it back', { skip }, async () => {
  const body = { rule: 'death_before_birth', person_ids: [P.dead] };
  const bad = await call('POST', `/api/trees/${FA}/consistency/ignore`, { rule: 'nope', person_ids: [P.dead] }, ck.ed);
  assert.strictEqual(bad.status, 400);
  const mem = await call('POST', `/api/trees/${FA}/consistency/ignore`, body, ck.mem);
  assert.strictEqual(mem.status, 403);
  assert.strictEqual((await call('POST', `/api/trees/${FA}/consistency/ignore`, body, ck.ed)).status, 200);
  const a = await call('GET', `/api/trees/${FA}/consistency`, undefined, ck.ed);
  assert.ok(!a.json.issues.some((i) => i.rule === 'death_before_birth'));
  assert.ok(a.json.ignored.some((i) => i.rule === 'death_before_birth'));
  assert.strictEqual((await call('DELETE', `/api/trees/${FA}/consistency/ignore`, body, ck.ed)).status, 200);
  const b = await call('GET', `/api/trees/${FA}/consistency`, undefined, ck.ed);
  assert.ok(b.json.issues.some((i) => i.rule === 'death_before_birth'));
});
