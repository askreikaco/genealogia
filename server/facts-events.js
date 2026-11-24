// Profile facts -> Dòng đời event proposals. Pure: no DB. Used by scripts/facts-to-events.js and its tests.
//
// What becomes an event:
//   a Nơi sống (place) value with an arrow, "A → B" or "A -> B": one move (chuyen_nha, place = B, description
//   "Chuyển từ A đến B. Ghi trong hồ sơ: <the whole text>"), dated when the text has a year, else undated.
//   note sentences that carry a year AND a known kind of event (military service, moving, schooling, an award, a
//   religious step, a divorce, retiring): one event per sentence, date from the sentence, the sentence as description.
// Left out on purpose: profile fields with no date that the profile already shows: Nơi sống without an arrow (where
// someone lives, not a move), An táng, Nghề, Tôn giáo. An undated copy on Dòng đời only repeats the Thông tin tab
// (skipped as 'profile'). Birth, death and marriage too. Dòng đời already shows them from the profile (events-life.js); a
// stored copy would drift when the profile changes. The profile itself is never changed: this only adds events.
// Every proposal carries legacy_key (field name, or 'note:<hash>') so a re-run adds nothing twice.
'use strict';
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

let rulesMod = null;
const rules = () => rulesMod || (rulesMod = import(pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'events.js')).href));

// Fields the profile shows on its own (Thông tin): no undated copy on Dòng đời. Nơi sống is read for "A → B" moves only.
const PROFILE_FIELDS = ['burial', 'job', 'religion', 'place'];
// "A → B", "A -> B" (a chain A → B → C reads as from A to C).
const ARROW = /\s*(?:→|->|=>)\s*/;
const SKIPPED_FIELDS = ['born', 'birth_date', 'died', 'death_date', 'married']; // shown by Dòng đời from the profile

// Accent-free, lower case, "đ" -> "d": keyword matching that ignores how the note was typed.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
// Note keywords (folded), first match wins. Whole words only.
const NOTE_KINDS = [
  ['quan_ngu', ['nhap ngu', 'di linh', 'tong quan', 'di bo doi', 'xuat ngu', 'giai ngu', 'quan ngu']],
  ['chuyen_nha', ['di cu', 'dinh cu', 'vao nam', 'ra bac', 'chuyen ve', 'chuyen vao', 'chuyen ra', 'chuyen den', 'don ve', 'don vao', 'lap nghiep']],
  ['hoc', ['tot nghiep', 'nhap hoc', 'di hoc', 'do tu tai', 'do cu nhan', 'do tien si', 'du hoc']],
  ['thanh_tich', ['huan chuong', 'huy chuong', 'bang khen', 'duoc phong', 'duoc tang', 'danh hieu']],
  ['ton_giao', ['quy y', 'theo dao', 'rua toi', 'xuat gia']],
  ['ly_hon', ['ly hon', 'ly di']],
  ['nghe', ['nghi huu', 've huu', 'vao lam']],
].map(([type, words]) => [type, new RegExp('\\b(' + words.map((w) => w.replace(/ /g, '\\s+')).join('|') + ')\\b')]);
// A sentence about a birth or a death is left alone: those dates come from the profile.
const LIFE_WORDS = /\b(sinh ra|ra doi|chao doi|qua doi|tu tran|hy sinh|tu the|mat nam|mat ngay|mat luc)\b/;
// The date inside a sentence: a range, or one year with an optional "khoảng / trước / sau / năm" before it.
const RANGE = /(?:từ\s+)?(?<!\d)(1\d{3}|20\d{2})(?!\d)\s*(?:–|-|—|đến|den)\s*(?<!\d)(1\d{3}|20\d{2})(?!\d)/i;
const ONE = /(khoảng|khoang|chừng|~|trước|truoc|sau|năm|nam)?\s*(?<!\d)(1\d{3}|20\d{2})(?!\d)/i;

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

// Sentences of a note: split on . ; ! ? and new lines (a dot with a digit on both sides, as in 5.3.1963, does not split).
function sentences(note) {
  return String(note || '').split(/(?<!\d)[.;!?]+|[.;!?]+(?!\d)|\n+/).map((s) => s.trim()).filter(Boolean);
}

// The date of a sentence as typed text ("1980", "khoảng 1980", "1980–1985") or '' when it has none.
function dateTextOf(s) {
  const r = RANGE.exec(s);
  if (r) return `${r[1]}–${r[2]}`;
  const m = ONE.exec(s);
  if (!m) return '';
  const w = fold(m[1] || '');
  const word = w === 'khoang' || w === 'chung' || w === '~' ? 'khoảng' : w === 'truoc' ? 'trước' : w === 'sau' ? 'sau' : '';
  return (word ? word + ' ' : '') + m[2];
}

// One person's data (persons.data) -> { rows, skipped, anomalies }.
//   rows: [{ legacy_key, from, type, date_text, date_kind, date_from, date_to, place, description, sources }]
//   skipped: [{ field, reason }]   anomalies: [{ type, field }]
// opts.notes (default true): also read the note. opts.existing: [{type, date_from}] the person's stored events; a
// proposal of a type the person already has (fields) or of the same type and year (notes) is skipped.
async function proposeFacts(data, { notes = true, existing = [] } = {}) {
  const { parseEventDate } = await rules();
  const d = data || {};
  const rows = []; const skipped = []; const anomalies = [];
  const hasType = (t) => existing.some((e) => e.type === t);
  const hasTypeYear = (t, y) => existing.some((e) => e.type === t && String(e.date_from || '').slice(0, 4) === y);
  for (const k of SKIPPED_FIELDS) if (clip(d[k], 200)) skipped.push({ field: k, reason: 'derived' });
  for (const k of PROFILE_FIELDS) {
    const v = clip(d[k], 2000);
    if (!v) continue;
    const parts = k === 'place' ? v.split(ARROW).map((x) => x.trim()).filter(Boolean) : [];
    if (parts.length < 2) { skipped.push({ field: k, reason: 'profile' }); continue; }
    const noYear = (x) => clip(x.replace(/\s*\([^)]*\d{4}[^)]*\)/g, '').trim(), 200); // "Làng Hai (khoảng 1955)" -> "Làng Hai"
    const from = noYear(parts[0]); const to = noYear(parts[parts.length - 1]);
    const dt = dateTextOf(v); const p = dt ? parseEventDate(dt) : null;
    if (p && (p.error || !p.kind)) { anomalies.push({ type: 'bad_date', field: k }); continue; }
    if (p ? hasTypeYear('chuyen_nha', String(p.from).slice(0, 4)) : hasType('chuyen_nha')) { skipped.push({ field: k, reason: 'has_event' }); continue; }
    rows.push({ legacy_key: 'place:move', from: k, type: 'chuyen_nha', date_text: p ? dt : '', date_kind: p ? p.kind : null,
      date_from: p ? p.from : null, date_to: p ? p.to || null : null, place: to,
      description: clip(`Chuyển từ ${from} đến ${to}. Ghi trong hồ sơ: ${v}`, 300), sources: [] }); // events have no title column
  }
  if (notes) {
    for (const s of sentences(d.note)) {
      const fs = fold(s);
      if (LIFE_WORDS.test(fs)) continue;
      const kind = NOTE_KINDS.find(([, re]) => re.test(fs));
      if (!kind) continue;
      const dt = dateTextOf(s);
      if (!dt) continue;
      const p = parseEventDate(dt);
      if (p.error || !p.kind) { anomalies.push({ type: 'bad_date', field: 'note' }); continue; }
      if (hasTypeYear(kind[0], String(p.from).slice(0, 4))) { skipped.push({ field: 'note', reason: 'has_event' }); continue; }
      rows.push({ legacy_key: 'note:' + hash(fold(s).replace(/\s+/g, ' ')), from: 'note', type: kind[0], date_text: dt, date_kind: p.kind,
        date_from: p.from, date_to: p.to || null, place: '', description: clip(s, 300), sources: [{ title: 'Ghi chú trong hồ sơ', url: '', quality: null }] });
    }
  }
  return { rows, skipped, anomalies };
}

module.exports = { proposeFacts, sentences, dateTextOf, fold, PROFILE_FIELDS, SKIPPED_FIELDS };
