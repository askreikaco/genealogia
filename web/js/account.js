// Thêm › Tài khoản (#tai-khoan): the signed-in account (account plan P1), Google-account style. The main page is a header
// card and one list of summary rows; each row opens a subpage (#tai-khoan/<sub>) with the details: sign-in methods,
// devices, families, security activity, and the danger zone. Built from the shared row (calmRow + calmAct + popMenu).
// Sensitive changes answer { reauth: true } when the last sign-in is older than 10 minutes: the person signs in with
// Google again (/api/auth/google?mode=reauth) and comes back here.
import { esc } from './model.js';
import { calmRow, calmAct, cic, popMenu, toast, confirmModal, fmtTime, fmtDate, moreFold } from './ui.js';
import { dangerItem, dangerLabel, confirmDanger, dangerButton, dangerZone } from './danger.js';
import { addPasskey, canAddPasskey } from './passkey.js';

async function api(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, { method, cache: 'no-store', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Có trục trặc, vui lòng thử lại sau.'), { status: r.status, reauth: !!j.reauth });
  return j;
}
const googleUrl = (mode) => `/api/auth/google?mode=${mode}&next=tai-khoan`;
const ROLE = { owner: 'Chủ họ', admin: 'Quản trị', editor: 'Biên tập', member: 'Thành viên' };
const EVENT = {
  account_created: 'Tạo tài khoản', signin: 'Đăng nhập', reauth: 'Xác nhận lại bằng Google', session_upgraded: 'Thiết bị chuyển sang phiên mới',
  email_added: 'Thêm email, chờ xác minh', email_verified: 'Xác minh email', email_removed: 'Đã gỡ email', primary_changed: 'Đổi email chính',
  google_linked: 'Liên kết Google', google_unlinked: 'Đã gỡ liên kết Google', session_revoked: 'Đăng xuất một thiết bị',
  sessions_revoked_others: 'Đăng xuất các thiết bị khác', name_changed: 'Đổi tên hiển thị',
  passkey_added: 'Thêm passkey', passkey_removed: 'Đã gỡ passkey',
  totp_enabled: 'Bật xác minh 2 bước', totp_disabled: 'Tắt xác minh 2 bước', totp_failed: 'Nhập sai mã xác minh 2 bước',
  recovery_regenerated: 'Tạo mã khôi phục mới',
};
const tag = (t, tone = 'gray') => ` <span class="tag sm ${tone}">${esc(t)}</span>`;
const more = (label, attrs) => calmAct({ icon: cic('more', 20), label, attrs });
const group = (title, rows, hint = '') => `<section class="mg acc-g"><h2 class="mg-h">${esc(title)}</h2>${rows.length ? `<div class="mg-g">${rows.join('')}</div>` : ''}${hint ? `<p class="sub acc-hint">${hint}</p>` : ''}</section>`;
const sub = (title, rows, hint = '') => `<div class="acc-sub"><h3 class="mg-h acc-sub-h">${esc(title)}</h3><div class="mg-g">${rows.join('')}</div>${hint ? `<p class="sub acc-hint">${hint}</p>` : ''}</div>`;
const soon = (title, line = '') => calmRow({ attrs: 'disabled aria-disabled="true" data-soon', title, subtitle: esc(line), badge: tag('Sắp có'), trailing: 'none', dense: true });
const addRow = (title, attrs) => calmRow({ attrs, icon: cic('plus', 20), title, trailing: 'none', dense: true, ghost: true });
const when = (t) => (t ? fmtTime(t) : '');
// Row icons come from the app's icon set (passed in by app.js): the same tile and stroke as the Thêm page rows.
let ICON = () => '';
const tileOf = (n) => `<span class="ibox" aria-hidden="true">${ICON(n)}</span>`;
const firstName = (a) => a.name || a.emails.find((e) => e.primary)?.email || 'Chưa đặt tên';

// "2 email · Google · 1 thiết bị passkey": one muted line for the sign-in methods row.
function methodsText(a) {
  const parts = [];
  if (a.emails.length) parts.push(`${a.emails.length} email`);
  if (a.linked.some((x) => x.type === 'google')) parts.push('Google');
  if (a.passkeys.length) parts.push(`${a.passkeys.length} thiết bị passkey`);
  return parts.join(' · ') || 'Chưa có cách đăng nhập';
}
// "Họ Dương · Chủ họ", or "3 dòng họ · Chủ họ" when there are several.
function famsText(a) {
  const fs = a.families;
  if (!fs.length) return 'Chưa tham gia dòng họ nào';
  return fs.length === 1 ? `${fs[0].name} · ${ROLE[fs[0].role] || fs[0].role}` : `${fs.length} dòng họ · ${ROLE[fs[0].role] || fs[0].role}`;
}

// ---- main page: header card + one list of summary rows ----
function head(a) {
  const primary = a.emails.find((e) => e.primary)?.email || a.emails[0]?.email || '';
  return `<section class="mg acc-head"><div class="acct"><span class="av" aria-hidden="true">${esc((a.name || primary || '?').trim().charAt(0).toUpperCase())}</span>`
    + `<span class="acct-tx"><b>${esc(firstName(a))}</b>${primary ? `<span class="sub">${esc(primary)}</span>` : ''}</span>`
    + `<button type="button" class="btn ter sm" data-edit-name>Sửa tên</button></div></section>`;
}
function mainPage(a) {
  const rows = [
    calmRow({ href: '#tai-khoan/dang-nhap', icon: tileOf('key'), title: 'Cách đăng nhập', subtitle: esc(methodsText(a)), dense: true }),
    calmRow({ href: '#tai-khoan/thiet-bi', icon: tileOf('phone'), title: 'Thiết bị đang đăng nhập', subtitle: esc(`${a.sessions.length} thiết bị`), dense: true }),
    calmRow({ href: '#tai-khoan/dong-ho', icon: tileOf('tree'), title: 'Dòng họ của tôi', subtitle: esc(famsText(a)), dense: true }),
  ];
  rows.push(calmRow({ href: '#tai-khoan/bao-mat', icon: tileOf('shield'), title: 'Bảo mật', subtitle: esc(a.totp?.enabled ? 'Xác minh 2 bước đang bật' : 'Xác minh 2 bước chưa bật'), dense: true }));
  return `<h1>Tài khoản</h1>${head(a)}<section class="mg"><div class="mg-g">${rows.join('')}</div></section>`
    + `<div class="acc-foot"><button type="button" class="acc-signout" id="logout">${ICON('logout')}Đăng xuất</button>`
    + `<a class="acc-quiet" href="#tai-khoan/vung-nguy-hiem">${ICON('warning')}Thao tác cần cẩn trọng</a></div>`;
}

// ---- subpages ----
function signInPage(a) {
  const emails = a.emails.map((e) => calmRow({ title: e.email, trailing: 'none', dense: true,
    subtitle: esc([e.primary ? 'Email chính' : '', e.verified ? 'Đã xác minh' : 'Chưa xác minh: mở đường dẫn trong email'].filter(Boolean).join(' · ')),
    badge: e.primary ? tag('Chính', 'blue') : e.verified ? '' : tag('Chưa xác minh', 'gray'),
    action: more(`Tùy chọn cho ${e.email}`, `data-em="${esc(e.id)}"`) }));
  const google = a.linked.filter((x) => x.type === 'google').map((g) => calmRow({ title: 'Google', trailing: 'none', dense: true,
    subtitle: esc([g.email, g.last_used_at ? 'dùng lần cuối ' + fmtDate(g.last_used_at) : ''].filter(Boolean).join(' · ')), badge: tag('Đã liên kết', 'green'),
    action: more('Tùy chọn cho Google ' + g.email, `data-idm="${esc(g.id)}"`) }));
  const passkeys = a.passkeys.map((p) => calmRow({ title: p.label, trailing: 'none', dense: true,
    subtitle: esc(['Tạo ' + fmtDate(p.created_at), p.last_used_at ? 'dùng lần cuối ' + fmtDate(p.last_used_at) : 'chưa dùng'].join(' · ')),
    action: more('Tùy chọn cho passkey ' + p.label, `data-pk-id="${esc(p.id)}"`) }));
  return `<h1>Cách đăng nhập</h1><section class="mg acc-g">`
    + sub('Email', [...emails, addRow('Thêm email', 'data-add-email')])
    + '<div class="acc-form-slot" data-slot="email"></div>'
    + sub('Số điện thoại', [soon('Thêm số điện thoại', 'Đăng nhập bằng mã gửi qua tin nhắn')])
    + sub('Passkey', [...passkeys, addRow('Thêm passkey', 'data-add-passkey')], 'Đăng nhập bằng vân tay / khuôn mặt trên điện thoại, không cần mật khẩu.')
    + sub('Tài khoản liên kết', [...google, addRow(google.length ? 'Liên kết thêm tài khoản Google' : 'Liên kết Google', 'data-link="google"'), soon('Apple'), soon('Zalo'), soon('Facebook')])
    + '</section>';
}
function devicesPage(a) {
  const sess = a.sessions.map((s) => calmRow({ title: s.label || 'Thiết bị', trailing: 'none', dense: true,
    subtitle: esc([s.ip, 'hoạt động ' + when(s.last_seen_at)].filter(Boolean).join(' · ')), badge: s.current ? tag('Thiết bị này', 'green') : '',
    action: more('Tùy chọn cho ' + (s.label || 'thiết bị'), `data-sess="${esc(s.id)}" data-cur="${s.current ? 1 : 0}"`) }));
  const others = a.sessions.filter((s) => !s.current).length;
  return `<h1>Thiết bị đang đăng nhập</h1>`
    + group('Thiết bị', [...sess, ...(others ? [calmRow({ attrs: 'data-out-others data-danger', title: `Đăng xuất ${others} thiết bị khác`, trailing: 'none', dense: true, danger: true })] : [])]);
}
function familiesPage(a) {
  const fams = a.families.map((f) => calmRow({ href: f.slug === 'duong' ? '#tree' : `#/${f.slug}/tree`, title: f.name, badge: tag(ROLE[f.role] || f.role), dense: true }));
  return `<h1>Dòng họ của tôi</h1>` + group('Dòng họ', fams, a.families.length ? '' : 'Bạn chưa là thành viên dòng họ nào.');
}
function securityPage(a) {
  const t = a.totp || {};
  const twoStep = [calmRow({ href: '#tai-khoan/xac-minh', icon: tileOf('phone'), title: 'Xác minh 2 bước', dense: true,
    subtitle: esc(t.enabled ? `Đang bật${t.since ? ' từ ' + fmtDate(t.since) : ''}` : 'Chưa bật. Thêm mã từ điện thoại khi đăng nhập'), badge: t.enabled ? tag('Đang bật', 'green') : '' })];
  if (t.enabled) twoStep.push(calmRow({ href: '#tai-khoan/ma-khoi-phuc', icon: tileOf('key'), title: 'Mã khôi phục', dense: true, subtitle: esc(`Còn ${t.recovery_left} mã chưa dùng`) }));
  const evRows = a.events.map((e) => calmRow({ title: EVENT[e.kind] || e.kind, trailing: 'none', dense: true,
    subtitle: esc([when(e.at), e.device, e.ip, e.detail?.email || e.detail?.value || ''].filter(Boolean).join(' · ')) }));
  const body = evRows.length ? `${evRows.slice(0, 5).join('')}${evRows.length > 5 ? moreFold(`Xem thêm ${evRows.length - 5} hoạt động`, evRows.slice(5).join('')) : ''}` : '<p class="sub pad">Chưa có hoạt động.</p>';
  return `<h1>Bảo mật</h1>${group('Xác minh 2 bước', twoStep)}${group('Hoạt động gần đây', [body])}`;
}

// ---- two-step sign-in (totp-routes.js). The secret and the recovery codes are shown here only, once. ----
let setup = null; // { secret, qr } while an authenticator is being added (not yet confirmed)
let codes = null; // the recovery codes just made: shown until "Tôi đã lưu mã"
const codesView = () => `<section class="mg acc-form-card"><p class="sub">Lưu 10 mã này ở nơi an toàn. Mỗi mã dùng được một lần, khi bạn không lấy được mã 6 số. Mã chỉ hiện một lần.</p>`
  + `<ul class="totp-codes">${codes.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ul>`
  + '<div class="acc-form"><button type="button" class="btn ter" data-copy-codes>Sao chép mã</button><button type="button" class="btn" data-codes-done>Tôi đã lưu mã</button></div></section>';
function twoStepPage(a) {
  const t = a.totp || {};
  if (codes) return `<h1>Xác minh 2 bước</h1>${codesView()}`;
  if (t.enabled) {
    return `<h1>Xác minh 2 bước</h1><section class="mg acc-out"><p>Đang bật${t.since ? ' từ ' + esc(fmtDate(t.since)) : ''}. Khi đăng nhập bằng Google, bạn nhập thêm một mã từ ứng dụng xác thực.</p></section>`
      + `<section class="mg acc-g">${group('Dự phòng', [calmRow({ href: '#tai-khoan/ma-khoi-phuc', icon: tileOf('key'), title: 'Mã khôi phục', dense: true, subtitle: esc(`Còn ${t.recovery_left} mã chưa dùng`) })])}</section>`
      + dangerZone([dangerButton('Tắt xác minh 2 bước', 'data-totp-off')], { title: 'Tắt xác minh 2 bước', note: 'Đăng nhập chỉ cần Google. Mã khôi phục sẽ bị xóa.' });
  }
  if (setup) {
    return `<h1>Xác minh 2 bước</h1><section class="mg acc-form-card">`
      + `<p class="sub">Mở ứng dụng xác thực (Google Authenticator, Microsoft Authenticator…) và quét mã QR này.</p>`
      + `<div class="totp-qr" role="img" aria-label="Mã QR để thêm vào ứng dụng xác thực">${setup.qr}</div>`
      + `<p class="sub">Không quét được? Nhập khóa bí mật này: <code class="totp-secret">${esc(setup.secret)}</code> <button type="button" class="btn ter sm" data-copy-secret>Sao chép</button></p>`
      + '<form class="acc-form" data-totp-form novalidate><label class="vh" for="totp-code">Mã 6 số từ ứng dụng</label>'
      + '<input id="totp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required>'
      + '<button type="submit" class="btn">Xác nhận</button><button type="button" class="btn gh" data-totp-cancel>Hủy</button></form></section>';
  }
  return '<h1>Xác minh 2 bước</h1><section class="mg acc-out"><p>Thêm một bước khi đăng nhập bằng Google: một mã 6 số từ ứng dụng xác thực trên điện thoại.</p>'
    + '<button type="button" class="btn" data-totp-on>Bật xác minh 2 bước</button></section>';
}
function recoveryPage(a) {
  const t = a.totp || {};
  if (!t.enabled) return '<h1>Mã khôi phục</h1><section class="mg acc-out"><p>Bật xác minh 2 bước trước để có mã khôi phục.</p><a class="btn" href="#tai-khoan/xac-minh">Bật xác minh 2 bước</a></section>';
  if (codes) return `<h1>Mã khôi phục</h1>${codesView()}`;
  return `<h1>Mã khôi phục</h1><section class="mg acc-out"><p>Còn ${t.recovery_left} mã chưa dùng. Mã chỉ hiện một lần: nếu làm mất mã, tạo mã mới. Mã cũ sẽ không dùng được nữa.</p>`
    + '<button type="button" class="btn" data-totp-regen>Tạo mã mới</button></section>';
}
function dangerPage() {
  return `<h1>Thao tác cần cẩn trọng</h1>` + group('Xóa tài khoản', [soon(dangerLabel('Xóa tài khoản'), 'Cần chuyển quyền Chủ họ trước')]);
}
const TITLE = { 'dang-nhap': 'Cách đăng nhập', 'thiet-bi': 'Thiết bị đang đăng nhập', 'dong-ho': 'Dòng họ của tôi', 'bao-mat': 'Bảo mật', 'xac-minh': 'Xác minh 2 bước', 'ma-khoi-phuc': 'Mã khôi phục', 'vung-nguy-hiem': 'Thao tác cần cẩn trọng' };
const SUB = { 'dang-nhap': signInPage, 'thiet-bi': devicesPage, 'dong-ho': familiesPage, 'bao-mat': securityPage, 'xac-minh': twoStepPage, 'ma-khoi-phuc': recoveryPage, 'vung-nguy-hiem': dangerPage };
function page(a, which) { return `<div class="acc-root">${(SUB[which] || mainPage)(a)}</div>`; }
function signedOut() {
  return '<div class="acc-root"><h1>Tài khoản</h1><section class="mg acc-out"><p class="sub">Đăng nhập để xem và đổi email, cách đăng nhập và thiết bị của bạn.</p>'
    + '<button type="button" class="btn" data-acct="in">Đăng nhập</button></section></div>';
}

// Runs a change; a stale sign-in asks for a fresh one first. Then the page is drawn again.
async function run(main, fn, done) {
  try { const out = await fn(); if (done) toast(done); await draw(main); return out; } catch (e) {
    if (e.reauth) return askReauth();
    toast(e.message);
  }
}
function askReauth() {
  confirmModal({ title: 'Xác nhận đây là bạn', body: 'Để thay đổi cách đăng nhập hoặc thiết bị, hãy đăng nhập lại bằng Google. Sau đó bạn quay về trang này và làm lại thao tác.',
    ok: 'Đăng nhập lại', onOk: () => { location.href = googleUrl('reauth'); } });
}
function emailForm(main) {
  const slot = main.querySelector('[data-slot="email"]');
  if (!slot || slot.firstChild) return slot?.querySelector('input')?.focus();
  slot.innerHTML = `<form class="acc-form" novalidate><label class="vh" for="acc-em">Email mới</label><input id="acc-em" type="email" autocomplete="email" inputmode="email" placeholder="ten@vidu.com" required><button type="submit" class="btn">Gửi đường dẫn xác minh</button><button type="button" class="btn gh" data-cancel>Hủy</button></form>`;
  const f = slot.querySelector('form'); const inp = f.querySelector('input'); inp.focus();
  f.querySelector('[data-cancel]').onclick = () => { slot.innerHTML = ''; };
  f.onsubmit = (ev) => { ev.preventDefault(); run(main, () => api('/api/account/emails', { method: 'POST', body: { email: inp.value } }), 'Đã gửi đường dẫn xác minh. Mở email để xác minh.'); };
}
// Adds a passkey to this device's fingerprint or Face ID. A stale sign-in asks to confirm first (run() does that).
async function addPasskeyFlow(main, a) {
  if (!a.families.length) return toast('Tham gia một dòng họ trước, rồi thêm passkey.');
  if (!(await canAddPasskey())) return toast('Máy này chưa có vân tay hoặc Face ID để tạo passkey.');
  return run(main, () => addPasskey((u, b) => api(u, { method: 'POST', body: b }), `?family=${encodeURIComponent(a.families[0].slug)}`), 'Đã thêm passkey.');
}
function nameForm(main, a) {
  const head0 = main.querySelector('.acc-head');
  const f = document.createElement('form'); f.className = 'acc-form';
  f.innerHTML = `<label class="vh" for="acc-nm">Tên hiển thị</label><input id="acc-nm" maxlength="120" autocomplete="name" value="${esc(a.name)}"><button type="submit" class="btn">Lưu</button><button type="button" class="btn gh" data-cancel>Hủy</button>`;
  head0.innerHTML = ''; head0.append(f); f.querySelector('input').focus();
  f.querySelector('[data-cancel]').onclick = () => draw(main);
  f.onsubmit = (ev) => { ev.preventDefault(); run(main, () => api('/api/account', { method: 'PATCH', body: { name: f.querySelector('input').value } }), 'Đã lưu tên.'); };
}

let cur = null; let curSub = '';
async function draw(main) {
  let a;
  try { a = await api('/api/account'); } catch (e) {
    main.innerHTML = e.status === 401 ? signedOut() : `<div class="acc-root"><h1>Tài khoản</h1><p class="sub pad">${esc(e.message)}</p></div>`; cur = null; titleFromPage(main); return;
  }
  cur = a;
  main.innerHTML = page(a, curSub);
  wireTotp(main);
  titleFromPage(main);
}
// The enrolment form (confirm with one code) and the copy buttons of the two-step pages.
function wireTotp(main) {
  const f = main.querySelector('[data-totp-form]');
  if (f) {
    const inp = f.querySelector('input'); inp.focus();
    f.onsubmit = (ev) => { ev.preventDefault(); run(main, async () => { const j = await api('/api/account/totp/confirm', { method: 'POST', body: { code: inp.value } }); setup = null; codes = j.recovery_codes; }, 'Đã bật xác minh 2 bước.'); };
  }
  const cs = main.querySelector('[data-copy-secret]'); if (cs && setup) cs.onclick = () => copyText(setup.secret, 'Đã sao chép khóa bí mật.');
  const cc = main.querySelector('[data-copy-codes]'); if (cc && codes) cc.onclick = () => copyText(codes.join('\n'), 'Đã sao chép mã khôi phục.');
}
async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { toast('Không sao chép được. Chọn và sao chép bằng tay.'); }
}
// The app sets the bar title before this page has loaded: take the title from the page's own h1 once it is drawn.
function titleFromPage(main) {
  const h = main.querySelector('.acc-root > h1'); const bar = document.getElementById('cbtitle');
  if (h && bar) bar.textContent = h.textContent;
}
export async function accountPage(main, { qs, sub: which = '', icon } = {}) {
  curSub = which; if (icon) ICON = icon;
  if (!['xac-minh', 'ma-khoi-phuc'].includes(which)) { setup = null; codes = null; }
  main.innerHTML = `<h1>${esc(TITLE[which] || 'Tài khoản')}</h1><p class="sub pad">Đang tải…</p>`;
  await draw(main);
  const msg = qs?.get('ok') === 'email' ? 'Đã xác minh email.' : qs?.get('err') || '';
  if (msg) { toast(msg); history.replaceState(null, '', location.pathname + '#tai-khoan' + (which ? '/' + which : '')); }
  if (main.dataset.accBound) return;
  main.dataset.accBound = '1';
  main.addEventListener('click', (e) => {
    if (!main.querySelector('.acc-root')) return; // another page is on screen now
    const a = cur; if (!a) return;
    const t = (sel) => e.target.closest(sel);
    if (t('[data-edit-name]')) return nameForm(main, a);
    if (t('[data-add-email]')) return emailForm(main);
    if (t('[data-add-passkey]')) return addPasskeyFlow(main, a);
    const pkm = t('[data-pk-id]');
    if (pkm) {
      const x = a.passkeys.find((y) => y.id === pkm.dataset.pkId); if (!x) return;
      return popMenu(pkm, [dangerItem('Gỡ passkey', () => confirmDanger({ title: 'Gỡ passkey này?', lose: `${x.label} sẽ không đăng nhập được nữa. Các thiết bị khác vẫn đăng nhập bình thường.`, confirm: 'Gỡ passkey', onConfirm: () => run(main, () => api(`/api/account/passkeys/${x.id}`, { method: 'DELETE', body: {} }), 'Đã gỡ passkey.') }))], '', { title: 'Passkey · ' + x.label });
    }
    const em = t('[data-em]');
    if (em) {
      const x = a.emails.find((y) => y.id === em.dataset.em); if (!x) return;
      const items = [];
      if (x.verified && !x.primary) items.push(['Đặt làm email chính', () => run(main, () => api(`/api/account/emails/${x.id}/primary`, { method: 'POST', body: {} }), 'Đã đổi email chính.')]);
      if (!x.verified) items.push(['Gửi lại đường dẫn xác minh', () => run(main, () => api('/api/account/emails', { method: 'POST', body: { email: x.email } }), 'Đã gửi lại đường dẫn xác minh.')]);
      if (!x.primary) items.push(dangerItem('Gỡ email', () => confirmDanger({ title: 'Gỡ email này?', lose: `${x.email} sẽ không còn thuộc tài khoản này và không mang vai trò dòng họ của tài khoản nữa.`, confirm: 'Gỡ email', onConfirm: () => run(main, () => api(`/api/account/identities/${x.id}`, { method: 'DELETE', body: {} }), 'Đã gỡ email.') })));
      if (!items.length) items.push(['Email chính không gỡ được. Chọn email khác làm chính trước.', () => {}]);
      return popMenu(em, items, '', { title: x.email });
    }
    const idm = t('[data-idm]');
    if (idm) {
      const x = a.linked.find((y) => y.id === idm.dataset.idm); if (!x) return;
      return popMenu(idm, [dangerItem('Gỡ liên kết', () => confirmDanger({ title: 'Gỡ liên kết Google?', lose: `Bạn sẽ không đăng nhập bằng Google ${x.email} được nữa.`, confirm: 'Gỡ liên kết', onConfirm: () => run(main, () => api(`/api/account/identities/${x.id}`, { method: 'DELETE', body: {} }), 'Đã gỡ liên kết.') }))], '', { title: 'Google · ' + x.email });
    }
    if (t('[data-totp-on]')) return run(main, async () => { setup = await api('/api/account/totp/setup', { method: 'POST', body: {} }); }, '');
    if (t('[data-totp-cancel]')) { setup = null; return draw(main); }
    if (t('[data-codes-done]')) { codes = null; return draw(main); }
    if (t('[data-totp-regen]')) return confirmModal({ title: 'Tạo mã khôi phục mới?', body: 'Mã cũ sẽ không dùng được nữa. Mã mới chỉ hiện một lần.', ok: 'Tạo mã mới',
      onOk: () => run(main, async () => { const j = await api('/api/account/totp/recovery', { method: 'POST', body: {} }); codes = j.recovery_codes; }, 'Đã tạo mã khôi phục mới.') });
    if (t('[data-totp-off]')) return confirmDanger({ title: 'Tắt xác minh 2 bước?', lose: 'Đăng nhập bằng Google chỉ cần một bước. Mã khôi phục sẽ bị xóa.',
      restore: 'Bật lại bất cứ lúc nào: cần đăng nhập lại và quét mã QR mới.', confirm: 'Tắt xác minh 2 bước',
      onConfirm: () => run(main, () => api('/api/account/totp', { method: 'DELETE', body: {} }), 'Đã tắt xác minh 2 bước.') });
    if (t('[data-link="google"]')) {
      if (!a.fresh) return askReauth();
      location.href = googleUrl('link'); return;
    }
    const se = t('[data-sess]');
    if (se) {
      const isCur = se.dataset.cur === '1';
      return popMenu(se, [[isCur ? 'Đăng xuất thiết bị này' : 'Đăng xuất thiết bị này khỏi tài khoản', () => run(main, async () => {
        const j = await api(`/api/account/sessions/${se.dataset.sess}/revoke`, { method: 'POST', body: {} });
        if (j.current) { location.hash = '#more'; location.reload(); }
        return j;
      }, isCur ? '' : 'Đã đăng xuất thiết bị đó.'), true]]);
    }
    if (t('[data-out-others]')) {
      return confirmDanger({ title: 'Đăng xuất các thiết bị khác?', lose: 'Mọi thiết bị khác đang đăng nhập tài khoản này sẽ bị đăng xuất.', restore: 'Thiết bị này vẫn đăng nhập.', confirm: 'Đăng xuất', onConfirm: () => run(main, () => api('/api/account/sessions/revoke-others', { method: 'POST', body: {} }), 'Đã đăng xuất các thiết bị khác.') });
    }
  });
}
