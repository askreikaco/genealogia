// The date field (Thời gian) of the forms: the date text, the calendar it was typed in (Loại lịch) and the hint of its
// solar date. One component for every form that takes a date: dateFieldHtml draws it, wireDateField keeps the hint
// current, readDateField reads it. The rules are in calendars.js (toSolar, textSolar, altCalPref) and events.js.
// Dương lịch (the default) keeps the Lịch phụ hint of the device setting; another calendar shows its solar date; "text"
// (Lịch cũ) is kept as typed, with an optional estimated solar year.
import { esc } from './model.js';
import { CAL_VI } from './calendars-vi.js';
import { FORMS_VI } from './forms-vi.js';
import { parseEventDate, parseIso, eventAutoLunar } from './events.js';
import { toSolar, textSolar, altCalPref, inCalendar, calendarLabel } from './calendars.js';

export const DATE_CAL_OPTS = [['', CAL_VI.opt_duong], ['vn-lunar', CAL_VI.opt_vn], ['cn-lunar', CAL_VI.opt_cn], ['japanese', CAL_VI.opt_jp],
  ['hebrew', CAL_VI.opt_he], ['islamic-umalqura', CAL_VI.opt_is], ['text', CAL_VI.opt_text]];

// The hint under the field: the solar date of a converted Thời gian ("≈ 21/1/1985 dương lịch"), the error when it cannot
// be converted, or for Dương lịch the Lịch phụ hint. Display only: nothing is stored from it.
export function dateHint(text, cal) {
  if (cal === 'text') return CAL_VI.hint_text;
  if (cal) {
    const r = toSolar(text, cal);
    if (r.error) return r.error;
    if (!r.from) return '';
    const shown = r.kind === 'exact' ? (([y, m, d]) => `${+d}/${+m}/${y}`)(r.from.split('-')) : r.from;
    return CAL_VI.hint_solar.replace('{v}', shown);
  }
  const pref = altCalPref();
  if (pref === 'none') return '';
  if (!pref) { const a = eventAutoLunar(text); return a ? FORMS_VI.lunar_hint.replace('{v}', a) : ''; }
  const p = parseEventDate(text);
  if (p.kind !== 'exact' || !p.from) return '';
  const iso = parseIso(p.from);
  const r = iso && iso.d !== null && iso.m !== null ? inCalendar(iso.d, iso.m, iso.y, pref) : null;
  return r ? `≈ ${calendarLabel(r)}` : '';
}

// The field: label (Thời gian), optional help HTML (already escaped by the caller), the calendar select and the text.
// For "text" an optional estimated year: a link button that shows one 4-digit input (open when year is given).
export function dateFieldHtml({ id, label, text = '', cal = '', help = '', year = '' }) {
  const c = cal || ''; const h = dateHint(text, c);
  return `<div class="fld evx-dt"><span class="evx-dt-h"><label for="${esc(id)}">${esc(label)}</label>${help}</span>
    <div class="evx-dt-row"><select data-f="date_cal" aria-label="${esc(CAL_VI.type_label)}">${DATE_CAL_OPTS.map(([k, t]) => `<option value="${k}" ${k === c ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><input id="${esc(id)}" data-f="date_text" value="${esc(text)}" autocomplete="off" placeholder="vd 1981, 3/1981, 1980–1981"></div>
    <p class="sub evx-lunar" data-lunar-hint${h ? '' : ' hidden'}>${esc(h)}</p>
    <div data-df-year${c === 'text' ? '' : ' hidden'}><button type="button" class="btn ter sm" data-df-year-btn${year ? ' hidden' : ''}>${esc(CAL_VI.year_add)}</button>
      <label class="fld" data-df-year-lbl${year ? '' : ' hidden'}>${esc(CAL_VI.year_label)}<input data-f="date_year" inputmode="numeric" maxlength="4" value="${esc(year)}" autocomplete="off"></label></div></div>`;
}

// Keeps the hint and the year input current while the date or the calendar changes.
export function wireDateField(root) {
  const dt = root.querySelector('[data-f="date_text"]'); const hint = root.querySelector('[data-lunar-hint]'); const cal = root.querySelector('[data-f="date_cal"]');
  const yr = root.querySelector('[data-df-year]'); const yBtn = root.querySelector('[data-df-year-btn]'); const yLbl = root.querySelector('[data-df-year-lbl]');
  if (!dt || !hint) return;
  const paint = () => {
    const c = cal ? cal.value : '';
    const t = dateHint(dt.value, c); hint.hidden = !t; hint.textContent = t;
    if (yr) yr.hidden = c !== 'text';
  };
  dt.addEventListener('input', paint);
  cal?.addEventListener('change', paint);
  yBtn?.addEventListener('click', () => { yBtn.hidden = true; if (yLbl) { yLbl.hidden = false; yLbl.querySelector('input')?.focus(); } });
}

// Reads the field: { date_text, date_cal, date_kind, date_from, date_to } (date_cal null for Dương lịch), or { error }.
// "text" keeps the date as typed; its estimated year (if any) becomes an 'about' date.
export function readDateField(root) {
  const text = (root.querySelector('[data-f="date_text"]')?.value ?? '').trim();
  const cal = (root.querySelector('[data-f="date_cal"]')?.value ?? '').trim();
  if (cal === 'text') {
    const y = textSolar(root.querySelector('[data-f="date_year"]')?.value);
    if (y.error) return { error: y.error, field: 'date_year' };
    return { date_text: text, date_cal: 'text', date_kind: y.kind || null, date_from: y.from || null, date_to: null };
  }
  const r = toSolar(text, cal);
  if (r.error) return { error: r.error };
  return { date_text: text, date_cal: cal || null, date_kind: r.kind || null, date_from: r.from || null, date_to: r.to || null };
}
