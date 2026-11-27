// The add flow for every "add new person" entry point (toolbar +, add relative, the tree's Thêm người, ...):
//   step 1  search the tree (accent-insensitive). A tap uses that person (onPicked(id, 'existing')).
//           "Không thấy — tạo người mới" goes on.
//   step 2  the basic data: name, sex, birth and death (smart dates). Before anything is saved, the tree is checked for
//           people this one may be (POST /api/persons/candidates, the dupes scoring). Any match: "Có thể đã có người này"
//           with "Dùng người này" per row (an editor gets the EMPTY fields of that person filled, through the normal
//           edit path, never an overwrite) and one secondary "Vẫn tạo mới". No match: saved directly.
//   A member or guest sends a suggestion (Góp ý) instead of saving; the same check runs first.
// onPicked(id, how): how = 'existing' | 'created'; a suggestion calls onPicked(null, 'suggested').
import * as S from './store.js';
import { esc, years } from './model.js';
import { calmRow, toast, fmtDate } from './ui.js';
import { searchPeople } from './fuzzy.js';
import { parseSmartDate, fullDate, yearOf, suggestGen, suggestThu, inferThuBase } from './formrules.js';

const BASE = ['name', 'sex', 'born', 'birth_date', 'died', 'death_date']; // the basic data; other prefilled keys (parent, gen, ...) ride along

let dlg = null;
function openDlg(html) {
  dlg?.remove();
  const d = document.createElement('dialog'); d.className = 'dlg rel-sheet add-sheet';
  d.innerHTML = `<div class="rel-body">${html}</div>`;
  document.body.append(d); d.showModal(); dlg = d;
  d.addEventListener('close', () => { d.remove(); if (dlg === d) dlg = null; });
  return d;
}
const closeDlg = () => dlg?.close();
// An error goes to the dialog that is open now (the duplicate list replaces the form).
function showErr(m) {
  const b = dlg?.querySelector('.rel-body'); if (!b) return;
  let e = b.querySelector('.err'); if (!e) { e = document.createElement('p'); e.className = 'err'; e.setAttribute('role', 'alert'); b.append(e); }
  e.textContent = m; e.hidden = false;
}

// Step 1: the search. fam: the family; people: its people (the list the search runs over); q: the text already typed.
export function addSearch({ fam, people, q = '', prefill = {}, title = 'Thêm người', onPicked, model = null }) {
  const st = { q: String(q || '') };
  const results = () => {
    const t = st.q.trim(); if (!t) return '';
    const list = searchPeople(people, t, { all: true, limit: 8 });
    return list.length
      ? `<p class="sub">Kết quả (${list.length})</p>` + list.map((p) => calmRow({ attrs: `data-pick="${esc(p.id)}"`, sex: p.data.sex, title: esc(p.data.name), dense: true,
        subtitle: esc([p.data.gen ? 'Đời ' + p.data.gen : '', years(p.data)].filter(Boolean).join(' · ')) })).join('')
      : '';
  };
  const d = openDlg(`<div class="rel-head"><div><h2>${esc(title)}</h2><p class="sub">Bước 1 / 2 · Có người này trong họ chưa?</p></div></div>
    <label class="fld">Tìm người<input id="add-q" type="search" autocomplete="off" value="${esc(st.q)}" placeholder="Nhập tên"></label>
    <div class="add-res">${results()}</div>
    <div class="rel-foot"><button class="btn ter" type="button" data-x>Huỷ</button><button class="btn" type="button" data-new>Không thấy — tạo người mới</button></div>`);
  const qi = d.querySelector('#add-q');
  qi.addEventListener('input', (e) => { st.q = e.target.value; d.querySelector('.add-res').innerHTML = results(); });
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return closeDlg();
    const pk = e.target.closest('[data-pick]');
    if (pk) { closeDlg(); return onPicked?.(pk.dataset.pick, 'existing'); }
    if (e.target.closest('[data-new]')) return addBasic({ fam, prefill, title, name: st.q.trim(), onPicked, model });
  });
  qi.focus();
}

// Possible duplicates of the entered data in this tree (the server scores them; a guest sees deceased people only).
async function candidates(fam, data) {
  const r = await fetch('/api/persons/candidates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: fam, data }) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).items || [];
}

// Step 2: the basic data form. prefill: what the entry point knows (name, sex, born/died, and extras such as parent).
// model: { people, byId } of the family (M.ps, M.byId) for the derived fields the full form used to store (Đời and Thứ of a child).
export function addBasic({ fam, prefill = {}, title = 'Thêm người', name = '', onPicked, model = null }) {
  const extra = {}; for (const [k, x] of Object.entries(prefill)) if (!BASE.includes(k) && x !== '' && x != null) extra[k] = x;
  // Đời (from the parent, when the entry gave none) and Thứ (the order among the siblings by birth year), as the full form stores them
  const derive = (data) => {
    const out = {};
    if (!model || !extra.parent) return out;
    if (extra.gen == null) { const g = suggestGen(extra.parent, model.byId); if (g) out.gen = g; }
    const thu = suggestThu({ parentId: extra.parent, year: data.born ? Number(data.born) : null, people: model.people, base: inferThuBase(model.people) });
    if (thu != null) out.thu = String(thu);
    return out;
  };
  const val = { name: String(prefill.name || name || '').trim(), sex: prefill.sex || '', birth: prefill.birth_date || prefill.born || '', death: prefill.death_date || prefill.died || '' };
  const sexOpt = (v, label) => `<option value="${v}"${val.sex === v ? ' selected' : ''}>${label}</option>`;
  const d = openDlg(`<div class="rel-head"><div><h2>${esc(title)}</h2><p class="sub">Bước 2 / 2 · Thông tin cơ bản</p></div></div>
    <form id="add-f" class="form-stack" novalidate>
      <label class="fld">Tên<input name="name" autocomplete="off" value="${esc(val.name)}" required></label>
      <label class="fld">Giới tính<select name="sex"><option value="">Chưa rõ</option>${sexOpt('m', 'Nam')}${sexOpt('f', 'Nữ')}</select></label>
      <label class="fld">Sinh<input name="birth" inputmode="numeric" autocomplete="off" placeholder="1963 hoặc 5/3/1963" value="${esc(val.birth)}"></label>
      <label class="fld">Mất<input name="death" inputmode="numeric" autocomplete="off" placeholder="để trống nếu chưa có" value="${esc(val.death)}"></label>
      <p class="err" role="alert" hidden></p>
      <div class="rel-foot"><button class="btn ter" type="button" data-x>Huỷ</button><button class="btn" type="submit">Lưu</button></div>
    </form>`);
  const form = d.querySelector('#add-f');
  const fail = showErr;
  d.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) closeDlg(); });
  form.querySelector('[name="name"]').focus();

  // what is saved: the basic data as the server stores it (year text, and the full date only when it is one)
  const build = (f) => {
    const b = parseSmartDate(f.get('birth')); if (!b.ok) return { err: b.error };
    const x = parseSmartDate(f.get('death')); if (!x.ok) return { err: x.error };
    if (b.kind !== 'empty' && x.kind !== 'empty' && Number(x.year) < Number(b.year)) return { err: 'Năm mất trước năm sinh.' };
    const sex = f.get('sex'); const data = { name: String(f.get('name') || '').trim(), sex: sex === 'm' || sex === 'f' ? sex : '',
      born: yearOf(b), birth_date: fullDate(b), died: yearOf(x), death_date: fullDate(x) };
    for (const k of Object.keys(data)) if (!data[k]) delete data[k];
    return { data };
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = build(new FormData(form));
    if (r.err) return fail(r.err);
    if (!r.data.name) return fail('Nhập tên người.');
    let items = [];
    try { items = await candidates(fam, r.data); } catch { toast('Chưa kiểm tra được người trùng. Lưu vẫn được.'); }
    if (items.length) return showDup(items, r.data);
    return save(r.data);
  });

  // "Có thể đã có người này": one row per possible match; one secondary action to create anyway.
  function showDup(items, data) {
    const rows = items.map((c) => `<div class="add-dup"><div class="grow"><b>${esc(c.name)}</b>
        <span class="sub">${esc([c.years, Math.round(c.score * 100) + '%'].filter(Boolean).join(' · '))}</span>
        <span class="sub">${esc((c.reasons || []).slice(0, 3).join('; '))}</span></div>
        <button type="button" class="btn sm" data-use="${esc(c.id)}">Dùng người này</button></div>`).join('');
    const d2 = openDlg(`<div class="rel-head"><div><h2>Có thể đã có người này</h2><p class="sub">${esc(data.name)} · kiểm tra trước khi tạo</p></div></div>
      <div class="add-dups">${rows}</div>
      <div class="rel-foot"><button class="btn ter" type="button" data-back>Quay lại</button><button class="btn gh" type="button" data-create>Vẫn tạo mới</button></div>`);
    d2.addEventListener('click', (e) => {
      if (e.target.closest('[data-x]')) return closeDlg();
      const u = e.target.closest('[data-use]'); if (u) return useExisting(u.dataset.use, data);
      if (e.target.closest('[data-create]')) return save(data);
      if (e.target.closest('[data-back]')) return addBasic({ fam, title, model, prefill: { ...extra, name: data.name, sex: data.sex, born: data.birth_date || data.born || '', died: data.death_date || data.died || '' }, onPicked });
    });
  }

  // Dùng người này: an editor fills the existing person's EMPTY basic fields (a normal edit, so it is in the history);
  // nothing is overwritten. A member or guest only goes to that person.
  async function useExisting(id, data) {
    const cur = S.get(id)?.data || {};
    const fill = {};
    if (S.isEditor()) for (const k of BASE) if (data[k] && (cur[k] == null || cur[k] === '')) fill[k] = data[k];
    try {
      if (Object.keys(fill).length) await S.edit(id, fill, fam);
    } catch (x) { return showErr(x.message); }
    closeDlg();
    toast(Object.keys(fill).length ? 'Đã bổ sung các mục còn trống' : 'Đã chọn người này');
    onPicked?.(id, 'existing');
  }

  // Create: an editor saves the person (the same ops as the full form); a member or guest sends a suggestion.
  async function save(data) {
    const rec = { ...extra, ...derive(data), ...data };
    try {
      if (S.isEditor()) {
        const id = S.newId();
        await S.edit(id, { ...rec, source: 'Bổ sung ' + fmtDate(Date.now()) }, fam);
        closeDlg(); toast('Đã lưu');
        onPicked?.(id, 'created');
      } else {
        const j = await S.suggest({ family: fam, person_id: null, changes: rec, by_name: '', by_contact: '', note: '', website: '' });
        S.addReceipt(j.id, j.receipt);
        closeDlg(); toast('Đã gửi góp ý. Bạn xem lại trong Góp ý của tôi.');
        onPicked?.(null, 'suggested');
      }
    } catch (x) { showErr(x.message); }
  }
}
