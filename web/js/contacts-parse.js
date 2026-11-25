// Contact import, on the device: parse vCard 3/4 and CSV (name, phone, email) and match each contact to a person by name.
// Pure functions, no network: the phone's contacts never leave the device (the DS rule "parse on device"). Matching reuses
// web/js/fuzzy.js (the app's fold and typo rules): exact = same name tokens in any order; candidate = every contact token
// matches a name token. Server tests load this same file, so there is one parser.

const MAX_TEXT = 512 * 1024; // a file bigger than this is refused (the app stays responsive)
const MAX_CONTACTS = 1000;
const MAX_CANDIDATES = 3;

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
const uniq = (a) => [...new Set(a)];

// Digits and one leading +, 6 to 15 digits. "tel:" (vCard 4 URI), spaces, dots and dashes are removed.
export function cleanPhone(v) {
  const t = String(v ?? '').trim().replace(/^tel:/i, '');
  const digits = t.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) return '';
  return (t.startsWith('+') ? '+' : '') + digits;
}
const EMAIL_RE = /^[^\s@]{1,200}@[^\s@]{1,200}\.[a-z]{2,}$/;
export function cleanEmail(v) {
  const t = String(v ?? '').trim().replace(/^mailto:/i, '').toLowerCase();
  return t.length <= 200 && EMAIL_RE.test(t) ? t : '';
}
const cleanName = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

// One contact: { name, phones[], emails[] }. A contact without a phone or an email is dropped (nothing to add).
export function normalizeContact({ name, phones = [], emails = [] }) {
  const c = { name: cleanName(name), phones: uniq(phones.map(cleanPhone).filter(Boolean)), emails: uniq(emails.map(cleanEmail).filter(Boolean)) };
  return c.phones.length || c.emails.length ? c : null;
}
export const cleanContacts = (list) => list.map(normalizeContact).filter(Boolean).slice(0, MAX_CONTACTS);

// ---- vCard 3.0 / 4.0: unfold continued lines, read FN, N, TEL, EMAIL per card. N is "family given" (Vietnamese order). ----
function unescapeValue(v) { return v.replace(/\\[nN]/g, ' ').replace(/\\([,;\\])/g, '$1'); }
export function parseVcard(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = []; let cur = null;
  for (const line of lines) {
    const m = /^([^:]+):(.*)$/.exec(line.trim());
    if (!m) continue;
    const prop = m[1].split(';')[0].replace(/^[^.]*\./, '').toUpperCase(); // drop "item1." groups and parameters
    const raw = m[2];
    if (prop === 'BEGIN' && /^VCARD$/i.test(raw.trim())) { cur = { fn: '', n: '', phones: [], emails: [] }; continue; }
    if (prop === 'END' && cur) { out.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (prop === 'FN') cur.fn = unescapeValue(raw);
    else if (prop === 'N') {
      const [family = '', given = ''] = raw.split(';');
      cur.n = [family, given].map((x) => unescapeValue(x).trim()).filter(Boolean).join(' ');
    } else if (prop === 'TEL') cur.phones.push(raw);
    else if (prop === 'EMAIL') cur.emails.push(raw);
  }
  return out.map((c) => normalizeContact({ name: c.fn || c.n, phones: c.phones, emails: c.emails })).filter(Boolean);
}

// ---- CSV: RFC 4180 quoting; ',' or ';' (whichever the first line uses more); optional header row ----
const HEADER = {
  name: /^(name|full ?name|fn|ten|ho ?ten|ho va ten|ten day du|contact)$/,
  phone: /^(phone|phones|tel|telephone|mobile|cell|sdt|dien ?thoai|so ?dien ?thoai|dt)$/,
  email: /^(email|e ?mail|mail|thu ?dien ?tu)$/,
};
function parseCsvRows(text) {
  const s = String(text).replace(/^﻿/, '');
  const firstLine = s.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
function columnsOf(first) {
  const keys = first.map((h) => fold(h).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim());
  const col = {};
  for (const [field, re] of Object.entries(HEADER)) { const i = keys.findIndex((k) => re.test(k)); if (i >= 0) col[field] = i; }
  return Object.keys(col).length ? { col, header: true } : { col: { name: 0, phone: 1, email: 2 }, header: false };
}
export function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  const { col, header } = columnsOf(rows[0]);
  const body = header ? rows.slice(1) : rows;
  const at = (r, i) => (i == null ? '' : String(r[i] ?? ''));
  return body.map((r) => normalizeContact({
    name: at(r, col.name),
    phones: at(r, col.phone).split(/[;|]/),
    emails: at(r, col.email).split(/[;|]/),
  })).filter(Boolean);
}

// Format by content (BEGIN:VCARD) or by file name (.vcf); anything else is CSV. Throws on oversized input.
export function parseContacts(text, filename = '') {
  if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('File quá lớn hoặc không đọc được.');
  const isVcard = /BEGIN:VCARD/i.test(text) || /\.vcf$/i.test(String(filename));
  const list = isVcard ? parseVcard(text) : parseCsv(text);
  return { format: isVcard ? 'vcard' : 'csv', contacts: list.slice(0, MAX_CONTACTS) };
}

// The Contact Picker shape ({ name: [..], tel: [..], email: [..] }) as contacts.
export function fromPicker(list) {
  return cleanContacts(list.map((c) => ({ name: Array.isArray(c.name) ? c.name[0] : c.name, phones: c.tel || [], emails: c.email || [] })));
}

// ---- matching: each contact against the people of the family (persons: [{ id, data: { name }, deleted? }]) ----
// fz: the fuzzy module (scorePerson, tokens). Up to three candidates, exact first; auto = exactly one exact candidate.
export function matchContacts(contacts, persons, fz) {
  const people = [];
  for (const p of persons) {
    const name = cleanName(p?.data?.name);
    if (name && !p.deleted) people.push({ id: p.id, name, key: fz.tokens(name).slice().sort().join(' ') });
  }
  return contacts.map((c, i) => {
    const toks = fz.tokens(c.name);
    const key = toks.slice().sort().join(' ');
    const cands = [];
    if (toks.length) {
      for (const p of people) {
        if (p.key && p.key === key) { cands.push({ id: p.id, name: p.name, score: 1, exact: true }); continue; }
        const s = fz.scorePerson(c.name, { data: { name: p.name } });
        if (s.total && s.matched === s.total && s.score >= 0.8) cands.push({ id: p.id, name: p.name, score: Math.round(s.score * 100) / 100, exact: false });
      }
    }
    cands.sort((a, b) => (b.exact - a.exact) || (b.score - a.score) || a.name.localeCompare(b.name, 'vi'));
    return { i, name: c.name, phones: c.phones, emails: c.emails, candidates: cands.slice(0, MAX_CANDIDATES), auto: cands.filter((x) => x.exact).length === 1 };
  });
}
export { MAX_TEXT, MAX_CONTACTS };
