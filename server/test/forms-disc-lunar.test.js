// Unit tests for the minimal-forms rules: the "Thêm chi tiết" summary (web/js/disc-rules.js) and the event auto lunar
// (web/js/events.js: eventAutoLunar, the hint only). No database and no DOM. The save path is covered by the e2e test.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const web = (f) => import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href);

test('disc summary: only the parts that hold a value, joined with " · "', async () => {
  const D = await web('disc-rules.js');
  assert.equal(D.discSummary(['Âm lịch 15/8', '', '2 ảnh', '1 nguồn']), 'Âm lịch 15/8 · 2 ảnh · 1 nguồn');
  assert.equal(D.discSummary(['', '  ', undefined, null]), '');
  assert.equal(D.discSummary([]), '');
  assert.equal(D.discSummary(['2 ảnh']), '2 ảnh');
});

test('disc parts: a labelled value, a bare value, an empty value, a count', async () => {
  const D = await web('disc-rules.js');
  assert.equal(D.discPart('Âm lịch', ' 15/8 '), 'Âm lịch 15/8');
  assert.equal(D.discPart('Âm lịch', ''), '');
  assert.equal(D.discPart('', 'Huế'), 'Huế');
  assert.equal(D.discPart('Tên mới', null), '');
  assert.equal(D.discCount(2, 'ảnh'), '2 ảnh');
  assert.equal(D.discCount(0, 'ảnh'), '');
});

test('disc open: a fold opens when any hidden field holds a value (text or rows)', async () => {
  const D = await web('disc-rules.js');
  assert.equal(D.discHasValue(['', '  ', [], []]), false, 'nothing inside: closed');
  assert.equal(D.discHasValue(['', '', [], [{ id: 'S1' }]]), true, 'a source row: open');
  assert.equal(D.discHasValue(['1/1', '', [], []]), true, 'a lunar value: open');
  assert.equal(D.discHasValue([undefined, null, ['P1']]), true, 'a person: open');
});

test('event auto lunar: only an exact day (Y-M-D) gives a lunar value', async () => {
  const E = await web('events.js');
  // Tết 1963 is 25/1/1963 = 1/1 (the same anchor as server/test/formrules.test.js)
  assert.equal(E.eventAutoLunar('25/1/1963'), '1/1');
  assert.equal(E.eventAutoLunar('22/3/2023'), '1/2 nhuận', 'leap month is written as the person form writes it');
  assert.equal(E.eventAutoLunar('15/8/1980'), '5/7');
  for (const partial of ['1963', '3/1963', 'khoảng 1963', 'trước 1963', 'sau 1990', '1960–1963', '1960–3/1963', '']) {
    assert.equal(E.eventAutoLunar(partial), '', `no lunar for "${partial}"`);
  }
  assert.equal(E.eventAutoLunar('not a date'), '');
});

test('event lunar is a hint only: the date gives a display value and nothing is stored from it', async () => {
  const E = await web('events.js');
  assert.equal(E.lunarToStore, undefined, 'no export turns a date into a stored lunar (the Âm lịch field keeps what the user typed)');
  assert.equal(E.eventAutoLunar('25/1/1963'), '1/1', 'the hint for an exact day');
  assert.equal(E.eventAutoLunar('1963'), '', 'no hint for a partial date (lunar-only entry is typed)');
});
