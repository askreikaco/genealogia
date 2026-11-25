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

test('the older profile is kept whatever the order: earliest created time, a missing time last, tie -> lower id', () => {
  const old = { id: 'P200', created: 1000 }; const young = { id: 'P100', created: 2000 };
  assert.deepEqual(M.olderFirst(old, young).map((x) => x.id), ['P200', 'P100']);
  assert.deepEqual(M.olderFirst(young, old).map((x) => x.id), ['P200', 'P100'], 'same result with the arguments swapped');
  assert.deepEqual(M.olderFirst({ id: 'P100', created: null }, { id: 'P200', created: 5 }).map((x) => x.id), ['P200', 'P100']);
  assert.deepEqual(M.olderFirst({ id: 'P200', created: 7 }, { id: 'P100', created: 7 }).map((x) => x.id), ['P100', 'P200'], 'tie -> lower id');
  assert.deepEqual(M.olderFirst({ id: 'P200', created: null }, { id: 'P100', created: null }).map((x) => x.id), ['P100', 'P200']);
});

test('a field empty on one side takes the other side value whatever the choice says; a conflict takes the choice', () => {
  const keep = { name: 'Lạc Văn Gốc', place: '', born: '1900' };
  const drop = { name: 'Lạc Văn Gốc', place: 'Xã Bến Thử', born: '1901' };
  const r = M.mergeData(keep, drop, { place: 'keep', born: 'drop' });
  assert.equal(r.data.place, 'Xã Bến Thử', 'filled from the other record, no choice');
  assert.equal(r.data.born, '1901', 'conflict: the chosen value');
  const r2 = M.mergeData(keep, drop, { born: 'keep' });
  assert.equal(r2.data.born, '1900', 'conflict: default is the kept value');
});

test('classification: conflicts need a choice, one-sided fields are filled, equal fields are counted', () => {
  const keep = { name: 'Lạc Văn Gốc', born: '1900', place: '' };
  const drop = { name: 'Lạc Văn Gốc', born: '1901', place: 'Xã Bến Thử', note: 'Ghi chú' };
  const c = M.classifyFields(keep, drop);
  assert.deepEqual(c.conflicts, ['born']);
  assert.deepEqual(c.filled, [{ field: 'note', from: 'drop' }, { field: 'place', from: 'drop' }]);
  assert.deepEqual(c.same, ['name']);
  assert.deepEqual(M.classifyFields({ name: 'A' }, { name: 'A' }), { conflicts: [], filled: [], same: ['name'] });
});
