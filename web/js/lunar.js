// Vietnamese lunar -> solar date (Hồ Ngọc Đức's algorithm, timezone +7).
const PI = Math.PI, TZ = 7;
const INT = Math.floor;
function jdFromDate(d, m, y) { const a = INT((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  let jd = d + INT((153 * mm + 2) / 5) + 365 * yy + INT(yy / 4) - INT(yy / 100) + INT(yy / 400) - 32045;
  if (jd < 2299161) jd = d + INT((153 * mm + 2) / 5) + 365 * yy + INT(yy / 4) - 32083; return jd; }
function jdToDate(jd) { let a, b, c; if (jd > 2299160) { a = jd + 32044; b = INT((4 * a + 3) / 146097); c = a - INT(b * 146097 / 4); } else { b = 0; c = jd + 32082; }
  const d = INT((4 * c + 3) / 1461), e = c - INT(1461 * d / 4), m = INT((5 * e + 2) / 153);
  return [e - INT((153 * m + 2) / 5) + 1, m + 3 - 12 * INT(m / 10), b * 100 + d - 4800 + INT(m / 10)]; }
function newMoon(k) { const T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3, Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3, F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M) - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr) - 0.0004 * Math.sin(dr * 3 * Mpr) + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr)) - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M)) - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr)) + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const dt = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return Jd1 + C1 - dt; }
const getNewMoonDay = (k) => INT(newMoon(k) + 0.5 + TZ / 24);
function sunLong(jdn) { const T = (jdn - 2451545.5 - TZ / 24) / 36525, T2 = T * T, dr = PI / 180, M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2, L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M) + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr; L = L - PI * 2 * INT(L / (PI * 2)); return INT(L / PI * 6); }
function lunarMonth11(y) { const off = jdFromDate(31, 12, y) - 2415021, k = INT(off / 29.530588853); let nm = getNewMoonDay(k); if (sunLong(nm) >= 9) nm = getNewMoonDay(k - 1); return nm; }
function leapOffset(a11) { const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5); let last, i = 1, arc = sunLong(getNewMoonDay(k + i));
  do { last = arc; i++; arc = sunLong(getNewMoonDay(k + i)); } while (arc !== last && i < 14); return i - 1; }
export function lunarToSolar(ld, lm, ly, leap = 0) {
  let a11, b11; if (lm < 11) { a11 = lunarMonth11(ly - 1); b11 = lunarMonth11(ly); } else { a11 = lunarMonth11(ly); b11 = lunarMonth11(ly + 1); }
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853); let off = lm - 11; if (off < 0) off += 12;
  if (b11 - a11 > 365) { const lo = leapOffset(a11); let lmo = lo - 2; if (lmo < 0) lmo += 12; if (leap && lm !== lmo) return null; if (leap || off >= lo) off += 1; }
  const [d, m, y] = jdToDate(getNewMoonDay(k + off) + ld - 1); return new Date(y, m - 1, d);
}
// Next solar date (today or later) for a lunar day/month anniversary.
export function nextAnniversary(ld, lm, from = new Date()) {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (const ly of [from.getFullYear() - 1, from.getFullYear(), from.getFullYear() + 1]) {
    let d = lunarToSolar(ld, lm, ly); if (!d) continue;
    if (d < today && ld === 30) continue;
    if (d >= today) return d;
  }
  return null;
}
// Solar -> lunar: {day, month, year, leap}. Inverse of lunarToSolar (same helpers, same +7 time zone).
export function solarToLunar(dd, mm, yy) {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1);
  if (monthStart > dayNumber) monthStart = getNewMoonDay(k);
  let a11 = lunarMonth11(yy), b11 = a11, ly;
  if (a11 >= monthStart) { ly = yy; a11 = lunarMonth11(yy - 1); } else { ly = yy + 1; b11 = lunarMonth11(yy + 1); }
  const day = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let leap = 0, month = diff + 11;
  if (b11 - a11 > 365) { const lo = leapOffset(a11); if (diff >= lo) { month = diff + 10; if (diff === lo) leap = 1; } }
  if (month > 12) month -= 12;
  if (month >= 11 && diff < 4) ly -= 1;
  return { day, month, year: ly, leap: !!leap };
}
// Year name of the 60-year cycle, e.g. 1963 -> "Quý Mão".
const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
export const yearName = (y) => CAN[(((y + 6) % 10) + 10) % 10] + ' ' + CHI[(((y + 8) % 12) + 12) % 12];
