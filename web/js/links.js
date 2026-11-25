// "Same person" links between family trees (server: links-routes.js). All trees are equal: a link only says that a
// record here and a record in another tree are one person; nothing is copied. Links are fetched per family when a
// family page is drawn (one small request, cached for a minute) and are not part of the offline store: offline the
// profile simply shows no link line. Owner/admin of both trees -> accepted at once; otherwise pending for the other tree.
import { esc } from './model.js';
import { toast } from './ui.js';
import { personItem } from './person-item.js';

const cache = new Map(); // family -> { at, items, byPerson: Map(personId -> link[]) }
const loading = new Map();
let onChange = () => {};
export const setOnChange = (fn) => { onChange = fn; };
const href = (fam, id) => `#${fam === 'duong' ? '' : '/' + fam + '/'}person/${encodeURIComponent(id)}`;

async function getJson(url, opts) {
  const r = await fetch(url, { cache: 'no-store', ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không tải được liên kết.');
  return j;
}
// Load (or refresh after 60 s) the links of a family; calls onChange once when new data arrives.
export function ensure(fam, force = false) {
  if (!fam || fam === 'tat-ca') return;
  const c = cache.get(fam);
  if (!force && c && Date.now() - c.at < 60e3) return;
  if (loading.get(fam)) return;
  loading.set(fam, true);
  getJson('/api/links?family=' + encodeURIComponent(fam)).then((j) => {
    const byPerson = new Map();
    for (const l of j.items || []) { if (!byPerson.has(l.person)) byPerson.set(l.person, []); byPerson.get(l.person).push(l); }
    const before = JSON.stringify(c?.items || []);
    cache.set(fam, { at: Date.now(), items: j.items || [], byPerson });
    if (before !== JSON.stringify(j.items || [])) onChange();
  }).catch(() => { cache.set(fam, { at: Date.now(), items: [], byPerson: new Map() }); }).finally(() => loading.delete(fam));
}
export const linksOf = (fam, personId) => cache.get(fam)?.byPerson.get(personId) || [];
// Ids of people in this family with an accepted link (tree node mark).
export const linkedIds = (fam) => new Set((cache.get(fam)?.items || []).filter((l) => l.status === 'accepted').map((l) => l.person));
// Tree context: the first accepted link of a root of this tree whose other side has (visible) parents in its tree.
export function upLinkOf(fam, rootIds) {
  return (cache.get(fam)?.items || []).find((l) => l.status === 'accepted' && rootIds.has(l.person) && (l.other_parents || []).length) || null;
}
// Accepted links of a person to a tree where that person has no parent (a root there): "↓ Cây X".
export const downLinksOf = (fam, personId) => linksOf(fam, personId).filter((l) => l.status === 'accepted' && l.other_has_parents === false);
export const treeHref = (fam, id) => `#${fam === 'duong' ? '' : '/' + fam + '/'}tree/@${encodeURIComponent(id)}`;
export const pendingIncoming = (fam) => (cache.get(fam)?.items || []).filter((l) => l.status === 'pending' && l.can_decide);

// Profile line(s) under the Quan hệ heading; clan: the "Xem cả họ X ›" link (clan.js), shown once a link is accepted.
export function linesHtml(fam, personId, { clan = '' } = {}) {
  const ls = linksOf(fam, personId);
  if (!ls.length) return '';
  return `<div class="xlinks">${ls.map((l) => l.status === 'accepted'
    ? `<a class="xlink" href="${href(l.other_family, l.other_person)}"><span class="xlink-i" aria-hidden="true">⇄</span><span>Cũng có trong cây: <b>${esc(l.other_label)}</b>${l.other_name ? ' · ' + esc(l.other_name) : ''}${l.other_years ? ' · ' + esc(l.other_years) : ''}</span><span aria-hidden="true">›</span></a>`
    : `<p class="xlink pend"><span class="xlink-i" aria-hidden="true">⇄</span><span>${l.incoming ? `Cây <b>${esc(l.other_label)}</b> đề nghị liên kết${l.other_name ? ' với ' + esc(l.other_name) : ''}` : `Đang chờ cây <b>${esc(l.other_label)}</b> duyệt liên kết`}</span></p>`).join('')}${clan && ls.some((l) => l.status === 'accepted') ? clan : ''}</div>`;
}

// Link sheet: pick the other family, search a person there, a reason, save.
// families: [{ id, label }] the viewer can read, excluding the current one.
export function openSheet({ fam, personId, personName, families, done }) {
  if (!families.length) { toast('Chưa có cây nào khác để liên kết. Theo dõi hoặc lập thêm một dòng họ trước.'); return; }
  const d = document.createElement('dialog'); d.className = 'dlg xlink-sheet';
  d.innerHTML = `<form method="dialog" class="form-stack">
    <h2>Liên kết với người ở cây khác</h2>
    <p class="sub">${esc(personName)} ở cây này là cùng một người với ai ở cây khác? Liên kết không gộp và không chép dữ liệu; mỗi cây giữ dữ liệu của mình.</p>
    <label>Cây khác<select name="fam">${families.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join('')}</select></label>
    <label>Tìm người<input name="q" type="search" autocomplete="off" placeholder="Gõ tên (ít nhất 2 chữ)"></label>
    <div class="xl-res calm-list" role="listbox" aria-label="Kết quả"></div>
    <input type="hidden" name="other">
    <label>Vì sao là cùng một người<input name="reason" maxlength="300" placeholder="Ví dụ: cùng tên, năm sinh, cha mẹ"></label>
    <p class="err" hidden></p>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Huỷ</button><button class="btn" data-save disabled>Liên kết</button></div>
  </form>`;
  document.body.append(d); d.showModal();
  const f = d.querySelector('form'); const res = d.querySelector('.xl-res'); const err = d.querySelector('.err'); const save = d.querySelector('[data-save]');
  let t = 0;
  const search = async () => {
    const q = f.q.value.trim(); f.other.value = ''; save.disabled = true;
    if (q.length < 2) { res.innerHTML = ''; return; }
    try {
      const j = await getJson(`/api/links/search?family=${encodeURIComponent(f.fam.value)}&q=${encodeURIComponent(q)}`);
      res.innerHTML = j.items.map((p) => personItem({ name: p.name }, { attrs: `role="option" data-pick="${esc(p.id)}"`, tile: false, dense: true, sub: esc([p.years, p.gen ? 'Đời ' + p.gen : ''].filter(Boolean).join(' · ')) })).join('') || '<p class="sub">Không thấy ai khớp.</p>';
    } catch (e) { res.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  f.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 250); });
  f.fam.addEventListener('change', search);
  res.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    res.querySelectorAll('[data-pick]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    f.other.value = b.dataset.pick; save.disabled = false;
  });
  d.querySelector('[data-cancel]').onclick = () => { d.close(); d.remove(); };
  f.onsubmit = async (e) => {
    e.preventDefault(); err.hidden = true;
    try {
      const j = await getJson('/api/links', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ family: fam, person: personId, other_family: f.fam.value, other_person: f.other.value, reason: f.reason.value }) });
      d.close(); d.remove();
      toast(j.status === 'accepted' ? 'Đã liên kết.' : 'Đã gửi đề nghị liên kết. Cây kia sẽ duyệt.');
      ensure(fam, true); ensure(f.fam.value, true); done?.();
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  };
}

// Review page rows: incoming pending links for families the viewer administers.
export function pendingHtml(fam) {
  const ls = pendingIncoming(fam);
  if (!ls.length) return '';
  return `<section class="cd xl-pend"><h2>Liên kết chờ duyệt</h2>${ls.map((l) => `<div class="rv"><p>Cây <b>${esc(l.other_label)}</b> đề nghị: <a href="${href(fam, l.person)}">người này</a> là cùng một người với <b>${esc(l.other_name || '(riêng tư)')}</b>${l.reason ? ` · “${esc(l.reason)}”` : ''}</p><div class="row end"><button type="button" class="btn ter sm" data-xl="reject" data-id="${l.id}">Không nhận</button><button type="button" class="btn sm" data-xl="accept" data-id="${l.id}">Nhận</button></div></div>`).join('')}</section>`;
}
export function wirePending(root, fam) {
  root.querySelectorAll('[data-xl]').forEach((b) => { b.onclick = async () => {
    try { await getJson(`/api/links/${b.dataset.id}/${b.dataset.xl}`, { method: 'POST' }); toast(b.dataset.xl === 'accept' ? 'Đã nhận liên kết.' : 'Đã từ chối.'); ensure(fam, true); }
    catch (e) { toast(e.message); }
  }; });
}
