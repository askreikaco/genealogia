// Calendar conversions for one solar date. Vietnamese lunar uses lunar.js (its own algorithm, UTC+7). Chinese lunar,
// Japanese era, Hebrew and Islamic Umm al-Qura use Intl (UTC). Pure: no DOM, no network.
import { solarToLunar, lunarToSolar } from './lunar.js';
import { CAL_VI } from './calendars-vi.js';
import { parseEventDate } from './events.js';

export const CALENDARS = ['vn-lunar', 'cn-lunar', 'japanese', 'hebrew', 'islamic-umalqura', 'gregorian'];

// Lịch phụ (device setting, like Cách gọi and Cỡ chữ): the calendar an exact date's hint shows under the solar date.
// '' = Âm lịch Việt Nam (the default), 'none' = no hint, else one of the other calendars. Stored in localStorage.
export const ALTCAL_KEY = 'gp_altcal';
const ALTCAL_VALUES = ['', 'cn-lunar', 'japanese', 'hebrew', 'islamic-umalqura', 'none'];
export function altCalPref() {
  try { const v = localStorage.getItem(ALTCAL_KEY) || ''; return ALTCAL_VALUES.includes(v) ? v : ''; } catch { return ''; }
}

const INTL_CAL = { 'cn-lunar': 'chinese', japanese: 'japanese', hebrew: 'hebrew', 'islamic-umalqura': 'islamic-umalqura' };
const formatters = new Map();
function formatter(cal) {
  if (!formatters.has(cal)) {
    formatters.set(cal, new Intl.DateTimeFormat('en-u-ca-' + INTL_CAL[cal], {
      timeZone: 'UTC',
      ...(cal === 'japanese' || cal === 'islamic-umalqura' ? { era: 'short' } : {}),
      year: 'numeric', month: 'numeric', day: 'numeric',
    }));
  }
  return formatters.get(cal);
}

// True when d/m/y is a real Gregorian date (31/2/2026 is not).
function validDate(d, m, y) {
  if (![d, m, y].every(Number.isInteger) || m < 1 || m > 12 || d < 1) return false;
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// The date in one calendar.
//   vn-lunar, cn-lunar: {cal, day, month, year, leap}  (leap is true for a leap month, e.g. Intl "2bis")
//   japanese, hebrew, islamic-umalqura: {cal, day, month, year, era?}  (month is a name for Hebrew)
//   gregorian: {cal, day, month, year}
// Returns null for an invalid date or an unknown calendar.
export function inCalendar(d, m, y, cal) {
  if (!CALENDARS.includes(cal) || !validDate(d, m, y)) return null;
  if (cal === 'vn-lunar') {
    const r = solarToLunar(d, m, y);
    return { cal, day: r.day, month: r.month, year: r.year, leap: r.leap };
  }
  if (cal === 'gregorian') return { cal, day: d, month: m, year: y };
  const parts = formatter(cal).formatToParts(new Date(Date.UTC(y, m - 1, d)));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  if (cal === 'cn-lunar') {
    const month = get('month'); // "1".."12", or "4bis" for a leap month
    return {
      cal, day: Number(get('day')), month: Number(month.replace(/\D/g, '')),
      year: Number(get('relatedYear') ?? get('year')), leap: /bis/.test(month),
    };
  }
  const num = (v) => (/^\d+$/.test(v ?? '') ? Number(v) : v);
  const out = { cal, day: num(get('day')), month: num(get('month')), year: num(get('year')) };
  const era = get('era');
  if (era) out.era = era;
  return out;
}

// Short display text for a result of inCalendar.
export function calendarLabel(r) {
  if (!r) return '';
  switch (r.cal) {
    case 'vn-lunar': return `${r.day}/${r.month} ÂL`;
    case 'cn-lunar': return `${r.day}/${r.month} ${CAL_VI.cn_short}`;
    case 'japanese': return `${r.era} ${r.year}/${r.month}/${r.day}`;
    case 'hebrew': return `${r.day}/${r.month}/${r.year}`;
    case 'islamic-umalqura': return `${r.day}/${r.month}/${r.year} AH`;
    case 'gregorian': return `${r.day}/${r.month}/${r.year}`;
    default: return '';
  }
}

// ---- Thời gian typed in another calendar -> the solar date (toSolar) ----
// Returns { kind, from, to } like parseEventDate (exact: from = Y-M-D; about: from = year), { kind: null } for 'text'
// (kept as typed, never converted), or { error }. '' (Dương lịch) is parseEventDate unchanged (reign years included).
const ERA_START = { Meiji: 1868, Taisho: 1912, Showa: 1926, Heisei: 1989, Reiwa: 2019 };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// The solar year that a year of this calendar falls in (for a year only, and to centre the day search).
function solarYearOf(cal, y, era) {
  if (cal === 'cn-lunar') return y;
  if (cal === 'hebrew') return y - 3760;
  if (cal === 'islamic-umalqura') return Math.round(622 + y * 0.970229);
  if (cal === 'japanese') return ERA_START[era] + y - 1;
  return null;
}
// The solar day (UTC scan) of the year before to the year after the guess, where inCalendar matches. null when none.
function findSolar(cal, guess, match) {
  for (let y = guess - 1; y <= guess + 1; y++) {
    for (let t = Date.UTC(y, 0, 1); t <= Date.UTC(y, 11, 31); t += 864e5) {
      const d = new Date(t);
      const r = inCalendar(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear(), cal);
      if (r && match(r)) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
  }
  return null;
}
const NOT_FOUND = CAL_VI.err_not_found;
const BAD = CAL_VI.err_bad;
export function toSolar(text, cal) {
  const raw = String(text || '').trim();
  if (!cal) return parseEventDate(raw);
  if (!raw) return { kind: null, from: null, to: null };
  if (cal === 'text') return { kind: null, from: null, to: null };
  const leap = /\s+nhuận$/i.test(raw); const body = raw.replace(/\s+nhuận$/i, '').replace(/\s+AH$/i, '').trim();
  if (cal === 'vn-lunar') {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(body);
    if (m) {
      const d = lunarToSolar(+m[1], +m[2], +m[3], leap ? 1 : 0);
      if (!d) return { error: BAD };
      const back = solarToLunar(d.getDate(), d.getMonth() + 1, d.getFullYear()); // a day the lunar month does not have comes back changed
      if (back.day !== +m[1] || back.month !== +m[2] || !!back.leap !== leap) return { error: BAD };
      return { kind: 'exact', from: iso(d), to: null };
    }
    const y = /^(?:\d{1,2}\/)?(\d{4})$/.exec(body); // "m/yyyy" or "yyyy": the solar year of lunar 1/1 of that year
    if (y) { const d = lunarToSolar(1, 1, +y[1]); return d ? { kind: 'about', from: String(d.getFullYear()), to: null } : { error: BAD }; }
    return { error: BAD };
  }
  if (cal === 'japanese') {
    const m = /^(Meiji|Taisho|Showa|Heisei|Reiwa)\s+(\d{1,3})\/(\d{1,2})\/(\d{1,2})$/i.exec(body); // as calendarLabel: era year/month/day
    const ey = /^(Meiji|Taisho|Showa|Heisei|Reiwa)\s+(\d{1,3})$/i.exec(body);
    const era = (m || ey) && ((m || ey)[1][0].toUpperCase() + (m || ey)[1].slice(1).toLowerCase());
    if (ey) return { kind: 'about', from: String(ERA_START[era] + +ey[2] - 1), to: null };
    if (!m) return { error: BAD };
    const [, , y, mo, d] = m;
    const found = findSolar(cal, solarYearOf(cal, +y, era), (r) => r.era === era && r.year === +y && r.month === +mo && r.day === +d);
    return found ? { kind: 'exact', from: found, to: null } : { error: NOT_FOUND };
  }
  if (cal === 'hebrew') {
    const m = /^(\d{1,2})\/([^/\d]+)\/(\d{4})$/.exec(body);
    const yo = /^(\d{4})$/.exec(body);
    if (yo) return { kind: 'about', from: String(solarYearOf(cal, +yo[1])), to: null };
    if (!m) return { error: BAD };
    const name = m[2].trim().toLowerCase();
    const found = findSolar(cal, solarYearOf(cal, +m[3]), (r) => r.day === +m[1] && r.year === +m[3] && String(r.month).toLowerCase() === name);
    return found ? { kind: 'exact', from: found, to: null } : { error: NOT_FOUND };
  }
  // cn-lunar and islamic-umalqura: d/m/y (a year only gives the solar year)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/.exec(body);
  const yo = /^(\d{1,4})$/.exec(body);
  if (yo) return { kind: 'about', from: String(solarYearOf(cal, +yo[1])), to: null };
  if (!m) return { error: BAD };
  const found = findSolar(cal, solarYearOf(cal, +m[3]), (r) => r.day === +m[1] && r.month === +m[2] && r.year === +m[3] && !!r.leap === leap);
  return found ? { kind: 'exact', from: found, to: null } : { error: NOT_FOUND };
}

// "Lịch cũ / ghi nguyên văn": the optional solar year typed with the text. A 4-digit year gives 'about' that year; empty
// gives no date (kind null, undated); anything else is an error.
export function textSolar(yearText) {
  const y = String(yearText || '').trim();
  if (!y) return { kind: null, from: null, to: null };
  return /^\d{4}$/.test(y) ? { kind: 'about', from: y, to: null } : { error: CAL_VI.err_year };
}
