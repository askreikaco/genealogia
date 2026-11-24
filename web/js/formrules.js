// Person-form rules (pure, no DOM or store): smart dates, auto Đời / Thứ / âm lịch. Tested in server/test/formrules.test.js.
import { solarToLunar, yearName } from './lunar.js';

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysIn = (m, y) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const pad = (n) => String(n).padStart(2, '0');
const bad = (error) => ({ ok: false, error });

// Smart date: "1963" | "3/1963" | "5/3/1963" (also - . or space between parts).
// -> {ok, kind: 'empty'|'year'|'month'|'full', year, month, day}. Years from 1000 to the current year.
export function parseSmartDate(text, now = new Date()) {
  const t = String(text ?? '').trim();
  if (!t) return { ok: true, kind: 'empty' };
  const parts = t.split(/[\/.\-\s]+/);
  if (parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return bad('Nhập dạng 5/3/1963, 3/1963 hoặc 1963.');
  let day = null, month = null; let year;
  if (parts.length === 1) [year] = parts;
  else if (parts.length === 2) [month, year] = parts;
  else [day, month, year] = parts;
  if (year.length !== 4) return bad('Năm gồm 4 chữ số, ví dụ 1963.');
  const y = Number(year);
  if (y < 1000 || y > now.getFullYear()) return bad(`Năm phải từ 1000 đến ${now.getFullYear()}.`);
  if (month === null) return { ok: true, kind: 'year', year: String(y) };
  const m = Number(month);
  if (m < 1 || m > 12) return bad('Tháng phải từ 1 đến 12.');
  if (day === null) return { ok: true, kind: 'month', year: String(y), month: m };
  const dd = Number(day);
  if (dd < 1 || dd > daysIn(m, y)) return bad(`Tháng ${m} năm ${y} không có ngày ${dd}.`);
  return { ok: true, kind: 'full', year: String(y), month: m, day: dd };
}

// Stored form of a parsed date: born (year text) and birth/death_date (dd/mm/yyyy, only for a full date).
export const fullDate = (p) => (p && p.kind === 'full' ? `${pad(p.day)}/${pad(p.month)}/${p.year}` : '');
export const yearOf = (p) => (p && p.kind !== 'empty' ? p.year : '');

// Text to show in a smart date field for stored data: the full date when known, else the year.
export const smartText = (fullStored, yearStored) => fullStored || yearStored || '';

// Compare two parsed dates at the precision both have. <0, 0, >0; null when the year is not known for both.
export function cmpDate(a, b) {
  if (!a || !b || a.kind === 'empty' || b.kind === 'empty') return null;
  const c = Number(a.year) - Number(b.year);
  if (c || !a.month || !b.month) return c;
  if (a.month !== b.month) return a.month - b.month;
  if (!a.day || !b.day) return 0;
  return a.day - b.day;
}

// Lunar of a solar date: stored "d/m" (or "d/m nhuận") and a label "d/m Can Chi".
export function lunarOf(day, month, year) {
  const l = solarToLunar(day, month, year);
  const stored = `${l.day}/${l.month}${l.leap ? ' nhuận' : ''}`;
  return { stored, label: `${stored} ${yearName(l.year)}` };
}

// Birth year of a person record (born, or the year of birth_date).
export function yearOfData(d) {
  if (d?.born && /^\d{4}$/.test(String(d.born).trim())) return Number(d.born);
  const m = /(\d{4})$/.exec(String(d?.birth_date || '').trim());
  return m ? Number(m[1]) : null;
}

// Numbering convention of the family, from its own data: among siblings with a numeric Thứ, is the eldest
// usually 1 (default) or 2 (Nam Bộ "Hai" convention)? people: [{ id, data }] of the bloodline.
export function inferThuBase(people) {
  const groups = new Map();
  for (const p of people) {
    const par = p.data?.parent; if (!par || p.data.spouse_of) continue;
    if (!groups.has(par)) groups.set(par, []);
    groups.get(par).push(p);
  }
  let ones = 0, twos = 0;
  for (const sibs of groups.values()) {
    if (sibs.length < 2) continue;
    const [eldest] = sortSiblings(sibs);
    const n = Number(eldest.data.thu);
    if (n === 1) ones++; else if (n === 2) twos++;
  }
  return twos > ones ? 2 : 1;
}

// Siblings by birth year, earliest first; unknown years last; ties and unknowns keep the stored order.
export function sortSiblings(sibs) {
  const ord = (p) => (p.data.order ?? 1e9);
  return sibs.slice().sort((a, b) => {
    const ya = yearOfData(a.data), yb = yearOfData(b.data);
    if (ya != null && yb != null && ya !== yb) return ya - yb;
    if ((ya == null) !== (yb == null)) return ya == null ? 1 : -1;
    return ord(a) - ord(b);
  });
}

// Đời: parent's đời + 1; a root (no parent) is đời 1. Returns undefined when the parent's đời is unknown.
export function suggestGen(parentId, byId) {
  if (!parentId) return 1;
  const par = byId.get(parentId);
  if (!par) return 1; // parent id not in the data: treated like a root
  const g = Number(par.data.gen);
  return g ? g + 1 : undefined;
}

// Thứ from birth order among the children of the same parent. The new (or edited) person is placed after every
// sibling born earlier or in the same year. Returns null when there is no parent or no birth year.
export function suggestThu({ parentId, selfId = null, year, people, base = 1 }) {
  if (!parentId || year == null) return null;
  const sibs = people.filter((p) => p.data.parent === parentId && !p.data.spouse_of && p.id !== selfId);
  const before = sibs.filter((p) => { const y = yearOfData(p.data); return y != null && y <= year; }).length;
  return base + before;
}
