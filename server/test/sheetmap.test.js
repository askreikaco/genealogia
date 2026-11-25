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

// ---- contacts: the list is the source for the contact columns ----
const CH = ['ID', 'Họ tên', 'Điện thoại', 'Email', 'Zalo', 'Mạng xã hội khác'];
const C = headerIndex(CH); const CW = C.headers.length;
const cRow = (id, d) => dataToRow(C.idx, CW, id, d, false, '', '');
const cell = (row, h) => row[C.idx[h]];

test('export: every value of a type is in its column, joined with "; " (first one first)', () => {
  const d = { name: 'Dương Thử', contacts: [{ type: 'phone', value: '0900000001' }, { type: 'email', value: 'thu@example.test' }, { type: 'phone', value: '0977000111' }, { type: 'other', value: 'fb.me/thu', label: 'Mạng xã hội' }] };
  const row = cRow('P010', d);
  assert.equal(cell(row, 'Điện thoại'), '0900000001; 0977000111');
  assert.equal(cell(row, 'Email'), 'thu@example.test');
  assert.equal(cell(row, 'Mạng xã hội khác'), 'fb.me/thu');
  assert.equal(cell(row, 'Zalo'), '');
});

test('export: a person with only the flat fields (before the list) shows the same columns', () => {
  const row = cRow('P011', { name: 'Dương Cũ', phone: '0900000002', email: 'cu@example.test' });
  assert.equal(cell(row, 'Điện thoại'), '0900000002');
  assert.equal(cell(row, 'Email'), 'cu@example.test');
});

test('import after a snapshot: a sheet cell adds its new values to the list and keeps the existing items', () => {
  const persons = [P('P020', { name: 'Dương Hai', contacts: [{ type: 'phone', value: '0900000001' }, { type: 'email', value: 'hai@example.test' }] })];
  const snap = new Map([['P020', { name: 'Dương Hai', phone: '0900000001', email: 'hai@example.test' }]]);
  const sheetRow = cRow('P020', { name: 'Dương Hai', phone: '0900000001; 0977000111', email: 'hai@example.test' });
  const out = plan({ rows: [{ r: 2, values: sheetRow }], idx: C.idx, width: CW, persons, snaps: snap, nextId: () => 'P999' });
  assert.deepEqual(out.ops, [{ id: 'P020', fields: { contacts: [
    { type: 'phone', value: '0900000001' }, { type: 'email', value: 'hai@example.test' }, { type: 'phone', value: '0977000111' }] } }]);
});

test('import: an empty contact cell removes nothing; an item the sheet does not show stays', () => {
  const persons = [P('P021', { name: 'Dương Ba', contacts: [{ type: 'phone', value: '0900000003' }, { type: 'phone', value: '0911000003' }] })];
  const snap = new Map([['P021', { name: 'Dương Ba', phone: '0900000003; 0911000003' }]]);
  const sheetRow = cRow('P021', { name: 'Dương Ba', phone: '' });
  const out = plan({ rows: [{ r: 2, values: sheetRow }], idx: C.idx, width: CW, persons, snaps: snap, nextId: () => 'P999' });
  assert.equal(out.ops.find((o) => o.id === 'P021'), undefined, 'no op: nothing added, nothing removed');
});

test('import: a value the rule refuses is kept as an other item (nothing typed in the Sheet is lost)', () => {
  const persons = [P('P022', { name: 'Dương Bốn' })];
  const sheetRow = cRow('P022', { name: 'Dương Bốn', phone: 'gọi cô Lan' });
  const out = plan({ rows: [{ r: 2, values: sheetRow }], idx: C.idx, width: CW, persons, snaps: new Map(), nextId: () => 'P999' });
  assert.deepEqual(out.ops[0].fields.contacts, [{ type: 'other', value: 'gọi cô Lan', label: 'Liên hệ từ Sheet' }]);
});

test('first link on a person with flat fields: the sheet adds an email to the list, the flat phone is kept as a list item', () => {
  const persons = [P('P023', { name: 'Dương Năm', phone: '0900000005' })];
  const sheetRow = cRow('P023', { name: 'Dương Năm', phone: '0900000005', email: 'nam@example.test' });
  const out = plan({ rows: [{ r: 2, values: sheetRow }], idx: C.idx, width: CW, persons, snaps: new Map(), nextId: () => 'P999' });
  assert.deepEqual(out.ops[0].fields.contacts, [{ type: 'phone', value: '0900000005' }, { type: 'email', value: 'nam@example.test' }]);
});

test('new sheet row: its contact cells become the list', () => {
  const sheetRow = cRow('', { name: 'Dương Mới', phone: '0900000006; 0900000007', email: 'moi@example.test' });
  const out = plan({ rows: [{ r: 2, values: sheetRow }], idx: C.idx, width: CW, persons: [], snaps: new Map(), nextId: () => 'P900' });
  assert.deepEqual(out.ops[0].fields.contacts, [
    { type: 'phone', value: '0900000006' }, { type: 'phone', value: '0900000007' }, { type: 'email', value: 'moi@example.test' }]);
  assert.equal(out.ops[0].fields.phone, undefined, 'no flat field is written');
});

test('round trip: export, then import the same row, gives no ops (nothing loops)', () => {
  const persons = [P('P024', { name: 'Dương Sáu', contacts: [{ type: 'phone', value: '0900000008' }, { type: 'phone', value: '0900000009' }, { type: 'email', value: 'sau@example.test' }] })];
  const snaps = new Map();
  const exported = dataToRow(C.idx, CW, 'P024', persons[0].data, false, '', '2026-11-18 10:00'); // as the sheet holds it after an export
  snaps.set('P024', dbPickForTest(persons[0].data));
  const again = plan({ rows: [{ r: 2, values: exported }], idx: C.idx, width: CW, persons, snaps, nextId: () => 'P999' });
  assert.deepEqual(again.ops, []);
  assert.deepEqual(again.updates, []);
});
// the snapshot the sync stores for a person (the same form plan() writes): list values as the sheet texts
function dbPickForTest(d) {
  const { contactsOf } = require('../contact-rules');
  const list = contactsOf(d); const t = (ty) => list.filter((c) => c.type === ty).map((c) => c.value).join('; ') || null;
  return { name: d.name, phone: t('phone'), email: t('email'), zalo: t('zalo'), facebook: t('facebook'), address: t('address'), social: t('other'), _deleted: false };
}
