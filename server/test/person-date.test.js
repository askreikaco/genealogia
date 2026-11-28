// Unit tests for a person's date typed in another calendar (web/js/person-date.js): the reading the person form saves from,
// the stored fields (Dương lịch keeps its shape; another calendar keeps birth_cal/birth_text; back to Dương clears them),
// and the profile's display. No database needed.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const web = (f) => import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href);
const NOW = new Date(2026, 10, 21);

test('Dương lịch: the reading is the smart date and the stored shape has no calendar keys', async () => {
  const P = await web('person-date.js'); const F = await web('formrules.js');
  const read = P.personDateRead({ text: '5/3/1963', cal: '' }, NOW);
  assert.deepEqual(read, F.parseSmartDate('5/3/1963', NOW));
  assert.deepEqual(P.personDateStored('birth', read, { text: '5/3/1963', cal: '', recordCal: '' }), { born: '1963', birth_date: '05/03/1963' });
  assert.deepEqual(P.personDateStored('death', P.personDateRead({ text: '1963' }, NOW), { on: false, text: '1963', recordCal: '' }), { died: '', death_date: '' });
});

test('vn-lunar exact: the solar date is born/birth_date, the calendar and the text as typed are kept, the lunar is the typed d/m', async () => {
  const P = await web('person-date.js');
  const read = P.personDateRead({ text: '15/8/1890', cal: 'vn-lunar' }, NOW);
  assert.equal(read.kind, 'full'); assert.equal(read.year, '1890'); assert.equal(read.month, 9); assert.equal(read.day, 28);
  assert.equal(read.lunar, '15/8');
  assert.deepEqual(P.personDateStored('birth', read, { text: '15/8/1890', cal: 'vn-lunar', recordCal: '' }),
    { born: '1890', birth_date: '28/09/1890', birth_cal: 'vn-lunar', birth_text: '15/8/1890' });
});

test('a text date with an estimated year: born is the year, no birth_date; without a year nothing is dated', async () => {
  const P = await web('person-date.js');
  const withYear = P.personDateRead({ text: 'năm Giáp Tý', cal: 'text', year: '1864' }, NOW);
  assert.deepEqual(P.personDateStored('death', withYear, { on: true, text: 'năm Giáp Tý', cal: 'text', recordCal: '' }),
    { died: '1864', death_date: '', death_cal: 'text', death_text: 'năm Giáp Tý' });
  const noYear = P.personDateRead({ text: 'năm Giáp Tý', cal: 'text', year: '' }, NOW);
  assert.equal(noYear.kind, 'empty');
  assert.deepEqual(P.personDateStored('birth', noYear, { text: 'năm Giáp Tý', cal: 'text', recordCal: '' }), { born: '', birth_date: '', birth_cal: 'text', birth_text: 'năm Giáp Tý' });
});

test('back to Dương lịch clears the calendar keys of a record that had them', async () => {
  const P = await web('person-date.js');
  const read = P.personDateRead({ text: '5/3/1963', cal: '' }, NOW);
  assert.deepEqual(P.personDateStored('birth', read, { text: '5/3/1963', cal: '', recordCal: 'vn-lunar' }),
    { born: '1963', birth_date: '05/03/1963', birth_cal: '', birth_text: '' });
});

test('an unreadable date is an error and stores the empty date', async () => {
  const P = await web('person-date.js');
  const read = P.personDateRead({ text: 'abc', cal: 'vn-lunar' }, NOW);
  assert.equal(read.ok, false); assert.ok(read.error);
  assert.deepEqual(P.personDateStored('birth', read, { text: 'abc', cal: 'vn-lunar', recordCal: '' }), { born: '', birth_date: '', birth_cal: 'vn-lunar', birth_text: 'abc' });
});

test('the profile shows the date as typed, then the solar date in brackets (the event display)', async () => {
  const P = await web('person-date.js');
  assert.equal(P.personDateText({ birth_cal: 'vn-lunar', birth_text: '15/8/1890', birth_date: '28/09/1890', born: '1890' }, 'birth'), '15/8/1890 ÂL (≈ 28/9/1890)');
  assert.equal(P.personDateText({ death_cal: 'text', death_text: 'năm Giáp Tý', died: '1864' }, 'death'), 'năm Giáp Tý (≈ 1864)');
  assert.equal(P.personDateText({ death_cal: 'text', death_text: 'năm Giáp Tý' }, 'death'), 'năm Giáp Tý');
  assert.equal(P.personDateText({ born: '1963', birth_date: '05/03/1963' }, 'birth'), '', 'Dương lịch: the caller shows the stored date');
});
