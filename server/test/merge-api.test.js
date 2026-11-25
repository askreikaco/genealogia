// Merge of two duplicate people inside one tree (merge.js, decisions.js, match-routes.js, trash.js): the candidates come
// from the match engine; a merge is a family vote; a passed vote re-points relations, events and stories, keeps the
// kept person's chosen values, archives the other person in the trash, writes history; restoring from the trash undoes
// all of it. Cycles and parent/partner pairs are refused. Invented names only.
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
const FA = `mga-${TAG}`; const FB = `mgb-${TAG}`;
const OWNER = `owner.${TAG}@example.test`; const ED = `ed.${TAG}@example.test`; const MEM = `mem.${TAG}@example.test`;
let base, pool, close, DEC, TRASH;
const ck = {};
const ids = { keep: `K${TAG}`, drop: `D${TAG}`, par: `R${TAG}`, child: `C${TAG}`, spouse: `S${TAG}`, other: `O${TAG}`, cyc: `Y${TAG}`, x: `X${TAG}`, y: `W${TAG}` };
const ALL = Object.values(ids);

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];
const person = async (id) => (await pool.query('select id, data, deleted, family_id from persons where id=$1', [id])).rows[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  DEC = require('../decisions'); TRASH = require('../trash');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query(`insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ Lạc Gộp','駱','public'), ($2,$2,'Họ Khác Gộp','楊','public')`, [FA, FB]);
  await pool.query("insert into relation_migrations (family_id, counts) values ($1, '{}')", [FA]); // table mode
  const ins = (id, data) => pool.query('insert into persons (id, data, updated_by, family_id) values ($1,$2,$3,$4)', [id, data, 'test', FA]);
  await ins(ids.par, { name: 'Lạc Văn Tổ', sex: 'm', gen: 1, died: '1880' });
  await ins(ids.keep, { name: 'Lạc Văn Gốc', sex: 'm', born: '1900', parent: ids.par });
  await ins(ids.drop, { name: 'Lạc Văn Gốc', sex: 'm', born: '1900', place: 'Xã Bến Thử' });
  // the older profile is the kept one: ids.keep was made 30 days ago (history time), ids.drop just now
  await pool.query("insert into history (person_id, field, at) values ($1,'born', now() - interval '30 days'), ($2,'born', now())", [ids.keep, ids.drop]);
  await ins(ids.child, { name: 'Lạc Thị Con', sex: 'f', born: '1925' });
  await ins(ids.spouse, { name: 'Trần Thị Vợ', sex: 'f', born: '1902' });
  await ins(ids.other, { name: 'Lạc Văn Khác', sex: 'm', born: '1930' });
  await ins(ids.cyc, { name: 'Lạc Văn Vòng', sex: 'm', born: '1960' });
  // relations (table mode): par -> keep, keep -> child, drop -> child (duplicate of keep -> child), drop -> spouse
  await pool.query(`insert into parent_child (family_id, parent_id, child_id) values ($1,$2,$3), ($1,$4,$5), ($1,$6,$5)`, [FA, ids.par, ids.keep, ids.keep, ids.child, ids.drop]);
  await pool.query(`insert into couple (family_id, a_id, b_id, kind) values ($1,$2,$3,'cuoi')`, [FA, ids.drop, ids.spouse]);
  await pool.query(`insert into events (id, family_id, person_id, type, date_text, people) values ($1,$2,$3,'sinh','1900',$4::jsonb)`,
    [`E${TAG}`, FA, ids.drop, JSON.stringify([ids.drop, ids.other])]);
  await pool.query(`insert into stories (id, family_id, person_id, title, body) values ($1,$2,$3,'Chuyện','Nội dung')`, [`S${TAG}`, FA, ids.drop]);
  await pool.query(`insert into members (email, name, role, status, family_id) values ($1,'o','owner','active',$3), ($2,'e','editor','active',$3), ($4,'m','member','active',$3),
    ($1,'o','owner','active',$5)`, [OWNER, ED, FA, MEM, FB]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.owner = await session(OWNER); ck.ed = await session(ED); ck.mem = await session(MEM);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from decision_votes where decision_id in (select id from decisions where family_id = any($1))', [[FA, FB]]);
  await pool.query('delete from decisions where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from trash where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from trash_audit where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from match_suggestions where a_family = any($1) or b_family = any($1)', [[FA, FB]]);
  await pool.query('delete from notices where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from members where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from events where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from stories where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from couple where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from parent_child where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from relation_migrations where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from history where person_id = any($1)', [ALL]);
  await pool.query('delete from persons where id = any($1)', [ALL]);
  await pool.query('delete from families where id = any($1)', [[FA, FB]]);
  await close(); await pool.end();
});

test('candidates inside one tree come from the match engine; a member gets none; the cross-tree list never shows them', { skip }, async () => {
  assert.equal((await call('GET', `/api/duplicates?family=${FA}`, undefined, ck.mem)).status, 403);
  const r = await call('GET', `/api/duplicates?family=${FA}`, undefined, ck.owner);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const pair = r.json.items.find((s) => [s.a.id, s.b.id].sort().join('|') === [ids.keep, ids.drop].sort().join('|'));
  assert.ok(pair && pair.score >= 0.8, 'the two Lạc Văn Gốc of this tree are a candidate: ' + JSON.stringify(r.json.items));
  assert.ok(!r.json.items.some((s) => [s.a.id, s.b.id].includes(ids.other)), 'a different person is not a candidate');
  const x = await call('GET', `/api/match-suggestions?family=${FA}`, undefined, ck.owner);
  assert.ok(!(x.json.items || []).some((s) => s.other_person === ids.drop || s.person === ids.drop), 'no same-tree pair in the cross-tree list');
});

test('a member cannot preview or propose; a merge of a person with itself is refused', { skip }, async () => {
  assert.equal((await call('GET', `/api/merge/preview?family=${FA}&keep=${ids.keep}&drop=${ids.drop}`, undefined, ck.mem)).status, 403);
  assert.equal((await call('POST', '/api/merge/propose', { family: FA, keep: ids.keep, drop: ids.drop, reason: 'Thử' }, ck.mem)).status, 403);
  assert.equal((await call('GET', `/api/merge/preview?family=${FA}&keep=${ids.keep}&drop=${ids.keep}`, undefined, ck.ed)).status, 409);
});

test('cycle guard: merging would make the kept person its own ancestor -> refused; the vote is not opened', { skip }, async () => {
  // drop is parent of cyc, cyc is parent of keep: merging drop into keep makes keep its own ancestor
  await pool.query('insert into parent_child (family_id, parent_id, child_id) values ($1,$2,$3), ($1,$4,$5)', [FA, ids.drop, ids.cyc, ids.cyc, ids.keep]);
  const pv = await call('GET', `/api/merge/preview?family=${FA}&keep=${ids.keep}&drop=${ids.drop}`, undefined, ck.ed);
  assert.equal(pv.status, 409, JSON.stringify(pv.json));
  assert.match(pv.json.error, /tổ tiên/);
  assert.equal((await call('POST', '/api/merge/propose', { family: FA, keep: ids.keep, drop: ids.drop, reason: 'Thử vòng lặp' }, ck.ed)).status, 409);
  assert.equal((await pool.query("select count(*)::int n from decisions where subject_ref=$1", [ids.drop])).rows[0].n, 0);
  await pool.query('delete from parent_child where family_id=$1 and parent_id = any($2::text[]) and child_id = any($2::text[]) and child_id in ($3,$4) ', [FA, [ids.drop, ids.cyc, ids.keep], ids.cyc, ids.keep]);
  await pool.query('delete from parent_child where family_id=$1 and ((parent_id=$2 and child_id=$3) or (parent_id=$3 and child_id=$4))', [FA, ids.drop, ids.cyc, ids.keep]);
  assert.equal((await call('GET', `/api/merge/preview?family=${FA}&keep=${ids.keep}&drop=${ids.drop}`, undefined, ck.ed)).status, 200);
});

test('a family vote merges: relations re-pointed without duplicates, events and stories moved, values kept, history written; undo restores', { skip }, async () => {
  const before = {
    keep: await person(ids.keep),
    rels: (await pool.query('select parent_id, child_id from parent_child where family_id=$1 order by 1,2', [FA])).rows,
    couples: (await pool.query('select a_id, b_id from couple where family_id=$1', [FA])).rows,
  };
  // the ids are sent the other way round: the older profile is still the kept one
  const pr = await call('POST', '/api/merge/propose', { family: FA, keep: ids.drop, drop: ids.keep, reason: 'Hai hồ sơ cùng một người', choices: { place: 'drop' } }, ck.ed);
  assert.equal(pr.status, 200, JSON.stringify(pr.json));
  assert.equal(pr.json.decision.kind, 'merge_person');
  assert.equal(pr.json.decision.keep.id, ids.keep, 'older profile kept regardless of the order sent');
  assert.equal(pr.json.decision.subject_ref, ids.drop);
  assert.equal((await call('POST', '/api/merge/propose', { family: FA, keep: ids.keep, drop: ids.drop, reason: 'Lần hai' }, ck.ed)).status, 409);
  const dec = (await pool.query("select id from decisions where kind='merge_person' and subject_ref=$1 and state='open'", [ids.drop])).rows[0];
  assert.ok(dec, 'the vote is open');
  // the owner votes yes too (two voters: the proposer needs one other yes)
  assert.equal((await call('POST', `/api/decisions/${dec.id}/ballot`, { family: FA, choice: 'yes' }, ck.owner)).status, 200);
  // nothing has moved while the vote is open
  assert.equal((await person(ids.drop)).deleted, false);
  // the window closes: 8 days later
  const settled = await DEC.sweep(Date.now() + 8 * 864e5);
  assert.ok(settled.some((x) => x.id === Number(dec.id) && x.state === 'passed'), JSON.stringify(settled));
  const d = (await pool.query('select state, result from decisions where id=$1', [dec.id])).rows[0];
  assert.equal(d.state, 'passed');
  const after = await person(ids.keep);
  assert.equal(after.data.name, 'Lạc Văn Gốc');
  assert.equal(after.data.place, 'Xã Bến Thử', 'chosen value from the other person');
  assert.equal(after.data.parent, ids.par, 'the kept parent stays');
  assert.equal((await person(ids.drop)).deleted, true, 'merged-away person is in the trash, not gone');
  assert.equal((await pool.query('select count(*)::int n from persons where id=$1', [ids.drop])).rows[0].n, 1, 'never hard-deleted');
  const kids = (await pool.query('select parent_id from parent_child where family_id=$1 and child_id=$2 order by parent_id', [FA, ids.child])).rows.map((x) => x.parent_id);
  assert.deepEqual(kids, [ids.keep], 'one row for the child: duplicate edge dropped');
  assert.equal((await pool.query('select count(*)::int n from parent_child where family_id=$1 and (parent_id=$2 or child_id=$2)', [FA, ids.drop])).rows[0].n, 0);
  assert.equal((await pool.query('select count(*)::int n from couple where family_id=$1 and a_id=$2', [FA, ids.keep])).rows[0].n, 1, 'partner moved to the kept person');
  const ev = (await pool.query('select person_id, people from events where id=$1', [`E${TAG}`])).rows[0];
  assert.equal(ev.person_id, ids.keep); assert.deepEqual(ev.people.sort(), [ids.keep, ids.other].sort());
  assert.equal((await pool.query('select person_id from stories where id=$1', [`S${TAG}`])).rows[0].person_id, ids.keep);
  const t = (await pool.query("select * from trash where family_id=$1 and kind='person' and item_id=$2", [FA, ids.drop])).rows[0];
  assert.equal(t.state, 'trash'); assert.equal(t.payload.merge.keep, ids.keep); assert.equal(Number(t.payload.council), Number(dec.id));
  const h = (await pool.query("select count(*)::int n from history where person_id = any($1) and field='merge'", [[ids.keep, ids.drop]])).rows[0].n;
  assert.ok(h >= 2, 'history on both people');
  // undo: admin/owner restores the merged-away person from the trash
  assert.equal((await call('POST', `/api/trash/${t.id}/restore`, { family: FA }, ck.ed)).status, 403, 'a council-voted restore is for owners and admins');
  const rs = await call('POST', `/api/trash/${t.id}/restore`, { family: FA }, ck.owner);
  assert.equal(rs.status, 200, JSON.stringify(rs.json));
  assert.equal((await person(ids.drop)).deleted, false);
  const k2 = await person(ids.keep);
  assert.equal(k2.data.place, undefined, 'the kept person has its own values again');
  assert.equal(k2.data.born, before.keep.data.born);
  const rels2 = (await pool.query('select parent_id, child_id from parent_child where family_id=$1 order by 1,2', [FA])).rows;
  assert.deepEqual(rels2, before.rels, 'every relation is back as it was');
  assert.equal((await pool.query('select count(*)::int n from couple where family_id=$1', [FA])).rows[0].n, before.couples.length);
  assert.equal((await pool.query('select person_id from events where id=$1', [`E${TAG}`])).rows[0].person_id, ids.drop);
  assert.equal((await pool.query('select person_id from stories where id=$1', [`S${TAG}`])).rows[0].person_id, ids.drop);
  assert.equal((await pool.query("select state from trash where id=$1", [t.id])).rows[0].state, 'restored');
});

test('a partnership is one row in either order; access granted to the merged-away person blocks the merge', { skip }, async () => {
  const MERGE = require('../merge');
  await pool.query('insert into persons (id, data, updated_by, family_id) values ($1,$2,$3,$4), ($5,$6,$3,$4), ($7,$8,$3,$4)',
    [ids.x, { name: 'Lạc Văn Chính', sex: 'm', born: '1880' }, 'test', FA, ids.y, { name: 'Lạc Văn Chính', sex: 'm', born: '1880' }, `T${TAG}`, { name: 'Trần Thị Hai', sex: 'f', born: '1882' }]);
  ALL.push(ids.x, ids.y, `T${TAG}`);
  // X is the older profile (kept), Y the newer one (merged away): the access check is about Y
  await pool.query("insert into history (person_id, field, at) values ($1,'born', now() - interval '30 days'), ($2,'born', now())", [ids.x, ids.y]);
  await pool.query("insert into couple (family_id, a_id, b_id, kind) values ($1,$2,$3,'cuoi'), ($1,$4,$5,'cuoi')", [FA, ids.y, `T${TAG}`, `T${TAG}`, ids.x]);
  const c = await pool.connect();
  try {
    await c.query('begin');
    // access: a manager of the merged-away person blocks the merge (checked first, before anything moves)
    await c.query("insert into person_managers (family_id, person_id, email, added_by) values ($1,$2,'manager@example.test','test')", [FA, ids.y]);
    await assert.rejects(() => MERGE.preview(c, FA, ids.x, ids.y, {}), (e) => e.status === 409 && /quyền truy cập/.test(e.message));
    await c.query('delete from person_managers where family_id=$1 and person_id=$2', [FA, ids.y]);
    await MERGE.apply(c, { id: FA, slug: FA, name: 'Họ Lạc Gộp' }, { keepId: ids.x, dropId: ids.y, choices: {}, by: 'test', w: { email: OWNER }, reason: 'Thử đối xứng' });
    const rows = (await c.query("select a_id, b_id from couple where family_id=$1 and (a_id = any($2::text[]) or b_id = any($2::text[]))", [FA, [ids.x, ids.y, `T${TAG}`]])).rows;
    assert.equal(rows.length, 1, 'the partnership with the same person is kept once: ' + JSON.stringify(rows));
  } finally { await c.query('rollback'); c.release(); }
  // nothing was written: the two people are still here
  assert.equal((await person(ids.y)).deleted, false);
});
