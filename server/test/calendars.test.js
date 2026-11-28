// Calendar tests for web/js/calendars.js (inCalendar, calendarLabel) and the Vietnamese lunar goldens it relies on.
// Chinese lunar comes from Intl 'en-u-ca-chinese' (ICU). The en.wikipedia "Chinese New Year" page (fetched 2026-11-28)
// has no row for 1968, 1985 or 2007, so those dates are checked against Intl; Vietnamese Tết goldens stay in lunar-golden.test.js.
// Cross-checks for 17/2/2026: hebcal.com converter (https://www.hebcal.com/converter?cfg=json&gy=2026&gm=2&gd=17&g2h=1)
// gives 30 Sh'vat 5786; Aladhan API, HJCoSA method (https://api.aladhan.com/v1/gToH/17-02-2026) gives 29 Shaʿbān 1447.
// No database, no DOM. Loaded the same way as lunar-golden.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const web = (f) => import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href);
const ymd = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];

test('Vietnamese Tết goldens (lunar.js default time zone): 1985, 2007, 1968', async () => {
  const L = await web('lunar.js');
  assert.deepEqual(ymd(L.lunarToSolar(1, 1, 1985)), [1985, 1, 21]);
  assert.deepEqual(ymd(L.lunarToSolar(1, 1, 2007)), [2007, 2, 17]);
  assert.deepEqual(ymd(L.lunarToSolar(1, 1, 1968)), [1968, 1, 29]);
});

test('vn-lunar: 21/1/1985 is lunar 1/1 of 1985', async () => {
  const C = await web('calendars.js');
  assert.deepEqual(C.inCalendar(21, 1, 1985, 'vn-lunar'), { cal: 'vn-lunar', day: 1, month: 1, year: 1985, leap: false });
  assert.equal(C.calendarLabel(C.inCalendar(21, 1, 1985, 'vn-lunar')), '1/1 ÂL');
});

test('cn-lunar: Chinese New Year 1968-01-30, 1985-02-20, 2007-02-18 is lunar 1/1 (Intl)', async () => {
  const C = await web('calendars.js');
  assert.deepEqual(C.inCalendar(30, 1, 1968, 'cn-lunar'), { cal: 'cn-lunar', day: 1, month: 1, year: 1968, leap: false });
  assert.deepEqual(C.inCalendar(20, 2, 1985, 'cn-lunar'), { cal: 'cn-lunar', day: 1, month: 1, year: 1985, leap: false });
  assert.deepEqual(C.inCalendar(18, 2, 2007, 'cn-lunar'), { cal: 'cn-lunar', day: 1, month: 1, year: 2007, leap: false });
  assert.equal(C.calendarLabel(C.inCalendar(20, 2, 1985, 'cn-lunar')), '1/1 农历');
});

test('cn-lunar leap month: 22/3/2023 is 1 of the leap 2nd month (闰二月, Intl "2bis")', async () => {
  const C = await web('calendars.js');
  assert.deepEqual(C.inCalendar(22, 3, 2023, 'cn-lunar'), { cal: 'cn-lunar', day: 1, month: 2, year: 2023, leap: true });
});

test('japanese for 17/2/2026: era Reiwa, year 8', async () => {
  const C = await web('calendars.js');
  const r = C.inCalendar(17, 2, 2026, 'japanese');
  assert.deepEqual(r, { cal: 'japanese', day: 17, month: 2, year: 8, era: 'Reiwa' });
  assert.equal(C.calendarLabel(r), 'Reiwa 8/2/17');
});

test('hebrew for 17/2/2026: 30 Shevat 5786 (Intl; hebcal.com agrees)', async () => {
  const C = await web('calendars.js');
  const r = C.inCalendar(17, 2, 2026, 'hebrew');
  assert.deepEqual(r, { cal: 'hebrew', day: 30, month: 'Shevat', year: 5786 });
  assert.equal(C.calendarLabel(r), '30/Shevat/5786');
});

test('islamic-umalqura for 17/2/2026: 29 Shaʿbān 1447 AH (Intl; Aladhan agrees)', async () => {
  const C = await web('calendars.js');
  const r = C.inCalendar(17, 2, 2026, 'islamic-umalqura');
  assert.deepEqual(r, { cal: 'islamic-umalqura', day: 29, month: 8, year: 1447, era: 'AH' });
  assert.equal(C.calendarLabel(r), '29/8/1447 AH');
});

test('gregorian is the same date', async () => {
  const C = await web('calendars.js');
  assert.deepEqual(C.inCalendar(17, 2, 2026, 'gregorian'), { cal: 'gregorian', day: 17, month: 2, year: 2026 });
});

test('invalid date (31/2/2026) returns null for every calendar', async () => {
  const C = await web('calendars.js');
  for (const cal of C.CALENDARS) assert.equal(C.inCalendar(31, 2, 2026, cal), null, cal);
});

test('unknown calendar returns null; CALENDARS lists the six calendars', async () => {
  const C = await web('calendars.js');
  assert.equal(C.inCalendar(17, 2, 2026, 'mayan'), null);
  assert.deepEqual(C.CALENDARS, ['vn-lunar', 'cn-lunar', 'japanese', 'hebrew', 'islamic-umalqura', 'gregorian']);
  assert.equal(C.calendarLabel(null), '');
});
