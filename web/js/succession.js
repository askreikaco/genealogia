// Succession UI: Cài đặt dòng họ (trusted contacts, inactivity months, death report, claims, reclaim), the handover
// banner on family pages, the offer page (#offer/<token>), the trusted-contact page (#trusted/<token>) and the
// create-family page (#lap-gia-pha). Talks to /api/families/<ref>/succession and the token endpoints.
// app.js calls init() once with what it owns (render, dialogs, sign-in URL, the store, the visibility options).
import { esc } from './model.js';
import { toast, surnameTileOf, famShort } from './ui.js';

const deps = { render: () => {}, S: null, dialog: null, confirm: null, googleUrl: () => '/api/auth/google', hashNext: () => '', visOpts: [] };
const mainEl = () => document.querySelector('#main');
const enc = encodeURIComponent;
const DAYS_VN = (iso) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Không thực hiện được.'); e.status = r.status; throw e; }
  return j;
}

// The family's succession state, cached for 20 seconds (the banner and the settings page both read it).
const cache = new Map();
export async function succState(fam, { fresh = false } = {}) {
  const hit = cache.get(fam);
  if (!fresh && hit && Date.now() - hit.at < 20e3) return hit.st;
  const st = await api('GET', `/api/families/${enc(fam)}/succession`);
  cache.set(fam, { at: Date.now(), st });
  return st;
}
const drop = (fam) => cache.delete(fam);

const STATUS = { invited: 'Chờ chấp nhận', accepted: 'Đã chấp nhận', declined: 'Đã từ chối' };
const STAGE_TXT = {
  inactive: { notice: (w) => `Chủ họ chưa đăng nhập đủ lâu. Dòng họ sẽ chuyển quyền sau ${w}, trừ khi Chủ họ đăng nhập để hủy.`,
    offer: () => 'Dòng họ đang mời người kế tiếp nhận quyền Chủ họ.' },
  deceased: { reported: () => 'Có báo cáo Chủ họ đã mất. Đang chờ Người được ủy thác xác nhận.',
    notice: (w) => `Đã xác nhận báo đã mất. Quyền Chủ họ chuyển sau ${w}, trừ khi Chủ họ đăng nhập để hủy.`,
    offer: () => 'Dòng họ đang mời người kế tiếp nhận quyền Chủ họ.' },
  claim: { backing: (w) => `Có người xin nhận quyền Chủ họ. Cần đủ người ủng hộ trước ${w}.`,
    objection: (w) => `Đã đủ người ủng hộ. Quyền Chủ họ chuyển sau ${w}, trừ khi có người phản đối hoặc Chủ họ đăng nhập để từ chối.` },
};
const handoverText = (h) => { const t = STAGE_TXT[h.kind]?.[h.stage]; return t ? t(h.deadline_at ? DAYS_VN(h.deadline_at) : '') : 'Có một việc chuyển quyền đang mở.'; };

// Banner at the top of a family page, for members and the owner while a handover is open.
export async function succBar() {
  const fam = deps.S?.curFamily?.();
  if (!fam || fam === deps.S.ALL_FAMS || !deps.S.signedIn()) return;
  const main = mainEl(); if (!main || main.querySelector('.succ-bar')) return;
  let st; try { st = await succState(fam); } catch { return; }
  if (!st.handover || !mainEl() || mainEl().querySelector('.succ-bar')) return;
  mainEl().insertAdjacentHTML('afterbegin', `<div class="succ-bar" role="status"><span>${esc(handoverText(st.handover))}</span>
    <a class="btn sm" href="#/${enc(fam)}/nguoi-ke-nhiem">Xem</a></div>`);
}

// ---- Cài đặt dòng họ: the sections that need the server state ----
const contactRow = (c, i, n, owner) => `<div class="succ-row">
  <span class="famr-tx"><span class="famr-nm">${esc(c.name || c.email)}</span><span class="famr-sb">${esc(c.email)} · <span class="succ-tag ${esc(c.status)}">${esc(STATUS[c.status] || c.status)}</span></span></span>
  ${owner ? `<span class="succ-acts">
    <button type="button" class="btn ter sm" data-succ="up" data-id="${c.id}"${i === 0 ? ' disabled' : ''} aria-label="Đưa lên trên: ${esc(c.name || c.email)}">↑</button>
    <button type="button" class="btn ter sm" data-succ="down" data-id="${c.id}"${i === n - 1 ? ' disabled' : ''} aria-label="Đưa xuống dưới: ${esc(c.name || c.email)}">↓</button>
    ${c.status === 'invited' ? `<button type="button" class="btn ter sm" data-succ="resend" data-id="${c.id}">Gửi lại lời mời</button>` : ''}
    <button type="button" class="btn ter sm dng-t" data-succ="remove" data-id="${c.id}">Bỏ</button></span>` : ''}
</div>`;

function actionRows(st) {
  const h = st.handover; const out = [];
  if (st.can_report) out.push(`<button type="button" class="btn ter sm dng-t" data-succ="report">Báo Chủ họ đã mất</button>`);
  if (st.can_confirm) out.push(`<button type="button" class="btn sm" data-succ="confirm" data-id="${h.id}">Xác nhận đã mất</button>`);
  if (st.can_cancel) out.push(`<button type="button" class="btn sm" data-succ="cancel">Tôi vẫn giữ quyền, hủy việc chuyển</button>`);
  if (st.can_object) out.push(`<button type="button" class="btn ter sm dng-t" data-succ="object" data-id="${h.id}">Phản đối việc nhận quyền</button>`);
  if (st.can_back) out.push(`<button type="button" class="btn sm" data-succ="back" data-id="${h.id}">Ủng hộ người xin nhận quyền</button>`);
  if (st.can_claim) out.push(`<button type="button" class="btn ter sm" data-succ="claim">Xin nhận quyền Chủ họ</button>`);
  if (st.reclaim) out.push(`<button type="button" class="btn ter sm" data-succ="reclaim">Lấy lại quyền Chủ họ (đến ${esc(DAYS_VN(st.reclaim.until))})</button>`);
  return out.length ? `<div class="succ-acts">${out.join('')}</div>` : '';
}

// Fills #succ-settings of the family settings page (the page itself is drawn by app.js).
export async function paintSettings(fam) {
  const box = document.getElementById('succ-settings'); if (!box) return;
  let st;
  try { st = await succState(fam, { fresh: true }); } catch (e) { box.innerHTML = `<p class="sub">${esc(e.message)}</p>`; return; }
  const owner = !!st.is_owner; const admin = Array.isArray(st.contacts);
  const contacts = st.contacts || [];
  const full = contacts.length >= st.max_contacts;
  box.dataset.fam = fam;
  box.innerHTML = `
    ${st.handover ? `<div class="succ-bar" role="status"><span>${esc(handoverText(st.handover))}</span></div>` : ''}
    ${st.owner_banner ? `<div class="succ-note" role="status"><b>Chưa có người nhận quyền.</b> Mời ít nhất một Người được ủy thác hoặc một Quản trị khác. Nếu Chủ họ lâu không đăng nhập, dòng họ cần người này để chuyển quyền.</div>` : ''}
    ${admin ? `<h3>Người được ủy thác</h3>
      <p class="sub">Tối đa ${st.max_contacts} người. Khi Chủ họ lâu không đăng nhập, họ là người đầu tiên được hỏi. Người được mời chấp nhận bằng tài khoản Google có email đó.</p>
      <div class="succ-list">${contacts.length ? contacts.map((c, i) => contactRow(c, i, contacts.length, owner)).join('') : '<p class="sub">Chưa có người được ủy thác.</p>'}</div>
      ${owner && !full ? `<form id="succ-add" class="succ-form" novalidate><label class="fld">Email<input name="email" type="email" required maxlength="200" autocomplete="off"></label>
        <label class="fld">Tên (không bắt buộc)<input name="name" maxlength="80" autocomplete="off"></label>
        <div class="row end"><button class="btn">Mời</button></div><p class="err" hidden></p></form>` : ''}
      ${owner && full ? `<p class="sub">Đã có ${st.max_contacts} người. Bỏ bớt một người để mời người khác.</p>` : ''}` : ''}
    <h3>Thời hạn không đăng nhập</h3>
    ${owner ? `<form id="succ-months" class="succ-form"><label class="fld">Chủ họ không đăng nhập quá
        <select name="m">${st.months_choices.map((m) => `<option value="${m}"${m === st.inactive_months ? ' selected' : ''}>${m} tháng</option>`).join('')}</select></label>
        <p class="sub">Trước đó, dòng họ nhắc Chủ họ 1 tháng, 1 tuần và 1 ngày. Khi hết thời hạn, có 14 ngày để hủy trước khi chuyển quyền.</p>
        <div class="row end"><button class="btn">Lưu</button></div></form>`
      : `<p class="sub">Sau ${st.inactive_months} tháng Chủ họ không đăng nhập, dòng họ bắt đầu quy trình chuyển quyền. Chỉ Chủ họ đổi được thời hạn này.</p>`}
    ${actionRows(st)}`;
}

// Delegated actions for the settings page and the banners (one listener for the whole app).
async function act(fam, kind, id) {
  const go = async (p, msg, body) => { await api('POST', `/api/families/${enc(fam)}/${p}`, body); drop(fam); if (msg) toast(msg); };
  if (kind === 'up' || kind === 'down') {
    const st = await succState(fam, { fresh: true });
    const ids = st.contacts.map((c) => c.id); const i = ids.indexOf(Number(id)); const j = kind === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return go('trusted/order', 'Đã sắp xếp', { ids });
  }
  if (kind === 'resend') return go(`trusted/${Number(id)}/resend`, 'Đã gửi lại lời mời');
  if (kind === 'remove') return deps.confirm('Bỏ người này?', 'Người này không còn được hỏi khi có việc chuyển quyền. Có thể mời lại sau.', 'Bỏ', () => go(`trusted/${Number(id)}/remove`, 'Đã bỏ'));
  if (kind === 'cancel') return go('handover/cancel', 'Đã hủy việc chuyển quyền');
  if (kind === 'object') return api('POST', `/api/handover/${Number(id)}/object`).then(() => { drop(fam); toast('Đã ghi nhận phản đối. Việc nhận quyền dừng lại.'); });
  if (kind === 'claim') return deps.confirm('Xin nhận quyền Chủ họ?', 'Chỉ làm được khi dòng họ không còn ai để trao quyền. Các thành viên khác sẽ được hỏi ủng hộ. Trong 30 ngày, Chủ họ có thể đăng nhập để từ chối.', 'Xin nhận quyền', () => go('claim', 'Đã gửi yêu cầu nhận quyền'));
  if (kind === 'back') return api('POST', `/api/handover/${Number(id)}/back`).then((r) => { drop(fam); toast(r.owner ? 'Đủ người ủng hộ. Quyền Chủ họ đã chuyển.' : `Đã ủng hộ (${r.backers})`); });
  if (kind === 'confirm') return deps.confirm('Xác nhận Chủ họ đã mất?', 'Dòng họ sẽ bắt đầu thời hạn 14 ngày. Trong thời hạn đó, Chủ họ có thể đăng nhập để hủy.', 'Xác nhận', () => api('POST', `/api/handover/${Number(id)}/confirm`).then(() => { drop(fam); toast('Đã xác nhận'); }));
  if (kind === 'reclaim') return deps.confirm('Lấy lại quyền Chủ họ?', 'Chủ họ hiện tại sẽ thành Quản trị.', 'Lấy lại', () => api('POST', `/api/families/${enc(fam)}/reclaim`).then(async () => { drop(fam); await deps.S.refreshMe(); toast('Bạn đã là Chủ họ'); }));
  if (kind === 'report') return reportDialog(fam);
}
function reportDialog(fam) {
  deps.dialog(`<h2>Báo Chủ họ đã mất</h2>
    <p class="sub">Một Người được ủy thác (hoặc Quản trị, nếu chưa có) cần xác nhận. Sau đó dòng họ có 14 ngày trước khi chuyển quyền.</p>
    <label class="fld">Thông tin kèm theo (không bắt buộc)<textarea name="evidence" rows="3" maxlength="1000"></textarea></label>
    <label class="fld">Đường dẫn ảnh giấy báo (không bắt buộc)<input name="photo_link" type="url" maxlength="500" placeholder="https://"></label>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn dng">Gửi báo cáo</button></div>`,
  async (f) => { await api('POST', `/api/families/${enc(fam)}/handover/report`, { evidence: String(f.get('evidence') || ''), photo_link: String(f.get('photo_link') || '') }); drop(fam); toast('Đã gửi báo cáo'); });
}

// ---- one listener each, for the whole app ----
let wired = false;
function wire() {
  if (wired) return; wired = true;
  document.addEventListener('click', async (e) => {
    const b = e.target.closest?.('[data-succ]'); if (!b) return;
    const fam = b.closest('[data-fam]')?.dataset.fam || deps.S.curFamily();
    try { await act(fam, b.dataset.succ, b.dataset.id); deps.render(); }
    catch (x) { toast(x.message); }
  });
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest?.('#succ-add, #succ-months');
    if (!form) return;
    e.preventDefault();
    const fam = form.closest('[data-fam]')?.dataset.fam || deps.S.curFamily();
    const err = form.querySelector('.err'); if (err) err.hidden = true;
    const fd = new FormData(form);
    try {
      if (form.id === 'succ-add') {
        await api('POST', `/api/families/${enc(fam)}/trusted`, { email: String(fd.get('email') || '').trim(), name: String(fd.get('name') || '').trim() });
        toast('Đã gửi lời mời');
      } else {
        await api('POST', `/api/families/${enc(fam)}/succession/settings`, { owner_inactive_months: Number(fd.get('m')) });
        toast('Đã lưu thời hạn');
      }
      drop(fam); deps.render();
    } catch (x) { if (err) { err.hidden = false; err.textContent = x.message; } else toast(x.message); }
  });
  // The create-family form keeps what was typed: a re-render of the page must not clear it.
  const keepLf = (e) => { if (e.target.closest?.('#lf-form') && e.target.name) lfDraft[e.target.name] = e.target.type === 'radio' ? (e.target.checked ? e.target.value : lfDraft[e.target.name]) : e.target.value; };
  document.addEventListener('input', (e) => {
    keepLf(e);
  });
  document.addEventListener('change', keepLf);
}

// ---- #offer/<token>: the offer of the owner role, with the email code ----
export async function offerView(token) {
  const main = mainEl(); if (!main) return;
  const page = (inner) => { main.innerHTML = `<div class="succ-page">${inner}</div>`; };
  page('<h1 class="keep">Lời mời nhận quyền Chủ họ</h1><p class="sub">Đang mở…</p>');
  let info;
  try { info = await api('GET', `/api/offers/${enc(token)}`); }
  catch { return page('<h1 class="keep">Lời mời nhận quyền Chủ họ</h1><p class="sub">Lời mời này không còn hiệu lực.</p>'); }
  if (info.expired) return page(`<h1 class="keep">Lời mời nhận quyền Chủ họ</h1><p class="sub">Lời mời này đã hết hạn. Dòng họ đã chuyển sang người tiếp theo.</p>`);
  const signed = deps.S.signedIn();
  page(`<h1 class="keep">Nhận quyền Chủ họ ${esc(info.family)}</h1>
    <p>Chủ họ trước chưa đăng nhập đủ lâu, và bạn là người tiếp theo trong danh sách được mời.</p>
    <p>Nếu nhận, bạn là Chủ họ. Chủ họ trước thành Quản trị và có 90 ngày để lấy lại quyền Chủ họ.</p>
    <p class="sub">Lời mời hết hạn lúc ${esc(DAYS_VN(info.expires_at))} (giờ Việt Nam).</p>
    ${signed ? '' : `<p class="succ-note">Để làm việc với tư cách Chủ họ, hãy đăng nhập bằng Google với email ${esc(info.email)}.</p><p><a class="btn ter" href="${esc(deps.googleUrl(deps.hashNext()))}">Đăng nhập bằng Google</a></p>`}
    <div class="succ-step"><button type="button" class="btn" id="off-send">Gửi mã đến ${esc(info.email)}</button></div>
    <form id="off-form" class="form-stack" novalidate>
      <label class="fld">Mã gồm 6 số trong email<input name="code" class="succ-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
      <div class="row end"><button type="button" class="btn gh" id="off-decline">Từ chối lời mời</button><button class="btn">Nhận quyền Chủ họ</button></div>
      <p class="err" id="off-err" hidden></p>
    </form>
    <div id="off-done" hidden></div>`);
  const err = (m) => { const p = document.getElementById('off-err'); p.hidden = false; p.textContent = m; };
  document.getElementById('off-send').onclick = async () => {
    try { const r = await api('POST', `/api/offers/${enc(token)}/code`); toast(r.sent === 'sent' ? 'Đã gửi mã đến email' : 'Mã đã được tạo. Email chưa gửi được, thử lại sau.'); }
    catch (x) { err(x.message); }
  };
  document.getElementById('off-form').onsubmit = async (e) => {
    e.preventDefault(); document.getElementById('off-err').hidden = true;
    const code = String(new FormData(e.target).get('code') || '').trim();
    try {
      await api('POST', `/api/offers/${enc(token)}/accept`, { code });
      document.getElementById('off-form').hidden = true; document.getElementById('off-send').hidden = true;
      const done = document.getElementById('off-done'); done.hidden = false;
      done.innerHTML = `<h2>Bạn là Chủ họ của ${esc(info.family)}.</h2><p class="sub">${signed ? '' : 'Đăng nhập bằng Google với email này để làm việc với tư cách Chủ họ.'}</p>`;
      try { await deps.S.refreshMe(); } catch {}
    } catch (x) { err(x.message); }
  };
  document.getElementById('off-decline').onclick = () => deps.confirm('Từ chối lời mời?', 'Lời mời sẽ chuyển sang người tiếp theo trong danh sách.', 'Từ chối', async () => {
    await api('POST', `/api/offers/${enc(token)}/decline`);
    page('<h1 class="keep">Đã từ chối</h1><p class="sub">Cảm ơn bạn đã trả lời. Lời mời đã chuyển sang người tiếp theo.</p>');
  });
}

// ---- #trusted/<token>: a contact accepts the invite (Google sign-in with the invited email) ----
export async function trustedView(token) {
  const main = mainEl(); if (!main) return;
  const page = (inner) => { main.innerHTML = `<div class="succ-page">${inner}</div>`; };
  page('<h1 class="keep">Người được ủy thác</h1><p class="sub">Đang mở…</p>');
  let info;
  try { info = await api('GET', `/api/trusted/${enc(token)}`); }
  catch { return page('<h1 class="keep">Người được ủy thác</h1><p class="sub">Lời mời này không còn hiệu lực.</p>'); }
  if (info.status === 'accepted') return page(`<h1 class="keep">Bạn đã nhận lời mời</h1><p>Bạn là Người được ủy thác của ${esc(info.family)}.</p>`);
  if (info.expired) return page(`<h1 class="keep">Lời mời đã hết hạn</h1><p class="sub">Nhờ Chủ họ của ${esc(info.family)} gửi lại lời mời.</p>`);
  const signed = deps.S.signedIn();
  page(`<h1 class="keep">Mời làm Người được ủy thác</h1>
    <p>${esc(info.family)} mời bạn làm Người được ủy thác. Đây là người đầu tiên được báo khi Chủ họ lâu không đăng nhập, hoặc khi có báo đã mất.</p>
    ${signed ? `<div class="row end"><button class="btn" id="tr-accept">Chấp nhận</button></div>`
      : `<p class="succ-note">Đăng nhập bằng Google với email ${esc(info.email)} để chấp nhận.</p><p><a class="btn" href="${esc(deps.googleUrl(deps.hashNext()))}">Đăng nhập bằng Google</a></p>`}
    <p class="err" id="tr-err" hidden></p>`);
  document.getElementById('tr-accept')?.addEventListener('click', async () => {
    try { await api('POST', `/api/trusted/${enc(token)}/accept`); page(`<h1 class="keep">Cảm ơn bạn</h1><p>Bạn đã chấp nhận làm Người được ủy thác của ${esc(info.family)}.</p>`); }
    catch (x) { const p = document.getElementById('tr-err'); p.hidden = false; p.textContent = x.message; }
  });
}

// ---- #lap-gia-pha: create a family; the signed-in account becomes its owner ----
export function createCardHtml() {
  return `<a class="cay-new" href="#lap-gia-pha"><span class="cay-plus" aria-hidden="true">+</span><span>Chưa thấy dòng họ của bạn? <b>Lập gia phả mới</b></span></a>`;
}
let lfDraft = {};
export function createView() {
  const main = mainEl(); if (!main) return;
  if (!deps.S.signedIn()) {
    main.innerHTML = `<h1 class="keep">Lập gia phả mới</h1><p class="sub">Đăng nhập bằng Google để lập gia phả. Bạn sẽ là Chủ họ của dòng họ mới.</p>
      <p><a class="btn" href="${esc(deps.googleUrl(deps.hashNext()))}">Đăng nhập bằng Google</a></p>`;
    return;
  }
  main.innerHTML = `<h1 class="keep">Lập gia phả mới</h1><p class="sub">Bạn sẽ là Chủ họ. Có thể mời người thân và thêm người sau.</p>
    <form id="lf-form" class="form-stack" novalidate>
      <label class="fld">Họ<input name="name" required maxlength="80" autocomplete="off" placeholder="Ví dụ: Họ Nguyễn"></label>
      <div class="succ-han"><label class="fld">Chữ Hán (không bắt buộc)<input name="han" id="lf-han" maxlength="20" autocomplete="off"></label>
        <span id="lf-tile" hidden></span></div>
      <label class="fld">Quê quán (không bắt buộc)<input name="place" maxlength="120" autocomplete="off"></label>
      <label class="fld">Ai thấy dòng họ<select name="visibility">${deps.visOpts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
      <fieldset class="succ-vis"><legend class="fld-l">Người đầu tiên trong gia phả (không bắt buộc)</legend>
        <label class="fld">Họ tên<input name="fp_name" maxlength="80" autocomplete="off"></label>
        <label class="fld">Giới tính<select name="fp_sex"><option value="">Chưa rõ</option><option value="m">Nam</option><option value="f">Nữ</option></select></label>
      </fieldset>
      <div class="row end"><button class="btn">Lập gia phả</button></div>
      <p class="err" id="lf-err" hidden></p>
    </form>`;
  const form = document.getElementById('lf-form');
  for (const [k, v] of Object.entries(lfDraft)) {
    const el = form.elements.namedItem(k);
    if (!el) continue;
    if (el instanceof RadioNodeList) for (const r of el) r.checked = r.value === v; else el.value = v;
  }
  // The crest: the family's colour from the typed surname (or its Hán, if typed); hidden until one of the two is typed.
  const han = document.getElementById('lf-han'); const tile = document.getElementById('lf-tile'); const nameEl = form.elements.namedItem('name');
  const paintTile = () => { const h = han.value.trim(); const s = famShort(nameEl.value.trim()); tile.hidden = !h && !s; tile.innerHTML = tile.hidden ? '' : surnameTileOf(s, { size: 'lg', han: h }); };
  paintTile(); form.addEventListener('input', paintTile);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target); const err = document.getElementById('lf-err'); err.hidden = true;
    const body = { name: String(fd.get('name') || '').trim(), han: String(fd.get('han') || '').trim(), place: String(fd.get('place') || '').trim(),
      visibility: String(fd.get('visibility') || 'public'), first_person: { name: String(fd.get('fp_name') || '').trim(), sex: String(fd.get('fp_sex') || '') } };
    try {
      const r = await api('POST', '/api/families', body);
      try { await deps.S.refreshMe(); } catch {}
      toast('Đã lập gia phả');
      lfDraft = {};
      location.hash = `#/${r.family.slug}/tree`;
    } catch (x) { err.hidden = false; err.textContent = x.message; }
  };
}

export function init(d) { Object.assign(deps, d); wire(); }
