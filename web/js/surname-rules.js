// Surname over time, browser copy of server/surname-rules.js (the same rules; server/test/surname-rules.test.js checks
// both agree). Pure functions, no DOM. The form uses namesError before saving; the server checks again.
export const NAME_TYPES = ['birth', 'changed', 'aka', 'religious', 'abroad'];
export const CARRY_TYPES = ['birth', 'changed'];
export const CONFIDENCE = ['confirmed', 'tradition', 'uncertain'];
const KEYS = ['type', 'surname', 'given', 'han', 'from', 'to', 'reason', 'source', 'confidence'];
const MAX_NAMES = 12; const MAX_TEXT = 40; const MAX_NOTE = 200; const MAX_WHEN = 20;
const HAN_RE = /^[\p{Script=Han}\s]+$/u;

export const yearOf = (v) => { const m = /(\d{3,4})/.exec(String(v ?? '')); return m ? Number(m[1]) : null; };

export function namesError(v) {
  if (!Array.isArray(v)) return 'names must be a list';
  if (v.length > MAX_NAMES) return `names: tối đa ${MAX_NAMES} mục`;
  for (const e of v) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return 'names: mỗi mục là một đối tượng';
    const bad = Object.keys(e).find((k) => !KEYS.includes(k));
    if (bad) return `names: trường không hợp lệ ${bad}`;
    if (!NAME_TYPES.includes(e.type)) return 'names: loại không hợp lệ';
    const surname = typeof e.surname === 'string' ? e.surname.trim() : '';
    if (!surname) return 'names: cần họ';
    if (Array.from(surname).length > MAX_TEXT) return `names: họ tối đa ${MAX_TEXT} ký tự`;
    for (const k of ['given', 'reason', 'source', 'from', 'to']) {
      if (e[k] !== undefined && (typeof e[k] !== 'string' || e[k].length > (k === 'reason' || k === 'source' ? MAX_NOTE : MAX_WHEN))) return `names: ${k} không hợp lệ`;
    }
    if (e.han !== undefined) {
      const h = typeof e.han === 'string' ? e.han.trim() : '';
      if (h && (Array.from(h).length > MAX_TEXT || !HAN_RE.test(h))) return 'names: chữ Hán chỉ gồm chữ Hán và dấu cách';
    }
    if (e.confidence !== undefined && !CONFIDENCE.includes(e.confidence)) return 'names: độ chắc chắn không hợp lệ';
    const a = yearOf(e.from); const b = yearOf(e.to);
    if (a != null && b != null && a > b) return 'names: năm bắt đầu sau năm kết thúc';
  }
  return null;
}

export function timelineOf(data) {
  const xs = Array.isArray(data?.names) ? data.names.filter((e) => e && typeof e === 'object') : [];
  return xs.map((e, i) => ({ ...e, _i: i })).sort((x, y) => ((yearOf(x.from) ?? -Infinity) - (yearOf(y.from) ?? -Infinity)) || (x._i - y._i)).map(({ _i, ...e }) => e);
}

export function ownSurnameAt(data, year) {
  let best = null;
  for (const e of timelineOf(data)) {
    if (!CARRY_TYPES.includes(e.type)) continue;
    const from = yearOf(e.from);
    if (year != null && from != null && from > year) continue;
    best = e;
  }
  return best;
}

// get(id) -> { data, father } | null (father = the id of the parent with sex 'm', resolved by the caller).
export function surnameAt(id, year, get, seen = new Set()) {
  if (seen.has(id)) return { surname: null, source: null, from: null };
  seen.add(id);
  const p = get(id); if (!p) return { surname: null, source: null, from: null };
  const own = ownSurnameAt(p.data, year);
  if (own) return { surname: own.surname.trim(), source: 'own', from: own.from || null };
  if (p.father) {
    const up = surnameAt(p.father, year ?? yearOf(p.data?.born), get, seen);
    if (up.surname) return { surname: up.surname, source: 'inherited', from: up.from };
  }
  return { surname: null, source: null, from: null };
}

const ROLE_RANK = { owner: 4, admin: 4, editor: 3, member: 2 };
export function originVisibleTo(visibility, role) {
  if (visibility === 'all') return true;
  const r = ROLE_RANK[role] || 0;
  if (visibility === 'members') return r >= 2;
  if (visibility === 'editors') return r >= 3;
  return false;
}

export function windowOverlaps(win, life) {
  if (!win || (win.from == null && win.to == null)) return true;
  const by = life.by ?? null; const dy = life.dy ?? (by != null ? by + 100 : null);
  if (by == null && dy == null) return true;
  const lo = by ?? -Infinity; const hi = dy ?? Infinity;
  const wlo = win.from ?? -Infinity; const whi = win.to ?? Infinity;
  return wlo <= hi && lo <= whi;
}
