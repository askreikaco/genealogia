// Calendar conversions for one solar date. Vietnamese lunar uses lunar.js (its own algorithm, UTC+7). Chinese lunar,
// Japanese era, Hebrew and Islamic Umm al-Qura use Intl (UTC). Pure: no DOM, no network.
import { solarToLunar } from './lunar.js';

export const CALENDARS = ['vn-lunar', 'cn-lunar', 'japanese', 'hebrew', 'islamic-umalqura', 'gregorian'];

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
    case 'cn-lunar': return `${r.day}/${r.month} 农历`;
    case 'japanese': return `${r.era} ${r.year}/${r.month}/${r.day}`;
    case 'hebrew': return `${r.day}/${r.month}/${r.year}`;
    case 'islamic-umalqura': return `${r.day}/${r.month}/${r.year} AH`;
    case 'gregorian': return `${r.day}/${r.month}/${r.year}`;
    default: return '';
  }
}
