// Đăng nhập › bước 2 (#dang-nhap-2fa): after a Google sign-in on an account with two-step sign-in on, the session starts
// here, once a code from the authenticator app (or one recovery code) is right. The server keeps the pending sign-in in
// a cookie for five minutes (server/totp-routes.js). A passkey sign-in never comes here.
import { esc } from './model.js';

// The page: who is signing in, one field for the 6-digit code or a recovery code, and a way out.
export async function twoStepPage(main) {
  main.innerHTML = '<div class="acc-root"><h1>Xác minh 2 bước</h1><p class="sub pad">Đang tải…</p></div>';
  const st = await fetch('/api/auth/2fa/state', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ pending: false }));
  if (!st.pending) {
    main.innerHTML = '<div class="acc-root"><h1>Xác minh 2 bước</h1><section class="mg acc-out"><p>Phiên xác minh đã hết hạn. Đăng nhập lại để tiếp tục.</p>'
      + '<a class="btn" href="#tree">Về trang chính</a></section></div>';
    return;
  }
  main.innerHTML = `<div class="acc-root"><h1>Xác minh 2 bước</h1>
    <section class="mg acc-out">
      <p>${st.email ? `Đăng nhập cho <b>${esc(st.email)}</b>. ` : ''}Nhập mã 6 số trong ứng dụng xác thực. Không có điện thoại? Nhập một mã khôi phục.</p>
      <form class="acc-form twostep-form" novalidate>
        <label class="vh" for="twostep-code">Mã xác minh</label><input id="twostep-code" name="code" inputmode="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="9" placeholder="Mã 6 số" required>
        <button type="submit" class="btn">Xác nhận</button>
        <a class="btn gh" href="#tree">Hủy</a>
      </form>
      <p class="err" role="alert" hidden></p>
    </section></div>`;
  const f = main.querySelector('.twostep-form'); const inp = f.querySelector('input'); const err = main.querySelector('.err');
  const btn = f.querySelector('button[type=submit]');
  inp.focus();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const code = inp.value.trim();
    if (!code) return;
    btn.disabled = true; err.hidden = true;
    try {
      const r = await fetch('/api/auth/2fa/verify', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { location.href = j.to || '/'; return; }
      err.textContent = j.error || 'Lỗi máy chủ, thử lại sau.'; err.hidden = false;
      if (r.status === 401 && /hết hạn/.test(err.textContent)) btn.disabled = true; else btn.disabled = false;
      if (r.status !== 429) inp.select();
    } catch { err.textContent = 'Không kết nối được. Kiểm tra mạng rồi thử lại.'; err.hidden = false; btn.disabled = false; }
  };
}
