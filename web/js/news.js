// Tin họ (family news) and the gatherings on Lịch (server/news.js). Thông báo = notice, Họp mặt = gathering.
// Members only. Pages: feed #/<fam>/tin, detail #/<fam>/tin/<id>, editor #/<fam>/tin-sua[/<id>][?kind=gathering] (a page).
// Shared pieces: toolbar + addBtn, .li rows, danger components (dangerButton, dangerZone, confirmDanger).
// Pure helpers live in lich-merge.js.
import { esc } from './model.js';
import { toast, toolbar, addBtn, calmRow, tag, card, section } from './ui.js';
import { icsCalendar, icsDay, icsText, saveIcs } from './ics.js';
import { ico, choiceRow } from './choice.js';
import { collapsedGroups } from './groups.js';
import { dangerButton, dangerZone, confirmDanger, dangerLabel } from './danger.js';
import { topNews, badgeCount, dayMs } from './lich-merge.js';

const SEEN_KEY = 'news_seen';
const HOLD_VI = { link: 'có liên kết', phone: 'có số điện thoại', account: 'có dãy số giống số tài khoản', word: 'có từ không phù hợp' };
let kindSel = 'all'; // Lịch filter chip: all | gio | gath (kept while the app runs)
const cache = new Map(); // family -> { at, posts, can_post, is_admin, posters }
const TTL = 15000;

async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Chưa làm được: ' + r.status);
  return j;
}
const q = (fam) => `family=${encodeURIComponent(fam)}`;
const bust = (fam) => cache.delete(fam);
// The page element that is on screen now: the app may have replaced the one a handler was given at first render.
const onScreen = (main) => (main && main.isConnected ? main : document.querySelector('main') || main);

// Posts of a family (cached for a few seconds). force refetches.
export async function loadPosts(fam, { force = false } = {}) {
  const c = cache.get(fam);
  if (!force && c && Date.now() - c.at < TTL) return c;
  const j = await api('GET', `/api/posts?${q(fam)}`);
  const v = { at: Date.now(), posts: j.posts || [], can_post: !!j.can_post, is_admin: !!j.is_admin, posters: j.posters || 'admin' };
  cache.set(fam, v);
  return v;
}
export const cached = (fam) => cache.get(fam) || null;
export const seenAt = (fam, getPrefs) => Number(((getPrefs?.() || {})[SEEN_KEY] || {})[fam]) || 0;
// Lịch tab badge number for a family (unread posts + gatherings within 7 days).
export const badgeFor = (fam, getPrefs) => { const c = cache.get(fam); if (!c) return 0; const t = new Date(); return badgeCount(c.posts.filter((p) => p.status === 'live'), seenAt(fam, getPrefs), new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()); };
export const kindHit = (row) => kindSel === 'all' || row.dataset.k === kindSel;
export const kindNow = () => kindSel;

const fmtDay = (iso) => new Date(dayMs(iso)).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
const kindLabel = (p) => (p.kind === 'gathering' ? 'Họp mặt' : 'Thông báo');
const paras = (s) => esc(s || '').split(/\n+/).filter(Boolean).map((x) => `<p>${x}</p>`).join('');
const badges = (p) => `${p.pinned ? ' <span class="tag sm">Ghim</span>' : ''}${p.status === 'held' ? ' <span class="tag sm yellow">Chờ duyệt</span>' : ''}${p.status === 'hidden' ? ' <span class="tag sm yellow">Bị ẩn</span>' : ''}`;

export const chipsHtml = () => `<div class="chips" role="group" aria-label="Lọc lịch">${[['all', 'Tất cả'], ['gio', 'Giỗ'], ['gath', 'Họp mặt']]
  .map(([k, l]) => tag(l, { kind: 'chip', on: kindSel === k, attrs: `data-lk="${k}"` })).join('')}</div>`;

// Lịch rows for gatherings (a .gior row, so the search box and the chips filter it).
export const gatheringRow = (p, hf, today, hidden = false) => {
  const d = dayMs(p.starts_at); const left = Math.round((d - today) / 864e5);
  const when = left === 0 ? 'Hôm nay' : left === 1 ? 'Ngày mai' : `Còn ${left} ngày`;
  return `<div class="gior" data-k="gath"${hidden ? ' hidden' : ''} data-q="${esc((p.title + ' ' + (p.place || '') + ' họp mặt').toLowerCase())}"><a class="li gio" href="${esc(hf('tin/' + p.id))}">`
    + `<span class="date"><b>${new Date(d).getDate()}/${new Date(d).getMonth() + 1}</b><span>DL</span></span>`
    + `<span class="grow"><b>${esc(p.title)}</b> ${tag(`Họp mặt`, { sm: true })}`
    + `<span class="sub">${[p.lunar ? p.lunar + ' ÂL' : '', p.time, p.place].filter(Boolean).map(esc).join(' · ')} · ${when}</span></span></a></div>`;
};

// The top of Lịch: pinned or unread live posts (at most 2), and the link to the feed. Always the link.
export function topCardsHtml(fam, hf, getPrefs) {
  const c = cache.get(fam);
  const top = c ? topNews(c.posts.filter((p) => p.status === 'live'), seenAt(fam, getPrefs)) : [];
  const cards = top.map((p) => card(`<div class="sub">${p.pinned ? 'Ghim' : 'Mới'} · ${kindLabel(p)} · ${esc(p.created_by)}</div>`
    + `<h2><a class="plink" href="${esc(hf('tin/' + p.id))}">${esc(p.title)}</a></h2>`, { cls: p.pinned ? 'hl' : '' })).join('');
  return `<div class="row wrap" style="justify-content:space-between;align-items:center"><b>Tin họ</b><a href="${esc(hf('tin'))}">Xem tất cả tin →</a></div>${cards}`;
}

// Settings card (Cài đặt dòng họ): who may post. Only the owner changes it.
export function postersCard(isOwner) {
  const opt = (v, l, h) => `<label class="vr-opt"><input type="radio" name="ptrule" value="${v}"${isOwner ? '' : ' disabled'}><span><b>${l}</b><span class="sub">${h}</span></span></label>`;
  return section('Tin họ', `
    <fieldset class="vrule"><legend>Ai được đăng tin</legend>
      ${opt('admin', 'Chủ họ và Quản trị', 'Mặc định. Biên tập viên và thành viên góp ý qua Góp ý.')}
      ${opt('editor', 'Thêm Biên tập viên', 'Biên tập viên cũng đăng được tin.')}</fieldset>
    <p class="sub">Tin có liên kết, số điện thoại, số tài khoản hoặc từ không phù hợp chờ chủ họ hoặc quản trị duyệt. Mọi thay đổi ghi vào lịch sử.</p>
    ${isOwner ? '' : '<p class="sub">Chỉ Chủ họ đổi được.</p>'}`, { variant: 'card', attrs: 'id="ptrule"' });
}
// Cài đặt dòng họ hook: binds the posting radios (called from council.js decorate for the settings page).
export async function decorateSettings(main, fam) {
  if (!main.querySelector('#ptrule')) return;
  let posters = 'admin';
  try { posters = (await loadPosts(fam)).posters; } catch {}
  main.querySelectorAll('input[name="ptrule"]').forEach((r) => {
    r.checked = r.value === posters;
    if (r.disabled || r.dataset.bound) return;
    r.dataset.bound = '1';
    r.addEventListener('change', async () => {
      try { await api('POST', `/api/news-setting?${q(fam)}`, { posters: r.value }); bust(fam); toast('Đã lưu cài đặt Tin họ.'); }
      catch (e) { toast(e.message); }
    });
  });
}

// ---- Tin họ feed ----
export async function feedPage(main, { fam, hf, getPrefs, setPrefs, isMember }) {
  if (!isMember) { main.innerHTML = '<h1>Tin họ</h1><p class="sub">Chỉ thành viên trong dòng họ mới xem được tin.</p>'; return; }
  main.innerHTML = '<h1>Tin họ</h1><p class="sub">Đang tải…</p>';
  let c;
  try { c = await loadPosts(fam); } catch (e) { main.innerHTML = `<h1>Tin họ</h1><p class="err">${esc(e.message)}</p>`; return; }
  const seen = seenAt(fam, getPrefs);
  const st = feedPage.st || (feedPage.st = { q: '' });
  const review = c.is_admin ? c.posts.filter((p) => p.status === 'held' || p.status === 'hidden') : [];
  const reviewHtml = review.length ? `${card(`<h2>Cần xem (${review.length})</h2>${review.map((p) => {
    const why = p.status === 'held' ? `Chờ duyệt: ${(p.hold || []).map((h) => HOLD_VI[h] || h).join(', ') || 'cần xem'}.` : `Bị ẩn sau ${p.reports} báo cáo. Lý do báo cáo không hiện tên người báo.`;
    const acts = p.status === 'held'
      ? `<button type="button" class="btn sm" data-approve="${p.id}">Duyệt đăng</button>${dangerButton('Từ chối', `data-reject="${p.id}"`, { size: 'sm' })}`
      : `<button type="button" class="btn sm" data-restore="${p.id}">Khôi phục</button>${dangerButton('Xóa', `data-rdel="${p.id}"`, { size: 'sm' })}`;
    return `<div class="li-stack"><b>${esc(p.title)}</b> <span class="sub">${esc(p.created_by)} · ${why}</span><div class="row wrap">${acts}</div></div>`;
  }).join('')}`, { cls: 'hl', attrs: `id="nreview"` })}` : '';
  const rows = c.posts.map((p) => {
    const unread = p.status === 'live' && Date.parse(p.created_at) > seen;
    const date = p.kind === 'gathering' ? fmtDay(p.starts_at) : new Date(p.created_at).toLocaleDateString('vi-VN');
    return `<a class="li" href="${esc(hf('tin/' + p.id))}" data-q="${esc((p.title + ' ' + p.body).toLowerCase())}"><span class="grow"><b>${esc(p.title)}</b>`
      + ` ${tag(`${kindLabel(p)}`, { sm: true })}${badges(p)}${unread ? ' <span class="tag sm yellow">Mới</span>' : ''}`
      + `<span class="sub">${esc(p.created_by)} · ${esc(date)}</span></span>›</a>`;
  }).join('');
  main.innerHTML = `<h1>Tin họ</h1>${reviewHtml}
    ${toolbar({ id: 'nq', ph: 'Tìm tiêu đề hoặc nội dung', val: st.q, active: 0, add: c.can_post ? addBtn(`data-tin-go="${esc(hf('tin-sua'))}"`, 'Đăng tin mới') : '' })}
    ${card(`${rows || '<p class="sub pad">Chưa có tin nào.</p>'}`, { attrs: `id="nlist"` })}`;
  if (setPrefs) setPrefs({ [SEEN_KEY]: { ...((getPrefs?.() || {})[SEEN_KEY] || {}), [fam]: Date.now() } }); // seen once the feed is open
  main.querySelector('#nq')?.addEventListener('input', (e) => {
    const s = e.target.value.trim().toLowerCase(); st.q = e.target.value;
    for (const r of main.querySelectorAll('#nlist [data-q]')) r.hidden = !!s && !r.dataset.q.includes(s);
  });
  const act = async (fn, msg) => { try { await fn(); bust(fam); toast(msg); feedPage(onScreen(main), { fam, hf, getPrefs, setPrefs, isMember }); } catch (e) { toast(e.message); } };
  main.querySelectorAll('[data-approve]').forEach((b) => { b.onclick = () => act(() => api('POST', `/api/posts/${b.dataset.approve}/approve?${q(fam)}`), 'Đã duyệt. Thành viên sẽ được báo.'); });
  main.querySelectorAll('[data-restore]').forEach((b) => { b.onclick = () => act(() => api('POST', `/api/posts/${b.dataset.restore}/restore?${q(fam)}`), 'Đã khôi phục tin.'); });
  main.querySelectorAll('[data-reject]').forEach((b) => { b.onclick = () => confirmDanger({ title: dangerLabel('Từ chối tin này?'), lose: 'Tin chờ duyệt này sẽ không được đăng.', restore: '',
    confirm: dangerLabel('Từ chối'), onConfirm: () => act(() => api('POST', `/api/posts/${b.dataset.reject}/reject?${q(fam)}`), 'Đã từ chối tin.') }); });
  main.querySelectorAll('[data-rdel]').forEach((b) => { b.onclick = () => confirmDanger({ title: dangerLabel('Xóa tin bị ẩn?'), lose: 'Tin này sẽ không còn hiện với mọi người.', restore: '',
    confirm: dangerLabel('Xóa tin'), onConfirm: () => act(() => api('POST', `/api/posts/${b.dataset.rdel}/delete?${q(fam)}`), 'Đã xóa tin.') }); });
}

// ---- personal calendar feed (server/news-cal.js). The link is kept on this device only (localStorage, try/catch);
// the server keeps just a hash of the token. One block serves the Lịch card and the RSVP prompt.
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
const webcal = (u) => u.replace(/^https:/, 'webcal:');
const gcal = (u) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal(u))}`;
const linkKey = (fam) => `calurl:${fam}`;
const offKey = (fam) => `calprompt-off:${fam}`;
const calState = (fam) => api('GET', `/api/cal-token?${q(fam)}`).catch(() => ({ exists: false, subscribed: false }));
function calBody(fam, st, prompt) {
  const u = LS.get(linkKey(fam));
  const note = '<p class="sub">Lịch tự cập nhật (Google có thể chậm vài giờ). Link này riêng của bạn, đừng chia sẻ.</p>';
  if (!u && prompt) return `<div class="row wrap"><button type="button" class="btn" data-cal-new>Google Calendar</button><button type="button" class="btn ter" data-cal-new>Apple / iPhone</button></div><p class="sub">Bấm để tạo link riêng của bạn. Sau đó bấm lại để thêm vào lịch.</p>`;
  if (!u) return `<p class="sub">${st.exists ? 'Link đã tạo trên thiết bị khác. Tạo link mới để dùng trên máy này.' : 'Tạo link để lịch tự cập nhật.'}</p><div class="row"><button type="button" class="btn sm" data-cal-new>Tạo link mới</button></div>`;
  return `<div class="row wrap"><a class="btn" href="${esc(gcal(u))}" target="_blank" rel="noopener">Google Calendar</a><a class="btn ter" href="${esc(webcal(u))}">Apple / iPhone</a><button type="button" class="btn ter sm" data-cal-copy>Sao chép link</button></div>${note}<div class="row"><button type="button" class="btn ter sm" data-cal-new>Tạo link mới</button></div>`;
}
function wireCal(box, { fam, exists, follows, redraw }) {
  box.querySelector('[data-cal-copy]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(LS.get(linkKey(fam)) || ''); toast('Đã sao chép link.'); } catch { toast('Không sao chép được. Hãy chọn link và sao chép.'); }
  });
  const make = async () => {
    try { const r = await api('POST', `/api/cal-token?${q(fam)}`, { follows: follows || [] }); LS.set(linkKey(fam), r.url); redraw(); }
    catch (e) { toast(e.message); }
  };
  box.querySelectorAll('[data-cal-new]').forEach((b) => b.addEventListener('click', () => (exists
    ? confirmDanger({ title: dangerLabel('Tạo link mới?'), lose: 'Link cũ sẽ ngừng hoạt động. Lịch đã thêm bằng link cũ sẽ không còn tự cập nhật.', restore: '',
      confirm: dangerLabel('Tạo link mới'), onConfirm: make })
    : make())));
  box.querySelector('[data-cal-off]')?.addEventListener('click', () => { LS.set(offKey(fam), '1'); box.remove(); });
}
// Lịch card: the link, or the one-time setup. Keeps the server's follow list in step with this device's ☆ list.
export async function fillCalCard(main, fam, follows) {
  const box = main.querySelector('#calcard'); if (!box) return;
  const st = await calState(fam);
  if (st.exists) api('PUT', `/api/cal-token/follows?${q(fam)}`, { follows: follows || [] }).catch(() => {});
  const redraw = () => fillCalCard(main, fam, follows);
  box.innerHTML = `${card(`<b>Tự động thêm vào lịch điện thoại</b>${st.subscribed ? '<p class="sub">Đã thêm vào lịch của bạn (có thể chậm vài giờ).</p>' : ''}${calBody(fam, st)}`)}`;
  wireCal(box, { fam, exists: st.exists, follows, redraw });
}
// RSVP prompt: after a Đi or Chưa biết answer, while no feed fetch is recorded for this account. "Để sau" hides it on this device.
async function showCalPrompt(main, fam, follows) {
  const slot = main.querySelector('#calprompt'); if (!slot || LS.get(offKey(fam))) return;
  const st = await calState(fam);
  if (!slot.isConnected) return;
  if (st.subscribed) { slot.innerHTML = '<p class="sub">Đã thêm vào lịch của bạn (có thể chậm vài giờ).</p>'; return; }
  const redraw = () => showCalPrompt(main, fam, follows);
  slot.innerHTML = `${card(`<b>Tự động thêm vào lịch điện thoại?</b>${calBody(fam, st, true)}<div class="row"><button type="button" class="btn ter sm" data-cal-off>Để sau</button></div>`, { cls: 'cal-prompt' })}`;
  wireCal(slot, { fam, exists: st.exists, follows, redraw });
}

// ---- detail: a notice, or a gathering (header, one action row, RSVP card, who is going) ----
export async function detailPage(main, { fam, hf, id, getPrefs, setPrefs, isMember }) {
  if (!isMember) { main.innerHTML = '<h1>Tin họ</h1><p class="sub">Chỉ thành viên trong dòng họ mới xem được tin.</p>'; return; }
  const j = await api('GET', `/api/posts/${encodeURIComponent(id)}?${q(fam)}`).catch((e) => ({ error: e.message }));
  if (j.error || !j.post) { main.innerHTML = `<h1>Tin họ</h1><p class="err">${esc(j.error || 'Không tìm thấy tin này.')}</p>`; return; }
  const p = j.post; const admin = !!j.is_admin; const mineAuthor = !!p.mine_author;
  const g = p.kind === 'gathering'; const live = p.status === 'live';
  const rs = p.rsvp || {}; const att = j.attendees || { yes: [], maybe: [], no: [] };
  const mine = rs.mine;
  const mapHref = g ? (p.map_url || (p.place ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.place) : '')) : '';

  // header: eyebrow, title, three icon rows
  const when = g ? [fmtDay(p.starts_at), p.time].filter(Boolean).join(' · ') + (p.lunar ? ` · ${esc(p.lunar)} âm lịch` : '') : new Date(p.created_at).toLocaleDateString('vi-VN');
  const place = g && p.place ? (mapHref ? `<a href="${esc(mapHref)}" target="_blank" rel="noopener">${esc(p.place)}</a>` : esc(p.place)) : '';
  const infoRows = g ? `<ul class="gd-info">
      <li>${ico('calendar')}<span>${esc(when)}</span></li>
      ${place ? `<li>${ico('pin')}<span>${place}</span></li>` : ''}
      <li>${ico('person')}<span>${p.organiser ? esc(p.organiser) + ' tổ chức' : 'Người đăng: ' + esc(p.created_by)}</span></li>
    </ul>` : `<p class="sub">Đăng bởi ${esc(p.created_by)} · ${esc(when)}</p>`;
  const badgeLine = p.status !== 'live' || p.pinned ? `<p class="sub">${p.pinned ? '<span class="tag sm">Ghim</span> ' : ''}${p.status === 'held' ? '<span class="tag sm yellow">Chờ duyệt</span>' : ''}${p.status === 'hidden' ? '<span class="tag sm yellow">Bị ẩn</span>' : ''}</p>` : '';
  const held = p.status === 'held' ? `<div class="ntc warn" role="note"><b>Chờ duyệt</b><span class="sub">${admin || mineAuthor ? 'Chỉ chủ họ và quản trị thấy tin này cho đến khi được duyệt. ' + ((p.hold || []).map((h) => HOLD_VI[h] || h).join(', ')) : 'Tin đang chờ duyệt.'}</span></div>` : '';
  const hidden = p.status === 'hidden' ? `<div class="ntc warn" role="note"><b>Tin bị ẩn sau báo cáo</b><span class="sub">Chủ họ và quản trị sẽ xem lại tin này.</span></div>` : '';
  const more = (!mineAuthor && live) || mineAuthor || admin ? `<details class="gd-more"><summary aria-label="Thêm">${ico('dots', 'ic')}</summary><div class="gd-menu">
      ${!mineAuthor && live ? '<button type="button" class="btn ter sm" id="rep">Báo cáo tin này</button>' : ''}
      ${mineAuthor || admin ? `<a class="btn ter sm" href="${esc(hf('tin-sua/' + p.id))}">Sửa tin</a>` : ''}</div></details>` : '';

  // one action row
  const actions = g && live ? `<div class="gd-act"><button type="button" class="btn ter" id="gics">${ico('calendar')}<span>Thêm vào lịch</span></button></div>` : '';

  // RSVP card: three equal choices (the poster starts as Đi)
  const rsvp = g && live ? `<section class="gd-card"><h2 class="gd-h">Bạn có đi không?</h2>
      ${choiceRow({ label: 'Trả lời', items: [
        { word: 'Đi', icon: 'check', tone: 'yes', on: mine === 'yes', attrs: 'data-rsvp="yes"' },
        { word: 'Không đi', icon: 'x', tone: 'no', on: mine === 'no', attrs: 'data-rsvp="no"' },
        { word: 'Chưa biết', icon: 'help', tone: 'abs', on: mine === 'maybe', attrs: 'data-rsvp="maybe"' }] })}
      ${mine === 'yes' || mine === 'maybe' ? '<div id="calprompt"></div>' : ''}
    </section>` : '';

  // who is going: the summary with colored icons, then the groups (shared person rows), empty groups hidden
  const tally = `<p class="gd-tally"><span class="t-yes">${ico('check')}${att.yes.length} đi</span><span class="gd-sep" aria-hidden="true">·</span><span class="t-maybe">${ico('help')}${att.maybe.length} chưa biết</span><span class="gd-sep" aria-hidden="true">·</span><span class="t-no">${ico('x')}${att.no.length} không đi</span></p>`;
  const groups = collapsedGroups([
    { key: 'yes', title: 'Đi', icn: 'check', color: 'y', items: att.yes, sub: () => 'đi' },
    { key: 'maybe', title: 'Chưa biết', icn: 'help', color: 'a', items: att.maybe, sub: () => 'chưa biết' },
    { key: 'no', title: 'Không đi', icn: 'x', color: 'n', items: att.no, sub: () => 'không đi' }], { icon: ico });
  const who = g && live ? `<section class="gd-card" id="attendees"><h2 class="gd-h">Ai đi</h2>${tally}${groups}
      ${!att.yes.length && !att.maybe.length && !att.no.length ? '<p class="sub">Chưa ai trả lời.</p>' : ''}</section>` : '';

  const body = p.body ? `<div class="gd-body">${paras(p.body)}</div>` : '';
  const ownerActs = (mineAuthor || admin) ? dangerZone(dangerButton('Xóa tin này', 'id="tdel"'), { note: 'Tin sẽ không còn hiện với mọi người.' }) : '';
  main.innerHTML = `<header class="gd-head"><div class="gd-top">${g ? '<p class="gd-eye">Họp mặt</p>' : '<p class="gd-eye">Thông báo</p>'}${more}</div>
      <h1 class="keep gd-h1">${esc(p.title)}</h1>${badgeLine}${infoRows}</header>
    ${held}${hidden}${body}${actions}${rsvp}${who}${ownerActs}`;

  // RSVP: one answer per account (a second answer replaces the first)
  const answer = async (answerKey) => {
    try { await api('POST', `/api/posts/${encodeURIComponent(id)}/rsvp?${q(fam)}`, { answer: answerKey }); bust(fam); detailPage(onScreen(main), { fam, hf, id, getPrefs, setPrefs, isMember }); }
    catch (e) { toast(e.message); }
  };
  main.querySelectorAll('[data-rsvp]').forEach((b) => { b.onclick = () => answer(b.dataset.rsvp); });
  if (mine === 'yes' || mine === 'maybe') showCalPrompt(main, fam, getPrefs().follows || []);
  main.querySelector('#gics')?.addEventListener('click', () => {
    const day = new Date(dayMs(p.starts_at)); const stamp = icsDay(new Date());
    const ev = `BEGIN:VEVENT\r\nUID:post-${p.id}@${location.host}\r\nDTSTAMP:${stamp}T000000Z\r\nDTSTART;VALUE=DATE:${icsDay(day)}\r\nSUMMARY:${icsText('Họp mặt: ' + p.title)}\r\nLOCATION:${icsText(p.place || '')}\r\nDESCRIPTION:${icsText(location.origin + '/#/' + fam + '/tin/' + p.id)}\r\nEND:VEVENT`;
    saveIcs('hop-mat.ics', icsCalendar(ev));
  });
  main.querySelector('#rep')?.addEventListener('click', () => reportSheet(async (reason) => {
    const r = await api('POST', `/api/posts/${encodeURIComponent(id)}/report?${q(fam)}`, { reason }); bust(fam);
    toast(r.hidden ? 'Cảm ơn bạn. Tin đã được ẩn để chủ họ xem lại.' : 'Cảm ơn bạn. Chủ họ sẽ xem tin này.');
  }));
  main.querySelector('#tdel')?.addEventListener('click', () => confirmDanger({ title: dangerLabel('Xóa tin này?'), lose: 'Tin này sẽ không còn hiện với mọi người.', restore: '',
    confirm: dangerLabel('Xóa tin'), onConfirm: async () => { await api('POST', `/api/posts/${encodeURIComponent(id)}/delete?${q(fam)}`); bust(fam); toast('Đã xóa tin.'); location.hash = hf('tin'); } }));
}

// The report sheet: a small dialog with one reason field (required). Reporters are not shown to the author.
function reportSheet(onSend) {
  document.querySelectorAll('dialog.rep-sheet').forEach((x) => x.remove());
  const d = document.createElement('dialog'); d.className = 'dlg rep-sheet'; d.setAttribute('aria-labelledby', 'rep-h');
  d.innerHTML = `<form method="dialog" class="rep-form"><h2 id="rep-h" tabindex="-1">Báo cáo tin này</h2>
    <label class="fld">Lý do<textarea name="reason" rows="3" maxlength="300" required placeholder="Ví dụ: quảng cáo, nội dung không đúng"></textarea></label>
    <p class="sub">Tin bị báo cáo hai lần sẽ được ẩn để chủ họ xem lại.</p>
    <div class="row end"><button type="button" class="btn ter" data-rep-cancel>Hủy</button><button type="submit" class="btn">Gửi báo cáo</button></div></form>`;
  document.body.append(d); d.showModal();
  d.querySelector('[data-rep-cancel]').onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  d.querySelector('form').onsubmit = (e) => { e.preventDefault(); const reason = d.querySelector('textarea').value.trim(); d.close(); onSend(reason).catch((er) => toast(er.message)); };
}

// ---- editor: a page with Hủy · Lưu at the end ----
export async function editorPage(main, { fam, hf, id = '', kind = 'notice' }) {
  let c;
  try { c = await loadPosts(fam); } catch (e) { main.innerHTML = `<h1>Tin họ</h1><p class="err">${esc(e.message)}</p>`; return; }
  if (!c.can_post) { main.innerHTML = '<h1>Tin họ</h1><p class="sub">Chỉ chủ họ và quản trị được đăng tin. Bạn có thể góp ý để được đăng.</p>'; return; }
  let p = id ? c.posts.find((x) => String(x.id) === String(id)) || null : null;
  if (id && !p) { const j = await api('GET', `/api/posts/${encodeURIComponent(id)}?${q(fam)}`).catch(() => null); p = j?.post || null; }
  const k = p ? p.kind : kind;
  const v = (x) => esc(p?.[x] ?? '');
  main.innerHTML = `<h1>${id ? 'Sửa tin' : 'Tin mới'}</h1>
    <form id="tinf" class="fgrid">
      <fieldset class="fset"><legend>Loại tin</legend>
        <label class="radio"><input type="radio" name="kind" value="notice" ${k === 'notice' ? 'checked' : ''}> Thông báo</label>
        <p class="sub">Tin chung cho cả họ, không có ngày.</p>
        <label class="radio"><input type="radio" name="kind" value="gathering" ${k === 'gathering' ? 'checked' : ''}> Họp mặt</label>
        <p class="sub">Có ngày, giờ, địa điểm. Mọi người trả lời Đi, Không đi hoặc Chưa biết và được nhắc trước 3 ngày và 1 ngày.</p>
      </fieldset>
      <p class="sub wide">Tin có liên kết, số điện thoại, dãy số giống số tài khoản hoặc từ không phù hợp sẽ chờ chủ họ duyệt trước khi được đăng.</p>
      <label class="fld wide">Tiêu đề<input name="title" required maxlength="200" value="${v('title')}"></label>
      <label class="fld wide">Nội dung<textarea name="body" rows="6" maxlength="5000">${v('body')}</textarea></label>
      <fieldset class="fset wide" id="gfields"><legend>Chi tiết họp mặt</legend>
        <label class="fld">Ngày họp mặt<input type="date" name="starts_at" value="${v('starts_at')}"></label>
        <label class="fld">Giờ<input name="time" maxlength="20" placeholder="Ví dụ 11:00" value="${v('time')}"></label>
        <label class="fld">Ngày âm lịch (nếu có)<input name="lunar" maxlength="60" placeholder="Ví dụ 15/8" value="${v('lunar')}"></label>
        <label class="fld">Địa điểm<input name="place" maxlength="200" value="${v('place')}"></label>
        <label class="fld">Liên kết bản đồ<input name="map_url" maxlength="500" placeholder="https://" value="${v('map_url')}"></label>
        <label class="fld">Người tổ chức<input name="organiser" maxlength="100" value="${v('organiser')}"></label>
      </fieldset>
      <label class="radio wide"><input type="checkbox" name="pinned" ${p?.pinned ? 'checked' : ''}> Ghim lên đầu Tin họ</label>
      <div class="row end wide"><button type="button" class="btn ter" id="tcancel">Hủy</button><button type="submit" class="btn">Lưu</button></div>
      <p class="err" id="terr" role="alert"></p>
    </form>
    ${id ? dangerZone(dangerButton('Xóa tin này', 'id="tdel"'), { note: 'Tin sẽ không còn hiện với mọi người.' }) : ''}`;
  const sync = () => { main.querySelector('#gfields').hidden = main.querySelector('[name=kind]:checked').value !== 'gathering'; };
  // Unsent draft (this device only, try/catch): a background refresh that redraws the page keeps what was typed.
  const draftKey = `tin-draft:${fam}:${id || 'new'}`;
  const form = main.querySelector('#tinf');
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (saved) form.querySelectorAll('[name]').forEach((el) => {
      if (el.type === 'radio') el.checked = saved[el.name] === el.value;
      else if (el.type === 'checkbox') el.checked = saved[el.name] === el.value;
      else if (saved[el.name] !== undefined) el.value = saved[el.name];
    });
  } catch { /* no draft */ }
  const saveDraft = () => { try { localStorage.setItem(draftKey, JSON.stringify(Object.fromEntries(new FormData(form).entries()))); } catch { /* private mode */ } };
  form.addEventListener('input', saveDraft); form.addEventListener('change', saveDraft);
  main.querySelectorAll('[name=kind]').forEach((r) => r.addEventListener('change', sync)); sync();
  main.querySelector('#tcancel').onclick = () => { location.hash = p ? hf('tin/' + p.id) : hf('tin'); };
  main.querySelector('#tinf').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const body = { kind: f.get('kind'), title: f.get('title'), body: f.get('body'), pinned: f.get('pinned') === 'on', starts_at: f.get('starts_at') || '',
      time: f.get('time'), lunar: f.get('lunar'), place: f.get('place'), map_url: f.get('map_url'), organiser: f.get('organiser') };
    try {
      const j = p ? await api('POST', `/api/posts/${encodeURIComponent(id)}/update?${q(fam)}`, body) : await api('POST', `/api/posts?${q(fam)}`, body);
      bust(fam);
      try { localStorage.removeItem(draftKey); } catch { /* none */ }
      toast(j.status === 'held' || j.held ? 'Đã gửi. Tin chờ chủ họ hoặc quản trị duyệt.' : 'Đã lưu.');
      location.hash = hf('tin/' + (j.id || id));
    } catch (er) { main.querySelector('#terr').textContent = er.message; }
  };
  main.querySelector('#tdel')?.addEventListener('click', () => confirmDanger({ title: dangerLabel('Xóa tin này?'), lose: 'Tin này sẽ không còn hiện với mọi người.', restore: '',
    confirm: dangerLabel('Xóa tin'), onConfirm: async () => { await api('POST', `/api/posts/${encodeURIComponent(id)}/delete?${q(fam)}`); bust(fam); toast('Đã xóa tin.'); location.hash = hf('tin'); } }));
}

// Delegated: the "+" of the shared toolbar, the Lịch chips (they filter the rows in place, like the search box).
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-tin-go]'); if (go) { e.preventDefault(); location.hash = go.dataset.tinGo; return; }
  const lk = e.target.closest('[data-lk]'); if (!lk) return;
  kindSel = lk.dataset.lk;
  for (const b of document.querySelectorAll('[data-lk]')) { b.classList.toggle('on', b === lk); b.setAttribute('aria-pressed', String(b === lk)); }
  document.getElementById('gq')?.dispatchEvent(new Event('input', { bubbles: true }));
});
