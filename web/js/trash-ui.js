// Thùng rác page (Thêm › Thùng rác), the person delete flow (impact, reason, approval) and the badges.
// Server: server/trash.js. Every destructive control here comes from danger.js (guard test).
import { esc } from './model.js';
import { toast, fmtTime, tag, card as cardBox } from './ui.js';
import { dangerButton, dangerZone, dangerLabel, confirmDanger, undoToast, restoreTrash } from './danger.js';

const q = (fam) => `family=${encodeURIComponent(fam)}`;
async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Lỗi ' + r.status);
  return j;
}

// Person delete: impact first, a reason, the typed name; big deletes become a request (second owner/admin or 24 h).
export async function askDeletePerson({ p, fam, onDone }) {
  let im = null;
  try { im = await api('GET', `/api/persons/${encodeURIComponent(p.id)}/impact?${q(fam)}`); } catch { /* offline: no preview */ }
  const name = p.data.name;
  const lose = im ? `Ảnh hưởng: ${im.descendants} con cháu, ${im.relations} quan hệ, ${im.events} sự kiện. Người này bị ẩn khỏi cây; quan hệ và sự kiện không bị xóa theo.` : 'Người này bị ẩn khỏi cây; quan hệ không bị xóa theo.';
  const need = !im?.needsApproval ? '' : im.approvers ? ' Vì ảnh hưởng lớn, cần một Chủ họ hoặc Quản trị khác duyệt.' : ` Vì ảnh hưởng lớn và dòng họ chỉ có một người quản trị, việc xóa chạy sau ${im.delay_hours} giờ (hủy được trong Thùng rác).`;
  const title = dangerLabel(`Xóa ${name}?`); const ok = im?.needsApproval ? 'Gửi yêu cầu xóa' : dangerLabel('Xóa người này');
  confirmDanger({ title, lose: lose + need, restore: im ? `Có thể khôi phục từ Thùng rác trong ${im.trash_days} ngày.` : 'Có thể khôi phục từ Thùng rác.', confirm: ok, typeName: name, reason: 'Lý do xóa (bắt buộc, ghi vào lịch sử)', onConfirm: async ({ reason }) => {
    const j = await api('POST', `/api/persons/${encodeURIComponent(p.id)}/delete?${q(fam)}`, { reason });
    await onDone?.();
    if (j.pending) toast(j.needs === 'approval' ? 'Đã gửi yêu cầu xóa. Chờ một Chủ họ hoặc Quản trị khác duyệt.' : 'Đã hẹn xóa sau 24 giờ. Hủy được trong Thùng rác.');
    else undoToast(`Đã xóa ${name} · trong Thùng rác`, async () => { await restoreTrash(fam, j.trash_id); await onDone?.(); });
  } });
}

const ST = { items: null, err: '' };
const when = (x) => (x ? fmtTime(x) : '');
function card(t, d) {
  const acts = [];
  if (t.state === 'pending') {
    if (d.can_archive && !t.mine) acts.push(dangerButton('Duyệt xóa', `data-tr-approve="${t.id}"`, { size: 'sm' }), `<button type="button" class="btn ter sm" data-tr-reject="${t.id}">Từ chối</button>`);
    if (t.mine || d.can_archive) acts.push(`<button type="button" class="btn gh sm" data-tr-cancel="${t.id}">Hủy yêu cầu</button>`);
  } else {
    if (t.state === 'trash' || d.can_archive) acts.push(`<button type="button" class="btn sm" data-tr-restore="${t.id}">Khôi phục</button>`);
    if (t.state === 'trash' && d.can_archive) acts.push(dangerButton('Dọn', `data-tr-archive="${t.id}"`, { size: 'sm' }));
    if (d.can_purge) acts.push(dangerButton('Xóa vĩnh viễn ngay', `data-tr-purge="${t.id}"`, { size: 'sm' }));
  }
  const im = t.impact ? `<span class="sub">Ảnh hưởng: ${t.impact.descendants} con cháu, ${t.impact.relations} quan hệ, ${t.impact.events} sự kiện</span>` : '';
  const meta = t.state === 'pending'
    ? `Đề nghị: ${esc(t.requested_by || '')} · ${when(t.requested_at)}${t.due_at ? ` · tự chạy lúc ${when(t.due_at)}` : ' · chờ duyệt'}`
    : `Người xóa: ${esc(t.deleted_by || '')} · ${when(t.deleted_at)}${t.days_left != null ? ` · còn ${t.days_left} ngày` : ''}`;
  return `${cardBox(`<div class="row btw"><b>${esc(t.label)}</b>${tag(`${esc(t.kind_vi)}`, { sm: true })}</div>
    ${t.reason ? `<span class="sub">Lý do: ${esc(t.reason)}</span>` : ''}${im}<span class="sub">${meta}</span>
    ${acts.length ? `<div class="row wrap tr-acts">${acts.join('')}</div>` : ''}`, { tag: 'li', cls: 'tr-item', attrs: `data-tr="${t.id}"` })}`;
}
export function trashPage(main, { fam, isAdmin }) {
  const paint = () => {
    const d = ST.d;
    if (!d) { main.innerHTML = `<h1>Thùng rác</h1>${ST.err ? `<p class="err">${esc(ST.err)}</p>` : '<p class="sub">Đang tải…</p>'}`; return; }
    const by = (s) => d.items.filter((t) => t.state === s);
    const sec = (title, list, note) => (list.length ? `<section class="tr-sec" aria-label="${esc(title)}"><h2 class="tl-lbl">${esc(title)} (${list.length})</h2>${note ? `<p class="sub">${esc(note)}</p>` : ''}<ul class="tr-list">${list.map((t) => card(t, d)).join('')}</ul></section>` : '');
    const trash = by('trash');
    main.innerHTML = `<h1>Thùng rác</h1>
      <p class="sub">Khôi phục trong ${d.days.trash} ngày; sau đó vào lưu trữ, Chủ họ/Quản trị khôi phục được. Dữ liệu lịch sử được giữ mãi.</p>
      ${sec('Chờ duyệt xóa', by('pending'), 'Người có con cháu hoặc nhiều quan hệ: việc xóa cần một Chủ họ hoặc Quản trị khác duyệt.')}
      ${trash.length ? sec('Đã xóa', trash) : '<p class="sub tr-empty">Thùng rác trống.</p>'}
      ${d.can_archive ? sec('Lưu trữ', by('archive'), 'Chỉ Chủ họ, Quản trị thấy và khôi phục.') : ''}
      ${d.can_archive && trash.length ? dangerZone([dangerButton('Dọn thùng rác', 'data-tr-archive="all"')], { note: 'Chuyển mọi mục trong Thùng rác vào lưu trữ.' }) : ''}`;
  };
  const load = async () => {
    try { ST.d = await api('GET', `/api/trash?${q(fam)}`); ST.err = ''; } catch (e) { ST.d = null; ST.err = e.message; }
    paint(); api('POST', `/api/trash/seen?${q(fam)}`, {}).catch(() => {});
  };
  ST.d = null; paint(); load();
  if (main.dataset.trWired) return; main.dataset.trWired = '1';
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tr-restore],[data-tr-archive],[data-tr-purge],[data-tr-approve],[data-tr-reject],[data-tr-cancel]');
    if (!b || !main.querySelector('.tr-sec, .tr-empty')) return;
    const ds = b.dataset; const id = ds.trRestore || ds.trArchive || ds.trPurge || ds.trApprove || ds.trReject || ds.trCancel; const t = ST.d?.items.find((x) => String(x.id) === id);
    const go = async (path, msg, body = {}) => { await api('POST', `/api/trash/${encodeURIComponent(id)}/${path}?${q(fam)}`, body); toast(msg); await load(); };
    const run = (fn) => fn().catch((x) => toast(x.message));
    if (b.dataset.trRestore) return run(() => go('restore', `Đã khôi phục ${t?.label || ''}`));
    if (b.dataset.trReject) return run(() => go('reject', 'Đã từ chối yêu cầu xóa'));
    if (b.dataset.trCancel) return run(() => go('cancel', 'Đã hủy yêu cầu xóa'));
    if (b.dataset.trApprove) return confirmDanger({ title: dangerLabel(`Xóa ${t.label}?`), lose: `Lý do của ${t.requested_by}: ${t.reason}`, restore: `Có thể khôi phục từ Thùng rác trong ${ST.d.days.trash} ngày.`, confirm: dangerLabel('Duyệt xóa'), onConfirm: () => go('approve', `Đã chuyển ${t.label} vào Thùng rác`) });
    if (b.dataset.trArchive === 'all') return confirmDanger({ title: 'Dọn thùng rác?', lose: 'Mọi mục trong Thùng rác chuyển vào lưu trữ; chỉ Chủ họ, Quản trị khôi phục được.', restore: `Chủ họ, Quản trị khôi phục được.`, confirm: 'Dọn thùng rác', onConfirm: () => go('archive', 'Đã dọn thùng rác') });
    if (b.dataset.trArchive) return confirmDanger({ title: `Chuyển “${t.label}” vào lưu trữ?`, lose: 'Mục này rời Thùng rác; chỉ Chủ họ, Quản trị khôi phục được.', restore: `Chủ họ, Quản trị khôi phục được.`, confirm: 'Chuyển vào lưu trữ', onConfirm: () => go('archive', 'Đã chuyển vào lưu trữ') });
    if (b.dataset.trPurge) return confirmDanger({ title: dangerLabel(`Xóa vĩnh viễn “${t.label}”?`), lose: 'Dữ liệu của mục này bị xóa hẳn. Lịch sử sửa vẫn ghi lại việc xóa.', confirm: 'Xóa vĩnh viễn', typeName: t.label, onConfirm: () => go('purge', 'Đã xóa vĩnh viễn', { confirm: t.label }) });
  });
  void isAdmin;
}

// Badges: Thêm › Thùng rác (pending requests + unread notices); a notice on the review page when requests wait.
export async function decorate(view, main, { fam, hf }) {
  let c = null; try { c = await api('GET', `/api/trash/count?${q(fam)}`); } catch { return; }
  const n = (c.pending || 0) + (c.unread || 0);
  if (view === 'more') { const s = main.querySelector('[data-trash-badge]'); if (s && n) s.innerHTML = ` <b class="badge">${n}</b>`; }
  if (view === 'review' && c.pending && !main.querySelector('.tr-note')) {
    main.insertAdjacentHTML('afterbegin', `<div class="ntc tr-note" role="note"><b>${c.pending} yêu cầu xóa người chờ duyệt</b><a class="btn ter sm" href="${hf('thung-rac')}">Mở Thùng rác</a></div>`);
  }
}
