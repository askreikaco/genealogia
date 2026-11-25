// GEDCOM branch export tests: the set (person, blood descendants, their spouses; no ancestors, siblings or adopted
// children), the privacy of the export, and a round trip (the branch file imports as the same number of people).
// The endpoint part needs a SCRATCH database (GP_TEST_DATABASE_URL); it is skipped otherwise.
'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { pathToFileURL } = require('url');

const G = require('../gedcom');
let R; let F;
test.before(async () => {
  R = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'events.js')).href);
  F = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'fuzzy.js')).href);
});

// Fictional family. ROOT has a parent PA with a sibling SIB, an adopted child AD, a spouse SP who had a child Y with
// another partner X, a child C1 (spouse SC1, whose other partner OUT is outside the branch) and a grandchild G1 (spouse GS).
const PEOPLE = {
  PA: { name: 'Lưu Văn Cổ', sex: 'm', born: '1880', died: '1940' },
  ROOT: { name: 'Lưu Văn Hiếu', sex: 'm', born: '1910', died: '1980', birth_place: 'Huế' },
  SIB: { name: 'Lưu Văn Nghĩa', sex: 'm', born: '1912' },
  SP: { name: 'Phan Thị Lan', sex: 'f', born: '1915', contact_public: 'yes', phone: '0900000001' },
  X: { name: 'Võ Văn Dũng', sex: 'm', born: '1912' },
  Y: { name: 'Võ Thị Én', sex: 'f', born: '1940' },
  C1: { name: 'Lưu Văn Phúc', sex: 'm', born: '1940', living: 'living', contact_public: 'yes', phone: '0900000002', email: 'phuc@example.test' },
  SC1: { name: 'Đặng Thị Hoa', sex: 'f', born: '1942', living: 'living', contact_public: 'no', phone: '0900000003' },
  OUT: { name: 'Hồ Văn Tài', sex: 'm', born: '1938' },
  G1: { name: 'Lưu Thị Mai', sex: 'f', born: '1965', living: 'living', contact_public: 'no', phone: '0900000004' },
  GS: { name: 'Bùi Văn Long', sex: 'm', born: '1963' },
  AD: { name: 'Lưu Văn Bình', sex: 'm', born: '1950' },
};
const persons = Object.entries(PEOPLE).map(([id, data]) => ({ id, data }));
const pc = [
  { parent_id: 'PA', child_id: 'ROOT', kind: 'ruot' }, { parent_id: 'PA', child_id: 'SIB', kind: 'ruot' },
  { parent_id: 'ROOT', child_id: 'C1', kind: 'ruot' }, { parent_id: 'ROOT', child_id: 'AD', kind: 'nuoi' },
  { parent_id: 'C1', child_id: 'G1', kind: 'ruot' }, { parent_id: 'X', child_id: 'Y', kind: 'ruot' },
  { parent_id: 'SP', child_id: 'C1', kind: 'ruot' },
];
const cp = [
  { a_id: 'ROOT', b_id: 'SP', kind: 'cuoi', start_year: 1935 }, { a_id: 'SP', b_id: 'X', kind: 'ly_hon' },
  { a_id: 'C1', b_id: 'SC1', kind: 'cuoi', start_year: 1965 }, { a_id: 'SC1', b_id: 'OUT', kind: 'khac' },
  { a_id: 'G1', b_id: 'GS', kind: 'cuoi', start_year: 1990 },
];
const FAMILY = { name: 'Họ Lưu thử nghiệm', slug: 'luu-test' };
const EXPECTED = ['ROOT', 'C1', 'SC1', 'SP', 'G1', 'GS'].sort();
const indis = (text) => [...text.matchAll(/^0 @([^@]+)@ INDI$/gm)].map((m) => m[1]).sort();

test('branch: the person, blood descendants and their spouses only', () => {
  const set = [...G.branchIds('ROOT', pc, cp)].sort();
  assert.deepStrictEqual(set, EXPECTED);
  assert.ok(!set.includes('PA') && !set.includes('SIB'), 'no ancestors or siblings');
  assert.ok(!set.includes('AD'), 'an adopted child is not a blood descendant');
  assert.ok(!set.includes('X') && !set.includes('Y'), "the spouse's other children are not descendants");
  assert.ok(!set.includes('OUT'), "a spouse's own other spouse is not in the branch");
});

test('branch: a person with no relations is a branch of one', () => {
  assert.deepStrictEqual([...G.branchIds('SIB', pc, cp)], ['SIB']);
});

test('branch export: only the set, the links only inside it', () => {
  const set = G.branchIds('ROOT', pc, cp);
  const text = G.buildExport({ R, family: FAMILY, persons: persons.filter((p) => set.has(p.id)), pc, cp, living: 'show' });
  assert.deepStrictEqual(indis(text), EXPECTED);
  assert.ok(!/@(PA|SIB|AD|X|Y|OUT)@/.test(text), 'no reference to a person outside the set');
  assert.ok(/^1 HUSB @ROOT@$/m.test(text) && /^1 WIFE @SP@$/m.test(text), 'the root couple is written');
  assert.ok(!text.includes('1 HUSB @X@'), "the spouse's other partner is not written");
  // the parent-child link of C1 and SP is kept, the adopted child link is not
  assert.ok(text.includes('0 @') && !/1 CHIL @AD@/.test(text));
});

test('branch export: privacy as the full export (contacts per visibility, living hidden on request)', () => {
  const set = G.branchIds('ROOT', pc, cp);
  const inSet = persons.filter((p) => set.has(p.id));
  const shown = G.buildExport({ R, family: FAMILY, persons: inSet, pc, cp, living: 'show' });
  assert.ok(shown.includes('0900000001'), 'a deceased or public contact (SP, contact_public yes) is written');
  assert.ok(shown.includes('0900000002') && shown.includes('phuc@example.test'), 'a living person with a public contact is written');
  assert.ok(!shown.includes('0900000003') && !shown.includes('0900000004'), 'a living person without a public contact has no phone');
  const hidden = G.buildExport({ R, family: FAMILY, persons: inSet, pc, cp, living: 'hide' });
  assert.deepStrictEqual(indis(hidden), ['ROOT'], 'people without a death date count as living and are left out with living=hide');
});

test('branch round trip: the branch file imports as the same number of people', () => {
  const set = G.branchIds('ROOT', pc, cp);
  const text = G.buildExport({ R, family: FAMILY, persons: persons.filter((p) => set.has(p.id)), pc, cp, living: 'show' });
  const doc = G.readGedcom(R, text);
  assert.strictEqual(doc.persons.length, EXPECTED.length);
  const plan = G.planImport(doc, { R, F, persons: [], events: [], stories: [], pc: [], cp: [], relMode: 'table',
    newId: (x) => 'N' + x.replace(/\W/g, '').slice(0, 12).toLowerCase() });
  assert.strictEqual(plan.counts.new, EXPECTED.length);
});

// ---- endpoint (scratch database) ----
const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `branch-${TAG}`;
const CODE = 'gb-code-' + crypto.randomBytes(4).toString('hex');
const MEMBER = `gb.member.${TAG}@example.test`;
const OUTSIDER = `gb.outsider.${TAG}@example.test`;
let base; let pool; let close; let editorCookie; let memberCookie; let outsiderCookie;
const PFX = `B${TAG.toUpperCase()}`;

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
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Họ thử nhánh','public')", [FAM]);
  const ids = Object.fromEntries(Object.keys(PEOPLE).map((k) => [k, `${PFX}${k}`]));
  for (const [k, d] of Object.entries(PEOPLE)) await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [ids[k], FAM, d, 'test']);
  await pool.query("insert into relation_migrations (family_id, counts) values ($1, '{}')", [FAM]);
  for (const r of pc) await pool.query('insert into parent_child (family_id, parent_id, child_id, kind) values ($1,$2,$3,$4)', [FAM, ids[r.parent_id], ids[r.child_id], r.kind]);
  for (const r of cp) await pool.query('insert into couple (family_id, a_id, b_id, kind, start_year) values ($1,$2,$3,$4,$5)', [FAM, ids[r.a_id], ids[r.b_id], r.kind, r.start_year || null]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  editorCookie = (await call('POST', '/api/login', { code: CODE })).headers.get('set-cookie').split(';')[0];
  memberCookie = (await call('POST', '/api/test/session', { email: MEMBER, name: 'Thành viên nhánh' })).headers.get('set-cookie').split(';')[0];
  outsiderCookie = (await call('POST', '/api/test/session', { email: OUTSIDER, name: 'Người ngoài' })).headers.get('set-cookie').split(';')[0];
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thành viên nhánh',$2,'member','active')", [MEMBER, FAM]);
});
test.after(async () => {
  if (skip || !pool) return;
  if (close) await close();
  await pool.query('delete from couple where family_id=$1', [FAM]);
  await pool.query('delete from parent_child where family_id=$1', [FAM]);
  await pool.query('delete from relation_migrations where family_id=$1', [FAM]);
  await pool.query('delete from history where person_id in (select id from persons where family_id=$1)', [FAM]);
  await pool.query('delete from members where family_id=$1', [FAM]);
  await pool.query('delete from persons where family_id=$1', [FAM]);
  await pool.query('delete from families where id=$1', [FAM]);
  await pool.end().catch(() => {});
});

test('endpoint: scope=branch only; a guest signs in, an outsider is refused, a member gets the branch', { skip }, async () => {
  const url = `/api/persons/${PFX}ROOT/gedcom?scope=branch&family=${FAM}`;
  assert.strictEqual((await call('GET', url)).status, 401);
  assert.strictEqual((await call('GET', url, undefined, outsiderCookie)).status, 403);
  assert.strictEqual((await call('GET', `/api/persons/${PFX}ROOT/gedcom?family=${FAM}`, undefined, memberCookie)).status, 400);
  assert.strictEqual((await call('GET', `/api/persons/${PFX}NOPE/gedcom?scope=branch&family=${FAM}`, undefined, memberCookie)).status, 404);
  const r = await call('GET', url, undefined, memberCookie);
  assert.strictEqual(r.status, 200, r.text);
  assert.ok(r.headers.get('content-disposition').includes('filename="luu-van-hieu-nhanh.ged"'));
  assert.deepStrictEqual(indis(r.text), EXPECTED.map((k) => `${PFX}${k}`).sort());
  assert.ok(!r.text.includes(`0 @${PFX}PA@ INDI`) && !r.text.includes(`0 @${PFX}SIB@ INDI`));
});

test('endpoint: the branch file imports as the same number of people in an empty family', { skip }, async () => {
  const url = `/api/persons/${PFX}ROOT/gedcom?scope=branch&family=${FAM}`;
  const file = (await call('GET', url, undefined, memberCookie)).text;
  const DEST = `branch-dest-${TAG}`;
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Họ nhận nhánh','public')", [DEST]);
  try {
    const r = await call('POST', '/api/gedcom/import', { family: DEST, content: file, dry_run: false }, editorCookie);
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.applied.persons_created, EXPECTED.length);
    const n = (await pool.query('select count(*)::int n from persons where family_id=$1 and not deleted', [DEST])).rows[0].n;
    assert.strictEqual(n, EXPECTED.length);
  } finally {
    await pool.query('delete from suggestions where family_id=$1', [DEST]);
    await pool.query('delete from events where family_id=$1', [DEST]);
    await pool.query('delete from history where person_id in (select id from persons where family_id=$1)', [DEST]);
    await pool.query('delete from ops where person_id in (select id from persons where family_id=$1)', [DEST]);
    await pool.query('delete from parent_child where family_id=$1', [DEST]);
    await pool.query('delete from couple where family_id=$1', [DEST]);
    await pool.query('delete from relation_migrations where family_id=$1', [DEST]);
    await pool.query('delete from persons where family_id=$1', [DEST]);
    await pool.query('delete from families where id=$1', [DEST]);
  }
});
