// The person form's rows (web/js/person-rows.js, contacts-model.js): a Họ khác row shows only surname, type and year, and
// saving keeps every other field of the mark (confidence, source, Hán, reason, to); a contact row saves as the list does;
// "Thêm chi tiết" opens by itself only when a field in it holds a value (a spouse counts only where the family keeps it).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const JS = path.join(__dirname, '..', '..', 'web', 'js');
const load = (f) => import(pathToFileURL(path.join(JS, f)).href);

// The record as the server keeps it: a timeline with extra fields on a mark.
const RECORD = { names: [
  { type: 'birth', surname: 'Nguyễn', han: '阮', from: '1500', confidence: 'confirmed', source: 'Gia phả 1930' },
  { type: 'changed', surname: 'Trần', from: '1632', to: '1700', reason: 'theo chiếu chỉ', confidence: 'tradition' },
] };

test('surname rows: unchanged rows save exactly the record timeline (every field kept)', async () => {
  const { marksOfRows, namesClean, namesOfRecord } = await load('person-rows.js');
  const base = namesOfRecord(RECORD);
  // what the page shows: surname, type and the year it starts (the other fields are not in the page)
  const rows = base.map((e) => ({ type: e.type, surname: e.surname, from: e.from }));
  assert.deepStrictEqual(namesClean(marksOfRows(base, rows)), base);
});

test('surname rows: a changed type and year keep confidence, source, Hán and the end year', async () => {
  const { marksOfRows, namesClean, namesOfRecord } = await load('person-rows.js');
  const base = namesOfRecord(RECORD);
  const rows = [{ type: 'aka', surname: 'Nguyễn', from: '1510' }, { type: 'changed', surname: 'Trần', from: '' }];
  const out = namesClean(marksOfRows(base, rows));
  assert.deepStrictEqual(out[0], { type: 'aka', surname: 'Nguyễn', han: '阮', from: '1510', confidence: 'confirmed', source: 'Gia phả 1930' });
  assert.deepStrictEqual(out[1], { type: 'changed', surname: 'Trần', to: '1700', reason: 'theo chiếu chỉ', confidence: 'tradition' }, 'a blank year removes only the year');
});

test('surname rows: a new row saves with the type and surname only; a blank row is left out', async () => {
  const { marksOfRows, namesClean, namesOfRecord } = await load('person-rows.js');
  const base = namesOfRecord(RECORD);
  const rows = [...base.map((e) => ({ type: e.type, surname: e.surname, from: e.from })), { type: 'abroad', surname: '  Lý ', from: ' 1900 ' }, { type: 'changed', surname: ' ', from: '' }];
  const out = namesClean(marksOfRows(base, rows));
  assert.equal(out.length, 3);
  assert.deepStrictEqual(out[2], { type: 'abroad', surname: 'Lý', from: '1900' });
});

test('surname rows: a year with no surname is flagged (namesError), never saved silently', async () => {
  const { namesClean } = await load('person-rows.js');
  const { namesError } = await import(pathToFileURL(path.join(JS, 'surname-rules.js')).href);
  const bad = namesClean([{ type: 'changed', surname: '', from: '1800' }]);
  assert.equal(bad.length, 1);
  assert.match(namesError(bad), /cần họ/);
});

test('contact rows: the saved list reads back the same (trimmed, email lower-case, blank rows left out)', async () => {
  const { cleanList, listOf } = await load('contacts-model.js');
  const rows = [{ type: 'phone', value: ' 0912  345 678 ' }, { type: 'email', value: 'Ten@Example.COM' }, { type: 'zalo', value: '' }, { type: 'facebook', value: 'facebook.com/ten' }];
  const saved = cleanList(rows);
  assert.deepStrictEqual(saved, [{ type: 'phone', value: '0912 345 678' }, { type: 'email', value: 'ten@example.com' }, { type: 'facebook', value: 'facebook.com/ten' }]);
  assert.deepStrictEqual(listOf({ contacts: saved }), saved);
});

test('Thêm chi tiết: closed for an empty person, opens for a value, ignores derived chips', async () => {
  const { foldHasValue } = await load('person-rows.js');
  const empty = { name: 'A', gen: '3', thu: '2', birth_lunar: '12/2', death_lunar: '', spouse: '', married: '', other_parent: '', parent: '' };
  assert.equal(foldHasValue(empty, false), false, 'gen, thu and lunar are derived: they do not open the fold');
  assert.equal(foldHasValue({ ...empty, burial: 'Bình Dương' }, false), true);
  assert.equal(foldHasValue({ ...empty, note: '  ' }, false), false, 'a blank note is blank');
  assert.equal(foldHasValue({ ...empty, gio_lunar: '15/8' }, false), true);
  assert.equal(foldHasValue({ ...empty, spouse: 'Lê Thị B' }, true), false, 'a table-backed family keeps the spouse in Quan hệ');
  assert.equal(foldHasValue({ ...empty, spouse: 'Lê Thị B' }, false), true);
  assert.equal(foldHasValue({ ...empty, other_parent: 'p1' }, false), false, 'the other parent counts only with a parent');
  assert.equal(foldHasValue({ ...empty, parent: 'p0', other_parent: 'p1' }, false), true);
});
