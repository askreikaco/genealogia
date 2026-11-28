// GEDCOM 5.5.1 for giapha: read (5.5.1 and 7.0), write, and the import plan. Pure: no database, no HTTP.
// Database side (export query, preview and apply in one transaction, suggestions) is in gedcom-routes.js.
// Event types and their GEDCOM tags come from web/js/events.js (EVENT_TYPES.gedcom); the date and event helpers are
// passed in as R; isDead comes from core.js.
// Custom tags start with _ (other programs ignore them): FAM _KIND (couple kind; "none" = no couple row), _ORD_A,
// _ORD_B, _PRIVATE; FAMC _KIND (child kind ke|khac), _ORDER, _PRIVATE; contacts _FB, _ZALO, _SOCIAL.
// Lunar dates: NOTE "Âm lịch: ..."; giỗ lunar date under DEAT: NOTE "Giỗ (âm lịch): ...".
'use strict';
const { isDead, hanNameError } = require('./core');
const { contactsOf } = require('./contact-rules');

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LUNAR_PREFIX = 'Âm lịch: ';
const GIO_PREFIX = 'Giỗ (âm lịch): ';
// Citation quality <-> QUAY (GEDCOM 5.5.1 "quality of data"): goc (original record) = 3 "direct and primary",
// loi_ke (someone's account) = 2 "secondary", suy_doan (inferred, not proven) = 1 "questionable". No quality = no QUAY line.
// Import reads the same numbers back. 0 ("unreliable") is not used.
const QUALITY_TO_QUAY = { goc: '3', loi_ke: '2', suy_doan: '1' };
const QUAY_TO_QUALITY = { 3: 'goc', 2: 'loi_ke', 1: 'suy_doan' };
const SOURCE_KINDS = ['gia_pha', 'bia_mo', 'giay_to', 'loi_ke', 'web', 'khac'];
const EVEN_LABEL = { quan_ngu: 'Quân ngũ', thanh_tich: 'Thành tích', khac: 'Khác' };
const LABEL_TO_EVEN = Object.fromEntries(Object.entries(EVEN_LABEL).map(([k, v]) => [v.toLowerCase(), k]));
const VALUE_TAGS = ['EDUC', 'OCCU', 'RELI']; // event tags whose value is the description (an empty one is written as Y)
const CP_KINDS = ['cuoi', 'vo_le', 'ban_doi', 'ly_hon', 'goa', 'khac'];
// Files in these languages write the family name first (vi, zh, ja, ko); the rest write the given name first.
const FAMILY_FIRST_LANGS = ['vi', 'zh', 'ja', 'ko'];
// Story notes on the person: NOTE "Câu chuyện: <title>" (kind chuyen) or NOTE "Câu chuyện đời: <title>" (kind tom_tat),
// the body on the following CONT lines. Import reads both, and the pointer form (1 NOTE @N1@ with a NOTE record,
// CONC/CONT joined) that other programs write. Same key on import and export: the stories table, see planImport.
const STORY_PREFIX = { chuyen: 'Câu chuyện: ', tom_tat: 'Câu chuyện đời: ' };
const STORY_NOTE = /^Câu chuyện( đời)?:/;
const PC_KINDS = ['ruot', 'nuoi', 'ke', 'khac'];
const CHUNK = 180; // characters per line piece (5.5.1 allows 255)
const NUM = /^-?\d+(\.\d+)?$/;

// ---------- dates ----------
const isoOk = (R, iso) => (R.parseIso(iso) ? iso : null);
// "15 MAR 1963", "MAR 1963", "1963" -> ISO partial, or null.
function oneIn(R, s) {
  const t = String(s).toUpperCase().trim();
  let m = /^(\d{1,2}) ([A-Z]{3}) (\d{4})$/.exec(t);
  if (m && MON.includes(m[2])) return isoOk(R, `${m[3]}-${String(MON.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  m = /^([A-Z]{3}) (\d{4})$/.exec(t);
  if (m && MON.includes(m[1])) return isoOk(R, `${m[2]}-${String(MON.indexOf(m[1]) + 1).padStart(2, '0')}`);
  m = /^(\d{4})$/.exec(t);
  return m ? isoOk(R, m[1]) : null;
}
// GEDCOM DATE value -> { kind, from, to, raw }. kind is null when the text is not a date this app can store (kept as typed).
function parseGedDate(R, raw) {
  const s = String(raw || '').replace(/^@#D[A-Z]+@\s*/i, '').replace(/\s+/g, ' ').trim();
  const unknown = { kind: null, from: null, to: null, raw: s };
  const one = (kind, t) => { const x = oneIn(R, t); return x ? { kind, from: x, to: null, raw: s } : unknown; };
  let m;
  if ((m = /^BET (.+) AND (.+)$/i.exec(s)) || (m = /^FROM (.+) TO (.+)$/i.exec(s))) {
    const a = oneIn(R, m[1]); const b = oneIn(R, m[2]);
    if (!a || !b || R.startDays(a) > R.endDays(b)) return unknown;
    return { kind: 'between', from: a, to: b, raw: s };
  }
  if ((m = /^FROM (.+)$/i.exec(s))) return one('after', m[1]);
  if ((m = /^TO (.+)$/i.exec(s))) return one('before', m[1]);
  if ((m = /^(ABT|CAL|EST) (.+)$/i.exec(s))) return one('about', m[2]);
  if ((m = /^BEF (.+)$/i.exec(s))) return one('before', m[1]);
  if ((m = /^AFT (.+)$/i.exec(s))) return one('after', m[1]);
  return one('exact', s);
}
// { kind, from, to } -> GEDCOM DATE value.
function gedDateOut(R, kind, from, to) {
  const one = (iso) => {
    const p = R.parseIso(iso); if (!p) return '';
    return p.d ? `${p.d} ${MON[p.m - 1]} ${p.y}` : p.m ? `${MON[p.m - 1]} ${p.y}` : `${p.y}`;
  };
  if (!kind || !from) return '';
  if (kind === 'exact') return one(from);
  if (kind === 'about') return `ABT ${one(from)}`;
  if (kind === 'before') return `BEF ${one(from)}`;
  if (kind === 'after') return `AFT ${one(from)}`;
  if (kind === 'between') return `BET ${one(from)} AND ${one(to)}`;
  return '';
}
// Stored person date ("5/3/1963", "khoảng 1980", a year) -> { kind, from, to }.
function dateFromText(R, text) {
  const s = String(text || '').trim();
  if (!s) return { kind: null, from: null, to: null };
  if (/^\d{4}$/.test(s)) return { kind: 'exact', from: s, to: null };
  const p = R.parseEventDate(s);
  return p.error || !p.kind ? { kind: null, from: null, to: null } : { kind: p.kind, from: p.from, to: p.to || null };
}
// Stored form of a full date (dd/mm/yyyy), '' when the date has no day.
function dmyOut(R, iso) {
  const p = R.parseIso(iso);
  return p && p.d && p.m ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}` : '';
}
const yearOfIso = (iso) => (iso ? String(iso).slice(0, 4) : '');

// ---------- reading ----------
const LINE_RE = /^\s*(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?: ?(.*))?$/;
// Lines -> tree of { level, xref, tag, value, children }. CONT adds a newline, CONC joins; bad lines become warnings.
function parseTree(text) {
  const warnings = [];
  const roots = []; const stack = [];
  String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const m = LINE_RE.exec(raw);
    if (!m) { warnings.push(`Dòng ${i + 1} không đúng định dạng GEDCOM, bỏ qua.`); return; }
    const level = Number(m[1]); const xref = m[2] || ''; const tag = m[3].toUpperCase(); const value = m[4] ?? '';
    if (tag === 'CONT' || tag === 'CONC') {
      const target = stack[level - 1];
      if (!target) { warnings.push(`Dòng ${i + 1}: ${tag} không có dòng cha, bỏ qua.`); return; }
      target.value = tag === 'CONT' ? `${target.value}\n${value}` : `${target.value}${value}`;
      return;
    }
    const node = { level, xref, tag, value, children: [] };
    if (level === 0) { roots.push(node); stack.length = 0; stack[0] = node; return; }
    const parent = stack[level - 1];
    if (!parent) { warnings.push(`Dòng ${i + 1}: mức ${level} không có dòng cha, bỏ qua.`); return; }
    parent.children.push(node);
    stack.length = level; stack[level] = node;
  });
  return { roots, warnings };
}
const subOf = (n, tag) => n.children.find((c) => c.tag === tag) || null;
const subsOf = (n, tag) => n.children.filter((c) => c.tag === tag);
const textOf = (n) => (n ? String(n.value || '').trim() : '');
// Pointer or xref without its @ delimiters: @P001@ -> P001.
const ptr = (v) => String(v || '').trim().replace(/^@(.*)@$/, '$1');
// NAME -> display name, surname, given and name order. The line decides when the surname comes first (/Surname/ at the
// start). A file in vi, zh, ja or ko is family first; any other line is given first (Western names: "John Smith").
function personName(n, lang) {
  const v = String(n.value || '').replace(/\s+/g, ' ').trim();
  let surname = textOf(subOf(n, 'SURN')); let given = textOf(subOf(n, 'GIVN'));
  const m = /\/([^/]*)\//.exec(v);
  let surnameFirst = null;
  if (m) {
    const before = v.slice(0, m.index).trim(); const after = v.slice(m.index + m[0].length).trim();
    surnameFirst = before === '';
    if (!surname) surname = m[1].trim();
    if (!given) given = [before, after].filter(Boolean).join(' ');
  }
  const nameOrder = surnameFirst === true || FAMILY_FIRST_LANGS.includes(lang) ? 'family_first' : 'given_first';
  if (!m && !surname && !given) { // plain text: the order says which word is the family name
    const w = v.split(' ').filter(Boolean);
    if (!w.length) return { name: '', surname: '', given: '', nameOrder };
    if (nameOrder === 'family_first') return { name: v, surname: w[0], given: w.slice(1).join(' '), nameOrder };
    return { name: v, surname: w[w.length - 1], given: w.slice(0, -1).join(' '), nameOrder };
  }
  const name = nameOrder === 'family_first' ? [surname, given].filter(Boolean).join(' ') : [given, surname].filter(Boolean).join(' ');
  return { name, surname, given, nameOrder };
}
const dateYearOf = (R, n) => {
  const d = subOf(n, 'DATE'); if (!d) return null;
  const g = parseGedDate(R, d.value);
  return g.kind ? { kind: g.kind, from: g.from, to: g.to } : null;
};

// A story note's text -> { kind, title, body }, or null when the text is not a story note (its first line is the title).
function storyOf(text) {
  const m = STORY_NOTE.exec(text); if (!m) return null;
  const rest = text.slice(m[0].length).replace(/^[ \t]/, '');
  const nl = rest.indexOf('\n');
  return { kind: m[1] ? 'tom_tat' : 'chuyen', title: (nl < 0 ? rest : rest.slice(0, nl)).trim(), body: nl < 0 ? '' : rest.slice(nl + 1).trim() };
}

// readGedcom(R, text) -> { version, persons, families, warnings, unknownTags }
// persons: { xref, name, alias, sex, attrs{phone,email,address,facebook,zalo,social}, note[], sources[{title,url?,quality?}],
//            stories (count), storyList[{kind,title,body}], famc[{fam,kind,order,private}], facts[{tag,value,date,dateRaw,place,type,lunar,gio,notes[],sources[]}] }
// families: { xref, husb, wife, chil[], marr, div, kind, ordA, ordB, private, noteText[] }
function readGedcom(R, text) {
  const { roots, warnings } = parseTree(text);
  const sours = new Map(); const notes = new Map(); const sourceRecs = [];
  let version = '5.5.1'; let lang = '';
  for (const r of roots) {
    if (r.tag === 'HEAD') { const v = subOf(subOf(r, 'GEDC') || { children: [] }, 'VERS'); version = textOf(v) || version; lang = textOf(subOf(r, 'LANG')).toLowerCase().slice(0, 2); }
    if (r.tag === 'SOUR' && r.xref) {
      // a source record (top level): the URL is the first NOTE that is a link (the exporter's form); other NOTEs are the note
      const texts = subsOf(r, 'NOTE').map(textOf).filter(Boolean);
      const url = texts.find((x) => /^https?:\/\//i.test(x)) || '';
      const note = texts.filter((x) => x !== url).join('\n');
      const yr = /^\s*(\d{4})/.exec(textOf(subOf(r, 'PUBL'))); const kind = textOf(subOf(r, '_KIND'));
      const rec = { title: textOf(subOf(r, 'TITL')), url, author: textOf(subOf(r, 'AUTH')), year: yr ? Number(yr[1]) : null,
        kind: SOURCE_KINDS.includes(kind) ? kind : 'khac', note };
      sours.set(ptr(r.xref), rec);
      if (rec.title) sourceRecs.push({ xref: ptr(r.xref), ...rec });
    }
    if ((r.tag === 'NOTE' || r.tag === 'SNOTE') && r.xref) notes.set(ptr(r.xref), String(r.value || ''));
  }
  let unknownTags = 0;
  const noteText = (n) => {
    const v = String(n.value || '').trim();
    return /^@[^@]+@$/.test(v) ? (notes.get(ptr(v)) || '') : String(n.value || '');
  };
  // A citation: title and url of its source record, quality (QUAY), the page (PAGE) and the record's xref (ref).
  const citation = (n) => {
    const ref = ptr(n.value);
    const rec = sours.get(ref) || { title: '', url: '' };
    const q = QUAY_TO_QUALITY[Number(textOf(subOf(n, 'QUAY')))];
    const out = {};
    if (rec.title) out.title = rec.title;
    if (rec.url) out.url = rec.url;
    if (q) out.quality = q;
    const page = textOf(subOf(n, 'PAGE')); if (page) out.page = page;
    if (rec.title) out.ref = ref;
    return out;
  };
  const factOf = (n) => {
    const dn = subOf(n, 'DATE');
    let lunar = ''; let gio = ''; const plain = [];
    for (const t of subsOf(n, 'NOTE').map(noteText)) {
      if (t.startsWith(LUNAR_PREFIX)) lunar = t.slice(LUNAR_PREFIX.length).trim();
      else if (t.startsWith(GIO_PREFIX)) gio = t.slice(GIO_PREFIX.length).trim();
      else if (t.trim()) plain.push(t.trim());
    }
    return {
      tag: n.tag, value: String(n.value || '').trim(), date: dn ? parseGedDate(R, dn.value) : null, dateRaw: dn ? dn.value.trim() : '',
      place: textOf(subOf(n, 'PLAC')), type: textOf(subOf(n, 'TYPE')), lunar, gio, notes: plain, sources: subsOf(n, 'SOUR').map(citation),
    };
  };
  const persons = []; const families = [];
  for (const r of roots) {
    if (r.tag === 'INDI' && r.xref) {
      const p = { xref: ptr(r.xref), name: '', surname: '', given: '', nameOrder: '', alias: '', han: '', sex: '', attrs: {}, note: [], sources: [], famc: [], facts: [], stories: 0, storyList: [] };
      for (const c of r.children) {
        if (c.tag === 'NAME') {
          // A second NAME with TYPE han carries the Hán name (tên chữ Hán); TYPE aka the alias; the first other NAME is the name.
          if (subsOf(c, 'TYPE').some((t) => textOf(t).toLowerCase() === 'han')) { const h = String(c.value || '').trim(); if (!hanNameError(h)) p.han = h; }
          else if (subsOf(c, 'TYPE').some((t) => textOf(t).toLowerCase() === 'aka')) p.alias = String(c.value || '').trim();
          else if (!p.name) Object.assign(p, personName(c, lang));
        } else if (c.tag === 'SEX') p.sex = { M: 'm', F: 'f' }[String(c.value || '').trim().toUpperCase()] || '';
        else if (c.tag === 'FAMC') {
          const k = textOf(subOf(c, '_KIND')).toLowerCase(); const pedi = textOf(subOf(c, 'PEDI')).toLowerCase();
          const o = Number(textOf(subOf(c, '_ORDER')));
          p.famc.push({ fam: ptr(c.value), kind: PC_KINDS.includes(k) ? k : (pedi === 'adopted' || pedi === 'foster') ? 'nuoi' : 'ruot',
            order: textOf(subOf(c, '_ORDER')) !== '' && Number.isInteger(o) ? o : null, private: textOf(subOf(c, '_PRIVATE')).toLowerCase() === 'yes' });
        } else if (['BIRT', 'DEAT', 'BURI', 'RESI', 'OCCU', 'RELI', 'EDUC', 'MARR', 'DIV', 'EVEN'].includes(c.tag)) p.facts.push(factOf(c));
        else if (c.tag === 'NOTE') {
          const t = noteText(c).trim(); const st = storyOf(t);
          if (st) { p.stories++; p.storyList.push(st); } else if (t) p.note.push(t);
        }
        else if (c.tag === 'SOUR') { const s = citation(c); if (s.title || s.url) p.sources.push(s); }
        else if (c.tag === 'TITL') p.attrs.title_name = textOf(c);
        else if (c.tag === '_THU') p.attrs.thu = textOf(c);
        else if (c.tag === '_ORDER') p.attrs.order = textOf(c);
        else if (c.tag === 'OBJE') p.attrs.photo = textOf(subOf(c, 'FILE'));
        else if (c.tag === 'MAP') { p.attrs.lat = coordOf(subOf(c, 'LATI'), 'N', 'S'); p.attrs.lon = coordOf(subOf(c, 'LONG'), 'E', 'W'); }
        else if (c.tag === 'PHON') p.attrs.phone = textOf(c);
        else if (c.tag === 'EMAIL') p.attrs.email = textOf(c);
        else if (c.tag === 'ADDR') p.attrs.address = textOf(c);
        else if (c.tag === '_FB') p.attrs.facebook = textOf(c);
        else if (c.tag === '_ZALO') p.attrs.zalo = textOf(c);
        else if (c.tag === '_SOCIAL') p.attrs.social = textOf(c);
        else if (c.tag !== 'FAMS') unknownTags++;
      }
      persons.push(p);
    } else if (r.tag === 'FAM' && r.xref) {
      const f = { xref: ptr(r.xref), husb: '', wife: '', chil: [], marr: null, div: null, kind: '', ordA: null, ordB: null, private: false, noteText: [] };
      for (const c of r.children) {
        const v = String(c.value || '').trim();
        if (c.tag === 'HUSB') f.husb = ptr(v);
        else if (c.tag === 'WIFE') f.wife = ptr(v);
        else if (c.tag === 'CHIL') f.chil.push(ptr(v));
        else if (c.tag === 'MARR') f.marr = dateYearOf(R, c);
        else if (c.tag === 'DIV') f.div = dateYearOf(R, c);
        else if (c.tag === '_KIND') f.kind = v.toLowerCase();
        else if (c.tag === '_ORD_A') f.ordA = /^\d+$/.test(v) ? Number(v) : null;
        else if (c.tag === '_ORD_B') f.ordB = /^\d+$/.test(v) ? Number(v) : null;
        else if (c.tag === '_PRIVATE') f.private = v.toLowerCase() === 'yes';
        else if (c.tag === 'NOTE') { const t = noteText(c).trim(); if (t) f.noteText.push(t); }
        else unknownTags++;
      }
      families.push(f);
    }
  }
  return { version, persons, families, sources: sourceRecs, warnings: [...warnings], unknownTags };
}

// GEDCOM coordinate (N12.5, S3, E106.7, W0.1) -> the stored text ("12.5", "-3"); '' when it is not one.
function coordOf(n, pos, neg) {
  const m = /^([NSEW])?\s*(-?\d+(?:\.\d+)?)$/i.exec(textOf(n));
  if (!m) return '';
  const hemi = (m[1] || '').toUpperCase();
  return hemi === neg ? `-${m[2].replace(/^-/, '')}` : m[2];
}

// ---------- writing ----------
function chunk(s) {
  const cps = Array.from(String(s));
  const out = [];
  for (let i = 0; i < cps.length; i += CHUNK) out.push(cps.slice(i, i + CHUNK).join(''));
  return out.length ? out : [''];
}
// One value, with CONT for each newline and CONC for long pieces.
function emit(lines, level, tag, text, xref = '') {
  String(text ?? '').replace(/\r/g, '').split('\n').forEach((part, i) => {
    const lvl = i === 0 ? level : level + 1;
    const pieces = chunk(part);
    const head = i === 0 ? `${level} ${xref ? xref + ' ' : ''}${tag}` : `${lvl} CONT`;
    lines.push(pieces[0] ? `${head} ${pieces[0]}` : head);
    for (let j = 1; j < pieces.length; j++) lines.push(`${lvl + 1} CONC ${pieces[j]}`);
  });
}
const tagLine = (lines, level, tag, text) => {
  const v = text === undefined || text === null ? '' : String(text);
  if (v === '') lines.push(`${level} ${tag}`); else emit(lines, level, tag, v);
};
// The name parts to write: stored surname and given name, else the display name split by the name order
// (family name first unless name_order says given first: Vietnamese records stay family first).
function partsOf(d) {
  if (d.surname || d.given) return { surname: d.surname || '', given: d.given || '', order: d.name_order === 'given_first' ? 'given_first' : 'family_first' };
  const w = String(d.name || '').replace(/\//g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return null;
  if (d.name_order === 'given_first') return { surname: w[w.length - 1], given: w.slice(0, -1).join(' '), order: 'given_first' };
  return { surname: w[0], given: w.slice(1).join(' '), order: 'family_first' };
}
// NAME with /Surname/ in its place for the order (family first: "/Dương/ Văn Ất"; given first: "John /Smith/"), GIVN and SURN.
function nameLines(lines, d) {
  const p = partsOf(d); if (!p) return;
  const sur = p.surname.replace(/\//g, ' ').trim(); const giv = p.given.replace(/\//g, ' ').trim();
  if (!sur && !giv) return;
  if (!sur) { tagLine(lines, 1, 'NAME', giv); lines.push(`2 GIVN ${giv}`); return; }
  const value = p.order === 'given_first' ? [giv, `/${sur}/`].filter(Boolean).join(' ') : [`/${sur}/`, giv].filter(Boolean).join(' ');
  lines.push(`1 NAME ${value}`);
  if (giv) lines.push(`2 GIVN ${giv}`);
  lines.push(`2 SURN ${sur}`);
}
// Families from the relation rows. Entry: { parents[], kids: [{child, rows}], couple: row|null }.
// A child belongs to the family of its exact parent set; a couple without children is its own family.
function groupFamilies(pcRows, cpRows) {
  const entries = []; const byKey = new Map();
  const keyOf = (ids) => [...new Set(ids)].sort().join('|');
  const parentsOf = new Map();
  for (const r of pcRows) { if (!parentsOf.has(r.child_id)) parentsOf.set(r.child_id, []); parentsOf.get(r.child_id).push(r); }
  for (const [child, rows] of parentsOf) {
    const k = keyOf(rows.map((r) => r.parent_id));
    if (!byKey.has(k)) { const e = { parents: [...new Set(rows.map((r) => r.parent_id))], kids: [], couple: null }; byKey.set(k, e); entries.push(e); }
    byKey.get(k).kids.push({ child, rows });
  }
  for (const c of cpRows) {
    const e = byKey.get(keyOf([c.a_id, c.b_id]));
    if (e && !e.couple) e.couple = c;
    else entries.push({ parents: [c.a_id, c.b_id], kids: [], couple: c });
  }
  entries.forEach((e, i) => { e.xref = `F${i + 1}`; });
  return entries;
}

// buildExport({ R, family, persons, events, pc, cp, living, now }) -> GEDCOM text (UTF-8).
// persons: [{ id, data }] (not deleted). events: rows of the events table. pc / cp: relation rows (table or legacy).
// living: 'show' (default) or 'hide' (people who are alive are left out, with their events and relations).
function buildExport({ R, family, persons, events = [], pc = [], cp = [], stories = [], sources = [], living = 'show', now = new Date() }) {
  const keep = (d) => living !== 'hide' || isDead(d || {});
  const people = persons.filter((p) => keep(p.data)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Set(people.map((p) => p.id));
  const sexOf = new Map(people.map((p) => [p.id, p.data?.sex === 'f' ? 'f' : p.data?.sex === 'm' ? 'm' : '']));
  const evBy = new Map();
  for (const e of events) if (ids.has(e.person_id)) { if (!evBy.has(e.person_id)) evBy.set(e.person_id, []); evBy.get(e.person_id).push(e); }
  const storiesBy = new Map();
  for (const st of stories) if (ids.has(st.person_id)) { if (!storiesBy.has(st.person_id)) storiesBy.set(st.person_id, []); storiesBy.get(st.person_id).push(st); }
  const entries = groupFamilies(pc.filter((r) => ids.has(r.parent_id) && ids.has(r.child_id)), cp.filter((r) => ids.has(r.a_id) && ids.has(r.b_id)));
  const famsOf = new Map(); const famcOf = new Map();
  for (const e of entries) {
    if (e.couple) { e.husb = e.couple.a_id; e.wife = e.couple.b_id; } else if (e.parents.length === 1) {
      const x = e.parents[0]; if (sexOf.get(x) === 'f') { e.husb = ''; e.wife = x; } else { e.husb = x; e.wife = ''; }
    } else {
      const [x, y] = e.parents; const swap = sexOf.get(x) === 'f' && sexOf.get(y) !== 'f';
      e.husb = swap ? y : x; e.wife = swap ? x : y;
    }
    for (const s of [e.husb, e.wife]) if (s) { if (!famsOf.has(s)) famsOf.set(s, []); famsOf.get(s).push(e.xref); }
    for (const k of e.kids) { if (!famcOf.has(k.child)) famcOf.set(k.child, []); famcOf.get(k.child).push({ e, k }); }
  }
  // Source records (top level, S<n>): the family's sources (sources.js) first, then citations written without one.
  const srcs = new Map();
  const srcPut = (key, rec) => { if (!srcs.has(key)) srcs.set(key, { xref: `S${srcs.size + 1}`, ...rec }); return srcs.get(key).xref; };
  const srcRef = (title, url) => srcPut(JSON.stringify([title, url || '']), { title, url: url || '' });
  const srcRefById = new Map(sources.map((s) => [s.id, srcPut('id:' + s.id, { title: s.title, url: s.url || '', author: s.author || '', year: s.year, kind: s.kind, note: s.note || '' })]));
  // the xref of one citation: its family source when it has one, else a record of its own
  const citeRef = (s) => (s.source_id && srcRefById.has(s.source_id) ? srcRefById.get(s.source_id) : srcRef(s.title, s.url));

  const lines = [];
  const vn = new Date(now.getTime() + 7 * 3600e3);
  lines.push('0 HEAD', '1 SOUR GENEALOGIA', '2 VERS 1.0', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8');
  lines.push(`1 DATE ${vn.getUTCDate()} ${MON[vn.getUTCMonth()]} ${vn.getUTCFullYear()}`, '1 SUBM @SUBM@');
  lines.push('0 @SUBM@ SUBM'); tagLine(lines, 1, 'NAME', family?.name || 'Gia phả');

  for (const p of people) {
    const d = p.data || {};
    lines.push(`0 @${p.id}@ INDI`);
    nameLines(lines, d);
    if (d.alias) { tagLine(lines, 1, 'NAME', String(d.alias).replace(/\n/g, ' ')); lines.push('2 TYPE aka'); }
    if (d.name_han) { tagLine(lines, 1, 'NAME', String(d.name_han).replace(/\s+/g, ' ').trim()); lines.push('2 TYPE han'); }
    lines.push(`1 SEX ${d.sex === 'f' ? 'F' : d.sex === 'm' ? 'M' : 'U'}`);
    const evs = R.sortEvents(evBy.get(p.id) || []);
    const has = (t) => evs.some((e) => e.type === t);
    if (!has('sinh')) {
      const bd = dateFromText(R, d.birth_date);
      const date = bd.kind ? bd : /^\d{4}$/.test(String(d.born || '').trim()) ? { kind: 'exact', from: String(d.born).trim(), to: null } : null;
      if (date || d.birth_place || d.birth_lunar) {
        lines.push('1 BIRT');
        if (date) lines.push(`2 DATE ${gedDateOut(R, date.kind, date.from, date.to)}`);
        if (d.birth_place) tagLine(lines, 2, 'PLAC', d.birth_place);
        if (d.birth_lunar) emit(lines, 2, 'NOTE', LUNAR_PREFIX + d.birth_lunar);
      }
    }
    if (!has('mat')) {
      const dd = dateFromText(R, d.death_date);
      const date = dd.kind ? dd : /^\d{4}$/.test(String(d.died || '').trim()) ? { kind: 'exact', from: String(d.died).trim(), to: null } : dateFromText(R, d.died);
      const hasGio = !!d.gio_lunar; const hasLunar = !!d.death_lunar;
      if (date.kind || hasLunar || hasGio || d.living === 'dead') {
        lines.push(date.kind || hasLunar || hasGio ? '1 DEAT' : '1 DEAT Y');
        if (date.kind) lines.push(`2 DATE ${gedDateOut(R, date.kind, date.from, date.to)}`);
        if (hasLunar) emit(lines, 2, 'NOTE', LUNAR_PREFIX + d.death_lunar);
        if (hasGio) emit(lines, 2, 'NOTE', GIO_PREFIX + d.gio_lunar);
      }
    } else if (d.death_lunar || d.gio_lunar) {
      lines.push('1 DEAT');
      if (d.death_lunar) emit(lines, 2, 'NOTE', LUNAR_PREFIX + d.death_lunar);
      if (d.gio_lunar) emit(lines, 2, 'NOTE', GIO_PREFIX + d.gio_lunar);
    }
    if (!has('an_tang') && d.burial) { lines.push('1 BURI'); emit(lines, 2, 'NOTE', d.burial); }
    if (d.place) { lines.push('1 RESI'); tagLine(lines, 2, 'PLAC', d.place); }
    if (d.job) tagLine(lines, 1, 'OCCU', d.job);
    if (d.religion) tagLine(lines, 1, 'RELI', d.religion);
    if (d.title_name) tagLine(lines, 1, 'TITL', d.title_name);
    if (d.thu) tagLine(lines, 1, '_THU', d.thu);
    if (/^\d+$/.test(String(d.order ?? ''))) lines.push(`1 _ORDER ${d.order}`);
    if (/^https?:\/\//i.test(String(d.photo || ''))) { lines.push('1 OBJE'); tagLine(lines, 2, 'FILE', d.photo); }
    if (NUM.test(String(d.lat ?? '')) && NUM.test(String(d.lon ?? ''))) {
      lines.push('1 MAP'); lines.push(`2 LATI ${String(d.lat).startsWith('-') ? 'S' + String(d.lat).slice(1) : 'N' + d.lat}`);
      lines.push(`2 LONG ${String(d.lon).startsWith('-') ? 'W' + String(d.lon).slice(1) : 'E' + d.lon}`);
    }
    for (const e of evs) writeEvent(lines, R, e, citeRef);
    for (const x of famsOf.get(p.id) || []) lines.push(`1 FAMS @${x}@`);
    for (const { e, k } of famcOf.get(p.id) || []) {
      // One link per child and family: the kind of the first parent row (a child with two different kinds loses one).
      const row = k.rows.find((r) => r.parent_id === (e.husb || e.wife)) || k.rows[0] || {};
      lines.push(`1 FAMC @${e.xref}@`);
      if (row.kind === 'nuoi') lines.push('2 PEDI adopted');
      if (row.kind === 'ke' || row.kind === 'khac') lines.push(`2 _KIND ${row.kind}`);
      if (row.birth_order != null) lines.push(`2 _ORDER ${row.birth_order}`);
      if (row.private) lines.push('2 _PRIVATE yes');
    }
    if (d.note) tagLine(lines, 1, 'NOTE', d.note);
    for (const st of storiesBy.get(p.id) || []) emit(lines, 1, 'NOTE', `${STORY_PREFIX[st.kind] || STORY_PREFIX.chuyen}${st.title || ''}${st.body ? '\n' + st.body : ''}`);
    if (d.source) lines.push(`1 SOUR @${srcRef(String(d.source).trim(), '')}@`);
    if (d.contact_public === 'yes' && !isDead(d)) {
      const TAG = { phone: ['PHON'], email: ['EMAIL'], address: ['ADDR'], facebook: ['_FB'], zalo: ['_ZALO'], other: ['_SOCIAL'] };
      for (const c of contactsOf(d)) if (TAG[c.type]) tagLine(lines, 1, TAG[c.type][0], c.value); // the list (or the flat fields it replaces)
    }
  }

  for (const e of entries) {
    lines.push(`0 @${e.xref}@ FAM`);
    if (e.husb) lines.push(`1 HUSB @${e.husb}@`);
    if (e.wife) lines.push(`1 WIFE @${e.wife}@`);
    for (const k of e.kids) lines.push(`1 CHIL @${k.child}@`);
    const c = e.couple;
    if (c) {
      lines.push(`1 _KIND ${c.kind || 'khac'}`);
      if (c.start_year && ['cuoi', 'vo_le', 'ly_hon'].includes(c.kind)) lines.push('1 MARR', `2 DATE ${c.start_year}`);
      if (c.kind === 'ly_hon' && c.end_year) lines.push('1 DIV', `2 DATE ${c.end_year}`);
      if (c.order_a != null) lines.push(`1 _ORD_A ${c.order_a}`);
      if (c.order_b != null) lines.push(`1 _ORD_B ${c.order_b}`);
      if (c.note) tagLine(lines, 1, 'NOTE', c.note);
      if (c.private) lines.push('1 _PRIVATE yes');
    } else if (e.parents.length === 2) lines.push('1 _KIND none');
  }
  for (const s of srcs.values()) {
    lines.push(`0 @${s.xref}@ SOUR`); tagLine(lines, 1, 'TITL', s.title);
    if (s.author) tagLine(lines, 1, 'AUTH', s.author);
    if (s.year) lines.push(`1 PUBL ${s.year}`);
    if (s.kind) lines.push(`1 _KIND ${s.kind}`);
    if (s.url) tagLine(lines, 1, 'NOTE', s.url);
    if (s.note) emit(lines, 1, 'NOTE', s.note);
  }
  lines.push('0 TRLR');
  return lines.join('\n') + '\n';
}

function writeEvent(lines, R, e, citeRef) {
  const tag = R.EVENT_TYPES[e.type]?.gedcom || 'EVEN';
  const desc = String(e.description || '').trim();
  if (tag === 'EVEN') { tagLine(lines, 1, 'EVEN', desc); lines.push(`2 TYPE ${EVEN_LABEL[e.type] || 'Khác'}`); }
  else if (VALUE_TAGS.includes(tag)) tagLine(lines, 1, tag, desc || 'Y');
  else lines.push(`1 ${tag}`);
  if (e.date_kind) lines.push(`2 DATE ${gedDateOut(R, e.date_kind, e.date_from, e.date_to)}`);
  else if (e.date_text) tagLine(lines, 2, 'DATE', String(e.date_text).replace(/\n/g, ' '));
  if (e.place) tagLine(lines, 2, 'PLAC', String(e.place).replace(/\n/g, ' '));
  if (tag !== 'EVEN' && !VALUE_TAGS.includes(tag) && desc) emit(lines, 2, 'NOTE', desc);
  if (e.lunar) emit(lines, 2, 'NOTE', LUNAR_PREFIX + e.lunar);
  for (const s of e.sources || []) {
    if (!s || !s.title) continue;
    lines.push(`2 SOUR @${citeRef(s)}@`);
    if (s.page) tagLine(lines, 3, 'PAGE', String(s.page).replace(/\n/g, ' '));
    if (QUALITY_TO_QUAY[s.quality]) lines.push(`3 QUAY ${QUALITY_TO_QUAY[s.quality]}`);
  }
}

// ---------- import plan ----------
// Description of an event fact: the tag value when it has one ('Y' is the empty value), else its NOTE lines.
const squash0 = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const descOf = (f) => (f.value && f.value !== 'Y' ? f.value : f.notes.join('\n'));
// Stories: a story note is planned as a new story unless the person already has the same one (kind, title and body,
// whitespace squashed: a file written from this app matches on a second import). A second "Câu chuyện đời" with other
// text is not written (one per person) and is counted as skipped.
// planImport(doc, ctx) -> { counts, items, persons, relations, warnings, idOf }. Pure: nothing is written.
// doc: readGedcom result. ctx: { R, F (fuzzy.js), persons: [{id, data}], events, stories (rows as stored), pc, cp (relation rows
//   as stored), relMode: 'table' | 'legacy', newId(xref) -> id }.
// Matching: same id (a file exported from this family), else fuzzy name (fuzzy.js, every token) with the birth year
// not more than a year apart when both are known. Ties are ambiguous and become new people.
// Per person: fields that are empty here are filled; a field with a different value is a conflict (the apply step
// sends it to the review queue); events are added when not already there. Nothing is overwritten.
function planImport(doc, ctx) {
  const { R, F, persons = [], events = [], stories = [], pc = [], cp = [], relMode = 'table', newId, sources: famSources = [] } = ctx;
  const warnings = [...(doc.warnings || [])];
  // Citations: a source of the family with the same title and url is used (source_id); any other one is planned as a new
  // source (source_key, created by the apply step). Keyed by title and url, so a second import of the same file adds nothing.
  const srcKey = (t, u) => `${squash0(t)}|${squash0(u)}`;
  const famSrc = new Map(famSources.map((x) => [srcKey(x.title, x.url), x.id]));
  const recOf = new Map(doc.sources.map((r) => [r.xref, r]));
  const newSources = new Map();
  const citeOf = (c) => {
    const key = srcKey(c.title, c.url);
    if (famSrc.has(key)) return { source_id: famSrc.get(key) };
    if (!newSources.has(key)) {
      const rec = recOf.get(c.ref) || {};
      newSources.set(key, { key, input: { title: c.title, url: c.url || '', kind: rec.kind || 'khac', author: rec.author || '', year: rec.year ?? null, note: rec.note || '' } });
    }
    return { source_key: key };
  };
  const byId = new Map(persons.map((p) => [p.id, { id: p.id, data: p.data || {} }]));
  const evBy = new Map();
  for (const e of events) { if (!evBy.has(e.person_id)) evBy.set(e.person_id, []); evBy.get(e.person_id).push(e); }
  const stBy = new Map();
  for (const s of stories) { if (!stBy.has(s.person_id)) stBy.set(s.person_id, []); stBy.get(s.person_id).push(s); }
  const squash = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const storyKey = (s) => `${s.kind}|${squash(`${s.title || ''} ${s.body || ''}`)}`;
  const yearOfData = (d) => {
    if (/^\d{4}$/.test(String(d.born || '').trim())) return Number(d.born);
    const p = R.parseEventDate(d.birth_date || ''); return p.kind && p.from ? Number(String(p.from).slice(0, 4)) : null;
  };
  // Matching.
  const used = new Set(); const matches = [];
  for (const x of doc.persons) {
    if (!x.name) { warnings.push(`Người ${x.xref} không có họ tên, bỏ qua.`); matches.push({ x, skip: true }); continue; }
    let target = null; let how = null;
    if (byId.has(x.xref) && !used.has(x.xref)) { target = x.xref; how = 'id'; }
    else {
      const bf = x.facts.find((f) => f.tag === 'BIRT' && f.date && f.date.from);
      const bYear = bf ? Number(String(bf.date.from).slice(0, 4)) : null;
      const cands = [];
      for (const p of byId.values()) {
        if (used.has(p.id)) continue;
        const s = F.scorePerson(x.name, { data: { name: p.data.name, alias: p.data.alias } });
        if (!s.matched || s.matched < s.total || s.score < 0.8) continue;
        const py = yearOfData(p.data);
        const gap = bYear != null && py != null ? Math.abs(bYear - py) : null;
        if (gap != null && gap > 1) continue;
        cands.push({ id: p.id, score: s.score, gap: gap ?? 99 });
      }
      cands.sort((a, b) => (b.score - a.score) || (a.gap - b.gap));
      if (cands.length === 1 || (cands.length > 1 && (cands[0].score > cands[1].score || cands[0].gap < cands[1].gap))) { target = cands[0].id; how = 'name'; }
      else if (cands.length) how = 'ambiguous';
    }
    if (target) used.add(target);
    matches.push({ x, target, how });
  }
  const idOf = new Map();
  for (const m of matches) if (!m.skip) { m.id = m.target || newId(m.x.xref); idOf.set(m.x.xref, m.id); }

  const counts = { persons: doc.persons.length, new: 0, matched: 0, conflicts: 0, events_new: 0, fields_fill: 0, fields_conflict: 0,
    ambiguous: 0, skipped: 0, stories_new: 0, stories_same: 0, stories_skipped: 0, relations_new: 0, relations_same: 0, relations_pending: 0,
    sources: 0, unknown_tags: doc.unknownTags || 0, families: doc.families.length };
  const out = { counts, items: [], persons: [], relations: [], warnings, idOf };

  for (const m of matches) {
    if (m.skip) { counts.skipped++; continue; }
    const { x } = m;
    const cur = m.target ? byId.get(m.target).data : {};
    const fill = {}; const conflicts = []; const newEvents = []; const newKeys = new Set();
    const norm = (field, v) => {
      const s = v === undefined || v === null ? '' : String(v).trim();
      if (field === 'birth_date' || field === 'death_date') { const p = R.parseEventDate(s); return p.kind ? `${p.kind}:${p.from}:${p.to || ''}` : s; }
      return s;
    };
    const put = (field, incoming) => {
      const inc = incoming === undefined || incoming === null ? '' : String(incoming).trim();
      if (!inc) return;
      if (field in fill) { if (norm(field, fill[field]) !== norm(field, inc)) warnings.push(`${x.name}: hai giá trị khác nhau cho ${field} trong file, giữ giá trị đầu tiên.`); return; }
      const c = cur[field];
      if (norm(field, c) === '') fill[field] = field === 'order' ? Number(inc) : inc;
      else if (norm(field, c) !== norm(field, inc) && !conflicts.some((k) => k.field === field)) conflicts.push({ field, current: c, incoming: inc });
    };
    const existing = m.target ? (evBy.get(m.target) || []) : [];
    const evKey = (e) => [e.type, e.date_kind || '', e.date_from || '', e.date_to || '', String(e.place || '').trim(), String(e.description || '').trim()].join('|');
    const haveKeys = new Set(existing.map(evKey));
    const dateOf = (f) => (f.date && f.date.kind ? f.date : null);
    const addEvent = (type, f, description) => {
      const date = dateOf(f);
      const input = { type, date_kind: date ? date.kind : null, date_from: date ? date.from : null, date_to: date ? (date.to || null) : null,
        date_text: date ? R.formatEventDate({ date_kind: date.kind, date_from: date.from, date_to: date.to }) : (f.dateRaw || ''),
        place: f.place || '', description: description ?? f.notes.join('\n'), lunar: f.lunar || '',
        sources: (f.sources || []).filter((s) => s.title).map((s) => ({ title: s.title, ...(s.url ? { url: s.url } : {}), ...(s.quality ? { quality: s.quality } : {}),
          ...(s.page ? { page: s.page } : {}), ...citeOf(s) })),
        is_preferred: true, people: [] };
      const err = R.validateEvent(input);
      if (err) { warnings.push(`${x.name}: sự kiện ${type} bỏ qua (${err}).`); return; }
      const key = evKey(input);
      if (haveKeys.has(key) || newKeys.has(key)) return;
      newKeys.add(key); newEvents.push(input);
    };
    const sameEvent = (type, f) => {
      const date = dateOf(f);
      return existing.some((e) => e.type === type && (e.date_kind || null) === (date ? date.kind : null)
        && (e.date_from || null) === (date ? date.from : null) && (e.date_to || null) === (date ? date.to || null : null)
        && String(e.place || '').trim() === String(f.place || '').trim());
    };

    put('name', x.name); put('alias', x.alias); put('name_han', x.han); put('sex', x.sex);
    // Name parts follow a new name only: an existing name (equal or conflicting) keeps its parts.
    if (!cur.name) { put('surname', x.surname); put('given', x.given); put('name_order', x.nameOrder); }
    for (const k of ['phone', 'email', 'address', 'facebook', 'zalo', 'social', 'title_name', 'thu', 'photo', 'lat', 'lon']) put(k, x.attrs[k]);
    put('order', /^\d+$/.test(x.attrs.order || '') ? x.attrs.order : '');
    if (x.note.length) put('note', x.note.join('\n'));
    if (x.sources.length) put('source', x.sources.map((s) => s.title || s.url).filter(Boolean).join('; '));
    const haveSt = m.target ? (stBy.get(m.target) || []) : [];
    const stKeys = new Set(haveSt.map(storyKey));
    const hasSummary = haveSt.some((s) => s.kind === 'tom_tat');
    const newStories = [];
    for (const st of x.storyList) {
      if (!squash(st.title) && !squash(st.body)) continue;
      const key = storyKey(st);
      if (stKeys.has(key)) { counts.stories_same++; continue; }
      if (st.kind === 'tom_tat' && (hasSummary || newStories.some((s) => s.kind === 'tom_tat'))) {
        counts.stories_skipped++; warnings.push(`${x.name}: đã có câu chuyện đời, giữ bản hiện tại.`); continue;
      }
      stKeys.add(key); newStories.push(st);
    }
    counts.stories_new += newStories.length;
    for (const f of x.facts) {
      const date = dateOf(f); // a DATE this app can store
      const raw = !!f.dateRaw; // any DATE line (a text this app cannot store is kept on the event as typed)
      if (f.tag === 'BIRT') {
        if (raw && !date) { addEvent('sinh', f); continue; }
        if (date && sameEvent('sinh', f)) continue;
        if (date && date.kind !== 'exact') { if (date.from) put('born', yearOfIso(date.from)); addEvent('sinh', f); continue; }
        if (date) { put('born', yearOfIso(date.from)); if (dmyOut(R, date.from)) put('birth_date', dmyOut(R, date.from)); }
        put('birth_place', f.place); put('birth_lunar', f.lunar);
      } else if (f.tag === 'DEAT') {
        if (!raw && !f.place) {
          if (f.lunar) put('death_lunar', f.lunar);
          if (f.gio) put('gio_lunar', f.gio);
          if (!f.lunar && !f.gio) {
            if (cur.living && cur.living !== 'dead') { if (!conflicts.some((k) => k.field === 'living')) conflicts.push({ field: 'living', current: cur.living, incoming: 'dead' }); }
            else put('living', 'dead');
          }
          continue;
        }
        if (raw && !date) { addEvent('mat', f); continue; }
        if (date && sameEvent('mat', f)) continue;
        if (date && date.kind === 'exact' && !f.place) {
          put('died', yearOfIso(date.from)); if (dmyOut(R, date.from)) put('death_date', dmyOut(R, date.from));
        } else { if (date && date.from) put('died', yearOfIso(date.from)); addEvent('mat', f); }
        if (f.lunar) put('death_lunar', f.lunar);
        if (f.gio) put('gio_lunar', f.gio);
      } else if (f.tag === 'BURI') { if (!raw && !f.place) put('burial', f.notes.join('\n')); else addEvent('an_tang', f); }
      else if (f.tag === 'RESI') { if (!raw) put('place', f.place); else addEvent('chuyen_nha', f); }
      else if (f.tag === 'OCCU') { if (!raw) put('job', f.value); else addEvent('nghe', f, descOf(f)); }
      else if (f.tag === 'RELI') { if (!raw) put('religion', f.value); else addEvent('ton_giao', f, descOf(f)); }
      else if (f.tag === 'MARR') addEvent('cuoi', f);
      else if (f.tag === 'DIV') addEvent('ly_hon', f);
      else if (f.tag === 'EDUC') addEvent('hoc', f, descOf(f));
      else if (f.tag === 'EVEN') addEvent(LABEL_TO_EVEN[String(f.type).toLowerCase()] || 'khac', f, descOf(f));
    }
    const conflictFields = new Set(conflicts.map((c) => c.field));
    const fields = Object.keys(fill).filter((k) => !conflictFields.has(k));
    if (!m.target) counts.new++;
    else if (conflicts.length) counts.conflicts++;
    else counts.matched++;
    if (m.how === 'ambiguous') counts.ambiguous++;
    counts.events_new += newEvents.length;
    counts.fields_fill += fields.length;
    counts.fields_conflict += conflicts.length;
    out.persons.push({ xref: x.xref, id: m.id, target: m.target || null, isNew: !m.target, fill, conflicts, events: newEvents, stories: newStories, how: m.how });
    if (out.items.length < 300) {
      out.items.push({ xref: x.xref, id: m.id, name: x.name, action: !m.target ? 'new' : conflicts.length ? 'conflict' : 'matched', how: m.how,
        fields, conflicts: conflicts.map((c) => ({ field: c.field, current: c.current, incoming: c.incoming })), events: newEvents.length, stories: newStories.length });
    }
  }

  // Relations between the planned ids. Identity: the parent-child pair; the couple pair with its kind.
  const pcHave = new Set(pc.map((r) => `${r.parent_id}>${r.child_id}`));
  const cpHave = new Set(cp.map((r) => [r.a_id, r.b_id].sort().join('|') + '|' + r.kind));
  const pcSeen = new Set(); const cpSeen = new Set(); const rel = [];
  const coupleKind = (f, husb, wife) => {
    if (f.kind === 'none') return null;
    if (f.kind) return CP_KINDS.includes(f.kind) ? f.kind : null;
    if (f.div) return 'ly_hon';
    if (f.marr) return 'cuoi';
    return husb && wife ? 'ban_doi' : null;
  };
  for (const f of doc.families) {
    const husb = idOf.get(f.husb) || null; const wife = idOf.get(f.wife) || null;
    if ((f.husb && !husb) || (f.wife && !wife)) warnings.push(`Gia đình ${f.xref}: có người không có trong file, bỏ qua quan hệ đó.`);
    const kind = husb && wife && husb !== wife ? coupleKind(f, husb, wife) : null;
    if (kind) {
      const k = [husb, wife].sort().join('|') + '|' + kind;
      if (!cpSeen.has(k)) {
        cpSeen.add(k);
        rel.push({ type: 'couple', a: husb, b: wife, kind, order_a: f.ordA, order_b: f.ordB, private: f.private,
          start_year: f.marr && f.marr.from ? Number(yearOfIso(f.marr.from)) : null, end_year: f.div && f.div.from ? Number(yearOfIso(f.div.from)) : null,
          note: f.noteText.join('\n') || null });
      }
    }
    for (const cx of f.chil) {
      const child = idOf.get(cx);
      if (!child) { warnings.push(`Con ${cx} không có trong file, bỏ qua.`); continue; }
      const link = (doc.persons.find((p) => p.xref === cx)?.famc || []).find((z) => z.fam === f.xref) || {};
      for (const parent of [husb, wife]) {
        if (!parent || parent === child) continue;
        const k = `${parent}>${child}`;
        if (pcSeen.has(k)) continue;
        pcSeen.add(k);
        rel.push({ type: 'parent_child', parent, child, kind: link.kind || 'ruot', birth_order: link.order ?? null, private: !!(link.private || f.private) });
      }
    }
  }
  for (const r of rel) {
    if (relMode !== 'table') { counts.relations_pending++; out.relations.push({ ...r, status: 'pending' }); continue; }
    const same = r.type === 'couple' ? cpHave.has([r.a, r.b].sort().join('|') + '|' + r.kind) : pcHave.has(`${r.parent}>${r.child}`);
    if (same) counts.relations_same++; else counts.relations_new++;
    out.relations.push({ ...r, status: same ? 'same' : 'new' });
  }
  counts.sources = doc.persons.reduce((n, p) => n + p.sources.length, 0);
  counts.sources_new = newSources.size;
  out.newSources = [...newSources.values()];
  counts.stories_in_file = doc.persons.reduce((n, p) => n + p.stories, 0);
  return out;
}

// The branch of one person for export: the person, the blood descendants (parent-child kind ruot, down the line only),
// and the spouses of those people. Ancestors, siblings and adopted or step children are left out. pc / cp: relation rows.
function branchIds(rootId, pc = [], cp = []) {
  const kids = new Map();
  for (const r of pc) if (r.kind === 'ruot') { if (!kids.has(r.parent_id)) kids.set(r.parent_id, []); kids.get(r.parent_id).push(r.child_id); }
  const down = new Set([rootId]); const queue = [rootId];
  while (queue.length) {
    for (const c of kids.get(queue.shift()) || []) if (!down.has(c)) { down.add(c); queue.push(c); }
  }
  const set = new Set(down);
  for (const r of cp) {
    if (down.has(r.a_id) && !down.has(r.b_id)) set.add(r.b_id);
    else if (down.has(r.b_id) && !down.has(r.a_id)) set.add(r.a_id);
  }
  return set;
}

// A file name part that is plain ASCII: "Nguyễn Văn Ất" -> "nguyen-van-at". Falls back to "nhanh".
function asciiBase(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'nhanh';
}

module.exports = { parseGedDate, gedDateOut, readGedcom, buildExport, planImport, partsOf, personName, parseTree, dateFromText, dmyOut, yearOfIso,
  storyOf, LUNAR_PREFIX, GIO_PREFIX, EVEN_LABEL, CP_KINDS, PC_KINDS, branchIds, asciiBase };
