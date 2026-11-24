// Shared UI components for giapha (list toolbar, filter sheet, tag chips, icon map).
// Plain ES module, no build step. Imported by app.js.
import { esc } from './model.js';
import { SURNAME_HAN } from './surnames-vi.js';
import { famCrest } from './emblem.js';

export const CI = {"check": `<path d="M13 24 4 15 5.414 13.586 13 21.171 26.586 7.586 28 9 13 24z"/>`, "plus": `<path d="M17 15V8h-2v7H8v2h7v7h2v-7h7v-2h-7z"/>`, "filter": `<path d="M18,28H14a2,2,0,0,1-2-2V18.41L4.59,11A2,2,0,0,1,4,9.59V6A2,2,0,0,1,6,4H26a2,2,0,0,1,2,2V9.59A2,2,0,0,1,27.41,11L20,18.41V26A2,2,0,0,1,18,28ZM6,6V9.59l8,8V26h4V17.59l8-8V6Z"/>`, "sun": `<path d="M15 2H17V7H15z"/><path d="M21.668 6.854H26.625999999999998V8.854H21.668z" transform="rotate(-45 24.147 7.853)"/><path d="M25 15H30V17H25z"/><path d="M23.147 21.668H25.147V26.625999999999998H23.147z" transform="rotate(-45 24.147 24.146)"/><path d="M15 25H17V30H15z"/><path d="M5.375 23.147H10.333V25.147H5.375z" transform="rotate(-45 7.853 24.146)"/><path d="M2 15H7V17H2z"/><path d="M6.854 5.375H8.854V10.333H6.854z" transform="rotate(-45 7.854 7.853)"/><path d="M16,12a4,4,0,1,1-4,4,4.0045,4.0045,0,0,1,4-4m0-2a6,6,0,1,0,6,6,6,6,0,0,0-6-6Z"/>`, "moon": `<path d="M13.5025,5.4136A15.0755,15.0755,0,0,0,25.096,23.6082a11.1134,11.1134,0,0,1-7.9749,3.3893c-.1385,0-.2782.0051-.4178,0A11.0944,11.0944,0,0,1,13.5025,5.4136M14.98,3a1.0024,1.0024,0,0,0-.1746.0156A13.0959,13.0959,0,0,0,16.63,28.9973c.1641.006.3282,0,.4909,0a13.0724,13.0724,0,0,0,10.702-5.5556,1.0094,1.0094,0,0,0-.7833-1.5644A13.08,13.08,0,0,1,15.8892,4.38,1.0149,1.0149,0,0,0,14.98,3Z"/>`, "gear": `<path fill-rule="evenodd" d="M26.01 13.18 L29.42 14.52 L29.42 17.48 L26.01 18.82 L25.07 21.08 L26.54 24.44 L24.44 26.54 L21.08 25.07 L18.82 26.01 L17.48 29.42 L14.52 29.42 L13.18 26.01 L10.92 25.07 L7.56 26.54 L5.46 24.44 L6.93 21.08 L5.99 18.82 L2.58 17.48 L2.58 14.52 L5.99 13.18 L6.93 10.92 L5.46 7.56 L7.56 5.46 L10.92 6.93 L13.18 5.99 L14.52 2.58 L17.48 2.58 L18.82 5.99 L21.08 6.93 L24.44 5.46 L26.54 7.56 L25.07 10.92 Z M11.80 16.00 a4.20 4.20 0 1 0 8.40 0 a4.20 4.20 0 1 0 -8.40 0 Z"/>`, "more": `<circle cx="8" cy="16" r="2"/><circle cx="16" cy="16" r="2"/><circle cx="24" cy="16" r="2"/>`, "switcher": "<path d=\"M14 4H18V8H14z\"/><path d=\"M4 4H8V8H4z\"/><path d=\"M24 4H28V8H24z\"/><path d=\"M14 14H18V18H14z\"/><path d=\"M4 14H8V18H4z\"/><path d=\"M24 14H28V18H24z\"/><path d=\"M14 24H18V28H14z\"/><path d=\"M4 24H8V28H4z\"/><path d=\"M24 24H28V28H24z\"/>", "tree": "<path d=\"M30,20V12H22v3H17V7a2,2,0,0,0-2-2H10V2H2v8h8V7h5V25a2,2,0,0,0,2,2h5v3h8V22H22v3H17V17h5v3ZM8,8H4V4H8ZM24,24h4v4H24Zm0-10h4v4H24Z\"/>", "search": "<path d=\"M29,27.5859l-7.5521-7.5521a11.0177,11.0177,0,1,0-1.4141,1.4141L27.5859,29ZM4,13a9,9,0,1,1,9,9A9.01,9.01,0,0,1,4,13Z\"/>", "book": "<path d=\"M19 10H26V12H19z\"/><path d=\"M19 15H26V17H19z\"/><path d=\"M19 20H26V22H19z\"/><path d=\"M6 10H13V12H6z\"/><path d=\"M6 15H13V17H6z\"/><path d=\"M6 20H13V22H6z\"/><path d=\"M28,5H4A2.002,2.002,0,0,0,2,7V25a2.002,2.002,0,0,0,2,2H28a2.002,2.002,0,0,0,2-2V7A2.002,2.002,0,0,0,28,5ZM4,7H15V25H4ZM17,25V7H28V25Z\"/>", "map": "<path d=\"M16,24l-6.09-8.6A8.14,8.14,0,0,1,16,2a8.08,8.08,0,0,1,8,8.13,8.2,8.2,0,0,1-1.8,5.13ZM16,4a6.07,6.07,0,0,0-6,6.13,6.19,6.19,0,0,0,1.49,4L16,20.52,20.63,14A6.24,6.24,0,0,0,22,10.13,6.07,6.07,0,0,0,16,4Z\"/><circle cx=\"16\" cy=\"9\" r=\"2\"/><path d=\"M28,12H26v2h2V28H4V14H6V12H4a2,2,0,0,0-2,2V28a2,2,0,0,0,2,2H28a2,2,0,0,0,2-2V14A2,2,0,0,0,28,12Z\"/>", "gio": "<path d=\"M26,4h-4V2h-2v2h-8V2h-2v2H6C4.9,4,4,4.9,4,6v20c0,1.1,0.9,2,2,2h20c1.1,0,2-0.9,2-2V6C28,4.9,27.1,4,26,4z M26,26H6V12h20 V26z M26,10H6V6h4v2h2V6h8v2h2V6h4V10z\"/>", "chart": "<path d=\"M4,2H2V28a2,2,0,0,0,2,2H30V28H4V25H26V17H4V13H18V5H4ZM24,19v4H4V19ZM16,7v4H4V7Z\"/>", "flag": "<path d=\"M6,30H4V2H28l-5.8,9L28,20H6ZM6,18H24.33L19.8,11l4.53-7H6Z\"/>", "dl": "<path d=\"M26,24v4H6V24H4v4H4a2,2,0,0,0,2,2H26a2,2,0,0,0,2-2h0V24Z\"/><path d=\"M26 14 24.59 12.59 17 20.17 17 2 15 2 15 20.17 7.41 12.59 6 14 16 24 26 14z\"/>", "chevL": "<path d=\"M10 16 20 6 21.4 7.4 12.8 16 21.4 24.6 20 26z\"/>", "chevR": "<path d=\"M22 16 12 26 10.6 24.6 19.2 16 10.6 7.4 12 6z\"/>", "close": "<path d=\"M17.4141 16 24 9.4141 22.5859 8 16 14.5859 9.4143 8 8 9.4141 14.5859 16 8 22.5859 9.4143 24 16 17.4141 22.5859 24 24 22.5859 17.4141 16z\"/>", "user": "<path d=\"M16,4a5,5,0,1,1-5,5,5,5,0,0,1,5-5m0-2a7,7,0,1,0,7,7A7,7,0,0,0,16,2Z\"/><path d=\"M26,30H24V25a5,5,0,0,0-5-5H13a5,5,0,0,0-5,5v5H6V25a7,7,0,0,1,7-7h6a7,7,0,0,1,7,7Z\"/>", "pencil": "<path d=\"M2 26H30V28H2z\"/><path d=\"M25.4,9c0.8-0.8,0.8-2,0-2.8c0,0,0,0,0,0l-3.6-3.6c-0.8-0.8-2-0.8-2.8,0c0,0,0,0,0,0l-15,15V24h6.4L25.4,9z M20.4,4L24,7.6 l-3,3L17.4,7L20.4,4z M6,22v-3.6l10-10l3.6,3.6l-10,10H6z\"/>", "share": `<path d="M23,20a5,5,0,0,0-3.89,1.89L11.8,17.32a4.46,4.46,0,0,0,0-2.64l7.31-4.57A5,5,0,1,0,18,7a4.79,4.79,0,0,0,.2,1.32l-7.31,4.57a5,5,0,1,0,0,6.22l7.31,4.57A4.79,4.79,0,0,0,18,25a5,5,0,1,0,5-5ZM23,4a3,3,0,1,1-3,3A3,3,0,0,1,23,4ZM7,19a3,3,0,1,1,3-3A3,3,0,0,1,7,19Zm16,9a3,3,0,1,1,3-3A3,3,0,0,1,23,28Z"/>`, "sheet": "<path d=\"M8 18H12V20H8z\"/><path d=\"M14 18H18V20H14z\"/><path d=\"M8 14H12V16H8z\"/><path d=\"M14 22H18V24H14z\"/><path d=\"M20 14H24V16H20z\"/><path d=\"M20 22H24V24H20z\"/><path d=\"M27,3H5A2.0025,2.0025,0,0,0,3,5V27a2.0025,2.0025,0,0,0,2,2H27a2.0025,2.0025,0,0,0,2-2V5A2.0025,2.0025,0,0,0,27,3Zm0,2,0,4H5V5ZM5,27V11H27l0,16Z\"/>"};
// Layout breakpoints (match app.css): side menu and desktop tree from 672 / 1024 px. Markup is rendered for the
// layout in use, never rendered and hidden.
export const isWide = () => matchMedia('(min-width:672px)').matches;
export const isDesk = () => matchMedia('(min-width:1024px)').matches;
// Short family name: "Họ Dương" -> "Dương".
export const famShort = (name) => String(name).replace(/^Họ\s+/, '');
// Family chip for rows in "Tất cả": a 20px crest (familyCrest sm) + the short name. fam: the family record, for its emblem.
export const famChip = (name, han = '', fam = null) => `<span class="fchip">${fam ? familyCrest(fam, 'sm') : surnameTileOf(famShort(name), { size: 'sm', han })}<span class="fchip-n">${esc(famShort(name))}</span></span>`;
// Empty state for a list or search with no rows: one markup for all of them.
export const emptyState = (msg) => `<p class="sub pad">${msg}</p>`;
export const cic = (n, s = 16) => { if (!CI[n]) console.warn('giapha: no icon for key', n); return `<svg class="cic" width="${s}" height="${s}" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">${CI[n] || ''}</svg>`; };

// Current list page registers how a chip / "Xóa" button clears its filter: (key) => void, '*' = all.
let untag = null;
export const setUntag = (fn) => { untag = fn; };

// The one list toolbar: search · Bộ lọc · "+". quick: inline filters, desktop only (phones get the same fields in the filter
// sheet). add: the page's own "+" (addBtn), placed after the filter button on the same row; '' where nothing can be added.
export const lbar = (qid, ph, val, active, quick = '', add = '') => `<div class="lbar"><div class="srch"><input id="${qid}" type="search" placeholder="${ph}" value="${esc(val || '')}" aria-label="${ph}" autocomplete="off"></div>${quick && isWide() ? `<div class="lq">${quick}</div>` : ''}<button type="button" class="fbtn" data-fp aria-label="Bộ lọc${active ? ' (' + active + ' đang bật)' : ''}" title="Bộ lọc">${cic('filter', 20)}${active ? `<span class="fbadge">${active}</span>` : ''}</button>${add}</div>`;
// The toolbar's "+": one icon button (DS add icon); attrs carry the page's data-* hook, label is read aloud and shown on hover.
export const addBtn = (attrs, label) => `<button type="button" class="fbtn" ${attrs} aria-label="${esc(label)}" title="${esc(label)}">${cic('plus', 20)}</button>`;
export const ltags = (tags) => tags.length ? `<div class="ltags">${tags.map(([k, l]) => `<button type="button" class="tagx" data-untag="${k}" aria-label="Bỏ lọc ${esc(l)}">${esc(l)} <span aria-hidden="true">×</span></button>`).join('')}${tags.length > 1 ? '<button type="button" class="btn gh sm" data-untag="*">Xóa lọc</button>' : ''}</div>` : '';
// Shared sheet shell (bottom sheet on phones, centred modal from 672 px: listui.css dialog.fpanel). The body scrolls;
// actions (optional) stay in a sticky footer at the bottom. Closes on its close button, Esc and (data-fpx) actions.
export const fsheet = (title, body, actions = '') => `<dialog class="fpanel" aria-labelledby="fp-h"><div class="fp-hd"><h2 id="fp-h">${esc(title)}</h2><button type="button" class="csw-x" data-fpx aria-label="Đóng">${cic('close', 20)}</button></div><div class="fp-body">${body}</div>${actions ? `<div class="fp-foot">${actions}</div>` : ''}</dialog>`;
// Filter sheet: the body scrolls; the footer stays at the bottom (Xóa tất cả, then the sheet's own actions, e.g. Áp dụng).
export const fpanel = (inner, actions = '') => fsheet('Bộ lọc', inner, `<button type="button" class="btn ter fp-reset" data-untag="*">Xóa tất cả</button>${actions}`);
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-fp]')) { document.querySelector('dialog.fpanel')?.showModal(); return; }
  if (e.target.closest('[data-fpx]')) { e.target.closest('dialog')?.close(); return; }
  const u = e.target.closest('[data-untag]'); if (u && untag) { e.target.closest('dialog')?.close(); untag(u.dataset.untag); }
});

// Shared line for guests (no Google account): where their data lives, and how to sync it.
// googleOn: a Google sign-in link exists; otherwise the sign-in dialog opens (data-acct="in").
export const deviceNote = (googleOn) => {
  const act = googleOn ? '<a href="/api/auth/google">Đăng nhập để đồng bộ.</a>' : '<button type="button" class="linkbtn" data-acct="in">Đăng nhập để đồng bộ.</button>';
  return `<p class="devnote sub" role="note">Dữ liệu chỉ lưu trên thiết bị này. ${act}</p>`;
};
// Short message at the bottom of the screen; one at a time, gone after a few seconds.
let toastEl = null, toastT = null;
export function toast(msg) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.append(toastEl); }
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 4200);
}

// Timestamps from the server are UTC: always show Vietnam time (no seconds).
const VN = { timeZone: 'Asia/Ho_Chi_Minh' };
export const fmtTime = (ts) => new Date(ts).toLocaleString('vi-VN', { ...VN, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtDate = (ts) => new Date(ts).toLocaleDateString('vi-VN', { ...VN, day: '2-digit', month: '2-digit', year: 'numeric' });

// Field-diff list (review and my contributions): rows with hairline dividers, no bullets.
export const fieldDiff = (rowsHtml) => `<div class="fdiff">${rowsHtml}</div>`;
export const frow = (inner, cls = '') => `<div class="frow${cls ? ' ' + cls : ''}">${inner}</div>`;

// Carbon-style accordion item: a full-width header button (title, one-line summary, chevron) over a panel.
// Shared by the person form. The summary text is set by the caller (escaped); the title is escaped here.
export function accItem({ id, title, sum = '', open = false, body = '' }) {
  return `<section class="acc${open ? ' open' : ''}" data-acc="${id}"><h3 class="acc-h"><button type="button" class="acc-btn" data-acc-btn="${id}" aria-expanded="${open}" aria-controls="acc-p-${id}">`
    + `<span class="acc-t">${esc(title)}</span><span class="acc-s" data-acc-sum="${id}">${sum}</span>`
    + `<svg class="acc-chev" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button></h3>`
    + `<div class="acc-p" id="acc-p-${id}" ${open ? '' : 'hidden'}>${body}</div></section>`;
}
// Open or close one accordion item by id (used on load and when an error sits in a closed section).
export function accToggle(id, open) {
  const b = document.querySelector(`[data-acc-btn="${id}"]`); if (!b) return;
  const p = document.getElementById(b.getAttribute('aria-controls'));
  b.setAttribute('aria-expanded', String(open)); if (p) p.hidden = !open;
  b.closest('.acc')?.classList.toggle('open', open);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-acc-btn]'); if (!b) return;
  accToggle(b.dataset.accBtn, b.getAttribute('aria-expanded') !== 'true');
});

// Shared confirm dialog: title, body, optional warning line; Huỷ (secondary) and the action. Esc and a click outside close it
// (the app-wide dialog handler). onOk runs once, after the dialog has closed.
export function confirmModal({ title, body = '', warn = '', ok = 'OK', danger = false, onOk }) {
  document.querySelectorAll('dialog.cfm').forEach((x) => { x.close(); x.remove(); });
  const d = document.createElement('dialog'); d.className = 'dlg cfm'; d.setAttribute('aria-labelledby', 'cfm-h');
  d.innerHTML = `<div class="cfm-body"><h2 id="cfm-h">${esc(title)}</h2><p class="sub">${esc(body)}</p>${warn ? `<p class="cfm-warn" role="note">${esc(warn)}</p>` : ''}`
    + `<div class="row end cfm-acts"><button type="button" class="btn gh" data-cfm-no>Huỷ</button><button type="button" class="btn${danger ? ' dng' : ''}" data-cfm-ok>${esc(ok)}</button></div></div>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.querySelector('[data-cfm-no]').onclick = () => d.close();
  d.querySelector('[data-cfm-ok]').onclick = () => { d.close(); onOk?.(); };
  d.showModal();
  d.querySelector('[data-cfm-no]').focus();
}

// ---------- calm row: one list row for people and relations (mockup quanhe-390) ----------
// The owner crest: ONE component for every surname or family square (a colored tile with a Hán character).
// Colour comes from the surname (fixed for Dương, Trần, Lê; else a stable pick from the palette). Sizes: sm 20 px (chips),
// md 40 px (rows, cards), lg 64 px (book seal, form preview). Glyph: the Hán name when known, else the surname's first letter.
const SURNAME_FIXED = { 'Dương': 'var(--c-tile-1)', 'Trần': 'var(--c-tile-2)', 'Lê': 'var(--c-tile-3)' }; // web/tokens.css
const SURNAME_PALETTE = [1, 2, 3, 4, 5, 6].map((i) => `var(--c-tile-${i})`);
export function surnameOf(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (w.length >= 3 && SURNAME_HAN[w[0] + ' ' + w[1]]) return w[0] + ' ' + w[1];
  return w[0] || '';
}
// Sex cue: a small shape (square nam, circle nữ) in the sex colour, with its name for screen readers and on hover.
// Unknown sex: nothing (the row stays neutral).
export const SEX_LABEL = { m: 'Nam', f: 'Nữ' };
export const sexMark = (sex) => (SEX_LABEL[sex] ? `<span class="sx ${sex}" role="img" aria-label="${SEX_LABEL[sex]}" title="${SEX_LABEL[sex]}"></span>` : '');
export const sexClass = (sex) => (SEX_LABEL[sex] ? sex : 'u');
export function surnameTile(name) { return surnameTileOf(surnameOf(name)); }
// The same crest for a surname already cut out of a name (clan.js: a family's surname, e.g. "Âu Dương"). han: the family's own Hán name, if set.
export function surnameTileOf(s, { size = 'md', han = '' } = {}) {
  let bg = SURNAME_FIXED[s];
  if (!bg) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; bg = SURNAME_PALETTE[h % SURNAME_PALETTE.length]; }
  const ch = han || SURNAME_HAN[s] || (s ? s[0].toUpperCase() : '?');
  return `<span class="crest-sq crest-${size}" aria-hidden="true" style="background:${bg}"><span class="crest-ch" lang="zh-Hant">${esc(ch)}</span></span>`;
}
// A family's crest (f: family record with id, name, han, has_emblem, emblem_v): its emblem image when it has one, else the
// colored tile of its clan surname ("Họ Dương" -> Dương). size as in surnameTileOf.
export function familyCrest(f, size = 'md') {
  if (f?.has_emblem) return `<span class="crest-sq crest-${size} crest-img" aria-hidden="true">${famCrest(f)}</span>`;
  return surnameTileOf(famShort(String(f?.name || '')).trim(), { size, han: f?.han || '' });
}
const CHEV_SVG = '<svg class="calm-c" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
// "Xem thêm" at the end of a list: one full-width tertiary button (48 px). Native <details>: it opens the hidden part in
// place with no script, assistive tech announces expanded / collapsed, and the open button reads "Thu gọn".
// Used by Quan hệ (Chắt and deeper) and Tổ tiên (generations past four). label: plain text; body: HTML.
const CHEV_DOWN = '<svg class="ic more-chev" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
export const moreFold = (label, body, open = false) => `<details class="more-fold"${open ? ' open' : ''}><summary class="btn ter more-sum"><span class="more-closed">${esc(label)}</span><span class="more-open">Thu gọn</span>${CHEV_DOWN}</summary><div class="more-body">${body}</div></details>`;
// The ghost row: a fold drawn as a person row (the same height and indent), a dashed tile with up to 3 overlapping mini
// crests of the folded people, the closed text in muted type, and a chevron that turns when open (the text then reads
// "Thu gọn"). Native details: the hidden part (body, HTML) opens in place. Shared by every fold of people.
//   closed: text when shut. tiles: the surnames of the folded people (up to 3 are drawn). open: start open.
export const ghostRow = ({ closed, tiles = [], body = '', open = false }) => `<details class="ghost"${open ? ' open' : ''}><summary class="calm ghost-row"><span class="ghost-tile" aria-hidden="true">${tiles.slice(0, 3).map((s) => surnameTileOf(s, { size: 'sm' })).join('')}</span><span class="calm-t"><b class="calm-n ghost-n"><span class="gh-closed">${esc(closed)}</span><span class="gh-open">Thu gọn</span></b></span><svg class="calm-c gh-chev" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></summary>${body ? `<div class="ghost-body">${body}</div>` : ''}</details>`;
// The one list row (people, relations, menus, settings, pickers). A link when href is set, else a button (attrs: data-* or id).
//   icon: svg HTML (the caller's icon()), or tile: surnameTile HTML. title: plain text. subtitle: HTML the caller has escaped.
//   trailing: 'chevron' (default), 'none', or HTML the caller built. badge: HTML (a count) placed after the title.
//   dense: menu rows (10 px padding, no 56 px minimum). danger: red text. ghost: the add row (accent text, no divider).
// action: optional HTML of ONE trailing button (calmAct) placed next to the row as a sibling, never inside it; then no chevron.
export const calmRow = ({ href = '', attrs = '', icon = '', tile = '', title, subtitle = '', badge = '', trailing = 'chevron', dense = false, danger = false, ghost = false, action = '', sex = '' }) => {
  if (action && trailing === 'chevron') trailing = 'none';
  const cls = `calm${dense ? ' dense' : ''}${danger ? ' danger' : ''}${ghost ? ' ghost' : ''}`;
  const inner = `${icon || tile}<span class="calm-t"><b class="calm-n">${esc(title)}${sexMark(sex)}${badge}</b>${subtitle ? `<span class="calm-s">${subtitle}</span>` : ''}</span>${trailing === 'chevron' ? CHEV_SVG : trailing === 'none' ? '' : trailing}`;
  const row = href ? `<a class="${cls}" href="${esc(href)}" ${attrs}>${inner}</a>` : `<button class="${cls}" type="button" ${attrs}>${inner}</button>`;
  return action ? `<div class="calm-row">${row}${action}</div>` : row;
};
// The trailing icon button of a calmRow (44 px, DS icon-button look). attrs carries data-* for the delegated handler.
export const calmAct = ({ icon, label, attrs = '' }) => `<button type="button" class="calm-act" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon}</button>`;
// The app's anchored ⋯ menu (moved here from app.js so relui.js shares it): items [[label, fn, danger?, attrs?]], optional
// note html at the bottom, optional title at the top. Opens upward when there is no room below. Closes on pick,
// a tap outside, Escape (focus back on the trigger) and a second tap on the same trigger (toggle). The trigger gets
// aria-haspopup="menu" and aria-expanded. One outside listener (capture phase) lives only while a menu is open, so a
// click that opens another menu is never closed by a listener left over from an earlier one.
let openMenu = null; // { m, anchor }
const onOutside = (e) => {
  if (!openMenu) return;
  if (openMenu.m.contains(e.target) || openMenu.anchor.contains(e.target)) return; // its own trigger toggles in popMenu
  closeMenu();
};
export function closeMenu({ focus } = {}) {
  const cur = openMenu; openMenu = null;
  removeEventListener('click', onOutside, true);
  const hadFocus = cur && cur.m.contains(document.activeElement);
  document.querySelectorAll('.menu').forEach((x) => x.remove());
  if (cur) {
    cur.anchor.setAttribute('aria-expanded', 'false');
    if ((focus ?? hadFocus) && cur.anchor.isConnected) cur.anchor.focus();
  }
}
export function popMenu(anchor, items, note = '', { title = '' } = {}) {
  if (openMenu && openMenu.anchor === anchor && openMenu.m.isConnected) { closeMenu({ focus: true }); return null; } // toggle
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
  m.innerHTML = (title ? `<div class="mh">${esc(title)}</div>` : '') + items.map(([l, , d, at = ''], i) => `<button role="menuitem" class="${d ? 'd' : ''}" data-i="${i}" ${at}>${l}</button>`).join('') + (note ? `<div class="mh">${note}</div>` : '');
  document.body.append(m);
  const r = anchor.getBoundingClientRect(); const h = m.offsetHeight;
  // below the trigger when it fits, else above; a menu taller than both sides takes the larger side and scrolls
  // inside, so it never covers its own trigger (a second tap must reach the trigger to close it)
  const below = innerHeight - r.bottom - 8; const above = r.top - 8;
  let top = r.bottom;
  if (h > below) {
    if (h <= above) top = r.top - h;
    else if (above > below) { m.style.maxHeight = above + 'px'; m.style.overflowY = 'auto'; top = r.top - above; }
    else { m.style.maxHeight = below + 'px'; m.style.overflowY = 'auto'; }
  }
  m.style.top = top + scrollY + 'px';
  m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
  m.querySelector('button')?.focus({ preventScroll: true }); // never scroll the page under the trigger
  m.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { closeMenu(); items[+b.dataset.i][1](); } };
  m.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu({ focus: true }); } };
  anchor.setAttribute('aria-haspopup', 'menu'); anchor.setAttribute('aria-expanded', 'true');
  openMenu = { m, anchor };
  addEventListener('click', onOutside, true); // capture: fires even when a trigger stops propagation
  return m;
}

// Sticky toolbars (.lbar / .stk / .tbar2 / .ptabs): data-stuck while pinned under the top bar, for the divider only.
// One IntersectionObserver for the app; new toolbars are picked up as pages render.
if (typeof window !== 'undefined' && typeof IntersectionObserver === 'function' && typeof MutationObserver === 'function') {
  const SEL = '.lbar,.stk,.tbar2,.ptabs';
  let io = null;
  const topPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) || 0;
  const observer = () => io || (io = new IntersectionObserver((es) => {
    for (const e of es) e.target.toggleAttribute('data-stuck', e.intersectionRatio < 1 && e.boundingClientRect.top <= e.rootBounds.top + 1);
  }, { rootMargin: `-${topPx() + 1}px 0px 0px 0px`, threshold: [1] }));
  const scan = (root) => { if (!root?.querySelectorAll) return; const list = root.matches?.(SEL) ? [root, ...root.querySelectorAll(SEL)] : root.querySelectorAll(SEL); for (const el of list) if (!el.dataset.stk) { el.dataset.stk = '1'; observer().observe(el); } };
  const start = () => { scan(document); new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n); }).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
