// Places gazetteer: pure helpers (no database). Folding for accent-free search, date-range checks for names and
// parents valid at a date, and the shape the API returns. Dates are ISO strings or years ('1698', '1976-07-02').
'use strict';

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// '1976' -> '1976-01-01' (from) or '1976-12-31' (to); '1976-07' -> month start / end; full dates unchanged.
function edge(v, end) {
  const s = String(v ?? '').trim(); if (!s) return null;
  if (/^\d{4}$/.test(s)) return end ? `${s}-12-31` : `${s}-01-01`;
  if (/^\d{4}-\d{2}$/.test(s)) return end ? `${s}-31` : `${s}-01`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
const isDate = (v) => v == null || v === '' || edge(v, false) !== null;

// Is a row with valid_from / valid_to in force at `date` (null date = today's state: open-ended rows only)?
function validAt(row, date) {
  const to = edge(row.valid_to, true);
  if (!date) return to === null;
  const d = edge(date, false); if (!d) return false;
  const from = edge(row.valid_from, false);
  return (from === null || from <= edge(date, true)) && (to === null || to >= d);
}

// The name to show at a date: the primary name in force, else any name in force, else today's name, else the
// latest primary name (a place that no longer exists keeps its last name).
function nameAt(names, date, lang = 'vi') {
  const mine = names.filter((n) => n.lang === lang);
  const pool = mine.length ? mine : names;
  const pick = (rows) => rows.find((n) => n.is_primary) || rows[0];
  const at = pool.filter((n) => validAt(n, date));
  const today = date ? pool.filter((n) => validAt(n, null)) : [];
  const latest = [...pool].sort((a, b) => String(edge(b.valid_to, true) || '9999').localeCompare(String(edge(a.valid_to, true) || '9999')));
  return (pick(at) || pick(today) || pick(latest) || {}).name || '';
}

// Search score for one name against a folded query: exact 3, starts with 2, a word starts with 1, else 0.
function score(nameFold, q) {
  if (!q) return 0;
  if (nameFold === q) return 3;
  if (nameFold.startsWith(q)) return 2;
  return (' ' + nameFold).includes(' ' + q) ? 1 : 0;
}

const KINDS = ['country', 'province', 'district', 'commune', 'village', 'hamlet', 'cemetery', 'temple', 'other'];
const isId = (v) => /^\d{1,9}$/.test(String(v ?? ''));
const isPid = (v) => /^P\d{3,6}$|^N[0-9a-z-]{6,40}$/.test(String(v ?? ''));
// Person fields that may point to a place (address stays free text: it is contact data).
const PERSON_FIELDS = ['place', 'birth_place', 'burial'];

module.exports = { fold, edge, isDate, validAt, nameAt, score, KINDS, isId, isPid, PERSON_FIELDS };
