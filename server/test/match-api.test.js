// "Có thể là cùng một người" on a scratch database: the job finds pairs across trees (a married-in person in another
// surname's tree included) and stores them idempotently; who may see a suggestion; "Đề nghị liên kết" goes through
// the normal link proposal (the other tree still decides); "Không phải" is never revived. Invented names only.
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
const FA = `mta-${TAG}`; const FB = `mtb-${TAG}`; const FC = `mtc-${TAG}`;
const OWNER = `owner.${TAG}@example.test`; const ED = `ed.${TAG}@example.test`; const MEM = `mem.${TAG}@example.test`;
let base, pool, close, M; const ck = {}; const P = {};
const nid = () => 'N' + crypto.randomUUID().slice(0, 13);

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];
const sug = async (a, b) => (await pool.query('select * from match_suggestions where least(a_person,b_person)=least($1::text,$2::text) and greatest(a_person,b_person)=greatest($1::text,$2::text)', [a, b])).rows[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p; M = require('../match-store');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query(`insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ Lạc Thử','駱','public'), ($2,$2,'Họ Bùi Thử','裴','public'),
    ($3,$3,'Họ Lạc Riêng','駱','private')`, [FA, FB, FC]);
  Object.assign(P, { wifeA: nid(), wifeB: nid(), liveA: nid(), liveC: nid(), youngA: nid(), youngB: nid(), fatherA: nid(), fatherB: nid() });
  const ins = (id, data, fam) => pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3)", [id, data, fam]);
  await ins(P.fatherA, { name: 'Bùi Văn Gốc', sex: 'm', died: '1960' }, FA);
  await ins(P.fatherB, { name: 'Bùi Văn Gốc', sex: 'm', died: '1960' }, FB);
  await ins(P.wifeA, { name: 'Bùi Thị Hiền', sex: 'f', born: '1931', parent: P.fatherA }, FA); // married into Họ Lạc
  await ins(P.wifeB, { name: 'Bùi Thị Hiền', sex: 'f', born: '1931', died: '2001', parent: P.fatherB }, FB); // born in Họ Bùi
  await ins(P.liveA, { name: 'Lạc Văn Sống', sex: 'm', born: '1960' }, FA);
  await ins(P.liveC, { name: 'Lạc Văn Sống', sex: 'm', born: '1960' }, FC);
  await ins(P.youngA, { name: 'Bùi Văn Trẻ', sex: 'm', born: '1990', place: 'Xã Bến Thử' }, FA);
  await ins(P.youngB, { name: 'Bùi Văn Trẻ', sex: 'm', born: '1990', place: 'Xã Bến Thử' }, FB);
  await pool.query(`insert into members (email, name, role, status, family_id) values
    ($1,'o','owner','active',$4), ($1,'o','owner','active',$5), ($2,'e','editor','active',$4), ($3,'m','member','active',$4)`, [OWNER, ED, MEM, FA, FB]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.owner = await session(OWNER); ck.ed = await session(ED); ck.mem = await session(MEM);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from match_suggestions where a_family = any($1) or b_family = any($1)', [[FA, FB, FC]]);
  await pool.query('delete from person_links where a_family = any($1) or b_family = any($1)', [[FA, FB, FC]]);
  await pool.query('delete from members where family_id = any($1)', [[FA, FB, FC]]);
  await pool.query('delete from history where person_id = any($1)', [Object.values(P)]);
  await pool.query('delete from persons where id = any($1)', [Object.values(P)]);
  await pool.query('delete from families where id = any($1)', [[FA, FB, FC]]);
  await close(); await pool.end();
});

test('the job finds the pairs (married-in person across surnames, parent in common) and stores them once', { skip }, async () => {
  const r = await M.scoreAll(pool, { family: FA, min: 0.5 });
  const mine = r.scored.filter((s) => [s.a.id, s.b.id].some((x) => Object.values(P).includes(x)));
  const key = (s) => [s.a.id, s.b.id].sort().join('|');
  const keys = mine.map(key);
  for (const [x, y] of [[P.wifeA, P.wifeB], [P.liveA, P.liveC], [P.youngA, P.youngB]]) assert.ok(keys.includes([x, y].sort().join('|')), 'pair found');
  const wife = mine.find((s) => key(s) === [P.wifeA, P.wifeB].sort().join('|'));
  assert.ok(wife.score >= 0.8 && wife.reasons.includes('cùng tên cha/mẹ'), JSON.stringify(wife));
  const w1 = await M.store(pool, mine); assert.ok(w1.inserted >= 3, JSON.stringify(w1));
  const w2 = await M.store(pool, mine); assert.equal(w2.inserted, 0); assert.ok(w2.updated >= 3);
  assert.equal((await sug(P.wifeA, P.wifeB)).status, 'new');
});

test('who sees a suggestion: guest 401, member 403; an editor only what the other tree lets them see; owner of both more', { skip }, async () => {
  assert.equal((await call('GET', `/api/match-suggestions?family=${FA}`)).status, 401);
  assert.equal((await call('GET', `/api/match-suggestions?family=${FA}`, undefined, ck.mem)).status, 403);
  const ed = await call('GET', `/api/match-suggestions?family=${FA}`, undefined, ck.ed);
  assert.equal(ed.status, 200);
  assert.deepEqual(ed.json.items.map((x) => x.other_person), [P.wifeB], 'deceased person of a public tree only; no living, no private tree');
  assert.equal(ed.json.items[0].person, P.wifeA); assert.equal(ed.json.items[0].other_label, 'Họ Bùi Thử'); assert.equal(ed.json.items[0].other_years, '1931–2001');
  const ow = await call('GET', `/api/match-suggestions?family=${FA}`, undefined, ck.owner);
  assert.deepEqual(ow.json.items.map((x) => x.other_person).sort(), [P.wifeB, P.youngB].sort(), 'owner of both trees: the living pair too; still not the private tree');
  const fromB = await call('GET', `/api/match-suggestions?family=${FB}`, undefined, ck.owner);
  assert.ok(fromB.json.items.some((x) => x.person === P.wifeB && x.other_person === P.wifeA), 'the same row from the other side');
});

test('"Đề nghị liên kết" goes through the link proposal; "Không phải" stays dismissed; neither can repeat', { skip }, async () => {
  const s1 = await sug(P.wifeA, P.wifeB);
  const notMine = await call('POST', `/api/match-suggestions/${s1.id}/link`, { family: FC }, ck.ed);
  assert.equal(notMine.status, 403, 'editor of A is nobody in C');
  const lk = await call('POST', `/api/match-suggestions/${s1.id}/link`, { family: FA }, ck.ed);
  assert.equal(lk.status, 200, JSON.stringify(lk.json)); assert.equal(lk.json.status, 'pending', 'editor of one tree: the other tree decides');
  const pl = (await pool.query('select status, reason from person_links where a_person=$1 and b_person=$2', [P.wifeA, P.wifeB])).rows[0];
  assert.equal(pl.status, 'pending'); assert.match(pl.reason, /^Gợi ý tự động \(\d+%\)/);
  assert.equal((await sug(P.wifeA, P.wifeB)).status, 'linked');
  assert.equal((await call('POST', `/api/match-suggestions/${s1.id}/link`, { family: FA }, ck.ed)).status, 409);
  const s2 = await sug(P.youngA, P.youngB);
  assert.equal((await call('POST', `/api/match-suggestions/${s2.id}/dismiss`, { family: FA }, ck.ed)).status, 404, 'editor cannot see the living pair: not found');
  assert.equal((await call('POST', `/api/match-suggestions/${s2.id}/dismiss`, { family: FB }, ck.owner)).status, 200);
  assert.equal((await sug(P.youngA, P.youngB)).status, 'dismissed');
  const again = await M.scoreAll(pool, { family: FA, min: 0.5 });
  const w = await M.store(pool, again.scored.filter((s) => [s.a.id, s.b.id].some((x) => Object.values(P).includes(x))));
  assert.ok(w.kept >= 1, 'dismissed is kept'); assert.equal((await sug(P.youngA, P.youngB)).status, 'dismissed');
  assert.ok(!again.scored.some((s) => [s.a.id, s.b.id].sort().join('|') === [P.wifeA, P.wifeB].sort().join('|')), 'a linked (pending) pair is not scored again');
});
