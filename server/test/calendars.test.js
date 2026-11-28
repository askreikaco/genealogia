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
  assert.equal(C.calendarLabel(C.inCalendar(20, 2, 1985, 'cn-lunar')), '1/1 ÂL TQ');
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

test('altCalPref: unknown, missing or no localStorage gives the default ""; known values are kept', async () => {
  const C = await web('calendars.js');
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const set = (v) => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => v } });
  try {
    assert.equal(C.ALTCAL_KEY, 'gp_altcal');
    set('cn-lunar'); assert.equal(C.altCalPref(), 'cn-lunar');
    set('none'); assert.equal(C.altCalPref(), 'none');
    set('vn-lunar'); assert.equal(C.altCalPref(), '', 'not a choice: the default');
    set('gregorian'); assert.equal(C.altCalPref(), '');
    set(null); assert.equal(C.altCalPref(), '', 'nothing stored');
    set(undefined); Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.equal(C.altCalPref(), '', 'storage refused');
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  }
});

test('toSolar: vn-lunar 1/1/1985 is 21/1/1985; 15/8/1890 converts; "m/yyyy" and "yyyy" give the year of lunar 1/1', async () => {
  const C = await web('calendars.js');
  assert.deepEqual(C.toSolar('1/1/1985', 'vn-lunar'), { kind: 'exact', from: '1985-01-21', to: null });
  assert.deepEqual(C.toSolar('15/8/1890', 'vn-lunar'), { kind: 'exact', from: '1890-09-28', to: null });
  assert.deepEqual(C.toSolar('3/1985', 'vn-lunar'), { kind: 'about', from: '1985', to: null });
  assert.deepEqual(C.toSolar('1985', 'vn-lunar'), { kind: 'about', from: '1985', to: null });
  assert.equal(C.toSolar('31/2/1985', 'vn-lunar').error !== undefined, true, 'a day that is not in the calendar is an error');
});

test('toSolar: cn-lunar 1/1/1985 is 20/2/1985; a day that is not there is an error', async () => {
  const C = await web('calendars.js');
  assert.deepEqual(C.toSolar('1/1/1985', 'cn-lunar'), { kind: 'exact', from: '1985-02-20', to: null });
  assert.ok(C.toSolar('31/1/1985', 'cn-lunar').error, 'no match: an error');
});

test('toSolar: japanese "Reiwa 8/2/17" is 17/2/2026; era year only is about that year', async () => {
  const C = await web('calendars.js');
  assert.deepEqual(C.toSolar('Reiwa 8/2/17', 'japanese'), { kind: 'exact', from: '2026-02-17', to: null });
  assert.deepEqual(C.toSolar('Reiwa 8', 'japanese'), { kind: 'about', from: '2026', to: null });
});

test('toSolar: hebrew and islamic labels for 17/2/2026 convert back to 2026-02-17', async () => {
  const C = await web('calendars.js');
  for (const cal of ['hebrew', 'islamic-umalqura', 'japanese']) {
    const label = C.calendarLabel(C.inCalendar(17, 2, 2026, cal));
    assert.deepEqual(C.toSolar(label, cal), { kind: 'exact', from: '2026-02-17', to: null }, label);
  }
});

test('toSolar: text is kept as typed (kind null); garbage is an error; Dương lịch is parseEventDate unchanged', async () => {
  const C = await web('calendars.js');
  assert.deepEqual(C.toSolar('năm Giáp Tý', 'text'), { kind: null, from: null, to: null });
  assert.ok(C.toSolar('abc', 'vn-lunar').error, 'garbage: an error');
  assert.ok(C.toSolar('abc', 'japanese').error, 'garbage: an error');
  assert.deepEqual(C.toSolar('Tự Đức thứ 10', ''), { kind: 'about', from: '1857', to: null, reign: 'Tự Đức' });
  assert.deepEqual(C.toSolar('1963', ''), { kind: 'exact', from: '1963', to: null });
});

test('textSolar: "Lịch cũ" with a 4-digit year is about that year; no year is undated; other text is an error', async () => {
  const C = await web('calendars.js');
  assert.deepEqual(C.textSolar('1890'), { kind: 'about', from: '1890', to: null });
  assert.deepEqual(C.textSolar(''), { kind: null, from: null, to: null });
  assert.deepEqual(C.textSolar(undefined), { kind: null, from: null, to: null });
  assert.ok(C.textSolar('18x0').error, 'not a year: an error');
});
