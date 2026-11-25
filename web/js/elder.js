// Elder access (managed profiles, sign-in by code, passkeys, printed card, act on behalf of a person). Minimal by design:
// one "Cách khác" link on the sign-in page, one code screen, one approve sheet, one passkey offer (asked once),
// rows in the person's ⋯ menu. The app passes its dialog/render helpers in init(), so this module does not import app.js.
import * as S from './store.js';
import { openSheet } from './relui.js';
import { confirmModal } from './ui.js';
import { searchPeople } from './fuzzy.js';
import { canUsePasskeys, canAddPasskey, addPasskey, signInWithPasskey } from './passkey.js';
import { dangerButton, dangerZone, dangerItem, dangerLabel, confirmDanger } from './danger.js';

let api = null;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString('vi-VN') : '');
const famQ = () => { const f = S.curFamily(); return f && f !== 'tat-ca' ? `family=${encodeURIComponent(f)}` : ''; };
const withFam = (url) => { const q = famQ(); return q ? url + (url.includes('?') ? '&' : '?') + q : url; };
async function call(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Có lỗi, thử lại.'); e.status = r.status; throw e; }
  return j;
}
const fail = (d, msg) => { const box = d.querySelector('.err') || d.querySelector('.rel-body').appendChild(Object.assign(document.createElement('p'), { className: 'err' })); box.textContent = msg; };
// One calm row with a trailing action. A plain div (not calmRow's button): a button cannot hold another button.
const rowWith = (title, sub, action) => `<div class="calm dense"><span class="calm-t"><b class="calm-n">${esc(title)}</b>${sub ? `<span class="calm-s">${esc(sub)}</span>` : ''}</span>${action}</div>`;

export function init(a) {
  api = a;
  installActAs();
  // Inline notices live in the page flow (top of #main), never over content. They are re-placed after each render.
  const main = document.getElementById('main');
  if (main) new MutationObserver(() => syncInline()).observe(main, { childList: true });
  setTimeout(() => { passkeyCheck().then(syncInline).catch(() => {}); syncInline(); }, 800);
  addEventListener('hashchange', () => syncInline());
}
// Notices that belong on screen now: the act-as banner while acting; the passkey offer on the More page until answered.
function syncInline() {
  if (!document.getElementById('main')) return;
  const a = actAsId();
  if (a && !document.querySelector('.elder-as')) actBanner(a);
  if (!a) document.querySelector('.elder-as')?.remove();
  if (offerReady && !offerAnswered() && /^#more\b/.test(location.hash) && !document.querySelector('.elder-offer')) passkeyOffer();
}

// ---- 1. sign-in: "Cách khác" sheet (code from a relative, or a passkey) ----
export function wireLogin(dialogEl) {
  dialogEl.querySelector('[data-elder]')?.addEventListener('click', () => { dialogEl.close(); dialogEl.remove(); otherSheet(); });
  // "Đăng nhập bằng passkey": shown only where the browser can do passkeys; no email typed (the passkey names the account).
  const pk = dialogEl.querySelector('.pk-login');
  if (pk) canUsePasskeys().then((ok) => {
    if (!ok) return;
    pk.hidden = false;
    pk.querySelector('[data-pk-login]').addEventListener('click', async () => {
      try { await passkeySignIn(); } catch (e) { pk.querySelector('.err').textContent = e.message; }
    });
  });
}
function otherSheet() {
  const d = openSheet(`<h2>Đăng nhập cách khác</h2>
    <div class="calm-list">
      <button type="button" class="calm" data-code><span class="calm-t"><b class="calm-n">Mã từ người thân</b><span class="calm-s">Người quản lý duyệt trên điện thoại của họ</span></span></button>
      <button type="button" class="calm" data-pk><span class="calm-t"><b class="calm-n">Vân tay hoặc Face ID</b><span class="calm-s">Trên thiết bị đã đăng ký</span></span></button>
    </div>
    <p class="err" role="alert"></p>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Đóng</button></div>`);
  d.querySelector('[data-cancel]').onclick = () => d.close();
  d.querySelector('[data-code]').onclick = () => { d.close(); codeScreen(); };
  d.querySelector('[data-pk]').onclick = async () => { try { await passkeySignIn(); } catch (e) { fail(d, e.message); } };
}
function codeScreen() {
  const d = openSheet(`<h2>Đăng nhập bằng mã</h2>
    <p class="elder-code" aria-live="polite">… </p>
    <div class="elder-qr"></div>
    <p class="sub">Người quản lý quét mã hoặc nhập mã này.</p>
    <p class="err" role="alert"></p>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Đóng</button></div>`);
  let timer = null, alive = true;
  const stop = () => { alive = false; clearTimeout(timer); };
  d.addEventListener('close', stop);
  d.querySelector('[data-cancel]').onclick = () => d.close();
  const start = async () => {
    stop(); alive = true;
    d.querySelector('.err').textContent = '';
    d.querySelector('.elder-qr').innerHTML = '';
    let s;
    try { s = await call('POST', '/api/device/start', {}); } catch (e) { d.querySelector('.err').textContent = e.message; return; }
    d.querySelector('.elder-code').textContent = s.user_code.replace(/(\d{3})(\d{3})/, '$1 $2');
    d.querySelector('.elder-qr').innerHTML = s.qr_svg;
    const poll = async () => {
      if (!alive) return;
      try {
        const p = await call('POST', '/api/device/poll', { device_code: s.device_code });
        if (p.status === 'signed_in') { alive = false; d.close(); location.reload(); return; }
        if (p.status === 'used') { alive = false; location.reload(); return; }
        if (p.status === 'expired') { alive = false; d.querySelector('.err').textContent = 'Mã đã hết hạn.'; d.querySelector('.elder-code').innerHTML = '<button type="button" class="btn" data-again>Lấy mã mới</button>'; d.querySelector('[data-again]').onclick = start; return; }
      } catch (e) { d.querySelector('.err').textContent = e.message; }
      timer = setTimeout(poll, (s.interval || 3) * 1000);
    };
    timer = setTimeout(poll, (s.interval || 3) * 1000);
  };
  start();
}

// ---- passkeys (passkey.js: WebAuthn through the vendored browser library) ----
const PK_FLAG = 'gp_pk_offer';
const post = (u, b) => call('POST', u, b);
const passkeySupported = canAddPasskey;
const passkeySignIn = async () => { await signInWithPasskey(post); location.reload(); };
const passkeyRegister = () => addPasskey(post, famQ() ? '?' + famQ() : '');
// Whether this device can offer a passkey for this account (signed in, platform authenticator, none yet). Checked once.
let offerReady = false;
async function passkeyCheck() {
  let asked = offerAnswered();
  if (asked || !S.signedIn() && !Object.keys(S.myAccount().roles || {}).length) return;
  if (!(await passkeySupported())) return;
  const have = await call('GET', withFam('/api/passkey/mine')).catch(() => ({ count: 1 }));
  if (have.count > 0) return setAsked();
  offerReady = true;
}
// The offer: one inline row at the top of the More page, until it is answered once (dismissed or accepted).
function passkeyOffer() {
  const row = document.createElement('div');
  row.className = 'elder-offer'; row.setAttribute('role', 'status');
  row.innerHTML = `<span>Dùng vân tay / Face ID lần sau?</span><span class="elder-offer-acts"><button type="button" class="btn gh sm" data-no>Không</button><button type="button" class="btn sm" data-yes>Bật</button></span>`;
  document.getElementById('main').prepend(row);
  const close = () => { setAsked(); row.remove(); };
  row.querySelector('[data-no]').onclick = close;
  row.querySelector('[data-yes]').onclick = async () => {
    try { await passkeyRegister(); close(); } catch (e) { row.querySelector('span').textContent = e.message || 'Không bật được.'; }
  };
}
function offerAnswered() { try { return !!localStorage.getItem(PK_FLAG); } catch { return false; } }
function setAsked() { try { localStorage.setItem(PK_FLAG, '1'); } catch {} }

// ---- 2. approve on a signed-in phone (#approve=CODE from the QR) ----
async function approveSheet(code) {
  let info;
  try { info = await call('GET', `/api/device/code/${code}`); }
  catch (e) {
    if (e.status === 401) { api.loginDialog(); return; }
    openSheet(`<h2>Không cho phép được</h2><p class="err">${esc(e.message)}</p><div class="row end"><button class="btn" data-cancel>Đóng</button></div>`);
    return;
  }
  const people = info.choices.map((c) => ({ id: c.id, data: { name: c.name }, family: c.family_id }));
  const one = people.length === 1;
  let chosen = one ? people[0].id : null;
  const search = one ? '' : `<label class="fld">Đăng nhập cho<input type="search" name="q" autocomplete="off" placeholder="Tìm tên"></label><div class="elder-pick" role="listbox"></div>`;
  const d = openSheet(`<h2>Cho phép đăng nhập?</h2>${one ? `<p class="elder-who">Đăng nhập cho ${esc(people[0].data.name)}</p>` : search}
    <p class="err" role="alert"></p>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Không</button><button type="button" class="btn" data-ok>Cho phép</button></div>`);
  const list = (q) => {
    const hits = q ? searchPeople(people, q, { limit: 8 }) : people.slice(0, 8);
    d.querySelector('.elder-pick').innerHTML = hits.map((p) => `<button type="button" class="calm" role="option" aria-selected="${p.id === chosen}" data-pick="${esc(p.id)}"><span class="calm-t"><b class="calm-n">${esc(p.data.name)}</b></span></button>`).join('') || '<p class="sub">Không có ai khớp.</p>';
    d.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { chosen = b.dataset.pick; d.querySelector('input[name=q]').value = people.find((p) => p.id === chosen)?.data.name || ''; list(''); }; });
  };
  if (!one) {
    list('');
    d.querySelector('input[name=q]').oninput = (e) => { chosen = null; list(e.target.value.trim()); };
  }
  d.querySelector('[data-cancel]').onclick = () => d.close();
  d.querySelector('[data-ok]').focus();
  d.querySelector('[data-ok]').onclick = async () => {
    if (!chosen) return fail(d, 'Chọn người cần đăng nhập.');
    try {
      const r = await call('POST', '/api/device/approve', { user_code: code, person_id: chosen });
      d.querySelector('.rel-body').innerHTML = `<h2>${r.status === 'waiting' ? 'Đã duyệt lần 1' : 'Đã cho phép'}</h2>
        <p class="sub">${r.status === 'waiting' ? 'Cần thêm một Chủ họ hoặc Quản trị duyệt.' : 'Thiết bị sẽ tự đăng nhập.'}</p>
        <div class="row end"><button type="button" class="btn" data-cancel>Xong</button></div>`;
      d.querySelector('[data-cancel]').onclick = () => d.close();
    } catch (e) { fail(d, e.message); }
  };
}

// ---- 3. the card on the elder's device (#card=TOKEN): confirm, then sign in ----
function cardConfirm(token) {
  const d = openSheet(`<h2>Đăng nhập trên thiết bị này?</h2>
    <p class="sub">Chỉ bấm nếu đây là điện thoại hoặc máy tính của người thân.</p>
    <p class="err" role="alert"></p>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Không</button><button type="button" class="btn" data-ok>Đăng nhập</button></div>`);
  d.querySelector('[data-cancel]').onclick = () => d.close();
  d.querySelector('[data-ok]').onclick = async () => {
    try { await call('POST', '/api/card/use', { token }); d.close(); location.reload(); }
    catch (e) { fail(d, e.message); }
  };
}

// Hash entry points: called once at start and on hash change. Returns true when it took the hash.
export function handleHash() {
  const h = location.hash;
  let m;
  if ((m = /^#approve=(\d{6})$/.exec(h))) { history.replaceState(null, '', '#tree'); approveSheet(m[1]); return true; }
  if ((m = /^#card=([A-Za-z0-9_-]{20,80})$/.exec(h))) { history.replaceState(null, '', '#tree'); cardConfirm(m[1]); return true; }
  return false;
}

// ---- 4. person's ⋯ menu: managers, devices, card, act on behalf ----
export const MENU_ITEMS = [['actas', 'Thay mặt người này'], ['managers', 'Người thân quản lý'], ['devices', 'Quản lý thiết bị'], ['card', 'Thẻ đăng nhập']];
export function personAct(k, personId) {
  if (k === 'managers') return managersSheet(personId);
  if (k === 'devices') return devicesSheet(personId);
  if (k === 'card') return cardSheet(personId);
  if (k === 'actas') return actAsStart(personId);
}
async function managersSheet(id) {
  const d = openSheet('<p class="sub">Đang tải…</p>');
  const paint = (j) => {
    d.querySelector('.rel-body').innerHTML = `<h2>Người thân quản lý</h2>
      <p class="sub">${esc(j.person.name)} · người quản lý thao tác theo quyền của mình.</p>
      <div class="calm-list">${j.managers.map((m) => rowWith(m.name, m.email, dangerButton('Bỏ', `data-rm="${esc(m.email)}"`, { size: 'sm' }))).join('')}</div>
      <form class="row" data-add><input class="fld" type="email" name="email" placeholder="Email người quản lý" required><button class="btn sm">Thêm</button></form>
      <p class="err" role="alert"></p>`;
    d.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => confirmDanger({ title: `Bỏ quyền quản lý của ${b.dataset.rm}?`, lose: 'Người này không còn quản lý hồ sơ này.', restore: 'Có thể thêm lại sau.', confirm: 'Bỏ quyền', onConfirm: () => change(b.dataset.rm, false) }); });
    d.querySelector('[data-add]').onsubmit = (e) => { e.preventDefault(); change(new FormData(e.target).get('email').trim(), true); };
  };
  const change = async (email, on) => {
    try { await call('PUT', `/api/persons/${id}/managers`, { email, on }); paint(await call('GET', `/api/persons/${id}/managers`)); }
    catch (e) { fail(d, e.message); }
  };
  try { paint(await call('GET', `/api/persons/${id}/managers`)); } catch (e) { fail(d, e.message); }
}
async function devicesSheet(id) {
  const d = openSheet('<p class="sub">Đang tải…</p>');
  const paint = (j) => {
    d.querySelector('.rel-body').innerHTML = `<h2>Thiết bị đã đăng nhập</h2>
      <p class="sub">${esc(j.person.name)}</p>
      <div class="calm-list">${j.devices.map((v) => rowWith(v.device || 'Thiết bị', `Đăng nhập ${dayOf(v.created_at)}`, `<button type="button" class="ib" data-more="${esc(v.id)}" aria-label="Thao tác với ${esc(v.device || 'thiết bị')}">⋯</button>`)).join('') || '<p class="sub">Chưa có thiết bị nào.</p>'}</div>
      <p class="err" role="alert"></p>`;
    d.querySelectorAll('[data-more]').forEach((b) => { b.onclick = () => confirmModal({ title: 'Đăng xuất thiết bị này?', body: 'Thiết bị này sẽ phải đăng nhập lại bằng mã hoặc thẻ.', ok: 'Đăng xuất', danger: true, onOk: () => revoke(b.dataset.more) }); });
  };
  const revoke = async (did) => {
    try { await call('POST', `/api/devices/${did}/revoke`, {}); paint(await call('GET', `/api/persons/${id}/devices`)); }
    catch (e) { fail(d, e.message); }
  };
  try { paint(await call('GET', `/api/persons/${id}/devices`)); } catch (e) { fail(d, e.message); }
}
async function cardSheet(id) {
  const d = openSheet('<p class="sub">Đang tải…</p>');
  const show = (j) => {
    d.querySelector('.rel-body').innerHTML = `<h2>Thẻ đăng nhập</h2>
      <p class="sub">${j.card ? `Thẻ đang dùng · đã dùng ${j.card.uses} lần` : 'Chưa có thẻ.'}</p>
      <div class="row end">${j.card ? '<button type="button" class="btn ter" data-rv>Thu hồi</button>' : ''}<button type="button" class="btn" data-pr>In thẻ mới</button></div>
      <p class="sub">In thẻ mới thì thẻ cũ ngừng dùng.</p>
      <p class="err" role="alert"></p>`;
    d.querySelector('[data-pr]').onclick = () => printCard(id, j.person.name, d);
    const rv = d.querySelector('[data-rv]');
    if (rv) rv.onclick = async () => { try { await call('POST', `/api/persons/${id}/card/revoke`, {}); show(await call('GET', `/api/persons/${id}/card`)); } catch (e) { fail(d, e.message); } };
  };
  try { show(await call('GET', `/api/persons/${id}/card`)); } catch (e) { fail(d, e.message); }
}
// Print view: one card with the QR. CSS prints only this card (see app.css .elder-print).
async function printCard(id, name, sheetEl) {
  let c;
  try { c = await call('POST', `/api/persons/${id}/card`, {}); } catch (e) { return fail(sheetEl, e.message); }
  sheetEl?.close();
  const v = document.createElement('div');
  v.className = 'elder-print';
  v.innerHTML = `<div class="elder-card"><p class="elder-card-h">${esc(name)}</p><div class="elder-qr">${c.qr_svg}</div>
    <p class="elder-card-fam">${esc(c.family || '')}</p><p class="elder-card-url">${esc(location.host)}</p>
    <p>Quét mã này bằng điện thoại để đăng nhập. Giữ kín thẻ.</p></div>
    <div class="elder-print-bar"><button type="button" class="btn" data-go>In</button><button type="button" class="btn ter" data-close>Đóng</button></div>`;
  document.body.append(v);
  v.querySelector('[data-go]').onclick = () => window.print();
  v.querySelector('[data-close]').onclick = () => v.remove();
}

// ---- 5. act on behalf of a managed person ("thay mặt") ----
// The choice is kept for this tab (sessionStorage). Every write from the app then carries x-act-as; the server checks
// the manager again and writes the history as "<manager> · thay mặt <person>". A banner says so, with an exit.
const AS_KEY = 'gp_act_as';
const actAsId = () => { try { return JSON.parse(sessionStorage.getItem(AS_KEY) || 'null'); } catch { return null; } };
async function actAsStart(id) {
  try {
    const j = await call('POST', withFam(`/api/persons/${id}/act-as`), {});
    sessionStorage.setItem(AS_KEY, JSON.stringify({ id, name: j.name }));
    actBanner();
    if (api?.render) api.render();
  } catch (e) {
    const d = openSheet(`<h2>Không thay mặt được</h2><p class="err">${esc(e.message)}</p><div class="row end"><button class="btn" data-cancel>Đóng</button></div>`);
    d.querySelector('[data-cancel]').onclick = () => d.close();
  }
}
function actBanner(a = actAsId()) {
  document.querySelector('.elder-as')?.remove();
  if (!a) return;
  const b = document.createElement('div');
  b.className = 'elder-as'; b.setAttribute('role', 'status');
  b.innerHTML = `<span>Đang thay mặt <b>${esc(a.name)}</b></span><button type="button" class="btn gh sm" data-end>Thoát</button>`;
  document.getElementById('main').prepend(b);
  b.querySelector('[data-end]').onclick = () => { sessionStorage.removeItem(AS_KEY); b.remove(); api?.render?.(); };
}
// One wrapper for the app's writes: adds the header while acting. Reads and other origins are untouched.
let actFetchInstalled = false;
function installActAs() {
  if (actFetchInstalled || typeof window.fetch !== 'function') return;
  actFetchInstalled = true;
  const f = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const a = actAsId();
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();
    if (a && /^\/api\//.test(url) && /^(POST|PUT|PATCH|DELETE)$/.test(method)) {
      init = { ...init, headers: { ...(init.headers || {}), 'x-act-as': a.id } };
    }
    return f(input, init);
  };
}
