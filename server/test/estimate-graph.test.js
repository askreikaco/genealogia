// Estimates across generations (web/js/estimate-graph.js): constraint propagation over the whole family.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const mod = (f) => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href);
const TODAY = '2026-11-24';

// rows: [id, data]. Relations from parent / other_parent / spouse (the legacy fields, as the tests of #54 used).
function graph(rows) {
  const persons = new Map(rows.map(([id, d]) => [id, { ...d }]));
  const kids = new Map();
  for (const [id, d] of persons) for (const p of [d.parent, d.other_parent]) if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(id); }
  const R = {
    parents: (id) => { const d = persons.get(id); return d ? [d.parent, d.other_parent].filter(Boolean) : []; },
    children: (id) => kids.get(id) || [],
    partners: (id) => { const d = persons.get(id); return d && d.spouse ? [{ id: d.spouse }] : []; },
  };
  return { persons, R };
}
// A straight line of four generations: G1 -> G2 -> G3 -> G4 (G4 is the only dated one).
const chain = (g4 = { born: '1850' }) => [
  ['G1', { name: 'Đời 1', gen: 1, sex: 'm' }],
  ['G2', { name: 'Đời 2', gen: 2, sex: 'm', parent: 'G1' }],
  ['G3', { name: 'Đời 3', gen: 3, sex: 'm', parent: 'G2' }],
  ['G4', { name: 'Đời 4', gen: 4, sex: 'm', parent: 'G3', ...g4 }],
];

test('note helpers: years and age at death', async () => {
  const E = await mod('estimate-graph.js');
  assert.deepEqual(E.noteYears('Lính; được cấp đất sau 1802; năm 1810 dời nhà'), [1802, 1810]);
  assert.equal(E.ageAtDeathOf('bị thương; mất lúc 42 tuổi'), 42);
  assert.equal(E.ageAtDeathOf('hưởng thọ 80'), 80);
  assert.equal(E.ageAtDeathOf('không rõ'), null);
});

test('chain of 4 generations: only the great-grandchild is dated, every ancestor gets a bounded birth', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph(chain());
  const r = E.estimateFamily(persons, R, { today: TODAY });
  // G3 is 15–50 years older than G4 (1850): 1800–1835; G2 15–50 older than G3; G1 likewise
  assert.deepEqual(r.get('G3').born, [1800, 1835]);
  assert.deepEqual(r.get('G2').born, [1750, 1820]);
  assert.ok(r.get('G1').born && r.get('G1').born[0] < r.get('G1').born[1], 'G1 bounded');
  for (const id of ['G1', 'G2', 'G3']) assert.ok(r.get(id).hops > 0, `${id} has hops`);
  assert.equal(r.get('G4').born[0], 1850); assert.equal(r.get('G4').bornKnown, true);
  assert.match(r.get('G3').bornBasis.join(' '), /Đời 4|con sinh/);
});

test('mother death bounds a child birth: a child born after her death is impossible', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph([
    ['M', { name: 'Mẹ', sex: 'f', born: '1790', died: '1820' }],
    ['C', { name: 'Con', sex: 'm', parent: 'M' }],
  ]);
  const r = E.estimateFamily(persons, R, { today: TODAY });
  assert.ok(r.get('C').born[1] <= 1820, `child born <= mother death, got ${r.get('C').born}`);
  assert.match(r.get('C').bornBasis.join(' '), /mẹ Mẹ còn sống khi con sinh|sinh 15–45/);
});

test('conflict: a child born 1850 cannot have a father born 1900 (father must be 15–50 years older)', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph([
    ['F', { name: 'Cha', sex: 'm', born: '1900' }],
    ['C', { name: 'Con', sex: 'm', parent: 'F', born: '1850' }],
    ['X', { name: 'Chồng sau', sex: 'm', born: '1950' }],
  ]);
  const r = E.estimateFamily(persons, R, { today: TODAY });
  assert.equal(r.get('F').conflict, true);
  assert.equal(r.get('F').born[0], 1900, 'known date kept');
  assert.equal(E.estimateLife('F', persons, R, { today: TODAY }).conflict, true);
  assert.equal(r.get('X').conflict, false);
});

test('"mất lúc 42 tuổi" with a known birth gives the death year', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph([['P', { name: 'Người', sex: 'm', born: '1800', note: 'Lính; mất lúc 42 tuổi' }]]);
  const r = E.estimateFamily(persons, R, { today: TODAY }).get('P');
  assert.deepEqual(r.died, [1842, 1842]);
  assert.equal(r.ruleDead, false, 'death is known from the note, not by rule');
});

test('living persons get no death, whatever the relatives say', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph([
    ['M', { name: 'Mẹ', sex: 'f', born: '1900' }],
    ['C', { name: 'Con sống', sex: 'm', parent: 'M', living: 'living' }],
  ]);
  const r = E.estimateFamily(persons, R, { today: TODAY });
  assert.equal(r.get('C').died, null);
  assert.equal(r.get('C').diedKnown, false);
  assert.ok(r.get('C').born, 'the birth is still estimated');
});

test('a known date always wins: the estimate never narrows past it and the stored birth is unchanged', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph([
    ['F', { name: 'Cha', sex: 'm', born: '1800' }],
    ['C', { name: 'Con', sex: 'm', parent: 'F', born: '1820' }],
  ]);
  const r = E.estimateFamily(persons, R, { today: TODAY });
  assert.deepEqual(r.get('F').born, [1800, 1800]);
  assert.deepEqual(r.get('C').born, [1820, 1820]);
});

test('no writes to born or died: the data is the same after an estimate', async () => {
  const E = await mod('estimate-graph.js');
  const rows = [...chain(), ['M', { name: 'Mẹ', sex: 'f', died: '1880', parent: 'G1' }]];
  const { persons, R } = graph(rows);
  const before = JSON.stringify([...persons]);
  E.estimateFamily(persons, R, { today: TODAY });
  E.estimateFamilyCached('t-writes', persons, R, { today: TODAY });
  assert.equal(JSON.stringify([...persons]), before);
});

test('generation fallback applies only to a person with no other bound', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph([
    ['A', { name: 'Đời một', gen: 1, sex: 'm', born: '1800' }],
    ['B', { name: 'Đời ba không có quan hệ', gen: 3, sex: 'm' }],
  ]);
  const r = E.estimateFamily(persons, R, { today: TODAY });
  assert.deepEqual(r.get('B').born, [1850, 1860]);
  assert.equal(r.get('B').genFallback, true);
  assert.equal(r.get('B').confidence, 'low');
});

test('a person with no evidence and no generation gets no estimate', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph([['Z', { name: 'Không rõ', sex: 'm' }]]);
  assert.equal(E.estimateLife('Z', persons, R, { today: TODAY }), null);
  assert.equal(E.estimateFamily(persons, R, { today: TODAY }).get('Z').born, null);
});

test('a deceased-by-rule person (born more than 110 years ago, no death) is flagged', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph([['O', { name: 'Cụ', sex: 'm', born: '1800' }]]);
  const r = E.estimateFamily(persons, R, { today: TODAY }).get('O');
  assert.equal(r.ruleDead, true);
  assert.deepEqual(r.died, [1860, 1860], 'the existing rule: birth + 60 (events-life lifeWindow)');
});

test('memoized per family: same result while nothing changes, recomputed when a person changes', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph(chain());
  const a = E.estimateFamilyCached('memo-fam', persons, R, { today: TODAY });
  assert.equal(E.estimateFamilyCached('memo-fam', persons, R, { today: TODAY }), a);
  persons.get('G4').born = '1870';
  const b = E.estimateFamilyCached('memo-fam', persons, R, { today: TODAY });
  assert.notEqual(b, a);
  assert.deepEqual(b.get('G4').born, [1870, 1870]);
});

test('a 500-person family estimates in well under the budget (synthetic, 5 generations)', async () => {
  const E = await mod('estimate-graph.js');
  const rows = [];
  let n = 0;
  const gen = (parent, g, count) => {
    for (let i = 0; i < count && n < 500; i++) {
      const id = `S${n++}`;
      const d = { name: `Người ${id}`, gen: g, sex: i % 2 ? 'f' : 'm' };
      if (parent) d.parent = parent;
      if (i === 0 && g === 1) d.born = '1700';
      if (g === 5 && i % 7 === 0) d.born = String(1880 + (i % 40));
      rows.push([id, d]);
      if (g < 5) gen(id, g + 1, 3);
    }
  };
  gen(null, 1, 3);
  let k = 0;
  while (n < 500) { rows.push([`X${k++}`, { name: 'Thêm', gen: 2 + (k % 4), sex: 'm', parent: `S${k % 3}` }]); n++; }
  const { persons, R } = graph(rows);
  assert.equal(persons.size, 500);
  E.estimateFamily(persons, R, { today: TODAY }); // warm up the JIT
  const t0 = performance.now();
  const r = E.estimateFamily(persons, R, { today: TODAY });
  const ms = performance.now() - t0;
  assert.equal(r.size, 500);
  assert.ok(ms < 500, `estimate took ${ms.toFixed(1)} ms`);
});

test('own child: father 15–50 and mother 15–45 years older than the child', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph([
    ['F', { name: 'Cha Thử', sex: 'm' }], ['M', { name: 'Mẹ Thử', sex: 'f' }],
    ['C', { name: 'Con', parent: 'F', other_parent: 'M', born: '1850' }],
  ]);
  const r = E.estimateFamily(persons, R, { today: TODAY });
  assert.deepEqual(r.get('F').born, [1800, 1835]);
  assert.deepEqual(r.get('M').born, [1805, 1835]);
  assert.match(r.get('F').bornBasis.join(' '), /con C: cha sinh 15–50 năm trước con|con Con: cha sinh 15–50 năm trước con/);
});

test('grandchild, parent (by sex), spouse and sibling intervals intersect (narrowest wins)', async () => {
  const E = await mod('estimate-graph.js');
  const { persons, R } = graph([
    ['GF', { name: 'Ông', sex: 'm', born: '1800' }],
    ['P', { name: 'Người cần ước tính', sex: 'm', parent: 'GF', spouse: 'W' }],
    ['W', { name: 'Vợ', sex: 'f', born: '1830' }],
    ['S', { name: 'Em', sex: 'f', parent: 'GF', born: '1835' }],
    ['K', { name: 'Con', sex: 'm', parent: 'P' }],
    ['G', { name: 'Cháu', parent: 'K', born: '1890' }],
  ]);
  const e = E.estimateLife('P', persons, R, { today: TODAY });
  // father 1800: 1815..1850; spouse 1830: 1810..1850; sibling 1835: 1810..1860; grandchild 1890 via K: 1790..1860
  assert.deepEqual(e.born, [1815, 1850]);
  assert.equal(e.conflict, false);
  assert.equal(e.confidence, 'low'); // 35 years wide: only a window, not a year
  assert.equal(e.from, '1833');
});

test('history rows follow an estimated window', async () => {
  const L = await mod('events-life.js');
  const H = await mod('events-history.js');
  const ids = L.historyRows({ name: 'Ông Thử Một' }, H.HISTORY_VI, { window: { from: '1781', to: '1823' } }).map((r) => r.id);
  assert.ok(ids.includes('h:gia-long'), ids.join(' '));
  assert.ok(!ids.some((i) => i.startsWith('h:tu-duc')));
  assert.deepEqual(L.historyRows({ name: 'x' }, H.HISTORY_VI, {}), []);
});

test('estimated rows: Sinh / Mất (ước tính) only for the missing years; a stored event replaces the row', async () => {
  const E = await mod('estimate-graph.js');
  const L = await mod('events-life.js');
  const { persons, R } = graph([
    ['F', { name: 'Cha', sex: 'm', born: '1800' }],
    ['P', { name: 'Người', sex: 'm', parent: 'F', note: 'mất lúc 42 tuổi' }],
    ['C', { name: 'Con', sex: 'm', parent: 'P', born: '1840' }],
  ]);
  const est = E.estimateLife('P', persons, R, { today: TODAY });
  const rows = L.estimatedLifeRows('P', est, []);
  assert.deepEqual(rows.map((r) => r.type), ['sinh', 'mat']);
  assert.equal(rows[0].estimated, true); assert.equal(rows[0].group, 'self');
  assert.equal(rows[0].date_kind, 'between');
  assert.ok(rows[0].date_from <= rows[0].date_to && rows[0].basis.length > 0);
  // a stored birth of this person replaces the estimated birth row
  assert.deepEqual(L.estimatedLifeRows('P', est, [{ type: 'sinh', date_from: '1810' }]).map((r) => r.type), ['mat']);
  // a conflict or a known birth and death: no rows
  assert.deepEqual(L.estimatedLifeRows('P', { conflict: true }, []), []);
  assert.deepEqual(L.estimatedLifeRows('P', null, []), []);
});
