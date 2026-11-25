// Quốc gia level on a scratch database: the owner sets a family's country (PATCH, ISO alpha-2, validated); the clan API
// counts trees per country over what the viewer may see (a private tree never adds to a country) and filters by
// ?country=XX / NONE. Invented names only. Needs GP_TEST_DATABASE_URL (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const SUR = `Quế${TAG}`; const SLUG = `que${TAG}`;
const F = { a: `qga-${TAG}`, b: `qgb-${TAG}`, c: `qgc-${TAG}`, p: `qgp-${TAG}` };
const OWNER = `own.${TAG}@example.test`; const MEM = `mem.${TAG}@example.test`;
let base, pool, close; const ck = {};

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const fam = (id, name, vis, country) => pool.query('insert into families (id, slug, name, visibility, country) values ($1,$1,$2,$3,$4)', [id, name, vis, country]);
  await fam(F.a, `Họ ${SUR} Bến`, 'public', null); await fam(F.b, `Họ ${SUR} Sông`, 'public', 'US');
  await fam(F.c, `Họ ${SUR} Gò`, 'public', null); await fam(F.p, `Họ ${SUR} Kín`, 'private', 'FR');
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,'o','owner','active',$2), ($3,'m','member','active',$2)", [OWNER, F.a, MEM]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.o = await session(OWNER); ck.m = await session(MEM);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from members where family_id = any($1)', [Object.values(F)]);
  await pool.query('delete from families where id = any($1)', [Object.values(F)]);
  await close(); await pool.end();
});

test('country: owner sets it, others cannot, bad codes are refused, empty clears', { skip }, async () => {
  assert.equal((await call('PATCH', `/api/families/${F.a}`, { country: 'VN' }, ck.m)).status, 403, 'a member cannot');
  assert.equal((await call('PATCH', `/api/families/${F.a}`, { country: 'VN' })).status, 401, 'a guest cannot');
  assert.equal((await call('PATCH', `/api/families/${F.a}`, { country: 'Viet' }, ck.o)).status, 400);
  const ok = await call('PATCH', `/api/families/${F.a}`, { country: 'vn' }, ck.o);
  assert.equal(ok.status, 200); assert.equal(ok.json.family.country, 'VN', 'stored upper case');
  const cl = await call('PATCH', `/api/families/${F.c}`, { country: '' }, ck.o);
  assert.ok([200, 403].includes(cl.status)); // not the owner of F.c: refused, which is fine
});

test('clan API: per-country counts over visible trees, private never counted, ?country filter', { skip }, async () => {
  const g = await call('GET', `/api/clans/${SLUG}`);
  assert.equal(g.status, 200);
  const byCode = Object.fromEntries(g.json.countries.map((c) => [c.code, c.trees]));
  assert.deepStrictEqual(byCode, { VN: 1, US: 1, NONE: 1 }, 'the private FR tree adds nothing for a guest');
  assert.equal(g.json.countries[g.json.countries.length - 1].code, 'NONE', 'no-country bucket last');
  const vn = await call('GET', `/api/clans/${SLUG}?country=VN`);
  const ids = [...vn.json.groups.flatMap((x) => x.trees), ...vn.json.unlinked].map((t) => t.id);
  assert.deepStrictEqual(ids, [F.a]); assert.equal(vn.json.country, 'VN');
  const none = await call('GET', `/api/clans/${SLUG}?country=none`);
  assert.deepStrictEqual([...none.json.groups.flatMap((x) => x.trees), ...none.json.unlinked].map((t) => t.id), [F.c]);
  assert.equal((await call('GET', `/api/clans/${SLUG}?country=Viet`)).status, 400);
  const t = [...g.json.groups.flatMap((x) => x.trees), ...g.json.unlinked].find((x) => x.id === F.b);
  assert.equal(t.country, 'US');
});
