// Unit tests for the calendar Thời gian was typed in (events.date_cal): the cleaner keeps the six values and stores
// anything else (Dương lịch '', 'gregorian', unknown, not text) as null; the row mapper gives '' for null. No DB.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../events');

const base = { type: 'sinh', date_kind: 'exact', date_from: '1985-01-21', lunar: '', place: '', description: '', people: [], sources: [] };

test('cleanEvent keeps vn-lunar, cn-lunar, japanese, hebrew, islamic-umalqura and text', () => {
  for (const cal of ['vn-lunar', 'cn-lunar', 'japanese', 'hebrew', 'islamic-umalqura', 'text']) assert.equal(E.cleanEvent({ ...base, date_cal: cal }).date_cal, cal, cal);
});

test('cleanEvent stores anything else as null: Dương lịch (empty), gregorian, unknown, not text', () => {
  for (const cal of ['x', '', null, undefined, 7, 'CN-LUNAR', 'gregorian']) assert.equal(E.cleanEvent({ ...base, date_cal: cal }).date_cal, null, String(cal));
});

test('eventOut gives date_cal as "" for null (Dương lịch) and the value otherwise', () => {
  const row = { id: 'E1', person_id: 'P1', type: 'sinh', date_cal: null, created_at: new Date(0), updated_at: new Date(0) };
  assert.equal(E.eventOut(row).date_cal, '');
  assert.equal(E.eventOut({ ...row, date_cal: 'vn-lunar' }).date_cal, 'vn-lunar');
});

// The display (web/js/events.js formatEventDate): a converted Thời gian shows the text as typed and the solar date.
const web = (f) => import(require('url').pathToFileURL(require('path').join(__dirname, '..', '..', 'web', 'js', f)).href);
test('formatEventDate: typed text, then the solar date in brackets; Lịch cũ shows the text (and its year)', async () => {
  const W = await web('events.js');
  const ev = { date_text: '15/8/1890', date_cal: 'vn-lunar', date_kind: 'exact', date_from: '1890-09-28' };
  assert.equal(W.formatEventDate(ev), '15/8/1890 ÂL (≈ 28/9/1890)');
  assert.equal(W.formatEventDate({ ...ev, date_cal: 'cn-lunar', date_text: '1/1/1985', date_from: '1985-02-20' }), '1/1/1985 ÂL TQ (≈ 20/2/1985)');
  assert.equal(W.formatEventDate({ date_text: 'năm Giáp Tý', date_cal: 'text', date_kind: null, date_from: null }), 'năm Giáp Tý');
  assert.equal(W.formatEventDate({ date_text: 'năm Giáp Tý', date_cal: 'text', date_kind: 'about', date_from: '1864' }), 'năm Giáp Tý (≈ 1864)');
  assert.equal(W.formatEventDate({ date_text: '1963', date_cal: null, date_kind: 'exact', date_from: '1963' }), '1963', 'Dương lịch is unchanged');
});
