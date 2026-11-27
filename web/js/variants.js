// Conflicting data in the app (server: variants-routes.js). A profile field that has more than one sourced value
// shows a tag "N nguồn khác nhau"; the tag opens a sheet with every value: source, who recorded it, when, how
// reliable. Editors choose the value the profile shows ("Dùng giá trị này"), add another value with its source, or
// remove one that is not shown. Fetched per person when a profile is drawn (cached a minute), not stored offline.
import { esc } from './model.js';
import { toast, sheet, KEEP } from './ui.js';
import { dangerButton, dangerZone, dangerItem, dangerLabel, confirmDanger } from './danger.js';

export const FIELDS = { name: 'Họ tên', born: 'Năm sinh', died: 'Năm mất', birth_place: 'Nơi sinh', place: 'Nơi sống', burial: 'An táng' };
export const QUALITY = { rat_thap: 'rất thấp', thap: 'thấp', binh_thuong: 'bình thường', cao: 'cao', rat_cao: 'rất cao' };
const cache = new Map(); // person id -> { at, fields, can_edit }
const loading = new Set();
let onChange = () => {};
export const setOnChange = (fn) => { onChange = fn; };

async function api(url, opts = {}) {
  const r = await fetch(url, { cache: 'no-store', headers: { 'content-type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Chưa làm được: ' + r.status);
  return j;
}
const famQ = (fam) => `family=${encodeURIComponent(fam)}`;
export function ensure(fam, personId, force = false) {
  if (!fam || fam === 'tat-ca' || !personId) return;
  const c = cache.get(personId);
  if (!force && c && Date.now() - c.at < 60e3) return;
  if (loading.has(personId)) return;
  loading.add(personId);
  api(`/api/persons/${encodeURIComponent(personId)}/variants?${famQ(fam)}`).then((j) => {
    const before = JSON.stringify(c?.fields || {});
    cache.set(personId, { at: Date.now(), fields: j.fields || {}, can_edit: !!j.can_edit });
    if (before !== JSON.stringify(j.fields || {})) onChange();
  }).catch(() => cache.set(personId, { at: Date.now(), fields: {}, can_edit: false })).finally(() => loading.delete(personId));
}
const fieldOf = (personId, field) => cache.get(personId)?.fields?.[field] || null;

// The tag after a profile value: only when the field has 2+ different values.
export function tag(personId, field) {
  const v = fieldOf(personId, field); if (!v || v.count < 2) return '';
  const lbl = `${v.count} nguồn khác nhau`;
  return ` <button type="button" class="tag sm var-tag" data-variants="${esc(field)}" data-pid="${esc(personId)}" aria-label="${esc(FIELDS[field] || '')}: ${lbl}, xem">${lbl} ›</button>`;
}

const fmtAt = (at) => { try { return new Date(at).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric', month: 'numeric', year: 'numeric' }); } catch { return ''; } };
function itemHtml(x, canEdit) {
  const meta = [x.by ? `Ghi bởi ${esc(x.by)}` : '', x.at ? fmtAt(x.at) : '', `tin cậy: ${esc(QUALITY[x.quality] || x.quality)}`].filter(Boolean).join(' · ');
  return `<li class="var-item${x.chosen ? ' on' : ''}" data-vid="${x.id}"><div class="var-hd"><b>${esc(x.value)}</b>${x.chosen ? '<span class="tag blue sm">Đang hiển thị</span>' : ''}</div>
    <span class="sub">${esc(x.source || 'Không ghi nguồn')}</span><span class="sub">${meta}</span>
    ${canEdit && !x.chosen ? `<div class="row"><button type="button" class="btn sm gh" data-var-use="${x.id}">Dùng giá trị này</button>${dangerButton('Xoá', `data-var-del="${x.id}" aria-label="Xoá giá trị ${esc(x.value)}"`, { size: 'sm' })}</div>` : ''}</li>`;
}
const addForm = (field) => `<details class="var-add"><summary class="btn sm gh">+ Thêm giá trị khác</summary><div class="form-stack">
  <label>${esc(FIELDS[field])}<input data-var-value maxlength="200" autocomplete="off"></label>
  <label>Nguồn<input data-var-source maxlength="300" placeholder="Bia mộ, gia phả trang…, lời kể của ai…"></label>
  <label>Độ tin cậy<select data-var-quality>${Object.entries(QUALITY).map(([k, l]) => `<option value="${k}"${k === 'binh_thuong' ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
  <div class="row end"><button type="button" class="btn sm" data-var-save>Lưu</button></div></div></details>`;

// The sheet for one field. done() redraws the page after a change (the profile value may have changed).
export function openSheet({ fam, personId, personName, field, done }) {
  const c = cache.get(personId); const v = fieldOf(personId, field); if (!v) return;
  const canEdit = !!c?.can_edit;
  const cur = fieldOf(personId, field) || v;
  // Shared sheet(): no submit here (the buttons below act); Enter in a field keeps the sheet open.
  const d = sheet(`<div class="form-stack"><h2 id="var-h">${esc(FIELDS[field])} · ${esc(personName)}</h2>
      <p class="sub">Ứng dụng không chọn đâu là đúng: mọi giá trị đều được giữ cùng nguồn của nó.${canEdit ? ' Chọn giá trị hồ sơ sẽ hiển thị.' : ''}</p>
      <ul class="var-list">${cur.items.map((x) => itemHtml(x, canEdit)).join('')}</ul>
      <p class="err" hidden></p>
      ${canEdit ? addForm(field) : ''}
      <div class="row end"><button type="button" class="btn gh" data-var-close>Đóng</button></div></div>`, () => KEEP, { cls: 'var-sheet' });
  d.setAttribute('aria-labelledby', 'var-h');
  const close = () => { d.close(); d.remove(); };
  const fail = (e) => { const p = d.querySelector('.err'); p.textContent = e.message; p.hidden = false; };
  const reload = async (msg) => { toast(msg); cache.delete(personId); ensure(fam, personId, true); close(); done?.(); };
  d.addEventListener('click', async (e) => {
    if (e.target.closest('[data-var-close]')) { close(); return; }
    const use = e.target.closest('[data-var-use]');
    if (use) {
      try { const j = await api(`/api/variants/${use.dataset.varUse}/choose?${famQ(fam)}`, { method: 'POST', body: JSON.stringify({ family: fam }) }); await reload(`Hồ sơ hiển thị: ${j.value}`); } catch (x) { fail(x); }
      return;
    }
    const del = e.target.closest('[data-var-del]');
    if (del) {
      const vid = del.dataset.varDel; confirmDanger({ title: 'Xoá giá trị này?', lose: 'Giá trị khác này bị xoá khỏi danh sách.', confirm: 'Xoá vĩnh viễn', onConfirm: async () => { await api(`/api/variants/${vid}?${famQ(fam)}`, { method: 'DELETE' }); await reload('Đã xoá giá trị.'); } });
      return;
    }
    if (e.target.closest('[data-var-save]')) {
      const val = d.querySelector('[data-var-value]').value; const src = d.querySelector('[data-var-source]').value; const q = d.querySelector('[data-var-quality]').value;
      try { await api(`/api/persons/${encodeURIComponent(personId)}/variants?${famQ(fam)}`, { method: 'POST', body: JSON.stringify({ family: fam, field, value: val, source: src, quality: q }) }); await reload('Đã thêm giá trị.'); } catch (x) { fail(x); }
    }
  });
  d.addEventListener('close', () => d.remove());
}

// An editor adding the first other value for a field: same form, from the person ⋯ menu ("Thêm nguồn khác").
export function openAdd({ fam, personId, personName, done }) {
  const d = document.createElement('dialog'); d.className = 'dlg var-sheet';
  d.innerHTML = `<div class="form-stack"><h2>Thêm giá trị từ nguồn khác · ${esc(personName)}</h2>
    <p class="sub">Giá trị đang có vẫn giữ nguyên; hồ sơ ghi lại cả hai cùng nguồn.</p>
    <label>Mục<select data-var-field>${Object.entries(FIELDS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
    <label>Giá trị<input data-var-value maxlength="200" autocomplete="off"></label>
    <label>Nguồn<input data-var-source maxlength="300" placeholder="Bia mộ, gia phả trang…, lời kể của ai…"></label>
    <label>Độ tin cậy<select data-var-quality>${Object.entries(QUALITY).map(([k, l]) => `<option value="${k}"${k === 'binh_thuong' ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <p class="err" hidden></p>
    <div class="row end"><button type="button" class="btn gh" data-var-close>Huỷ</button><button type="button" class="btn" data-var-save>Lưu</button></div></div>`;
  document.body.append(d); d.showModal();
  const close = () => { d.close(); d.remove(); };
  d.querySelector('[data-var-close]').onclick = close;
  d.querySelector('[data-var-save]').onclick = async () => {
    const body = { family: fam, field: d.querySelector('[data-var-field]').value, value: d.querySelector('[data-var-value]').value, source: d.querySelector('[data-var-source]').value, quality: d.querySelector('[data-var-quality]').value };
    try { await api(`/api/persons/${encodeURIComponent(personId)}/variants?${famQ(fam)}`, { method: 'POST', body: JSON.stringify(body) }); toast('Đã thêm giá trị.'); cache.delete(personId); ensure(fam, personId, true); close(); done?.(); } catch (x) { const p = d.querySelector('.err'); p.textContent = x.message; p.hidden = false; }
  };
}

// Delegated: the profile's "N nguồn khác nhau" tags.
export function wire(root, { fam, nameOf, done }) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-variants]'); if (!b || !root.contains(b)) return;
    openSheet({ fam: fam(), personId: b.dataset.pid, personName: nameOf(b.dataset.pid), field: b.dataset.variants, done });
  });
}
