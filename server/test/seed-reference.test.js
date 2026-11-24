// Reference-tree seed (scripts/seed-reference.js) on a SCRATCH database: the dry run writes nothing; apply creates the
// expected rows; a re-run creates 0; a person with another QID, or a QID held by a non-reference family, is never
// touched; no living people. Builder rules (scripts/build-reference-specs.js) on a synthetic dataset.
// Needs GP_TEST_DATABASE_URL (scratch DB); skipped otherwise.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Pool } = require('pg');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const SERVER = path.resolve(__dirname, '..');
const TAG = crypto.randomBytes(3).toString('hex');
const BASE = 900000000 + Math.floor(Math.random() * 50000000); // QIDs unique per run (matching is global by QID)
const qid = (i) => `Q${BASE + i}`;
const SLUG1 = `ref-test-${TAG}`; const SLUG2 = `ref-test2-${TAG}`;
const DEMO = 'duong'; // the app's seeded family: must never change
let pool, dir, specFile, specRedo;

const run = (args) => new Promise((resolve) => execFile(process.execPath, args, { cwd: SERVER, env: { ...process.env, DATABASE_URL: URL_ }, timeout: 120000 },
  (err, stdout, stderr) => resolve({ code: err ? err.code || 1 : 0, out: `${stdout}${stderr}` })));
const total = (out) => { const m = /TOTAL create=(\d+) update=(\d+) skip=(\d+) conflict=(\d+)/.exec(out); return m ? m.slice(1).map(Number) : null; };
const yearOf = (s) => {
  if (/^trước CN/.test(s || '')) return -Infinity;
  const m = /(\d+)/.exec(s || '');
  return m ? parseInt(m[1], 10) : null;
};

const A = qid(1); const B = qid(2); const C = qid(3); const D = qid(4); const E = qid(5); const OTHER = qid(6);
function spec(withB) {
  const persons = [
    { ref: A, name: 'Tổ A', alt_names: ['A-romaji', '甲'], sex: 'm', group: A, order: 1, born: '900', died: '950', source_url: 'https://example.test/A' },
    { ref: B, name: 'Con B', sex: 'f', born: '920', died: '970', ...(withB ? { note: 'đổi' } : {}) },
    { ref: C, name: 'Vợ C', born: 'khoảng 905' },
    { ref: D, name: 'Thần D', note: 'Truyền thuyết. Không có ngày chính xác.' },
  ];
  return { trees: [{ slug: SLUG1, name: `Họ Thử ${TAG}`, surname: 'Thử', han: '試', country: 'VN', visibility: 'public',
    tags: ['tham-khao', 'chua-xac-minh'], source: 'test', persons,
    links: [{ parent: A, child: B }, { a: A, b: C, kind: 'couple' }] }] };
}
const conflictTree = { trees: [{ slug: SLUG2, name: `Họ Thử 2 ${TAG}`, visibility: 'public', tags: [], source: 'test',
  persons: [{ ref: E, name: 'Người E' }], links: [] }] };

test.before(async () => {
  if (skip) return;
  pool = new Pool({ connectionString: URL_ });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refseed-'));
  specFile = path.join(dir, 'spec.json'); specRedo = path.join(dir, 'spec-redo.json');
  fs.writeFileSync(specFile, JSON.stringify({ trees: [...spec(false).trees, ...conflictTree.trees] }));
  fs.writeFileSync(specRedo, JSON.stringify(spec(true)));
  // a QID already held by the seeded (non-reference) family: the tree that wants it must be refused, not touched
  await pool.query("insert into persons (id, data, family_id) values ($1, $2, $3) on conflict do nothing",
    [`X${TAG}e`, { name: 'Người E gốc', ext: { wikidata: E } }, DEMO]);
});
test.after(async () => {
  if (skip) return;
  await pool.end();
  fs.rmSync(dir, { recursive: true, force: true });
});

const count = async (sql, args) => Number((await pool.query(sql, args)).rows[0].n);

test('dry run (default) writes nothing and reports the plan', { skip }, async () => {
  const before = await count('select count(*)::int n from persons where family_id = $1', [SLUG1]);
  const r = await run(['scripts/seed-reference.js', specFile]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /DRY RUN: nothing written/);
  assert.match(r.out, new RegExp(`\\[${SLUG1}\\][\\s\\S]*persons {7}create 4 \\| update 0 \\| skip 0 \\| conflict 0`));
  assert.match(r.out, new RegExp(`\\[${SLUG2}\\][\\s\\S]*conflict 1`));
  assert.match(r.out, /CONFLICT .*is in family duong/);
  // creates: tree 1 only (family 1 + persons 4 + parent_child 1 + couple 1); tree 2 is blocked, so it adds 1 conflict
  assert.deepStrictEqual(total(r.out), [7, 0, 0, 1]);
  assert.strictEqual(await count('select count(*)::int n from families where id = $1', [SLUG1]), 0);
  assert.strictEqual(await count('select count(*)::int n from persons where family_id = $1', [SLUG1]), before);
});

test('apply creates the expected rows; the conflicting tree is skipped whole', { skip }, async () => {
  const r = await run(['scripts/seed-reference.js', specFile, '--apply']);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /APPLIED: 1 of 2 tree\(s\)/);
  assert.match(r.out, /tree skipped \(conflicts\)/);
  const fam = (await pool.query('select id, visibility, han, name from families where id = $1', [SLUG1])).rows[0];
  assert.deepStrictEqual([fam.id, fam.visibility, fam.han], [SLUG1, 'public', '試']);
  const owner = (await pool.query("select m.role, m.status, a.id as acc from members m join accounts a on a.id = m.account_id where m.family_id = $1 and m.email = 'reference@giapha.invalid'", [SLUG1])).rows[0];
  assert.deepStrictEqual([owner.role, owner.status], ['owner', 'active']);
  assert.strictEqual(await count('select count(*)::int n from persons where family_id = $1', [SLUG1]), 4);
  assert.strictEqual(await count('select count(*)::int n from parent_child where family_id = $1', [SLUG1]), 1);
  assert.strictEqual(await count('select count(*)::int n from couple where family_id = $1', [SLUG1]), 1);
  assert.strictEqual(await count('select count(*)::int n from relation_migrations where family_id = $1', [SLUG1]), 1);
  const ext = (await pool.query("select data->'ext' as e from persons where data->'ext'->>'wikidata' = $1", [A])).rows[0].e;
  assert.deepStrictEqual([ext.group, ext.order], [A, 1], 'group and order stored in ext');
  assert.strictEqual(await count('select count(*)::int n from families where id = $1', [SLUG2]), 0);
  // the conflicting person in the seeded family is unchanged
  const e = (await pool.query('select data, version, family_id from persons where id = $1', [`X${TAG}e`])).rows[0];
  assert.strictEqual(e.family_id, DEMO);
  assert.strictEqual(e.data.name, 'Người E gốc');
});

test('a person with another QID in the reference family is never touched', { skip }, async () => {
  const other = await pool.query('insert into persons (id, data, family_id) values ($1, $2, $3) returning version', [`X${TAG}o`, { name: 'Tổ A', ext: { wikidata: OTHER } }, SLUG1]);
  const r = await run(['scripts/seed-reference.js', specFile, '--apply']);
  assert.strictEqual(r.code, 0, r.out);
  const row = (await pool.query('select data, version from persons where id = $1', [`X${TAG}o`])).rows[0];
  assert.deepStrictEqual(row.data, { name: 'Tổ A', ext: { wikidata: OTHER } });
  assert.strictEqual(Number(row.version), Number(other.rows[0].version));
});

test('re-run creates nothing and updates nothing', { skip }, async () => {
  const persons = await count('select count(*)::int n from persons where family_id = $1', [SLUG1]);
  const r = await run(['scripts/seed-reference.js', specFile, '--apply']);
  assert.strictEqual(r.code, 0, r.out);
  const [create, update] = total(r.out);
  assert.strictEqual(create, 0);
  assert.strictEqual(update, 0);
  assert.strictEqual(await count('select count(*)::int n from persons where family_id = $1', [SLUG1]), persons);
  assert.strictEqual(await count("select count(*)::int n from persons where data->'ext'->>'wikidata' = any($1)", [[A, B, C, D]]), 4);
});

test('a changed spec field updates the matched person (history row), omitted fields stay', { skip }, async () => {
  const r = await run(['scripts/seed-reference.js', specRedo, '--apply']);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /persons {7}create 0 \| update 1 \| skip 3/);
  const b = (await pool.query("select data from persons where data->'ext'->>'wikidata' = $1", [B])).rows[0].data;
  assert.strictEqual(b.note, 'đổi');
  assert.strictEqual(b.name, 'Con B');
  assert.strictEqual(await count("select count(*)::int n from history where person_id = (select id from persons where data->'ext'->>'wikidata' = $1) and field = 'note' and source = 'seed'", [B]), 1);
});

test('no living people in the reference tree', { skip }, async () => {
  const rows = (await pool.query("select data from persons where family_id = $1 and data->'ext'->>'wikidata' = any($2)", [SLUG1, [A, B, C, D]])).rows;
  assert.strictEqual(rows.length, 4);
  for (const { data } of rows) {
    const ok = data.died || /^Truyền thuyết\./.test(data.note || '') || (yearOf(data.born) !== null && yearOf(data.born) <= 1926);
    assert.ok(ok, `living or unknown: ${data.name}`);
  }
});

test('builder: one Vietnam family, groups ordered by year, undated last, no cross-group links, living excluded', { skip }, async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'refseed-src-'));
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'refseed-raw-'));
  const vi = fs.mkdtempSync(path.join(os.tmpdir(), 'refseed-vi-'));
  const out = path.join(dir, 'out');
  const p = (qid_, extra) => ({ qid: qid_, label: { vi: `Người ${qid_}` }, description: {}, wikidata_url: `https://www.wikidata.org/wiki/${qid_}`, ...extra });
  const dt = (y) => ({ time: `${y < 0 ? '-' : '+'}${String(Math.abs(y)).padStart(4, '0')}-00-00T00:00:00Z`, precision: 9 });
  const claim = (id) => [{ mainsnak: { datavalue: { value: { id } } } }];
  const vnp = (qid_, vi_, extra) => ({ qid: qid_, label: { vi: vi_ }, description: {}, wikidata_url: `https://www.wikidata.org/wiki/${qid_}`,
    wikipedia: { vi: `https://vi.wikipedia.org/wiki/${vi_.replace(/ /g, '_')}` }, ...extra });
  fs.writeFileSync(path.join(src, 'duong-vn.json'), JSON.stringify({ people: [
    vnp('Q1', 'Dương Tổ', { birth: dt(900), death: dt(950) }), vnp('Q2', 'Dương Con', { birth: dt(920), death: dt(960) }),
    vnp('Q5', 'Vợ Q5', { birth: dt(905), death: dt(940) }), vnp('Q9', 'Dương Lẻ', { birth: dt(1500), death: dt(1550) }),
    vnp('Q6772049', 'Dương Ngạn Địch', { birth: dt(1600), death: dt(1670) }), vnp('Q40', 'Dương Ngoại', { birth: dt(1600), death: dt(1670) }),
    p('Q7', { label: { vi: 'Wang Seven' }, birth: dt(950), death: dt(990) }), p('Q8', { label: { vi: 'Wang Eight' }, birth: dt(950), death: dt(990) }),
    p('Q3', { birth: dt(1980) }), p('Q4', {}),
  ], edges: [{ from: 'Q1', rel: 'children', to: 'Q2' }, { from: 'Q2', rel: 'father', to: 'Q1' }, { from: 'Q1', rel: 'spouses', to: 'Q5' },
    { from: 'Q3', rel: 'children', to: 'Q1' }, { from: 'Q7', rel: 'children', to: 'Q8' }] }));
  fs.writeFileSync(path.join(src, 'japan-imperial.json'), JSON.stringify({ emperors: [
    p('J1', { ordinal: 1, legendary_flag_heuristic: false, birth: dt(-711), death: dt(-585) }), p('J2', { birth: dt(1675), death: dt(1710) }),
    p('J3', { birth: dt(1990) }),
  ], edges: [{ from: 'J1', rel: 'children', to: 'J2' }, { from: 'J2', rel: 'father', to: 'J1' }] }));
  fs.writeFileSync(path.join(src, 'hwasan-ly.json'), JSON.stringify({ people: [
    p('H1', { birth: [dt(1000)], death: [dt(1054)] }), p('Q16181054', { label: { vi: 'Dòng họ Lý Hoa Sơn' } }),
  ], edges: [] }));
  fs.writeFileSync(path.join(raw, 'cache.json'), JSON.stringify({ entities: {
    Q6772049: { claims: { P27: claim('Q9903') }, labels: {}, sitelinks: { viwiki: { title: 'Dương Ngạn Địch' } } },
    Q40: { claims: { P27: claim('Q148') }, labels: {}, sitelinks: { viwiki: { title: 'Dương Ngoại' } } },
    J1: { claims: { P39: [{ mainsnak: { datavalue: { value: { id: 'Q208233' } } }, qualifiers: { P580: [{ datavalue: { value: dt(-660) } }] } }] }, labels: {}, sitelinks: {} },
    J2: { claims: { P39: [{ mainsnak: { datavalue: { value: { id: 'Q208233' } } }, qualifiers: { P580: [{ datavalue: { value: dt(1700) } }] } }], P21: claim('Q6581072') }, labels: {}, sitelinks: {} },
  } }));
  // vi.wikipedia pageprops (title -> QID) and Wikidata claims for the widening; Dương Tự Minh is the owner's undated case
  const page = (title, q) => ({ title, pageprops: { wikibase_item: q } });
  fs.writeFileSync(path.join(vi, 'pp-0.json'), JSON.stringify({ query: { pages: [
    page('Dương Tự Minh', 'Q10757626'), page('Dương Trước', 'Q50'), page('Ngô Quyền', 'Q60'), page('Dương Sống', 'Q70'), page('Dương Không Rõ', 'Q71'),
  ] } }));
  // the surname article: Dương Trước, Dương Tự Minh, Dương Sống, Dương Không Rõ are in its Vietnamese section (Chinese section after it)
  fs.writeFileSync(path.join(vi, 'surname.json'), JSON.stringify({ parse: { wikitext: '== Người Việt Nam ==\n[[Dương Trước]] [[Dương Tự Minh]] [[Dương Sống]] [[Dương Không Rõ]]\n== Người Trung Quốc ==\n[[Dương Lệ Hoa]]' } }));
  const ent = (labels, claims) => ({ labels, claims, sitelinks: { viwiki: { title: 'x' } } });
  fs.writeFileSync(path.join(vi, 'wb-0.json'), JSON.stringify({ entities: {
    Q10757626: ent({ vi: { value: 'Dương Tự Minh' } }, { P31: claim('Q5') }),
    Q50: ent({ vi: { value: 'Dương Trước' } }, { P31: claim('Q5'), P569: [{ mainsnak: { datavalue: { value: dt(1700) } } }] }),
    Q60: ent({ vi: { value: 'Ngô Quyền' } }, { P31: claim('Q5'), P569: [{ mainsnak: { datavalue: { value: dt(898) } } }] }),
    Q70: ent({ vi: { value: 'Dương Sống' } }, { P31: claim('Q5'), P569: [{ mainsnak: { datavalue: { value: dt(1990) } } }] }),
    Q71: ent({ vi: { value: 'Dương Không Rõ' } }, { P31: claim('Q5') }),
  } }));
  const r = await run(['scripts/build-reference-specs.js', src, out, '--raw', raw, '--vi', vi]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /vn wiki: pageprops QIDs 5 \(new 5\), added 2/);
  const files = fs.readdirSync(out).map((f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')).trees[0]);
  const vnTree = files.filter((t) => t.slug.startsWith('ref-duong-'));
  assert.deepStrictEqual(vnTree.map((t) => t.slug), ['ref-duong-vn'], 'one Vietnam family');
  const vn = vnTree[0];
  const byRef = new Map(vn.persons.map((x) => [x.ref, x]));
  // groups by year: Q1 group (900), Q9 (1500), Q50 (1700), owner-undated Q10757626 last
  const orderOf = (q) => byRef.get(q).order;
  assert.deepStrictEqual(['Q1', 'Q9', 'Q6772049', 'Q50', 'Q10757626'].map(orderOf), [1, 2, 3, 4, 5]);
  // owner keep list: a foreign P27 with a Vietnam life tie is kept with its note; a foreign P27 with none is excluded
  assert.match(byRef.get('Q6772049').note, /định cư Đàng Trong 1679/);
  assert.strictEqual(byRef.get('Q2').group, 'Q1'); assert.strictEqual(byRef.get('Q5').group, 'Q1');
  assert.strictEqual(byRef.get('Q2').order, 1, 'every person of a group carries the group order');
  // links stay inside a group: Q1->Q2 and Q1-Q5 only, and no link leaves the Q1 group
  assert.deepStrictEqual(vn.links.filter((l) => l.parent), [{ parent: 'Q1', child: 'Q2' }]);
  assert.deepStrictEqual(vn.links.filter((l) => l.kind), [{ a: 'Q1', b: 'Q5', kind: 'couple' }]);
  const undated = byRef.get('Q10757626');
  assert.match(undated.note, /không rõ năm/i);
  assert.strictEqual(undated.source_url, 'https://vi.wikipedia.org/wiki/' + encodeURI('Dương_Tự_Minh'));
  const all = [...files.flatMap((t) => t.persons.map((x) => x.ref))];
  for (const bad of ['Q3', 'Q4', 'Q7', 'Q8', 'Q40', 'Q60', 'Q70', 'Q71', 'Q16181054', 'J3']) assert.ok(!all.includes(bad), `${bad} must not be in a tree`);
  const jp = files.find((t) => t.slug === 'ref-jp-imperial');
  const jimmu = jp.persons.find((x) => x.ref === 'J1');
  assert.match(jimmu.note, /^Truyền thuyết\./, 'reign start -660 is before 539: legendary');
  assert.ok(!('born' in jimmu) && !('died' in jimmu), 'legendary: no exact dates');
  assert.strictEqual(jimmu.sex, 'm', 'no P21 and no empress label: male by default');
  const h = jp.persons.find((x) => x.ref === 'J2');
  assert.strictEqual(h.born, '1675');
  assert.strictEqual(h.sex, 'f', 'P21 female from the cache');
  assert.deepStrictEqual(files.map((t) => t.slug).sort(), ['ref-duong-vn', 'ref-jp-imperial', 'ref-ly-hoa-son']);
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(raw, { recursive: true, force: true });
  fs.rmSync(vi, { recursive: true, force: true });
});
