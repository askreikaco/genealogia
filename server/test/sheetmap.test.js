'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { headerIndex, rowToData, dataToRow, plan } = require('../sheetmap');

const H = ['ID', 'Đời', 'Thứ', 'Họ tên', 'Giới tính', 'Cha/Mẹ (ID)', 'Cha/Mẹ (tên)', 'Vợ/Chồng', 'Năm sinh'];
const { idx, headers, added } = headerIndex(H);
const W = headers.length;
const P = (id, data, extra = {}) => ({ id, data, deleted: false, version: 1, updated_at: '2026-11-18T10:00:00Z', ...extra });
const rowOf = (id, d, del) => dataToRow(idx, W, id, d, del, '', '');

test('missing headers are appended in order', () => {
  assert.ok(added.includes('Đã xóa') && added.includes('Nguồn'));
  assert.equal(headers.slice(0, H.length).join('|'), H.join('|'));
});

test('row <-> data round trip with enums', () => {
  const d = { name: 'Dương A', sex: 'f', gen: 5, parent: 'P001', living: 'living', contact_public: 'yes' };
  const back = rowToData(idx, rowOf('P010', d)).data;
  assert.equal(back.sex, 'f'); assert.equal(back.gen, 5); assert.equal(back.living, 'living'); assert.equal(back.contact_public, 'yes'); assert.equal(back._deleted, false);
});

test('first link: app wins, sheet fills empty fields', () => {
  const persons = [P('P001', { name: 'Dương Văn Tổ', gen: 1, sex: 'm' })];
  const rows = [{ r: 2, values: rowOf('P001', { name: 'Dương Văn Tổ SAI', gen: 1, sex: 'm', born: '1760' }) }];
  const out = plan({ rows, idx, width: W, persons, snaps: new Map(), nextId: () => 'P999' });
  assert.deepEqual(out.ops, [{ id: 'P001', fields: { born: '1760' } }]);
  assert.equal(out.updates.length, 1); // name written back from the app
});

test('after a snapshot: sheet edit becomes an op, app edit is written back, nothing loops', () => {
  const snap = new Map([['P001', { name: 'A', gen: 1, sex: 'm', place: 'X', _deleted: false }]]);
  const persons = [P('P001', { name: 'A', gen: 1, sex: 'm', place: 'Y' })];           // app changed place
  const rows = [{ r: 2, values: rowOf('P001', { name: 'B', gen: 1, sex: 'm', place: 'X' }) }]; // sheet changed name
  const out = plan({ rows, idx, width: W, persons, snaps: snap, nextId: () => 'P999' });
  assert.deepEqual(out.ops, [{ id: 'P001', fields: { name: 'B' } }]);
  const written = rowToData(idx, out.updates[0].values).data;
  assert.equal(written.name, 'B'); assert.equal(written.place, 'Y');
  // next run with the new snapshot and agreed data: no ops, no updates
  const s2 = new Map(out.snaps.map((s) => [s.id, s.data]));
  const again = plan({ rows: [{ r: 2, values: out.updates[0].values }], idx, width: W, persons: [P('P001', { name: 'B', gen: 1, sex: 'm', place: 'Y' })], snaps: s2, nextId: () => 'P999' });
  assert.equal(again.ops.length, 0); assert.equal(again.updates.length, 0);
});

test('new sheet row without ID gets an ID; app-only person is appended; delete mark syncs', () => {
  const persons = [P('P001', { name: 'A', gen: 1 }), P('P002', { name: 'C', gen: 2, parent: 'P001' })];
  const snap = new Map([['P001', { name: 'A', gen: 1, _deleted: false }]]);
  const rows = [{ r: 2, values: rowOf('P001', { name: 'A', gen: 1 }, true) }, { r: 3, values: rowOf('', { name: 'Mới', gen: 2, parent: 'P001' }) }];
  const out = plan({ rows, idx, width: W, persons, snaps: snap, nextId: () => 'P900' });
  assert.ok(out.ops.find((o) => o.id === 'P001' && o.fields._deleted === true));
  assert.deepEqual(out.created, ['P900']);
  assert.equal(out.appends.length, 1); assert.equal(rowToData(idx, out.appends[0]).id, 'P002');
});
