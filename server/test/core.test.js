'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { publicView, validateOp, mergeOp, validateValue } = require('../core');

test('contacts of living people are hidden unless public', () => {
  const d = { name: 'A', phone: '90', email: 'a@x' };
  assert.equal(publicView(d).phone, undefined);
  assert.equal(publicView({ ...d, contact_public: 'yes' }).phone, undefined, 'living: a placeholder for visitors, even with contacts public');
  assert.equal(publicView({ ...d, contact_public: 'yes', died: '2001' }).phone, undefined);
});

test('ops are validated', () => {
  assert.equal(validateOp({ op_id: 'x', id: 'P001', fields: { name: 'B' } }), null);
  assert.match(validateOp({ op_id: 'x', id: 'P001', fields: { hack: 1 } }), /unknown field/);
  assert.match(validateOp({ op_id: 'x', id: 'bad', fields: { name: 'B' } }), /bad person id/);
  assert.match(validateOp({ op_id: 'x', id: 'P001', fields: { sex: 'x' } }), /one of/);
  assert.equal(validateOp({ op_id: 'x', id: 'Nab12cd34-ef', fields: { name: 'C', order: 12.5, gen: 6 } }), null);
});

test('newest write wins per field', () => {
  const row = { data: { name: 'A', place: 'X' }, field_ts: { name: 200 }, deleted: false };
  const m = mergeOp(row, { fields: { name: 'old', place: 'Y' }, ts: 100 }, 1000);
  assert.equal(m.data.name, 'A');           // older edit ignored
  assert.equal(m.data.place, 'Y');          // field without a clock accepts
  assert.deepEqual(m.changes.map((c) => c.field), ['place']);
  const d = mergeOp(row, { fields: { _deleted: true }, ts: 300 }, 1000);
  assert.equal(d.deleted, true);
});

test('public sees only the birth year (dead); a living person is a placeholder', () => {
  const living = publicView({ name: 'A', born: '1990', birth_date: '02/03/1990' });
  assert.equal(living.hidden_living, true); assert.equal(living.name, '');
  assert.equal(living.born, undefined); assert.equal(living.birth_date, undefined);
  assert.equal(publicView({ name: 'B', died: '2000', birth_date: '02/03/1920' }).birth_date, undefined);
});

test('death_date is private like birth_date; birth_place is public', () => {
  assert.equal(publicView({ name: 'B', died: '2000', death_date: '03/05/2000', birth_place: 'Huế' }).death_date, undefined);
  assert.equal(publicView({ name: 'B', died: '2000', death_date: '03/05/2000', birth_place: 'Huế' }).birth_place, 'Huế');
  assert.equal(validateValue('death_date', '03/05/2000'), null);
  assert.equal(validateValue('birth_place', 'Huế'), null);
});

test('has_contact: a living person is a placeholder with no flag; dead people never get one', () => {
  const d = { name: 'A', phone: '90', email: 'a@x' };
  assert.equal(publicView(d, { flag: true }).has_contact, undefined, 'living: placeholder, no flag');
  assert.equal(publicView({ ...d, died: '2001' }, { flag: true }).has_contact, undefined, 'dead: no flag');
});
