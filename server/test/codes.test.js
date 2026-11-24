// Person codes (web/js/codes.js): surname letter · generation · sibling ranks from the thủy tổ.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'codes.js')).href);
// minimal M like model.js buildFrom: ps = bloodline, byId over everyone, kids by data.parent
function mk(rows) {
  const all = rows.map(([id, data]) => ({ id, data: { name: id, ...data } }));
  const ps = all.filter((p) => !p.data.spouse_of);
  const byId = new Map(all.map((p) => [p.id, p]));
  const kids = (id) => ps.filter((p) => p.data.parent === id);
  const desc = (id) => kids(id).reduce((n, c) => n + 1 + desc(c.id), 0);
  return { ps, all, byId, kids, desc };
}

test('codes: founder, children by birth order, grandchildren; generation first', async () => {
  const C = await load();
  const M = mk([
    ['R', { name: 'Đặng Văn Tổ', gen: 1 }],
    ['A', { parent: 'R', gen: 2, order: 2, name: 'Đặng Văn A' }], ['B', { parent: 'R', gen: 2, order: 1, name: 'Đặng Văn B' }],
    ['A1', { parent: 'A', gen: 3, order: 1 }], ['A2', { parent: 'A', gen: 3, order: 2 }], ['A2x', { parent: 'A2', gen: 4 }],
    ['W', { spouse_of: 'R', name: 'Lê Thị Vợ' }],
  ]);
  const c = C.personCodes(M);
  assert.equal(c.get('R'), 'D-1', 'Đ folds to D');
  assert.equal(c.get('B'), 'D-2.1'); assert.equal(c.get('A'), 'D-2.2');
  assert.equal(c.get('A1'), 'D-3.2.1'); assert.equal(c.get('A2'), 'D-3.2.2'); assert.equal(c.get('A2x'), 'D-4.2.2.1');
  assert.ok(!c.has('W'), 'people who married in get no code');
  assert.equal(new Set(c.values()).size, c.size, 'codes are unique');
});

test('codes: ties and missing order fall back to birth, then name, then id; deterministic', async () => {
  const C = await load();
  const rows = [
    ['R', { gen: 1, name: 'Võ Tổ' }],
    ['x', { parent: 'R', order: 1, born: '1900', name: 'Võ Bình' }], ['y', { parent: 'R', order: 1, born: '1898', name: 'Võ An' }], // same Thứ: older first
    ['z', { parent: 'R', born: '1890', name: 'Võ Cả' }], // no order: after every ordered child, even if older
    ['u', { parent: 'R', name: 'Võ Út' }], ['t', { parent: 'R', name: 'Võ Tư' }], // nothing known: by name
    ['s', { parent: 'R', thu: '3', name: 'Võ Ba' }], // Thứ used when order is missing
  ];
  const c = C.personCodes(mk(rows));
  assert.deepEqual(['y', 'x', 's', 'z', 't', 'u'].map((id) => c.get(id)), ['V-2.1', 'V-2.2', 'V-2.3', 'V-2.4', 'V-2.5', 'V-2.6']);
  const c2 = C.personCodes(mk(rows.slice().reverse()));
  assert.deepEqual([...c2.entries()].sort(), [...c.entries()].sort(), 'input order does not matter');
});

test('codes: adopted children and children of several spouses are ranked together under the parent', async () => {
  const C = await load();
  const M = mk([
    ['R', { gen: 1, name: 'Phan Tổ' }],
    ['k1', { parent: 'R', order: 1, other_parent: 'W1' }], ['k2', { parent: 'R', order: 2, other_parent: 'W2' }],
    ['k3', { parent: 'R', order: 3, pc_kind: 'nuoi' }],
    ['W1', { spouse_of: 'R', spouse_n: 1 }], ['W2', { spouse_of: 'R', spouse_n: 2 }],
  ]);
  const c = C.personCodes(M);
  assert.deepEqual(['k1', 'k2', 'k3'].map((id) => c.get(id)), ['P-2.1', 'P-2.2', 'P-2.3']);
  assert.ok(!c.has('W1') && !c.has('W2'));
});

test('codes: founder generation, founder override, people outside the founder line', async () => {
  const C = await load();
  const M = mk([['R', { gen: 5, name: 'Dương Tổ', born: '1900' }], ['K', { parent: 'R', gen: 6 }], ['O', { gen: 5, name: 'Dương Khác', born: '1990' }]]);
  const c = C.personCodes(M);
  assert.equal(c.get('R'), 'D-5'); assert.equal(c.get('K'), 'D-6.1');
  assert.ok(!c.has('O'), 'a second root is not under the thủy tổ');
  const c2 = C.personCodes(M, { founder_person_id: 'O' });
  assert.equal(c2.get('O'), 'D-5'); assert.ok(!c2.has('R'));
});

test('code queries: parsing and prefix match on whole segments', async () => {
  const C = await load();
  assert.equal(C.codeQuery('d-3.2'), 'D-3.2'); assert.equal(C.codeQuery(' D 3.2.1 '), 'D-3.2.1'); assert.equal(C.codeQuery('Đ-3.2.'), 'D-3.2');
  assert.equal(C.codeQuery('Dương'), null); assert.equal(C.codeQuery('3/8'), null); assert.equal(C.codeQuery('D-'), null);
  assert.ok(C.matchCode('D-3.2.1', 'D-3.2')); assert.ok(C.matchCode('D-3.2', 'D-3.2'));
  assert.ok(!C.matchCode('D-3.21', 'D-3.2')); assert.ok(!C.matchCode('D-4.2.1.1', 'D-3.2')); assert.ok(!C.matchCode('', 'D-3'));
  assert.equal(C.surnameLetter('Ông Nguyễn'), 'O'); assert.equal(C.surnameLetter(''), 'X');
});
