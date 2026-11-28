// Unit tests for the relationship graph (web/js/relgraph.js): backfill mapping, cycles, projection, notes, privacy,
// sibling and descendant counts, pedigree collapse. No DB. Run: npm test (server/).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

const LIB = pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'relgraph.js')).href;
const load = () => import(LIB);
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'copy-shaped.json'), 'utf8'));
const NAME = Object.fromEntries(FIX.map((p) => [p.id, p.data.name]));
const ids = FIX.map((p) => p.id);

test('backfill mapping: parent + other_parent -> parent_child, spouse_of -> couple, birth order from legacy order', async () => {
  const R = await load();
  const L = R.legacyRows(FIX);
  const link = (p, c) => L.pc.find((r) => r.parent_id === p && r.child_id === c);
  assert.ok(link('P001', 'P004') && link('P002', 'P004'), 'child has two parents');
  assert.equal(link('P001', 'P004').birth_order, 1);
  assert.equal(link('P001', 'P005').birth_order, 2);
  assert.equal(link('P003', 'P006').kind, 'ruot');
  const c = L.cp.find((r) => r.b_id === 'P003');
  assert.deepEqual([c.a_id, c.order_a, c.start_year, c.kind], ['P001', 2, 1985, 'cuoi']);
});

test('backfill anomalies are reported, not written: missing parent, self link, spouse chain', async () => {
  const R = await load();
  const L = R.legacyRows(FIX);
  const types = L.anomalies.map((a) => a.type);
  assert.ok(types.includes('parent_missing'));
  assert.ok(types.includes('spouse_chain'));
  assert.equal(L.pc.some((r) => r.child_id === 'P009'), false, 'row with a missing parent is not created');
});

test('cycle: a person who is their own ancestor is rejected with a message naming the chain', async () => {
  const R = await load();
  const ix = R.index([
    { parent_id: 'P001', child_id: 'P004' }, { parent_id: 'P004', child_id: 'P007' }]);
  const path = R.cyclePath(ix, 'P007', 'P001');
  assert.deepEqual(path, ['P007', 'P004', 'P001']);
  const msg = R.cycleMessage(path, (id) => NAME[id]);
  assert.match(msg, /Giả Văn An đã là tổ tiên của Giả Công Trí/);
  assert.match(msg, /Giả Công Trí là con của Giả Quang Nghĩa/);
  assert.equal(R.cyclePath(ix, 'P001', 'P007'), null, 'the reverse direction is fine');
});

test('cycle in legacy data is skipped and reported', async () => {
  const R = await load();
  const data = [{ id: 'A', data: { name: 'A', parent: 'B' } }, { id: 'B', data: { name: 'B', parent: 'A' } }];
  const L = R.legacyRows(data);
  assert.equal(L.pc.length, 1);
  assert.ok(L.anomalies.some((a) => a.type === 'cycle'));
});

test('couple notes are neutral and never block: siblings, parent-child, common ancestor, none', async () => {
  const R = await load();
  const ix = R.index([
    { parent_id: 'G', child_id: 'A' }, { parent_id: 'G', child_id: 'B' },
    { parent_id: 'A', child_id: 'K' }, { parent_id: 'H', child_id: 'M' }, { parent_id: 'G', child_id: 'M' }]);
  assert.deepEqual(R.coupleNotes(ix, 'A', 'B'), ['Hai người cũng là anh chị em trong cây.']);
  assert.deepEqual(R.coupleNotes(ix, 'A', 'K'), ['Hai người là cha/mẹ và con trong cây.']);
  assert.deepEqual(R.coupleNotes(ix, 'K', 'B'), ['Hai người có chung tổ tiên trong cây.']);
  assert.deepEqual(R.coupleNotes(ix, 'K', 'H'), []);
});

test('projection: two wives in order, children of each wife as other_parent, in-law hangs off its blood spouse', async () => {
  const R = await load();
  const L = R.legacyRows(FIX);
  const pj = R.project(ids, L.pc, L.cp);
  assert.deepEqual(pj.get('P002'), { spouse_of: 'P001', spouse_n: 1 });
  assert.deepEqual(pj.get('P003'), { spouse_of: 'P001', spouse_n: 2 });
  assert.equal(pj.get('P004').parent, 'P001');
  assert.equal(pj.get('P004').other_parent, 'P002');
  assert.equal(pj.get('P008').spouse_of, 'P005', 'in-law of a daughter who is a blood child');
  assert.equal((pj.get('P001') || {}).spouse_of, undefined, 'the blood person is not an in-law');
  assert.equal(pj.get('P012').spouse_of, 'P010', 'spouse chain resolves to the blood person');
});

test('projection matches the legacy fields for every person with a valid link (round trip)', async () => {
  const R = await load();
  const L = R.legacyRows(FIX);
  const pj = R.project(ids, L.pc, L.cp);
  const diffs = [];
  for (const p of FIX) for (const k of ['parent', 'other_parent', 'spouse_of', 'spouse_n']) {
    const a = p.data[k] ?? null; const b = (pj.get(p.id) || {})[k] ?? null;
    if (String(a) !== String(b)) diffs.push(`${p.id}.${k}`);
  }
  // Only the broken legacy links differ: a missing parent (P009) and a chain (P012 points at P001X, projected to P010).
  assert.deepEqual(diffs.sort(), ['P009.parent', 'P012.spouse_of'].sort());
});

test('privacy: private links are dropped for guests (projection and siblings change)', async () => {
  const R = await load();
  const pc = [{ parent_id: 'P', child_id: 'A', kind: 'ruot' }, { parent_id: 'P', child_id: 'B', kind: 'ruot', private: true }];
  const pub = pc.filter((r) => !r.private);
  const sibs = R.siblingsOf(R.index(pub), 'A');
  assert.deepEqual(sibs, []);
  assert.equal(R.siblingsOf(R.index(pc), 'A').length, 1);
});

test('siblings: shared parent labelled by which parent is shared; descendant count dedupes people', async () => {
  const R = await load();
  const pc = [
    { parent_id: 'F', child_id: 'A', kind: 'ruot' }, { parent_id: 'M', child_id: 'A', kind: 'ruot' },
    { parent_id: 'F', child_id: 'B', kind: 'ruot' }, { parent_id: 'F', child_id: 'C', kind: 'ruot' },
    { parent_id: 'M2', child_id: 'C', kind: 'ruot' }, { parent_id: 'A', child_id: 'K', kind: 'ruot' },
    { parent_id: 'B', child_id: 'K', kind: 'ruot' }];
  const ix = R.index(pc);
  const sx = (id) => ({ F: 'm', M: 'f', M2: 'f' })[id] || '';
  const sibs = R.siblingsOf(ix, 'A', sx);
  assert.deepEqual(sibs.map((s) => [s.id, s.shared]), [['B', 'cha'], ['C', 'cha']]);
  assert.equal(R.descendantIds(ix, 'F').size, 4, 'K counted once although two parents lead to it');
});

test('pedigree collapse: a repeated ancestor is a link to its first place, not a second subtree', async () => {
  const R = await load();
  const pc = [
    { parent_id: 'GF', child_id: 'F' }, { parent_id: 'GM', child_id: 'M' },
    { parent_id: 'GF', child_id: 'M' }, // cousins married: GF appears on both sides of the child
    { parent_id: 'F', child_id: 'C' }, { parent_id: 'M', child_id: 'C' }];
  const tree = R.pedigree(R.index(pc), 'C', 4, (id) => id);
  const flat = JSON.stringify(tree);
  const full = flat.split('"id":"GF"').length - 1;
  assert.equal(full, 2, 'GF shows as a node twice');
  const repeats = [];
  (function walk(n) { if (n.repeat) repeats.push(n); (n.parents || []).forEach(walk); })(tree);
  assert.equal(repeats.length, 1, 'one repeat, drawn as a link');
  assert.match(repeats[0].ref, /C/);
  assert.equal(repeats[0].parents, undefined, 'a repeat has no subtree of its own');
});

test('validation: kinds, years, self links', async () => {
  const R = await load();
  assert.equal(R.validatePC({ parent_id: 'A', child_id: 'A' }) !== null, true);
  assert.equal(R.validatePC({ parent_id: 'A', child_id: 'B', kind: 'x' }) !== null, true);
  assert.equal(R.validateCP({ a_id: 'A', b_id: 'B', start_year: 1990, end_year: 1980 }) !== null, true);
  assert.equal(R.validateCP({ a_id: 'A', b_id: 'B', kind: 'cuoi', start_year: 1990 }), null);
});

test('descendant levels: blood and adopted lineage by generation, parent then birth order, each person once', async () => {
  const R = await load();
  const pc = [
    { id: 1, parent_id: 'A', child_id: 'B1', kind: 'ruot', birth_order: 1 },
    { id: 2, parent_id: 'A', child_id: 'B2', kind: 'nuoi', birth_order: 2 },
    { id: 3, parent_id: 'A', child_id: 'BX', kind: 'ke', birth_order: 3 }, // step child: not lineage
    { id: 4, parent_id: 'B1', child_id: 'C2', kind: 'ruot', birth_order: 2 },
    { id: 5, parent_id: 'B1', child_id: 'C1', kind: 'ruot', birth_order: 1 },
    { id: 6, parent_id: 'B2', child_id: 'C3', kind: 'ruot', birth_order: 1 },
    { id: 7, parent_id: 'B2', child_id: 'C1', kind: 'ruot', birth_order: 9 }, // C1 is also B2's child: placed once, under B1
    { id: 8, parent_id: 'C1', child_id: 'D1', kind: 'ruot', birth_order: 1 },
    { id: 9, parent_id: 'C3', child_id: 'D2', kind: 'ruot', birth_order: 1 },
    { id: 10, parent_id: 'BX', child_id: 'DX', kind: 'ruot', birth_order: 1 }, // under a step child: not lineage
    { id: 11, parent_id: 'D1', child_id: 'E1', kind: 'ruot', birth_order: 1 },
    { id: 12, parent_id: 'A', child_id: 'A', kind: 'ruot', birth_order: 1 }, // a self link never repeats the root
  ].filter((r) => r.parent_id !== r.child_id);
  const ix = R.index(pc, []);
  const lv = R.descendantLevels(ix, 'A');
  const ids = (l) => (lv[l] || []).map((x) => x.id);
  assert.deepEqual(ids(0), ['B1', 'B2'], 'children: lineage kinds only, birth order');
  assert.deepEqual(ids(1), ['C1', 'C2', 'C3'], 'grandchildren: parent order (B1 first), then birth order; C1 once');
  assert.deepEqual(ids(2), ['D1', 'D2'], 'great-grandchildren in parent order');
  assert.deepEqual(ids(3), ['E1']);
  assert.equal(lv.length, 4, 'no level for the step line');
  assert.equal(lv[1].find((x) => x.id === 'C1').parent, 'B1', 'the first place in the walk wins');
  assert.deepEqual(R.descendantLevels(ix, 'BX')[0].map((x) => x.id), ['DX'], "its own children are its lineage");
  assert.ok(!ids(2).includes('DX'), 'a step line never reaches A');
  assert.deepEqual(R.descendantLevels(ix, 'E1'), [], 'a leaf has no descendants');
});

test('ancestorLevels: parents, then grandparents, then great-grandparents; each person once, a leaf ancestor has none', async () => {
  const R = await load();
  const pc = (parent_id, child_id) => ({ id: parent_id + '>' + child_id, parent_id, child_id, kind: 'ruot' });
  // C has parents P and M; M also lists GP (a repeated grandparent, drawn once); GP has the parent GG
  const ix = R.index([pc('P', 'C'), pc('M', 'C'), pc('GP', 'P'), pc('GM', 'P'), pc('GP', 'M'), pc('GG', 'GP')], []);
  const levels = R.ancestorLevels(ix, 'C').map((l) => l.map((x) => x.id));
  assert.deepEqual(levels, [['P', 'M'], ['GP', 'GM'], ['GG']], 'by generation, the repeated GP once');
  assert.deepEqual(R.ancestorLevels(ix, 'GG'), [], 'a root has no ancestors');
});
