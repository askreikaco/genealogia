// "Có thể là cùng một người" scoring (match-rules.js): true pairs reach the bar, near misses and namesakes of other
// generations stay below it, blocking only pairs people who could match. Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../match-rules');

const C = (id, family, data, extra) => R.toCtx(id, family, data, extra);

test('same full name, sex and birth year in two trees reaches the bar; a parent in common lifts it', () => {
  const a = C('a1', 'fa', { name: 'Lạc Thị Thử', sex: 'f', born: '1931' });
  const b = C('b1', 'fb', { name: 'Lạc Thị Thử', sex: 'f', born: '1931' });
  const r = R.scorePair(a, b);
  assert.ok(r.score >= R.MIN, JSON.stringify(r)); assert.ok(r.reasons.includes('cùng họ tên')); assert.ok(r.reasons.some((x) => /cùng năm sinh 1931/.test(x)));
  const p = R.scorePair(C('a2', 'fa', { name: 'Lạc Văn Mẫu', sex: 'm', born: '1931' }, { parents: ['Lạc Văn Gốc'] }),
    C('b2', 'fb', { name: 'Lạc Văn Mẫu', sex: 'm', born: '1932' }, { parents: ['Lạc Văn Gốc', 'Bùi Thị Mẹ'] }));
  assert.ok(p.score >= R.MIN, JSON.stringify(p)); assert.ok(p.reasons.includes('cùng tên cha/mẹ'));
  assert.equal(R.scorePair(a, b).score, R.scorePair(b, a).score, 'symmetric');
});

test('accents, đ and case do not matter; a different middle name costs', () => {
  const a = C('a', 'fa', { name: 'ĐOÀN văn  Thử', sex: 'm', born: '1950' });
  const b = C('b', 'fb', { name: 'Doan Van Thu', sex: 'm', born: '1950' });
  assert.ok(R.scorePair(a, b).score >= R.MIN);
  const c = C('c', 'fb', { name: 'Đoàn Hữu Thử', sex: 'm', born: '1950' });
  assert.ok(R.scorePair(a, c).score < R.MIN); assert.ok(R.scorePair(a, c).reasons.includes('tên đệm khác'));
});

test('near misses stay below the bar: name only, year 1 apart with nothing else, approximate year', () => {
  const nameOnly = R.scorePair(C('a', 'fa', { name: 'Lạc Văn Thử', sex: 'm' }), C('b', 'fb', { name: 'Lạc Văn Thử', sex: 'm' }));
  assert.ok(nameOnly.score <= 0.6 && nameOnly.reasons.some((x) => /chỉ trùng tên/.test(x)));
  const off1 = R.scorePair(C('a', 'fa', { name: 'Lạc Văn Thử', sex: 'm', born: '1940' }), C('b', 'fb', { name: 'Lạc Văn Thử', sex: 'm', born: '1941' }));
  assert.ok(off1.score < R.MIN && off1.score > 0.6, JSON.stringify(off1));
  const approx = R.scorePair(C('a', 'fa', { name: 'Lạc Văn Thử', sex: 'm', born: 'khoảng 1940' }), C('b', 'fb', { name: 'Lạc Văn Thử', sex: 'm', born: '1944' }));
  assert.ok(approx.score < R.MIN && approx.reasons.some((x) => /gần nhau/.test(x)));
});

test('namesakes of different generations, other sex, other given name or surname: far below or zero', () => {
  const g = R.scorePair(C('a', 'fa', { name: 'Lạc Văn Thử', sex: 'm', born: '1890', died: '1950' }, { parents: ['Lạc Văn Gốc'] }),
    C('b', 'fb', { name: 'Lạc Văn Thử', sex: 'm', born: '1950' }, { parents: ['Lạc Văn Gốc'] }));
  assert.ok(g.score < 0.5, JSON.stringify(g)); assert.ok(g.reasons.some((x) => /khác xa/.test(x)));
  assert.equal(R.scorePair(C('a', 'fa', { name: 'Lạc Thị Thử', sex: 'f' }), C('b', 'fb', { name: 'Lạc Văn Thử', sex: 'm' })).score, 0);
  assert.equal(R.scorePair(C('a', 'fa', { name: 'Lạc Văn Thử' }), C('b', 'fb', { name: 'Lạc Văn Thanh' })).score, 0);
  assert.equal(R.scorePair(C('a', 'fa', { name: 'Lạc Văn Thử' }), C('b', 'fb', { name: 'Bùi Văn Thử' })).score, 0);
  assert.equal(R.scorePair(C('a', 'fa', { name: 'Lạc Văn Thử' }), C('b', 'fa', { name: 'Lạc Văn Thử' })).score, 0, 'same tree');
});

test('places: a shared place id counts more than the same written text', () => {
  const base = { name: 'Lạc Văn Thử', sex: 'm', born: '1940' };
  const id = R.scorePair(C('a', 'fa', base, { places: [7] }), C('b', 'fb', base, { places: [7] }));
  const tx = R.scorePair(C('a', 'fa', { ...base, burial: 'Xã Bến Thử' }), C('b', 'fb', { ...base, burial: 'xa ben thu' }));
  assert.ok(id.reasons.includes('cùng địa danh') && tx.reasons.includes('cùng nơi (theo chữ ghi)'));
  assert.ok(id.score > tx.score);
});

test('blocking: only same surname + given name with near birth decades are paired, across trees only', () => {
  const people = [
    C('a1', 'fa', { name: 'Lạc Văn Thử', born: '1931' }), C('b1', 'fb', { name: 'Lạc Văn Thử', born: '1938' }),
    C('b2', 'fb', { name: 'Lạc Văn Thử', born: '1975' }), C('b3', 'fb', { name: 'Lạc Văn Thử' }),
    C('a2', 'fa', { name: 'Lạc Văn Thử', born: '1932' }), C('c1', 'fc', { name: 'Lạc Văn Khác', born: '1931' }),
  ];
  const { pairs } = R.allPairs(people);
  const keys = pairs.map(([x, y]) => [x.id, y.id].sort().join('-')).sort();
  assert.deepEqual(keys, ['a1-b1', 'a1-b3', 'a2-b1', 'a2-b3'], 'no 1930s-1970s pair, no same-tree pair, no other given name');
  const big = Array.from({ length: 30 }, (_, i) => C('x' + i, 'f' + (i % 3), { name: 'Lạc Văn Phổ' }));
  assert.equal(R.allPairs(big, { cap: 20 }).skipped[0].size, 30);
  assert.equal(R.candidatePairs([people[0]], people.slice(1, 4)).length, 2, 'candidatePairs: 1930s + unknown');
});
