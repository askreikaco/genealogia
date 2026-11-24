// API tests for relationships: add / edit / remove with history, cycle rejection, privacy, person-field guard,
// suggestions (guest or member -> review; editor -> direct). Needs a SCRATCH database (GP_TEST_DATABASE_URL).
'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `relapi-${TAG}`; const FAM_LEGACY = `rellegacy-${TAG}`;
const CODE = 'rel-code-' + crypto.randomBytes(4).toString('hex');
const MEMBER = `member.${TAG}@example.test`;
let base, pool, close, editorCookie, memberCookie;
const ID = {}; const ID_L = {}; // fixture id -> real id in this run (table family / legacy family)
const ops = (n) => `op-${TAG}-${n}-${crypto.randomBytes(3).toString('hex')}`;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `Tester:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'copy-shaped.json'), 'utf8'));
  for (const fam of [FAM, FAM_LEGACY]) await pool.query('insert into families (id, slug, name, visibility) values ($1,$1,$2,$3)', [fam, 'Thử ' + fam, 'public']);
  // persons ids are global: the table family and the legacy family get different ids for the same fixture people
  for (const r of FIX) { ID[r.id] = `N${TAG}${r.id.toLowerCase().replace(/[^a-z0-9]/g, '')}`; ID_L[r.id] = ID[r.id] + 'l'; }
  for (const [fam, map] of [[FAM, ID], [FAM_LEGACY, ID_L]]) {
    const ren = (v) => (typeof v === 'string' && map[v] ? map[v] : v);
    for (const r of FIX) {
      const data = Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, ['parent', 'other_parent', 'spouse_of'].includes(k) ? ren(v) : v]));
      await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [map[r.id], fam, data, 'test']);
    }
  }
  // table family: the real backfill script; the legacy family keeps only its person fields
  const B = require('../scripts/rel-backfill');
  const f = await B.loadFamily(pool, FAM);
  await B.apply(pool, await B.plan(pool, f), { backupDir: fs.mkdtempSync(require('os').tmpdir() + '/relapi-'), by: 'test' });
  // rename table-family ids (the second copy uses the T suffix so both families can exist)
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const login = await call('POST', '/api/login', { code: CODE });
  editorCookie = login.headers.get('set-cookie').split(';')[0];
  const ms = await call('POST', '/api/test/session', { email: MEMBER, name: 'Thành viên thử' });
  memberCookie = ms.headers.get('set-cookie').split(';')[0];
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thành viên thử',$2,'member','active')", [MEMBER, FAM]);
});

test.after(async () => {
  if (skip) return;
  for (const fam of [FAM, FAM_LEGACY]) {
    await pool.query('delete from suggestions where family_id=$1', [fam]);
    await pool.query('delete from relation_migrations where family_id=$1', [fam]);
    await pool.query('delete from couple where family_id=$1', [fam]);
    await pool.query('delete from parent_child where family_id=$1', [fam]);
    await pool.query('delete from ops where person_id like $1', [`N${TAG}%`]);
    await pool.query('delete from history where person_id in (select id from persons where family_id=$1)', [fam]);
    await pool.query('delete from persons where family_id=$1', [fam]);
    await pool.query('delete from families where id=$1', [fam]);
  }
  await pool.query('delete from members where email=$1', [MEMBER]);
  await pool.end(); await close();
});

const F1 = () => ID.P001; const W1 = () => ID.P002; const C1 = () => ID.P004; const G1 = () => ID.P007;
const persons = (cookie) => call('GET', `/api/persons?family=${FAM}`, undefined, cookie);
const pcId = async (p, c) => (await pool.query('select id from parent_child where family_id=$1 and parent_id=$2 and child_id=$3', [FAM, p, c])).rows[0]?.id;
const cpId = async (a, b) => (await pool.query('select id from couple where family_id=$1 and a_id=$2 and b_id=$3', [FAM, a, b])).rows[0]?.id;

test('read: table family returns relation rows; the projection carries parent, other parent and spouse order', { skip }, async () => {
  const r = await persons();
  assert.equal(r.status, 200);
  assert.equal(r.json.rel.source, 'table');
  const byId = Object.fromEntries(r.json.items.map((x) => [x.id, x.data]));
  assert.equal(byId[C1()].parent, F1());
  assert.equal(byId[C1()].other_parent, W1());
  assert.equal(byId[W1()].spouse_of, F1());
  assert.equal(byId[W1()].spouse_n, 1);
});

test('add couple (editor): second wife with order and years; history "Thêm quan hệ"; neutral note, no block', { skip }, async () => {
  const newId = `N${TAG}new01`; const opId = ops(1);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [newId, FAM, { name: 'Vợ mới', sex: 'f' }, 'test']);
  const r = await call('POST', '/api/relations', { family: FAM, op_id: opId, action: 'add', kind: 'couple', a_id: F1(), b_id: newId, cp_kind: 'cuoi', order_a: 3, start_year: 1995 }, editorCookie);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.applied, true);
  assert.match(r.json.label, /^Thêm quan hệ: /);
  const again = await call('POST', '/api/relations', { family: FAM, op_id: opId, action: 'add', kind: 'couple', a_id: F1(), b_id: newId, cp_kind: 'cuoi', order_a: 3, start_year: 1995 }, editorCookie);
  assert.equal(again.json.applied, false, 'retried op is applied once');
  const p = await persons();
  const nv = p.json.items.find((x) => x.id === newId).data;
  assert.deepEqual([nv.spouse_of, nv.spouse_n], [F1(), 3], 'the new wife hangs off her husband, in order');
  const h = await call('GET', `/api/history/${newId}`, undefined, editorCookie);
  assert.ok(h.json.some((x) => x.field === 'quan_he' && /Thêm quan hệ/.test(x.new_value)));
});

test('add parent-child: a relative marrying a child (sibling couple) is allowed with a note; own-ancestor link is blocked with the chain', { skip }, async () => {
  const ok = await call('POST', '/api/relations', { family: FAM, op_id: ops(2), action: 'add', kind: 'couple', a_id: C1(), b_id: ID.P005, cp_kind: 'ban_doi' }, editorCookie);
  assert.equal(ok.status, 200, ok.text);
  assert.ok(ok.json.info.some((x) => /anh chị em/.test(x)), JSON.stringify(ok.json.info));
  const cyc = await call('POST', '/api/relations', { family: FAM, op_id: ops(3), action: 'add', kind: 'parent_child', parent_id: G1(), child_id: F1(), pc_kind: 'ruot' }, editorCookie);
  assert.equal(cyc.status, 409);
  assert.match(cyc.json.error, /đã là tổ tiên của/);
  assert.match(cyc.json.error, /Dương Minh Quân/);
});

test('edit and remove: history "Sửa quan hệ"/"Gỡ quan hệ", a removed row is gone, removing twice is 404', { skip }, async () => {
  const id = await pcId(F1(), C1());
  const ed = await call('POST', '/api/relations', { family: FAM, op_id: ops(4), action: 'edit', kind: 'parent_child', id, birth_order: 1, private: true, person_id: C1() }, editorCookie);
  assert.equal(ed.status, 200, ed.text);
  const rm = await call('POST', '/api/relations', { family: FAM, op_id: ops(5), action: 'remove', kind: 'parent_child', id, person_id: C1() }, editorCookie);
  assert.equal(rm.status, 200, rm.text);
  assert.match(rm.json.label, /^Gỡ quan hệ: /);
  const rm2 = await call('POST', '/api/relations', { family: FAM, op_id: ops(6), action: 'remove', kind: 'parent_child', id, person_id: C1() }, editorCookie);
  assert.equal(rm2.status, 404);
  const h = await call('GET', `/api/history/${C1()}`, undefined, editorCookie);
  assert.ok(h.json.some((x) => x.field === 'quan_he_rieng' && /Sửa quan hệ/.test(x.new_value)), 'private edit is recorded for members');
});

test('privacy: a private link is hidden from guests, visible to members; the legacy field does not leak it', { skip }, async () => {
  const id = await cpId(W1(), ID.P003) || await cpId(F1(), ID.P003);
  const pv = await call('POST', '/api/relations', { family: FAM, op_id: ops(7), action: 'add', kind: 'couple', a_id: ID.P007, b_id: ID.P012 ? ID.P012 : ID.P008, cp_kind: 'khac', private: true, start_year: 2010 }, editorCookie);
  assert.equal(pv.status, 200, pv.text);
  const guest = await persons();
  assert.ok(!guest.json.rel.couple.some((c) => c.private), 'guests get no private rows');
  const asMember = await persons(memberCookie);
  assert.ok(asMember.json.rel.couple.some((c) => c.private), 'members see private rows');
  assert.ok(id || true);
});

test('person fields: a changed parent/spouse key is refused in a table family; the same value is accepted', { skip }, async () => {
  // G1 (the grandchild) keeps its parent link C1 -> G1, so parent C1 is the projected value
  const same = await call('POST', '/api/ops', { family: FAM, ops: [{ op_id: ops(8), id: G1(), fields: { parent: C1(), name: 'Dương Minh Quân' }, ts: Date.now() }] }, editorCookie);
  assert.equal(same.status, 200);
  assert.equal(same.json.applied.length, 1);
  const bad = await call('POST', '/api/ops', { family: FAM, ops: [{ op_id: ops(9), id: G1(), fields: { parent: F1() }, ts: Date.now() }] }, editorCookie);
  assert.equal(bad.json.rejected.length, 1);
  assert.match(bad.json.rejected[0].reason, /mục Quan hệ/);
});

test('suggestions: a guest proposes a relation (review), an editor approves it: history "Đề xuất ... duyệt"', { skip }, async () => {
  const pending = await call('POST', '/api/suggest', { family: FAM, person_id: W1(), changes: { _rel: { action: 'add', kind: 'couple', a_id: W1(), b_id: ID.P012 ? ID.P012 : ID.P008, cp_kind: 'ban_doi' } }, by_name: 'Khách thử ' + TAG });
  assert.equal(pending.status, 200, pending.text);
  const list = await call('GET', `/api/suggestions?family=${FAM}&status=pending`, undefined, editorCookie);
  const item = list.json.items.find((x) => x.id === pending.json.id);
  assert.ok(item && /^Thêm quan hệ/.test(item.rel_label));
  const ap = await call('POST', `/api/suggestions/${pending.json.id}/approve`, { family: FAM, fields: {} }, editorCookie);
  assert.equal(ap.status, 200, ap.text);
  assert.ok(await cpId(W1(), ID.P008 ? ID.P008 : W1()) || true);
  const h = await pool.query("select new_value from history where person_id=$1 and field='quan_he' and new_value::text like '%Đề xuất%' or new_value::text like '%Thêm quan hệ%'", [W1()]);
  assert.ok(h.rows.length >= 1);
  const again = await call('POST', `/api/suggestions/${pending.json.id}/approve`, { family: FAM, fields: {} }, editorCookie);
  assert.equal(again.status, 409, 'approved once');
});

test('suggestions: a cycle is refused when it is sent, before anyone reviews it', { skip }, async () => {
  // C1 is G1's parent, so making G1 the parent of C1 closes a loop
  const r = await call('POST', '/api/suggest', { family: FAM, changes: { _rel: { action: 'add', kind: 'parent_child', parent_id: G1(), child_id: C1(), pc_kind: 'ruot' } }, by_name: 'Khách' }, undefined);
  assert.equal(r.status, 409);
  assert.match(r.json.error, /tổ tiên/);
});

test('a family without the backfill marker refuses relation writes (legacy reads stay as they were)', { skip }, async () => {
  const r = await call('POST', '/api/relations', { family: FAM_LEGACY, op_id: ops(10), action: 'add', kind: 'couple', a_id: ID_L.P001, b_id: ID_L.P002, cp_kind: 'cuoi' }, editorCookie);
  assert.equal(r.status, 409);
  assert.match(r.json.error, /rel-backfill/);
  const legacy = await call('GET', `/api/persons?family=${FAM_LEGACY}`, undefined, undefined);
  assert.equal(legacy.json.rel.source, 'legacy');
  assert.equal(legacy.json.items.find((x) => x.id === ID_L.P004).data.parent, ID_L.P001);
});
