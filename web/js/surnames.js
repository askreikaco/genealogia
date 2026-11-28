// Họ qua các thời kỳ (surname over time) on the person profile: one fact group with the person's timeline (đổi họ,
// họ khi sinh, bí danh) and the surname a descendant inherits when no change is recorded. Editors remove a mark here;
// marks are added and changed in the person form ("+ Họ khác", person-form.js/app.js fpSurnames). Writes go through the
// store's edit() (the same op path as every other field). Family họ gốc card (Cài đặt dòng họ) is here too.
// Rules: surname-rules.js (copy of server/surname-rules.js).
import { esc } from './model.js';
import { timelineOf, surnameAt, yearOf } from './surname-rules.js';
import { dangerButton, confirmDanger } from './danger.js';
import { section } from './ui.js';

export const TYPE_LABEL = { birth: 'Họ khi sinh', changed: 'Đổi họ', aka: 'Họ khác (bí danh)', religious: 'Họ tôn giáo', abroad: 'Họ dùng ở nước ngoài' };
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
    + (editor ? ` ${dangerButton('Xóa', `data-surn-del="${i}"`, { size: 'sm' })}` : '')]);
  if (!list.length && inh.surname && inh.source === 'inherited') rows.push(['Theo cha', `<b>${esc(inh.surname)}</b> <span class="sub">kế thừa, chưa có mốc riêng</span>`]);
  // No marks and nothing inherited: no fact group (a person with no facts stays bare; marks are added in the person form)
  if (!list.length && !(inh.surname && inh.source === 'inherited')) return null;
  return { title: 'Họ', rows };
}

// Delegated handler for the profile: remove a mark (editors). edit(id, fields) = store.edit.
export function bindSurnames(main, id, d, { edit }) {
  const list = () => timelineOf(d);
  main._surnOff?.(); // the profile's element is reused between renders: drop the last handler first
  const onClick = async (ev) => {
    const del = ev.target.closest('[data-surn-del]'); if (!del) return;
    const i = Number(del.dataset.surnDel); const e = list()[i]; if (!e) return;
    confirmDanger({ title: `Xóa mốc họ “${e.surname}”?`, lose: 'Mốc này sẽ được gỡ khỏi hồ sơ người này.', restore: 'Có thể thêm lại sau.', confirm: 'Xóa',
      onConfirm: () => edit(id, { names: list().filter((_, j) => j !== i) }) });
  };
  main.addEventListener('click', onClick);
  main._surnOff = () => { main.removeEventListener('click', onClick); };
}

// Family họ gốc card (Cài đặt dòng họ). Admins edit; others read what their visibility allows.
export function originCardHtml(f, admin) {
  const vis = f.origin_visibility || 'members';
  if (!admin) {
    if (!f.origin_surname) return '';
    return section('Họ gốc', `<p><b>${esc(f.origin_surname)}</b>${f.origin_surname_han ? ` <span lang="zh-Hant">${esc(f.origin_surname_han)}</span>` : ''}${f.origin_year ? ` · đổi họ ${esc(f.origin_year)}` : ''}</p>${f.origin_reason ? `<p class="sub">${esc(f.origin_reason)}</p>` : ''}`, { variant: 'card', attrs: 'id="origin"' });
  }
  return section('Họ gốc', `
    <form id="origin-form" class="form-stack">
      <label class="fld">Họ gốc<input name="origin_surname" value="${esc(f.origin_surname || '')}" maxlength="40" placeholder="ví dụ: Lý"></label>
      <label class="fld">Chữ Hán của họ gốc<input name="origin_surname_han" value="${esc(f.origin_surname_han || '')}" maxlength="40" lang="zh-Hant"></label>
      <label class="fld">Năm đổi họ<input name="origin_year" value="${esc(f.origin_year || '')}" maxlength="20" placeholder="1232"></label>
      <label class="fld">Lý do (tùy chọn)<input name="origin_reason" value="${esc(f.origin_reason || '')}" maxlength="200"></label>
      <fieldset class="fvis-set"><legend>Ai thấy họ gốc và lý do</legend>
        ${Object.entries(ROLE_NAMES).map(([v, l]) => `<label class="radio"><input type="radio" name="origin_visibility" value="${v}" ${vis === v ? 'checked' : ''}> <span>${esc(l)}</span></label>`).join('')}
      </fieldset>
      <div class="row end"><button class="btn">Lưu họ gốc</button></div><p class="err" hidden></p>
    </form>`, { variant: 'card', attrs: 'id="origin"' });
}
