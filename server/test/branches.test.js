// Thủy tổ and branches (chi) worked out from the tree, with the admin's overrides: web/js/branches.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'branches.js')).href);
// minimal M like model.js buildFrom: ps = bloodline (people who married in are not in ps), byId over everyone, kids, desc
// row: [id, gen, parent, order, born, name, extra]
function mk(rows) {
  const all = rows.map(([id, gen, parent, order, born, name, extra]) => ({ id, fam: extra?.fam, data: { gen, parent, order, born, name: name || id, ...(extra?.data || {}) } }));
  const ps = all.filter((p) => !p.data.spouse_of);
  const byId = new Map(all.map((p) => [p.id, p]));
  const kids = (id) => ps.filter((p) => p.data.parent === id).sort((a, b) => (a.data.order ?? 1e9) - (b.data.order ?? 1e9));
  const desc = (id) => kids(id).reduce((n, c) => n + 1 + desc(c.id), 0);
  return { ps, all, byId, kids, desc };
}
const ids = (xs) => xs.map((p) => p.id);

// R (Đời 1) -> S (only child with descendants: single-son line) -> split at S: B1 (Thứ 2), B2 (Thứ 1), B3 (no child)
const LINE = [
  ['R', 1, null, 1, '1700'], ['S', 2, 'R', 1, '1730'], ['Sx', 2, 'R', 2, '1732'], // Sx has no descendants: not a split
  ['B1', 3, 'S', 2, '1760', 'Bình'], ['B2', 3, 'S', 1, '1758', 'An'], ['B3', 3, 'S', 3, '1765', 'Cường'],
  ['B1a', 4, 'B1'], ['B2a', 4, 'B2'], ['B2b', 4, 'B2'],
  ['W', 2, null, null, '1735', 'Vợ', { data: { spouse_of: 'S' } }], // married in: never a founder
];

test('founder: the earliest blood person with no parent; people who married in never count', async () => {
  const { autoFounder, founderOf } = await load();
  const M = mk(LINE);
  assert.equal(autoFounder(M).id, 'R');
  const f = founderOf(M, {});
  assert.equal(f.person.id, 'R'); assert.equal(f.auto, true); assert.match(f.reason, /người sớm nhất không có cha mẹ trong cây/);
});

test('founder with several roots: lowest generation, then earliest birth, then most descendants, then name', async () => {
  const { autoFounder } = await load();
  assert.equal(autoFounder(mk([['A', 2, null, null, '1700'], ['B', 1, null, null, '1800']])).id, 'B', 'generation first');
  assert.equal(autoFounder(mk([['A', 1, null, null, '1800'], ['B', 1, null, null, '12/3/1750']])).id, 'B', 'earlier birth');
  assert.equal(autoFounder(mk([['A', 1, null, null, null, 'Ánh'], ['B', 1, null, null, null, 'Bảo'], ['Bk', 2, 'B']])).id, 'B', 'more descendants');
  assert.equal(autoFounder(mk([['X', 1, null, null, null, 'Đức'], ['Y', 1, null, null, null, 'Dũng']])).id, 'Y', 'name: D before Đ');
  assert.equal(autoFounder(mk([['A', null, null, null, null, 'An'], ['B', 1, null, null, null, 'Bảo']])).id, 'B', 'unknown generation last');
  assert.equal(autoFounder(mk([['O', 3, 'gone'], ['P', 4, null]])).id, 'O', 'a parent missing from the tree counts as a root');
});

test('founder override wins; an unknown id falls back to auto', async () => {
  const { founderOf } = await load();
  const M = mk(LINE);
  assert.deepEqual([founderOf(M, { founder_person_id: 'S' }).person.id, founderOf(M, { founder_person_id: 'S' }).auto], ['S', false]);
  assert.equal(founderOf(M, { founder_person_id: 'nope' }).person.id, 'R');
});

test('branches: the first split below the founder (single-son lines are walked down); only children with descendants', async () => {
  const { branchInfo } = await load();
  const b = branchInfo(mk(LINE), {});
  assert.deepEqual(ids(b.founders), ['B2', 'B1'], 'Thứ 1 (chi trưởng) first; B3 has no descendants');
  assert.equal(b.gen, 3); assert.equal(b.splitAt.id, 'S'); assert.equal(b.auto, true); assert.match(b.reason, /chia nhánh ở đời 3/);
  assert.deepEqual(ids(branchInfo(mk(LINE), {}, undefined, { all: true }).founders), ['B2', 'B1', 'B3'], 'all: every child of the split');
  const none = branchInfo(mk([['R', 1, null], ['C', 2, 'R'], ['D', 3, 'C']]), {});
  assert.deepEqual(ids(none.founders), ['R'], 'a line that never splits is one chi'); assert.match(none.reason, /chưa chia nhánh/);
  assert.deepEqual(branchInfo(mk([]), {}).founders, [], 'empty tree');
});

test('order: birth order, then birth date/year, then Vietnamese name order; unknown last', async () => {
  const { branchInfo } = await load();
  const M = mk([['R', 1, null], ['K1', 2, 'R', null, '1905', 'Đức'], ['K2', 2, 'R', null, '3/4/1900', 'Ân'], ['K3', 2, 'R', null, null, 'Dũng'],
    ['K4', 2, 'R', null, null, 'Anh'], ['K5', 2, 'R', 1, '1950', 'Xuân'], ['K1a', 3, 'K1'], ['K2a', 3, 'K2'], ['K3a', 3, 'K3'], ['K4a', 3, 'K4'], ['K5a', 3, 'K5']]);
  assert.deepEqual(ids(branchInfo(M, {}).founders), ['K5', 'K2', 'K1', 'K4', 'K3'], 'Thứ 1 > born 1900 > born 1905 > Anh > Dũng');
  const T = mk([['R', 1, null], ['A', 2, 'R', null, null, null, { data: { thu: '2' } }], ['B', 2, 'R', null, null, null, { data: { thu: '1' } }], ['Aa', 3, 'A'], ['Bb', 3, 'B']]);
  assert.deepEqual(ids(branchInfo(T, {}).founders), ['B', 'A'], 'Thứ field when no explicit order');
});

test('overrides: manual order first (others follow automatically); branch generation', async () => {
  const { branchInfo, branchesOf, branchOf } = await load();
  const M = mk(LINE);
  assert.deepEqual(ids(branchInfo(M, { branch_order: ['B1'] }).founders), ['B1', 'B2']);
  const g2 = branchInfo(M, { branch_gen: 2 });
  assert.deepEqual(ids(g2.founders), ['S']); assert.equal(g2.auto, false); assert.equal(g2.gen, 2);
  assert.deepEqual(ids(branchesOf(M, {})), ['B2', 'B1']);
  assert.equal(branchOf(M, M.byId.get('B2b'), {}).id, 'B2');
  assert.equal(branchOf(M, M.byId.get('R'), {}), null, 'above the branches: none');
  assert.equal(branchOf(M, M.byId.get('B2b'), { branch_gen: 2 }).id, 'S');
});

test('combined pages: each family is worked out on its own', async () => {
  const { branchesOf } = await load();
  const f = (fam) => ({ fam });
  const M = mk([['R', 1, null, 1, null, 'R', f('a')], ['A1', 2, 'R', 1, null, 'A1', f('a')], ['A2', 2, 'R', 2, null, 'A2', f('a')], ['A1x', 3, 'A1', 1, null, 'x', f('a')], ['A2x', 3, 'A2', 1, null, 'y', f('a')],
    ['Q', 1, null, 1, null, 'Q', f('b')], ['Q1', 2, 'Q', 1, null, 'Q1', f('b')], ['Q11', 3, 'Q1', 1, null, 'Q11', f('b')], ['Q12', 3, 'Q1', 2, null, 'Q12', f('b')], ['Q11x', 4, 'Q11', 1, null, 'z', f('b')], ['Q12x', 4, 'Q12', 1, null, 'w', f('b')]]);
  assert.deepEqual(ids(branchesOf(M, () => ({}))), ['A1', 'A2', 'Q11', 'Q12']);
});

test('birthKey: dd/mm/yyyy, yyyy-mm-dd, yyyy, unknown', async () => {
  const { birthKey } = await load();
  assert.equal(birthKey({ born: '3/4/1900' }), 19000403);
  assert.equal(birthKey({ birth_date: '1900-04-03' }), 19000403);
  assert.equal(birthKey({ born: 'khoảng 1900' }), 19000000);
  assert.equal(birthKey({}), null);
});
