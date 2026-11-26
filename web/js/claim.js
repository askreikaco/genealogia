// Nhận quản lý (claim an unowned or abandoned tree): the notice banner and the claim / join actions on a tree page,
// the claim sheet (evidence and an optional small file), the join sheet (Kết nối cây của tôi: a person of my tree and a
// person of this tree, through the existing person links), and the app-admin review screen (#nhan-quan-ly).
// Talks to /api/claims, /api/app/claims (server/claim-routes.js) and /api/links (server/links-routes.js).
// app.js calls init() once with what it owns (dialog, confirm, render, store, hash helper).
import { esc } from './model.js';
import { toast } from './ui.js';

const deps = { dialog: null, render: () => {}, S: null };
export function init(d) { Object.assign(deps, d); }

const MAX_FILE = 700 * 1024; // raw bytes; the server refuses more (claim-rules.js MAX_FILE_BYTES)
const enc = encodeURIComponent;
const DATE_VN = (ms) => new Date(ms).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
const STATE_TXT = { unowned: 'Chưa có Chủ họ quản lý', abandoned: 'Các Chủ họ hiện có đã lâu không đăng nhập hoặc đã mất', owned: 'Đã có Chủ họ' };

async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Không thực hiện được.'); e.status = r.status; throw e; }
  return j;
}

// The tree's claim state, cached for 20 seconds (the banner reads it on every paint of the tree page).
const cache = new Map();
export async function claimState(fam, { fresh = false } = {}) {
  const hit = cache.get(fam);
  if (!fresh && hit && Date.now() - hit.at < 20e3) return hit.st;
  const st = await api('GET', `/api/claims?family=${enc(fam)}`);
  cache.set(fam, { at: Date.now(), st });
  return st;
}
const drop = (fam) => cache.delete(fam);

const readFile = (f) => new Promise((ok, err) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => err(new Error('Không đọc được tệp.'));
  r.readAsDataURL(f);
});

// The banner for the tree page: the public notice while a claim is open, and the claim / join actions when the tree
// has no active owner. Nothing is shown for a tree with an active owner and no notice.
export function bannerHtml(st, fam) {
  const lines = [];
  if (st.notice) lines.push(`<p class="cl-line"><b>Đang góp ý công khai</b> · còn ${st.notice.days_left} ngày. Ai biết về dòng họ này có thể góp ý. Sau đó quản trị ứng dụng sẽ duyệt đơn nhận quản lý.</p>`);
  if (st.state === 'owned') return lines.length ? `<div class="ntc claim-banner" role="status">${lines.join('')}</div>` : '';
  lines.push(`<p class="cl-line">${STATE_TXT[st.state] ? `<b>${esc(STATE_TXT[st.state])}.</b> ` : ''}Cây này chỉ để xem; quản trị ứng dụng chăm sóc. Bạn có thể nhận quản lý khi có bằng chứng.</p>`);
  const acts = [];
  if (st.my_claim) {
    lines.push(`<p class="cl-line">Đơn của bạn đang góp ý đến ${DATE_VN(st.my_claim.notice_until)}.</p>`);
    acts.push(`<button type="button" class="btn ter sm" data-claim-withdraw="${st.my_claim.id}" data-fam="${esc(fam)}">Rút đơn</button>`);
  } else if (st.can_claim) {
    acts.push(`<button type="button" class="btn sm" data-claim-open data-fam="${esc(fam)}">Nhận quản lý</button>`);
  } else if (st.block) {
    lines.push(`<p class="cl-line sub">${esc(st.block)}</p>`);
  }
  if (deps.S?.signedIn?.()) acts.push(`<button type="button" class="btn ter sm" data-join-open data-fam="${esc(fam)}">Kết nối cây của tôi</button>`);
  return `<div class="ntc claim-banner" role="status">${lines.join('')}${acts.length ? `<div class="cl-acts">${acts.join('')}</div>` : ''}</div>`;
}

// Decorates the tree page (app.js calls it after every paint of the tree view).
export async function decorate(main, { fam }) {
  let st;
  try { st = await claimState(fam); } catch { return; }
  main.querySelector(':scope > .claim-banner')?.remove();
  const html = bannerHtml(st, fam);
  if (html) main.insertAdjacentHTML('afterbegin', html);
}

// The claim sheet: evidence (text and/or one small file). The notice starts when the claim is sent.
export function openClaimSheet(fam) {
  deps.dialog(`<h2>Nhận quản lý ${esc(deps.S.familyName(fam))}</h2>
    <p class="sub">Dòng họ này không có Chủ họ đang quản lý. Bạn nộp bằng chứng; đơn được công khai góp ý 30 ngày trên trang dòng họ; sau đó quản trị ứng dụng duyệt. Nhiều người có thể cùng nhận; mỗi người chỉ thành Chủ họ khi được duyệt.</p>
    <label class="fld">Bằng chứng (bạn là ai trong dòng họ, và tài liệu bạn có)<textarea name="evidence" rows="4" maxlength="2000"></textarea></label>
    <label class="fld">Tệp kèm theo, không bắt buộc (PDF, JPG hoặc PNG, tối đa 700 KB)<input name="file" type="file" accept="application/pdf,image/jpeg,image/png"></label>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn">Nộp đơn</button></div>`,
  async (f) => {
    const file = f.get('file');
    const evidence = String(f.get('evidence') || '').trim();
    if (!evidence && !(file && file.size)) throw new Error('Cần ghi bằng chứng hoặc đính kèm một tệp.');
    let payload = null;
    if (file && file.size) {
      if (file.size > MAX_FILE) throw new Error('Tệp tối đa 700 KB.');
      payload = { name: file.name, type: file.type, data: await readFile(file) };
    }
    const r = await api('POST', `/api/claims?family=${enc(fam)}`, { evidence, file: payload });
    drop(fam); toast(`Đã nộp đơn. Góp ý công khai đến ${DATE_VN(r.notice_until)}.`);
    deps.render();
  });
}

// One person picker: a search box under a label, results as buttons; the chosen id goes into a hidden field.
function pickerHtml(name, label, fam) {
  return `<div class="cl-pick" data-pick="${name}" data-fam="${esc(fam)}"><label class="fld">${esc(label)}<input type="search" data-pick-q autocomplete="off" maxlength="60" placeholder="Gõ tên"></label>
    <input type="hidden" name="${name}" value=""><ul class="cl-res" data-pick-res></ul><p class="sub" data-pick-chosen></p></div>`;
}
function wirePicker(root) {
  root.querySelectorAll('[data-pick]').forEach((box) => {
    const input = box.querySelector('[data-pick-q]'); const list = box.querySelector('[data-pick-res]');
    let seq = 0;
    input.addEventListener('input', async () => {
      const my = ++seq; const q = input.value.trim();
      if (q.length < 2) { list.innerHTML = ''; return; }
      const j = await api('GET', `/api/links/search?family=${enc(box.dataset.fam)}&q=${enc(q)}`).catch(() => ({ items: [] }));
      if (my !== seq) return;
      list.innerHTML = (j.items || []).map((p) => `<li><button type="button" class="btn ter sm" data-pick-id="${esc(p.id)}" data-pick-name="${esc(p.name)}">${esc(p.name)}${p.years ? ` (${esc(p.years)})` : ''}</button></li>`).join('') || '<li class="sub">Không thấy ai.</li>';
    });
    list.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-pick-id]'); if (!b) return;
      box.querySelector('input[type=hidden]').value = b.dataset.pickId;
      box.querySelector('[data-pick-chosen]').textContent = `Đã chọn: ${b.dataset.pickName}`;
      list.innerHTML = ''; input.value = '';
    });
  });
}

// The join sheet: one of my trees (owner, admin or editor), a person in it, and a person of this tree. The link is
// accepted at once only when I am owner or admin of both trees; otherwise an app admin or the other tree decides.
export function openJoinSheet(fam) {
  const mine = deps.S.followedFams().filter((f) => f !== fam && ['owner', 'admin', 'editor'].includes(deps.S.roleIn(f)));
  if (!mine.length) { toast('Bạn cần là Chủ họ, Quản trị hoặc Biên tập viên của một cây.'); return; }
  const d = deps.dialog(`<h2>Kết nối cây của tôi</h2>
    <p class="sub">Nối một người trong cây của bạn với một người trong ${esc(deps.S.familyName(fam))}. Quản trị ứng dụng sẽ duyệt nếu cây này chưa có Chủ họ.</p>
    <label class="fld">Cây của tôi<select name="mine">${mine.map((f) => `<option value="${esc(f)}">${esc(deps.S.familyName(f))}</option>`).join('')}</select></label>
    ${pickerHtml('person', 'Người trong cây của tôi', mine[0])}
    ${pickerHtml('other_person', `Người trong ${deps.S.familyName(fam)}`, fam)}
    <label class="fld">Ghi chú (không bắt buộc)<input name="reason" maxlength="300"></label>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn">Gửi đề nghị</button></div>`,
  async (f) => {
    const other = String(f.get('other_person') || ''); const person = String(f.get('person') || '');
    if (!person || !other) throw new Error('Chọn một người ở mỗi cây.');
    const r = await api('POST', '/api/links', { family: String(f.get('mine')), person, other_family: fam, other_person: other, reason: String(f.get('reason') || '') });
    toast(r.status === 'accepted' ? 'Đã kết nối.' : 'Đã gửi đề nghị. Đang chờ duyệt.');
    deps.render();
  });
  wirePicker(d);
  const sel = d.querySelector('select[name=mine]');
  sel.addEventListener('change', () => { const p = d.querySelector('[data-pick="person"]'); p.dataset.fam = sel.value; p.querySelector('input[type=hidden]').value = ''; p.querySelector('[data-pick-chosen]').textContent = ''; });
}

// Delegated clicks for the banner and the review screen (one listener for the whole app).
let wired = false;
export function wire() {
  if (wired) return; wired = true;
  document.addEventListener('click', async (ev) => {
    const open = ev.target.closest('[data-claim-open]');
    if (open) return openClaimSheet(open.dataset.fam);
    const join = ev.target.closest('[data-join-open]');
    if (join) return openJoinSheet(join.dataset.fam);
    const wd = ev.target.closest('[data-claim-withdraw]');
    if (wd) {
      try { await api('POST', `/api/claims/${Number(wd.dataset.claimWithdraw)}/withdraw`, {}); drop(wd.dataset.fam); toast('Đã rút đơn.'); deps.render(); }
      catch (e) { toast(e.message); }
    }
  });
}

// ---- app-admin review screen (#nhan-quan-ly) ----
const claimCard = (c) => `<article class="cl-card" data-claim="${c.id}">
  <h3 class="cl-h">${esc(c.family_name)}</h3>
  <p class="sub">${esc(STATE_TXT[c.tree_state] || '')}${c.abandoned ? ' · đơn đã gửi cho các Chủ họ cũ' : ''}</p>
  <p><b>${esc(c.claimant_name || c.claimant_email)}</b> <span class="sub">${esc(c.claimant_email)}</span></p>
  <p class="sub">Nộp ${DATE_VN(c.created_ms)} · ${c.status === 'notice' ? (c.ready ? 'hết 30 ngày góp ý, có thể duyệt' : `góp ý đến ${DATE_VN(c.until)}`) : (c.status === 'approved' ? 'đã duyệt' : c.status === 'rejected' ? 'đã từ chối' : 'đã rút')}</p>
  ${c.evidence ? `<p class="cl-ev">${esc(c.evidence)}</p>` : ''}
  ${c.file ? `<p><a href="/api/app/claims/${c.id}/file">Tải tệp: ${esc(c.file.name)}</a></p>` : ''}
  ${c.decision_note && c.status !== 'notice' ? `<p class="sub">Ghi chú: ${esc(c.decision_note)}</p>` : ''}
  ${c.status === 'notice' ? `<div class="cl-acts"><button type="button" class="btn sm" data-admin-approve="${c.id}" ${c.ready ? '' : 'disabled'}>Duyệt làm Chủ họ</button>
    <button type="button" class="btn gh sm" data-admin-reject="${c.id}">Từ chối</button></div>` : ''}
</article>`;
const linkCard = (l) => `<article class="cl-card" data-link="${l.id}">
  <p><b>${esc(l.from_person)}</b> <span class="sub">${esc(l.from_family)}</span> → <b>${esc(l.to_person)}</b> <span class="sub">${esc(l.to_family)}</span></p>
  <p class="sub">Đề nghị ${DATE_VN(Date.parse(l.created_at))}${l.reason ? ` · ${esc(l.reason)}` : ''}</p>
  <div class="cl-acts"><button type="button" class="btn sm" data-link-accept="${l.id}">Duyệt liên kết</button><button type="button" class="btn gh sm" data-link-reject="${l.id}">Từ chối</button></div>
</article>`;

export async function reviewPage(main) {
  let j;
  try { j = await api('GET', '/api/app/claims'); }
  catch (e) { main.innerHTML = `<h1>Nhận quản lý</h1><p class="sub">${esc(e.message)}</p>`; return; }
  const open = j.claims.filter((c) => c.status === 'notice'); const done = j.claims.filter((c) => c.status !== 'notice');
  main.innerHTML = `<h1>Nhận quản lý</h1>
    <p class="sub">Dòng họ không có Chủ họ quản lý. Chỉ duyệt đơn sau khi hết 30 ngày góp ý công khai. Duyệt làm người nhận thành Chủ họ; không ai khác bị đổi.</p>
    <h2 class="mg-h">Đơn đang góp ý</h2>${open.length ? open.map(claimCard).join('') : '<p class="sub">Không có đơn nào đang chờ.</p>'}
    <h2 class="mg-h">Liên kết chờ duyệt</h2>${j.links.length ? j.links.map(linkCard).join('') : '<p class="sub">Không có liên kết nào chờ duyệt.</p>'}
    <h2 class="mg-h">Đã xử lý gần đây</h2>${done.length ? done.map(claimCard).join('') : '<p class="sub">Chưa có đơn nào.</p>'}`;
  if (!main.dataset.claimBound) {
    main.dataset.claimBound = '1';
    main.addEventListener('click', (ev) => reviewClick(ev));
  }
}
async function reviewClick(ev) {
  const ap = ev.target.closest('[data-admin-approve]');
  const rj = ev.target.closest('[data-admin-reject]');
  const la = ev.target.closest('[data-link-accept]'); const lr = ev.target.closest('[data-link-reject]');
  try {
    if (ap) {
      const id = Number(ap.dataset.adminApprove);
      deps.dialog(`<h2>Duyệt làm Chủ họ?</h2><p class="sub">Người nộp đơn sẽ có quyền Chủ họ của dòng họ này. Không ai khác bị đổi quyền.</p>
        <div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn">Duyệt</button></div>`,
      async () => { await api('POST', `/api/app/claims/${id}/approve`, {}); toast('Đã duyệt.'); deps.render(); });
      return;
    }
    if (rj) {
      const id = Number(rj.dataset.adminReject);
      deps.dialog(`<h2>Từ chối đơn</h2><p class="sub">Lý do sẽ gửi cho người nộp đơn.</p>
        <label class="fld">Lý do<textarea name="reason" rows="3" maxlength="300" required></textarea></label>
        <div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn">Từ chối đơn</button></div>`,
      async (f) => { await api('POST', `/api/app/claims/${id}/reject`, { reason: String(f.get('reason') || '') }); toast('Đã từ chối.'); deps.render(); });
      return;
    }
    if (la) { await api('POST', `/api/links/${Number(la.dataset.linkAccept)}/accept`, {}); toast('Đã duyệt liên kết.'); deps.render(); return; }
    if (lr) { await api('POST', `/api/links/${Number(lr.dataset.linkReject)}/reject`, {}); toast('Đã từ chối liên kết.'); deps.render(); return; }
  } catch (e) { toast(e.message); }
}
