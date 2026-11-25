// "Tạo cây cho nhánh này": a branch tree by reference (server: branch-routes.js). The home tree shows "Cây nhánh: <tên>"
// under the root person; a branch tree shows one banner (its home, its root, what you may do). The branch's people are
// read from the home tree by the server, so the store and the tree views need no change here.
import { esc } from './model.js';
import { toast } from './ui.js';
import { confirmDanger, dangerButton } from './danger.js';

const lists = new Map(); // home family -> { at, items }
const infos = new Map(); // family -> branch info, or null when it is not a branch
const busy = new Set();
let onChange = () => {};
export const setOnChange = (fn) => { onChange = fn; };
const hashOf = (fam) => `#${fam === 'duong' ? '' : '/' + fam + '/'}tree`;

async function getJson(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Không tải được cây nhánh.'); e.status = r.status; throw e; }
  return j;
}
// Branch trees of a home tree (cached a minute); a branch or the "tat-ca" view asks nothing.
export function ensureBranches(fam) {
  if (!fam || fam === 'tat-ca' || infos.get(fam)) return;
  const c = lists.get(fam);
  if (c && Date.now() - c.at < 60e3) return;
  if (busy.has('l' + fam)) return;
  busy.add('l' + fam);
  getJson('/api/branch-trees?family=' + encodeURIComponent(fam)).then((j) => {
    const before = JSON.stringify(c?.items || []);
    lists.set(fam, { at: Date.now(), items: j.items || [] });
    if (before !== JSON.stringify(j.items || [])) onChange();
  }).catch(() => { lists.set(fam, { at: Date.now(), items: [] }); }).finally(() => busy.delete('l' + fam));
}
// Info of a family that may be a branch (asked once). A home tree answers 400, so it is remembered as not a branch.
export function ensureInfo(fam) {
  if (!fam || fam === 'tat-ca' || infos.has(fam) || busy.has('i' + fam)) return;
  busy.add('i' + fam);
  getJson('/api/branch-trees/' + encodeURIComponent(fam)).then((j) => { infos.set(fam, j.branch ? j : null); if (j.branch) onChange(); })
    .catch(() => { infos.set(fam, null); }).finally(() => busy.delete('i' + fam));
}
export const isBranch = (fam) => !!infos.get(fam);

// Under the root person of a home tree: "Cây nhánh: <tên> ›" for each branch rooted at this person that the viewer may see.
export function rootLinkHtml(fam, personId) {
  const items = (lists.get(fam)?.items || []).filter((b) => b.root === personId);
  return items.map((b) => `<a class="xlink" href="${hashOf(b.id)}"><span class="xlink-i" aria-hidden="true">⇄</span><span>Có cây nhánh: <b>${esc(b.name)}</b></span><span aria-hidden="true">›</span></a>`).join('');
}

// Banner on a branch tree: its root, its home tree, and (for owners and admins) delete.
export function bannerHtml(fam) {
  const i = infos.get(fam); if (!i) return '';
  const home = i.home ? `<a href="${hashOf(i.home.id)}">Xem cây gốc${i.home.short_name || i.home.name ? ' · ' + esc(i.home.short_name || i.home.name) : ''} ›</a>` : '';
  return `<section class="btree-bar" aria-label="Cây nhánh"><p><b>Cây nhánh</b> của ${esc(i.root.name || 'người này')}. Người và sự kiện ở cây gốc; sửa ở đây là góp ý tới cây gốc, trừ khi bạn biên tập được ở cây gốc.</p><div class="btree-acts">${home}${i.can_manage ? dangerButton('Xóa cây nhánh…', 'data-bt-del', { size: 'sm' }) : ''}</div></section>`;
}
// Delete button of the banner (delegated from the page): removes the branch, never people.
export function deleteBranch(fam, done) {
  const i = infos.get(fam); if (!i) return;
  confirmDanger({ title: 'Xóa cây nhánh này?', lose: 'Chỉ cây nhánh bị gỡ. Mọi người, sự kiện và tiểu sử vẫn ở cây gốc.', restore: 'Có thể tạo lại cây nhánh từ người gốc bất cứ lúc nào.', confirm: 'Xóa cây nhánh', onConfirm: () => removeBranch(fam, i, done) });
}
async function removeBranch(fam, i, done) {
  try {
    await getJson('/api/branch-trees/' + encodeURIComponent(fam), { method: 'DELETE' });
    infos.delete(fam); if (i.home?.id) lists.delete(i.home.id);
    toast('Đã xóa cây nhánh. Người vẫn ở cây gốc.');
    if (i.home?.id) location.hash = hashOf(i.home.id);
    done?.();
  } catch (e) { toast(e.message); }
}

// Create sheet: the name, how many people the branch holds, and what it means. Owners and admins of the home tree only.
export function openCreate({ fam, personId, personName, done }) {
  const d = document.createElement('dialog'); d.className = 'dlg xlink-sheet btree-sheet';
  d.innerHTML = `<form method="dialog" class="form-stack">
    <h2>Tạo cây cho nhánh này</h2>
    <p class="sub" data-count>Đang đếm người trong nhánh…</p>
    <label>Tên cây nhánh<input name="name" maxlength="120" required value="${esc('Nhánh ' + personName)}"></label>
    <p class="sub">Cây nhánh là một cây mới của riêng bạn. Nó không sao chép người: người vẫn ở cây gốc, và thay đổi ở cây gốc hiện ngay ở đây.</p>
    <p class="err" hidden></p>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Huỷ</button><button class="btn" data-save>Tạo cây</button></div>
  </form>`;
  document.body.append(d); d.showModal();
  const f = d.querySelector('form'); const err = d.querySelector('.err'); const count = d.querySelector('[data-count]');
  getJson(`/api/branch-trees/preview?family=${encodeURIComponent(fam)}&person=${encodeURIComponent(personId)}`).then((j) => {
    count.textContent = `Cây sẽ có ${j.people} người: ${personName}, con cháu cùng huyết thống và vợ/chồng của họ.`;
  }).catch((e) => { count.textContent = ''; err.textContent = e.message; err.hidden = false; });
  d.querySelector('[data-cancel]').onclick = () => { d.close(); d.remove(); };
  f.onsubmit = async (e) => {
    e.preventDefault(); err.hidden = true;
    try {
      const j = await getJson('/api/branch-trees', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ family: fam, person: personId, name: f.name.value }) });
      d.close(); d.remove();
      toast('Đã tạo cây nhánh.');
      lists.delete(fam);
      done?.(j);
      location.hash = hashOf(j.id); location.reload(); // a reload: the new branch is in this account's membership list
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  };
}
