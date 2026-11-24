// "+" prefill: the values a new record starts with, worked out from where the "+" was tapped (owner rule 2026-11-23).
// Everything here is a default the person can change; nothing is saved before Lưu / Gửi góp ý.
// Pure, no imports: server/test/prefill.test.js loads this file in a vm.

const fold = (x) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd').trim();
const firstWord = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const DAY_MONTH = /^(\d{1,2})\s*\/\s*(\d{1,2})$/;
const YEAR = /(?:^|\D)(1[0-9]{3}|20[0-9]{2})(?:\D|$)/;

// True when some name contains the search text (accents ignored): a search that found someone is not a new name.
export const nameHit = (names, q) => { const f = fold(q); return !!f && names.some((n) => fold(n).includes(f)); };

// The next birth order after the ones given (whole numbers; 10 after 1..9; 1 when there is none).
export function nextOrder(orders = []) {
  const n = orders.map(Number).filter((x) => Number.isFinite(x) && x > 0);
  return n.length ? Math.floor(Math.max(...n)) + 1 : 1;
}

// A search the person typed becomes the new name only when it found no one and is not a date (3/8) or a year.
const newName = (q, matched) => { const t = String(q || '').trim(); return t && !matched && !DAY_MONTH.test(t) && !/^\d+$/.test(t) ? t : ''; };

// Quan hệ "+" (and the add sheet's "Tạo người mới"). type: parent | spouse | child | sibling.
// a.anchor: the person the relation starts from { name, sex, gen }; a.line: the blood relative whose family name the
// line follows (the anchor, or the person they married into); a.q / a.qMatched: the search box and whether it found someone.
export function relPrefill(type, a = {}) {
  const anchor = a.anchor || {}; const g = Number(anchor.gen) || 0; const o = {};
  const name = newName(a.q, a.qMatched);
  if (type === 'child') { if (g) o.gen = g + 1; }
  else if (type === 'sibling') { if (g) o.gen = g; }
  else if (type === 'parent') { if (g > 1) o.gen = g - 1; }
  else if (type === 'spouse') { if (anchor.sex === 'm') o.sex = 'f'; else if (anchor.sex === 'f') o.sex = 'm'; }
  if (name) o.name = name;
  else if (type !== 'spouse') { const s = firstWord((a.line || anchor).name); if (s) o.name = s + ' '; } // family name of the line, given name to type
  return o;
}

// List "+" (Tìm, Bản đồ): the active filters. f: { gen, living: true | 'living' | 'dead', place, q, qMatched }.
// No parent: parents are relation rows (Quan hệ); the server refuses a person record that sets one.
export function listPrefill(f = {}) {
  const o = {};
  const g = Number(f.gen) || 0; if (g) o.gen = g;
  if (f.living) o.living = f.living === 'dead' ? 'dead' : 'living';
  if (f.place) o.place = String(f.place);
  const name = newName(f.q, f.qMatched); if (name) o.name = name;
  return o;
}

// Giỗ "+": a person who has died; a day/month typed in the search is the giỗ date, a name that found no one is the name.
export function gioPrefill(f = {}) {
  const o = { living: 'dead' }; const t = String(f.q || '').trim();
  const m = DAY_MONTH.exec(t);
  if (m) o.gio_lunar = `${+m[1]}/${+m[2]}`;
  else { const name = newName(t, f.qMatched); if (name) o.name = name; }
  return o;
}

// Dòng đời "+": the event type when the filter shows exactly one type, a year typed in the search.
export function eventPrefill(f = {}) {
  const o = {};
  if (Array.isArray(f.types) && f.types.length === 1) o.type = f.types[0];
  const y = YEAR.exec(String(f.q || '')); if (y) o.date_text = y[1];
  return o;
}
