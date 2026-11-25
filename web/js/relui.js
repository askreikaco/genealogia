// Relationship UI: profile section "Quan hệ", add sheet (3 steps), edit sheet with remove, pedigree with collapse.
// Data: store.relOf(family) (server rows for this viewer) + relgraph.js (pure rules). Icons are plain line icons (no Hán).
import * as S from './store.js';
import { esc, rank, years, isDead } from './model.js';
import { index, siblingsOf, descendantLevels, pedigreeRows, ancestorChain, coupleNotes, PC_LABEL, CP_LABEL, PC_KINDS, CP_KINDS } from './relgraph.js';
import { kinPath, lineDesc, term as kinTerm, resolveRegion, KIN_REGION_KEY } from './kin/index.js';
import { calmRow, calmAct, popMenu, cic, surnameTile, surnameOf, ghostRow, moreFold, toolbar, ltags, fpanel, addBtn, setUntag, sheet as openDialog, KEEP } from './ui.js';
import { relPrefill, nextOrder } from './prefill.js';
import { personItem } from './person-item.js';
import { dangerButton, dangerZone, dangerItem, dangerLabel, confirmDanger, undoToast, restoreTrash } from './danger.js';

const cache = new WeakMap();
// The partners of a person (ids, in order) as the viewer sees them.
const partnersOf = (M, id) => (relsOf(M).ix.partnersOf.get(id) || []).map((x) => x.other);
// Combined rows of every family on screen (ids are global person ids; each row keeps its family).
function relsOf(M) {
  if (cache.has(M)) return cache.get(M);
  const fams = [...new Set(M.all.map((p) => p.fam || 'duong'))];
  const pc = []; const cp = []; let source = 'table';
  for (const f of fams) { const r = S.relOf(f); if (r.source !== 'table') source = 'legacy'; pc.push(...r.parent_child); cp.push(...r.couple); }
  const v = { source, pc, cp, ix: index(pc, cp), editable: source === 'table' };
  cache.set(M, v); return v;
}
const fold = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');
const sexOf = (M) => (id) => M.byId.get(id)?.data.sex || '';
// Kinship labels: sex and birth year of each person; region = the user's 'Cách gọi' choice (standard unless set to Miền Nam).
const kinOpts = (M) => ({ sex: sexOf(M), year: (x) => Number(M.byId.get(x)?.data.born) || null });
const kinRegion = () => {
  let pref = 'chuan';
  try { pref = localStorage.getItem(KIN_REGION_KEY) || 'chuan'; } catch { /* private window: standard */ }
  return resolveRegion(pref);
};
const gTitle = (g, region) => kinTerm(lineDesc(0, g), { locale: 'vi', region });
const pname = (M, id) => M.byId.get(id)?.data.name || '(chưa có tên)';
const roleTo = (sex) => (sex === 'f' ? 'Mẹ' : sex === 'm' ? 'Cha' : 'Cha/Mẹ');
const spouseWord = (sex) => (sex === 'f' ? 'Vợ' : sex === 'm' ? 'Chồng' : 'Bạn đời');
const rowKey = (r) => `${r.fam || 'duong'}|${r.id}|${r.parent_id ? 'pc' : 'cp'}`;
const keyMap = new Map();
const canEdit = (fam) => S.can(S.roleIn(fam), 'edit');

const ICON = {
  parent: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2"/><path d="M17 11v6M14 14h6"/>',
  spouse: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>',
  child: '<circle cx="12" cy="7" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/>',
  sibling: '<circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><path d="M2 20v-1a5 5 0 0 1 10 0v1M12 20v-1a5 5 0 0 1 10 0v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const relIcon = (k) => `<svg class="ic rel-ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[k] || ''}</svg>`;

function rowsFor(M, id) {
  const { ix } = relsOf(M); const sx = sexOf(M);
  const parents = (ix.parentsOf.get(id) || []).map((r) => ({ r, other: r.parent_id }));
  const partners = (ix.partnersOf.get(id) || []).map((x) => ({ r: x.row, other: x.other, order: x.order }));
  const kids = (ix.childrenOf.get(id) || []).map((r) => {
    const others = (ix.parentsOf.get(r.child_id) || []).filter((o) => o.parent_id !== id);
    return { r, other: r.child_id, mother: others[0] ? others[0].parent_id : null };
  });
  return { parents, partners, kids, sibs: siblingsOf(ix, id, sx), ix };
}

// Quan hệ toolbar (the shared list toolbar: search · Bộ lọc · "+"). Search and filters cover every level, Chắt and deeper
// included (their fold opens while a search or filter is on). The state is kept while the profile shows one person.
const RLV = [['cm', 'Cha mẹ'], ['vc', 'Vợ/chồng'], ['ace', 'Anh chị em'], ['con', 'Con'], ['chau', 'Cháu'], ['chat', 'Chắt trở xuống']];
const RLV_TYPE = { cm: 'parent', vc: 'spouse', ace: 'sibling', con: 'child' }; // a level filter picks what "+" adds
const RF = { id: '', q: '', lv: '', liv: '', sex: '', br: '' };
let RLAST = null; // { M, p, ctx } of the section on screen: search and filters repaint it in place
const rfActive = () => [RF.lv, RF.liv, RF.sex, RF.br].filter(Boolean).length;
function relUntag(k) {
  if (k === '*') Object.assign(RF, { lv: '', liv: '', sex: '', br: '' }); else if (k in RF) RF[k] = '';
  document.querySelectorAll('[data-relf]').forEach((s) => { s.value = RF[s.dataset.relf] || ''; });
  relPaint(true);
}
function relPaint(withBar) {
  if (!RLAST) return;
  const b = document.getElementById('relbody'); if (b) b.innerHTML = relBody(RLAST.M, RLAST.p, RLAST.ctx);
  const t = withBar && document.getElementById('reltb'); if (t) t.innerHTML = relToolbar(RLAST.M, RLAST.p);
}
// "+": the level filter (or a chosen branch) decides what is added and to whom; the search text goes to the add sheet.
function addStart(id) {
  if (RF.br && (!RF.lv || RF.lv === 'chau')) return { anchor: RF.br, type: 'child', q: RF.q };
  return { anchor: id, type: RLV_TYPE[RF.lv] || null, q: RF.q };
}
function relToolbar(M, p) {
  const add = relsOf(M).editable ? addBtn(`data-rel-add="${esc(p.id)}"`, 'Thêm quan hệ') : '';
  return toolbar({ id: 'relq', ph: 'Tìm trong quan hệ', val: RF.q, active: rfActive(), add: add });
}
function relSheet(M, p) {
  const sel = (k, label, opts) => `<label>${label}<select data-relf="${k}"><option value="">Tất cả</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${RF[k] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const lv = descendantLevels(relsOf(M).ix, p.id);
  const brs = [...new Set((lv[1] || []).map((x) => x.parent))].map((x) => [x, pname(M, x)]);
  return fpanel(sel('lv', 'Mức', RLV) + sel('liv', 'Tình trạng', [['song', 'Còn sống'], ['mat', 'Đã mất']]) + sel('sex', 'Giới tính', [['m', 'Nam'], ['f', 'Nữ']])
    + (brs.length ? sel('br', 'Nhánh (con của …)', brs) : ''));
}

// Profile section, one calm list (mockup quanhe-390). Editors: the whole row opens the edit sheet. Others: the whole row
// opens the person. Groups: parents, spouses, siblings (computed), children, grandchildren, then Chắt and deeper in one fold.
export function relSection(M, p, ctx = {}) {
  if (RF.id !== p.id) Object.assign(RF, { id: p.id, q: '', lv: '', liv: '', sex: '', br: '' });
  RLAST = { M, p, ctx };
  setUntag(relUntag);
  const note = relsOf(M).source !== 'table' ? '<p class="sub">Quan hệ hiện theo dữ liệu cũ. Quản trị cần chạy chuyển dữ liệu quan hệ để sửa ở đây.</p>' : '';
  return `<section class="relsec" aria-label="Quan hệ"><div class="relhead"><h2>Quan hệ</h2></div>${ctx.links || ''}${note}
    <div id="reltb" class="stk">${relToolbar(M, p)}</div>${relSheet(M, p)}<div id="relbody">${relBody(M, p, ctx)}</div></section>`;
}
function relBody(M, p, ctx) {
  const id = p.id; const { parents, partners, kids, sibs, ix } = rowsFor(M, id);
  const rel = relsOf(M); const editable = !!ctx.editable && rel.editable;
  const href = (x) => (ctx.personHref ? ctx.personHref(x) : '#');
  // a relation row: editors edit it in place, others open the person
  const relRow = (rw, otherId, sub) => {
    const name = pname(M, otherId); const k = rowKey(rw); keyMap.set(k, rw);
    // the row opens the person's profile for everyone; editors get ⋯ beside it (Sửa quan hệ, Xem trên cây, Xóa quan hệ)
    const action = editable ? calmAct({ icon: cic('more', 20), label: `Tùy chọn cho ${name}`, attrs: `data-rel-more="${esc(k)}" data-other="${esc(otherId)}"` }) : '';
    return calmRow({ href: href(otherId), tile: surnameTile(name), title: name, subtitle: sub, action, sex: M.byId.get(otherId)?.data.sex });
  };
  const group = (title, rows) => rows ? `<h3 class="relgrp">${title}</h3><div class="relrows">${rows}</div>` : '';
  const lv = descendantLevels(ix, id);
  // the child of this person each descendant comes through (the Nhánh filter)
  const br = new Map(); for (const x of lv[1] || []) br.set(x.id, x.parent);
  for (const l of lv.slice(2)) for (const x of l) br.set(x.id, br.get(x.parent));
  const q = fold(RF.q).trim(); const filtering = !!(q || rfActive());
  const keep = (x, level) => {
    const d = M.byId.get(x)?.data || {};
    return (!RF.lv || RF.lv === level) && (!RF.liv || (RF.liv === 'mat') === isDead(d)) && (!RF.sex || d.sex === RF.sex)
      && (!RF.br || br.get(x) === RF.br) && (!q || fold(pname(M, x)).includes(q));
  };
  const pRows = parents.filter((x) => keep(x.other, 'cm')).map(({ r, other }) => relRow(r, other, `${esc(roleTo(M.byId.get(other)?.data.sex))} · ${esc(PC_LABEL[r.kind] || r.kind)}`)).join('');
  const cRows = partners.filter((x) => keep(x.other, 'vc')).map(({ r, other, order }) => {
    const sx = M.byId.get(other)?.data.sex;
    const word = spouseWord(sx) + (order && (partners.length > 1) ? ' thứ ' + order : '');
    const notes = coupleNotes(ix, id, other, (x) => pname(M, x));
    const sub = `${esc(word)} · ${esc(CP_LABEL[r.kind] || r.kind)}${r.start_year ? ' ' + r.start_year : ''}${r.end_year ? '–' + r.end_year : ''}${r.private ? ' · riêng tư' : ''}`;
    return relRow(r, other, sub + notes.map((n) => `<span class="sub relnote">${esc(n)}</span>`).join(''));
  }).join('');
  const sRows = sibs.filter((s) => keep(s.id, 'ace')).map((s) => calmRow({ href: href(s.id), tile: surnameTile(pname(M, s.id)), sex: M.byId.get(s.id)?.data.sex, title: pname(M, s.id), subtitle: `tự tính · ${s.shared === 'cha mẹ' ? 'cùng cha mẹ' : 'cùng ' + esc(s.shared)}` })).join('');
  // each child's row says how many grandchildren come through them (the whole Cháu level, by parent)
  const cháuOf = new Map(); for (const x of lv[1] || []) cháuOf.set(x.parent, (cháuOf.get(x.parent) || 0) + 1);
  const kidsF = kids.filter((x) => keep(x.other, 'con'));
  const kRows = kidsF.map(({ r, other }) => relRow(r, other, `Con · ${esc(PC_LABEL[r.kind] || r.kind)}${r.birth_order ? ' · Thứ ' + r.birth_order : ''}${r.private ? ' · riêng tư' : ''}${cháuOf.get(other) ? ' · ' + cháuOf.get(other) + ' cháu' : ''}`)).join('');
  const region = kinRegion();
  const descRow = (x, g) => { const d = { ...lineDesc(0, g, sexOf(M)(x.id)), kind: x.row?.kind === 'nuoi' ? 'adopted' : 'blood' }; return calmRow({ href: href(x.id), tile: surnameTile(pname(M, x.id)), sex: M.byId.get(x.id)?.data.sex, title: pname(M, x.id), subtitle: `${esc(kinTerm(d, { locale: 'vi', region }))} · con của ${esc(pname(M, x.parent))}` }); };
  const cháu = (lv[1] || []).filter((x) => keep(x.id, 'chau'));
  const cháuRows = cháu.map((x) => descRow(x, 2)).join('');
  // generations past Chít: the tree link sits at the end of the deepest shown group (inside the fold), when nothing narrows the list
  const deep = filtering ? 0 : lv.slice(5).reduce((n, l) => n + l.length, 0);
  const deepRow = deep ? calmRow({ href: ctx.treeHref || '#', title: `Xem thêm ${deep} hậu duệ trên cây ›`, trailing: 'none' }) : '';
  const lvF = (g) => (lv[g - 1] || []).filter((x) => keep(x.id, 'chat'));
  const far = [3, 4, 5].filter((g) => lvF(g).length);
  const deepAt = far.length ? far[far.length - 1] : 0;
  const levelGroup = (g) => { const rows = lvF(g).map((x) => descRow(x, g)).join('') + (g === deepAt ? deepRow : ''); return rows ? group(gTitle(g, region), rows) : ''; };
  // Chắt and deeper: one fold under Cháu, closed by default and open while searching or filtering (a whole level is shown
  // or folded, never part of one)
  const farN = far.reduce((n, g) => n + lvF(g).length, 0);
  const farHtml = far.length ? moreFold(`Xem thêm ${far.length} đời · ${farN} người (${far.map((g) => gTitle(g, region)).join(', ')})`, far.map(levelGroup).join(''), filtering) : '';
  const counted = (t, n) => `${t} · ${n} người`;
  const lvName = Object.fromEntries(RLV); const brName = RF.br ? pname(M, RF.br) : '';
  const tags = [RF.lv && ['lv', lvName[RF.lv]], RF.liv && ['liv', RF.liv === 'mat' ? 'Đã mất' : 'Còn sống'], RF.sex && ['sex', RF.sex === 'f' ? 'Nữ' : 'Nam'], RF.br && ['br', 'Nhánh ' + brName]].filter(Boolean);
  const body = group('Cha mẹ', pRows) + group('Vợ/chồng', cRows) + group('Anh chị em (tự tính)', sRows) + group(counted(gTitle(1, region), kidsF.length), kRows) +
    group(counted(gTitle(2, region), cháu.length), cháuRows) + farHtml;
  // a search that found no one: say so, and point at "+" (only when this viewer has the "+")
  const none = q && rel.editable ? `Không thấy “${esc(RF.q.trim())}”. Bấm + để thêm người này.` : filtering ? 'Không có ai khớp.' : 'Chưa ghi quan hệ nào.';
  return `${ltags(tags)}${body || `<p class="sub rel-empty">${none}</p>`}`;
}

// Pedigree: the ancestors as one chain, one tappable row per ancestor (opens the Hồ sơ): the same shared person row as
// Quan hệ (calmRow), indented one step per generation. Labels come from the path (Cha, Mẹ, Ông nội, Bà ngoại...); a repeated
// ancestor is a row too (it opens the same person) with the place it was first drawn. The Thủy tổ (the root of the father
// line) is labelled with its generation; the deeper generations fold into a ghost row (ui.js ghostRow) right after the last
// visible father-line ancestor. A woman whose father is recorded has her own father line under her, behind a ghost row
// "Họ X · N đời" that ends with her line's Thủy tổ ("Thủy tổ họ X"). The chain itself is built in relgraph.js (ancestorChain).
export function pedigreeHtml(M, id, shown = 4, ctx = {}) {
  const { ix } = relsOf(M);
  const region = kinRegion(); const kin = kinOpts(M);
  const sexOfId = (x) => M.byId.get(x)?.data.sex || '';
  const nameOf = (x) => pname(M, x);
  const items = ancestorChain(ix, id, sexOfId, shown);
  if (!items.length) return '';
  const kinLabel = (x) => kinTerm(kinPath(ix, id, x, kin), { locale: 'vi', region }) || 'Tổ tiên';
  const row = (it) => {
    const ref = it.repeat ? `<span class="sub ped-ref">↗ xem ở nhánh ${esc(it.ref)}</span>` : '';
    const gen = M.byId.get(it.id)?.data.gen;
    let label;
    if (it.type === 'root') label = it.mother ? `Thủy tổ họ ${surnameOf(nameOf(it.id))}` : `Thủy tổ${gen ? ' · Đời ' + gen : ''}`;
    else { label = kinLabel(it.id); if (label === 'Thủy tổ') label = `Tổ đời ${it.gen}`; } // a line top that is not a father-line root is "Tổ đời N"
    return `<li style="--d:${it.d}">${personItem({ name: nameOf(it.id), sex: sexOfId(it.id) }, { href: ctx.personHref ? ctx.personHref(it.id) : '#', sub: esc(label) + ref })}</li>`;
  };
  const list = (its) => its.map((it) => {
    if (it.type === 'fold') return `<li class="ped-fold" style="--d:${it.d}">${ghostRow({ closed: `${it.gens} đời ẩn · ${it.people} người`, tiles: it.tiles.map((x) => surnameOf(nameOf(x))), body: `<ul class="ped ped-hid">${list(it.body)}</ul>` })}</li>`;
    const own = it.ghost ? `<li class="ped-fold" style="--d:${it.ghost.d}">${ghostRow({ closed: `Họ ${surnameOf(nameOf(it.ghost.root))} · ${it.ghost.n} đời`, tiles: it.ghost.tiles.map((x) => surnameOf(nameOf(x))), body: `<ul class="ped ped-hid">${list(it.ghost.items)}</ul>` })}</li>` : '';
    return row(it) + own;
  }).join('');
  return `<section class="relsec" aria-label="Tổ tiên"><h2>Tổ tiên</h2><ul class="ped">${list(items)}</ul></section>`;
}

// ---------- sheets ----------
// The relation sheet is the shared sheet() (no submit: the body's own buttons act), with the rel-sheet look.
let current = null;
export function openSheet(html) {
  const d = openDialog(`<div class="rel-body">${html}</div>`, () => KEEP, { cls: 'rel-sheet' });
  d.addEventListener('close', () => { d.remove(); if (current === d) current = null; });
  current = d;
  return d;
}
const closeSheet = () => { current?.close(); };
const err = (d, msg) => { const e = d.querySelector('.err') || d.querySelector('.rel-body').appendChild(Object.assign(document.createElement('p'), { className: 'err' })); e.textContent = msg; };

async function postRel(family, body) {
  const r = await fetch('/api/relations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
async function postSuggest(family, personId, rel, name) {
  const r = await fetch('/api/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family, person_id: personId, changes: { _rel: rel }, by_name: name || '' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  if (j.id && j.receipt) S.addReceipt(j.id, j.receipt);
  return j;
}
const opId = () => 'rel-' + crypto.randomUUID();
const yearIn = (s) => { const n = parseInt(s, 10); return n >= 1 && n <= 3000 ? n : null; };

// Set by app.js: opens the unified person form (goForm) with a prefill and an afterSave callback.
let goNewPerson = null;
export function setNewPersonHandler(fn) { goNewPerson = fn; }

// A family whose relations live in the relation table (the server refuses parent / spouse fields on a person there).
export const relTable = (fam) => S.relOf(fam).source === 'table';
// Row ⋯ "Thêm con / anh chị em / cha mẹ / vợ chồng" in such a family: the person form with what is known (generation,
// family name of the line, sex for a spouse, `extra` such as the order), then the relation sheet at its last step for the
// new person; the relation sets the parent. Same path as Quan hệ "+" → Tạo người mới.
export function addNewRelated(M, anchorId, type, extra = {}) {
  const anchor = M.byId.get(anchorId); if (!anchor || !goNewPerson) return false;
  const label = { parent: 'Cha / Mẹ', spouse: 'Vợ / Chồng', child: 'Con', sibling: 'Anh chị em' }[type];
  const line = (anchor.data.spouse_of && M.byId.get(anchor.data.spouse_of)?.data) || anchor.data;
  const prefill = { ...relPrefill(type, { anchor: { ...anchor.data, gen: anchor.data.gen || line.gen }, line }), ...extra };
  goNewPerson({ kind: 'them', prefill, title: `${label} của ${anchor.data.name}`,
    afterSave: (newId) => openAdd(M, anchorId, { type, pick: newId, pickName: S.get(newId)?.data.name || '', fresh: true }) });
  return true;
}

// Add sheet: step 1 type, step 2 person (search, duplicate hint, or the person form), step 3 details.
// preset: { type, pick, pickName, fresh } when the person was just created in the form (starts at step 3).
// start: { type, q } from the Quan hệ toolbar (a level filter picks the kind: starts at step 2 with the search text).
function openAdd(M, anchorId, preset = null, start = null) {
  const st = { step: preset ? 3 : start?.type ? 2 : 1, type: preset?.type || start?.type || null, q: start?.q || '', pick: preset?.pick || null, pickName: preset?.pickName || '', fresh: !!preset?.fresh, newp: null, kind: null };
  const anchor = M.byId.get(anchorId);
  const types = [
    ['parent', 'Cha / Mẹ', 'Thêm bố hoặc mẹ'], ['spouse', 'Vợ / Chồng', 'Thêm bạn đời'],
    ['child', 'Con', 'Ruột, nuôi hoặc kế'], ['sibling', 'Anh chị em', 'Cùng cha hoặc mẹ'],
  ];
  const head = (t) => `<div class="rel-head"><div><h2>${esc(t)}</h2><p class="sub">Bước ${st.step} / 3 · ${esc(rank(anchor.data))} ${esc(anchor.data.name)}</p></div><button class="ib" type="button" data-x aria-label="Đóng">${relIcon('close')}</button></div>`;
  const cands = () => {
    const q = fold(st.q).trim(); if (q.length < 2) return [];
    return M.all.filter((p) => p.id !== anchorId && fold(p.data.name + ' ' + (p.data.alias || '')).includes(q)).slice(0, 8);
  };
  const dup = () => { const q = fold(st.q).trim(); return q.length >= 2 ? M.all.find((p) => p.id !== anchorId && fold(p.data.name) === q) : null; };
  const draw = (d) => {
    const b = d.querySelector('.rel-body');
    if (st.step === 1) {
      b.innerHTML = head('Thêm quan hệ') + `<div class="rel-types">${types.map(([k, t, s]) => `<button class="rel-type" type="button" data-type="${k}">${relIcon(k)}<b>${esc(t)}</b><span class="sub">${esc(s)}</span></button>`).join('')}</div>
        <p class="sub">Cháu: thêm con cho con của người này.</p><button class="btn ter wide" type="button" data-x>Huỷ</button>`;
    } else if (st.step === 2) {
      const list = cands();
      const d0 = dup();
      b.innerHTML = head(types.find((t) => t[0] === st.type)[1]) + `
        <label class="fld">Tìm người<input id="rel-q" value="${esc(st.q)}" autocomplete="off" placeholder="Nhập tên"></label>
        ${d0 ? `<div class="rel-dup"><b>Có thể là cùng một người: ${esc(d0.data.name)}${d0.data.born ? ' (' + esc(d0.data.born) + ')' : ''}</b><button class="btn ter sm" type="button" data-pick="${esc(d0.id)}">Dùng người này ›</button></div>` : ''}
        ${list.length ? `<p class="sub">Kết quả (${list.length})</p>` + list.map((p) => calmRow({ attrs: `data-pick="${esc(p.id)}"`, sex: p.data.sex, title: `${rank(p.data)} ${p.data.name}`, subtitle: esc([p.data.gen ? 'Đời ' + p.data.gen : '', years(p.data)].filter(Boolean).join(' · ')), dense: true })).join('') : ''}
        ${S.isEditor() ? `<div class="relrows">${calmRow({ attrs: 'data-newp', title: 'Không thấy — tạo người mới', subtitle: 'Nhập tên, giới tính, năm sinh và mất; quan hệ được ghi sau khi lưu' })}</div>` : '<p class="sub">Người mới: gửi góp ý trước (nút Sửa), quản trị sẽ duyệt.</p>'}
        <div class="rel-foot"><button class="btn ter" type="button" data-back>Quay lại</button>${st.pick ? '<button class="btn" type="button" data-next>Tiếp</button>' : ''}</div>`;
      const qi = b.querySelector('#rel-q'); qi?.addEventListener('input', (e) => { st.q = e.target.value; draw(d); requestAnimationFrame(() => { const x = d.querySelector('#rel-q'); x?.focus(); x?.setSelectionRange(x.value.length, x.value.length); }); });
    } else {
      const other = st.pick ? M.byId.get(st.pick) : null;
      const isCp = st.type === 'spouse';
      const kinds = isCp ? CP_KINDS : PC_KINDS;
      if (!st.kind) st.kind = isCp ? 'cuoi' : 'ruot';
      const who = st.pick ? (other?.data.name || st.pickName) : '';
      b.innerHTML = head('Chi tiết') + `<p><b>${esc(who)}</b> · ${esc(types.find((t) => t[0] === st.type)[1])}</p>
        <div class="seg" role="radiogroup" aria-label="Loại">${kinds.map((k) => `<button type="button" role="radio" aria-checked="${st.kind === k}" data-kind="${k}" class="${st.kind === k ? 'on' : ''}">${esc(isCp ? CP_LABEL[k] : PC_LABEL[k])}</button>`).join('')}</div>
        ${st.type === 'spouse' ? `<div class="row"><label class="fld">Năm bắt đầu<input id="ys" inputmode="numeric" value=""></label><label class="fld">Năm kết thúc<input id="ye" inputmode="numeric" value=""></label><label class="fld">Thứ tự<input id="ord" inputmode="numeric" placeholder="1, 2…"></label></div>` : ''}
        ${st.type === 'child' ? `<label class="fld">Thứ tự tính (con thứ mấy)<input id="ord" inputmode="numeric" placeholder="để trống nếu chưa rõ" value="${nextOrder(rowsFor(M, anchorId).kids.map((k) => k.r.birth_order))}"></label>` : ''}
        ${st.type === 'child' && partnersOf(M, anchorId).length ? `<label class="fld">Cha/mẹ còn lại<select id="otherp"><option value="">Không ghi</option>${partnersOf(M, anchorId).map((x, i) => `<option value="${esc(x)}"${i === 0 ? ' selected' : ''}>${esc(pname(M, x))}</option>`).join('')}</select></label>` : ''}
        <label class="rel-tog"><input id="priv" type="checkbox"> Riêng tư (chỉ thành viên thấy)</label>
        ${S.signedIn() ? '' : '<label class="fld">Tên của bạn (để quản trị biết)<input id="byn" autocomplete="name"></label>'}
        <div class="rel-foot"><button class="btn ter" type="button" data-back>Quay lại</button><button class="btn" type="button" data-save>Lưu quan hệ</button></div>`;
      b.querySelectorAll('[data-kind]').forEach((x) => x.addEventListener('click', () => { st.kind = x.dataset.kind; draw(d); }));
    }
  };
  const d = openSheet('');
  draw(d);
  d.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.matches('[data-x]')) return closeSheet();
    if (t.dataset.type) { st.type = t.dataset.type; st.step = 2; st.q = ''; st.pick = null; st.newp = null; return draw(d); }
    if (t.matches('[data-back]')) { st.step = Math.max(1, st.step - 1); st.kind = null; return draw(d); }
    if (t.dataset.pick) { st.pick = t.dataset.pick; st.newp = null; return draw(d); }
    if (t.matches('[data-newp]')) {
      if (!goNewPerson) return err(d, 'Không mở được biểu mẫu người mới.');
      const type = st.type; const label = types.find((x) => x[0] === type)[1];
      // what is known: generation, sex, the family name of the line (or the search text when it found no one)
      const line = (anchor.data.spouse_of && M.byId.get(anchor.data.spouse_of)?.data) || anchor.data;
      // no legacy parent here: the relation saved after the form sets it (the server refuses parent edits on a person)
      const prefill = relPrefill(type, { anchor: { ...anchor.data, gen: anchor.data.gen || line.gen }, line, q: st.q, qMatched: cands().length > 0 });
      closeSheet();
      return goNewPerson({ kind: 'them', prefill, title: `${label} của ${anchor.data.name}`,
        afterSave: (newId) => openAdd(M, anchorId, { type, pick: newId, pickName: S.get(newId)?.data.name || '', fresh: true }) });
    }
    if (t.matches('[data-next]')) { st.step = 3; st.kind = null; return draw(d); }
    if (t.matches('[data-save]')) {
      try { await saveAdd(M, anchorId, st, d); } catch (x) { err(d, x.message); }
    }
  });
  return d;
}

// Add: creates the new person first (editors, through /api/ops) when needed, then the relation.
async function saveAdd(M, anchorId, st, d) {
  const fam = M.byId.get(anchorId)?.fam || 'duong';
  const yr = (sel) => yearIn(d.querySelector(sel)?.value);
  const priv = !!d.querySelector('#priv')?.checked;
  const ordV = parseInt(d.querySelector('#ord')?.value, 10); const ord = ordV > 0 ? ordV : null;
  const pid = st.pick;
  if (!pid) throw new Error('Chọn người trước.');
  if (st.fresh) await S.sync(); // the person was just saved in the form: it must reach the server before the relation names it
  const base = { op_id: opId(), person_id: anchorId, private: priv };
  const direct = canEdit(fam);
  const body = [];
  if (st.type === 'parent') body.push({ ...base, action: 'add', kind: 'parent_child', parent_id: pid, child_id: anchorId, pc_kind: st.kind, birth_order: null });
  else if (st.type === 'child') {
    const other = d.querySelector('#otherp')?.value || '';
    // the other parent's link first: it is the child's first recorded parent when two are given
    if (other) body.push({ ...base, op_id: opId(), action: 'add', kind: 'parent_child', parent_id: other, child_id: pid, pc_kind: st.kind, birth_order: ord });
    body.push({ ...base, action: 'add', kind: 'parent_child', parent_id: anchorId, child_id: pid, pc_kind: st.kind, birth_order: ord });
  }
  else if (st.type === 'spouse') body.push({ ...base, action: 'add', kind: 'couple', a_id: anchorId, b_id: pid, cp_kind: st.kind, order_a: ord, start_year: yr('#ys'), end_year: yr('#ye'), order_b: null });
  else if (st.type === 'sibling') {
    const parents = relsOf(M).ix.parentsOf.get(anchorId) || [];
    if (!parents.length) throw new Error('Cần ghi cha hoặc mẹ của người này trước, để biết anh chị em cùng cha mẹ.');
    for (const r of parents) body.push({ ...base, op_id: opId(), action: 'add', kind: 'parent_child', parent_id: r.parent_id, child_id: pid, pc_kind: r.kind, birth_order: null });
  }
  if (direct) {
    let info = [];
    for (const b of body) info = info.concat((await postRel(fam, b)).info || []);
    await S.sync();
    return showDone(d, info);
  }
  const by = d.querySelector('#byn')?.value.trim();
  for (const b of body) await postSuggest(fam, anchorId, relPayload(b), by);
  return showDone(d, [`Đã gửi ${body.length} góp ý. Quản trị sẽ duyệt.`]);
}
// The relation part of a suggestion (no op ids, no person hint).
function relPayload(b) { const { action, kind, parent_id, child_id, a_id, b_id, pc_kind, cp_kind, birth_order, order_a, order_b, start_year, end_year, private: pv } = b; return { action, kind, parent_id, child_id, a_id, b_id, pc_kind, cp_kind, birth_order, order_a, order_b, start_year, end_year, private: pv }; }
function showDone(d, notes) {
  d.querySelector('.rel-body').innerHTML = `<div class="rel-head"><div><h2>Đã lưu</h2></div></div>${notes.map((n) => `<p class="sub relnote">${esc(n)}</p>`).join('')}<button class="btn wide" type="button" data-x>Xong</button>`;
}

// Edit sheet: kind, years, order, privacy; remove (with confirm). Rows from relsOf.
function openEdit(M, rowKeyStr, opts = {}) {
  const r = keyMap.get(rowKeyStr); if (!r) return;
  const isPc = !!r.parent_id; const kinds = isPc ? PC_KINDS : CP_KINDS;
  const st = { kind: r.kind };
  const label = isPc ? `${roleTo(M.byId.get(r.parent_id)?.data.sex)} ${pname(M, r.parent_id)} → ${pname(M, r.child_id)}` : `${pname(M, r.a_id)} và ${pname(M, r.b_id)}`;
  const fam = r.fam || 'duong';
  // remove: the shared destructive confirm (row ⋯ Xóa quan hệ opens it straight away, the sheet from its danger zone)
  const removeAsk = () => confirmDanger({ title: 'Gỡ quan hệ này?', lose: label, restore: 'Không thể hoàn tác. Lịch sử thay đổi vẫn ghi lại việc gỡ.', confirm: 'Gỡ quan hệ', onConfirm: async () => {
    const rm = { op_id: opId(), action: 'remove', kind: isPc ? 'parent_child' : 'couple', id: r.id, person_id: isPc ? r.child_id : r.a_id };
    if (canEdit(fam)) { const j = await postRel(fam, rm); await S.sync(); if (j?.trash_id) undoToast('Đã gỡ quan hệ · trong Thùng rác', async () => { await restoreTrash(fam, j.trash_id); await S.sync(); }); } else await postSuggest(fam, isPc ? r.child_id : r.a_id, { action: 'remove', kind: rm.kind, id: r.id }, '');
    closeSheet();
  } });
  if (opts.confirm) return removeAsk();
  const draw = (d) => {
    const b = d.querySelector('.rel-body');
    b.innerHTML = `<div class="rel-head"><div><h2>${isPc ? 'Cha / mẹ' : 'Vợ / chồng'}</h2><p class="sub">${esc(label)}</p></div><button class="ib" type="button" data-x aria-label="Đóng">${relIcon('close')}</button></div>
      <div class="seg" role="radiogroup">${kinds.map((k) => `<button type="button" role="radio" aria-checked="${st.kind === k}" data-kind="${k}" class="${st.kind === k ? 'on' : ''}">${esc(isPc ? PC_LABEL[k] : CP_LABEL[k])}</button>`).join('')}</div>
      ${isPc ? `<label class="fld">Thứ tự tính<input id="ord" inputmode="numeric" value="${r.birth_order ?? ''}"></label>` : `<div class="row"><label class="fld">Năm bắt đầu<input id="ys" inputmode="numeric" value="${r.start_year ?? ''}"></label><label class="fld">Năm kết thúc<input id="ye" inputmode="numeric" value="${r.end_year ?? ''}"></label></div>
        <label class="fld">Thứ tự (vợ/chồng thứ mấy)<input id="ord" inputmode="numeric" value="${r.order_a ?? ''}"></label>`}
      <label class="rel-tog"><input id="priv" type="checkbox" ${r.private ? 'checked' : ''}> Riêng tư (chỉ thành viên thấy)</label>
      ${dangerZone([dangerButton('Gỡ quan hệ', 'data-askremove')], { note: 'Lịch sử thay đổi vẫn được giữ.' })}
      <div class="rel-foot"><button class="btn" type="button" data-save>Lưu</button></div>`;
    b.querySelectorAll('[data-kind]').forEach((x) => x.addEventListener('click', () => { st.kind = x.dataset.kind; draw(d); }));
  };
  const d = openSheet(''); draw(d);
  d.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.matches('[data-x]')) return closeSheet();
      if (t.matches('[data-askremove]')) return removeAsk();
      if (t.matches('[data-save]')) {
        const ord = parseInt(d.querySelector('#ord').value, 10) || null;
        const body = isPc ? { op_id: opId(), action: 'edit', kind: 'parent_child', id: r.id, pc_kind: st.kind, birth_order: ord, private: d.querySelector('#priv').checked, person_id: r.child_id }
          : { op_id: opId(), action: 'edit', kind: 'couple', id: r.id, cp_kind: st.kind, order_a: ord, start_year: yearIn(d.querySelector('#ys').value), end_year: yearIn(d.querySelector('#ye').value), private: d.querySelector('#priv').checked, person_id: r.a_id };
        if (canEdit(fam)) { await postRel(fam, body); await S.sync(); return closeSheet(); }
        const { op_id, person_id, ...pl } = body; void op_id; void person_id;
        await postSuggest(fam, isPc ? r.child_id : r.a_id, { ...pl, id: r.id }, ''); closeSheet();
      }
    } catch (x) { err(d, x.message); }
  });
}

// Wire clicks once per profile render: add and edit openers.
// getM: the model as it is at the click (the page is drawn again as the device's data arrives; the wiring stays)
export function relWire(root, getM) {
  if (root.dataset.relWired) return; root.dataset.relWired = '1';
  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-rel-add]'); if (add) { const s0 = addStart(add.dataset.relAdd); return openAdd(getM(), s0.anchor, null, s0); }
    const ed = e.target.closest('[data-rel-edit]'); if (ed) return openEdit(getM(), ed.dataset.relEdit);
    const mo = e.target.closest('[data-rel-more]');
    if (mo) {
      e.stopPropagation();
      const k = mo.dataset.relMore; const other = mo.dataset.other; const M = getM();
      const items = [['Sửa quan hệ', () => openEdit(getM(), k)],
        ...(RLAST?.ctx?.treeOf ? [['Xem trên cây', () => { location.hash = RLAST.ctx.treeOf(other).replace(/^#/, ''); }]] : []),
        dangerItem('Xóa quan hệ', () => openEdit(getM(), k, { confirm: true }))];
      return popMenu(mo, items, '', { title: pname(M, other) });
    }
  });
  // the Quan hệ search filters in place (the toolbar and its input stay, so typing keeps focus); the sheet's selects repaint both
  root.addEventListener('input', (e) => { if (e.target.id !== 'relq') return; clearTimeout(relWire.t); relWire.t = setTimeout(() => { RF.q = e.target.value; relPaint(false); }, 150); });
  root.addEventListener('change', (e) => { const s = e.target.closest?.('[data-relf]'); if (!s) return; RF[s.dataset.relf] = s.value; relPaint(true); });
}
