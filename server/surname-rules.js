// Surname over time (plan 261124-surnames): a person's names[] timeline, the surname a descendant carries when no
// change is recorded, the family's họ gốc visibility, and the historical hint pack (editor hints only). Pure functions,
// no DB, no express. Tested in server/test/surname-rules.test.js.
'use strict';
const fs = require('fs');
const path = require('path');

const NAME_TYPES = ['birth', 'changed', 'aka', 'religious', 'abroad']; // birth/changed carry a surname; aka/religious/abroad are alias names
const CARRY_TYPES = ['birth', 'changed']; // the surnames a person actually carried (clan view, inheritance)
const CONFIDENCE = ['confirmed', 'tradition', 'uncertain'];
const KEYS = ['type', 'surname', 'given', 'han', 'from', 'to', 'reason', 'source', 'confidence'];
const MAX_NAMES = 12;
const MAX_TEXT = 40;
const MAX_NOTE = 200;
const MAX_WHEN = 20;
const HAN_RE = /^[\p{Script=Han}\s]+$/u;

const yearOf = (v) => { const m = /(\d{3,4})/.exec(String(v ?? '')); return m ? Number(m[1]) : null; };

// Validation of a person's names[] (the whole list is one field: newest write wins, see core.js mergeOp).
function namesError(v) {
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

// The timeline of one person, oldest first (undated entries first). Input: the person's data.
function timelineOf(data) {
  const xs = Array.isArray(data?.names) ? data.names.filter((e) => e && typeof e === 'object') : [];
  return xs.map((e, i) => ({ ...e, _i: i })).sort((x, y) => ((yearOf(x.from) ?? -Infinity) - (yearOf(y.from) ?? -Infinity)) || (x._i - y._i)).map(({ _i, ...e }) => e);
}

// Distinct surnames a person carried (birth and changed entries), in timeline order.
function carriedSurnames(data) {
  const out = [];
  for (const e of timelineOf(data)) if (CARRY_TYPES.includes(e.type) && e.surname && !out.includes(e.surname.trim())) out.push(e.surname.trim());
  return out;
}

// The surname in force in `year` from the person's own entries: the last birth/changed entry that began by then
// (an undated entry counts from the start). null when nothing of the person's own applies.
function ownSurnameAt(data, year) {
  let best = null;
  for (const e of timelineOf(data)) {
    if (!CARRY_TYPES.includes(e.type)) continue;
    const from = yearOf(e.from);
    if (year != null && from != null && from > year) continue;
    best = e;
  }
  return best;
}

// The surname a person carries in `year`. Descendants inherit: with no own entry in force, the father's surname in
// that year applies (father = the parent with sex 'm', resolved by the caller). get(id) -> { data, father } | null.
// Returns { surname, source: 'own' | 'inherited' | null, from } ; cycles stop with null.
function surnameAt(id, year, get, seen = new Set()) {
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

// Family họ gốc: who sees it. visibility: all | members | editors. role: owner | admin | editor | member | null (guest).
const ROLE_RANK = { owner: 4, admin: 4, editor: 3, member: 2 };
function originVisibleTo(visibility, role) {
  if (visibility === 'all') return true;
  const r = ROLE_RANK[role] || 0;
  if (visibility === 'members') return r >= 2;
  if (visibility === 'editors') return r >= 3;
  return false;
}

// Public view of names[]: the reason and the source of a change are for members (sensitive: persecution, kỵ húy).
function publicNames(names) {
  if (!Array.isArray(names)) return names;
  return names.map(({ reason, source, ...rest }) => rest);
}

// Life window check for an alias: a name used from `from` to `to` only applies when it overlaps the person's life.
// life = { by, dy } (years, null when unknown). Unbounded sides always overlap.
function windowOverlaps(win, life) {
  if (!win || (win.from == null && win.to == null)) return true;
  const by = life.by ?? null; const dy = life.dy ?? (by != null ? by + 100 : null);
  if (by == null && dy == null) return true;
  const lo = by ?? -Infinity; const hi = dy ?? Infinity;
  const wlo = win.from ?? -Infinity; const whi = win.to ?? Infinity;
  return wlo <= hi && lo <= whi;
}

// The historical hint pack (server/surname-hints.json): documented or traditional mass changes. Editor hints only:
// they are suggestions shown as "có thể liên quan" and are never assigned to a family or a person automatically.
let packCache = null;
function hintPack() {
  if (packCache) return packCache;
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'surname-hints.json'), 'utf8'));
  packCache = Array.isArray(raw) ? raw : [];
  return packCache;
}
const hintsFor = (surname) => {
  const s = String(surname || '').trim().toLowerCase();
  return s ? hintPack().filter((h) => String(h.from || '').toLowerCase() === s || String(h.to || '').toLowerCase() === s) : [];
};

module.exports = { NAME_TYPES, CARRY_TYPES, CONFIDENCE, MAX_NAMES, namesError, timelineOf, carriedSurnames, ownSurnameAt, surnameAt,
  originVisibleTo, publicNames, windowOverlaps, hintPack, hintsFor, yearOf };
