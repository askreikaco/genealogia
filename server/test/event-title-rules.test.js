// Unit tests for the custom event name (Khác: Tên sự kiện): validation (80 characters after trimming, text only),
// the name only for type khac, the name suggestions' counting, the auto summary and the suggestion label. No DB.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const lib = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'events.js')).href);
const base = { type: 'khac', date_kind: 'exact', date_from: '1950', place: '', description: '', people: [], sources: [] };

test('validation: a name of up to 80 characters after trimming is accepted; longer or not text is refused', async () => {
  const E = await lib();
  assert.equal(E.validateEvent({ ...base, title: 'Đỗ tú tài' }), null);
  assert.equal(E.validateEvent({ ...base, title: '  ' + 'a'.repeat(80) + '  ' }), null, 'trimmed length counts');
  assert.equal(E.validateEvent({ ...base, title: 'a'.repeat(81) }), 'Tên sự kiện tối đa 80 ký tự.');
  assert.equal(E.validateEvent({ ...base, title: null }), null, 'no name is fine');
  assert.equal(E.validateEvent({ ...base, title: 12 }), 'Tên sự kiện tối đa 80 ký tự.');
  assert.equal(E.validateEvent({ ...base, title: '' }), null, 'an empty name is no name');
});

test('the name is kept for any type, but shown only for khac', async () => {
  const E = await lib();
  assert.equal(E.validateEvent({ ...base, type: 'hoc', title: 'Lớp Nho' }), null);
  assert.equal(E.eventTitle({ type: 'khac', title: '  Đỗ tú tài ' }), 'Đỗ tú tài');
  assert.equal(E.eventTitle({ type: 'hoc', title: 'Lớp Nho' }), '');
  assert.equal(E.eventTitle({ type: 'khac' }), '');
  assert.equal(E.eventTitle(null), '');
});

test('name suggestions: counted per name, most used first then A–Z; blank and other types are left out', async () => {
  const E = await lib();
  const rows = [
    { type: 'khac', title: 'Xây nhà thờ họ' }, { type: 'khac', title: 'Đỗ tú tài' }, { type: 'khac', title: 'Xây nhà thờ họ' },
    { type: 'khac', title: '   ' }, { type: 'khac', title: null }, { type: 'hoc', title: 'Lớp Nho' }, { type: 'khac', title: 'Bia mộ tổ' },
    { type: 'khac', title: ' Đỗ tú tài ' },
  ];
  assert.deepEqual(E.usedTitles(rows), [
    { title: 'Xây nhà thờ họ', uses: 2 }, { title: 'Đỗ tú tài', uses: 2 }, { title: 'Bia mộ tổ', uses: 1 },
  ].sort((a, b) => b.uses - a.uses || a.title.localeCompare(b.title, 'vi')));
  assert.deepEqual(E.usedTitles([]), []);
});

test('auto summary: a khac event reads with its name, without one with its first description line', async () => {
  const E = await lib();
  const text = E.autoSummary('Dương Văn Ất', [
    { type: 'khac', title: 'Đỗ tú tài', date_kind: 'exact', date_from: '1930', description: 'Khoa thi Hương' },
    { type: 'khac', title: '', date_kind: 'exact', date_from: '1940', description: 'Việc khác\nchi tiết' },
  ]);
  assert.ok(text.includes('Đỗ tú tài (1930)'), text);
  assert.ok(text.includes('Việc khác (1940)'), text);
});

test('the suggestion label names the custom event, and keeps Khác when there is no name', async () => {
  const EV = require('../events');
  const typeLabel = (t) => ({ khac: 'Khác', hoc: 'Học hành' })[t] || t;
  assert.equal(EV.evLabel({ kind: 'event', action: 'add', item: { type: 'khac', title: 'Đỗ tú tài' } }, typeLabel), 'Thêm sự kiện: Đỗ tú tài');
  assert.equal(EV.evLabel({ kind: 'event', action: 'edit', item: { type: 'khac', title: '' } }, typeLabel), 'Sửa sự kiện: Khác');
  assert.equal(EV.evLabel({ kind: 'event', action: 'add', item: { type: 'hoc', title: 'Lớp Nho' } }, typeLabel), 'Thêm sự kiện: Học hành');
});
