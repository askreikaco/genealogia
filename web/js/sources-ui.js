// Reusable sources (E2): the citation rows and source picker in the event editor, and the "Nguồn tài liệu" page.
// Copy in sources-vi.js. Data: /api/families/:ref/sources (server/sources.js). A citation keeps title and url copies
// (the server refreshes them), so the event card and the GEDCOM read the same shape. Styles: app.css ("Nguồn").
import { esc } from './model.js';
import { SOURCE_QUALITY } from './events.js';
import { SRC_VI as V } from './sources-vi.js';
import { tag, card, toast, iconButton } from './ui.js';
import { confirmDanger, dangerButton } from './danger.js';

export const KIND_LABEL = { gia_pha: V.kind_gia_pha, bia_mo: V.kind_bia_mo, giay_to: V.kind_giay_to, loi_ke: V.kind_loi_ke, web: V.kind_web, khac: V.kind_khac };
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// ---- data (cached per family; every write refreshes the cache) ----
const cache = new Map();
const base = (fam) => `/api/families/${encodeURIComponent(fam)}/sources`;
export async function loadSources(fam, { force = false } = {}) {
  if (!force && cache.has(fam)) return cache.get(fam);
  const r = await fetch(base(fam), { cache: 'no-store' });
  if (!r.ok) { const e = new Error((await r.json().catch(() => ({}))).error || V.err_load); e.status = r.status; throw e; }
  const items = (await r.json()).items; cache.set(fam, items); return items;
}
async function send(method, fam, id, body) {
  const r = await fetch(base(fam) + (id ? '/' + encodeURIComponent(id) : ''), { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  cache.delete(fam);
  if (!r.ok) { const e = new Error(j.error || V.err_load); e.status = r.status; e.uses = j.uses; throw e; }
  return j;
}
export const createSource = (fam, input) => send('POST', fam, '', input).then((j) => j.source);
export const updateSource = (fam, id, input) => send('PATCH', fam, id, input).then((j) => j.source);
export const deleteSource = (fam, id) => send('DELETE', fam, id);

// ---- the form (new or edit): the same markup in the event editor and on the page ----
const kindSelect = (val) => `<label class="fld">${V.f_kind}<select data-sr="kind">${Object.keys(KIND_LABEL).map((k) => `<option value="${k}"${k === val ? ' selected' : ''}>${esc(KIND_LABEL[k])}</option>`).join('')}</select></label>`;
export function sourceFormHtml(s = {}) {
  return `<div class="srcf" data-srcf>
    <label class="fld">${V.f_title}<input data-sr="title" value="${esc(s.title || '')}" maxlength="300" placeholder="${esc(V.f_title_ph)}" autocomplete="off"></label>
    <div class="srcf-row">${kindSelect(s.kind || 'khac')}<label class="fld">${V.f_year}<input data-sr="year" inputmode="numeric" maxlength="4" value="${esc(s.year ?? '')}" autocomplete="off"></label></div>
    <label class="fld">${V.f_author}<input data-sr="author" value="${esc(s.author || '')}" maxlength="200" autocomplete="off"></label>
    <label class="fld">${V.f_url}<input data-sr="url" type="url" value="${esc(s.url || '')}" maxlength="2000" placeholder="https://…" autocomplete="off"></label>
    <label class="fld">${V.f_note}<textarea data-sr="note" rows="2" maxlength="2000">${esc(s.note || '')}</textarea></label>
    <p class="err" data-sr-err role="alert" hidden></p>
    <div class="row end"><button type="button" class="btn gh" data-sr-cancel>${V.cancel}</button><button type="button" class="btn" data-sr-save>${V.save}</button></div>
  </div>`;
}
export function readSourceForm(root) {
  const g = (k) => (root.querySelector(`[data-sr="${k}"]`)?.value ?? '').trim();
  return { title: g('title'), kind: g('kind') || 'khac', year: g('year'), author: g('author'), url: g('url'), note: g('note') };
}

// ---- citation rows (events.sources items) ----
const qualitySelect = (val) => `<label class="fld">${V.quality}<select data-sf="quality" aria-label="${esc(V.quality)}"><option value="">Chưa rõ</option>${Object.entries(SOURCE_QUALITY).map(([k, l]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
const pageField = (val) => `<label class="fld">${V.page}<input data-sf="page" value="${esc(val || '')}" maxlength="200" placeholder="${esc(V.page_ph)}" aria-label="${esc(V.page)}" autocomplete="off"></label>`;
// One citation. A source from the family's list: its title is shown (not edited here). An older citation without
// source_id keeps its own title and link fields.
export function citeRowHtml(c = {}) {
  const remove = iconButton({ icon: 'close', label: V.remove, attrs: 'data-src-del' });
  if (c.source_id) { // the title (left) and the remove icon (right) share one row
    return `<div class="srow" data-src data-src-id="${esc(c.source_id)}" data-src-title="${esc(c.title || '')}">`
      + `<div class="srow-h"><p class="srow-t"><b>${esc(c.title || '')}</b>${c.url ? ` <a class="sub" href="${esc(c.url)}" target="_blank" rel="noopener">Link ›</a>` : ''}</p>${remove}</div>`
      + `${pageField(c.page)}${qualitySelect(c.quality)}</div>`;
  }
  return `<div class="srow" data-src><div class="srow-h">${remove}</div>`
    + `<label class="fld">Tên nguồn<input data-sf="title" value="${esc(c.title || '')}" placeholder="vd Gia phả viết tay 1950" maxlength="300" aria-label="Tên nguồn" autocomplete="off"></label>`
    + `<label class="fld">${V.f_url}<input data-sf="url" value="${esc(c.url || '')}" placeholder="https://…" maxlength="2000" aria-label="Link nguồn" autocomplete="off"></label>`
    + `${pageField(c.page)}${qualitySelect(c.quality)}</div>`;
}
// The "Nguồn" block of the event editor: the citations, then the picker (search, pick, or a new source inline).
export function sourcesAreaHtml(cites = []) {
  return `<div class="evx-src" data-srcarea><span class="sub">${V.cite}</span><div data-srcs>${cites.map((c) => citeRowHtml(c)).join('')}</div>
    <div class="srcpick" data-srcpick hidden>
      <input class="pk-q" type="search" placeholder="${esc(V.pick_ph)}" aria-label="${esc(V.pick_ph)}" autocomplete="off" data-src-q>
      <div class="pk-res" data-src-res></div>
      <div class="row wrap"><button type="button" class="btn ter sm" data-src-newbtn>${V.new}</button><button type="button" class="btn gh sm" data-src-close>${V.cancel}</button></div>
      <div data-src-newbox hidden>${sourceFormHtml()}</div>
    </div>
    <button type="button" class="btn ter sm src-add" data-src-add>${V.pick}</button></div>`;
}
// The citations as the event carries them: { source_id?, title, url, quality, page }.
export function readCites(root) {
  return [...root.querySelectorAll('[data-src]')].map((row) => {
    const page = (row.querySelector('[data-sf="page"]')?.value || '').trim();
    const quality = row.querySelector('[data-sf="quality"]')?.value || null;
    const extra = page ? { page } : {};
    if (row.dataset.srcId) return { source_id: row.dataset.srcId, title: row.dataset.srcTitle || '', quality, ...extra };
    return { title: (row.querySelector('[data-sf="title"]')?.value || '').trim(), url: (row.querySelector('[data-sf="url"]')?.value || '').trim(), quality, ...extra };
  }).filter((s) => s.source_id || s.title || s.url);
}

// Wires the editor's Nguồn block. The family's sources load when the picker opens (cached; see loadSources).
export function wireSources(root, { fam }) {
  const area = root.querySelector('[data-srcarea]'); if (!area) return;
  let list = [];
  const pick = area.querySelector('[data-srcpick]'); const q = area.querySelector('[data-src-q]');
  const res = area.querySelector('[data-src-res]'); const box = area.querySelector('[data-src-newbox]');
  const chosen = () => new Set([...area.querySelectorAll('[data-src-id]')].map((x) => x.dataset.srcId));
  const addRow = (c) => area.querySelector('[data-srcs]').insertAdjacentHTML('beforeend', citeRowHtml(c));
  const paint = () => {
    const term = norm(q.value.trim()); const have = chosen();
    const hits = list.filter((s) => !have.has(s.id) && (!term || norm(`${s.title} ${s.author}`).includes(term))).slice(0, 12);
    res.innerHTML = hits.map((s) => `<button type="button" class="pk-opt" data-src-pick="${esc(s.id)}">${esc(s.title)} <span class="sub">${esc(KIND_LABEL[s.kind] || '')}${s.year ? ' · ' + s.year : ''}</span></button>`).join('')
      + (!hits.length ? `<p class="sub">${esc(term ? V.pick_nomatch : list.length ? V.pick_used : V.pick_none)}</p>` : '');
  };
  const openPicker = async () => {
    list = (await loadSources(fam).catch(() => list)).slice();
    pick.hidden = false; box.hidden = true; q.value = ''; paint(); q.focus();
  };
  const closePicker = () => { pick.hidden = true; box.hidden = true; q.value = ''; };
  q.addEventListener('input', paint);
  area.addEventListener('click', async (e) => {
    if (e.target.closest('[data-src-add]')) return openPicker();
    if (e.target.closest('[data-src-close]')) return closePicker();
    if (e.target.closest('[data-src-newbtn]')) { box.hidden = false; box.querySelector('[data-sr="title"]')?.focus(); return; }
    const p = e.target.closest('[data-src-pick]');
    if (p) { const s = list.find((x) => x.id === p.dataset.srcPick); if (s) addRow({ source_id: s.id, title: s.title, url: s.url }); closePicker(); return; }
    if (e.target.closest('[data-sr-cancel]')) { box.hidden = true; return; }
    if (e.target.closest('[data-sr-save]')) {
      const err = box.querySelector('[data-sr-err]'); err.hidden = true;
      try {
        const s = await createSource(fam, readSourceForm(box));
        list.push(s); addRow({ source_id: s.id, title: s.title, url: s.url }); toast(V.saved); closePicker(); loadSources(fam, { force: true }).catch(() => {});
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      return;
    }
    const del = e.target.closest('[data-src-del]'); if (del) del.closest('[data-src]').remove();
  });
}

// ---- the "Nguồn tài liệu" page: the family's sources, with how many events use each one ----
export async function sourcesPage(main, { fam, canEdit = false }) {
  main.innerHTML = `<h1>${V.title}</h1><p class="sub">${V.intro}</p><div data-sp-body><p class="sub">${V.loading}</p></div>`;
  const body = main.querySelector('[data-sp-body]');
  let items = [];
  const paint = () => {
    body.innerHTML = (canEdit ? `<div class="row end"><button type="button" class="btn sm" data-sp-new>${V.add}</button></div><div data-sp-form hidden>${sourceFormHtml()}</div>` : '')
      + (items.length ? `<ul class="srcl">${items.map(itemHtml).join('')}</ul>` : `<p class="sub">${V.empty}</p>`);
  };
  const itemHtml = (s) => card(`<div class="row btw"><b>${esc(s.title)}</b>${tag(esc(KIND_LABEL[s.kind] || ''), { sm: true })}</div>`
    + ((s.author || s.year) ? `<span class="sub">${[esc(s.author), s.year ? String(s.year) : ''].filter(Boolean).join(' · ')}</span>` : '')
    + (s.url ? `<a class="sub srcl-url" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a>` : '')
    + (s.note ? `<p class="sub">${esc(s.note)}</p>` : '')
    + `<span class="sub">${s.uses ? fill(V.uses, { n: s.uses }) : V.uses_none}</span>`
    + (canEdit ? `<span class="evrow-a srcl-acts"><button type="button" class="linkbtn" data-sp-edit="${esc(s.id)}">${V.edit}</button>${dangerButton(V.delete, `data-sp-del="${esc(s.id)}"`, { size: 'sm' })}</span>` : ''),
  { tag: 'li', cls: 'srcl-i', attrs: `data-sp-id="${esc(s.id)}"` });
  const load = async () => {
    try { items = await loadSources(fam, { force: true }); paint(); }
    catch (e) { body.innerHTML = `<p class="err">${esc(e.status === 401 || e.status === 403 ? V.login : V.err_load)}</p>`; }
  };
  const formFor = (s) => {
    const f = body.querySelector('[data-sp-form]'); f.hidden = false; f.innerHTML = sourceFormHtml(s || {});
    f.dataset.editId = s ? s.id : '';
    f.querySelector('[data-sr="title"]').focus();
    return f;
  };
  body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-sp-new]')) return formFor(null);
    const ed = e.target.closest('[data-sp-edit]');
    if (ed) return formFor(items.find((x) => x.id === ed.dataset.spEdit));
    const del = e.target.closest('[data-sp-del]');
    if (del) {
      const s = items.find((x) => x.id === del.dataset.spDel); if (!s) return;
      if (s.uses) return toast(fill(V.block_del, { n: s.uses }));
      confirmDanger({ title: V.del_title, lose: fill(V.del_lose, { t: s.title }), confirm: V.del_confirm, onConfirm: async () => {
        try { await deleteSource(fam, s.id); toast(V.deleted); await load(); } catch (ex) { toast(ex.message); }
      } });
      return;
    }
    if (e.target.closest('[data-sr-cancel]')) { body.querySelector('[data-sp-form]').hidden = true; return; }
    if (e.target.closest('[data-sr-save]')) {
      const f = body.querySelector('[data-sp-form]'); const err = f.querySelector('[data-sr-err]'); err.hidden = true;
      const editing = f.dataset.editId || '';
      try {
        if (editing) await updateSource(fam, editing, readSourceForm(f)); else await createSource(fam, readSourceForm(f));
        toast(V.saved); await load();
      } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    }
  });
  await load();
}
