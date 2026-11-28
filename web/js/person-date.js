// A person's Ngày sinh / Ngày mất typed in another calendar (birth_cal, birth_text, death_cal, death_text). personDateRead is
// the reading the person form saves from; personDateText is the profile's display, through the event display (formatEventDate).
// Dương lịch (no calendar) is the form's own smart date (parseSmartDate) and is not changed here. Pure: no DOM (tested in node).
import { parseSmartDate, yearOf, fullDate } from './formrules.js';
import { readCalDate } from './calendars.js';
import { formatEventDate } from './events.js';

// { text, cal, year } of a date field -> a parseSmartDate result: { ok, kind: 'empty'|'year'|'full', year, month, day }, plus
// cal, and lunar (vn-lunar with an exact day: the lunar d/m as typed, "15/8" or "2/8 nhuận"; null otherwise).
// An error is { ok: false, error }. For another calendar, the solar date is the converted one (readCalDate).
export function personDateRead({ text = '', cal = '', year = '' } = {}, now = new Date()) {
  const c = String(cal ?? '').trim(); const t = String(text ?? '').trim();
  if (!c) return parseSmartDate(t, now);
  const r = readCalDate({ text: t, cal: c, year });
  if (r.error) return { ok: false, error: r.error, cal: c, lunar: null };
  if (r.date_kind === 'exact' && r.date_from) {
    const [y, m, d] = r.date_from.split('-');
    const lx = c === 'vn-lunar' ? /^(\d{1,2})\/(\d{1,2})\/\d{4}(\s+nhuận)?$/i.exec(t) : null;
    return { ok: true, kind: 'full', year: String(+y), month: +m, day: +d, cal: c, lunar: lx ? `${+lx[1]}/${+lx[2]}${lx[3] ? ' nhuận' : ''}` : null };
  }
  if (r.date_kind === 'about' && r.date_from) return { ok: true, kind: 'year', year: String(r.date_from), cal: c, lunar: null };
  return { ok: true, kind: 'empty', cal: c, lunar: null };
}

// The profile's line for a person's date in another calendar: the text as typed, then the solar date when known, e.g.
// "15/8/1890 ÂL (≈ 28/9/1890)". '' for Dương lịch (the caller shows the stored date). p: 'birth' or 'death'.
export function personDateText(d, p) {
  const cal = d[`${p}_cal`]; if (!cal) return '';
  const ev = { date_cal: cal, date_text: d[`${p}_text`] || '', date_kind: null, date_from: null };
  const full = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d[`${p}_date`] || '').trim());
  const yr = String(d[p === 'birth' ? 'born' : 'died'] ?? '').trim();
  if (full) { ev.date_kind = 'exact'; ev.date_from = `${full[3]}-${full[2].padStart(2, '0')}-${full[1].padStart(2, '0')}`; }
  else if (/^\d{4}$/.test(yr)) { ev.date_kind = 'about'; ev.date_from = yr; }
  return formatEventDate(ev);
}

// The stored fields of one date: born and birth_date (died, death_date for p 'death') as Dương lịch always stored them, and
// the calendar and its text (birth_cal, birth_text) only for a date in another calendar. read: personDateRead's result
// (an error or on: false stores the empty date). recordCal: the calendar the record had; a date back in Dương lịch clears it.
export function personDateStored(p, read, { on = true, text = '', cal = '', recordCal = '' } = {}) {
  const r = on && read && read.ok ? read : { kind: 'empty' };
  const yr = p === 'birth' ? 'born' : 'died'; const sol = p === 'birth' ? 'birth_date' : 'death_date';
  const out = { [yr]: yearOf(r), [sol]: fullDate(r) };
  const c = on ? String(cal || '').trim() : '';
  if (c || recordCal) { out[`${p}_cal`] = c; out[`${p}_text`] = c ? String(text || '').trim() : ''; }
  return out;
}
