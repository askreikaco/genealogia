// Life events and stories: pure rules (no DOM, no DB). Used by the browser (timeline, form) and by the server
// (validation, privacy). Tested in server/test/events-rules.test.js.
//
// Dates: date_kind exact | about | before | after | between. date_from / date_to are ISO partial dates
// (YYYY, YYYY-MM or YYYY-MM-DD). exact/about: date_from. before/after: date_from is the boundary year/month/day.
// between: date_from .. date_to. The sort key is a best estimate (see eventDays).
//
// GEDCOM-compatible type mapping (for export later): sinh BIRT, cuoi MARR, ly_hon DIV, chuyen_nha RESI,
// hoc EDUC, nghe OCCU, quan_ngu EVEN (type "Military service"), thanh_tich EVEN ("Award"), ton_giao RELI,
// mat DEAT, an_tang BURI, khac EVEN.

import { parseReignYear } from './events-history.js';

export const EVENT_TYPES = {
  sinh: { label: 'Sinh', icon: 'sprout', gedcom: 'BIRT' },
  cuoi: { label: 'Kết hôn', icon: 'rings', gedcom: 'MARR' },
  ly_hon: { label: 'Ly hôn', icon: 'split', gedcom: 'DIV' },
  chuyen_nha: { label: 'Chuyển nhà', icon: 'house', gedcom: 'RESI' },
  hoc: { label: 'Học hành', icon: 'cap', gedcom: 'EDUC' },
  nghe: { label: 'Nghề nghiệp', icon: 'case', gedcom: 'OCCU' },
  quan_ngu: { label: 'Quân ngũ', icon: 'shield', gedcom: 'EVEN' },
  thanh_tich: { label: 'Thành tích', icon: 'star', gedcom: 'EVEN' },
  ton_giao: { label: 'Tôn giáo', icon: 'lotus', gedcom: 'RELI' },
  mat: { label: 'Mất', icon: 'candle', gedcom: 'DEAT' },
  an_tang: { label: 'An táng', icon: 'grave', gedcom: 'BURI' },
  khac: { label: 'Khác', icon: 'dot', gedcom: 'EVEN' },
};
export const EVENT_TYPE_KEYS = Object.keys(EVENT_TYPES);
export const DATE_KINDS = ['exact', 'about', 'before', 'after', 'between'];
export const SOURCE_QUALITY = { goc: 'Tài liệu gốc', loi_ke: 'Lời kể', suy_doan: 'Suy đoán' };
export const DATE_KIND_LABEL = { exact: '', about: 'khoảng', before: 'trước', after: 'sau', between: 'từ–đến' };

const ISO_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
const MAX_TEXT = 2000;

// ---- ISO partial dates ----
export function parseIso(s) {
  const m = ISO_RE.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1]; const mo = m[2] ? +m[2] : null; const d = m[3] ? +m[3] : null;
  if (mo !== null && (mo < 1 || mo > 12)) return null;
  if (d !== null && (d < 1 || d > daysIn(mo, y))) return null;
  return { y, m: mo, d };
}
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function daysIn(m, y) { return m ? [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] : 31; }
const DAY = 864e5;
// Day number (UTC) of a date, exact for years 0–99 and BCE: Date.UTC maps 0–99 to 1900–1999, so set the year explicitly.
export const dayNum = (y, m, d) => { const t = new Date(0); t.setUTCFullYear(y, (m || 1) - 1, d || 1); return Math.round(t.getTime() / DAY); };
// First and last day a partial date can cover.
export function startDays(iso) { const p = parseIso(iso); return p ? dayNum(p.y, p.m, p.d) : null; }
export function endDays(iso) { const p = parseIso(iso); return p ? dayNum(p.y, p.m || 12, p.d || daysIn(p.m || 12, p.y)) : null; }

// Best estimate of when an event happened, as a day number, for sorting and ages.
// exact/about: the start of the date (missing month/day = January / first). before X: the day before X starts.
// after X: the day after X ends. between A..B: the middle of the range.
export function eventDays(ev) {
  if (!ev || !ev.date_kind) return null;
  if (ev.date_kind === 'exact' || ev.date_kind === 'about') return startDays(ev.date_from);
  if (ev.date_kind === 'before') { const s = startDays(ev.date_from); return s === null ? null : s - 1; }
  if (ev.date_kind === 'after') { const e = endDays(ev.date_from); return e === null ? null : e + 1; }
  if (ev.date_kind === 'between') {
    const a = startDays(ev.date_from); const b = endDays(ev.date_to);
    return a === null || b === null ? null : Math.round((a + b) / 2);
  }
  return null;
}
export const yearOfDays = (n) => new Date(n * DAY).getUTCFullYear();

// Sort: estimated day, then the preferred one first, then the id (stable across devices).
export function sortEvents(list) {
  return [...list].sort((a, b) => {
    const da = eventDays(a); const db = eventDays(b);
    if (da === null && db !== null) return 1;
    if (db === null && da !== null) return -1;
    if (da !== db) return (da ?? 0) - (db ?? 0);
    if (!!a.band !== !!b.band) return a.band ? -1 : 1; // an era that starts at the birth year comes first
    if (a.is_preferred !== b.is_preferred) return a.is_preferred ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

// ---- smart date input: "5/3/1963", "3/1963", "1963", "khoảng 1980", "trước 1975", "sau 1990", "1980–1985", "từ 1980 đến 1985" ----
const PART = '(\\d{1,2}\\/\\d{1,2}\\/\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})';
const PREFIX = /^\s*(vd|v\.d\.|khoảng|khoang|khoảng chừng|chừng|about|~|trước|truoc|sau|từ|tu)?\s*/i;
function partIso(t) {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) { const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return parseIso(iso) ? iso : null; }
  m = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) { const iso = `${m[2]}-${m[1].padStart(2, '0')}`; return parseIso(iso) ? iso : null; }
  m = /^(\d{4})$/.exec(t);
  if (m) return m[1];
  return null;
}
export function parseEventDate(text) {
  const raw = String(text || '').trim();
  if (!raw) return { kind: null, from: null, to: null };
  const rg = parseReignYear(raw); // "Tự Đức thứ 10" -> about 1857 (the typed text is kept in date_text)
  if (rg) return rg.error ? { error: rg.error } : { kind: 'about', from: String(rg.year), to: null, reign: rg.king };
  const pm = PREFIX.exec(raw); const word = (pm && pm[1] ? pm[1].toLowerCase() : '');
  const rest = raw.slice(pm ? pm[0].length : 0).trim();
  const range = new RegExp('^' + PART + '\\s*(?:–|-|—|đến|den|to)\\s*' + PART + '$', 'i').exec(rest);
  if (range) {
    const a = partIso(range[1]); const b = partIso(range[2]);
    if (!a || !b) return { error: 'Ngày không hợp lệ. Dùng 5/3/1963, 3/1963 hoặc 1963.' };
    if (startDays(a) > endDays(b)) return { error: 'Ngày đầu phải trước ngày cuối.' };
    return { kind: 'between', from: a, to: b };
  }
  const one = partIso(rest);
  if (!one) return { error: 'Ngày không hợp lệ. Dùng 5/3/1963, 3/1963, 1963, "khoảng 1980", "trước 1975", "sau 1990" hoặc "1980–1985".' };
  const KIND = { 'khoảng': 'about', 'khoang': 'about', 'about': 'about', '~': 'about', 'chừng': 'about', 'khoảng chừng': 'about',
    'trước': 'before', 'truoc': 'before', 'sau': 'after' };
  return { kind: KIND[word] || 'exact', from: one, to: null };
}
// Display of an event date, Vietnamese, as typed: "1981", "3/1981", "khoảng 1980", "trước 1975", "1980–1985".
export function formatEventDate(ev) {
  if (!ev || !ev.date_kind || !ev.date_from) return '';
  const show = (iso) => { const p = parseIso(iso); if (!p) return iso; return p.d ? `${p.d}/${p.m}/${p.y}` : p.m ? `${p.m}/${p.y}` : `${p.y}`; };
  if (ev.date_kind === 'between') return `${show(ev.date_from)}–${show(ev.date_to)}`;
  const lbl = DATE_KIND_LABEL[ev.date_kind];
  return (lbl ? lbl + ' ' : '') + show(ev.date_from);
}

// Birth date of a person record as ISO partial: birth_date "5/3/1963", else born "1963". null when unknown.
export function birthIso(d) {
  if (!d) return null;
  const p = parseEventDate(d.birth_date || '');
  if ((p.kind === 'exact' || p.kind === 'about') && p.from && startDays(p.from) !== null) return p.from;
  return yearField(d.born);
}
// A year typed in a plain field: "941", "1963", "khoảng 901", "~941" -> ISO year padded to 4 digits ("0941", "0901"); else null.
// Years before 1000 are common in the reference trees, so 1–4 digits are accepted here.
export function yearField(s) {
  const m = /^\s*(?:~|khoảng chừng|khoảng|khoang|chừng|vd\.?)?\s*(\d{1,4})\s*$/i.exec(String(s || ''));
  return m ? m[1].padStart(4, '0') : null;
}
// Age at an event. Both dates full: whole years. Otherwise years by the year numbers, approx: true.
export function ageAt(birth, ev) {
  const e = eventDays(ev); if (e === null || !birth) return null;
  const bs = startDays(birth); if (bs === null) return null;
  const bp = parseIso(birth); const ep = parseIso(ev.date_from);
  const full = !!(bp.m && bp.d) && !!(ep && ep.m && ep.d) && ev.date_kind === 'exact';
  let years;
  if (full) years = Math.floor((e - bs) / 365.2425);
  else years = yearOfDays(e) - bp.y;
  if (years < 0) return null;
  return { years, approx: !full };
}

// Life stage groups on the timeline (headers only when the life spans over 70 years of age).
export const STAGES = [[0, 17, 'Thơ ấu'], [18, 69, 'Trưởng thành'], [70, 999, 'Cao tuổi']];
export const stageOf = (age) => (STAGES.find(([a, b]) => age >= a && age <= b) || STAGES[0])[2];

// died is stored as a year or a full date; derived events (events-life.js) need an ISO partial.
export function isoOfDied(s) {
  const p = parseEventDate(s || '');
  if ((p.kind === 'exact' || p.kind === 'about') && p.from) return p.from;
  return yearField(s);
}

// ---- privacy: by person. A living person's events are shown to members only; a deceased person's to anyone who can read the family ----
export const isLiving = (d) => !(d.living === 'dead' || !!(d.died || d.death_lunar || d.gio_lunar));
export function canSeeEventsOf(personData, { member, familyReadable }) {
  if (!familyReadable) return false;
  return isLiving(personData) ? !!member : true;
}

// ---- validation (server and form): returns an error string or null ----
export function validateEvent(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return 'Thiếu thông tin sự kiện.';
  if (!EVENT_TYPE_KEYS.includes(e.type)) return 'Loại sự kiện không hợp lệ.';
  if (e.date_kind !== null && e.date_kind !== undefined && !DATE_KINDS.includes(e.date_kind)) return 'Kiểu ngày không hợp lệ.';
  if (e.date_kind) {
    if (!parseIso(e.date_from)) return 'Ngày không hợp lệ.';
    if (e.date_kind === 'between') {
      if (!parseIso(e.date_to)) return 'Ngày cuối không hợp lệ.';
      if (startDays(e.date_from) > endDays(e.date_to)) return 'Ngày đầu phải trước ngày cuối.';
    } else if (e.date_to) return 'Chỉ khoảng ngày mới có ngày cuối.';
  }
  for (const k of ['date_text', 'lunar', 'place', 'place_new', 'description']) {
    if (e[k] !== undefined && e[k] !== null && (typeof e[k] !== 'string' || e[k].length > MAX_TEXT)) return `${k} quá dài hoặc sai kiểu.`;
  }
  if (e.people !== undefined && (!Array.isArray(e.people) || e.people.length > 20 || e.people.some((x) => typeof x !== 'string' || !/^P\d{3,6}$|^N[0-9a-z-]{6,40}$/.test(x)))) return 'Người liên quan không hợp lệ.';
  if (e.sources !== undefined) {
    if (!Array.isArray(e.sources) || e.sources.length > 20) return 'Nguồn không hợp lệ.';
    for (const s of e.sources) {
      if (!s || typeof s !== 'object' || typeof s.title !== 'string' || !s.title.trim() || s.title.length > 300) return 'Mỗi nguồn cần tên (tối đa 300 ký tự).';
      if (s.url && (typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url) || s.url.length > 2000)) return 'Link nguồn phải bắt đầu bằng http(s)://';
      if (s.quality !== undefined && !Object.keys(SOURCE_QUALITY).includes(s.quality)) return 'Chất lượng nguồn không hợp lệ.';
    }
  }
  if (e.is_preferred !== undefined && typeof e.is_preferred !== 'boolean') return 'is_preferred phải là đúng/sai.';
  if (e.photos !== undefined && !validPhotos(e.photos)) return 'Ảnh phải là link http(s) hoặc ảnh đã tải lên, tối đa 10 ảnh.';
  return null;
}
// Event photos: http(s) links or uploaded photos (/api/photos/<24 hex>), at most 10. Shared with the server.
export const EVENT_PHOTO_MAX = 10;
export function validPhotos(list) {
  return Array.isArray(list) && list.length <= EVENT_PHOTO_MAX
    && list.every((u) => typeof u === 'string' && u.length <= 2000 && (/^https?:\/\//i.test(u) || /^\/api\/photos\/[0-9a-f]{24}$/.test(u)));
}
export function validateStory(s) {
  if (!s || typeof s !== 'object') return 'Thiếu nội dung câu chuyện.';
  if (typeof s.title !== 'string' || s.title.length > 300) return 'Tiêu đề quá dài.';
  if (typeof s.body !== 'string' || s.body.length > 20000) return 'Nội dung quá dài (tối đa 20.000 ký tự).';
  if (s.photos !== undefined && (!Array.isArray(s.photos) || s.photos.length > 30 || s.photos.some((u) => typeof u !== 'string' || !/^https?:\/\//i.test(u) || u.length > 2000))) return 'Ảnh phải là link http(s), tối đa 30 ảnh.';
  if (s.kind !== undefined && !['chuyen', 'tom_tat'].includes(s.kind)) return 'Loại câu chuyện không hợp lệ.';
  return null;
}

// ---- auto "Câu chuyện đời": neutral sentences built from the events (shown until someone saves an edited version) ----
export function autoSummary(name, events) {
  const sorted = sortEvents(events.filter((e) => !e.derived));
  const out = [];
  for (const e of sorted) {
    const when = formatEventDate(e);
    const place = e.place ? `, ${e.place}` : '';
    const t = {
      sinh: `${name} sinh ${when ? (/^\d/.test(when) && !/–/.test(when) ? 'năm ' : 'vào ') + when.toLowerCase() : 'năm chưa rõ'}${place}.`,
      cuoi: `Kết hôn${e.title ? ' ' + e.title : ''}${when ? ' (' + when + ')' : ''}${place}.`,
      ly_hon: `Ly hôn${when ? ' (' + when + ')' : ''}.`,
      chuyen_nha: `Chuyển nhà${place}${when ? ' (' + when + ')' : ''}.`,
      hoc: `Học ${e.description ? e.description.split('\n')[0] : 'tại trường'}${when ? ' (' + when + ')' : ''}.`,
      nghe: `Làm việc: ${e.description ? e.description.split('\n')[0] : 'nghề nghiệp'}${when ? ' (' + when + ')' : ''}.`,
      quan_ngu: `Nhập ngũ${place}${when ? ' (' + when + ')' : ''}.`,
      thanh_tich: `Thành tích: ${e.description ? e.description.split('\n')[0] : ''}${when ? ' (' + when + ')' : ''}.`,
      ton_giao: `Theo đạo${when ? ' từ ' + when : ''}.`,
      mat: `Mất${when ? ' ' + when.toLowerCase() : ''}${place}.`,
      an_tang: `An táng${place}.`,
      khac: `${e.description ? e.description.split('\n')[0] : 'Sự kiện'}${when ? ' (' + when + ')' : ''}.`,
    }[e.type];
    if (t) out.push(t.replace(/\s+\(\)/g, '').replace(/\s{2,}/g, ' ').replace(/\s+\./g, '.'));
  }
  return out.join(' ');
}
