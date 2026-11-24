// Conflicting data rules (variants-rules.js): validation, what a non-member sees, counting distinct values.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../variants-rules');

test('validate: field in scope, value and source required, quality known', () => {
  assert.equal(V.validateVariant({ field: 'born', value: '1932', source: 'Bia mộ' }), null);
  assert.match(V.validateVariant({ field: 'phone', value: 'x', source: 'y' }), /chưa nhận/);
  assert.match(V.validateVariant({ field: 'born', value: '  ', source: 'y' }), /Nhập giá trị/);
  assert.match(V.validateVariant({ field: 'born', value: '1932', source: '' }), /Ghi nguồn/);
  assert.match(V.validateVariant({ field: 'born', value: '1932', source: 'a', quality: 'tuyet' }), /tin cậy/);
  assert.match(V.validateVariant({ field: 'name', value: 'x'.repeat(201), source: 'a' }), /dài quá/);
});

test('same value written differently is one value; distinct count includes the profile value', () => {
  assert.ok(V.sameValue(' Làng  Bến Xưa', 'làng bến xưa'));
  const rows = [{ value: '1931' }, { value: '1932' }, { value: ' 1931 ' }];
  assert.equal(V.distinctCount(rows, '1931'), 2);
  assert.equal(V.distinctCount(rows, '1930'), 3);
  assert.equal(V.distinctCount([], ''), 0);
});

test('non-members: years only for dates, no recorder, equal values shown once; members: everything', () => {
  const at = new Date('2025-01-02T03:00:00Z');
  const rows = [
    { id: 1, field: 'born', value: '1931-05-02', source: 'Bia mộ', quality: 'cao', by_user: 'Người Ghi Thử', created_at: at },
    { id: 2, field: 'born', value: '1931', source: 'Gia phả', quality: 'binh_thuong', by_user: 'Người Khác', created_at: at },
    { id: 3, field: 'born', value: '1932', source: 'Lời kể', quality: 'thap', by_user: 'Người Khác', created_at: at },
  ];
  const g = V.viewList(rows, '1931-05-02', { member: false });
  assert.deepEqual(g.map((x) => x.value), ['1931', '1932']);
  assert.ok(g.every((x) => x.by === ''));
  assert.equal(g[0].chosen, true);
  const m = V.viewList(rows, '1931-05-02', { member: true });
  assert.deepEqual(m.map((x) => x.value), ['1931-05-02', '1931', '1932']);
  assert.equal(m[0].by, 'Người Ghi Thử');
  assert.deepEqual(m.map((x) => x.chosen), [true, false, false]);
  assert.equal(V.viewValue('place', 'Xã Bến Thử', false), 'Xã Bến Thử');
});
