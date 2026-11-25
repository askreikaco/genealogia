// Surname over time, API (surname-rules.js, server.js, clan-routes.js): a family's họ gốc is hidden from viewers its
// visibility does not allow (family read, search, clan view); a carried tree lists under its origin surname only for
// those viewers; hints go to editors only; names[] is written through /api/ops and validated; visitors do not see the
// reason of a change. Invented names only. Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FA = `sna-${TAG}`; const FB = `snb-${TAG}`;
const OWNER = `owner.${TAG}@example.test`; const ED = `ed.${TAG}@example.test`; const MEM = `mem.${TAG}@example.test`;
const pid = () => `P${crypto.randomInt(100000, 999999)}`; // person ids are P + digits (core.js validateOp)
const P_ROOT = pid(); const P_NEW = pid(); const P_OTHER = pid();
const ALL_P = [P_ROOT, P_NEW, P_OTHER];
let base, pool, close;
const ck = {};

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
  await pool.query(`insert into families (id, slug, name, han, visibility) values ($1,$1,$2,'阮','public'), ($3,$3,$4,'李','public')`,
    [FA, `Họ Nguyễn ${TAG}`, FB, `Họ Lý ${TAG}`]);
  await pool.query(`update families set origin_surname='Lý', origin_surname_han='李', origin_year='1232', origin_reason='Theo gia phả nhánh', origin_visibility='members' where id=$1`, [FA]);
  const ins = (id, data, fam) => pool.query('insert into persons (id, data, updated_by, family_id) values ($1,$2,$3,$4)', [id, data, 'test', fam]);
  await ins(P_ROOT, { name: 'Nguyễn Thử Gốc', sex: 'm', born: '1200', died: '1260', names: [
    { type: 'birth', surname: 'Lý', from: '1200', to: '1232', confidence: 'tradition' },
    { type: 'changed', surname: 'Nguyễn', given: 'Thử', from: '1232', reason: 'Đổi họ theo lệnh vua', source: 'gia phả nhánh', confidence: 'tradition' }] }, FA);
  await ins(P_NEW, { name: 'Nguyễn Thử Con', sex: 'm', born: '1240', parent: P_ROOT }, FA);
  await ins(P_OTHER, { name: 'Lý Văn Khác', sex: 'm', born: '1300' }, FB);
  await pool.query(`insert into members (email, name, role, status, family_id) values ($1,'o','owner','active',$4), ($2,'e','editor','active',$4), ($3,'m','member','active',$4),
    ($1,'o','owner','active',$5)`, [OWNER, ED, MEM, FA, FB]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.owner = await session(OWNER); ck.ed = await session(ED); ck.mem = await session(MEM);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from match_suggestions where a_family = any($1) or b_family = any($1)', [[FA, FB]]);
  await pool.query('delete from members where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from history where person_id = any($1)', [ALL_P]);
  await pool.query('delete from ops where person_id = any($1)', [ALL_P]);
  await pool.query('delete from persons where id = any($1)', [ALL_P]);
  await pool.query('delete from families where id = any($1)', [[FA, FB]]);
  if (close) await close();
  await pool.end();
});

test('family read: the họ gốc is shown only to the viewers its visibility allows', { skip }, async () => {
  const anon = await call('GET', `/api/families/${FA}`);
  assert.strictEqual(anon.status, 200);
  assert.ok(!('origin_surname' in anon.json), 'a visitor gets no origin surname');
  assert.ok(!('origin_reason' in anon.json), 'nor its reason');
  const mem = await call('GET', `/api/families/${FA}`, undefined, ck.mem);
  assert.strictEqual(mem.json.origin_surname, 'Lý');
  assert.strictEqual(mem.json.origin_surname_han, '李');
  assert.strictEqual(mem.json.origin_year, '1232');
  assert.strictEqual(mem.json.origin_visibility, 'members');
});

test('family write: only the owner or an admin sets the họ gốc; values are checked', { skip }, async () => {
  const denied = await call('PATCH', `/api/families/${FA}`, { origin_surname: 'Trần' }, ck.mem);
  assert.strictEqual(denied.status, 403);
  const badVis = await call('PATCH', `/api/families/${FA}`, { origin_visibility: 'world' }, ck.owner);
  assert.strictEqual(badVis.status, 400);
  const badHan = await call('PATCH', `/api/families/${FA}`, { origin_surname_han: 'Lý abc' }, ck.owner);
  assert.strictEqual(badHan.status, 400);
  const ok = await call('PATCH', `/api/families/${FA}`, { origin_surname: 'Lý', origin_reason: 'Theo gia phả nhánh, đã đối chiếu', origin_visibility: 'members' }, ck.owner);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.family.origin_reason, 'Theo gia phả nhánh, đã đối chiếu');
});

test('family search: a hidden họ gốc is not searchable by a visitor; a public one is', { skip }, async () => {
  const hidden = await call('GET', `/api/families?q=${encodeURIComponent('Lý')}`);
  assert.ok(!hidden.json.items.some((f) => f.id === FA), 'the Nguyễn tree is not found through its hidden origin');
  const pub = await call('PATCH', `/api/families/${FA}`, { origin_visibility: 'all' }, ck.owner);
  assert.strictEqual(pub.status, 200);
  const shown = await call('GET', `/api/families?q=${encodeURIComponent('Lý')}`);
  assert.ok(shown.json.items.some((f) => f.id === FA), 'found once the origin is public');
  await call('PATCH', `/api/families/${FA}`, { origin_visibility: 'members' }, ck.owner);
});

test('clan view: a carried tree is listed under its origin surname only for those who may see the origin', { skip }, async () => {
  const slugLy = 'ly';
  const anon = await call('GET', `/api/clans/${slugLy}`);
  assert.strictEqual(anon.status, 200);
  const anonIds = anon.json.groups.flatMap((g) => g.trees.map((t) => t.id)).concat(anon.json.unlinked.map((t) => t.id));
  assert.ok(anonIds.includes(FB), 'the Lý tree is listed');
  assert.ok(!anonIds.includes(FA), 'the Nguyễn tree that carried Lý is hidden from a visitor');
  const mem = await call('GET', `/api/clans/${slugLy}`, undefined, ck.mem);
  const memTrees = mem.json.groups.flatMap((g) => g.trees).concat(mem.json.unlinked);
  const carried = memTrees.find((t) => t.id === FA);
  assert.ok(carried, 'a member sees the carried tree');
  assert.deepStrictEqual([carried.change.from, carried.change.carried, carried.change.now], ['Lý', true, 'Nguyễn']);
  assert.strictEqual(carried.change.year, '1232');
});

test('clan view: the origin of a tree shows on its own surname page only for viewers allowed', { skip }, async () => {
  const anon = await call('GET', '/api/clans/nguyen');
  const trees = (j) => j.groups.flatMap((g) => g.trees).concat(j.unlinked);
  const a = trees(anon.json).find((t) => t.id === FA);
  assert.ok(a, 'the tree is listed under its own surname');
  assert.strictEqual(a.change, null, 'the origin is hidden from a visitor');
  const m = trees((await call('GET', '/api/clans/nguyen', undefined, ck.mem)).json).find((t) => t.id === FA);
  assert.deepStrictEqual([m.change.from, m.change.carried, m.change.now], ['Lý', false, 'Nguyễn']);
  assert.strictEqual(m.change.reason, 'Theo gia phả nhánh, đã đối chiếu');
});

test('clan view: the historical hints go to editors only, and are never assigned to a tree', { skip }, async () => {
  const anon = await call('GET', '/api/clans/ly');
  assert.deepStrictEqual(anon.json.hints, []);
  const ed = await call('GET', '/api/clans/ly', undefined, ck.ed);
  assert.ok(ed.json.hints.some((h) => h.id === 'ly-nguyen-1232'));
  for (const g of ed.json.groups) for (const t of g.trees) assert.strictEqual(t.hint, undefined);
});

test('names: an editor writes the timeline through /api/ops; a bad one is refused with a reason', { skip }, async () => {
  const good = [{ type: 'birth', surname: 'Lý', from: '1200', to: '1232' }, { type: 'changed', surname: 'Nguyễn', from: '1232', reason: 'lệnh', confidence: 'tradition' }];
  const r1 = await call('POST', '/api/ops', { family: FA, ops: [{ op_id: `sn-${TAG}-1`, id: P_ROOT, fields: { names: good }, ts: Date.now() }] }, ck.ed);
  assert.deepStrictEqual(r1.json.applied, [`sn-${TAG}-1`]);
  const r2 = await call('POST', '/api/ops', { family: FA, ops: [{ op_id: `sn-${TAG}-2`, id: P_ROOT, fields: { names: [{ type: 'changed', surname: '' }] }, ts: Date.now() }] }, ck.ed);
  assert.strictEqual(r2.json.rejected.length, 1);
  assert.match(r2.json.rejected[0].reason, /names/);
  const row = (await pool.query('select data from persons where id=$1', [P_ROOT])).rows[0].data;
  assert.strictEqual(row.names[1].surname, 'Nguyễn');
});

test('persons: a visitor sees the marks but not the reason or source of a change', { skip }, async () => {
  const anon = await call('GET', `/api/persons?family=${FA}`);
  const root = anon.json.items.find((i) => i.id === P_ROOT).data;
  assert.strictEqual(root.names[1].surname, 'Nguyễn');
  assert.ok(!('reason' in root.names[1]) && !('source' in root.names[1]));
  const mem = await call('GET', `/api/persons?family=${FA}`, undefined, ck.mem);
  assert.strictEqual(mem.json.items.find((i) => i.id === P_ROOT).data.names[1].reason, 'lệnh');
});

test('match: the engine loads every alias name of a person and pairs it across trees, date-aware', { skip }, async () => {
  const MS = require('../match-store');
  const people = await MS.loadPeople(pool, [FA, FB]);
  const aliasOfRoot = people.filter((c) => c.id === P_ROOT && c.alias).map((c) => c.alias.of);
  assert.deepStrictEqual(aliasOfRoot, ['Lý'], 'the Lý mark is a context of the same person (the Nguyễn name is the primary one)');
  // a Lý namesake in the other tree born in 1300 is after the years the Lý name was used (1200-1232): no pair through it
  const r = await MS.scoreWithin(pool, FA);
  assert.ok(Array.isArray(r.scored));
  const other = people.find((c) => c.id === P_OTHER);
  const alias = people.find((c) => c.id === P_ROOT && c.alias);
  assert.strictEqual(require('../match-rules').scorePair(alias, other).score, 0);
});
