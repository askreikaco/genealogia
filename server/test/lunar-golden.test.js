// Golden dates for the Vietnamese lunar calendar (web/js/lunar.js, Hồ Ngọc Đức algorithm, UTC+7).
// Lunar 1/1 is Tết Nguyên Đán in Vietnam. Sources (opened on 2026-11-28):
//   https://vi.wikipedia.org/wiki/T%E1%BA%BFt_Nguy%C3%AAn_%C4%90%C3%A1n  (table "Mùng 1 tháng Giêng" by year; 1968 Tết Mậu Thân: North 29 Jan, South 30 Jan)
//   https://en.wikipedia.org/wiki/T%E1%BA%BFt_Nguy%C3%AAn_%C4%90%C3%A1n  (2023 22 Jan, 2024 10 Feb, 2025 29 Jan, 2026 17 Feb; notes 1985 differs from China)
// The algorithm follows the North (UTC+7) date, so 1968 is 29 Jan. Chinese dates are not asserted here: VN and CN differ on purpose.
// No database, no DOM. Loaded the same way as formrules.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const web = (f) => import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href);

// [year, day, month] of Tết (lunar 1/1) in Vietnam
const TET = [
  [1968, 29, 1],
  [1985, 21, 1],
  [2007, 17, 2],
  [2023, 22, 1],
  [2024, 10, 2],
  [2025, 29, 1],
  [2026, 17, 2],
];

for (const [y, d, m] of TET) {
  test(`Tết ${y}: lunar 1/1 is solar ${d}/${m}/${y}`, async () => {
    const L = await web('lunar.js');
    const solar = L.lunarToSolar(1, 1, y);
    assert.deepEqual([solar.getFullYear(), solar.getMonth() + 1, solar.getDate()], [y, m, d]);
    // inverse: the solar day maps back to lunar 1/1 of that year (not a leap month)
    assert.deepEqual(L.solarToLunar(d, m, y), { day: 1, month: 1, year: y, leap: false });
  });
}

test('the day before Tết 1968 is 29/12 of lunar year 1967', async () => {
  const L = await web('lunar.js');
  assert.deepEqual(L.solarToLunar(28, 1, 1968), { day: 29, month: 12, year: 1967, leap: false });
});
