// Merge of duplicates inside one tree, pure rules: field choices, the cycle / relation guard, and the default choice.
// Invented names only. No database.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../merge-rules');

test('default choice keeps the kept person value, fills an empty field from the other, never overwrites', () => {
  const keep = { name: 'Lạc Văn Gốc', born: '1900', place: '' };
  const drop = { name: 'Lạc Văn Gốc', born: '1901', place: 'Xã Bến Thử', burial: 'Đồi Thử' };
  assert.deepEqual(M.defaultChoices(keep, drop), { born: 'keep', burial: 'drop', name: 'keep', place: 'drop' });
  const r = M.mergeData(keep, drop, {});
  assert.deepEqual(r.data, { born: '1900', name: 'Lạc Văn Gốc', place: 'Xã Bến Thử', burial: 'Đồi Thử' });
  assert.deepEqual(r.changed.map((c) => c.field).sort(), ['burial', 'place']);
});

test('an explicit choice wins per field; an empty drop value does not erase the kept one', () => {
  const keep = { name: 'Lạc Văn Gốc', born: '1900' };
  const drop = { name: 'Lạc V. Gốc', born: '1901', died: '' };
  const r = M.mergeData(keep, drop, { name: 'drop', born: 'drop', died: 'drop' });
  assert.equal(r.data.name, 'Lạc V. Gốc');
  assert.equal(r.data.born, '1901');
  assert.equal(r.data.died, undefined, 'empty values are not written');
});

test('bad choices are refused', () => {
  assert.throws(() => M.mergeData({ name: 'A' }, { name: 'A' }, { nope: 'keep' }), (e) => e.status === 400 && e.name === 'MergeError');
  assert.throws(() => M.mergeData({ name: 'A' }, { name: 'A' }, { name: 'both' }), (e) => e.status === 400);
});

test('the same person, or two people who are parent and child or partners, cannot be merged', () => {
  assert.equal(M.checkMerge('A', 'A', []).ok, false);
  assert.equal(M.checkMerge('A', 'B', [{ parent: 'A', child: 'B' }]).why, 'related');
  assert.equal(M.checkMerge('A', 'B', [{ parent: 'B', child: 'A' }]).why, 'related');
  assert.equal(M.checkMerge('A', 'B', [], [{ a: 'B', b: 'A' }]).why, 'related');
});

test('cycle guard: merging makes the kept person its own ancestor -> refused', () => {
  // B is parent of C; C is parent of A (the kept one). Merging B into A makes A the parent of C and C the parent of A.
  const edges = [{ parent: 'B', child: 'C' }, { parent: 'C', child: 'A' }];
  assert.equal(M.checkMerge('A', 'B', edges).why, 'cycle');
});

test('a merge that creates no cycle is allowed, also when both have children', () => {
  const edges = [{ parent: 'A', child: 'X' }, { parent: 'B', child: 'Y' }, { parent: 'P', child: 'A' }];
  assert.deepEqual(M.checkMerge('A', 'B', edges), { ok: true });
});
