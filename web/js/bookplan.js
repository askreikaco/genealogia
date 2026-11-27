import { isDead } from './model.js';
import { listOf } from './contacts-model.js';
import { branchesOf, branchGen } from './branches.js';
// Book plan: the page list of the printed family book, computed from the person list alone (no DOM, no network).
// The server (GET /api/book/outline) and the browser (book.js) both import this module, so the page count and the
// numbering are the same wherever the book is built. Heights come from a text model, not from the DOM. The model
// overestimates (a page never clips its content; test/e2e/book-lazy.test.js checks it against the real layout).
// Pure: no DOM, no store. Keep it free of browser globals so Node can import it.

// ---- page geometry (px at the 842 px A4 reference; web/book.css .pg) ----
export const PAGE = { w: 842, h: 595, padX: 46, padT: 48, padB: 40 };
const BODY = 10.525; // .pg font-size
const LH = 1.5;
const GAP = 12; // .pg flex gap
const CHART_GAP = 8.02; // .chartpg gap
const FOOT_H = 18; // .foot: small line, padding, rule
const HEAD_H = 42.5; // h2.ch: 1.905em, line-height 1.5, padding-bottom .571em, border
const NOTE_H = BODY * LH; // one line of p.note
const CAP_H = 18; // figcaption inside a shelf figure
const CAP_CHAR_W = 6.4; // figcaption: sans, semi-bold, per character (conservative)
const SHELF_COL_GAP = 12.03; // .shelf column gap
const SHELF_ROW_GAP = 8.02; // .shelf row gap
const CW = 0.55; // mean glyph width in em, Vietnamese serif text (overestimates)

// Column geometry: flows are grids of equal columns (book.css .cols).
const COLS4_FS = 0.905 * BODY; // .cols.idx3 font size
// Khổ: landscape A4 (the reference page) or portrait A4 (595 x 842, same margins). Geometry of the page in use.
export const PAGES = { land: PAGE, port: { w: 595, h: 842, padX: 34, padT: 44, padB: 36 } };
const geoOf = (orient) => { const P = PAGES[orient] || PAGE; const CW = P.w - 2 * P.padX; const CH = P.h - P.padT - P.padB; return { CH, CW, COLS3: { n: 3, w: (CW - 2 * 2.095 * BODY) / 3 }, COLS4: { n: 4, w: (CW - 3 * 1.524 * COLS4_FS) / 4 } }; };
let GEO = geoOf('land'); // the page in use: set at the start of planBook (the planner is synchronous)

// ---- pure helpers (same rules as the book) ----
export const rank = (d) => (d.sex === 'f' ? 'Bà' : 'Ông') + (d.thu ? ' ' + d.thu : '');
export const years = (d) => (d.born && d.died ? `${d.born}–${d.died}` : d.born ? `sinh ${d.born}` : d.died ? `mất ${d.died}` : '');
export const relation = (M, p) => { const q = M.byId.get(p.data.parent); return q ? `con ${q.data.sex === 'f' ? 'bà' : 'ông'} ${q.data.name}` : ''; };
export function gioOf(d) {
  const s = d.gio_lunar || d.death_lunar; if (!s) return null;
  const [dd, mm] = s.split('/').map((x) => parseInt(x, 10));
  return dd && mm ? { d: dd, m: mm, label: s } : null;
}

// Family structure from the flat list (same rules as model.js build(); kept here so the server can run it).
// all: persons of one family, not deleted, with data. Bloodline = persons without spouse_of.
export function bookModel(input, cfg = null) {
  // canonical order by id: the plan must not depend on the order rows came back in
  const all = input.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ps = all.filter((p) => !p.data.spouse_of);
  const byId = new Map(all.map((p) => [p.id, p]));
  const kids = new Map();
  for (const p of ps) { const k = p.data.parent || ''; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(p); }
  const ord = (p) => p.data.order ?? 1e9;
  for (const arr of kids.values()) arr.sort((a, b) => ord(a) - ord(b));
  const roots = (kids.get('') || []).concat(ps.filter((p) => p.data.parent && !byId.has(p.data.parent)));
  const reg = new Map(); const desc = new Map();
  const hasEntry = (p) => { const d = p.data; return (kids.get(p.id) || []).length || d.spouse || d.born || d.died || d.death_lunar || d.gio_lunar || d.place || d.alias || d.note || d.verify || d.photo; };
  const queue = roots.slice();
  let n = 0;
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]; if (hasEntry(p)) reg.set(p.id, ++n);
    for (const c of kids.get(p.id) || []) queue.push(c);
  }
  const countDesc = (id) => { if (desc.has(id)) return desc.get(id); let s = 0; for (const c of kids.get(id) || []) s += 1 + countDesc(c.id); desc.set(id, s); return s; };
  for (const p of ps) countDesc(p.id);
  const texts = new Map(all.map((p) => [p.id, { st: p.st || [] }]));
  const M = { ps, all, byId, kids: (id) => kids.get(id) || [], roots, reg, desc: (id) => desc.get(id) || 0, generations: queue, texts };
  // Register numbering: every entry has a number (#N) and its children point to theirs; the head also points back to
  // the parent's entry ("con của #P") when the parent has one. book.js prints it, so the head height counts it.
  M.preg = new Map(); for (const p of ps) { const r = reg.get(p.data.parent); if (r && reg.has(p.id)) M.preg.set(p.id, r); }
  return M;
}

// ---- chart geometry (bookchart.js renders the same boxes) ----
const BW = 132, BH = 44, HG = 16, VG = 30, IND = 18, SG = 6;
const MIN_SCALE = 0.72, MAX_SCALE = 1.5;
// Chart box height on a chart page: the page minus its heading, optional note, caption-free footer and gaps.
export const chartBoxH = (hasNote) => GEO.CH - HEAD_H - (hasNote ? NOTE_H : 0) - FOOT_H - CHART_GAP * (hasNote ? 3 : 2);

function layout(M, root, maxDepth) {
  const nodes = []; const paths = [];
  const vis = (p, d) => (d < maxDepth ? M.kids(p.id) : []);
  const meas = new Map();
  const measure = (p, d) => {
    const ks = vis(p, d); let r;
    if (!ks.length) r = { w: BW, h: BH, stack: false };
    else if (ks.every((c) => !vis(c, d + 1).length)) { ks.forEach((c) => meas.set(c.id, { w: BW, h: BH, stack: false })); r = { w: IND + BW, h: BH + SG + ks.length * (BH + SG), stack: true }; }
    else { const cs = ks.map((c) => measure(c, d + 1)); r = { w: Math.max(BW, cs.reduce((a, c) => a + c.w, 0) + HG * (cs.length - 1)), h: BH + VG + Math.max(...cs.map((c) => c.h)), stack: false }; }
    meas.set(p.id, r); return r;
  };
  const draw = (p, d, x, y) => {
    const m = meas.get(p.id); const ks = vis(p, d);
    const bx = m.stack ? x : x + (m.w - BW) / 2;
    nodes.push({ p, x: bx, y, cut: !ks.length && M.kids(p.id).length > 0 });
    if (!ks.length) return;
    if (m.stack) {
      let cy = y + BH + SG; const lx = bx + 8;
      ks.forEach((c) => { draw(c, d + 1, x + IND, cy); paths.push(`M${lx} ${cy + BH / 2}H${x + IND}`); cy += BH + SG; });
      paths.push(`M${lx} ${y + BH}V${cy - SG - BH / 2}`);
    } else {
      let cx = x + (m.w - (ks.reduce((a, c) => a + meas.get(c.id).w, 0) + HG * (ks.length - 1))) / 2;
      const top = y + BH + VG; const my = y + BH + VG / 2; const px = bx + BW / 2;
      const centers = [];
      ks.forEach((c) => { const cm = meas.get(c.id); draw(c, d + 1, cx, top); centers.push(cm.stack ? cx + 8 : cx + cm.w / 2); cx += cm.w + HG; });
      paths.push(`M${px} ${y + BH}V${my}`);
      paths.push(`M${Math.min(px, ...centers)} ${my}H${Math.max(px, ...centers)}`);
      centers.forEach((c) => paths.push(`M${c} ${my}V${top}`));
    }
  };
  const m = measure(root, 0); draw(root, 0, 0, 0);
  return { nodes, paths, w: m.w, h: m.h };
}
// Scale that fits a layout in the box of its sheet (with or without a note line).
const fitScale = (L, hasNote, maxW = GEO.CW) => Math.min(MAX_SCALE, maxW / L.w, chartBoxH(hasNote) / L.h);

// Deepest view of root that is still readable on one sheet.
function best(M, root) {
  let L = layout(M, root, 1);
  for (let d = 2; d < 30; d++) {
    const T = layout(M, root, d);
    if (fitScale(T, T.nodes.some((n) => n.cut)) < MIN_SCALE) break;
    L = T; if (!T.nodes.some((n) => n.cut)) break;
  }
  return L;
}

// Chart sheets in reading order. A sheet is {title, note, shelf, figs:[{root, title, L, s}], overview?, toc?}.
// Small sub-branch charts are shelf-packed (rows side by side) into as few sheets as the box allows.
function chartSheets(M, scope) {
  const sheets = [];
  if (!scope) {
    const top = M.roots[0]; const L = layout(M, top, 3);
    const note = 'Ô có "+N người · tr." còn con cháu: xem sơ đồ chi tiết ở trang đó.';
    sheets.push({ title: 'Cây gia phả tổng hợp (đời 1 – 4)', note, shelf: false, overview: true, figs: [{ root: top.id, title: '', L, s: fitScale(L, true) }] });
  }
  const starts = scope ? [scope] : branchesOf(M);
  for (const b of starts) {
    const charts = [];
    const add = (root, title) => {
      const L = best(M, root);
      charts.push({ root: root.id, title, L, cut: L.nodes.some((n) => n.cut) });
      for (const n of L.nodes) if (n.cut) { const par = M.byId.get(n.p.data.parent); add(n.p, `Nhánh ${rank(n.p.data)} ${n.p.data.name}` + (par ? ` · con ${par.data.name}` : '')); }
    };
    add(b, `Tông chi ${rank(b.data)} ${b.data.name}`);
    const [head, ...rest] = charts;
    sheets.push({ title: head.title, note: head.cut ? 'Nhánh lớn được tách: ô có "tr." tiếp ở trang ghi bên.' : '', shelf: false, figs: [{ root: head.root, title: '', L: head.L, s: fitScale(head.L, head.cut) }], branch: b.id });
    // shelf: figures left to right, rows top to bottom, a new sheet when the box is full
    const areaH = chartBoxH(false);
    let sheet = null; let rows = [];
    const used = () => rows.reduce((a, r) => a + r.h, 0) + SHELF_ROW_GAP * Math.max(0, rows.length - 1);
    const newSheet = () => { sheet = { title: `Tông chi ${rank(b.data)} ${b.data.name} · các nhánh`, note: '', shelf: true, figs: [], branch: b.id }; rows = []; sheets.push(sheet); };
    for (const c of rest) {
      const s = Math.min(1, GEO.CW / c.L.w, (areaH - CAP_H) / c.L.h);
      // a figure is as wide as its caption (measured: 6.1 px per character at 9 px sans) or its drawing
      const w = Math.min(GEO.CW, Math.max(c.L.w * s, c.title.length * CAP_CHAR_W)); const h = c.L.h * s + CAP_H;
      const fig = { root: c.root, title: c.title, L: c.L, s };
      if (!sheet) newSheet();
      const cur = rows[rows.length - 1];
      if (cur && cur.w + SHELF_COL_GAP + w <= GEO.CW && used() - cur.h + Math.max(cur.h, h) <= areaH) { cur.w += SHELF_COL_GAP + w; cur.h = Math.max(cur.h, h); cur.figs.push(fig); }
      else {
        if (!(used() + (rows.length ? SHELF_ROW_GAP : 0) + h <= areaH)) newSheet(); // no room below: next sheet
        rows.push({ w, h, figs: [fig] });
      }
      sheet.figs = rows.flatMap((r, i) => (i ? [{ br: true }] : []).concat(r.figs));
    }
  }
  return sheets;
}

// ---- entries: height model (px) ----
const wrapH = (px, w, fs) => Math.max(1, Math.ceil(px / w)) * fs * LH;
const textPx = (chars, fs) => chars * CW * fs;

// Height of one entry (book.js entry()): heading, facts, spouse, note, children, contact, flag, flex gaps, rule.
// Mentions in a story: a person's full name (two or more words) that is unique in the family, matched accent-insensitively
// on whole words. Ambiguous names are never linked. No explicit links exist in the data (stories are plain text).
const fold1 = (w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
function nameIndex(M) {
  if (M.nameIdx) return M.nameIdx;
  const idx = new Map();
  for (const p of M.all) {
    const n = p.data?.name; if (!n || n.startsWith('(')) continue;
    const words = n.match(/[\p{L}\p{N}]+/gu) || []; if (words.length < 2) continue;
    const key = words.map(fold1).join(' ');
    if (!idx.has(key)) idx.set(key, []); idx.get(key).push(p.id);
  }
  M.nameIdx = idx; return idx;
}
export function mentionsIn(M, text, selfId) {
  const idx = nameIndex(M);
  const toks = [...String(text).matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ w: fold1(m[0]), a: m.index, b: m.index + m[0].length }));
  const used = new Array(toks.length).fill(false); const out = [];
  const names = [...idx.keys()].sort((x, y) => y.split(' ').length - x.split(' ').length);
  for (const key of names) {
    const ids = idx.get(key); if (ids.length !== 1) continue; // ambiguous: not linked
    const id = ids[0]; if (id === selfId) continue;
    const k = key.split(' ');
    for (let i = 0; i + k.length <= toks.length; i++) {
      if (used.slice(i, i + k.length).some(Boolean)) continue;
      if (!k.every((w, j) => toks[i + j].w === w)) continue;
      for (let j = 0; j < k.length; j++) used[i + j] = true;
      const reg = M.reg.get(id);
      if (reg != null) out.push({ a: toks[i].a, b: toks[i + k.length - 1].b, id, reg });
    }
  }
  return out.sort((x, y) => x.a - y.a);
}

// ---- entry pieces: the master entry layout, split so that a long entry continues in more items (story text only) ----
// Pieces in print order: head (number, name, facts, spouse, note), story paragraphs, child lines, tail (contact, verify).
// Items are packed no taller than ITEM_CAP; the parts of one entry stack in consecutive items (the last one carries the rule).
const ECW = 0.72; // story text is measured wide (fallback serif runs wider than the page text): a safe overestimate
const ST_FS = 9.82; // story paragraphs: the same size as the facts lines (.ln)
const piece = (k, v, h) => ({ k, v, h });
const splitFor = (text, w, cap) => {
  const maxChars = Math.max(20, Math.floor((cap - 2) / (ST_FS * LH)) * Math.floor(w / (ECW * ST_FS)));
  const out = [];
  for (const sent of String(text).split(/(?<=[.!?…])\s+/).filter(Boolean)) {
    if (wrapH(etextPx(sent.length, ST_FS), w, ST_FS) + 2 <= cap) { out.push(sent); continue; }
    let cur = '';
    for (const word of sent.split(' ')) { if ((cur + ' ' + word).trim().length > maxChars) { out.push(cur); cur = word; } else cur = (cur + ' ' + word).trim(); }
    if (cur) out.push(cur);
  }
  return out;
};
const etextPx = (c, fs) => c * ECW * fs;
export const ITEM_CAP = () => GEO.CH * 0.7; // no item taller than this: fits any column with its running room
// the paragraphs of a person's text after the facts: the saved summary (Câu chuyện đời) first, then the stories in order
// Spouse records (spouse_of = the partner's id) are persons too: found by search and listed in the index under the partner's
// number. Their own data (dates, place, stories) is printed under the partner's Vợ/Chồng line when there is any.
export function spousesOf(M, id) {
  if (!M.spIdx) { M.spIdx = new Map(); for (const q of M.all) { const sp = q.data.spouse_of; if (sp) { if (!M.spIdx.has(sp)) M.spIdx.set(sp, []); M.spIdx.get(sp).push(q); } } }
  return M.spIdx.get(id) || [];
}
const hasOwnData = (M, q) => !!(q.data.born || q.data.died || q.data.place || q.data.alias || q.data.job || (M.texts?.get(q.id)?.st || []).length);
const spouseLine = (q) => `${q.data.name || ''}${years(q.data) ? ' (' + years(q.data) + ')' : ''}${q.data.place ? ' · ' + q.data.place : ''}`;
export function storiesOfId(M, id) {
  const T = M.texts?.get(id);
  const all = T?.st || [];
  const paras = (x) => String(x.body || '').split(/\n\s*\n/).map((q) => q.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  return [...all.filter((x) => x.kind === 'tom_tat').flatMap(paras), ...all.filter((x) => x.kind !== 'tom_tat').flatMap(paras)];
}
export const storiesOf = (M, p) => storiesOfId(M, p.id);
export function entryPieces(M, p) {
  const d = p.data; const ks = M.kids(p.id); const W = GEO.COLS3.w; const cap = ITEM_CAP();
  const hasPhoto = !!d.photo; const out = [];
  let h = Math.max(hasPhoto ? 6.476 * BODY : 0, 18, wrapH(textPx((d.name || '').length + rank(d).length + 2, BODY) + (M.preg?.get(p.id) ? textPx(String(M.preg.get(p.id)).length + 10, 0.85 * BODY) : 0), W - (hasPhoto ? 5.143 * BODY : 0), BODY));
  if (d.sid) h += wrapH(textPx(String(d.sid).length + 4, 0.85 * BODY), W - (hasPhoto ? 5.143 * BODY : 0), 0.85 * BODY); // the code line under the name (book.js .eh .sid)
  let parts = 1;
  const died = [d.died, d.death_lunar ? d.death_lunar + ' ÂL' : ''].filter(Boolean).join(' · ');
  const facts = [['Sinh', d.born], ['Mất', died], ['Giỗ', d.gio_lunar && d.gio_lunar !== d.death_lunar ? d.gio_lunar + ' ÂL' : ''], ['Sống ở', d.place], ['Tên khác', d.alias], ['Nghề', d.job], ['Đạo', d.religion], ['An táng', d.burial]].filter((f) => f[1]);
  if (facts.length) { const px = facts.reduce((a, [k, v]) => a + textPx(k.length * 0.8 + 1 + String(v).length, 9.82) + 10, 0); h += wrapH(px, W, 9.82); parts++; }
  if (d.spouse) { const px = textPx(String((d.sex === 'f' ? 'Chồng' : 'Vợ') + ' ' + d.spouse + (d.married ? ', cưới ' + d.married : '')).length, 9.82); h += wrapH(px, W, 9.82); parts++; }
  if (d.note) { h += wrapH(textPx(String(d.note).length, 9.82), W, 9.82); parts++; }
  out.push(piece('head', null, h + 2 * (parts - 1)));
  const sps = M.spousesOn === false ? [] : spousesOf(M, p.id).filter((q) => hasOwnData(M, q));
  for (const q of sps) out.push(piece('sp', q.id, wrapH(etextPx(spouseLine(q).length, ST_FS), W, ST_FS) + 2));
  for (const q of storiesOf(M, p)) for (const x of splitFor(q, W, cap)) out.push(piece('st', { t: x, m: mentionsIn(M, x, p.id) }, wrapH(etextPx(x.length, ST_FS), W, ST_FS) + 2 + 0.3 * ST_FS));
  for (const sp of sps) for (const para of storiesOfId(M, sp.id)) for (const x of splitFor(para, W, cap)) out.push(piece('st', { t: x, m: mentionsIn(M, x, sp.id) }, wrapH(etextPx(x.length, ST_FS), W, ST_FS) + 2 + 0.3 * ST_FS));
  ks.forEach((c) => {
    const t = `${rank(c.data)} ${c.data.name}${years(c.data) ? ' (' + years(c.data) + ')' : ''}`;
    out.push(piece('kid', { id: c.id, xr: M.reg.has(c.id) && M.kids(c.id).length ? M.reg.get(c.id) : null }, wrapH(textPx(t.length + (M.reg.has(c.id) && M.kids(c.id).length ? 4 : 2), 9.82), W - 9, 9.82) + 2));
  });
  const contact = listOf(d).filter((c) => ['phone', 'email', 'zalo', 'facebook'].includes(c.type)).map((c) => (c.type === 'zalo' ? 'Zalo ' + c.value : c.value)).join(' · ');
  let tail = 0;
  if (contact) tail += wrapH(textPx(contact.length, 9.02), W, 9.02) + 2;
  if (d.verify) tail += wrapH(textPx(('Cần xác minh: ' + d.verify).length, 8.02), W, 8.02) + 2;
  out.push(piece('tail', null, tail));
  return out;
}
// Items of one entry: pieces packed in order; the rule and the space below come with the last item.
export function entryItems(M, p) {
  const groups = []; let cur = []; let curH = 0; const cap = ITEM_CAP();
  for (const pc of entryPieces(M, p)) {
    if (cur.length && curH + pc.h > cap) { groups.push(cur); cur = []; curH = 0; }
    cur.push(pc); curH += pc.h;
  }
  if (cur.length) groups.push(cur);
  return groups.map((g, i) => {
    const last = i === groups.length - 1;
    const kids = g.filter((x) => x.k === 'kid').map((x) => x.v);
    const has = (k) => g.some((x) => x.k === k);
    const txt = { head: has('head') || i === 0, tail: has('tail'), more: !last, st: g.filter((x) => x.k === 'st').map((x) => x.v), sp: g.filter((x) => x.k === 'sp').map((x) => x.v), sa: i === 0 && M.spousesOn !== false ? spousesOf(M, p.id).map((q) => q.id) : [] };
    const h = g.reduce((a, x) => a + x.h, 0) * ENTRY_K + (last ? ENTRY_PAD : 0);
    return { t: 'entry', id: p.id, reg: i === 0 ? M.reg.get(p.id) || null : null, cont: i > 0, kids: kids.map((k) => ({ id: k.id, xr: k.xr })), txt, h };
  });
}
export function entryHeight(M, p) { return entryItems(M, p).reduce((a, it) => a + it.h, 0); }
export const ENTRY_K = 1.04, ENTRY_PAD = 8.02 * 2 + 0.5 + 0.5; // measured: padding + margin + rule (Chrome, 1280 px)
const genhH = () => 34.5; // .genh with its margin in a column (measured 34.2)
// One index / verify / calendar row (.ie): name, a dotted rule and a number.
const ieH = (chars, colW, fs) => wrapH(textPx(chars, fs), colW - 40, fs) + 0.5; // measured: one row = one line of text

// Column flow: items {t, h, ...} placed into the columns of a page, head only on the first page.
// A column breaks before an item that does not fit; a genh heading never ends a column (it moves with the item).
function flowPages(b) {
  const pages = []; const { ncols } = b;
  const open = (first) => {
    const parts = first && b.head ? b.head.parts : [];
    const used = parts.reduce((a, x) => a + x, 0);
    const H = GEO.CH - FOOT_H - used - GAP * (parts.length + 1);
    const P = { H, cols: Array.from({ length: ncols }, () => ({ items: [], h: 0 })), head: first ? b.head : null };
    pages.push(P); return P;
  };
  let P = open(true); let c = 0;
  if (!b.items.length) return pages;
  for (const it of b.items) {
    for (;;) {
      const col = P.cols[c];
      if (!col.items.length || col.h + it.h <= P.H) { col.items.push(it); col.h += it.h; break; }
      let carry = null;
      if (col.items.length > 1 && col.items.at(-1).t === 'genh') { carry = col.items.pop(); col.h -= carry.h; }
      if (c + 1 < ncols) { c++; if (carry) { P.cols[c].items.push(carry); P.cols[c].h += carry.h; } continue; }
      P = open(false); c = 0;
      if (carry) { P.cols[0].items.push(carry); P.cols[0].h += carry.h; }
    }
  }
  return pages;
}

// The whole book as one page list. chi: a branch (person id) or '' for the whole family.
// opts: { root, dir: 'down'|'up'|'both', maxGen, spouses, daughters: 'full'|'name', status: 'all'|'living'|'dead' }.
// A string is the root id (older callers). Charts and the branch flows follow the descendants of the root; 'up' and 'both'
// print one flow of the people in scope (no charts), and the chart pages are left out whenever a filter narrows the set.
export function planBook(M, opts = '') {
  const o = typeof opts === 'string' ? { root: opts } : (opts || {});
  GEO = geoOf(o.orient === 'port' ? 'port' : 'land');
  const scope = (o.root && M.byId.get(o.root)) || null;
  const dir = scope && (o.dir === 'up' || o.dir === 'both') ? o.dir : 'down';
  const maxGen = Number(o.maxGen) || 0;
  const spouses = o.spouses !== false;
  M.spousesOn = spouses;
  const nameOnly = o.daughters === 'name';
  // layout (Kiểu gia phả): branch = by branch (default), gen = one flow by generation, summary = charts and the name index only
  const layout = o.layout === 'gen' || o.layout === 'summary' ? o.layout : 'branch';
  const status = o.status === 'living' || o.status === 'dead' ? o.status : 'all';
  const gen = (p) => p.data.gen || 0;
  const under = (p) => { if (!scope) return true; let q = p; while (q) { if (q.id === scope.id) return true; q = M.byId.get(q.data.parent); } return false; };
  const over = (p) => { if (!scope) return false; let q = scope; while (q) { if (q.id === p.id) return true; q = M.byId.get(q.data.parent); } return false; };
  const relGen = (p) => (scope ? gen(p) - gen(scope) : gen(p));
  const inDir = (p) => (!scope ? true : dir === 'up' ? over(p) : dir === 'both' ? under(p) || over(p) : under(p));
  const inGen = (p) => {
    if (!maxGen) return true;
    const r = relGen(p);
    if (!scope) return r <= maxGen;
    return dir === 'up' ? -r < maxGen : dir === 'both' ? Math.abs(r) < maxGen : r >= 0 && r < maxGen;
  };
  // "Con cháu của con gái": a daughter is listed, her own descendants are not continued
  const behindDaughter = (p) => { if (!nameOnly || !under(p) || p === scope) return false; let q = M.byId.get(p.data.parent); while (q && (!scope || q.id !== scope.id)) { if (q.data.sex === 'f') return true; q = M.byId.get(q.data.parent); } return false; };
  const inStatus = (p) => status === 'all' || (status === 'dead' ? isDead(p.data) : !isDead(p.data));
  const spouseCut = (p) => (spouses ? p : { ...p, data: { ...p.data, spouse: '', married: '' } });
  const people = M.generations.filter((p) => inDir(p) && inGen(p) && !behindDaughter(p) && inStatus(p)).map(spouseCut);
  // everyone in scope counts, married-in people (spouse_of) included when their spouse is in scope and spouses are on
  const peopleIds = new Set(people.map((p) => p.id));
  const scopeCount = people.length + (spouses ? M.all.filter((p) => p.data.spouse_of && peopleIds.has(p.data.spouse_of)).length : 0);
  const narrowed = !!scope || !!maxGen || nameOnly || status !== 'all';
  const flat = layout === 'gen' || (!!scope && dir !== 'down');
  const chartsOn = dir === 'down' && !maxGen && !nameOnly && status === 'all';
  const root = M.roots[0] || null;
  const blocks = [];
  const fixed = (o) => blocks.push({ fixed: true, ...o });

  fixed({ kind: 'cover', cls: 'cv', run: '', ids: [root, scope].filter(Boolean).map((p) => p.id), gen: Math.max(0, ...people.map((p) => p.data.gen || 0)), people: narrowed ? scopeCount : M.all.length, scope: !!scope });
  fixed({ kind: 'lead', cls: '', run: 'Gia phả họ Dương', toc: 'Lời đầu sách', ids: root ? [root.id] : [] });

  for (const s of (chartsOn ? chartSheets(M, scope) : [])) {
    const lvl = !!s.overview || (/^Tông chi/.test(s.title) && !/các nhánh$/.test(s.title));
    fixed({ kind: 'chart', cls: 'chartpg', run: 'Cây gia phả', toc: lvl ? s.title : '', title: s.title, note: s.note, shelf: s.shelf, figs: s.figs.map((f) => ({ ...f, nodes: f.br ? null : f.L.nodes.map((n) => ({ id: n.p.id, x: n.x, y: n.y, cut: n.cut, desc: M.desc(n.p.id), ref: null })) })), chartIds: s.figs.filter((f) => !f.br).map((f) => f.root) });
  }

  // entries: generations 1-3 first, then one flow per branch by generation
  const early = people.filter((p) => (p.data.gen || 0) <= 3 && M.reg.has(p.id));
  const entryItem = (p) => entryItems(M, p);
  if (flat) {
    const items = []; let g = 0;
    for (const p of people.slice().sort((x, y) => (gen(x) - gen(y)) || ((M.reg.get(x.id) ?? 1e9) - (M.reg.get(y.id) ?? 1e9)))) {
      if (gen(p) !== g) { g = gen(p); items.push({ t: 'genh', g, h: genhH() }); }
      items.push(...entryItem(p));
    }
    blocks.push({ fixed: false, items, head: null, run: dir === 'up' ? 'Tổ tiên' : 'Tổ tiên và hậu duệ', toc: dir === 'up' ? 'Tổ tiên' : 'Tổ tiên và hậu duệ', cls: '', ncols: GEO.COLS3.n });
  }
  if (early.length && layout === 'branch' && (!scope || gen(scope) < 3)) blocks.push({ fixed: false, items: early.flatMap(entryItem), head: { type: 'early', parts: [HEAD_H] }, run: 'Đời 1 – 3', toc: 'Đời 1 – 3', cls: '', ncols: GEO.COLS3.n });
  const inPeople = new Set(people.map((p) => p.id));
  const branches = flat || layout === 'summary' ? [] : scope ? (gen(scope) < branchGen(M.branchCfg, scope, M) ? branchesOf(M).filter((p) => inPeople.has(p.id)) : [scope]) : branchesOf(M, M.branchCfg, { all: true });
  for (const b of branches) {
    const mem = people.filter((p) => p.id !== b.id && gen(p) > gen(b) && M.reg.has(p.id) && (() => { let q = p; while (q && q.id !== b.id) q = M.byId.get(q.data.parent); return !!q; })());
    const parent = M.byId.get(b.data.parent) || null;
    fixed({ kind: 'opener', cls: 'op', run: `Tông chi ${rank(b.data)} · ${b.data.name}`, toc: `Tông chi ${rank(b.data)} ${b.data.name}`, branch: b.id, parent: parent?.id || null, ids: [b.id, parent?.id].filter(Boolean), kids: M.kids(b.id).length, desc: M.desc(b.id) });
    if (!mem.length) continue;
    const items = []; let g = 0;
    for (const p of mem.sort((x, y) => (x.data.gen - y.data.gen) || (M.reg.get(x.id) - M.reg.get(y.id)))) {
      if (p.data.gen !== g) { g = p.data.gen; items.push({ t: 'genh', g, h: genhH() }); }
      items.push(...entryItem(p));
    }
    blocks.push({ fixed: false, items, head: null, run: `Tông chi ${rank(b.data)} · ${b.data.name}`, toc: '', cls: '', ncols: GEO.COLS3.n });
  }

  // giỗ calendar (rows in lunar-month order)
  const gs = people.map((p) => ({ p, g: gioOf(p.data) })).filter((x) => x.g).sort((a, b) => a.g.m - b.g.m || a.g.d - b.g.d);
  if (layout !== 'summary') blocks.push({ fixed: false, items: gs.map(({ p, g }) => ({ t: 'gio', id: p.id, pid: p.data.parent || null, label: g.label, h: ieH(`${rank(p.data)} ${p.data.name} · Đời ${p.data.gen} · ${relation(M, p)}`.length, GEO.COLS3.w, BODY) })), head: { type: 'gio', count: gs.length, parts: [HEAD_H, NOTE_H] }, run: 'Phụ lục', toc: 'Lịch giỗ âm lịch', cls: '', ncols: GEO.COLS3.n });

  // index by the last word of the name
  const spRows = spouses ? people.flatMap((p) => spousesOf(M, p.id).filter((q) => !(q.data.name || '').startsWith('(')).map((q) => ({ q, target: p.id }))) : [];
  const idx = [...people.filter((p) => !p.data.name.startsWith('(')).map((p) => ({ q: p, target: null })), ...spRows]
    .sort((a, b) => a.q.data.name.split(' ').pop().localeCompare(b.q.data.name.split(' ').pop(), 'vi') || a.q.data.name.localeCompare(b.q.data.name, 'vi'));
  let cur = ''; const it = [];
  for (const { q, target } of idx) {
    if (q.data.hidden_living && !q.data.name) continue; // a living person (non-member view) has no name to index
    const L = q.data.name.split(' ').pop()[0].toUpperCase();
    if (L !== cur) { cur = L; it.push({ t: 'il', L, h: 21 }); }
    // a spouse's row shows the partner's entry number, linked to the partner's entry
    it.push({ t: 'ie', id: q.id, reg: M.reg.get(target || q.id) || null, target, h: ieH(q.data.name.length + 4 + (q.data.sid ? 8 : 0), GEO.COLS4.w, COLS4_FS) }); // 8: the code (.pcode) after the name
  }
  blocks.push({ fixed: false, items: it, head: { type: 'index', parts: [HEAD_H, NOTE_H] }, run: 'Phụ lục', toc: 'Tra tên theo vần', cls: 'idx3', ncols: GEO.COLS4.n });

  // what needs verification
  const vf = people.filter((p) => p.data.verify);
  if (layout !== 'summary') blocks.push({ fixed: false, items: vf.map((p) => ({ t: 've', id: p.id, reg: M.reg.get(p.id) || null, h: ieH(`${rank(p.data)} ${p.data.name}: ${p.data.verify}`.length, GEO.COLS3.w, BODY) })), head: { type: 'verify', count: vf.length, parts: [HEAD_H, NOTE_H] }, run: 'Phụ lục', toc: 'Cần bổ sung, xác minh', cls: '', ncols: GEO.COLS3.n });

  // ---- numbering: fixed pages are one page each; flows fill pages ----
  const pages = []; const toc = []; const chartAt = new Map();
  const push = (pg) => { pg.n = pages.length + 1; pages.push(pg); return pg; };
  for (const b of blocks) {
    if (b.fixed) {
      const { fixed, ...page } = b;
      const pg = push(page);
      if (pg.toc) toc.push([pg.toc, pg.n]);
      if (pg.kind === 'chart') for (const x of pg.chartIds) chartAt.set(x, pg.n);
      continue;
    }
    const flow = flowPages(b);
    flow.forEach((P, i) => {
      const pg = push({ kind: 'flow', cls: b.cls, run: b.run, ncols: b.ncols, head: P.head ? headOut(P.head) : null, cols: P.cols.map((col) => col.items.map(itemOut)) });
      if (i === 0 && b.toc) toc.push([b.toc, pg.n]);
    });
  }
  // cut charts point at the page of their nearest charted ancestor
  for (const pg of pages) if (pg.kind === 'chart') for (const f of pg.figs) if (f.nodes) for (const nd of f.nodes) if (nd.cut) {
    let q = M.byId.get(nd.id); while (q && !chartAt.has(q.id)) q = M.byId.get(q.data.parent);
    nd.ref = q ? chartAt.get(q.id) : null;
  }
  for (const pg of pages) finish(pg);

  return {
    v: 1,
    root: root ? { id: root.id } : null,
    scope: scope ? scope.id : null,
    branches: branchesOf(M, M.branchCfg, { all: true }).map((p) => ({ id: p.id, label: `Chi ${rank(p.data)} ${p.data.name}` })),
    pages,
    toc,
    totals: { people: M.all.length, generations: Math.max(0, ...M.generations.map((p) => p.data.gen || 0)), scopePeople: scopeCount },
  };
}

function headOut(h) {
  if (h.type === 'gio') return { type: 'gio', count: h.count };
  if (h.type === 'verify') return { type: 'verify', count: h.count };
  return { type: h.type };
}
// A flow item as the client renders it (ids: persons the item needs).
function itemOut(it) {
  if (it.t === 'entry') return [1, it.id, it.reg, it.kids.map((k) => [k.id, k.xr]), it.txt];
  if (it.t === 'genh') return [2, it.g];
  if (it.t === 'gio') return [3, it.id, it.pid, it.label];
  if (it.t === 'il') return [4, it.L];
  if (it.t === 'ie') return [5, it.id, it.reg, it.target || null];
  if (it.t === 've') return [6, it.id, it.reg];
  throw new Error('unknown item ' + it.t);
}
// Serialise a page for the client: the persons it needs (ids) and, for charts, plain arrays instead of objects.
function finish(pg) {
  if (pg.kind === 'flow') {
    const ids = new Set();
    for (const col of pg.cols) for (const it of col) {
      if (it[0] === 1) { ids.add(it[1]); for (const k of it[3]) ids.add(k[0]); for (const x of [...(it[4]?.sp || []), ...(it[4]?.sa || [])]) ids.add(x); }
      else if (it[0] === 3) { ids.add(it[1]); if (it[2]) ids.add(it[2]); }
      else if (it[0] === 5 || it[0] === 6) ids.add(it[1]);
    }
    pg.ids = [...ids];
  } else if (pg.kind === 'chart') {
    const ids = new Set(pg.chartIds);
    for (const f of pg.figs) if (f.nodes) for (const nd of f.nodes) ids.add(nd.id);
    pg.ids = [...ids];
    pg.figs = pg.figs.map((f) => (f.br ? { br: true } : { root: f.root, title: f.title, w: f.L.w, h: f.L.h, s: f.s, paths: f.L.paths.join(''), nodes: f.nodes.map((nd) => [nd.id, nd.x, nd.y, nd.cut ? 1 : 0, nd.desc, nd.ref]) }));
    delete pg.chartIds;
  }
}
