// The person form's rows, pure (no DOM): the Họ khác rows (surname marks) and the rule that opens "Thêm chi tiết".
// app.js draws the rows and reads them; these functions decide what the form keeps and what it saves. Rules: surname-rules.js.
import { timelineOf } from './surname-rules.js';

const text = (x) => String(x ?? '').trim();

// The rows as the page holds them (type, surname, year) merged over the marks loaded at the same position: every other
// field of a loaded mark (confidence, source, Hán, reason, to) is kept as it was. A blank year removes the year.
export function marksOfRows(base, rows) {
  return rows.map((r, i) => {
    const o = { ...(base[i] || {}) };
    o.type = r.type; o.surname = r.surname;
    if (text(r.from)) o.from = text(r.from); else delete o.from;
    return o;
  });
}

// The marks to save: a blank row (no surname and no year) is left out; surname and year are trimmed.
export function namesClean(list) {
  return list.filter((e) => text(e.surname) || text(e.from))
    .map((e) => { const o = { ...e, surname: text(e.surname) }; if (text(e.from)) o.from = text(e.from); else delete o.from; return o; });
}

// The same marks as the record holds them (timeline order), for "is anything changed".
export const namesOfRecord = (rec) => timelineOf(rec);

// "Thêm chi tiết" opens by itself when a field in it holds a value. A spouse or the other parent counts only where the
// family keeps them on the person (not table-backed), and the other parent only with a parent.
export function foldHasValue(v, table) {
  const has = (x) => (Array.isArray(x) ? x.length > 0 : text(x) !== '');
  return [v.name_han, table ? '' : v.spouse, v.married, !table && v.parent ? v.other_parent : '', v.gio_lunar, v.burial,
    v.birth_place, v.place, v.job, v.religion, v.photo, v.note, v.verify, v.source].some(has);
}
