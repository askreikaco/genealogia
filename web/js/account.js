// Thêm › Tài khoản (#tai-khoan): the signed-in account (account plan P1), Google-account style. The main page is a header
// card and one list of summary rows; each row opens a subpage (#tai-khoan/<sub>) with the details: sign-in methods,
// devices, families, security activity, and the danger zone. Built from the shared row (calmRow + calmAct + popMenu).
// Sensitive changes answer { reauth: true } when the last sign-in is older than 10 minutes: the person signs in with
// Google again (/api/auth/google?mode=reauth) and comes back here.
import { esc } from './model.js';
import { calmRow, calmAct, cic, popMenu, toast, confirmModal, fmtTime, fmtDate, moreFold } from './ui.js';

async function api(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, { method, cache: 'no-store', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Lỗi máy chủ, thử lại sau.'), { status: r.status, reauth: !!j.reauth });
  return j;
}
const googleUrl = (mode) => `/api/auth/google?mode=${mode}&next=tai-khoan`;
const ROLE = { owner: 'Chủ họ', admin: 'Quản trị', editor: 'Biên tập', member: 'Thành viên' };
const EVENT = {
  account_created: 'Tạo tài khoản', signin: 'Đăng nhập', reauth: 'Xác nhận lại bằng Google', session_upgraded: 'Thiết bị chuyển sang phiên mới',
  email_added: 'Thêm email, chờ xác minh', email_verified: 'Xác minh email', email_removed: 'Gỡ email', primary_changed: 'Đổi email chính',
  google_linked: 'Liên kết Google', google_unlinked: 'Gỡ liên kết Google', session_revoked: 'Đăng xuất một thiết bị',
  sessions_revoked_others: 'Đăng xuất các thiết bị khác', name_changed: 'Đổi tên hiển thị',
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
  if (a.events.length) rows.push(calmRow({ href: '#tai-khoan/bao-mat', icon: tileOf('shield'), title: 'Bảo mật', subtitle: esc(`Hoạt động gần nhất ${when(a.events[0].at)}`), dense: true }));
  return `<h1>Tài khoản</h1>${head(a)}<section class="mg"><div class="mg-g">${rows.join('')}</div></section>`
    + `<div class="acc-foot"><button type="button" class="acc-signout" id="logout">${ICON('logout')}Đăng xuất</button>`
    + `<a class="acc-quiet" href="#tai-khoan/vung-nguy-hiem">${ICON('warning')}Vùng nguy hiểm</a></div>`;
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
    subtitle: esc(['Tạo ' + fmtDate(p.created_at), p.last_used_at ? 'dùng lần cuối ' + fmtDate(p.last_used_at) : 'chưa dùng'].join(' · ')) }));
  return `<h1>Cách đăng nhập</h1><section class="mg acc-g">`
    + sub('Email', [...emails, addRow('Thêm email', 'data-add-email')])
    + '<div class="acc-form-slot" data-slot="email"></div>'
    + sub('Số điện thoại', [soon('Thêm số điện thoại', 'Đăng nhập bằng mã gửi qua tin nhắn')])
    + sub('Passkey', [...passkeys, soon('Tạo passkey trên thiết bị này', 'Face ID, vân tay hoặc khóa bảo mật')])
    + sub('Tài khoản liên kết', [...google, addRow(google.length ? 'Liên kết thêm tài khoản Google' : 'Liên kết Google', 'data-link="google"'), soon('Apple'), soon('Zalo'), soon('Facebook')])
    + sub('Xác minh 2 bước', [soon('Ứng dụng xác thực', 'Mã 6 số từ ứng dụng như Google Authenticator'), soon('Mã khôi phục', 'Dùng khi mất thiết bị')])
    + '</section>';
}
function devicesPage(a) {
  const sess = a.sessions.map((s) => calmRow({ title: s.label || 'Thiết bị', trailing: 'none', dense: true,
    subtitle: esc([s.ip, 'hoạt động ' + when(s.last_seen_at)].filter(Boolean).join(' · ')), badge: s.current ? tag('Thiết bị này', 'green') : '',
    action: more('Tùy chọn cho ' + (s.label || 'thiết bị'), `data-sess="${esc(s.id)}" data-cur="${s.current ? 1 : 0}"`) }));
  const others = a.sessions.filter((s) => !s.current).length;
  return `<h1>Thiết bị đang đăng nhập</h1>`
    + group('Thiết bị', [...sess, ...(others ? [calmRow({ attrs: 'data-out-others', title: `Đăng xuất ${others} thiết bị khác`, trailing: 'none', dense: true, danger: true })] : [])]);
}
function familiesPage(a) {
  const fams = a.families.map((f) => calmRow({ href: f.slug === 'duong' ? '#tree' : `#/${f.slug}/tree`, title: f.name, badge: tag(ROLE[f.role] || f.role), dense: true }));
  return `<h1>Dòng họ của tôi</h1>` + group('Dòng họ', fams, a.families.length ? '' : 'Bạn chưa là thành viên dòng họ nào.');
}
function securityPage(a) {
  const evRows = a.events.map((e) => calmRow({ title: EVENT[e.kind] || e.kind, trailing: 'none', dense: true,
    subtitle: esc([when(e.at), e.device, e.ip, e.detail?.email || e.detail?.value || ''].filter(Boolean).join(' · ')) }));
  const body = evRows.length ? `${evRows.slice(0, 5).join('')}${evRows.length > 5 ? moreFold(`Xem thêm ${evRows.length - 5} hoạt động`, evRows.slice(5).join('')) : ''}` : '<p class="sub pad">Chưa có hoạt động.</p>';
  return `<h1>Bảo mật</h1><section class="mg acc-g"><div class="mg-g">${body}</div></section>`;
}
function dangerPage() {
  return `<h1>Vùng nguy hiểm</h1>` + group('Xóa tài khoản', [soon('Xóa tài khoản', 'Cần chuyển quyền Chủ họ trước')]);
}
const TITLE = { 'dang-nhap': 'Cách đăng nhập', 'thiet-bi': 'Thiết bị đang đăng nhập', 'dong-ho': 'Dòng họ của tôi', 'bao-mat': 'Bảo mật', 'vung-nguy-hiem': 'Vùng nguy hiểm' };
const SUB = { 'dang-nhap': signInPage, 'thiet-bi': devicesPage, 'dong-ho': familiesPage, 'bao-mat': securityPage, 'vung-nguy-hiem': dangerPage };
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
  titleFromPage(main);
}
// The app sets the bar title before this page has loaded: take the title from the page's own h1 once it is drawn.
function titleFromPage(main) {
  const h = main.querySelector('.acc-root > h1'); const bar = document.getElementById('cbtitle');
  if (h && bar) bar.textContent = h.textContent;
}
export async function accountPage(main, { qs, sub: which = '', icon } = {}) {
  curSub = which; if (icon) ICON = icon;
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
    const em = t('[data-em]');
    if (em) {
      const x = a.emails.find((y) => y.id === em.dataset.em); if (!x) return;
      const items = [];
      if (x.verified && !x.primary) items.push(['Đặt làm email chính', () => run(main, () => api(`/api/account/emails/${x.id}/primary`, { method: 'POST', body: {} }), 'Đã đổi email chính.')]);
      if (!x.verified) items.push(['Gửi lại đường dẫn xác minh', () => run(main, () => api('/api/account/emails', { method: 'POST', body: { email: x.email } }), 'Đã gửi lại đường dẫn xác minh.')]);
      if (!x.primary) items.push(['Gỡ email', () => confirmModal({ title: 'Gỡ email này?', body: `${x.email} sẽ không còn thuộc tài khoản này và không mang vai trò dòng họ của tài khoản nữa.`, ok: 'Gỡ email', danger: true,
        onOk: () => run(main, () => api(`/api/account/identities/${x.id}`, { method: 'DELETE', body: {} }), 'Đã gỡ email.') }), true]);
      if (!items.length) items.push(['Email chính không gỡ được. Chọn email khác làm chính trước.', () => {}]);
      return popMenu(em, items, '', { title: x.email });
    }
    const idm = t('[data-idm]');
    if (idm) {
      const x = a.linked.find((y) => y.id === idm.dataset.idm); if (!x) return;
      return popMenu(idm, [['Gỡ liên kết', () => confirmModal({ title: 'Gỡ liên kết Google?', body: `Bạn sẽ không đăng nhập bằng Google ${x.email} được nữa.`, ok: 'Gỡ liên kết', danger: true,
        onOk: () => run(main, () => api(`/api/account/identities/${x.id}`, { method: 'DELETE', body: {} }), 'Đã gỡ liên kết.') }), true]], '', { title: 'Google · ' + x.email });
    }
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
      return confirmModal({ title: 'Đăng xuất các thiết bị khác?', body: 'Mọi thiết bị khác đang đăng nhập tài khoản này sẽ bị đăng xuất. Thiết bị này vẫn đăng nhập.', ok: 'Đăng xuất', danger: true,
        onOk: () => run(main, () => api('/api/account/sessions/revoke-others', { method: 'POST', body: {} }), 'Đã đăng xuất các thiết bị khác.') });
    }
  });
}
