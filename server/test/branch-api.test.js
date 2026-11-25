// Branch trees by reference ("Tạo cây cho nhánh này") on a scratch database: create (owner/admin of the home tree only),
// the branch reads its scope of the home tree live, a descendant added at home joins it, writes from the branch are
// applied at home for a home editor and suggested to home otherwise, delete keeps every person. Invented names only.
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
const HOME = `bth-${TAG}`;
const OWNER = `owner.${TAG}@example.test`; const ED = `ed.${TAG}@example.test`;
const MEM = `mem.${TAG}@example.test`; const BMEM = `bmem.${TAG}@example.test`; const OUT = `out.${TAG}@example.test`;
let base, pool, close, BR, PLACE; const ck = {}; const P = {}; const EV = {};
const pid = (k) => `N${TAG}-${k}`;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];
const idsOf = (j) => j.items.map((x) => x.id).sort();

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility, color) values ($1,$1,'Họ Lâm Nhánh Thử','林','public','#2f5d8a')", [HOME]);
  Object.assign(P, { root: pid('root'), c1: pid('c1'), sp: pid('sp'), gc: pid('gc'), cha: pid('cha'), other: pid('other') });
  const ins = (id, data) => pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3)", [id, data, HOME]);
  await ins(P.cha, { name: 'Lâm Văn Cha Thử', sex: 'm', died: '1880' });
  await ins(P.root, { name: 'Lâm Văn Tổ Thử', sex: 'm', born: '1900', died: '1960', parent: P.cha });
  await ins(P.c1, { name: 'Lâm Văn Hai Thử', sex: 'm', born: '1925', parent: P.root, order: 2 });
  await ins(P.sp, { name: 'Trần Thị Ba Thử', sex: 'f', born: '1928', spouse_of: P.c1 });
  await ins(P.gc, { name: 'Lâm Văn Tư Thử', sex: 'm', born: '1950', parent: P.c1 });
  await ins(P.other, { name: 'Nguyễn Văn Khác Thử', sex: 'm', born: '1930' });
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'o',$4,'owner','active'), ($2,'e',$4,'editor','active'), ($3,'m',$4,'member','active')", [OWNER, ED, MEM, HOME]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.owner = await session(OWNER); ck.ed = await session(ED); ck.mem = await session(MEM); ck.bmem = await session(BMEM); ck.out = await session(OUT);
});
test.after(async () => {
  if (skip) return;
  const fams = [HOME, ...(BR ? [BR] : [])];
  await pool.query('delete from ops where op_id like $1', [`%-${TAG}`]);
  await pool.query('delete from events where family_id = any($1)', [fams]);
  await pool.query('delete from person_places where person_id = any($1)', [Object.values(P)]);
  if (PLACE) await pool.query('delete from places where id = $1', [PLACE]);
  await pool.query('delete from suggestions where family_id = any($1)', [fams]);
  await pool.query('delete from members where family_id = any($1)', [fams]);
  await pool.query('delete from history where person_id = any($1)', [Object.values(P)]);
  await pool.query('delete from persons where family_id = any($1)', [fams]);
  await pool.query('delete from families where id = any($1)', [fams]);
  await close(); await pool.end();
});

test('create: only the owner or an admin of the home tree; the creator owns the branch; no people copied', { skip }, async () => {
  const bad = await call('POST', '/api/branch-trees', { family: HOME, person: P.root, name: 'Nhánh' }, ck.ed);
  assert.equal(bad.status, 403, JSON.stringify(bad.json));
  const bad2 = await call('POST', '/api/branch-trees', { family: HOME, person: P.root, name: 'Nhánh' }, ck.mem);
  assert.equal(bad2.status, 403);
  const before = (await pool.query('select count(*)::int n from persons where family_id = $1', [HOME])).rows[0].n;
  const r = await call('POST', '/api/branch-trees', { family: HOME, person: P.root, name: 'Nhánh Lâm Tổ Thử' }, ck.owner);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  BR = r.json.id;
  assert.equal(r.json.people, 4, 'root, child, spouse, grandchild');
  const mem = (await pool.query("select role, status from members where family_id = $1 and email = $2", [BR, OWNER])).rows[0];
  assert.deepStrictEqual(mem, { role: 'owner', status: 'active' });
  const fam = (await pool.query('select visibility, branch_home, branch_root from families where id = $1', [BR])).rows[0];
  assert.deepStrictEqual(fam, { visibility: 'private', branch_home: HOME, branch_root: P.root });
  const after = (await pool.query('select count(*)::int n from persons where family_id = $1', [HOME])).rows[0].n;
  assert.equal(after, before, 'creating a branch adds no people');
  const nested = await call('POST', '/api/branch-trees', { family: BR, person: P.root, name: 'x' }, ck.owner);
  assert.equal(nested.status, 400);
});

test('scope: the branch shows the root, blood descendants and spouses, not ancestors or others', { skip }, async () => {
  const r = await call('GET', `/api/persons?family=${BR}`, undefined, ck.owner);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.items.map((x) => x.id).sort(), [P.root, P.c1, P.sp, P.gc].sort());
  assert.equal(r.json.family, BR);
  assert.ok(r.json.rel.parent_child.every((x) => [P.root, P.c1, P.sp, P.gc].includes(x.parent_id) && [P.root, P.c1, P.sp, P.gc].includes(x.child_id)));
  const one = await call('GET', `/api/persons?family=${BR}&ids=${P.gc},${P.cha}`, undefined, ck.owner);
  assert.deepStrictEqual(one.json.items.map((x) => x.id), [P.gc], 'an id outside the branch is not returned');
  const out = await call('GET', `/api/persons?family=${BR}`, undefined, ck.out);
  assert.equal(out.status, 403, 'a private branch is shown to its members only');
});

test('live: a descendant added at home joins the branch at once; a home edit shows in the branch', { skip }, async () => {
  const newKid = pid('kid');
  await pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3)", [newKid, { name: 'Lâm Văn Năm Thử', sex: 'm', born: '1955', parent: P.gc }, HOME]);
  let r = await call('GET', `/api/persons?family=${BR}`, undefined, ck.owner);
  assert.ok(r.json.items.some((x) => x.id === newKid), 'great-grandchild added at home is in the branch');
  await pool.query("update persons set data = jsonb_set(data, '{name}', '\"Lâm Văn Hai Đổi Thử\"') where id = $1", [P.c1]);
  r = await call('GET', `/api/persons?family=${BR}&ids=${P.c1}`, undefined, ck.owner);
  assert.equal(r.json.items[0].data.name, 'Lâm Văn Hai Đổi Thử');
  await pool.query('delete from persons where id = $1', [newKid]);
});

test('writes from the branch: a home editor applies at home; a branch-only member sends a proposal to home', { skip }, async () => {
  await pool.query(`insert into members (email, name, family_id, role, status) values ($1,'bm',$2,'member','active'), ($3,'ed',$2,'member','active')`, [BMEM, BR, ED]);
  // branch-only member (member at home): a proposal, the home person is unchanged
  const prop = await call('POST', `/api/ops?family=${BR}`, { ops: [{ op_id: `p1-${TAG}`, id: P.c1, fields: { name: 'Lâm Văn Hai Đề Nghị' } }] }, ck.bmem);
  assert.equal(prop.status, 200, JSON.stringify(prop.json));
  assert.deepStrictEqual(prop.json.applied, []);
  assert.equal(prop.json.rejected[0].op_id, `p1-${TAG}`);
  assert.match(prop.json.rejected[0].reason, /góp ý/);
  const home1 = (await pool.query('select data from persons where id = $1', [P.c1])).rows[0].data;
  assert.equal(home1.name, 'Lâm Văn Hai Đổi Thử', 'home unchanged by a proposal');
  const sg = (await pool.query("select family_id, person_id, changes, status from suggestions where person_id = $1 and family_id = $2 and changes->>'name' = 'Lâm Văn Hai Đề Nghị'", [P.c1, HOME])).rows;
  assert.equal(sg.length, 1); assert.equal(sg[0].status, 'pending');
  // home editor (editor at home, member here): applied at home
  const ap = await call('POST', `/api/ops?family=${BR}`, { ops: [{ op_id: `a1-${TAG}`, id: P.gc, fields: { name: 'Lâm Văn Tư Sửa Thử' } }] }, ck.ed);
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  assert.deepStrictEqual(ap.json.applied, [`a1-${TAG}`]);
  const home2 = (await pool.query('select data from persons where id = $1', [P.gc])).rows[0].data;
  assert.equal(home2.name, 'Lâm Văn Tư Sửa Thử');
  // an op about a person outside the branch is rejected
  const out = await call('POST', `/api/ops?family=${BR}`, { ops: [{ op_id: `o1-${TAG}`, id: P.other, fields: { name: 'Không Được Thử' } }] }, ck.owner);
  assert.equal(out.status, 200);
  assert.equal(out.json.rejected[0].op_id, `o1-${TAG}`);
  const still = (await pool.query('select data from persons where id = $1', [P.other])).rows[0].data;
  assert.equal(still.name, 'Nguyễn Văn Khác Thử');
});

test('suggestions from the branch go to home; a person outside the branch is refused', { skip }, async () => {
  const s = await call('POST', `/api/suggest?family=${BR}`, { person_id: P.sp, changes: { name: 'Trần Thị Ba Góp Ý' }, note: 'thử' }, ck.bmem);
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const row = (await pool.query('select family_id from suggestions where id = $1', [s.json.id])).rows[0];
  assert.equal(row.family_id, HOME, 'stored for the home tree');
  const o = await call('POST', `/api/suggest?family=${BR}`, { person_id: P.other, changes: { name: 'x' } }, ck.bmem);
  assert.equal(o.status, 400);
  const g = await call('POST', `/api/suggest?family=${BR}`, { person_id: P.sp, changes: { name: 'x' } }, ck.out);
  assert.equal(g.status, 403);
});

test('list: owners and admins see every branch of the home tree; a plain member sees only branches they are in', { skip }, async () => {
  const o = await call('GET', `/api/branch-trees?family=${HOME}`, undefined, ck.owner);
  assert.deepStrictEqual(o.json.items.map((x) => x.id), [BR]);
  const m = await call('GET', `/api/branch-trees?family=${HOME}`, undefined, ck.mem);
  assert.deepStrictEqual(m.json.items, []);
  const info = await call('GET', `/api/branch-trees/${BR}`, undefined, ck.bmem);
  assert.equal(info.status, 200, JSON.stringify(info.json));
  assert.equal(info.json.branch, true);
  assert.equal(info.json.root.id, P.root); assert.equal(info.json.can_manage, false); assert.equal(info.json.home.id, HOME);
  const pv = await call('GET', `/api/branch-trees/preview?family=${HOME}&person=${P.c1}`, undefined, ck.owner);
  const plain = await call('GET', `/api/branch-trees/${HOME}`, undefined, ck.owner);
  assert.deepStrictEqual(plain.json, { branch: false }, 'a home tree is not a branch');
  const guest = await call('GET', `/api/branch-trees/${BR}`, undefined, ck.out);
  assert.deepStrictEqual(guest.json, { branch: false }, 'a private branch shows nothing to a non-member');
  assert.equal(pv.json.people, 3);
});

test('reads: events, book outline, GEDCOM (full and branch) and place people show the branch scope', { skip }, async () => {
  // fixtures: an event and a birthplace for a person in the branch and for one outside it
  EV.in = `ev-in-${TAG}`; EV.out = `ev-out-${TAG}`;
  await pool.query("insert into events (id, family_id, person_id, type, description, people) values ($1,$2,$3,'sinh','Sinh tại nhánh thử','[]'), ($4,$2,$5,'mat','Mất ngoài nhánh thử','[]')",
    [EV.in, HOME, P.c1, EV.out, P.other]);
  PLACE = (await pool.query("insert into places (kind) values ('village') returning id")).rows[0].id;
  await pool.query("insert into person_places (person_id, field, place_id, as_written) values ($1,'place',$3,'Làng thử'), ($2,'place',$3,'Làng thử')", [P.c1, P.other, PLACE]);

  // events of a person in the branch: read through the branch; a person outside it: not found
  const ev = await call('GET', `/api/events?family=${BR}&person=${P.c1}`, undefined, ck.owner);
  assert.equal(ev.status, 200, JSON.stringify(ev.json));
  assert.deepStrictEqual(ev.json.items.map((x) => x.id), [EV.in]);
  const evOut = await call('GET', `/api/events?family=${BR}&person=${P.other}`, undefined, ck.owner);
  assert.equal(evOut.status, 404);

  // book outline: the plan lists the branch's people only
  const book = await call('GET', `/api/book/outline?family=${BR}`, undefined, ck.owner);
  assert.equal(book.status, 200, JSON.stringify(book.json));
  const bookText = JSON.stringify(book.json.plan); // the plan lists people by id
  assert.ok(bookText.includes(P.gc), 'book shows the branch grandchild');
  assert.ok(!bookText.includes(P.other), 'book leaves out a person outside the branch');
  assert.equal(book.json.plan.pages[0].people, 4, 'the cover counts the four people of the branch');

  // GEDCOM of the whole branch, and of the branch of one of its people
  const ged = await fetch(`${base}/api/gedcom?family=${BR}`, { headers: { cookie: ck.owner } });
  assert.equal(ged.status, 200);
  const gedText = await ged.text();
  const indis = (t) => (t.match(/^0 @[^@]+@ INDI/gm) || []).length;
  assert.equal(indis(gedText), 4, 'full export holds the four people of the branch');
  assert.ok(!gedText.includes('Khác'), 'a person outside the branch is not exported');
  assert.ok(!gedText.includes('Cha'), 'an ancestor above the branch root is not exported');
  const sub = await fetch(`${base}/api/persons/${P.c1}/gedcom?scope=branch&family=${BR}`, { headers: { cookie: ck.owner } });
  assert.equal(sub.status, 200);
  const subText = await sub.text();
  assert.equal(indis(subText), 3, 'the branch of one person: that person, the descendants and the spouse');

  // people of a place: in the branch only the one inside it
  const pp = await call('GET', `/api/places/${PLACE}/people?family=${BR}`, undefined, ck.owner);
  assert.equal(pp.status, 200, JSON.stringify(pp.json));
  assert.deepStrictEqual([...new Set(pp.json.items.map((x) => x.person_id))], [P.c1]);
  const ppHome = await call('GET', `/api/places/${PLACE}/people?family=${HOME}`, undefined, ck.owner);
  assert.deepStrictEqual([...new Set(ppHome.json.items.map((x) => x.person_id))].sort(), [P.c1, P.other].sort(), 'the home tree lists both');
});

test('delete: removes the tree and its membership, never people; only owners of either tree', { skip }, async () => {
  const before = (await pool.query('select count(*)::int n from persons where family_id = $1', [HOME])).rows[0].n;
  const stranger = await call('DELETE', `/api/branch-trees/${BR}`, undefined, ck.out);
  assert.equal(stranger.status, 403);
  const member = await call('DELETE', `/api/branch-trees/${BR}`, undefined, ck.bmem);
  assert.equal(member.status, 403);
  const r = await call('DELETE', `/api/branch-trees/${BR}`, undefined, ck.owner);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const fam = (await pool.query('select id from families where id = $1', [BR])).rows;
  assert.equal(fam.length, 0);
  const mem = (await pool.query('select id from members where family_id = $1', [BR])).rows;
  assert.equal(mem.length, 0);
  const after = (await pool.query('select count(*)::int n from persons where family_id = $1', [HOME])).rows[0].n;
  assert.equal(after, before, 'every person stays in the home tree');
  const gone = await call('GET', `/api/branch-trees/${BR}`, undefined, ck.owner);
  assert.equal(gone.status, 200);
  assert.deepStrictEqual(gone.json, { branch: false }, 'a removed branch reads as not a branch');
  BR = null;
});
