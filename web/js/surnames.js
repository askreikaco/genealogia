// Họ qua các thời kỳ (surname over time) on the person profile: one fact group with the person's timeline (đổi họ,
// họ khi sinh, bí danh), the surname a descendant inherits when no change is recorded, and an editor's form to add or
// remove a mark. Writes go through the store's edit() (the same op path as every other field). Family họ gốc card
// (Cài đặt dòng họ) is here too. Rules: surname-rules.js (copy of server/surname-rules.js).
import { esc } from './model.js';
import { NAME_TYPES, CONFIDENCE, timelineOf, surnameAt, namesError, yearOf } from './surname-rules.js';
import { dangerButton, confirmDanger } from './danger.js';

const TYPE_LABEL = { birth: 'Họ khi sinh', changed: 'Đổi họ', aka: 'Họ khác (bí danh)', religious: 'Họ tôn giáo', abroad: 'Họ dùng ở nước ngoài' };
const CONF_LABEL = { confirmed: 'đã xác nhận', tradition: 'theo truyền thống', uncertain: 'chưa chắc chắn' };
const ROLE_NAMES = { all: 'Ai cũng thấy', members: 'Thành viên', editors: 'Biên tập viên trở lên' };

const when = (e) => (e.from && e.to ? `${e.from}–${e.to}` : e.from ? `từ ${e.from}` : e.to ? `đến ${e.to}` : 'không rõ năm');

// The surname lookup for inheritance: a person's father is the parent with sex 'm' (legacy parent field).
export function surnameGetter(M) {
  return (id) => {
    const p = M.byId.get(id); if (!p) return null;
    const par = p.data.parent ? M.byId.get(p.data.parent) : null;
    return { data: p.data, father: par && par.data.sex === 'm' ? par.id || p.data.parent : null };
  };
}

// The fact group for the profile (groups list in app.js person()). editor: may add and remove marks.
export function surnameGroup(id, d, M, { editor = false } = {}) {
  const list = timelineOf(d);
  const inh = surnameAt(id, yearOf(d.born), surnameGetter(M));
  const rows = list.map((e, i) => [when(e), `<b>${esc(e.surname)}</b>${e.han ? ` <span lang="zh-Hant">${esc(e.han)}</span>` : ''}${e.given ? ` ${esc(e.given)}` : ''} · ${esc(TYPE_LABEL[e.type])}`
    + (e.reason ? `<br><span class="sub">${esc(e.reason)}</span>` : '')
    + `<br><span class="sub">${esc(CONF_LABEL[e.confidence || 'uncertain'])}${e.source ? ' · nguồn: ' + esc(e.source) : ''}</span>`
    + (editor ? ` ${dangerButton('Xóa mốc', `data-surn-del="${i}"`, { size: 'sm' })}` : '')]);
  if (!list.length && inh.surname && inh.source === 'inherited') rows.push(['Theo cha', `<b>${esc(inh.surname)}</b> <span class="sub">kế thừa, chưa có mốc riêng</span>`]);
  // No marks and nothing inherited: no fact group (the editor gets surnameAddBlock instead, so a person with no facts stays bare)
  if (!list.length && !(inh.surname && inh.source === 'inherited')) return null;
  if (editor) rows.push(['', `<button type="button" class="btn ter sm" data-surn-add>Thêm mốc họ</button><div id="surn-slot"></div>`]);
  return { title: 'Họ', rows };
}

// Editors' entry point when the Họ group is not shown (no marks yet): a button and the form slot, outside the facts card.
export function surnameAddBlock() {
  return `<div class="surn-add-block"><button type="button" class="btn ter sm" data-surn-add>Thêm mốc họ</button><div id="surn-slot"></div></div>`;
}

const opt = (v, l, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
export function surnameForm(cur = {}) {
  return `<form id="surn-form" class="form-stack surn-form">
    <label class="fld">Loại mốc<select name="type">${NAME_TYPES.map((t) => opt(t, TYPE_LABEL[t], cur.type || 'changed')).join('')}</select></label>
    <label class="fld">Họ<input name="surname" required maxlength="40" autocomplete="off"></label>
    <label class="fld">Tên gọi (nếu khác)<input name="given" maxlength="40" autocomplete="off"></label>
    <label class="fld">Chữ Hán<input name="han" maxlength="40" lang="zh-Hant" placeholder="tùy chọn"></label>
    <div class="surn-yrs"><label class="fld">Từ năm<input name="from" maxlength="20" inputmode="numeric" placeholder="1232"></label>
      <label class="fld">Đến năm<input name="to" maxlength="20" inputmode="numeric"></label></div>
    <label class="fld">Lý do<input name="reason" maxlength="200" placeholder="tùy chọn"></label>
    <label class="fld">Nguồn<input name="source" maxlength="200" placeholder="sách, bia, lời kể…"></label>
    <label class="fld">Độ chắc chắn<select name="confidence">${CONFIDENCE.map((c) => opt(c, CONF_LABEL[c], cur.confidence || 'uncertain')).join('')}</select></label>
    <div class="row end"><button type="button" class="btn ter" data-surn-cancel>Hủy</button><button class="btn">Lưu mốc họ</button></div>
    <p class="err" hidden></p></form>`;
}

// Delegated handlers for the profile: open the form, remove a mark, save a mark. edit(id, fields) = store.edit.
export function bindSurnames(main, id, d, { edit }) {
  const list = () => timelineOf(d);
  main._surnOff?.(); // the profile's element is reused between renders: drop the last handlers first
  const onClick = async (ev) => {
    const add = ev.target.closest('[data-surn-add]'); const del = ev.target.closest('[data-surn-del]'); const cancel = ev.target.closest('[data-surn-cancel]');
    if (cancel) { const slot = main.querySelector('#surn-slot'); if (slot) slot.innerHTML = ''; return; }
    if (add) { const slot = main.querySelector('#surn-slot'); if (slot) slot.innerHTML = surnameForm(); return; }
    if (del) {
      const i = Number(del.dataset.surnDel); const e = list()[i]; if (!e) return;
      confirmDanger({ title: `Xóa mốc họ “${e.surname}”?`, lose: 'Mốc này sẽ mất khỏi hồ sơ người này.', restore: 'Có thể thêm lại sau.', confirm: 'Xóa mốc',
        onConfirm: () => edit(id, { names: list().filter((_, j) => j !== i) }) });
    }
  };
  const onSubmit = async (ev) => {
    if (ev.target.id !== 'surn-form') return;
    ev.preventDefault();
    const f = ev.target; const err = f.querySelector('.err');
    const e = {};
    for (const [k, v] of new FormData(f).entries()) { const t = String(v).trim(); if (t) e[k] = t; }
    if (e.from && yearOf(e.from) == null) e.from = undefined;
    if (e.to && yearOf(e.to) == null) e.to = undefined;
    const next = [...list(), e];
    const bad = namesError(next);
    if (bad) { err.hidden = false; err.textContent = bad.replace(/^names: /, ''); return; }
    await edit(id, { names: next });
  };
  main.addEventListener('click', onClick);
  main.addEventListener('submit', onSubmit);
  main._surnOff = () => { main.removeEventListener('click', onClick); main.removeEventListener('submit', onSubmit); };
}

// Family họ gốc card (Cài đặt dòng họ). Admins edit; others read what their visibility allows.
export function originCardHtml(f, admin) {
  const vis = f.origin_visibility || 'members';
  if (!admin) {
    if (!f.origin_surname) return '';
    return `<div class="cd" id="origin"><h3>Họ gốc</h3><p><b>${esc(f.origin_surname)}</b>${f.origin_surname_han ? ` <span lang="zh-Hant">${esc(f.origin_surname_han)}</span>` : ''}${f.origin_year ? ` · đổi họ ${esc(f.origin_year)}` : ''}</p>${f.origin_reason ? `<p class="sub">${esc(f.origin_reason)}</p>` : ''}</div>`;
  }
  return `<div class="cd" id="origin"><h3>Họ gốc</h3>
    <form id="origin-form" class="form-stack">
      <label class="fld">Họ gốc<input name="origin_surname" value="${esc(f.origin_surname || '')}" maxlength="40" placeholder="ví dụ: Lý"></label>
      <label class="fld">Chữ Hán của họ gốc<input name="origin_surname_han" value="${esc(f.origin_surname_han || '')}" maxlength="40" lang="zh-Hant"></label>
      <label class="fld">Năm đổi họ<input name="origin_year" value="${esc(f.origin_year || '')}" maxlength="20" placeholder="1232"></label>
      <label class="fld">Lý do (tùy chọn)<input name="origin_reason" value="${esc(f.origin_reason || '')}" maxlength="200"></label>
      <fieldset class="fvis-set"><legend>Ai thấy họ gốc và lý do</legend>
        ${Object.entries(ROLE_NAMES).map(([v, l]) => `<label class="radio"><input type="radio" name="origin_visibility" value="${v}" ${vis === v ? 'checked' : ''}> <span>${esc(l)}</span></label>`).join('')}
      </fieldset>
      <div class="row end"><button class="btn">Lưu họ gốc</button></div><p class="err" hidden></p>
    </form></div>`;
}
