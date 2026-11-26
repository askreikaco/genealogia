import * as S from './store.js';
import { nameOf, noticeNeeded, noticeHtml } from './hidden.js';
import { dangerButton, dangerZone, dangerItem, dangerLabel, confirmDanger, undoToast, restoreTrash } from './danger.js';
import * as TR from './trash-ui.js';
import * as CN from './council.js';
import * as NW from './news.js';
import { icsCalendar } from './ics.js';
import { canonicalView, mergeLich, dayMs } from './lich-merge.js';
import { build, rank, years, yearsHtml, relation, isDead, gioOf, branchOf, lineage, esc, spousesOf, baseOf, genOf, inChi } from './model.js';
import { factGroups, factCardHtml, bornHintShown } from './facts.js';
import { branchesOf, branchInfo, founderOf } from './branches.js';
import { bareName } from './famlabel.js';
import { nextAnniversary } from './lunar.js';
import DG from './digest-vi.js';
import { locate } from './geo.js';
import { chartLayout, chartSvg } from './treechart.js';
import { emblemField, bindEmblem } from './emblem.js';
import { openConfirm } from '../vendor/reika-ds/js/index.js';
import { isWide, isDesk, layoutAtLeast, emptyState, cic, iconButton, toolbar, addBtn, ltags, fpanel, fsheet, sheet, closeSheets, setUntag, deviceNote, toast, fmtTime, fmtDate, fieldDiff, frow, accItem, accToggle, confirmModal, CFM_CANCEL, closeConfirms, famChip, familyCrest, calmRow, calmAct, surnameTile, surnameTileOf, popMenu, closeMenu, sexMark, sexClass, SEX_LABEL, tag, section, card } from './ui.js';
import { BUILD, BUILD_DATE, createUpdater, updateNotice, buildLabel } from './update.js';
import { searchPeople } from './fuzzy.js';
import { nameHit, listPrefill, gioPrefill, eventPrefill } from './prefill.js';
import { codeOf, codeQuery, matchCode, CODE_HELP } from './codes.js';
import { formatSid, normalizeSid, SID_HELP } from './shortid.js';
import { relSection, pedigreeHtml, relWire, setNewPersonHandler, relTable, addNewRelated } from './relui.js';
import { parseSmartDate, fullDate, yearOf as yrOf, smartText, cmpDate, lunarOf, yearOfData, inferThuBase, suggestGen, suggestThu, hanNameError } from './formrules.js';
import * as SUC from './succession.js';
import * as CLM from './claim.js';
import * as elder from './elder.js';
import * as LK from './links.js';
import * as BT from './branch-trees.js';
import { personItem } from './person-item.js';
import { openContactImport } from './contacts-import.js';
import { CONTACT_TYPES, TYPE as CTYPE, listOf as contactList, contactHref, itemError as contactError, cleanList, sameList } from './contacts-model.js';
import * as CL from './clan.js';
import * as SN from './surnames.js';
import { COUNTRIES, countryName, countryCode } from './countries.js';
import * as PL from './places.js';
import { accountPage } from './account.js';
import { twoStepPage } from './twostep.js';
import * as MT from './match.js';
import * as DP from './dupes.js';
import * as CS from './consistency.js';
import * as RP from './relpath.js';
import { VI as CSV } from './consistency-vi.js';
import { TEXT_SIZE_VI } from './text-size-vi.js';
import { addSearch, addBasic } from './addflow.js';
import * as VR from './variants.js';
import { KIN_REGION_KEY, resolveRegion } from './kin/index.js';
import { EVENT_TYPES, SOURCE_QUALITY, formatEventDate, sortEvents, birthIso, autoSummary, canSeeEventsOf, parseEventDate, EVENT_PHOTO_MAX } from './events.js';
import { deriveLifeEvents, historyRows, relAccess, legacyAccess, estimatedLifeRows } from './events-life.js';
import { estimateFamilyCached, ageAtDeathOf } from './estimate-graph.js';
import { HISTORY_ALL } from './events-history.js';
import { index as relIndex } from './relgraph.js';
import { evIcon, typeIcon, headline, tlLoad, tlSave, tlTags, tlApplyUntag, tlToolbar, tlSheetDialog, tlEntries, tlMatch, tlList, tlCount, lifeStoriesHtml, approxHtml,
  evEditorHtml, readEvx, wireEvx, storyEditorHtml, readStx, photoRow, PHOTO_PREVIEW } from './events-ui.js';
const fold = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');

const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');
// Views that are not about one family: no family prefix in the hash, no follow bar, no family in the preferences.
const NO_FAM = ['tai-khoan', 'dang-nhap-2fa', 'offer', 'trusted', 'lap-gia-pha', 'cach-goi', 'ho', 'nhan-quan-ly'];
let M = build();
const open = new Set(JSON.parse(localStorageGet('gp_open') || '[]'));
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

const IC = {
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>',
  tree: '<path d="M12 3v6M6 15v-3h12v3M9 3h6v6H9zM3 15h6v6H3zM15 15h6v6h-6z"/>', search: '<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/>',
  book: '<path d="M4 4h7a2 2 0 012 2v14a2 2 0 00-2-2H4zM20 4h-7a2 2 0 00-2 2v14a2 2 0 012-2h7z"/>', map: '<path d="M12 21s-7-6-7-11a7 7 0 0114 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  gio: '<rect x="4" y="5" width="16" height="15"/><path d="M4 10h16M9 3v4M15 3v4"/>', flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  dl: '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>', more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>', pencil: '<path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  note: '<path d="M6 4h12v16H6zM9 9h6M9 13h6M9 17h3"/>',
  gear: '<path d="M18.93 10.04 L21.94 10.90 L21.94 13.10 L18.93 13.96 L18.28 15.52 L19.80 18.25 L18.25 19.80 L15.52 18.28 L13.96 18.93 L13.10 21.94 L10.90 21.94 L10.04 18.93 L8.48 18.28 L5.75 19.80 L4.20 18.25 L5.72 15.52 L5.07 13.96 L2.06 13.10 L2.06 10.90 L5.07 10.04 L5.72 8.48 L4.20 5.75 L5.75 4.20 L8.48 5.72 L10.04 5.07 L10.90 2.06 L13.10 2.06 L13.96 5.07 L15.52 5.72 L18.25 4.20 L19.80 5.75 L18.28 8.48 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  logout: '<path d="M14 4h6v16h-6M3 12h11M10 8l-4 4 4 4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
  invite: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1M19 8v6M16 11h6"/>',
};
// Carbon icons 11.90 (32 grid, filled) for the shell: switcher, nav, toggle.
const NAV_GROUPS = [['tree', 'list', 'book', 'map', 'lich', 'stats'], ['gop-y', 'members', 'nhan-quan-ly', 'verify', 'export', 'settings']];
const NAV_CI = { 'gop-y': 'sheet', mine: 'sheet', tree: 'tree', list: 'search', book: 'book', map: 'map', lich: 'gio', stats: 'chart', review: 'pencil', members: 'user', 'nhan-quan-ly': 'tree', verify: 'flag', export: 'dl', settings: 'gear' };
// Switcher = switch family (one family today; more families become more rows). Subtitle: size and your role, like an organisation list.
// ---------- families: one row component for the switcher, the settings list and the "Mở khi vào" sheet ----------
// Hash: #/<family>/<page> for every family; old #page links are the default family (duong). Family id = slug.
const FAM_VIS_LBL = { public: 'Công khai', link: 'Có đường dẫn', private: 'Riêng tư' };
// Records of the families this device follows (in the order the user added them). duong is the fallback until its details load.
const followedRecs = () => S.followedFams().map((id) => S.familyMeta(id) || (id === 'duong' ? { id, slug: id, name: 'Họ Dương', han: '', visibility: 'public', my_role: null } : { id, slug: id, name: id, han: '', visibility: 'public', my_role: null }));
// Second line of a family row: your role or follow state, the visibility word, the people count. Plain text, joined by " · ".
function famLine2(f) {
  const cur = f.id === S.curFamily();
  const role = f.my_role ? ROLE_LBL[f.my_role] : (S.isFollowing(f.id) ? 'Đang theo dõi' : '');
  const n = cur ? M.all.length : f.people; // everyone, including people married in
  return [role, FAM_VIS_LBL[f.visibility] || '', n != null ? `${n} người` : ''].filter(Boolean).join(' · ');
}
// One row: 40px Hán tile · name (one line) · secondary line · chevron. Whole row is the link. min 64px.
const famRowHtml = (f, href, cur = false) => `<a class="famr" href="${href}"${cur ? ' aria-current="page"' : ''}>
  ${familyCrest(f, 'md')}
  <span class="famr-tx"><span class="famr-nm">${esc(f.short_name || f.name)}</span><span class="famr-sb">${esc(famLine2(f))}</span></span>
  <span class="famr-go" aria-hidden="true">›</span></a>`;
// Background renders (family details arrive, a store change) must not discard a sheet the user has open in the page:
// they wait until that dialog closes and render once then. Sheets on <body> (the relation sheet) and kept views (map,
// book) survive a render, so those render at once. User actions and route changes still call render() at once.
let renderHeld = null;
function renderKeeps() { const { view, arg, fam } = route(); const key = mountKey(view, arg, fam); return !!key && key === mounted && keptNode(view); }
function renderSoon() {
  const open = main.querySelector('dialog[open]');
  if (!open || renderKeeps()) return render();
  if (renderHeld?.isConnected) return;
  renderHeld = open;
  open.addEventListener('close', () => { renderHeld = null; renderSoon(); }, { once: true });
}
// Families whose details are not loaded yet are fetched once; the chrome repaints when they arrive.
let famLoading = false; const famTried = new Set(); // ids asked for once; a retry (force) asks again
function refreshFams(force) {
  if (famLoading) return;
  const missing = S.followedFams().filter((id) => !S.familyMeta(id) && (force || !famTried.has(id)));
  if (!missing.length) return;
  missing.forEach((id) => famTried.add(id));
  famLoading = true;
  Promise.allSettled(missing.map((id) => S.fetchFamily(id))).then((rs) => {
    famLoading = false;
    if (rs.some((r) => r.status === 'fulfilled')) renderSoon();
  });
}
// "Tất cả dòng họ (n)": first row of the switcher and of the "Mở khi vào" sheet, only when 2+ families are followed.
const allRow = (cur) => { const n = S.scopeFams().length; return n >= 2 ? `<a class="famr" href="#/${S.ALL_FAMS}/tree"${cur ? ' aria-current="page"' : ''}>
  <span class="ibox" aria-hidden="true">${cic('switcher', 20)}</span>
  <span class="famr-tx"><span class="famr-nm">Tất cả dòng họ (${n})</span><span class="famr-sb">Người trong mọi dòng họ bạn theo dõi</span></span>
  <span class="famr-go" aria-hidden="true">›</span></a>` : ''; };
function openSwitcher() {
  document.querySelector('dialog.csw')?.remove();
  const d = document.createElement('dialog'); d.className = 'csw'; d.setAttribute('aria-labelledby', 'csw-h');
  const cur = S.curFamily();
  d.innerHTML = `<div class="csw-box"><div class="csw-hd"><h2 id="csw-h" tabindex="-1" autofocus>Chọn dòng họ</h2><button type="button" class="csw-x" aria-label="Đóng" title="Đóng">${cic('close', 20)}</button></div>
    <div class="famrs">${allRow(cur === S.ALL_FAMS)}${followedRecs().map((f) => famRowHtml(f, f.id === 'duong' && cur === 'duong' ? '#tree' : `#/${f.slug}/tree`, f.id === cur)).join('')}
    <a class="famr add" href="#/${S.ALL_FAMS}/tree"><span class="famr-tx"><span class="famr-nm">＋ Tìm / lập dòng họ</span></span></a></div></div>`;
  document.body.append(d);
  const close = () => { d.close(); d.remove(); $('#swbtn')?.focus(); };
  d.querySelector('.csw-x').addEventListener('click', close);
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('.famr')) close(); });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.showModal();
}
// "Mở khi vào ứng dụng": the family the app opens on when the address has no family. Radio sheet, no stars.
function openDefaultSheet() {
  const def = S.defaultFamily();
  const d = dialog(`<h2>Mở khi vào ứng dụng</h2><div class="famrs">${S.scopeFams().length >= 2 ? `<label class="famr famr-radio"><input type="radio" name="defam" value="${S.ALL_FAMS}" ${def === S.ALL_FAMS ? 'checked' : ''}><span class="famr-tx"><span class="famr-nm">Tất cả dòng họ (${S.scopeFams().length})</span></span></label>` : ''}${followedRecs().map((f) => `<label class="famr famr-radio"><input type="radio" name="defam" value="${esc(f.id)}" ${f.id === def ? 'checked' : ''}><span class="famr-tx"><span class="famr-nm">${esc(f.short_name || f.name)}</span><span class="famr-sb">${esc(S.familyHan(f.id) || '')}</span></span></label>`).join('')}</div><div class="row end"><button type="button" class="btn gh" data-cancel>Đóng</button></div>`, () => {});
  d.querySelectorAll('input[name=defam]').forEach((r) => { r.onchange = () => { S.setPrefs({ default_family: r.value }); d.close(); d.remove(); render(); }; });
}
// Family id from the hash, with the page: '#/nguyen/person/P1' -> fam 'nguyen', view 'person'.
// Links inside the app keep the family on screen: '#person/P1' in nguyen becomes '#/nguyen/person/P1'.
// Short branch label from the founder's name, any family: "Dương Văn Lộc" -> "Lộc", "Trần Thị Năm" -> "Năm".
const chiName = (n) => { const w = String(n || '').trim().split(/\s+/); const rest = w.length > 2 && /^(Văn|Thị)$/i.test(w[1]) ? w.slice(2) : w.slice(1); return rest.length ? rest.join(' ') : String(n || ''); };
// "họ Dương", "họ Võ", … for a person's own family (married-in labels: Rể/Dâu họ …).
const hoOf = (p) => { const n = S.familyName((p && p.fam) || S.curFamily()) || ''; return /^họ\s/i.test(n) ? 'họ ' + n.replace(/^họ\s+/i, '') : 'họ ' + n; };
const inLaw = (p) => `${p.data.sex === 'm' ? 'Rể' : 'Dâu'} ${hoOf(p)}`;
const hf = (p) => { const f = S.curFamily(); return '#' + (f === 'duong' || /^login/.test(p) ? '' : '/' + f + '/') + p; };
// Link to a row's own family: in "Tất cả" every row names its family, elsewhere the current one is used.
const ph = (p, path) => (S.isAll() ? `#/${p.fam || 'duong'}/${path}` : hf(path));
// 2+ families in scope: family chips, the Dòng họ filter and the family picker. One family: none of them.
const multiFam = () => S.isAll() && S.scopeFams().length >= 2;
const famChipIf = (p) => (multiFam() && p ? famChip(S.familyLabel(p.fam || 'duong'), S.familyHan(p.fam || 'duong'), S.familyMeta(p.fam || 'duong')) : '');
const famSelect = (id, val, list = S.scopeFams()) => `<select id="${id}" aria-label="Dòng họ"><option value="">Mọi dòng họ</option>${list.map((f) => `<option value="${esc(f)}" ${f === val ? 'selected' : ''}>${esc(S.familyName(f))}</option>`).join('')}</select>`;
// "Tất cả" pages that work per family (tree, book, export, add, review, members): a calm list of the families in
// scope (or the ones matching pred), last used first. Tapping one opens that family's own page.
function famPicker(view, heading, lead, pred = () => true) {
  const used = S.getPrefs().fam_used || [];
  const recs = followedRecs().filter((f) => S.scopeFams().includes(f.id) && pred(f)).sort((a, b) => (used.indexOf(a.id) < 0 ? 1e9 : used.indexOf(a.id)) - (used.indexOf(b.id) < 0 ? 1e9 : used.indexOf(b.id)));
  main.innerHTML = `<h1>${heading}</h1><p class="sub">${recs.length ? lead : 'Bạn chưa có quyền quản trị dòng họ nào.'}</p><div class="famrs">${recs.map((f) => famRowHtml(f, `#/${f.slug}/${view}`)).join('')}</div>`;
}
// theme: '' = follow system, 'light', 'dark'
const themePref = () => S.getPrefs().theme || '';
const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
function setTheme(t) { S.setPrefs({ theme: t }); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; document.querySelector('meta[name=theme-color]')?.setAttribute('content', '#161616'); render(); }
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!themePref()) render(); });
// Side nav: rail (icons) or expanded. A stored choice wins ('1' rail, '0' expanded); with none, desktop (>= 66rem) starts
// expanded and tablet (42-65.98rem) starts as rail. Same rule as the app shell.
const railPref = () => { const v = localStorageGet('gp_rail'); return v === '1' || (v !== '0' && !layoutAtLeast('wide')); };
function applyRail() { document.body.classList.toggle('rail', railPref()); }
const icon = (n) => { if (!IC[n]) console.warn('giapha: no icon for key', n); return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`; };
// [route, long label, short label, icon, group]
const NAV = [
  ['list', 'Tìm / Danh sách', 'Tìm', 'search', 'Xem'], ['tree', 'Cây gia phả', 'Cây', 'tree', 'Xem'], ['lich', 'Lịch', 'Lịch', 'gio', 'Xem'],
  ['book', 'Sách gia phả', 'Sách', 'book', 'Xem'], ['map', 'Bản đồ', 'Bản đồ', 'map', 'Xem'], ['stats', 'Thống kê', 'Thống kê', 'chart', 'Xem'],
  ['gop-y', 'Góp ý', 'Góp ý', 'note', 'Dữ liệu'], ['mine', 'Góp ý của tôi', 'Góp ý', 'note', 'Dữ liệu'], ['review', 'Duyệt đóng góp', 'Duyệt', 'pencil', 'Dữ liệu'], ['members', 'Thành viên & quyền', 'Thành viên', 'user', 'Dữ liệu'], ['nhan-quan-ly', 'Nhận quản lý cây', 'Nhận cây', 'tree', 'Dữ liệu'], ['verify', 'Cần bổ sung', 'Bổ sung', 'flag', 'Dữ liệu'], ['export', 'Tải về', 'Tải về', 'dl', 'Dữ liệu'], ['settings', 'Cài đặt', 'Cài đặt', 'gear', 'Dữ liệu'],
];
const MOBILE_TABS = ['list', 'tree', 'lich', 'book', 'more'];
// Suggestions waiting for an editor (badge on Duyệt đóng góp). Refreshed by render(), throttled.
let sugCount = 0; let sugFetchedAt = 0; let joinCount = 0; // joinCount: join requests waiting (members page badge)
// Admin pages: the family on screen, or in "Tất cả" every family the viewer may review (admin or owner).
const adminFams = () => S.scopeFams().filter((f) => S.can(S.roleIn(f), 'admin'));
const famsHere = () => (S.isAll() ? adminFams() : [S.curFamily()]);
const canAdminHere = () => (S.isAll() ? adminFams().length > 0 : S.isAdmin());
// Families on screen where this account may read an admin-only endpoint (guests never call them: no 401s on a cold load).
const famsFor = (action) => famsHere().filter((f) => S.can(S.roleIn(f), action));
// Chips and the Dòng họ filter only when the combined page spans 2+ families.
const multiHere = () => S.isAll() && famsHere().length >= 2;
const chipOf = (f) => (multiHere() && f ? famChip(S.familyLabel(f), S.familyHan(f), S.familyMeta(f)) : '');
// A link to a row's own family: in "Tất cả" the family is in the address, elsewhere the family on screen is used.
const rowHref = (f, path) => (S.isAll() ? `#/${f}/${path}` : hf(path));
function refreshSugCount(force) {
  if (!force && Date.now() - sugFetchedAt < 20000) return;
  sugFetchedAt = Date.now();
  const revFams = famsFor('review'); const memFams = famsFor('members');
  if (!revFams.length) sugCount = 0;
  if (!memFams.length) joinCount = 0;
  Promise.all(revFams.map((f) => S.listSuggestions('pending', f).then((j) => j.counts?.pending || 0, () => 0))).then((a) => { const n = a.reduce((x, y) => x + y, 0); if (n !== sugCount) { sugCount = n; chrome(); } });
  Promise.all(memFams.map((f) => S.listMembers(f).then((j) => j.counts?.pending || 0, () => 0))).then((a) => { const n = a.reduce((x, y) => x + y, 0); if (n !== joinCount) { joinCount = n; chrome(); } });
}

// Lịch tab badge: unread Tin họ posts plus gatherings within 7 days (device-local seen time). Members only.
let lichN = 0;
function refreshLichBadge() {
  const fam = S.curFamily();
  if (fam === S.ALL_FAMS || !S.isMember()) { if (lichN) { lichN = 0; chrome(); } return; }
  NW.loadPosts(fam).then(() => { const n = NW.badgeFor(fam, S.getPrefs); if (n !== lichN) { lichN = n; chrome(); } }, () => {});
}
// P1c: the members-only notice under the top bar (#pnote, index.html). Shown only to a non-member, and only where the
// view can hold a hidden living person. Not dismissible. The stripe is fixed below the top bar; body.has-pnote pads the shell.
function privNote(view, arg) {
  const el = $('#pnote'); if (!el) return;
  const on = noticeNeeded({ view, arg, member: S.isMember(), all: S.isAll(), M });
  document.body.classList.toggle('has-pnote', on);
  el.hidden = !on;
  if (!on) { el.innerHTML = ''; return; }
  const fam = S.curFamily();
  el.innerHTML = noticeHtml({ signedIn: S.signedIn(), joinHref: hf('join'), loginHref: `/api/auth/google?next=${fam === 'duong' ? 'join' : `/${fam}/join`}` });
  el.style.setProperty('--pnote-h', el.offsetHeight + 'px');
}
addEventListener('resize', () => { const el = $('#pnote'); if (el && !el.hidden) el.style.setProperty('--pnote-h', el.offsetHeight + 'px'); });
function chrome() {
  const r = route().view;
  const cur = r === 'person' ? 'list' : (r === 'mine' || r === 'review') ? 'gop-y' : r;
  const tl = railPref() ? 'Mở rộng menu' : 'Thu gọn menu';
  const nav = $('#nav'); nav.className = isWide() ? 'side' : 'tabs';
  nav.innerHTML = isWide() ? `<div class="sn-items">${NAV_GROUPS.map((grp) => grp.filter((k) => (!['review', 'members'].includes(k) || canAdminHere()) && (k !== 'nhan-quan-ly' || S.signedIn())).map((k) => { const n = NAV.find((x) => x[0] === k);
      return `<a href="${hf(`${k}`)}" class="sn-link${cur === k ? ' on' : ''}" ${cur === k ? 'aria-current="page"' : ''} title="${n[1]}">${cic(NAV_CI[k])}<span class="sn-tx">${n[1]}</span>${(k === 'review' || k === 'gop-y') && sugCount ? ` <b class="badge">${sugCount}</b>` : ''}${k === 'lich' && lichN ? ` <b class="badge">${lichN}</b>` : ''}${k === 'members' && joinCount ? ` <b class="badge">${joinCount}</b>` : ''}</a>`; }).join('')).join('<hr class="sn-div">')}</div>
    <div class="sn-foot"><button type="button" class="sn-toggle" data-acct="${S.signedIn() ? 'sheet' : 'in'}" title="${S.signedIn() ? 'Tài khoản' : 'Đăng nhập'}">${cic('user')}<span class="sn-tx">${S.signedIn() ? esc(accName()) + ' · Tài khoản' : 'Đăng nhập'}</span></button><button type="button" class="sn-toggle" id="sntoggle" aria-controls="nav" aria-label="${tl}" aria-expanded="${!railPref()}">${cic(railPref() ? 'chevR' : 'chevL')}<span class="sn-tx">${tl}</span></button></div>` : MOBILE_TABS.map((k) => { if (k === 'more') { const on = ['map', 'stats', 'gop-y', 'mine', 'review', 'members', 'join', 'verify', 'export', 'more'].includes(navLevel().tab); return `<a href="${hf(`more`)}" class="${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>${cic('more', 20)}<span>Thêm</span></a>`; }
    const n = NAV.find((x) => x[0] === k); return `<a href="${hf(`${k}`)}" class="${navLevel().tab === k ? 'on' : ''}" ${navLevel().tab === k ? 'aria-current="page"' : ''}>${cic(NAV_CI[k], 20)}<span>${n[2]}</span>${k === 'lich' && lichN ? ` <b class="badge">${lichN}</b>` : ''}</a>`; }).join('');
  const root = navLevel(route()).root;
  $('.cbar').classList.toggle('inner', !root);
  $('#cbl').innerHTML = (root ? '' : '<button class="cbar-back" id="cbback" type="button" aria-label="Quay lại" title="Quay lại">‹</button>') + (root || isWide() ? '<button class="cbar-sw" id="swbtn" type="button" aria-label="Chọn dòng họ" aria-haspopup="dialog" title="Chọn dòng họ">' + cic('switcher', 20) + '</button>' : '');
  applyRail();
  { const b = $('#topsearch'); b.innerHTML = cic('search', 20); }
  { const b = $('#thm'); const d = isDark(); b.innerHTML = cic(d ? 'sun' : 'moon', 20); b.setAttribute('aria-label', d ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối'); b.title = b.getAttribute('aria-label'); }
  const st = S.status;
  const label = st.state === 'syncing' ? 'Đang đồng bộ' : st.state === 'offline' ? `Offline${st.pending ? ' · ' + st.pending + ' chờ gửi' : ''}` : st.state === 'error' ? 'Lỗi đồng bộ' : st.pending ? `${st.pending} chờ gửi` : 'Đã đồng bộ';
  $('#sync').innerHTML = `<i class="${st.state === 'error' ? 'red' : st.state === 'offline' || st.pending ? 'yellow' : st.state === 'syncing' ? 'blue' : 'green'}"></i><span>${label}</span>`;
  $('#sync').title = st.error || label;
  if (restoreY != null) restoreWhenDrawn(restoreY); // Back returns to where the list was
}

// ---------- page wrapper: the bar is the single page title ----------
function stripTitles() {
  for (const h of main.querySelectorAll('h1:not(.keep)')) { // detail pages keep their big title (h1.keep)
    if (!$('#cbtitle').textContent.trim()) $('#cbtitle').textContent = h.textContent.trim();
    const row = h.parentElement; h.remove();
    if (row !== main && !row.textContent.trim() && !row.querySelector('button,a,input,select,img,svg')) row.remove();
  }
}
new MutationObserver(() => { if (main.querySelector('h1:not(.keep)')) stripTitles(); }).observe(main, { childList: true, subtree: true });
// #view/arg?query: the query (only #mine?r=... uses it) is split off first.
// #[/family]/view/arg?query. Old hashes (no family) are the default family, duong. '/tat-ca/' = all families in scope.
function route() {
  let raw = location.hash.slice(1); let fam = 'duong';
  const fm = /^\/([a-z0-9-]{1,60})(?:\/(.*))?$/.exec(raw);
  if (fm) { raw = fm[2] || ''; fam = fm[1]; } // 'tat-ca' = all families in scope
  const qi = raw.indexOf('?'); const [view, arg] = (qi < 0 ? raw : raw.slice(0, qi)).split('/');
  return { view: view || 'tree', arg: decodeURIComponent(arg || ''), qs: new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1)), fam };
}
// Level of the current page: root pages (the bottom tabs and the desktop primaries) or inner pages with a parent.
const MORE_KIDS = ['map', 'stats', 'verify', 'consistency', 'export', 'gop-y', 'mine', 'review', 'members', 'join', 'settings', 'tai-khoan', 'nhan-quan-ly'];
function navLevel(r = route()) {
  const { view, arg } = r;
  if (view === 'person') return { root: false, parent: hf('list'), tab: 'list' };
  if (view === 'sua') return { root: false, parent: hf(`person/${arg}`), tab: 'list' };
  if (view === 'su-kien') return { root: false, parent: hf(`person/${arg}`), tab: 'list' };
  if (view === 'tin') return { root: false, parent: hf('lich'), tab: 'lich' };
  if (view === 'tin-sua') return { root: false, parent: hf('tin'), tab: 'lich' };
  if (view === 'relpath') return { root: false, parent: arg ? hf(`person/${encodeURIComponent(arg)}`) : hf('list'), tab: 'list' };
  if (view === 'thung-rac') return { root: false, parent: hf('more'), tab: 'more' };
  if (view === 'bieu-quyet') return { root: false, parent: hf('more'), tab: 'more' };
  if (view === 'place') return { root: false, parent: hf('list'), tab: 'list' };
  if (view === 'ho') return { root: false, parent: '#/' + S.ALL_FAMS + '/tree', tab: 'more' };
  if (view === 'them') { const pid = formSt?.prefill?.parent; return { root: false, parent: pid ? hf(`person/${pid}`) : hf('list'), tab: 'list' }; }
  if (view === 'cai-dat-dong-ho' || view === 'cach-goi') return { root: false, parent: hf('settings'), tab: 'more' };
  if (view === 'nguoi-ke-nhiem') return { root: false, parent: hf('cai-dat-dong-ho'), tab: 'more' };
  if (view === 'vai-tro') return { root: false, parent: hf('members'), tab: 'more' };
  if (view === 'doi-chi') return { root: false, parent: hf('stats'), tab: 'more' };
  if (view === 'tai-khoan' && arg) return { root: false, parent: '#tai-khoan', tab: 'more' }; // Tài khoản subpages back to the page
  if (view === 'dang-nhap-2fa') return { root: false, parent: '#tree', tab: 'tree' }; // sign-in step 2 (twostep.js)
  if (MORE_KIDS.includes(view)) return { root: false, parent: hf('more'), tab: 'more' };
  return { root: true, tab: view || 'tree' };
}
// Hashes of this app session (for Back: history.back() inside the app, the declared parent after a deep link).
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; // the shell restores the list position itself (Back)
const navTrail = [location.hash]; const scrollMemo = new Map(); let restoreY = null;
function trailUpdate() {
  const h = location.hash; const top = navTrail[navTrail.length - 1];
  scrollMemo.set(top, scrollY);
  if (navTrail.length > 1 && navTrail[navTrail.length - 2] === h) { navTrail.pop(); restoreY = scrollMemo.get(h) ?? null; }
  else { navTrail.push(h); restoreY = null; }
}
// The list is drawn after render() returns (and again when data arrives), so for about a second the position is
// set on each frame where the page is tall enough to hold it.
function restoreWhenDrawn(y, n = 0) {
  restoreY = null;
  if (document.documentElement.scrollHeight >= y + innerHeight && Math.abs(scrollY - y) > 2) scrollTo(0, y);
  if (n < 60) requestAnimationFrame(() => restoreWhenDrawn(y, n + 1));
}
function goBack() { if (navTrail.length > 1) history.back(); else location.hash = navLevel().parent || hf('tree'); }

// Same-route re-render (a sync or any store change calls render()): the book iframe and the map instance stay mounted,
// so the book is not reloaded (scroll kept) and the map keeps its zoom. The tree is rebuilt from the data, and its
// canvas keeps its scroll position. `mounted` is the key of the view on screen; the DOM is checked too (other code
// may have replaced main since).
let mounted = null; let treeKeep = null;
function mountKey(view, arg, fam) {
  if (S.isAll()) return null;
  if (view === 'book') return `book|${fam}|${arg}`;
  if (view === 'map') return `map|${fam}`;
  if (view === 'tree' && isDesk()) return `tree|${fam}|${arg}|${localStorageGet('gp_tmode') || 'chart'}|${localStorageGet('gp_sel') || ''}|${S.getPrefs().filters?.chi || ''}`;
  return null;
}
const keptNode = (view) => (view === 'book' ? !!main.querySelector('iframe.bookfr') : view === 'map' ? !!MAPX?.m && !!MAPX.node && main.querySelector('#mapc') === MAPX.node : false);
function render() {
  const keepY = scrollY;
  if (formGuard()) return;
  const { view, arg, fam } = route();
  if (canonicalView(view) !== view) { location.replace('#' + (fam === 'duong' ? '' : '/' + fam + '/') + canonicalView(view)); return; } // #gio goes to Lịch
  if ((location.hash === '' || location.hash === '#') && S.defaultFamily() !== 'duong') { location.hash = `/${S.defaultFamily()}/tree`; return; }
  if (fam === S.ALL_FAMS && (view === 'person' || view === 'sua')) { const pp = S.get(arg); if (pp?.fam) { location.replace(`#/${pp.fam}/${view}/${arg}`); return; } } // a person lives in one family
  if (fam !== S.ALL_FAMS && !NO_FAM.includes(view) && (S.getPrefs().fam_used || [])[0] !== fam) S.setPrefs({ fam_used: [fam, ...(S.getPrefs().fam_used || []).filter((x) => x !== fam)].slice(0, 8) });
  S.setFamily(fam);
  M = build(); chrome(); privNote(view, arg); refreshSugCount(); refreshFams(); refreshLichBadge();
  const key = mountKey(view, arg, fam);
  const kept = !!key && key === mounted && keptNode(view);
  // same page drawn again (a sync, families arriving): the focused text field gets its focus and caret back after
  const fa = document.activeElement;
  const refocus = render.hash === location.hash && fa?.id && main.contains(fa) && /^(INPUT|TEXTAREA)$/.test(fa.tagName)
    ? { id: fa.id, s: fa.selectionStart, e: fa.selectionEnd, v: fa.value } : null; // v: the text as typed (the new field is built from the last committed route value)
  render.hash = location.hash;
  const cvOld = main.querySelector('#cv'); const treePos = cvOld && key === mounted ? { l: cvOld.scrollLeft, t: cvOld.scrollTop } : null;
  mounted = null;
  if (view === 'tim-dong-ho') { location.replace('#/' + S.ALL_FAMS + '/tree'); return; } // old find-page link: the all-families tree
  if (!famGate(view)) return;
  const loadingNow = !S.isAll() && DATA_VIEWS.includes(view) && !S.hasData(fam) && S.loading(fam);
  const v = loadingNow ? skeleton : { consistency: (a) => CS.consistencyPage(main, { fam: S.curFamily(), hf }), relpath: (a) => RP.relpathPage(main, { hf, M, a, b: route().qs.get('b') || '' }), tree, list: listView, person, lich: gio, verify, tin: (a) => (a ? NW.detailPage(main, { fam: S.curFamily(), hf, id: a, getPrefs: S.getPrefs, setPrefs: S.setPrefs, isMember: S.isMember() }) : NW.feedPage(main, { fam: S.curFamily(), hf, getPrefs: S.getPrefs, setPrefs: S.setPrefs, isMember: S.isMember() })), 'tin-sua': (a) => NW.editorPage(main, { fam: S.curFamily(), hf, id: a, kind: route().qs.get('kind') === 'gathering' ? 'gathering' : 'notice' }), map, stats, settings, export: exportView, more, book: bookLink, review, members, join, mine, 'gop-y': gopyOpen, 'cai-dat-dong-ho': famSettings, 'su-kien': eventPage, 'bieu-quyet': () => CN.decisionsPage(main, { fam: S.curFamily() }), 'thung-rac': () => TR.trashPage(main, { fam: S.curFamily(), isAdmin: S.isAdmin() }), 'nguoi-ke-nhiem': successionPage, 'vai-tro': rolesPage, 'doi-chi': statsGenPage, 'cach-goi': kinRegionView, 'tai-khoan': () => accountPage(main, { qs: route().qs, sub: route().arg, icon }), 'dang-nhap-2fa': () => twoStepPage(main), place: (a) => PL.placePage(main, a, { fam: S.curFamily(), personOf: (x) => M.byId.get(x), personHref: (x) => hf(`person/${x}`), nameOf: (pp) => `${rank(pp.data)} ${pp.data.name}`.trim() }), ho: (a) => CL.clanPage(main, a, { page: Number(route().qs.get('trang')) || 1, country: route().qs.get('qg') || '' }), sua: formPage, them: formPage, offer: (a) => SUC.offerView(a), trusted: (a) => SUC.trustedView(a), 'lap-gia-pha': () => SUC.createView(), 'nhan-quan-ly': () => CLM.reviewPage(main) }[view] || tree;
  // all-families tree (the family list): a same-route re-render (a sync) keeps the list on screen until the new one is painted
  const cayHere = S.isAll() && view === 'tree' && !!main.querySelector('#flist') && !!main.querySelector('#fq');
  if (kept) { if (view === 'map') { mapFilterOpts(); paintMap(); } } // the book iframe and the map stay as they are
  else {
    setUntag(null); if (!cayHere) main.innerHTML = ''; main.classList.remove('bookm'); main.classList.toggle('wide', view === 'tree' && isDesk() && (localStorageGet('gp_tmode') || 'chart') === 'chart' || view === 'map');
    treeKeep = treePos; v(arg); treeKeep = null;
  }
  mounted = key;
  if (view === 'book') bookBar();
  if ((view === 'more' || view === 'review') && S.isEditor() && !S.isAll()) TR.decorate(view, main, { fam: S.curFamily(), hf });
  // Guests have no decisions (the API needs a member): no request from a guest's person or Thùng rác page (cold-load 401).
  if (S.isMember() && !S.isAll()) CN.decorate(view, main, { fam: S.curFamily(), hf, personId: route().arg });
  if (view === 'cai-dat-dong-ho') NW.decorateSettings(main, S.curFamily());
  if (view === 'tree' && !S.isAll()) CLM.decorate(main, { fam: S.curFamily() }); // Nhận quản lý banner (claim.js)
  { const h = main.querySelector(':scope > h1, :scope > .row > h1'); const n = NAV.find((x) => x[0] === (view === 'person' ? 'list' : view)); const pp = view === 'person' && M.byId.get(arg); $('#cbtitle').textContent = pp ? 'Hồ sơ' : h ? h.textContent : n ? n[1] : view === 'more' ? 'Thêm' : ''; }
  famBar();
  SUC.succBar();
  const back = refocus && document.getElementById(refocus.id);
  if (timFocus) { timFocus = false; $('#q')?.focus({ preventScroll: true }); } // "/" lands in the Tìm field
  else if (back && /^(INPUT|TEXTAREA)$/.test(back.tagName)) {
    back.focus({ preventScroll: true });
    // the text typed since the last committed value is kept; one input event re-filters the page for it
    if (back.value !== refocus.v) { back.value = refocus.v; back.dispatchEvent(new Event('input')); }
    try { back.setSelectionRange(refocus.s, refocus.e); } catch { /* type=search etc. */ }
  }
  else main.focus({ preventScroll: true });
  { const key = ['list', 'tree'].includes(view) && !/^@/.test(arg) ? view : location.hash; if (key !== render.last) { render.last = key; if (!/^@/.test(arg)) scrollTo(0, 0); } else if (!/^@/.test(arg)) scrollTo(0, keepY); }
  stripTitles();
  setTimeout(() => acShow(), 0);
}

// #tree tree-cards (owner 2026-11-24): the list continues up (clan, linked upper tree) and down (lower trees), see clan.js.
const treeRootIds = () => new Set(M.roots.map((r) => r.id));
const tierOpen = () => localStorageGet('gp_tier') === '1';
const nmOf = (p) => `${rank(p.data)} ${p.data.name}`.trim();
// Rows above the root, breadcrumb-overflow style: always TOÀN CẦU (clan), QUỐC GIA (when known) and the nearest upper
// tree right above our root; levels between them fold into one "Hiện thêm N tầng" row (remembered in gp_tier).
// Deeper upper trees are reached by navigating, not stacked.
function upperCards() {
  const f = S.curFamily(); LK.ensure(f); const name = S.familyName(f); const surname = CL.familySurname(name);
  if (!surname) return { html: '', any: false };
  const country = S.familyMeta(f)?.country || ''; const clanOk = CL.inClan(name, country); // a non-VN tree has no clan: no TOÀN CẦU / QUỐC GIA rows
  const meta = (clanOk && CL.clanMeta(name, renderSoon, country)) || { trees: 0, han: '' };
  const up = LK.upLinkOf(f, treeRootIds()); const upP = up && M.byId.get(up.person);
  const head = clanOk ? [{ kind: 'Toàn cầu', title: `Họ ${surname}`, sub: meta.trees ? `${meta.trees} cây` : '', href: CL.clanHref(name, country), style: 'dot', why: '', tile: surnameTileOf(surname) }] : [];
  // QUỐC GIA: this tree's country (Cài đặt dòng họ), else the clan's most common one; shown whenever any tree has one
  const qgs = (meta.countries || []).filter((c) => c.code !== 'NONE');
  const mine = country; const qg = clanOk && ((mine && qgs.find((c) => c.code === mine)) || (mine ? { code: mine, trees: 1 } : qgs[0]));
  if (qg) head.push({ kind: 'Quốc gia', title: `Họ ${surname} · ${countryName(qg.code)}`, han: meta.han, sub: `${qg.trees} cây`, href: `${CL.clanHref(name, country)}?qg=${qg.code}`, style: 'dot', why: 'nhóm theo họ' });
  const middle = []; // levels between the nation and the nearest upper tree (none known yet: one link is followed)
  const near = up && upP ? [{ kind: 'Cây trên', title: up.other_label, sub: [up.other_name, up.other_years].filter(Boolean).join(' · '), href: LK.treeHref(up.other_family, up.other_person), style: 'dot', why: 'nhóm theo họ', tile: surnameTileOf(surname) }] : [];
  const toRoot = near.length ? { style: 'solid', why: `${up.other_parents.map((x) => x.name).join(' và ')} là ${up.other_parents.length > 1 ? 'cha mẹ' : 'cha/mẹ'} của ${nmOf(upP)}` } : { style: 'dot', why: 'cùng họ, chưa nối người' };
  const open = tierOpen();
  const toggle = middle.length ? `<button type="button" class="tmore" data-tier-more aria-expanded="${open}">${open ? 'Ẩn bớt' : `Hiện thêm ${middle.length} tầng`}</button>` : '';
  const cards = [...head, ...(open ? middle : []), ...near];
  return { any: true, html: head.map((c) => CL.treeCardHtml(c)).join('') + toggle + cards.slice(head.length).map((c) => CL.treeCardHtml(c)).join('')
    + `<div class="tgen tlk tl-${toRoot.style}" style="--d:0"><span>Cây này</span><span class="tlk-why">${esc(toRoot.why)}</span></div>` };
}
// Rows inside the list for a person: "↓ Cây …" (they founded a linked lower tree), and the spouse's birth tree.
const lowerCards = (p, depth) => LK.downLinksOf(S.curFamily(), p.id).filter((l) => !l.other_inlaw).map((l) => CL.treeCardHtml({ depth: depth + 1, style: 'solid', kind: 'Cây dưới', why: `${nmOf(p)} là thủy tổ`, title: `↓ ${l.other_label}`, href: LK.treeHref(l.other_family, l.other_person), tile: surnameTile(l.other_name) })).join('');
const spouseTree = (s, depth) => {
  if (!s.id) return '';
  const l = LK.linksOf(S.curFamily(), s.id).find((x) => x.status === 'accepted'); if (!l) return '';
  const q = M.byId.get(s.id); const w = q?.data.sex === 'f' ? 'Dâu' : q?.data.sex === 'm' ? 'Rể' : 'Dâu/rể';
  return `<a class="tsp-x" style="--d:${depth}" href="${esc(LK.treeHref(l.other_family, l.other_person))}">${w} từ ${esc(l.other_label)} ›</a>`;
};
function maybeCards() {
  if (!S.isEditor()) return '';
  const seen = new Set(); const out = [];
  for (const h of CL.matchHints(S.curFamily(), renderSoon)) {
    if (seen.has(h.other_family) || out.length >= 2) continue; seen.add(h.other_family);
    out.push(CL.treeCardHtml({ depth: 0, style: 'dash', maybe: true, kind: 'Có thể liên quan', why: `có thể cùng người (khớp ${Math.round(h.score * 100)}%)`, title: h.other_label, sub: `${h.name} ↔ ${h.other_name} · chưa xác nhận`, href: LK.treeHref(h.other_family, h.other_person), tile: surnameTile(h.other_name) }));
  }
  return out.join('');
}

// ---------- tree (collapsible) ----------
// The tree's line legend, from the ⋯ menu: a sheet that closes with Đóng or an outside tap.
function treeLinesSheet() {
  document.body.insertAdjacentHTML('beforeend', fsheet('Ý nghĩa các đường nối', CL.treeLinesHelpHtml()));
  const d = document.body.lastElementChild;
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.showModal();
}
function tree(arg) {
  if (S.isAll()) { cayPage(); return; }
  const q = fold(arg || '').trim();
  const jump0 = arg.startsWith('@') ? arg.slice(1) : '';
  const inlawJump = M.byId.get(jump0)?.data.spouse_of ? jump0 : ''; // dâu / rể: show their spouse's place in the tree
  const jump = inlawJump ? M.byId.get(jump0).data.spouse_of : jump0;
  const mode = localStorageGet('gp_tmode') || 'chart';
  if (isDesk() && mode === 'chart' && !(q && !jump)) return treeDesk(jump);
  const chi = S.getPrefs().filters?.chi || '';
  const branches = branchesOf(M);
  BT.ensureInfo(S.curFamily()); BT.ensureBranches(S.curFamily());
  main.innerHTML = `<h1 class="vh">Cây gia phả</h1>${BT.bannerHtml(S.curFamily())}
    ${soonBanner()}${toolbar({ id: 'q', ph: 'Tìm trong cây', val: jump ? '' : arg, active: chi ? 1 : 0, extra: `${isDesk() ? '<span class="seg"><button id="mchart">Sơ đồ</button><button class="on" id="mlist">Danh sách</button></span>' : ''}${iconButton({ icon: 'more', label: 'Tùy chọn cây', attrs: 'id="tmore" aria-haspopup="menu"' })}` })}
    ${ltags(chi && M.byId.get(chi) ? [['chi', 'Chi ' + rank(M.byId.get(chi).data) + ' ' + M.byId.get(chi).data.name]] : [])}
    ${fpanel(`<label>Chi<select id="chi"><option value="">Cả họ</option>${branches.map((b) => `<option value="${b.id}" ${b.id === chi ? 'selected' : ''}>Chi ${esc(rank(b.data))} ${esc(chiName(b.data.name))}</option>`).join('')}</select></label>`)}
    <div class="tree" id="tr"></div>`;
  setUntag(() => { setChi(''); render(); });
  $('#mchart')?.addEventListener('click', () => { localStorageSet('gp_tmode', 'chart'); render(); });
  if (jump) { let p = M.byId.get(jump); while (p) { open.add(p.id); p = M.byId.get(p.data.parent); } saveOpen(); }
  const hits = q && !jump ? new Set(M.all.filter((p) => fold(p.data.name + ' ' + (p.data.alias || '')).includes(q)).map((p) => baseOf(M, p).id)) : jump ? new Set([jump]) : null;
  const show = new Set();
  if (hits) for (const id of hits) { let p = M.byId.get(id); while (p) { show.add(p.id); p = M.byId.get(p.data.parent); } }
  if (hits) for (const id of hits) for (const c of M.kids(id)) { show.add(c.id); open.add(id); for (const g of M.kids(c.id)) { show.add(g.id); open.add(c.id); } }
  const out = []; const plain = !chi && !hits; const up = plain ? upperCards() : { html: '', any: false };
  if (up.html) out.push(up.html);
  const walk = (p, depth) => {
    if (show.size && !show.has(p.id)) return;
    const ks = M.kids(p.id); const isOpen = hits && !jump ? true : open.has(p.id) || depth < 2 && !open.has('!' + p.id);
    const d = p.data;
    const sub = [depth ? '' : 'Đời ' + (d.gen || '?'), yearsHtml(d), d.gio_lunar || d.death_lunar ? 'Giỗ ' + esc(d.gio_lunar || d.death_lunar) + ' ÂL' : ''].filter(Boolean).join(' · ');
    const toggle = ks.length ? `<button class="tg ${isOpen ? 'op' : ''}" data-tg="${p.id}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Đóng' : 'Mở'} nhánh">${isOpen ? '−' : '+' + ks.length}</button>` : '';
    out.push(personItem({ rank: d.hidden_living ? '' : rank(d), name: nameOf(d), sex: d.sex }, { variant: 'tree', depth, href: hf(`person/${p.id}`), hit: !!hits?.has(p.id), badge: d.name_han ? ` <span class="nhan" lang="zh-Hant">${esc(d.name_han)}</span>` : '', sub, action: toggle }));
    for (const s of (M.inlaws(p.id).length ? M.inlaws(p.id).map((q) => ({ n: q.data.spouse_n, name: q.data.name, note: years(q.data), id: q.id })) : spousesOf(d))) out.push(`<${s.id ? 'a href="' + hf('person/' + s.id) + '"' : 'div'} class="tsp${s.id && s.id === inlawJump ? ' hit' : ''} ${d.sex === 'f' ? 'm' : 'f'}" style="--d:${depth}"><span class="tsl">${d.sex === 'f' ? 'Chồng' : 'Vợ'}${spousesOf(d).length > 1 ? ' ' + s.n : ''}</span><b>${esc(s.name)}</b>${s.note ? `<span class="sub">${esc(s.note)}</span>` : ''}</${s.id ? 'a' : 'div'}>` + (plain ? spouseTree(s, depth) : ''));
    if (plain) out.push(lowerCards(p, depth));
    if (isOpen && ks.length) out.push(`<div class="tgen" style="--d:${depth + 1}">Đời ${(d.gen || 0) + 1} · ${ks.length} người con</div>`);
    if (isOpen) for (const c of ks) walk(c, depth + 1);
  };
  const startAt = chi && M.byId.get(chi) ? [M.byId.get(chi)] : M.roots;
  if (chi) open.add(chi);
  for (const r of startAt) walk(r, 0);
  if (plain) out.push(maybeCards());
  const html = out.join('');
  $('#tr').innerHTML = html || '<p class="sub">Không tìm thấy.</p>';
  $('#tr').querySelector('[data-tier-more]')?.addEventListener('click', () => { localStorageSet('gp_tier', tierOpen() ? '0' : '1'); render(); });
  $('#chi').onchange = (e) => { setChi(e.target.value); render(); };
  $('#tmore').onclick = (e) => { e.stopPropagation(); popMenu(e.currentTarget, [['Mở hết', () => { M.ps.forEach((p) => M.kids(p.id).length && open.add(p.id)); saveOpen(); render(); }], ['Đóng hết', () => { open.clear(); saveOpen(); render(); }], ['Ý nghĩa các đường nối', treeLinesSheet], ...(S.isEditor() ? [['Thêm người', () => startAdd({})]] : [])], '<span class="dot m"></span> Nam · <span class="dot f"></span> Nữ · <b class="badge">+6</b> nhánh đóng'); };
  if (jump) { const el = $(inlawJump ? '#tr .tsp.hit' : '#tr .tn.hit'); el?.scrollIntoView({ block: 'center' }); }
  $('#q').oninput = (e) => { clearTimeout(tree.t); tree.t = setTimeout(() => { history.replaceState(null, '', hf('tree/' + encodeURIComponent(e.target.value))); render(); const i = $('#q'); i.focus({ preventScroll: true }); const v = i.value; i.setSelectionRange(v.length, v.length); }, 250); };
}
const saveOpen = () => localStorageSet('gp_open', JSON.stringify([...open]));
main.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tg]'); if (t) { const id = t.dataset.tg; const wasOpen = t.classList.contains('op') || t.getAttribute('aria-expanded') === 'true'; if (wasOpen) { open.delete(id); open.add('!' + id); } else { open.add(id); open.delete('!' + id); } saveOpen(); render(); return; }
  const a = e.target.closest('[data-act]'); if (a) { act(a.dataset.act, a.dataset.id); return; }
  const ce = e.target.closest('[data-ct-edit]'); if (ce) { const p = M.byId.get(ce.dataset.ctEdit); if (p) goForm({ kind: 'sua', p, open: 'lien' }); return; }
  if (e.target.closest('[data-contact-import-fam]')) { openContactImport({ fam: S.curFamily(), done: render }); return; }
  const add = e.target.closest('[data-add]'); if (add) { addFromBar(add.dataset.add); return; }
  const mn = e.target.closest('[data-menu]'); if (mn) { rowMenu(mn.dataset.menu, mn, mn.dataset.menuCtx); }
});

// The toolbar "+" on Tìm, Giỗ and Bản đồ: a new person, prefilled from the page's filters and search (web/js/prefill.js).
// A search that matched no name, alias or place becomes the name; everything stays editable until Lưu / Gửi góp ý.
function addFromBar(kind) {
  const hit = (q) => nameHit(M.all.flatMap((p) => [p.data.name, p.data.alias || '', p.data.place || '']), q);
  if (kind === 'gio') { const q = $('#gq')?.value || ''; const prefill = gioPrefill({ q, qMatched: hit(q) }); return startAdd({ prefill, title: 'Thêm người đã mất', q: prefill.gio_lunar ? '' : q }); }
  if (kind === 'map') { const q = MF.qRaw || ''; return startAdd({ prefill: listPrefill({ gen: MF.gen, living: MF.living, place: mapSel || '', q, qMatched: hit(q) }), q }); }
  const F = listView.f || {}; const q = $('#q')?.value || '';
  return startAdd({ prefill: listPrefill({ gen: F.gen, living: F.living, q, qMatched: hit(q) }), q });
}
// Every "add new person" entry point (toolbar +, the tree's Thêm người, add relative): step 1 search, then the basic
// form with the duplicate check (web/js/addflow.js). In "Tất cả" the full form still asks for the family first.
// onPicked(id, how): the person used or created (how: 'existing' | 'created'), or null for a suggestion.
function startAdd({ prefill = {}, title = 'Thêm người', q = '', onPicked = openAfterAdd }) {
  if (S.isAll()) return goForm({ kind: 'them', prefill, title });
  return addSearch({ fam: S.curFamily(), people: M.all, q, prefill, title, onPicked, model: { people: M.ps, byId: M.byId } });
}
function openAfterAdd(id) { location.hash = id ? hf(`person/${id}`) : hf('mine'); }

// ---------- list with row actions ----------
function listView(arg) {
  const q = fold(arg || '').trim();
  const F = listView.f || (listView.f = { gen: '', flag: false, living: false, chi: '', fam: '' });
  // Default set = everyone (people married in too); Chi, Đời, Còn sống and Cần xác minh narrow it.
  const gd = giaDateQuery(arg || ''); // "3/8", "mồng 3 tháng 8": giỗ on that lunar day and month (the giỗ page's gioOf)
  const cq = codeQuery(arg || ''); // "D-3.2.1" or "D-3.2" (see web/js/codes.js)
  const sq = normalizeSid(arg || ''); const sidHits = sq ? M.all.filter((p) => p.data.sid === sq) : []; // stable ID "D7K2-QX3"
  const hitIds = q ? new Set((sidHits.length ? sidHits : cq ? M.all.filter((p) => matchCode(codeOf(M, p.id), cq)) : gd ? M.all.filter((p) => { const g = gioOf(p.data); return g && g.d === gd.d && g.m === gd.m; }) : searchPeople(M.all, arg || '', { all: true })).map((p) => p.id)) : null;
  const rows = M.everyone.filter((p) => (!q || hitIds.has(p.id) || (!gd && fold(p.data.place || '').includes(q)))
    && (!F.gen || String(genOf(M, p)) === F.gen) && (!F.flag || p.data.verify) && (!F.living || !isDead(p.data)) && inChi(M, p, F.chi) && (!F.fam || p.fam === F.fam));
  const gens = [...new Set(M.all.map((p) => genOf(M, p)).filter(Boolean))].sort((a, b) => a - b);
  const branches = branchesOf(M);
  main.innerHTML = `<h1>Tìm</h1>
   ${toolbar({ id: 'q', ph: 'Tìm tên, tên khác, nơi sống, mã', val: arg, active: [F.chi, F.gen, F.living, F.flag, F.fam].filter(Boolean).length, quick: multiFam() ? famSelect('ffam', F.fam) : '', add: addBtn('data-add="list"', 'Thêm người') })}
   ${ltags([F.fam && ['fam', 'Dòng họ: ' + S.familyLabel(F.fam)], F.chi && ['chi', 'Chi ' + (M.byId.get(F.chi)?.data.name || '')], F.gen && ['gen', 'Đời ' + F.gen], F.living && ['living', 'Còn sống'], F.flag && ['flag', 'Cần xác minh']].filter(Boolean))}
   <p class="sub lcount">${rows.length} / ${M.all.length} người</p>
   ${arg && !rows.length ? `<p class="sub lempty">Không thấy “${esc(String(arg).trim())}”. Bấm + để thêm người này.</p>` : ''}
   ${fpanel(`${multiFam() ? `<label>Dòng họ${famSelect('ffamp', F.fam)}</label>` : ''}<label>Chi<select id="fchi"><option value="">Mọi chi</option>${branches.map((b) => `<option value="${b.id}" ${F.chi === b.id ? 'selected' : ''}>Chi ${esc(chiName(b.data.name))}</option>`).join('')}</select></label>
   <label>Đời<select id="fgen"><option value="">Mọi đời</option>${gens.map((g) => `<option ${String(g) === F.gen ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
   <div class="row wrap">${tag('Còn sống', { kind: 'chip', on: F.living, attrs: 'id="fliv"' })}${tag('Cần xác minh', { kind: 'chip', on: F.flag, attrs: 'id="fflag"' })}</div>`)}
   ${isWide() ? `<div class="kpis lk">${[['Tổng số', M.all.length, 'ia'], ['Nam / Nữ', M.all.filter((p) => p.data.sex !== 'f').length + ' / ' + M.all.filter((p) => p.data.sex === 'f').length, 'c2'], ['Có ngày giỗ', M.all.filter((p) => gioOf(p.data)).length, 'c3'], ['Cần xác minh', M.all.filter((p) => p.data.verify).length, 'warn']].map(([l, v, c]) => `<div class="kpi" style="border-top-color:var(--${c})"><span class="sub">${l}</span><b>${v}</b></div>`).join('')}</div>` : ''}
   ${!isWide() ? `<div class="cards">${rows.slice(0, 400).map((p) => { const d = p.data; return personItem({ rank: d.hidden_living ? '' : rank(d), name: nameOf(d), sex: d.sex }, { variant: 'card', href: ph(p, `person/${p.id}`), flag: !!d.verify, badge: famChipIf(p), sub: `${sidHits.length && d.sid ? esc(formatSid(d.sid)) + ' · ' : cq && codeOf(M, p.id) ? esc(codeOf(M, p.id)) + ' · ' : ''}${gd ? `Giỗ ${esc(gioOf(d).label)} ÂL` : `${d.hidden_living && !genOf(M, p) ? '' : `Đời ${genOf(M, p) || '?'}`}${years(d) ? ' · ' + yearsHtml(d) : ''}${d.place ? ' · ' + esc(d.place) : ''}`}`, foot: d.verify ? `${tag(`${esc(d.verify)}`, { tone: 'yellow', sm: true })}` : '', action: iconButton({ icon: 'more', label: 'Thao tác', attrs: `data-menu="${p.id}" aria-haspopup="menu"` }) }); }).join('')}</div>` : `<div class="scroll"><table class="tb"><thead><tr><th></th><th>Đời</th><th>Họ tên</th><th>Cha/Mẹ</th><th>Sinh</th><th>Mất</th><th>Giỗ ÂL</th><th>Nơi sống</th><th>Cần xác minh</th><th>Thao tác</th></tr></thead><tbody>
   ${rows.map((p) => { const d = p.data; const par = M.byId.get(d.parent); return `<tr class="${d.verify ? 'flag' : ''}"><td>${sexMark(d.sex)}</td><td class="num">${genOf(M, p) || ''}</td>
   <td><a href="${ph(p, `person/${p.id}`)}"><b>${d.hidden_living ? esc(nameOf(d)) : `${esc(rank(d))} ${esc(d.name)}`}</b></a>${famChipIf(p)}</td><td>${esc(par?.data.name || '')}</td><td class="num">${esc(d.born || '')}</td><td class="num">${esc(d.died || '')}</td><td class="num">${esc(d.gio_lunar || d.death_lunar || '')}</td><td>${esc(d.place || '')}</td><td>${esc(d.verify || '')}</td>
   <td class="acts">${S.isEditor() ? `${iconButton({ icon: 'pencil', label: 'Sửa', attrs: `data-act="edit" data-id="${p.id}"` })}${iconButton({ icon: 'plus', label: 'Thêm con', attrs: `data-act="child" data-id="${p.id}"` })}` : ''}${iconButton({ icon: 'more', label: 'Thao tác', attrs: `data-menu="${p.id}" aria-haspopup="menu"` })}</td></tr>`; }).join('')}
   </tbody></table></div>`}`;
  $('#q').oninput = (e) => { clearTimeout(listView.t); listView.t = setTimeout(() => { history.replaceState(null, '', hf('list/' + encodeURIComponent(e.target.value))); render(); const i = $('#q'); i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $('#fchi').onchange = (e) => { F.chi = e.target.value; render(); };
  for (const id of ['#ffam', '#ffamp']) $(id)?.addEventListener('change', (e) => { F.fam = e.target.value; render(); }); $('#fgen').onchange = (e) => { F.gen = e.target.value; render(); };
  $('#fliv').onclick = () => { F.living = !F.living; render(); }; $('#fflag').onclick = () => { F.flag = !F.flag; render(); };
  setUntag((k) => { if (k === '*') Object.assign(F, { chi: '', gen: '', living: false, flag: false, fam: '' }); else F[k] = k === 'living' || k === 'flag' ? false : ''; render(); });
}
// ctx 'prof': the ⋯ on the profile, which leaves out what the page already shows (Xem hồ sơ and the Sửa button). The
// add-relative items come from profRelItems below. List rows keep every item.
// The profile ⋯ adds relatives only where Quan hệ cannot: in a legacy-relations family the Quan hệ card is read-only,
// so Thêm con / anh chị em / cha mẹ go through the same search-first add flow as the list row. In a relation-table family
// Quan hệ already adds them (its "+"), so the menu leaves them out.
function profRelItems(p) {
  return relTable(p.fam || S.curFamily()) ? [] : [['parent', 'Thêm cha / mẹ'], ['child', 'Thêm con'], ['sibling', 'Thêm anh chị em']];
}
function rowMenu(id, anchor, ctx = '') {
  const p = M.byId.get(id); const ed = S.isEditor(); const prof = ctx === 'prof';
  const items = [...(prof ? [] : [['view', 'Xem hồ sơ']]), ['treeview', 'Xem trên cây'], ...(gioOf(p.data) ? [['ics', 'Thêm vào lịch']] : []), ...(S.isMember() && !S.isAll() ? [['gedcom', 'Xuất nhánh (GEDCOM)']] : []), ...(S.isAdmin() && !S.isAll() && !BT.isBranch(S.curFamily()) ? [['branch', 'Tạo cây cho nhánh này']] : []), ['history', 'Lịch sử sửa'],
    ...(S.signedIn() ? elder.MENU_ITEMS : []),
    ...(ed ? [...(prof ? profRelItems(p) : [['edit', 'Sửa thông tin'], ['parent', 'Thêm cha / mẹ'], ['child', 'Thêm con'], ['spouse', 'Thêm vợ / chồng'], ['sibling', 'Thêm anh chị em']]), ['xlink', 'Liên kết với người ở cây khác'], ['xvar', 'Thêm giá trị từ nguồn khác'], ['flag', 'Đánh dấu cần xác minh'], ['delete', dangerLabel('Gỡ khỏi gia phả…')]]
      : [...(prof ? [] : [['suggest', 'Sửa']]), ['login', 'Đăng nhập để sửa']])];
  popMenu(anchor, items.map(([k, l]) => [l, () => act(k, id), k === 'delete', { 'data-act': k, 'data-id': id, ...(k === 'delete' ? { 'data-danger': '' } : {}) }]), '', { title: `${rank(p.data)} ${p.data.name}` });
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu({ focus: true }); closeSheets(); } });

function act(k, id) {
  const p = M.byId.get(id);
  if (k === 'view') location.hash = hf('person/' + id);
  else if (k === 'treeview') { setChi(''); location.hash = hf('tree/@' + id); }
  else if (k === 'ics') { const a = document.createElement('a'); a.href = calUrl([id]); a.download = `gio-${id}.ics`; a.click(); }
  else if (k === 'gedcom') gedBranch(id, p.fam || S.curFamily());
  else if (k === 'branch') BT.openCreate({ fam: S.curFamily(), personId: id, personName: p.data.name, done: () => renderSoon() });
  else if (k === 'history') historyDialog(id);
  else if (k === 'login') loginDialog();
  else if (elder.MENU_ITEMS.some(([x]) => x === k)) elder.personAct(k, id);
  else if (k === 'edit') goForm({ kind: 'sua', p });
  else if (k === 'suggest') goForm({ kind: 'sua', p });
  // a relation-table family: no legacy parent / spouse field on the new person (the server refuses it); the relation sets it
  else if (['child', 'sibling', 'parent', 'spouse'].includes(k) && relTable(p.fam || S.curFamily()))
    addNewRelated(M, id, k, k === 'child' ? { order: (M.kids(id).at(-1)?.data.order ?? p.data.order ?? 0) + 0.5 } : k === 'sibling' ? { order: (p.data.order ?? 0) + 0.5 } : {});
  else if (k === 'child') startAdd({ prefill: { parent: id, gen: (p.data.gen || 0) + 1, order: (M.kids(id).at(-1)?.data.order ?? p.data.order ?? 0) + 0.5 }, title: `Thêm con của ${p.data.name}`,
    onPicked: (pid, how) => { if (pid && how === 'existing') S.edit(pid, { parent: id }); openAfterAdd(pid); } });
  else if (k === 'sibling') startAdd({ prefill: { parent: p.data.parent || '', gen: p.data.gen, order: (p.data.order ?? 0) + 0.5 }, title: `Thêm anh chị em của ${p.data.name}`,
    onPicked: (pid, how) => { if (pid && how === 'existing' && p.data.parent) S.edit(pid, { parent: p.data.parent }); openAfterAdd(pid); } });
  else if (k === 'spouse') goForm({ kind: 'sua', p, only: ['spouse', 'married'], title: `Vợ / chồng của ${p.data.name}` });
  else if (k === 'parent') startAdd({ prefill: { parent: p.data.parent || '', order: p.data.order ?? 0 }, title: `Thêm cha / mẹ của ${p.data.name}`,
    onPicked: (pid) => { if (pid) S.edit(id, { parent: pid }); openAfterAdd(pid); } });
  else if (k === 'xlink') { const fam = p.fam || S.curFamily(); LK.openSheet({ fam, personId: id, personName: p.data.name, families: S.scopeFams().filter((f) => f !== fam).map((f) => ({ id: f, label: S.familyLabel(f) })), done: render }); }
  else if (k === 'xvar') VR.openAdd({ fam: p.fam || S.curFamily(), personId: id, personName: p.data.name, done: () => { S.sync(); renderSoon(); } });
  else if (k === 'flag') { const why = prompt2('Cần xác minh điều gì?', p.data.verify || '', (v) => S.edit(id, { verify: v })); }
  else if (k === 'delete') CN.openRemoval({ p, fam: famOfP(p), onDone: async () => { await S.sync(); render(); } });
}

// ---------- person ----------
function person(id) {
  const p = M.byId.get(id); if (!p) { main.innerHTML = '<p>Không tìm thấy người này.</p>'; return; }
  if (profFor !== id) { profFor = id; profTab = 'info'; }
  if (p.data.hidden_living) { main.innerHTML = `<section class="card"><h1 class="keep">${esc(nameOf(p.data))}</h1></section>`; return; } // a living person (visitor view): the label only, no data
  const d = p.data; const sp = d.spouse_of && M.byId.get(d.spouse_of); const ks = sp ? (M.kidsOf2(id).length || M.inlaws(sp.id).length > 1 ? M.kidsOf2(id) : M.kids(sp.id)) : M.kids(id); const br = branchOf(M, sp || p);
  const row = (k, v) => (v ? [k, v] : null); // one fact: [label, value html], or null when empty
  const loc = locate(d);
  const plo = { editable: S.isEditor(), placeHref: (x) => hf(`place/${x}`) }; PL.ensure(p.fam || S.curFamily(), id); // place links (shared gazetteer)
  VR.ensure(p.fam || S.curFamily(), id); const vt = (k) => VR.tag(id, k); // "N nguồn khác nhau" (conflicting data)
  // Facts: one card (facts.js). Life basics (Sinh, Mất) sit under "Tóm tắt"; the other groups keep their own labels.
  const bornHint = bornHintShown({ born: d.born, dead: isDead(d), member: S.isMember() }, new Date().getFullYear());
  const groups = [
    { title: 'Sinh', basic: true, rows: [
      row('Sinh', esc([d.birth_date || d.born, d.birth_lunar && d.birth_lunar + ' ÂL'].filter(Boolean).join(' · ')) + (bornHint ? ' <span class="sub">(ngày sinh chỉ hiện khi đăng nhập)</span>' : '') + (d.born || d.birth_date ? vt('born') : '')),
      row('Nơi sinh', d.birth_place ? PL.fieldHtml(id, 'birth_place', d.birth_place, plo) + vt('birth_place') : '')] },
    { title: 'Mất', basic: true, rows: [
      row('Mất', d.died || d.death_lunar ? esc([d.died, d.death_lunar && d.death_lunar + ' ÂL'].filter(Boolean).join(' · ')) + vt('died') : ''),
      row('Giỗ', d.gio_lunar ? esc(d.gio_lunar) + ' ÂL' : ''),
      row('An táng', d.burial ? PL.fieldHtml(id, 'burial', d.burial, plo) + vt('burial') : '')] },
    { title: 'Nơi sống & nghề', rows: [
      row('Nơi sống', d.place ? PL.fieldHtml(id, 'place', d.place, { ...plo, extra: loc ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lon}" target="_blank" rel="noopener">Google Maps</a>` : '' }) + vt('place') : ''),
      row('Nghề', esc(d.job)),
      row('Tôn giáo', esc(d.religion))] },
    { title: 'Ghi chú & nguồn', rows: [row('Ghi chú', esc(d.note)), row('Nguồn', esc(d.source))] }];
  const surnG = SN.surnameGroup(id, d, M, { editor: S.isEditor() }); if (surnG) groups.splice(groups.length - 1, 0, surnG); // Họ qua các thời kỳ, before Ghi chú
  main.innerHTML = `<div class="prof">${d.photo ? `<img src="${esc(d.photo)}" alt="" class="photo">` : ''}<div><div class="row wrap">${sp ? `${tag(`${esc(inLaw(p))}`, { tone: 'purple' })}` : `${tag(`Đời ${d.gen || '?'}`, { tone: 'blue' })}`}${SEX_LABEL[d.sex] ? `<span class="tag gray sxtag">${sexMark(d.sex)}${SEX_LABEL[d.sex]}</span>` : ''}${d.sid ? `<button type="button" class="tag gray pcode" data-copy-code="${esc(formatSid(d.sid))}" title="${esc(SID_HELP)} Bấm để chép." aria-label="Mã người ${esc(formatSid(d.sid))}. Bấm để chép.">${esc(formatSid(d.sid))}</button>` : ''}${br ? `${tag(`Chi ${esc(rank(br.data))} ${esc(br.data.name)}`, { tone: 'gray' })}` : ''}${S.myPersonId() === id ? '<span class="tag green">Đây là bạn</span>' : ''}</div>
   <h1 class="big keep">${esc(rank(d))} ${esc(d.name)}</h1>${d.name_han ? `<div class="nhan nhan-h" lang="zh-Hant">${esc(d.name_han)}</div>` : ''}${vt('name') ? `<div class="var-name">${vt('name')}</div>` : ''}<div class="sub">${esc(sp ? (d.sex === 'm' ? 'chồng ' : 'vợ ') + rank(sp.data).toLowerCase() + ' ' + sp.data.name : relation(M, p))}${d.alias ? ' · ' + esc(d.alias) : ''}</div></div></div>
   <div class="kpis">${[['Mất', d.died || (d.death_lunar ? d.death_lunar + ' ÂL' : '—'), 'c2'], ['Giỗ (ÂL)', d.gio_lunar || d.death_lunar || '—', 'c3'], ['Con', ks.length, 'c5'], ['Cháu chắt', M.desc(sp ? sp.id : id) - ks.length, 'c1']].filter(([, v]) => v && v !== '—').map(([l, v]) => `<div class="kpi"><span class="sub">${l}</span><b>${esc(v)}</b></div>`).join('')}</div>
   <div class="row acts2"><div class="acts2-go">${gioOf(d) ? followBar(p) : ''}<button class="btn sm" data-act="${S.isEditor() ? 'edit' : 'suggest'}" data-id="${id}">${icon('pencil')}Sửa</button></div><button class="ib" data-menu="${id}" data-menu-ctx="prof" aria-label="Thêm thao tác">⋯</button></div>
   ${profTabsHtml()}
   ${!surnG && S.isEditor() ? SN.surnameAddBlock() : ''}
   ${profBody(p, { groups, id, d })}`;
  relWire(main, () => M);
  if (S.isEditor()) SN.bindSurnames(main, id, d, { edit: (pid, fields) => S.edit(pid, fields) });
  main.querySelector('[data-copy-code]')?.addEventListener('click', (e) => { const c = e.currentTarget.dataset.copyCode; (navigator.clipboard?.writeText(c) || Promise.reject()).then(() => toast(`Đã chép mã ${c}`), () => toast(`Mã người: ${c}`)); });
  if (profTab === 'life' || profTab === 'src' || profTab === 'info') evEnsure(p); // info: the Câu chuyện đời block reads the events too
  if (profTab === 'life') setUntag(lifeUntag);
}

// ---------- life events and stories: data, the Hồ sơ tabs and the timeline (Dòng đời) ----------
// Loaded per person (GET /api/events). Writes go to the server at once (editors) or as suggestions (everyone else).
const EVD = new Map(); const evPending = new Set();
const evKey = (fam, pid) => `${fam}|${pid}`;
const famOfP = (p) => p.fam || 'duong';
const personsOf = (fam) => M.all.filter((x) => (x.fam || 'duong') === fam);
const evDirect = (fam) => !modeOf(fam); // editors write at once; others send a suggestion
const evMemberOf = (fam) => isMemberRole(S.roleIn(fam));
const evNameOf = (fam) => { const names = new Map(personsOf(fam).map((x) => [x.id, x.data.name])); return (id) => names.get(id) || ''; };
const evPickList = (fam) => personsOf(fam).map((x) => ({ id: x.id, name: x.data.name, years: years(x.data), data: x.data })); // data: for the fuzzy picker
async function evLoad(fam, pid, force = false) {
  const k = evKey(fam, pid); const cur = EVD.get(k);
  if (!force && cur && cur.loaded) return cur;
  let j;
  try {
    const r = await fetch(`/api/events?family=${encodeURIComponent(fam)}&person=${encodeURIComponent(pid)}`, { cache: 'no-store' });
    j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Không tải được sự kiện.');
    S.evCacheSet(fam, pid, j); // kept on the device for offline reading
  } catch (e) {
    // no network: the last online read of this person, when there is one (writes not yet sent are drawn on top)
    if (!(e instanceof TypeError)) throw e;
    const c = await S.evCacheGet(fam, pid);
    if (!c) throw e;
    j = { ...c, cached: true };
  }
  const v = { ...j, loaded: true, at: Date.now() }; EVD.set(k, v); return v;
}
const evInvalidate = (fam, pid) => EVD.delete(evKey(fam, pid));
async function evApi(method, url, body) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, cache: 'no-store', body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Lỗi ' + r.status);
  return j;
}
const evOpId = () => 'ev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
// An event create or edit: sent now; when the network fails before the server answers, kept on the device (the outbox)
// with the same op_id, so the retry is applied once. The timeline draws it as "Chưa gửi" until it is on the server.
async function evWriteOrQueue(fam, personId, method, url, body, show) {
  const op_id = evOpId(); const full = { ...body, op_id };
  try { return await evApi(method, url, full); } catch (e) {
    if (!(e instanceof TypeError) || !S.hasOutbox()) throw e;
    await S.queueEv({ op_id, family: fam, person_id: personId, ts: Date.now(), ev: { method, url, body: full }, show });
    return { ok: true, queued: true, op_id };
  }
}
S.hooks.evSynced = (fam, pid) => { evInvalidate(fam, pid); evLoad(fam, pid, true).catch(() => {}).finally(() => { if (route().view === 'person') render(); }); };
// Queued writes of this person as timeline rows: an add is a new card; an edit shows the new values; both say "Chưa gửi".
function withPending(fam, pid, items) {
  let out = items.slice();
  for (const o of S.pendingEvs(fam, pid)) {
    const s = o.show; if (!s || s.kind !== 'event') continue;
    if (s.act === 'add') out.push({ ...s.item, id: 'pend-' + o.op_id, person_id: pid, pending: true });
    else if (s.act === 'edit') { const i = out.findIndex((x) => x.id === s.id); if (i >= 0) out[i] = { ...out[i], ...s.item, pending: true }; }
  }
  return out;
}
// Loads a person's events once per visit (30 s); the page is drawn again when they arrive.
function evEnsure(p) {
  const fam = famOfP(p); const k = evKey(fam, p.id); const cur = EVD.get(k);
  if (evPending.has(k) || (cur && cur.loaded && Date.now() - cur.at < 30000)) return;
  evPending.add(k);
  evLoad(fam, p.id, true).then(() => evPending.delete(k), (e) => { evPending.delete(k); EVD.set(k, { loaded: true, at: Date.now(), error: e.message, items: [], stories: [] }); })
    .finally(() => { if (route().view === 'person' && route().arg === p.id) render(); });
}
// The timeline's entries for one person: stored events + derived family events (when the family switch is on).
function lifeModel(p) {
  const fam = famOfP(p); const ev = EVD.get(evKey(fam, p.id));
  const member = evMemberOf(fam);
  const visible = (d) => canSeeEventsOf(d, { member, familyReadable: true });
  const dataOf = new Map(personsOf(fam).map((x) => [x.id, x.data]));
  const r = S.relOf(fam); const eventsOf = (id) => (EVD.get(evKey(fam, id))?.items || []);
  const rel = r.source === 'table' ? relAccess(relIndex(r.parent_child, r.couple)) : null;
  // One estimate for the whole family (memoized): read for this person only; relatives' undated years give no row.
  const fest = estimateFamilyCached(fam, dataOf, rel || legacyAccess(dataOf), { eventsOf, today: new Date().toISOString().slice(0, 10) });
  const derived = deriveLifeEvents(p.id, dataOf, { rel, visible, eventsOf });
  // No birth year (or a dead person without a death year): an estimated life window from the evidence. One estimate
  // for the whole family (memoized), read for this person.
  const d0 = p.data; const dead = !!(d0.died || d0.living === 'dead' || d0.gio_lunar || d0.death_lunar || ageAtDeathOf(d0.note));
  const known = birthIso(d0);
  const e0 = fest.get(p.id);
  const deadish = dead || !!(e0 && e0.ruleDead); // deceased by rule: born more than 110 years ago, no death
  const need = !known || (deadish && !d0.died);
  const est = need && e0 && !(e0.bornKnown && e0.diedKnown) && (e0.born || e0.died) ? e0 : null;
  const okEst = est && !est.conflict ? est : null;
  const window = okEst ? { from: known || okEst.from, to: deadish ? (d0.died ? String(okEst.died[0]) : okEst.to) : new Date().toISOString().slice(0, 10) } : null;
  // auto rows Sinh / Mất (ước tính): shown in Dòng đời, never written to born or died
  const estRows = estimatedLifeRows(p.id, est, eventsOf(p.id));
  const hist = historyRows(d0, HISTORY_ALL, { country: S.familyMeta(fam)?.country || 'VN', events: [...eventsOf(p.id), ...derived, ...estRows], window });
  const birth = known || (okEst ? okEst.from : null); // estimated birth: ages read "khoảng N tuổi"
  // with an estimated life, family rows outside it (e.g. a grandchild born after the estimated death) are left out
  const yOf = (r) => Number(String(r.date_from || '').slice(0, 4)) || null;
  const inWin = (r) => !window || r.group === 'self' || !yOf(r) || (yOf(r) >= Number(String(window.from).slice(0, 4)) && yOf(r) <= Number(String(window.to).slice(0, 4)));
  const evm = ev ? { ...ev, items: withPending(fam, p.id, ev.items || []) } : ev;
  return { fam, ev: evm, derived: [...derived.filter(inWin), ...estRows], hist, birth, est, nameOf: evNameOf(fam) };
}

let profTab = 'info'; let profFor = '';
const PTABS = [['info', 'Thông tin'], ['life', 'Dòng đời'], ['src', 'Tư liệu']]; // Quan hệ and Tổ tiên sit on Thông tin
let LIFE = null; // the person whose timeline is on screen: { p }
function profTabsHtml() {
  return `<nav class="ptabs" role="tablist" aria-label="Hồ sơ">${PTABS.map(([k, l]) => `<button type="button" role="tab" class="ptab${profTab === k ? ' on' : ''}" data-ptab="${k}" aria-selected="${profTab === k}">${l}</button>`).join('')}</nav>`;
}
// Dòng đời: toolbar, the list, the summary and the stories. #tl-body is the part that repaints on filter changes.
function lifePanelHtml(p) {
  const { ev } = lifeModel(p);
  if (!ev || !ev.loaded) return '<div class="skel" role="status"><p class="sub">Đang tải dòng đời…</p><span class="skel-l"></span><span class="skel-l w2"></span></div>';
  if (ev.error && !(ev.items || []).length) return `<p class="sub">${esc(ev.error)}</p>`;
  if (ev.hidden) return `${card(`<p class="sub">Thông tin của người đang sống chỉ thành viên xem được.</p>${S.signedIn() ? '' : '<p><button type="button" class="btn sm" data-acct="in">Đăng nhập</button></p>'}`)}`;
  LIFE = { p };
  return (ev.cached ? '<p class="sub" role="status">Không có mạng: đang xem dữ liệu đã lưu trên máy này.</p>' : '') + `<div class="tl-bar stk" id="tl-bar">${lifeBarHtml()}</div><div id="tl-body">${lifeBodyHtml(p)}</div>${tlSheetDialog(tlLoad())}`;
}
function lifeBarHtml() { return tlToolbar(tlLoad(), isWide()); } // the sheet is outside this part: it stays open while its checkboxes repaint the bar
function lifeBodyHtml(p) {
  const { fam, ev, derived, hist, birth, est, nameOf } = lifeModel(p);
  const f = tlLoad();
  const rows = tlEntries({ events: ev.items, derived: [...derived, ...(f.hist ? hist : [])], birth });
  const shown = rows.filter((r) => tlMatch(r, f, nameOf));
  const span = rows.some((r) => r.age && r.age.years >= 70);
  const direct = evDirect(fam);
  const list = shown.length ? tlList(shown, { nameOf, canEdit: true, editLbl: direct ? 'Sửa' : 'Góp ý', span, personHref: (pid) => hf('person/' + pid), selfId: p.id, estSave: direct })
    : emptyState(f.photo ? 'Chưa có sự kiện nào có ảnh.' : 'Không có sự kiện nào khớp.');
  const tags = ltags(tlTags(f));
  const nh = shown.filter((r) => r.e.group === 'hist').length;
  // The summary block: count, then the estimate; the reasoning folds under "Cách tính" (closed by default).
  const estLine = est && est.conflict ? `<p class="tl-est">Dữ liệu mâu thuẫn: không ước tính được năm sinh. Kiểm tra: ${esc(est.basis.join('; '))}.</p>` : est && nh ? `<div class="tl-est">Ước tính: sinh ${approxHtml(est.label.born, 'khoảng ' + est.label.born)}, mất ${approxHtml(est.label.died, 'khoảng ' + est.label.died)}<details class="tl-why"><summary>Cách tính ›</summary><p class="sub tl-why-body">dựa trên: ${esc(est.basis.join('; '))}.</p></details></div>` : '';
  const noYear = !est && !birth && f.hist && !nh ? '<p class="tl-est">Chưa có năm sinh/mất — thêm để thấy mốc lịch sử.</p>' : '';
  return `${tags}<div class="tl-sum">${tlCount(shown.length - nh, nh, est && !est.conflict && nh && est.from && est.to ? `${est.from}–${est.to}` : '')}${estLine}${noYear}</div>${f.photo ? '' : list}`;
}
const paintLifeBody = () => { if (!LIFE) return; const el = document.getElementById('tl-body'); if (el) el.innerHTML = lifeBodyHtml(LIFE.p); };
const paintLifeBar = () => { if (!LIFE) return; const el = document.getElementById('tl-bar'); if (el) el.innerHTML = lifeBarHtml(); };
// Filter changes: state per device; the sheet stays open, the list repaints.
function tlChange(fn) { const f = fn(tlLoad()); tlSave(f); paintLifeBody(); }
function lifeUntag(k) { tlSave(tlApplyUntag(tlLoad(), k)); paintLifeBar(); paintLifeBody(); }
function srcHtml(p) {
  const { ev } = lifeModel(p);
  if (!ev || !ev.loaded) return '<p class="sub">Đang tải…</p>';
  const items = ev.items.filter((e) => (e.sources || []).length);
  const photos = (ev.stories || []).flatMap((s) => (s.photos || []).map((u) => ({ u, title: s.title })));
  if (!items.length && !photos.length) return emptyState('Chưa có nguồn hay ảnh nào.');
  return `${items.length ? `<h3 class="tl-lbl">Nguồn</h3><ul class="srcl">${items.map((e) => e.sources.map((s) => `<li><b>${esc(headline(e))}</b> · ${esc(s.title)}${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener">Mở</a>` : ''}${s.quality ? ` <span class="sub">${esc(SOURCE_QUALITY[s.quality] || '')}</span>` : ''}</li>`).join('')).join('')}</ul>` : ''}`
    + `${photos.length ? `<h3 class="tl-lbl">Ảnh</h3><div class="stry-ph">${photos.map((x) => `<img src="${esc(x.u)}" alt="${esc(x.title)}" loading="lazy">`).join('')}</div>` : ''}`;
}
// Event editor page (owner 2026-11-24: a big form is a page, not a sheet): #/<fam>/su-kien/<personId>[?id=<eventId>].
// Back and Hủy return; the sticky bar holds Hủy · Lưu; delete sits apart in "Vùng nguy hiểm" and always confirms.
function eventPage(pid) {
  const p = M.byId.get(pid);
  if (!p) { main.innerHTML = '<h1>Sự kiện</h1><p class="sub">Không tìm thấy người này.</p>'; return; }
  const id = route().qs.get('id') || null;
  const fam = famOfP(p); const direct = evDirect(fam); const persons = evPickList(fam);
  const ev = EVD.get(evKey(fam, p.id));
  if (!ev?.loaded) {
    main.innerHTML = '<h1>Sự kiện</h1><p class="sub">Đang tải…</p>';
    evLoad(fam, p.id).then(() => { if (route().view === 'su-kien') render(); }, (e) => { main.innerHTML = `<h1>Sự kiện</h1><p class="err">${esc(e.message)}</p>`; });
    return;
  }
  const it = id ? (ev.items || []).find((x) => x.id === id) : null;
  if (id && !it) { main.innerHTML = '<h1>Sự kiện</h1><p class="sub">Không tìm thấy sự kiện này.</p>'; return; }
  const f = tlLoad();
  const item = it || eventPrefill({ types: f.types, q: f.q });
  const h = !id ? 'Thêm sự kiện' : direct ? 'Sửa sự kiện' : 'Góp ý sửa sự kiện';
  main.innerHTML = `<h1>${esc(h)}</h1><div class="form-stack fp-form evpage"><p class="sub">${esc(p.data.name)}${direct ? '' : ' · Quản trị sẽ duyệt trước khi hiển thị.'}</p>`
    + evEditorHtml(item, { people: item.people || [], persons, id: id || '', page: true })
    + (id && direct ? dangerZone([dangerButton('Xóa sự kiện', 'data-evp-del')], { note: 'Xóa sự kiện khỏi dòng đời. Không thể hoàn tác.' }) : '')
    + '</div>';
  const root = main.querySelector('[data-evx]'); wireEvx(root, persons);
  const fail = (m) => { const e = root.querySelector('[data-evx-err]'); e.hidden = false; e.textContent = m; };
  const done = async (msg) => { if (msg) toast(msg); if (direct) { evInvalidate(fam, p.id); await evLoad(fam, p.id, true).catch(() => {}); } profTab = 'life'; location.hash = hf(`person/${p.id}`); };
  root.querySelector('[data-evx-cancel]').onclick = () => goBack();
  root.querySelector('[data-evx-save]').onclick = async (e) => {
    const r = readEvx(root); if (r.error) return fail(r.error);
    const b = e.currentTarget; b.disabled = true;
    try { const j = await evApiSave({ fam, p, kind: 'event', id, item: r.item, direct }); await done(j.queued ? 'Chưa gửi: sẽ lưu lên máy chủ khi có mạng' : direct ? 'Đã lưu' : 'Đã gửi góp ý. Quản trị sẽ duyệt.'); } catch (x) { b.disabled = false; fail(x.message); }
  };
  main.querySelector('[data-evp-del]')?.addEventListener('click', () => confirmDanger({ title: 'Xóa sự kiện này?', lose: `Sự kiện “${headline(it)}” bị xóa khỏi dòng đời của ${p.data.name}.`, restore: 'Không thể hoàn tác. Lịch sử sửa vẫn ghi lại việc xóa.', confirm: 'Xóa vĩnh viễn', onConfirm: async () => { const j = await evApi('POST', `/api/events/${id}/delete?family=${encodeURIComponent(fam)}`, { op_id: evOpId() }); await done(''); undoToast('Đã xóa sự kiện · trong Thùng rác', async () => { await restoreTrash(fam, j.trash_id); evInvalidate(fam, p.id); await evLoad(fam, p.id, true).catch(() => {}); render(); }); } }));
}
// Event / story editor dialog (timeline). Editors save at once; others send a suggestion.
function evDialog({ kind, p, id = null, item = {}, title }) {
  const fam = famOfP(p); const direct = evDirect(fam);
  const persons = evPickList(fam);
  const d = document.createElement('dialog'); d.className = 'dlg evdlg';
  const body = kind === 'event' ? evEditorHtml(item, { people: item.people || [], persons, id: id || '' })
    : storyEditorHtml(item, { summary: item.kind === 'tom_tat' });
  d.innerHTML = `<div class="form-stack"><h2>${esc(title)}</h2>${direct ? '' : '<p class="sub">Quản trị sẽ duyệt trước khi hiển thị.</p>'}${body}</div>`;
  document.body.append(d); d.showModal();
  if (kind === 'event') wireEvx(d.querySelector('[data-evx]'), persons);
  const close = () => { d.close(); d.remove(); };
  d.querySelector('[data-evx-cancel]').onclick = close;
  const fail = (m) => { const e = d.querySelector('[data-evx-err]'); e.hidden = false; e.textContent = m; };
  const save = async (changes) => {
    try {
      const j = await evApiSave({ fam, p, kind, id, item: changes, direct });
      close(); toast(j.queued ? 'Chưa gửi: sẽ lưu lên máy chủ khi có mạng' : direct ? 'Đã lưu' : 'Đã gửi góp ý. Quản trị sẽ duyệt.'); if (direct) evInvalidate(fam, p.id); if (direct) await evLoad(fam, p.id, true).catch(() => {}); render(); return j;
    } catch (e) { fail(e.message); }
  };
  const evSave = d.querySelector('[data-evx-save]'); if (evSave) evSave.onclick = () => { const r = readEvx(d.querySelector('[data-evx]')); if (r.error) return fail(r.error); save(r.item); };
  const stSave = d.querySelector('[data-stx-save]'); if (stSave) stSave.onclick = () => { const r = readStx(d.querySelector('[data-stx]')); if (!r.body) return fail('Cần có nội dung.'); save(r); };
  d.addEventListener('close', () => d.remove());
  return d;
}
// An estimated row stored as a normal event (date_kind 'between', the basis in the note). Editors only.
async function saveEstimateEvent(p, row) {
  const fam = famOfP(p);
  try {
    await evApiSave({ fam, p, kind: 'event', id: null, direct: true, action: 'add',
      item: { type: row.type, date_kind: 'between', date_from: row.date_from, date_to: row.date_to, description: `Ước tính từ ${row.basis.join('; ')}` } });
    evInvalidate(fam, p.id); await evLoad(fam, p.id, true).catch(() => {});
    toast('Đã lưu sự kiện ước tính'); render();
  } catch (err) { toast(err.message); }
}
// The API call for one item: direct (editor) or a suggestion. id is null for a new item.
async function evApiSave({ fam, p, kind, id, item, direct, action }) {
  const act = action || (id ? 'edit' : 'add');
  const q = `?family=${encodeURIComponent(fam)}`;
  const base = kind === 'event' ? '/api/events' : '/api/stories';
  if (direct && act === 'delete') return evApi('POST', `${base}/${id}/delete${q}`, { op_id: evOpId() });
  if (!direct && act === 'delete') { const j = await S.suggest({ family: fam, person_id: p.id, changes: { _ev: { action: 'delete', kind: kind === 'event' ? 'event' : 'story', id } } }); S.addReceipt(j.id, j.receipt); return j; }
  if (direct) {
    if (kind === 'event') {
      const show = { kind, act, id, item };
      if (act === 'add') return evWriteOrQueue(fam, p.id, 'POST', '/api/events' + q, { person_id: p.id, event: item }, show);
      return evWriteOrQueue(fam, p.id, 'PUT', `/api/events/${id}${q}`, { event: item }, show);
    }
    if (act === 'add') return evApi('POST', '/api/stories' + q, { op_id: evOpId(), person_id: p.id, story: item });
    return evApi('PUT', `/api/stories/${id}${q}`, { op_id: evOpId(), story: item });
  }
  const ev = { action: act, kind: kind === 'event' ? 'event' : 'story', item };
  if (act !== 'add') ev.id = id;
  const j = await S.suggest({ family: fam, person_id: p.id, changes: { _ev: ev }, by_name: '', by_contact: '' });
  S.addReceipt(j.id, j.receipt);
  return j;
}
// Hồ sơ: one tab's content. The Thông tin tab keeps the facts; Quan hệ keeps the relations and the ancestors.
// Liên hệ: its own group card on the profile. Values when the viewer may see them (members, or the person made them
// public); otherwise, when the server says there are some (has_contact), a sign-in prompt. No card when nothing to show.
function contactCard(d, id, fam) {
  const items = contactList(d);
  const rows = items.map((c) => {
    const t = CTYPE[c.type]; const h = contactHref(c);
    const val = h ? `<a href="${esc(h)}"${/^https?:/.test(h) ? ' target="_blank" rel="noopener"' : ''}>${esc(c.value)}</a>` : esc(c.value);
    return `<dt>${esc(c.type === 'other' && c.label ? c.label : t.label)}</dt><dd>${val}</dd>`;
  }).join('');
  const body = rows ? `<dl class="facts">${rows}</dl>`
    : !d.has_contact ? ''
    : !S.signedIn() ? '<p class="sub">Thông tin liên hệ chỉ hiện cho người trong họ đã đăng nhập.</p><p><button type="button" class="btn sm" data-acct="in">Đăng nhập</button></p>'
    : '<p class="sub">Bạn cần được thêm vào dòng họ để xem liên hệ.</p>';
  const edit = S.isEditor() && id ? `<p><button type="button" class="btn ter sm" data-ct-edit="${esc(id)}">${items.length ? 'Sửa liên hệ' : 'Thêm liên hệ'}</button></p>` : '';
  return body || edit ? section('Liên hệ', `${body}${edit}`, { variant: 'card', label: 'Liên hệ', cls: 'consec sec-card', level: 2 }) : '';
}
// Câu chuyện đời on Thông tin (after the facts and contact, before Quan hệ): the events are loaded for this tab too.
function storiesOnInfo(p) {
  const { fam, ev } = lifeModel(p);
  if (!ev || !ev.loaded || ev.hidden || ev.error) return '';
  return lifeStoriesHtml({ name: p.data.name, events: ev.items || [], summary: (ev.stories || []).find((s) => s.kind === 'tom_tat') || null, stories: ev.stories || [], canEdit: true, canAdd: evDirect(fam) });
}
function profBody(p, { groups, id, d }) {
  if (profTab === 'life') return lifePanelHtml(p);
  if (profTab === 'src') return srcHtml(p);
  LIFE = { p }; // the Câu chuyện đời actions (add, edit, Đọc tiếp, Xem tất cả) read the person from LIFE
  const facts = factCardHtml(factGroups(groups));
  return `${d.verify ? `<div class="ntc warn"><b>Cần xác minh</b><span class="sub">${esc(d.verify)}</span></div>` : ''}${facts}${codeOf(M, id) ? `<p class="sub">Vị trí trong cây <span class="ppos" title="${esc(CODE_HELP)}">${esc(codeOf(M, id))}</span></p>` : ''}${contactCard(d, id, p.fam || S.curFamily())}${storiesOnInfo(p)}`
    + `${(LK.ensure(p.fam || S.curFamily()), '')}${relSection(M, p, { editable: S.isEditor(), relpathHref: (x) => hf(`relpath/${encodeURIComponent(x)}`), treeHref: hf(`tree/@${id}`), treeOf: (x) => hf(`tree/@${x}`), personHref: (x) => hf(`person/${x}`), links: LK.linesHtml(p.fam || S.curFamily(), id, { clan: CL.clanLinkHtml(S.familyName(p.fam || S.curFamily()), 'clan-in', S.familyMeta(p.fam || S.curFamily())?.country) }) + (BT.ensureBranches(p.fam || S.curFamily()), BT.rootLinkHtml(p.fam || S.curFamily(), id)) })}${pedigreeHtml(M, id, 4, { personHref: (x) => hf(`person/${x}`) })}`;
}
// Delegated clicks for the profile tabs, the timeline and the event/story dialogs.
document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-ptab]');
  if (tab && main.contains(tab)) { profTab = tab.dataset.ptab; render(); return; }
  if (!LIFE || !main.contains(e.target)) return;
  const p = LIFE.p;
  const add = e.target.closest('[data-ev-add]');
  if (add) { location.hash = hf(`su-kien/${p.id}`); return; }
  const es = e.target.closest('[data-est-save]');
  if (es) {
    const row = lifeModel(p).derived.find((r) => r.id === es.dataset.estSave);
    if (row) confirmDialog('Lưu thành sự kiện?', `Tạo sự kiện “${row.label}”, khoảng ${row.range}. Ghi chú: Ước tính từ ${row.basis.join('; ')}.`, 'Lưu', () => saveEstimateEvent(p, row));
    return;
  }
  const ed = e.target.closest('[data-ev-edit]');
  if (ed) {
    const { ev, fam } = lifeModel(p); const it = (ev?.items || []).find((x) => x.id === ed.dataset.evEdit);
    if (it) location.hash = hf(`su-kien/${p.id}?id=${encodeURIComponent(it.id)}`); void fam;
    return;
  }
  if (e.target.closest('[data-sum-edit]')) {
    const { ev } = lifeModel(p); const summary = (ev.stories || []).find((s) => s.kind === 'tom_tat');
    evDialog({ kind: 'story', p, id: summary?.id || null, item: { kind: 'tom_tat', title: 'Câu chuyện đời', body: summary ? summary.body : autoSummary(p.data.name, ev.items) }, title: 'Câu chuyện đời' });
    return;
  }
  if (e.target.closest('[data-st-add]')) { evDialog({ kind: 'story', p, title: 'Viết câu chuyện' }); return; }
  const stm = e.target.closest('[data-st-more]'); // "Đọc tiếp": the body opens inline
  if (stm) { stm.parentElement.querySelector('.rv-clamp')?.classList.remove('rv-clamp'); stm.remove(); return; }
  const sta = e.target.closest('[data-st-all]'); // "Xem tất cả N câu chuyện": the rest of the stories show
  if (sta) { sta.nextElementSibling?.removeAttribute('hidden'); sta.remove(); return; }
});
// Filter sheet and search (the sheet lives in the life panel; the global handler opens it and closes it).
document.addEventListener('change', (e) => {
  if (!LIFE || !main.contains(e.target)) return;
  const t = e.target;
  if (t.dataset.tlType) tlChange((f) => ({ ...f, types: t.checked ? [...f.types, t.dataset.tlType] : f.types.filter((x) => x !== t.dataset.tlType) }));
  else if (t.dataset.tlStage) tlChange((f) => ({ ...f, stages: t.checked ? [...f.stages, t.dataset.tlStage] : f.stages.filter((x) => x !== t.dataset.tlStage) }));
  else if (t.dataset.tlF) tlChange((f) => ({ ...f, [t.dataset.tlF]: t.checked }));
  else return;
  paintLifeBar();
});
document.addEventListener('click', (e) => {
  if (!LIFE || !main.contains(e.target)) return;
  const b = e.target.closest('button[data-tl-f]');
  if (b) { tlChange((f) => ({ ...f, [b.dataset.tlF]: !f[b.dataset.tlF] })); paintLifeBar(); }
});
document.addEventListener('input', (e) => {
  if (!LIFE || e.target.id !== 'tlq') return;
  tlChange((f) => ({ ...f, q: e.target.value }));
});

// ---------- the person form's "Sự kiện & câu chuyện" section ----------
// Pending changes (st.evq) are kept in the form state and the draft; they are sent after the person is saved.
const tmpId = () => 'new-' + Math.random().toString(36).slice(2, 8);
const isTmp = (id) => String(id).startsWith('new-');
function evSumText(st) {
  if (!st.p) return ''; // a new person has no events
  const ev = EVD.get(evKey(st.fam, st.p.id)); if (!ev || !ev.loaded || ev.hidden || ev.error) return '';
  let n = ev.items.length; let s = (ev.stories || []).filter((x) => x.kind !== 'tom_tat').length;
  for (const q of st.evq || []) { const d = q.action === 'add' ? 1 : q.action === 'delete' ? -1 : 0; if (q.kind === 'event') n += d; else s += d; }
  return [n ? `${n} sự kiện` : '', s ? `${s} câu chuyện` : ''].filter(Boolean).join(' · ');
}
function evqSet(st, kind, id, item) {
  st.evq = st.evq || []; const i = st.evq.findIndex((q) => q.kind === kind && q.id === id);
  if (isTmp(id)) { if (i >= 0) st.evq[i] = { kind, action: 'add', id, item }; else st.evq.push({ kind, action: 'add', id, item }); return; }
  if (i >= 0) { const q = st.evq[i]; st.evq[i] = q.action === 'add' ? { ...q, item } : { kind, action: 'edit', id, item }; return; }
  st.evq.push({ kind, action: 'edit', id, item });
}
function evqDel(st, kind, id) {
  st.evq = st.evq || []; const i = st.evq.findIndex((q) => q.kind === kind && q.id === id);
  if (i >= 0 && st.evq[i].action === 'add') { st.evq.splice(i, 1); return; } // never saved: just drop it
  if (i >= 0) { st.evq[i] = { kind, action: 'delete', id }; return; }
  st.evq.push({ kind, action: 'delete', id });
}
// Stored items with the pending changes applied (what the list shows): { ...item, _st: '' | 'add' | 'edit' | 'del' }.
function evMergedEvents(st) {
  const ev = EVD.get(evKey(st.fam, st.p.id));
  const items = (ev?.items || []).map((e) => ({ ...e, _st: '' }));
  for (const q of st.evq || []) {
    if (q.kind !== 'event') continue;
    const i = items.findIndex((x) => x.id === q.id);
    if (q.action === 'delete') { if (i >= 0) items[i] = { ...items[i], _st: 'del' }; }
    else if (q.action === 'edit') { if (i >= 0) items[i] = { ...q.item, id: q.id, _st: 'edit' }; }
    else items.push({ ...q.item, id: q.id, _st: 'add' });
  }
  return sortEvents(items);
}
function evMergedStories(st) {
  const ev = EVD.get(evKey(st.fam, st.p.id));
  const list = (ev?.stories || []).filter((x) => x.kind !== 'tom_tat').map((s) => ({ ...s, _st: '' }));
  for (const q of st.evq || []) {
    if (q.kind !== 'story') continue;
    const i = list.findIndex((x) => x.id === q.id);
    if (q.action === 'delete') { if (i >= 0) list[i] = { ...list[i], _st: 'del' }; }
    else if (q.action === 'edit') { if (i >= 0) list[i] = { ...q.item, id: q.id, _st: 'edit' }; }
    else list.push({ ...q.item, id: q.id, _st: 'add' });
  }
  return list;
}
const STATE_TXT = { add: ' · chờ lưu', edit: ' · đã sửa, chưa lưu', del: ' · sẽ xóa' };
// Row classes for pending states (literal names, so the stylesheet is found by the dead-code scan).
const STATE_CLS = { add: 'is-add', edit: 'is-edit', del: 'is-del' };
function evFormList(st) {
  const items = evMergedEvents(st);
  if (!items.length) return '<p class="sub">Chưa có sự kiện nào.</p>';
  return `<ol class="evlist">${items.map((e) => `<li class="evrow ${STATE_CLS[e._st] || ''}">
    <span class="evrow-i">${typeIcon(e.type, 18)}</span>
    <span class="evrow-t"><b>${esc(headline(e))}</b><span class="sub">${esc(formatEventDate(e) || 'chưa rõ năm')}${STATE_TXT[e._st] || ''}</span></span>
    ${e._st === 'del' ? '' : `<span class="evrow-a"><button type="button" class="linkbtn" data-fev-edit="${esc(e.id)}">Sửa</button>${dangerButton('Xóa', `data-fev-del="${esc(e.id)}"`, { size: 'sm' })}</span>`}
  </li>`).join('')}</ol>`;
}
function evStoryList(st) {
  const list = evMergedStories(st);
  if (!list.length) return '<p class="sub">Chưa có câu chuyện nào.</p>';
  return list.map((s) => `<div class="evrow ${STATE_CLS[s._st] || ''}"><span class="evrow-t"><b>${esc(s.title || 'Câu chuyện')}</b><span class="sub">${esc((s.body || '').slice(0, 80))}${STATE_TXT[s._st] || ''}</span></span>
    ${s._st === 'del' ? '' : `<span class="evrow-a"><button type="button" class="linkbtn" data-fst-edit="${esc(s.id)}">Sửa</button>${dangerButton('Xóa', `data-fst-del="${esc(s.id)}"`, { size: 'sm' })}</span>`}</div>`).join('');
}
function evFormBody(st) {
  const ev = EVD.get(evKey(st.fam, st.p.id));
  if (!ev || !ev.loaded) { evFormLoad(st); return '<p class="sub wide">Đang tải sự kiện…</p>'; }
  if (ev.error) return `<p class="sub wide">${esc(ev.error)}</p>`;
  if (ev.hidden) return '<p class="sub wide">Thông tin của người đang sống chỉ thành viên xem được.</p>';
  return `<div class="fev wide"><div id="fev-list">${evFormList(st)}</div><div id="fev-ed"></div>
    <div class="fev-add"><button type="button" class="btn ter sm" data-fev-add>+ Thêm sự kiện</button></div>
    <h4 class="tl-lbl">Câu chuyện</h4><div id="fst-list">${evStoryList(st)}</div><div id="fst-ed"></div>
    <div class="fev-add"><button type="button" class="btn ter sm" data-fst-add>+ Viết câu chuyện</button></div>
    ${evDirect(st.fam) ? '' : '<p class="sub">Sự kiện và câu chuyện bạn thêm sẽ chờ quản trị duyệt.</p>'}</div>`;
}
function evFormLoad(st) {
  const k = evKey(st.fam, st.p.id); if (evPending.has(k)) return;
  evPending.add(k);
  evLoad(st.fam, st.p.id).catch((e) => EVD.set(k, { loaded: true, at: Date.now(), error: e.message, items: [], stories: [] }))
    .finally(() => {
      evPending.delete(k);
      const panel = document.getElementById('acc-p-su');
      if (panel && formNow && formNow.st === st) { panel.querySelector('.fgrid').innerHTML = evFormBody(st); fpLive(formNow.form, st); }
    });
}
// The open editor (event or story) into its slot, wired.
function evPaintEd(st) {
  const ev = document.getElementById('fev-ed'); const sv = document.getElementById('fst-ed');
  if (ev) ev.innerHTML = st.evEd && st.evEd.kind === 'event' ? evEditorHtml(st.evEd.item, { people: st.evEd.item.people || [], persons: evPickList(st.fam), id: st.evEd.id || '' }) : '';
  if (sv) sv.innerHTML = st.evEd && st.evEd.kind === 'story' ? storyEditorHtml(st.evEd.item) : '';
  if (st.evEd && st.evEd.kind === 'event' && ev) wireEvx(ev.querySelector('[data-evx]'), evPickList(st.fam));
  if (st.evEd && (st.evEd.kind === 'event' ? ev : sv)) (st.evEd.kind === 'event' ? ev : sv).querySelector('input,textarea,select')?.focus();
}
function evAfterChange(st) {
  const list = document.getElementById('fev-list'); if (list) list.innerHTML = evFormList(st);
  const sl = document.getElementById('fst-list'); if (sl) sl.innerHTML = evStoryList(st);
  if (formNow && formNow.st === st) { formDirty = true; fpLive(formNow.form, st); fpDraftSave(formNow.form, st); }
}
// Clicks inside the section. Returns true when handled.
function evFormClick(form, st, e) {
  const t = e.target;
  if (t.closest('[data-fev-add]')) { st.evEd = { kind: 'event', id: null, item: { type: 'sinh' } }; evPaintEd(st); return true; }
  const fe = t.closest('[data-fev-edit]');
  if (fe) { const it = evMergedEvents(st).find((x) => x.id === fe.dataset.fevEdit); if (it) st.evEd = { kind: 'event', id: it.id, item: { ...it, _st: undefined } }; evPaintEd(st); return true; }
  const fd = t.closest('[data-fev-del]');
  if (fd) { const k = fd.dataset.fevDel; confirmDanger({ title: 'Xóa sự kiện này?', lose: 'Sự kiện bị xóa khỏi dòng đời khi bạn lưu.', restore: 'Trước khi lưu, có thể bỏ thay đổi để giữ lại.', confirm: 'Xóa sự kiện', onConfirm: () => { evqDel(st, 'event', k); evAfterChange(st); } }); return true; }
  if (t.closest('[data-fst-add]')) { st.evEd = { kind: 'story', id: null, item: {} }; evPaintEd(st); return true; }
  const fse = t.closest('[data-fst-edit]');
  if (fse) { const s = evMergedStories(st).find((x) => x.id === fse.dataset.fstEdit); if (s) st.evEd = { kind: 'story', id: s.id, item: { title: s.title, body: s.body, photos: s.photos } }; evPaintEd(st); return true; }
  const fsd = t.closest('[data-fst-del]');
  if (fsd) { const k = fsd.dataset.fstDel; confirmDanger({ title: 'Xóa câu chuyện này?', lose: 'Câu chuyện bị xóa khi bạn lưu.', restore: 'Trước khi lưu, có thể bỏ thay đổi để giữ lại.', confirm: 'Xóa câu chuyện', onConfirm: () => { evqDel(st, 'story', k); evAfterChange(st); } }); return true; }
  if (t.closest('#fev-ed [data-evx-cancel], #fst-ed [data-evx-cancel]')) { st.evEd = null; evPaintEd(st); return true; }
  if (t.closest('#fev-ed [data-evx-save]')) {
    const root = document.querySelector('#fev-ed [data-evx]'); const r = readEvx(root);
    if (r.error) { const er = root.querySelector('[data-evx-err]'); er.hidden = false; er.textContent = r.error; return true; }
    evqSet(st, 'event', st.evEd.id || tmpId(), r.item); st.evEd = null; evPaintEd(st); evAfterChange(st); return true;
  }
  if (t.closest('#fst-ed [data-stx-save]')) {
    const root = document.querySelector('#fst-ed [data-stx]'); const r = readStx(root);
    if (!r.body) { const er = root.querySelector('[data-evx-err]'); er.hidden = false; er.textContent = 'Cần có nội dung.'; return true; }
    evqSet(st, 'story', st.evEd.id || tmpId(), r); st.evEd = null; evPaintEd(st); evAfterChange(st); return true;
  }
  return false;
}
// After the person is saved: the pending events and stories, one request each (editors) or one suggestion each.
async function evFlush(st, pid) {
  while (st.evq && st.evq.length) {
    const q = st.evq[0];
    await evApiSave({ fam: st.fam, p: { id: pid }, kind: q.kind, id: q.action === 'add' ? null : q.id, item: q.item, direct: !st.suggest, action: q.action });
    st.evq.shift();
  }
  evInvalidate(st.fam, pid);
}


// ---------- giỗ ----------
// ---------- follow giỗ (device-local) + calendar ----------
const follows = () => S.getPrefs().follows || [];
const setChi = (v) => S.setPrefs({ filters: { ...S.getPrefs().filters, chi: v } });
const isFollow = (id) => follows().includes(id);
function toggleFollow(id) { const f = [...follows()]; const i = f.indexOf(id); if (i < 0) f.push(id); else f.splice(i, 1); S.setPrefs({ follows: f }); render(); }
const calUrl = (ids) => `${location.origin}/lich.ics${ids && ids.length ? '?ids=' + ids.join(',') : ''}`;
function followBar(p) {
  const on = isFollow(p.id);
  return `<button type="button" class="btn ${on ? '' : 'ter'} sm" data-follow="${p.id}" aria-pressed="${on}">${on ? '★ Đang theo dõi' : '☆ Theo dõi'}</button>`;
}
function soonBanner() {
  const f = follows(); if (!f.length) return '';
  const now = new Date(); const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const soon = f.map((id) => M.byId.get(id)).filter(Boolean).map((p) => { const g = gioOf(p.data); const at = g && nextAnniversary(g.d, g.m, now); return at ? { p, g, n: Math.round((at - t0) / 864e5) } : null; })
    .filter((x) => x && x.n <= 7).sort((a, b) => a.n - b.n);
  const rows = soon.map(({ p, g, n }) => `<a class="ntc warn soon" href="${ph(p, `person/${p.id}`)}"><b>Sắp tới · ${n === 0 ? 'Hôm nay' : n === 1 ? 'Ngày mai' : 'Còn ' + n + ' ngày'}: giỗ ${esc(rank(p.data))} ${esc(p.data.name)}</b><span class="sub">${g.label} âm lịch</span></a>`).join('');
  return rows ? `<section class="soon-blk" aria-labelledby="soon-h"><h2 id="soon-h" class="soon-h">${DG.block_title}</h2>${rows}</section>` : '';
}
const setGioAll = (v) => { S.setPrefs({ filters: { ...S.getPrefs().filters, gio_all: v } }); render(); };
document.addEventListener('change', (e) => { const t = e.target.closest('[data-gioall]'); if (t && !t.disabled) { e.target.closest('dialog')?.close(); setGioAll(t.dataset.gioall); } });
document.addEventListener('click', (e) => { const b = e.target.closest('[data-follow]'); if (b) { e.preventDefault(); e.stopPropagation(); toggleFollow(b.dataset.follow); } }, true);
function gio() {
  const now = new Date();
  const f = follows(); const mine = f.length && S.getPrefs().filters?.gio_all !== '1';
  const fam = S.curFamily(); const feed = !S.isAll() && S.isMember();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const items = M.all.map((p) => { const g = gioOf(p.data); if (!g) return null; const at = nextAnniversary(g.d, g.m, now); return at ? { id: p.id, p, g, at: at.getTime(), day: at } : null; })
    .filter(Boolean).filter((x) => !mine || f.includes(x.p.id));
  const posts = feed ? (NW.cached(fam)?.posts || []) : [];
  const gath = posts.filter((p) => p.kind === 'gathering' && p.starts_at && dayMs(p.starts_at) >= today).map((p) => ({ id: p.id, at: dayMs(p.starts_at), p }));
  const rows = mergeLich(items, gath, 'all');
  const kind = NW.kindNow();
  const days = (t) => Math.round((t - today) / 864e5);
  const fmt = (t) => t.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' });
  setUntag(() => setGioAll('1'));
  main.innerHTML = `<h1>Lịch</h1>${soonBanner()}
  ${feed ? NW.topCardsHtml(fam, hf, S.getPrefs) : ''}
  ${toolbar({ id: 'gq', ph: 'Tìm tên hoặc ngày (ví dụ 3/8)', active: mine ? 1 : 0, quick: `<select id="gallq" aria-label="Hiển thị"><option value="0" ${mine ? 'selected' : ''} ${f.length ? '' : 'disabled'}>★ Người tôi theo dõi (${f.length})</option><option value="1" ${mine ? '' : 'selected'}>Cả họ</option></select>`, add: addBtn('data-add="gio"', 'Thêm người đã mất') })}
  ${NW.chipsHtml()}
  ${ltags(mine ? [['mine', '★ Người tôi theo dõi (' + f.length + ')']] : [])}
  ${fpanel(`<fieldset class="fset"><legend>Hiển thị</legend><label class="radio"><input type="radio" name="gall" data-gioall="0" ${mine ? 'checked' : ''} ${f.length ? '' : 'disabled'}> ★ Người tôi theo dõi (${f.length})</label><label class="radio"><input type="radio" name="gall" data-gioall="1" ${mine ? '' : 'checked'}> Cả họ</label></fieldset>`)}
  <p class="sub">☆ Theo dõi để nhận nhắc giỗ. Ngày âm lịch tự đổi theo từng năm.</p>
  ${S.signedIn() ? '' : deviceNote(S.myAccount().google)}
  ${feed ? '<div id="calcard"></div>' : ''}
  ${items[0] ? `${card(`<div class="sub">Gần nhất · còn ${days(items[0].at)} ngày</div><h2><a class="plink" href="${ph(items[0].p, `person/${items[0].p.id}`)}">Giỗ ${esc(rank(items[0].p.data))} ${esc(items[0].p.data.name)}</a></h2><div class="sub">${items[0].g.label} âm lịch · ${fmt(items[0].day)}</div><div class="row wrap"><button class="btn sm" id="ics">Thêm vào lịch</button><button class="btn ter sm" id="share">Gửi cả họ</button></div>`, { cls: 'hl' })}` : ''}
  ${card(`${rows.map((r) => (r.k === 'gath' ? NW.gatheringRow(r.p, hf, today, kind !== 'all' && kind !== 'gath')
    : `<div class="gior" data-k="gio"${kind !== 'all' && kind !== 'gio' ? ' hidden' : ''} data-q="${esc(fold(rank(r.p.data) + ' ' + r.p.data.name + ' ' + r.g.label + ' ' + (r.p.data.spouse_of ? 'dau re' : '')))}"><a class="li gio" href="${ph(r.p, `person/${r.p.id}`)}"><span class="date"><b>${r.g.label}</b><span>ÂL</span></span><span class="grow"><b>${esc(rank(r.p.data))} ${esc(r.p.data.name)}</b> ${tag(`Giỗ`, { sm: true })}${famChipIf(r.p)}<span class="sub">${r.p.data.spouse_of ? esc(inLaw(r.p)) : 'Đời ' + r.p.data.gen} · ${fmt(r.day)} · còn ${days(r.at)} ngày</span></span></a>${iconButton({ icon: isFollow(r.p.id) ? 'starOn' : 'star', label: `${isFollow(r.p.id) ? 'Bỏ theo dõi' : 'Theo dõi'} giỗ ${r.p.data.name}`, size: 22, attrs: `data-follow="${r.p.id}" aria-pressed="${isFollow(r.p.id)}"` })}</div>`)).join('')}`)}`;
  $('#gallq')?.addEventListener('change', (e) => setGioAll(e.target.value));
  if (feed) NW.fillCalCard(main, fam, f);
  if (feed && !NW.cached(fam)) NW.loadPosts(fam).then(() => { if (route().view === 'lich') render(); }, () => {});
}

// ---------- needs info ----------
function verify() {
  const rows = M.all.filter((p) => p.data.verify);
  const kind = (v) => /tên/i.test(v) ? 'ten' : /con cháu/i.test(v) ? 'con' : /thông tin/i.test(v) ? 'tt' : 'khac';
  const K = [['ten', 'Thiếu tên'], ['tt', 'Thiếu thông tin'], ['con', 'Thiếu con cháu'], ['khac', 'Khác']];
  const st = verify.st || (verify.st = { k: '', q: '', fam: '' });
  const show = rows.filter((p) => (!st.fam || p.fam === st.fam) && (!st.k || kind(p.data.verify) === st.k) && (!st.q || fold(rank(p.data) + ' ' + p.data.name + ' ' + p.data.verify).includes(st.q)));
  const setKind = (k) => { st.k = k; render(); };
  const quick = `<select id="vkq" aria-label="Loại">${[['', 'Tất cả loại'], ...K].map(([k, l]) => `<option value="${k}" ${st.k === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  main.innerHTML = `<h1>Cần bổ sung</h1>${toolbar({ id: 'vq', ph: 'Tìm tên hoặc nội dung cần bổ sung', val: st.qRaw || '', active: (st.k ? 1 : 0) + (st.fam ? 1 : 0), quick: quick + (multiFam() ? famSelect('vfam', st.fam) : '') })}
  ${ltags([st.fam && ['fam', 'Dòng họ: ' + S.familyLabel(st.fam)], st.k && ['k', K.find((x) => x[0] === st.k)[1]]].filter(Boolean))}
  <p class="sub lcount">${show.length}${show.length !== rows.length ? ' / ' + rows.length : ''} chỗ còn thiếu</p>
  ${fpanel(`<fieldset class="fset"><legend>Loại</legend>${[['', 'Tất cả'], ...K].map(([k, l]) => `<label class="radio"><input type="radio" name="vk" value="${k}" ${st.k === k ? 'checked' : ''}> ${l} (${rows.filter((p) => !k || kind(p.data.verify) === k).length})</label>`).join('')}</fieldset>`)}
  ${card(`${show.map((p) => personItem({ rank: rank(p.data), name: nameOf(p.data), sex: p.data.sex }, { href: ph(p, `person/${p.id}`), badge: famChipIf(p), sub: esc(p.data.verify) })).join('') || emptyState('Không có mục nào.')}`)}`;
  $('#vq').oninput = (e) => { clearTimeout(verify.t); verify.t = setTimeout(() => { st.qRaw = e.target.value; st.q = fold(e.target.value).trim(); render(); const i = $('#vq'); i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length); }, 200); };
  $('#vkq')?.addEventListener('change', (e) => setKind(e.target.value));
  $('#vfam')?.addEventListener('change', (e) => { st.fam = e.target.value; render(); });
  main.querySelectorAll('input[name=vk]').forEach((r) => { r.onchange = () => setKind(r.value); });
  setUntag((k) => { if (k === 'fam') st.fam = ''; else if (k === '*') { st.fam = ''; st.k = ''; } else st.k = ''; render(); });
}

// ---------- map (MapLibre + OpenFreeMap, like estate) ----------
// Search + filters (Chi, Đời, Còn sống / Đã mất) narrow the markers AND the list under the map.
const MF = { q: '', qRaw: '', chi: '', gen: '', living: '', fam: '' };
// Family colours on the map (Carbon 60 hues, in scope order); a cluster takes the colour of its first person's family.
const FAM_PAL = ['#0f62fe', '#8a3ffc', '#198038', '#d02670', '#007d79', '#1192e8', '#da1e28', '#8a3800'];
const famIdx = (p) => Math.max(0, S.scopeFams().indexOf(p.fam || 'duong'));
// A cluster of one family takes its colour; a cluster with people of several families is neutral (fi -1, the match default).
const NEUTRAL = '#8d8d8d';
const groupFi = (g) => (g.people.every((p) => (p.fam || 'duong') === (g.people[0].fam || 'duong')) ? famIdx(g.people[0]) : -1);
const famColorExpr = () => ['match', ['get', 'fi'], ...S.scopeFams().flatMap((_, i) => [i, FAM_PAL[i % FAM_PAL.length]]), NEUTRAL];
let MAPX = null; let mapG = []; let mapSel = null; // MAPX = live maplibre map; mapG = clusters for the current filter
const mapPeople = () => {
  const q = fold(MF.q).trim();
  return M.everyone.filter((p) => (!q || fold(p.data.name + ' ' + (p.data.alias || '') + ' ' + (p.data.place || '')).includes(q))
    && (!MF.gen || String(genOf(M, p)) === MF.gen) && (!MF.living || (MF.living === 'dead') === isDead(p.data)) && inChi(M, p, MF.chi) && (!MF.fam || p.fam === MF.fam));
};
const mapGroups = (people) => {
  const groups = new Map();
  for (const p of people) { const l = locate(p.data); if (!l) continue; const k = l.lat + ',' + l.lon; if (!groups.has(k)) groups.set(k, { ...l, people: [] }); groups.get(k).people.push(p); }
  return [...groups.values()];
};
const fcOf = (groups) => ({ type: 'FeatureCollection', features: groups.map((g, i) => ({ type: 'Feature', id: i, properties: { n: g.people.length, prec: g.precision, i, fi: groupFi(g) }, geometry: { type: 'Point', coordinates: [g.lon, g.lat] } })) });
const mapRow = (p) => personItem({ rank: p.data.hidden_living ? '' : rank(p.data), name: nameOf(p.data), sex: p.data.sex }, { href: ph(p, `person/${p.id}`), badge: famChipIf(p), sub: `${p.data.hidden_living && !genOf(M, p) ? '' : `Đời ${genOf(M, p) || '?'}`}${years(p.data) ? ' · ' + years(p.data) : ''}${p.data.place ? ' · ' + esc(p.data.place) : ''}` });
// Filter bar (toolbar + fpanel + active tags). Rebuilt when a filter changes; the search box itself is kept.
// Chi and Đời options from the people on the map's side (all of them, not only the filtered ones).
function mapOpts() {
  const branches = branchesOf(M);
  const gens = [...new Set(M.all.map((p) => genOf(M, p)).filter(Boolean))].sort((a, b) => a - b);
  return { branches, gens,
    chi: `<option value="">Mọi chi</option>${branches.map((b) => `<option value="${b.id}">Chi ${esc(chiName(b.data.name))}</option>`).join('')}`,
    gen: `<option value="">Mọi đời</option>${gens.map((g) => `<option>${g}</option>`).join('')}` };
}
// Same-route re-render (a sync brought new branches or generations): the two lists are refreshed in place, the map is kept.
function mapFilterOpts() {
  const o = mapOpts(); const chi = $('#mchi'); const gen = $('#mgen');
  if (!chi || !gen) return;
  if (chi.dataset.h === o.chi && gen.dataset.h === o.gen) return;
  chi.dataset.h = o.chi; gen.dataset.h = o.gen;
  chi.innerHTML = o.chi; gen.innerHTML = o.gen;
  const keepChi = o.branches.some((b) => b.id === MF.chi), keepGen = o.gens.some((g) => String(g) === MF.gen);
  if (!keepChi || !keepGen) { if (!keepChi) MF.chi = ''; if (!keepGen) MF.gen = ''; mapTop(); return; } // a filter value that vanished: the bar is drawn again
  chi.value = MF.chi; gen.value = MF.gen;
}
function mapTop() {
  const { chi: chiOpts, gen: genOpts } = mapOpts();
  const LIV = { living: 'Còn sống', dead: 'Đã mất' };
  const tags = [MF.fam && ['fam', 'Dòng họ: ' + S.familyLabel(MF.fam)], MF.chi && ['chi', 'Chi ' + (M.byId.get(MF.chi)?.data.name || '')], MF.gen && ['gen', 'Đời ' + MF.gen], MF.living && ['living', LIV[MF.living]]].filter(Boolean);
  $('#mtop').innerHTML = `${toolbar({ id: 'mq', ph: 'Tìm tên, tên khác, nơi sống', val: MF.qRaw, active: tags.length, quick: multiFam() ? famSelect('mfam', MF.fam) : '', add: addBtn('data-add="map"', 'Thêm người') })}${ltags(tags)}
    ${fpanel(`${multiFam() ? `<label>Dòng họ${famSelect('mfamp', MF.fam)}</label>` : ''}<label>Chi<select id="mchi">${chiOpts}</select></label>
      <label>Đời<select id="mgen">${genOpts}</select></label>
      <label>Tình trạng<select id="mliv"><option value="">Tất cả</option>${Object.entries(LIV).map(([v, l]) => `<option value="${v}" ${MF.living === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`)}`;
  const rebuild = () => { mapSel = null; mapTop(); paintMap(); };
  for (const id of ['#mfam', '#mfamp']) $(id)?.addEventListener('change', (e) => { MF.fam = e.target.value; rebuild(); });
  $('#mchi').onchange = (e) => { MF.chi = e.target.value; rebuild(); };
  $('#mgen').onchange = (e) => { MF.gen = e.target.value; rebuild(); };
  $('#mchi').value = MF.chi; $('#mgen').value = MF.gen; // option lists are drawn from the same source (mapFilterOpts)
  $('#mchi').dataset.h = chiOpts; $('#mgen').dataset.h = genOpts;
  $('#mliv').onchange = (e) => { MF.living = e.target.value; rebuild(); };
  setUntag((k) => { if (k === '*') Object.assign(MF, { chi: '', gen: '', living: '', fam: '' }); else MF[k] = ''; rebuild(); });
  mapWire();
}
function mapWire() {
  const inp = $('#mq');
  inp.oninput = (e) => { clearTimeout(mapWire.t); mapWire.t = setTimeout(() => { MF.qRaw = MF.q = e.target.value; mapSel = null; paintMap(); mapHits(); }, 200); };
  inp.onkeydown = (e) => { if (e.key === 'Enter') { const first = mapHitList()[0]; if (first) { e.preventDefault(); mapPick(first.id); } } };
}
// Type-ahead over every person (not only the filtered ones); picking one flies to its marker.
function mapHitList() { const q = fold(MF.qRaw).trim(); return q.length < 2 ? [] : M.all.filter((p) => fold(p.data.name + ' ' + (p.data.alias || '')).includes(q)).slice(0, 8); }
function mapHits() {
  const box = $('#mqhits'); if (!box) return;
  const hits = mapHitList();
  box.innerHTML = hits.length ? `${card(`${hits.map((p) => calmRow({ attrs: `data-pick="${p.id}"`, sex: p.data.sex, title: p.data.hidden_living ? nameOf(p.data) : `${rank(p.data)} ${p.data.name}`, subtitle: locate(p.data) ? 'Đời ' + (p.data.gen || '?') + (p.data.place ? ' · ' + esc(p.data.place) : '') : 'Chưa có nơi sống', dense: true })).join('')}`, { cls: 'mhits' })}` : '';
}
function mapPick(id) {
  const p = M.byId.get(id); if (!p) return;
  Object.assign(MF, { chi: '', gen: '', living: '', q: p.data.name, qRaw: p.data.name }); mapSel = null;
  mapTop(); $('#mqhits').innerHTML = '';
  paintMap();
  const g = mapG.find((x) => x.people.includes(p));
  if (!g) { $('#mcount').textContent = `${p.data.name} chưa có nơi sống nên chưa có trên bản đồ.`; return; }
  mapSel = g.key; mapList();
  if (MAPX?.loaded) { MAPX.m.flyTo({ center: [g.lon, g.lat], zoom: Math.max(MAPX.m.getZoom(), 11), duration: 800 }); mapPopup(g); }
}
function mapPopup(g) {
  if (!MAPX?.m || !window.maplibregl) return;
  MAPX.popup?.remove();
  const more = g.people.length > 12 ? `<span class="sub">và ${g.people.length - 12} người nữa, xem danh sách bên dưới</span>` : '';
  MAPX.popup = new maplibregl.Popup({ maxWidth: '260px', offset: 12 }).setLngLat([g.lon, g.lat])
    .setHTML(`<b>${esc(g.key)}</b><ul class="mpop">${g.people.slice(0, 12).map((p) => `<li><a href="${ph(p, `person/${p.id}`)}">${p.data.hidden_living ? esc(nameOf(p.data)) : `${esc(rank(p.data))} ${esc(p.data.name)}`}</a></li>`).join('')}</ul>${more}`).addTo(MAPX.m);
}
function mapList() { renderMapList(mapG, mapPeople()); }
function renderMapList(groups, people) {
  const box = $('#maplist'); if (!box) return;
  const g = mapSel && groups.find((x) => x.key === mapSel);
  if (g) { box.innerHTML = `<div class="row btw"><b>${esc(g.key)}</b><button type="button" class="btn ter sm" data-mall>Tất cả</button></div>` + g.people.map(mapRow).join(''); return; }
  mapSel = null;
  const placed = people.filter((p) => locate(p.data));
  box.innerHTML = placed.length ? `<span class="sub">${placed.length} người. Bấm một cụm trên bản đồ để xem riêng nơi đó.</span>` + placed.slice(0, 300).map(mapRow).join('') : '<span class="sub">Không có người nào khớp bộ lọc và có nơi sống.</span>';
}
// Markers, count line and list all follow the same filtered set.
function paintMap() {
  const people = mapPeople();
  mapG = mapGroups(people);
  const placed = mapG.reduce((s, g) => s + g.people.length, 0);
  const c = $('#mcount'); if (c) c.textContent = `${people.length} người khớp · ${placed} có nơi sống trên bản đồ`;
  if (MAPX?.loaded) MAPX.m.getSource('pp')?.setData(fcOf(mapG));
  renderMapList(mapG, people);
}
function mapInit() {
  const m = new maplibregl.Map({ container: 'mapc', style: `https://tiles.openfreemap.org/styles/${isDark() ? 'dark' : 'positron'}`, center: [106.25, 11.15], zoom: 8.3, attributionControl: { compact: true } });
  MAPX = { m, loaded: false, popup: null, node: $('#mapc') };
  m.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  new ResizeObserver(() => m.resize()).observe($('#mapc'));
  m.on('load', () => {
    MAPX.loaded = true;
    m.resize();
    $('#mapc .maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'); // start collapsed (i button)
    // keep every cluster in view, above the bottom sheet on phones (Huế / Mỹ / Úc are listed, not framed)
    const near = mapG.filter((g) => g.lat > 8 && g.lat < 13 && g.lon > 104 && g.lon < 108);
    if (near.length) {
      const lons = near.map((g) => g.lon), lats = near.map((g) => g.lat);
      const sheet = $('#maplist'); const cover = getComputedStyle(sheet).position === 'fixed' ? Math.max(0, $('#mapc').getBoundingClientRect().bottom - sheet.getBoundingClientRect().top) : 0;
      m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: { top: 30, left: 30, right: 50, bottom: 30 + cover }, maxZoom: 11, duration: 0 });
    }
    m.addSource('pp', { type: 'geojson', data: fcOf(mapG) });
    m.addLayer({ id: 'c', type: 'circle', source: 'pp', paint: { 'circle-color': multiFam() ? famColorExpr() : ['match', ['get', 'prec'], 'exact', '#0f62fe', 'approx', '#8a3ffc', '#8d8d8d'], 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-radius': ['+', 9, ['*', 4, ['sqrt', ['get', 'n']]]] } });
    m.addLayer({ id: 'n', type: 'symbol', source: 'pp', layout: { 'text-field': ['to-string', ['get', 'n']], 'text-size': 12, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#fff' } });
    m.on('click', 'c', (e) => { const g = mapG[e.features[0].properties.i]; if (!g) return; mapSel = g.key; mapList(); mapPopup(g); });
    m.on('mouseenter', 'c', () => { m.getCanvas().style.cursor = 'pointer'; }); m.on('mouseleave', 'c', () => { m.getCanvas().style.cursor = ''; });
  });
}
function map() {
  if (MAPX?.m) { try { MAPX.m.remove(); } catch {} }
  MAPX = null; mapG = []; mapSel = null;
  main.innerHTML = `<h1>Bản đồ nơi sống</h1><div id="mtop" class="stk"></div>
   <p class="sub lcount" id="mcount"></p><div id="mqhits"></div>
   <div class="mapw"><div id="mapc" class="mapc" role="region" aria-label="Bản đồ"></div>${card(``, { cls: 'mlist', attrs: `id="maplist"` })}</div>
   ${multiFam() ? `<div class="legend" aria-label="Màu theo dòng họ">${S.scopeFams().map((f, i) => tag(esc(S.familyName(f)), { kind: 'family', lead: `<i class="dot" style="background:${FAM_PAL[i % FAM_PAL.length]}"></i>` })).join('')}${tag('Nhiều dòng họ', { kind: 'family', lead: `<i class="dot" style="background:${NEUTRAL}"></i>` })}</div>`
     : '<div class="legend"><span class="dot" style="background:var(--c-accent)"></span>Đúng xã/ấp <span class="dot" style="background:var(--c1)"></span>Gần đúng <span class="dot" style="background:var(--c-border-strong)"></span>Chỉ tỉnh/nước</div>'}`;
  mapTop();
  $('#mqhits').onclick = (e) => { const b = e.target.closest('[data-pick]'); if (b) mapPick(b.dataset.pick); };
  $('#maplist').onclick = (e) => { if (e.target.closest('[data-mall]')) { mapSel = null; MAPX?.popup?.remove(); mapList(); } };
  if (!window.maplibregl) { $('#mapc').innerHTML = emptyState('Bản đồ cần mạng để tải. Danh sách nơi sống vẫn xem được bên cạnh.'); paintMap(); return; }
  mapInit();
  paintMap();
}

// ---------- exports ----------
function exportView() {
  if (S.isAll()) { famPicker('export', 'Tải về', 'Chọn dòng họ để tải về.'); return; }
  main.innerHTML = `<h1>Tải về</h1>
  ${card(`<button class="btn" id="xcsv">Tải file Excel (.csv)</button><span class="sub">Mỗi người một dòng. Mở bằng Excel hoặc Google Sheets.</span>`)}
  ${card(`${calmRow({ attrs: 'id="xsvg"', title: 'Cây gia phả (SVG)', subtitle: 'Phóng to không vỡ', dense: true })}${calmRow({ href: '/book', title: 'Sách PDF', subtitle: 'Mở Sách, bấm In rồi chọn "Lưu dưới dạng PDF"', dense: true })}`)}
  <p class="sub">Liên hệ người còn sống chỉ có trong file khi họ cho phép công khai.</p>`;
  $('#xcsv').onclick = () => {
    const cols = ['id', 'gen', 'thu', 'name', 'sex', 'parent', 'spouse', 'born', 'died', 'death_lunar', 'gio_lunar', 'place', 'alias', 'job', 'religion', 'burial', 'phone', 'email', 'zalo', 'facebook', 'note', 'verify', 'source'];
    const head = ['ID', 'Đời', 'Thứ', 'Họ tên', 'Giới tính', 'Cha/Mẹ (ID)', 'Vợ/Chồng', 'Năm sinh', 'Năm mất', 'Ngày mất (ÂL)', 'Ngày giỗ (ÂL)', 'Nơi sống', 'Tên khác', 'Nghề', 'Tôn giáo', 'An táng', 'Điện thoại', 'Email', 'Zalo', 'Facebook', 'Ghi chú', 'Cần xác minh', 'Nguồn'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(',')].concat(M.everyone.map((p) => cols.map((c) => q(c === 'id' ? p.id : c === 'sex' ? (p.data.sex === 'f' ? 'Nữ' : 'Nam') : ['phone', 'email', 'zalo', 'facebook'].includes(c) ? contactList(p.data).filter((x) => x.type === c).map((x) => x.value).join('; ') : p.data[c])).join(',')));
    download('gia-pha-ho-duong.csv', '﻿' + lines.join('\r\n'), 'text/csv');
  };
  $('#xsvg').onclick = () => download('cay-gia-pha-ho-duong.svg', treeSvg(), 'image/svg+xml');
}
function treeSvg() {
  const rows = []; const walk = (p, d) => { rows.push([p, d]); M.kids(p.id).forEach((c) => walk(c, d + 1)); }; M.roots.forEach((r) => walk(r, 0));
  const H = 18, W = 900;
  const body = rows.map(([p, d], i) => `<g transform="translate(${10 + d * 22},${20 + i * H})"><text x="0" y="0" font-size="12" fill="${p.data.sex === 'f' ? '#9f1853' : '#0043ce'}">${esc(rank(p.data))} <tspan font-weight="700" fill="#161616">${esc(p.data.name)}</tspan>${years(p.data) ? ' · ' + esc(years(p.data)) : ''}</text></g>`).join('');
  const lines = rows.map(([p, d], i) => d ? `<line x1="${10 + (d - 1) * 22 + 4}" x2="${10 + d * 22 - 4}" y1="${16 + i * H - 4}" y2="${16 + i * H - 4}" stroke="#c6c6c6"/>` : '').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${rows.length * H + 30}" font-family="Noto Serif, Georgia, serif"><rect width="100%" height="100%" fill="#fff"/>${lines}${body}</svg>`;
}
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

// ---------- review of anonymous suggestions (editors) ----------
// field label (F is defined further down, so look it up at call time)
const FL = (k) => ({ parent: 'Cha/mẹ', order: 'Thứ tự', source: 'Nguồn', _rel: 'Quan hệ' }[k] || F.find((f) => f[0] === k)?.[1] || k);
function sugShow(field, v) {
  if (v === null || v === undefined || v === '') return '(trống)';
  if (field === 'parent' || field === 'other_parent') return M.byId.get(v)?.data.name || String(v);
  const opt = F.find((f) => f[0] === field && f[2]);
  return opt ? (opt[2].find(([x]) => x === String(v))?.[1] ?? String(v)) : String(v);
}
// ---------- Góp ý: one page, two tabs for reviewers (Cần duyệt · Của tôi); everyone else sees only their own ----------
// #review and #mine are the tab routes (old links keep working); #gop-y opens Cần duyệt when something waits, else Của tôi.
function gopyHead(tab) {
  if (!canAdminHere()) return '<h1>Góp ý</h1>';
  const t = (k, label) => `<a role="tab" class="ptab${tab === k ? ' on' : ''}" href="${hf(k)}" aria-selected="${tab === k}"${tab === k ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<h1>Góp ý</h1><nav class="ptabs gopy-tabs" role="tablist" aria-label="Góp ý">${t('review', `Cần duyệt${sugCount ? ` (${sugCount})` : ''}`)}${t('mine', 'Của tôi')}</nav>`;
}
async function gopyOpen() {
  let n = 0;
  if (canAdminHere()) n = (await Promise.all(famsFor('review').map((f) => S.listSuggestions('pending', f).then((j) => j.counts?.pending || 0, () => 0)))).reduce((a, b) => a + b, 0);
  if (route().view === 'gop-y') location.replace(hf(n > 0 ? 'review' : 'mine'));
}
function review(arg) {
  if (!canAdminHere()) { location.replace(hf('mine')); return; } // the reviewer tab only exists for reviewers
  const st = review.st || (review.st = { status: 'pending', qRaw: '', q: '', fam: '' });
  const SL = [['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['rejected', 'Từ chối']];
  const quick = `<select id="rst" aria-label="Trạng thái">${SL.map(([v, l]) => `<option value="${v}" ${st.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${multiHere() ? famSelect('rfam', st.fam, famsHere()) : ''}`;
  const tags = [st.status !== 'pending' && ['st', SL.find((x) => x[0] === st.status)[1]], st.fam && ['fam', 'Dòng họ: ' + S.familyLabel(st.fam)]].filter(Boolean);
  main.innerHTML = `${gopyHead('review')}${toolbar({ id: 'rq', ph: 'Tìm tên người hoặc nội dung góp ý', val: st.qRaw, active: (st.status !== 'pending' ? 1 : 0) + (st.fam ? 1 : 0), quick: quick })}
   ${ltags(tags)}
   <p class="sub lcount" id="rcount"></p>
   ${fpanel(`${multiHere() ? `<label>Dòng họ${famSelect('rfamp', st.fam, famsHere())}</label>` : ''}<fieldset class="fset"><legend>Trạng thái</legend>${SL.map(([v, l]) => `<label class="radio"><input type="radio" name="rs" value="${v}" ${st.status === v ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>`)}
   <div id="rlist"><p class="sub pad">Đang tải…</p></div>`;
  const setStatus = (v) => { st.status = v; render(); };
  $('#rst')?.addEventListener('change', (e) => setStatus(e.target.value));
  for (const id of ['#rfam', '#rfamp']) $(id)?.addEventListener('change', (e) => { st.fam = e.target.value; render(); });
  main.querySelectorAll('input[name=rs]').forEach((r) => { r.onchange = () => setStatus(r.value); });
  $('#rq').oninput = (e) => { clearTimeout(review.t); review.t = setTimeout(() => { st.qRaw = e.target.value; st.q = fold(e.target.value).trim(); paintReview(); const i = $('#rq'); i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length); }, 200); };
  setUntag((k) => { if (k === '*' || k === 'st') st.status = 'pending'; if (k === '*' || k === 'fam') st.fam = ''; render(); });
  loadReview();
  for (const f of famsHere()) LK.ensure(f);
  const xl = document.createElement('div'); xl.id = 'xlpend'; xl.innerHTML = famsHere().map((f) => LK.pendingHtml(f)).join('');
  main.insertBefore(xl, $('#rlist')); for (const f of famsHere()) LK.wirePending(xl, f);
  PL.reviewSection(main, $('#rlist'));
  MT.reviewSection(main, $('#rlist'), famsHere(), (f, pid) => `#/${f}/person/${pid}`);
  DP.reviewSection(main, $('#rlist'), famsHere());
}
// The inbox of every family in scope (one family: that family). Rows keep their family; each card shows its chip in "Tất cả".
async function loadReview() {
  if (route().view !== 'review' || !$('#rlist')) return;
  const fams = famsFor('review');
  try {
    const got = await Promise.all(fams.map((f) => S.listSuggestions(review.st.status, f).then((j) => ({ f, j }))));
    review.rows = got.flatMap(({ f, j }) => j.items.map((s) => ({ ...s, fam: f }))).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const pend = got.reduce((n, { j }) => n + (j.counts.pending || 0), 0);
    if (pend !== sugCount) { sugCount = pend; chrome(); const tb = main.querySelector('.gopy-tabs [href$="review"]'); if (tb) tb.textContent = `Cần duyệt${pend ? ` (${pend})` : ''}`; }
    paintReview();
  } catch (e) { if ($('#rlist')) $('#rlist').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
// Cần duyệt: one compact row per suggestion (shared person row): the change inline, a one-line meta, ✓ / ✕ beside the row.
// Tap the row to expand it (every field old → new, the full note, the sender; checkboxes only when 2+ fields). Identical
// duplicates (same person, changes, sender) collapse into one row "×N" that acts on all. A person with several rows gets a
// header and the rows show the change as their title. "Chọn nhiều" adds checkboxes and bulk Duyệt / Từ chối.
const rvKey = (s) => [s.fam, s.person_id || s.person_name, s.by_name, s.by_contact, JSON.stringify(s.changes.map((c) => [c.field, c.proposed ?? c.new]))].join('|');
const rvSummary = (s) => {
  if (s.rel_label) return esc(s.rel_label);
  const one = (c) => `${esc(FL(c.field))}: ${s.is_new ? '' : `${esc(sugShow(c.field, c.current ?? c.old) || '(trống)')} → `}${esc(sugShow(c.field, c.proposed ?? c.new))}`;
  if (s.changes.length === 1) return one(s.changes[0]);
  return `${s.changes.slice(0, 2).map((c) => esc(FL(c.field))).join(', ')}${s.changes.length > 2 ? ` +${s.changes.length - 2}` : ''}`;
};
const rvMeta = (s) => [esc(s.by_name || 'Khách'), fmtTime(s.created_at)].join(' · ');
// The note: its own line, wrapped in full; a long note (> ~240 characters) shows 3 lines + "Xem thêm" (tap the row = full note).
const NOTE_LONG = 240;
const rvNote = (n) => (!n ? '' : n.length > NOTE_LONG ? `<span class="rv-nt rv-clamp">“${esc(n)}”</span><span class="rv-xm" aria-hidden="true">Xem thêm</span>` : `<span class="rv-nt">“${esc(n)}”</span>`);
function paintReview() {
  const box = $('#rlist'); if (!box || !review.rows) return;
  const st = review.st; const sel = review.sel || (review.sel = { on: false, ids: new Set() });
  const rows = review.rows.filter((s) => (!st.fam || s.fam === st.fam) && (!st.q || fold([s.person_name, s.note, s.by_name, ...s.changes.map((c) => FL(c.field))].join(' ')).includes(st.q)));
  const filtered = !!(st.q || st.fam || st.status !== 'pending');
  $('#rcount').textContent = filtered ? `${rows.length} kết quả` : '';
  // collapse identical duplicates, then group by person (first appearance keeps the order)
  const dup = new Map(); for (const s of rows) { const k = rvKey(s); if (dup.has(k)) dup.get(k).ids.push(s.id); else dup.set(k, { s, ids: [s.id] }); }
  const byPerson = new Map(); for (const g of dup.values()) { const k = g.s.fam + '|' + (g.s.person_id || g.s.person_name); if (!byPerson.has(k)) byPerson.set(k, []); byPerson.get(k).push(g); }
  const ico = (n) => cic(n, 20);
  const item = ({ s, ids }, grouped) => {
    const pend = s.status === 'pending'; const idl = ids.join(',');
    const hasConflict = pend && s.changes.some((c) => c.status === 'conflict');
    const status = s.status === 'approved' ? ' · Đã duyệt' : s.status === 'rejected' ? ` · Từ chối${s.reason ? ': ' + esc(s.reason) : ''}` : '';
    const title = grouped ? '' : (s.is_new ? `Người mới: ${s.person_name || '(chưa có tên)'}` : s.person_name);
    const times = ids.length > 1 ? ` <span class="tag gray sm">×${ids.length}</span>` : '';
    const sub = `${grouped ? '' : `<span class="rv-ch">${rvSummary(s)}</span>`}<span class="rv-meta">${chipOf(s.fam)}${rvMeta(s)}${status}</span>${rvNote(s.note)}`;
    const acts = pend ? calmAct({ icon: ico('check'), label: `Duyệt góp ý cho ${s.person_name || 'người mới'}`, attrs: `data-rv="approve" data-id="${idl}"${hasConflict ? ' data-conflict="1"' : ''}` })
      + calmAct({ icon: ico('close'), label: `Từ chối góp ý cho ${s.person_name || 'người mới'}`, attrs: `data-rv="reject" data-id="${idl}"` }) : '';
    const pick = sel.on && pend ? `<label class="rv-sel"><input type="checkbox" data-rvsel="${idl}" ${ids.every((i) => sel.ids.has(String(i))) ? 'checked' : ''} aria-label="Chọn góp ý"></label>` : '';
    const row = calmRow({ attrs: `data-rvx aria-expanded="false" aria-controls="rvm-${ids[0]}"`, tile: grouped ? '' : surnameTile(s.person_name || '?'), title: grouped ? '' : title, subtitle: grouped ? `<span class="rv-ch rv-ch1">${rvSummary(s)}${times}</span>${sub}` : sub, badge: grouped ? '' : times, trailing: 'none', action: acts, sex: grouped ? '' : M.byId.get(s.person_id)?.data.sex });
    const link = s.is_new ? '' : `<a class="sub" href="${rowHref(s.fam, `person/${esc(s.person_id)}`)}">Mở hồ sơ ›</a>`;
    const more = `<div class="rv-more" id="rvm-${ids[0]}" hidden>${reviewDiff(s, pend)}${s.note ? `<p class="rv-note">“${esc(s.note)}”</p>` : ''}<span class="sub">${esc(s.by_name || 'Khách')}${s.by_contact ? ' · liên hệ: ' + esc(s.by_contact) : ''} · ${fmtTime(s.created_at)}</span>${link}</div>`;
    return `<div class="rv${sel.on ? ' rv-pick' : ''}" data-ids="${idl}">${pick}${row}${more}</div>`;
  };
  const html = [...byPerson.values()].map((gs) => (gs.length > 1
    ? `<section class="rv-grp"><h3 class="rv-ph">${surnameTile(gs[0].s.person_name || '?')}<span>${esc(gs[0].s.person_name || 'Người mới')}</span><span class="sub">${gs.reduce((n, g) => n + g.ids.length, 0)} góp ý</span></h3>${gs.map((g) => item(g, true)).join('')}</section>`
    : item(gs[0], false))).join('');
  const nSel = sel.ids.size;
  const bar = st.status === 'pending' && rows.length ? `<div class="row btw rv-bar">${sel.on
    ? `<span class="sub">Đã chọn ${nSel}</span><span class="row"><button type="button" class="btn ter sm" data-rvbulk="reject" ${nSel ? '' : 'disabled'}>Từ chối (${nSel})</button><button type="button" class="btn sm" data-rvbulk="approve" ${nSel ? '' : 'disabled'}>Duyệt (${nSel})</button><button type="button" class="btn gh sm" data-rvbulk="off">Xong</button></span>`
    : `<span></span><button type="button" class="btn gh sm" data-rvbulk="on">Chọn nhiều</button>`}</div>` : '';
  box.innerHTML = rows.length ? `${bar}${card(`${html}`, { cls: 'rv-list' })}` : emptyState('Không có góp ý nào.');
}
// One row per changed field. Clean: checkbox (checked = apply). Conflict: choose current / proposed / base / typed value.
function reviewDiff(s, pend) {
  if (s.rel_label) return `<div class="frow"><b>Quan hệ</b> <span>${esc(s.rel_label)}</span></div>`;
  return s.changes.map((c) => {
    const name = `${s.id}-${c.field}`;
    if (!pend) return `<div class="frow"><b>${esc(FL(c.field))}</b> <span>${esc(sugShow(c.field, c.new))}</span></div>`;
    if (c.status !== 'conflict' && s.changes.length < 2) return `<div class="frow"><span><b>${esc(FL(c.field))}</b> ${s.is_new ? '' : `<span class="sub">${esc(sugShow(c.field, c.current))}</span> → `}<span>${esc(sugShow(c.field, c.proposed))}</span></span></div>`;
    if (c.status !== 'conflict') return `<div class="frow"><label class="ck"><input type="checkbox" data-clean="${esc(c.field)}" checked><span><b>${esc(FL(c.field))}</b> ${s.is_new ? '' : `<span class="sub">${esc(sugShow(c.field, c.current))}</span> → `}<span>${esc(sugShow(c.field, c.proposed))}</span></span></label></div>`;
    const opt = (v, label, dis = '') => `<label class="radio"><input type="radio" name="res-${name}" value="${v}"${dis}> ${label}</label>`;
    return `<div class="frow conf"><div class="row btw"><b>${esc(FL(c.field))}</b><span class="tag red sm">Xung đột</span></div>
      <div class="res" data-field="${esc(c.field)}" data-base="${esc(JSON.stringify(c.base ?? null))}">
        ${opt('base', `Lúc góp ý: <b>${esc(sugShow(c.field, c.base))}</b>${c.unknown_base ? ' (không rõ)' : ''}`, c.unknown_base ? ' disabled' : '')}
        ${opt('current', `Hiện tại: <b>${esc(sugShow(c.field, c.current))}</b>`)}
        ${opt('proposed', `Đề xuất: <b>${esc(sugShow(c.field, c.proposed))}</b>`)}
        <label class="radio"><input type="radio" name="res-${name}" value="manual"> Sửa tay</label>
        <input type="text" data-manual aria-label="Giá trị sửa tay: ${esc(FL(c.field))}" placeholder="Nhập giá trị">
      </div></div>`;
  }).join('');
}
// The decision for one card: { ok, fields }. ok = every conflict has a choice (and a typed value if "Sửa tay").
function decisionOf(card) {
  const fields = {}; let ok = true;
  card.querySelectorAll('input[data-clean]').forEach((c) => { fields[c.dataset.clean] = c.checked ? 'proposed' : 'current'; });
  card.querySelectorAll('.res').forEach((box) => {
    const sel = box.querySelector('input[type=radio]:checked'); const f = box.dataset.field;
    if (!sel) { ok = false; return; }
    if (sel.value === 'base') fields[f] = { custom: JSON.parse(box.dataset.base) };
    else if (sel.value === 'manual') { const t = box.querySelector('[data-manual]').value.trim(); if (!t) { ok = false; return; } fields[f] = { custom: t }; }
    else fields[f] = sel.value; // current | proposed
  });
  return { ok, fields };
}
const refreshApprove = (card) => { const btn = card.querySelector('[data-rv="approve"]'); if (btn) btn.disabled = !decisionOf(card).ok; };
document.addEventListener('change', (e) => { const c = e.target.closest?.('#rlist .rv'); if (c) refreshApprove(c); });
document.addEventListener('input', (e) => { const c = e.target.closest?.('#rlist .rv'); if (c) refreshApprove(c); });
// Từ chối: the reason is optional (shown to the sender). ids: one row's ids (duplicates) or the bulk selection.
function rejectDialog(ids) {
  const list = String(ids).split(',').filter(Boolean);
  dialog(`<h2>Từ chối ${list.length > 1 ? `${list.length} góp ý` : 'góp ý'}</h2><label class="fld">Lý do (không bắt buộc, gửi cho người góp ý)<input name="reason" maxlength="500"></label><div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn dng">Từ chối</button></div>`,
    async (f) => { for (const id of list) await S.reviewSuggestion(id, 'reject', f.get('reason') || ''); review.sel?.ids.clear(); refreshSugCount(true); await loadReview(); });
}
// Duyệt one row: the first id with the row's field choices; its identical duplicates are closed as "Trùng".
async function approveIds(card, ids) {
  const pick = decisionOf(card);
  if (!pick.ok) { const m = card.querySelector('.rv-more'); if (m) { m.hidden = false; card.querySelector('[data-rvx]')?.setAttribute('aria-expanded', 'true'); } toast('Chọn giá trị cho trường xung đột rồi duyệt.'); return false; }
  const [first, ...rest] = ids;
  await S.approveSuggestion(first, pick.fields);
  for (const id of rest) await S.reviewSuggestion(id, 'reject', 'Trùng với góp ý đã duyệt.');
  return true;
}
main.addEventListener('click', async (e) => {
  const nm = e.target.closest('[data-note-more]');
  if (nm) { nm.parentElement.querySelector('.rv-clamp')?.classList.remove('rv-clamp'); nm.remove(); return; }
  const x = e.target.closest('[data-rvx]');
  if (x && $('#rlist')?.contains(x)) { const card = x.closest('.rv'); const m = card.querySelector('.rv-more'); const open = m.hidden; m.hidden = !open; x.setAttribute('aria-expanded', String(open)); return; }
  const bulk = e.target.closest('[data-rvbulk]');
  if (bulk) {
    const sel = review.sel || (review.sel = { on: false, ids: new Set() }); const a = bulk.dataset.rvbulk;
    if (a === 'on' || a === 'off') { sel.on = a === 'on'; sel.ids.clear(); return paintReview(); }
    const ids = [...sel.ids]; if (!ids.length) return;
    if (a === 'reject') return rejectDialog(ids.join(','));
    bulk.disabled = true; let skipped = 0;
    for (const card of [...$('#rlist').querySelectorAll('.rv')]) {
      const own = card.dataset.ids.split(','); if (!own.some((i) => sel.ids.has(i))) continue;
      try { if (!(await approveIds(card, own))) skipped++; } catch (err) { toast(err.message); skipped++; }
    }
    sel.ids.clear(); sel.on = false; await S.sync(); refreshSugCount(true); await loadReview();
    if (skipped) toast(`${skipped} góp ý cần chọn giá trị: mở từng góp ý để duyệt.`);
    return;
  }
  const b = e.target.closest('[data-rv]'); if (!b) return;
  if (b.dataset.rv === 'reject') return rejectDialog(b.dataset.id);
  b.disabled = true;
  try { if (await approveIds(b.closest('.rv'), b.dataset.id.split(','))) { await S.sync(); refreshSugCount(true); await loadReview(); } else b.disabled = false; }
  catch (err) { alert(err.message); b.disabled = false; }
});
main.addEventListener('change', (e) => {
  const c = e.target.closest?.('[data-rvsel]'); if (!c) return;
  const sel = review.sel; for (const id of c.dataset.rvsel.split(',')) { if (c.checked) sel.ids.add(id); else sel.ids.delete(id); }
  paintReview();
});

// ---------- members & roles (owner + admin) ----------
const ROLE_LBL = { owner: 'Chủ họ', admin: 'Quản trị', editor: 'Biên tập', member: 'Thành viên', guest: 'Khách' };
const ROLE_TAG = { owner: 'purple', admin: 'blue', editor: 'green', member: 'gray', guest: 'magenta' };
const ROLE_DESC = [['owner', 'Toàn quyền, giao quyền.'], ['admin', 'Sửa trực tiếp, duyệt đóng góp, mời người.'], ['editor', 'Sửa trực tiếp, có lịch sử và hoàn tác.'], ['member', 'Xem thông tin riêng tư. Sửa = đề xuất chờ duyệt.'], ['guest', 'Chỉ xem năm sinh và người đã mất. Đề xuất chờ duyệt.']];
const roleTag = (r) => tag(ROLE_LBL[r] || r, { tone: ROLE_TAG[r] || 'gray' });
// Roles the current user may hand out: only the owner sees Quản trị / Chủ họ.
const roleChoices = (f = S.curFamily()) => (S.roleIn(f) === 'owner' ? ['owner', 'admin', 'editor', 'member'] : ['editor', 'member']);
const roleSelect = (id, val, f = S.curFamily()) => `<select id="${id}" name="${id}" aria-label="Vai trò">${roleChoices(f).map((r) => `<option value="${r}" ${r === val ? 'selected' : ''}>${ROLE_LBL[r]}</option>`).join('')}</select>`;
const mst = { q: '', role: '', fam: '' };
let membersData = null;
const sinceDate = (t) => fmtDate(t);
function claimText(m) {
  if (m.person_id) return `Tự nhận là: <a class="plink" href="${rowHref(m.fam, `person/${esc(m.person_id)}`)}">${esc(m.person_name || '(không rõ)')}${M.byId.get(m.person_id)?.data.gen ? ` (Đời ${M.byId.get(m.person_id).data.gen})` : ''}</a>`;
  if (m.relation && m.rel_person_id) return `${{ spouse_of: 'Vợ-chồng của', child_of: 'Con của', grandchild_of: 'Cháu của' }[m.relation]} <a class="plink" href="${rowHref(m.fam, `person/${esc(m.rel_person_id)}`)}">${esc(m.rel_name || '')}</a>`;
  return 'Chưa có trong gia phả';
}
function members() {
  if (!canAdminHere()) { main.innerHTML = `<h1>Thành viên &amp; quyền</h1><p class="sub">${S.isAll() ? 'Bạn chưa có quyền quản trị dòng họ nào.' : 'Chỉ Chủ họ và Quản trị xem được trang này.'}</p>`; return; }
  const n = ROLE_DESC.length;
  main.innerHTML = `<h1>Thành viên &amp; quyền</h1>
    ${toolbar({ id: 'mq2', ph: 'Tìm theo tên hoặc email', val: mst.q, active: (mst.role ? 1 : 0) + (mst.fam ? 1 : 0), extra: `<button type="button" class="fbtn" id="minv" aria-label="Mời thành viên" title="Mời thành viên">${icon('invite')}</button>` })}
    ${fpanel(`${multiHere() ? `<label>Dòng họ${famSelect('mfamp2', mst.fam, famsHere())}</label>` : ''}<fieldset class="fset"><legend>Vai trò</legend>${[['', 'Tất cả'], ...ROLE_DESC.slice(0, n - 1)].map(([v, l]) => `<label class="radio"><input type="radio" name="mrole" value="${v}" ${mst.role === v ? 'checked' : ''}> ${ROLE_LBL[v] || l}</label>`).join('')}</fieldset>`)}
    ${mst.fam && multiHere() ? ltags([['fam', 'Dòng họ: ' + S.familyLabel(mst.fam)]]) : ''}
    <div id="mbody"><p class="sub pad">Đang tải…</p></div>
    ${card(`${calmRow({ href: hf('vai-tro'), title: 'Vai trò và quyền', dense: true })}`)}`;
  setUntag((k) => { if (k === '*' || k === 'role') mst.role = ''; if (k === '*' || k === 'fam') mst.fam = ''; render(); });
  if (membersData) paintMembers();
  loadMembers();
}
// Members and join requests of every family on screen (one family, or every admin family in "Tất cả"); rows keep their family.
async function loadMembers() {
  try {
    const got = await Promise.all(famsFor('members').map((f) => S.listMembers(f).then((j) => ({ f, j }))));
    membersData = { items: got.flatMap(({ f, j }) => j.items.map((m) => ({ ...m, fam: f }))) };
    paintMembers(); refreshSugCount(true);
  }
  catch (e) { if ($('#mbody')) $('#mbody').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
function paintMembers() {
  const box = $('#mbody'); if (!box || !membersData) return;
  const q = fold(mst.q).trim();
  const keep = (m) => (!mst.role || m.role === mst.role) && (!mst.fam || m.fam === mst.fam) && (!q || fold(`${m.name || ''} ${m.first_name || ''} ${m.last_name || ''} ${m.email}`).includes(q));
  const pend = membersData.items.filter((m) => m.status === 'pending' && keep(m));
  const act = membersData.items.filter((m) => m.status === 'active' && keep(m));
  const canMenu = (m) => m.role !== 'owner' && (S.roleIn(m.fam) === 'owner' || !isTopRole(m.role));
  box.innerHTML = `${pend.length ? section(`Chờ duyệt (${pend.length})`, `
    ${pend.map((m) => `${card(`${chipOf(m.fam)}<div class="pq-h"><div class="grow"><span class="mname">${esc(m.name || m.email)}</span><span class="sub">${esc(m.email)} · gửi ${sinceDate(m.created_at)}</span></div></div>
      <p class="claim">${claimText(m)}</p>
      <label class="fld">Vai trò khi duyệt ${roleSelect('mrl-' + m.id, 'member', m.fam)}</label>
      <div class="row end"><button class="btn ter sm" type="button" data-mact="reject" data-id="${m.id}" data-fam="${esc(m.fam)}">Từ chối</button><button class="btn sm" type="button" data-mact="approve" data-id="${m.id}" data-fam="${esc(m.fam)}">Duyệt</button></div>`, { tag: 'article', cls: 'hl pq' })}`).join('')}`, { variant: 'members', id: 'h-pend' }) : ''}
    ${section(`Thành viên (${act.length})`, `${card(`${act.map((m) => `<div class="li mrow">${chipOf(m.fam)}<div class="grow"><span class="mname">${esc(m.name || m.email)}</span><span class="sub">${esc(m.email)}${m.person_name ? ' · đã gắn với ' + esc(m.person_name) : ''}</span></div>${roleTag(m.role)}
      ${canMenu(m) ? `${iconButton({ icon: 'more', label: `Tùy chọn cho ${m.name || m.email}`, attrs: `data-mmenu="${m.id}"` })}` : ''}</div>`).join('') || emptyState('Không có thành viên nào khớp.')}`, { cls: 'mem-list' })}`, { variant: 'members', id: 'h-mem' })}`;
}
const isTopRole = (r) => r === 'owner' || r === 'admin';
function memberById(id) { return membersData?.items.find((m) => String(m.id) === String(id)); }
function roleDialog(m) {
  dialog(`<h2>Đổi vai trò</h2><p class="sub">${esc(m.name || m.email)}</p><label class="fld">Vai trò ${roleSelect('mrs', m.role, m.fam)}</label>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn">Lưu</button></div>`,
    async (f) => { await S.setMemberRole(m.id, f.get('mrs'), m.fam); loadMembers(); });
}
function inviteDialog() {
  const fams = famsHere(); const def = mst.fam || fams[0];
  const famField = multiHere() ? `<label class="fld">Dòng họ<select name="fam">${fams.map((f) => `<option value="${esc(f)}" ${f === def ? 'selected' : ''}>${esc(S.familyName(f))}</option>`).join('')}</select></label>` : '';
  dialog(`<h2>Mời thành viên</h2><p class="sub">Người được mời đăng nhập bằng Google với email này là vào họ ngay, không cần duyệt.</p>
    ${famField}<label class="fld">Email<input name="email" type="email" required maxlength="200" autocomplete="off"></label>
    <label class="fld">Vai trò ${roleSelect('mri', 'member', def)}</label>
    <div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn">Mời</button></div>`,
    async (f) => { await S.inviteMember(String(f.get('email')).trim(), f.get('mri'), f.get('fam') || fams[0]); loadMembers(); });
}
document.addEventListener('input', (e) => {
  if (e.target.id !== 'mq2') return;
  clearTimeout(members.t); members.t = setTimeout(() => { mst.q = e.target.value; paintMembers(); const i = $('#mq2'); i?.focus({ preventScroll: true }); i?.setSelectionRange(i.value.length, i.value.length); }, 150);
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'mrole') { mst.role = e.target.value; e.target.closest('dialog')?.close(); paintMembers(); }
  if (e.target.id === 'mfamp2') { mst.fam = e.target.value; e.target.closest('dialog')?.close(); render(); }
});
main.addEventListener('click', async (e) => {
  if (e.target.closest('#minv')) return inviteDialog();
  const mm = e.target.closest('[data-mmenu]');
  if (mm) { const m = memberById(mm.dataset.mmenu); if (m) popMenu(mm, [['Đổi vai trò', () => roleDialog(m)], dangerItem('Gỡ khỏi họ', () => confirmDanger({ title: `Gỡ ${m.name || m.email} khỏi họ?`, lose: 'Người này không còn đăng nhập được với quyền thành viên.', restore: 'Có thể mời lại sau.', confirm: 'Gỡ khỏi họ', onConfirm: async () => { await S.removeMember(m.id, m.fam); loadMembers(); } }))]); return; }
  const b = e.target.closest('[data-mact]'); if (!b) return;
  const id = b.dataset.id; const fam = b.dataset.fam;
  if (b.dataset.mact === 'reject') return confirmDialog('Từ chối yêu cầu?', 'Người này có thể gửi yêu cầu lại sau.', 'Từ chối', async () => { await S.rejectMember(id, fam); loadMembers(); });
  b.disabled = true;
  try { await S.approveMember(id, { role: $('#mrl-' + id)?.value || 'member' }, fam); await loadMembers(); }
  catch (err) { alert(err.message); b.disabled = false; }
});

// ---------- join the family (signed-in Google user, not yet a member) ----------
const RELS = [['self', 'Tôi là'], ['spouse_of', 'Vợ-chồng của'], ['child_of', 'Con của'], ['grandchild_of', 'Cháu của']];
const yearOf = (d) => d.born || (d.birth_date ? String(d.birth_date).slice(-4) : '');
function joinDesc(p) {
  const d = p.data; const par = M.byId.get(d.parent); const sp = d.spouse_of && M.byId.get(d.spouse_of);
  const rel = par ? `con ${par.data.sex === 'f' ? 'bà' : 'ông'} ${par.data.name}` : sp ? `${d.sex === 'm' ? 'rể' : 'dâu'} của ${sp.data.name}` : '';
  return [`Đời ${d.gen || '?'}`, rel, yearOf(d) ? 'sinh ' + yearOf(d) : ''].filter(Boolean).join(' · ');
}
// Google identity card on #join: who is signed in, with the account switch and sign-out (secondary links).
function idCard(a, step = '') {
  return `${card(`${step ? `<p class="step">${step}</p>` : ''}<div class="idc"><b>${esc(a.name || '')}</b><span class="sub">${esc(a.email)}</span></div>
    <div class="row wrap"><button type="button" class="linkbtn" id="jswitch">Không phải bạn? Đổi tài khoản</button><button type="button" class="linkbtn" id="jout">Đăng xuất</button></div>`, { tag: 'section', cls: 'stack' })}`;
}
// Quay lại: the previous screen, or Thêm when there is none. Switch: sign out, then Google's account chooser, back to #join.
function wireJoinActs() {
  $('#jback')?.addEventListener('click', () => { if (history.length > 1) history.back(); else location.hash = hf('more'); });
  $('#jout')?.addEventListener('click', () => askSignOut());
  $('#jswitch')?.addEventListener('click', () => openAccountSheet());
}
function join() {
  if (S.isAll()) { famPicker('join', 'Tham gia dòng họ', 'Chọn dòng họ muốn xin tham gia.'); return; }
  const a = S.myAccount();
  if (!a.email) {
    main.innerHTML = `<h1>Tham gia dòng họ</h1>${card(`<p>Đăng nhập bằng Google để gửi yêu cầu tham gia. Quản trị sẽ duyệt.</p>
      ${a.google ? '<a class="btn" href="/api/auth/google?next=join">Đăng nhập bằng Google</a>' : '<p class="sub">Đăng nhập bằng Google chưa được bật.</p>'}`, { tag: 'section', cls: 'stack' })}`;
    return;
  }
  if (S.isMember()) {
    const pid = S.myPersonId();
    main.innerHTML = `<h1>Tham gia dòng họ</h1>${card(`<p>Bạn đã là thành viên (${esc(ROLE_LBL[a.role] || a.role)}).</p>${pid ? `<a class="btn sm" href="${hf(`person/${esc(pid)}`)}">Xem hồ sơ của tôi</a>` : ''}`, { tag: 'section', cls: 'stack' })}`;
    return;
  }
  if (a.status === 'pending') {
    main.innerHTML = `<h1>Tham gia dòng họ</h1>${card(`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <h2>Đã gửi, chờ Quản trị duyệt</h2><p class="sub">Quản trị sẽ xem và duyệt yêu cầu. Quay lại trang này để xem kết quả. Trong lúc chờ, bạn xem được năm sinh và người đã mất.</p>`, { tag: 'section', cls: 'pstate', attrs: `aria-live="polite"` })}
      <div class="form-stack">${idCard(a)}
        <div class="row btw fs-lead"><button type="button" class="btn gh" id="jback">Quay lại</button><button type="button" class="btn ter" id="jcancel">Huỷ yêu cầu</button></div></div>`;
    $('#jcancel').onclick = async () => { try { await S.cancelJoin(); await S.refreshMe(); render(); } catch (e) { alert(e.message); } };
    wireJoinActs();
    return;
  }
  main.innerHTML = `<h1>Tham gia dòng họ</h1>
    <form class="form-stack" id="jform">
      ${idCard(a, 'Đã đăng nhập bằng Google')}
      <div class="fgrid fs-lead">
        <label class="fld">Họ<input name="ho" value="${esc(a.family_name || '')}" autocomplete="family-name" required></label>
        <label class="fld">Tên<input name="ten" value="${esc(a.given_name || '')}" autocomplete="given-name" required></label>
      </div>
      <div class="jgroup fs-lead"><span class="fld-h">Bạn là ai trong gia phả?</span>
        <div class="jsug" id="jsug" role="listbox" aria-label="Gợi ý trong gia phả"></div></div>
      <div id="jrelw" class="fs-lead" hidden><label class="fld">Quan hệ với người đã chọn <select name="rel">${RELS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label></div>
      <p class="sub fs-lead">Quản trị sẽ xem yêu cầu này để duyệt. Thông tin riêng tư chỉ mở sau khi được duyệt.</p>
      <p class="err fs-lead" id="jerr" hidden></p>
      <div class="row btw fs-lead"><button type="button" class="btn gh" id="jback">Quay lại</button><button class="btn" type="submit">Gửi yêu cầu</button></div>
    </form>`;
  const form = $('#jform'); let pick = null; // a person id, 'none', or null
  const paint = () => {
    const ho = form.ho.value.trim(); const ten = form.ten.value.trim();
    const hits = ho && ten ? searchPeople(M.all, `${ho} ${ten}`, { limit: 5 }) : [];
    const hint = !(ho && ten) ? '<span class="sub pad">Nhập họ và tên để xem gợi ý.</span>' : !hits.length ? '<span class="sub pad">Chưa thấy tên nào giống. Chọn dòng dưới nếu bạn chưa có trong gia phả.</span>' : '';
    $('#jsug').innerHTML = hint + hits.map((p) => personItem({ rank: p.data.hidden_living ? '' : rank(p.data), name: nameOf(p.data) }, { variant: 'compact', on: pick === p.id, attrs: `role="option" aria-selected="${pick === p.id}" data-jpick="${p.id}"`, sub: esc(joinDesc(p)) })).join('')
      + personItem({ name: 'Tôi chưa có trong gia phả' }, { variant: 'compact', sep: true, on: pick === 'none', attrs: `role="option" aria-selected="${pick === 'none'}" data-jpick="none"`, sub: esc('Quản trị sẽ xem và thêm bạn vào cây') });
    $('#jrelw').hidden = !(pick && pick !== 'none');
  };
  form.addEventListener('input', paint);
  $('#jsug').addEventListener('click', (e) => { const b = e.target.closest('[data-jpick]'); if (!b) return; pick = b.dataset.jpick; paint(); });
  form.onsubmit = async (e) => {
    e.preventDefault(); const err = $('#jerr'); err.hidden = true;
    const body = { first_name: form.ten.value.trim(), last_name: form.ho.value.trim() };
    if (pick && pick !== 'none') { const rel = form.rel.value; if (rel === 'self') body.person_id = pick; else { body.relation = rel; body.rel_person_id = pick; } }
    if (!body.first_name || !body.last_name) { err.textContent = 'Cần ghi họ và tên.'; err.hidden = false; return; }
    try { await S.joinRequest(body); await S.refreshMe(); render(); }
    catch (x) { err.textContent = x.message; err.hidden = false; }
  };
  paint();
  wireJoinActs();
}

// ---------- statistics: generation x branch flow, KPIs, places ----------
// The generation x branch counts: the Thống kê summary and its sub-page read the same numbers.
function genBranch(ps) {
  const gens = [...new Set(ps.map((p) => genOf(M, p)).filter(Boolean))].sort((x, y) => x - y);
  const chis = branchesOf(M, M.branchCfg, { all: true });
  const pal = ['c1', 'c2', 'c3', 'c5', 'ia', 'warn'];
  const col = (i) => `var(--${pal[i % pal.length]})`;
  const bi = (p) => { const b = branchOf(M, baseOf(M, p)); const i = b ? chis.indexOf(b) : -1; return i; };
  const rows = gens.map((g) => { const c = new Map(); for (const p of ps.filter((q) => genOf(M, q) === g)) { const i = bi(p); c.set(i, (c.get(i) || 0) + 1); } return { g, c, n: [...c.values()].reduce((s, v) => s + v, 0) }; });
  const max = Math.max(...rows.map((r) => r.n), 1);
  return { gens, chis, col, rows, max };
}
function stats() {
  const ps = M.all; const { gens, chis } = genBranch(ps);
  const alive = ps.filter((p) => !isDead(p.data)).length;
  const places = new Map(); for (const p of ps) { const l = locate(p.data); if (l && l.key) places.set(l.key, (places.get(l.key) || 0) + 1); }
  const top = [...places].sort((x, y) => y[1] - x[1]).slice(0, 8); const pmax = top[0]?.[1] || 1;
  const kpi = [['Tổng số', ps.length], ['Số đời', gens.length], ['Còn sống / chưa rõ', alive], ['Đã mất', ps.length - alive], ['Nam / Nữ', ps.filter((p) => p.data.sex !== 'f').length + ' / ' + ps.filter((p) => p.data.sex === 'f').length], ['Có nơi sống', ps.filter((p) => locate(p.data)).length]];
  main.innerHTML = `<h1>Thống kê</h1>
   <div class="kpis">${kpi.map(([l, v]) => `<div class="kpi"><span class="sub">${l}</span><b>${esc(v)}</b></div>`).join('')}</div>
   ${multiFam() ? `<h2>Theo dòng họ</h2>${card(`${S.scopeFams().map((f) => { const fp = ps.filter((p) => p.fam === f); const al = fp.filter((p) => !isDead(p.data)).length; return `<div class="li"><span class="grow">${famChip(S.familyName(f), S.familyHan(f), S.familyMeta(f))}</span><span class="sub">${fp.length} người · ${al} còn sống / chưa rõ · ${fp.length - al} đã mất</span></div>`; }).join('')}`)}` : ''}
   ${card(`${calmRow({ href: hf('doi-chi'), title: 'Theo đời và chi', subtitle: `${gens.length} đời · ${chis.length} chi`, dense: true })}`)}
   <h2>Nơi sống nhiều nhất</h2>
   <div class="gbars">${top.length ? top.map(([k, n]) => `<div class="gb"><span class="gl wide">${esc(k)}</span><span class="gt"><i style="width:${(n / pmax) * 100}%;background:var(--c-accent)"></i></span><b>${n}</b></div>`).join('') : '<p class="sub">Chưa có nơi sống.</p>'}</div>
   <p class="sub"><a href="${hf(`map`)}">Xem trên bản đồ ›</a></p>`;
}
// Theo đời và chi (sub-page of Thống kê): people per generation, split by chi.
function statsGenPage() {
  const { chis, col, rows, max } = genBranch(M.all);
  main.innerHTML = `<h1>Theo đời và chi</h1>
   <div class="lgd">${chis.map((c, i) => `<a href="${ph(c, `tree/@${c.id}`)}"><i style="background:${col(i)}"></i>${esc(rank(c.data) + ' ' + c.data.name)} <span class="sub">${M.desc(c.id) + 1}</span></a>`).join('')}</div>
   <div class="gbars">${rows.map((r) => `<div class="gb"><span class="gl">Đời ${r.g}</span><span class="gt">${[...r.c].sort((x, y) => x[0] - y[0]).map(([i, n]) => `<i style="width:${(n / max) * 100}%;background:${i < 0 ? 'var(--c-border-strong)' : col(i)}" title="${i < 0 ? 'Trước khi chia chi' : esc(chis[i].data.name)}: ${n}"></i>`).join('')}</span><b>${r.n}</b></div>`).join('')}</div>`;
}

const acctRow = () => S.signedIn()
  ? calmRow({ attrs: 'data-acct="sheet"', icon: cic('user', 16), title: `Tài khoản trên thiết bị này · ${(S.myAccounts().items || []).length}`, dense: true })
  : calmRow({ attrs: 'data-acct="in"', icon: cic('user', 16), title: 'Đăng nhập để sửa', dense: true });
// 'Cách gọi': the user's region for kinship labels (device-local). Standard by default; Miền Nam gives Southern wording.
const KIN_REGIONS = [['chuan', 'Chuẩn (mặc định)', 'Ông/Bà cụ, ông/bà kỵ, như cách gọi chung trong cả nước.'], ['nam', 'Miền Nam', 'Ông/Bà cố, ông/bà sơ, như cách gọi ở miền Nam.']];
const kinRegionPref = () => { try { return localStorage.getItem(KIN_REGION_KEY) || 'chuan'; } catch { return 'chuan'; } };
const kinRegionLabel = (v) => (KIN_REGIONS.find(([k]) => k === (resolveRegion(v) === 'nam' ? 'nam' : 'chuan')) || KIN_REGIONS[0])[1];
function kinRegionView() {
  const cur = resolveRegion(kinRegionPref());
  main.innerHTML = `<h1>Cách gọi</h1><p class="sub">Chọn cách gọi họ hàng trên hồ sơ và cây gia phả. Chỉ áp dụng trên máy này.</p>
    ${card(`${KIN_REGIONS.map(([v, l, d]) => `<label class="radio"><input type="radio" name="kreg" value="${v}" ${(v === 'nam' ? 'nam' : 'bac') === cur ? 'checked' : ''}> <span><b>${l}</b><span class="sub">${d}</span></span></label>`).join('')}`)}`;
  main.querySelectorAll('input[name=kreg]').forEach((r) => {
    r.onchange = () => { try { localStorage.setItem(KIN_REGION_KEY, r.value); } catch { /* private window: not kept */ } toast('Đã lưu cách gọi'); render(); };
  });
}
// Giỗ reminder e-mail (N1): the opt-in toggle, saved on the account (user_prefs). Needs a Google sign-in.
async function digestToggle() {
  const box = $('#dgt'); const note = $('#dgs'); if (!box) return;
  try {
    const r = await fetch('/api/me/digest', { cache: 'no-store' });
    if (r.status === 401) { note.textContent = DG.toggle_need_login; return; }
    if (!r.ok) throw new Error(String(r.status));
    box.checked = !!(await r.json()).enabled; box.disabled = false;
  } catch { note.textContent = DG.toggle_need_login; return; }
  box.onchange = async () => {
    box.disabled = true;
    try {
      const r = await fetch('/api/me/digest', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: box.checked }) });
      if (!r.ok) throw new Error(String(r.status));
      note.textContent = DG.toggle_saved;
    } catch { box.checked = !box.checked; note.textContent = DG.toggle_need_login; }
    box.disabled = false;
  };
}
// Cỡ chữ (per device): 'normal' or 'large' / 'xlarge' as html[data-text]; tokens.css maps it to --text-scale. index.html sets it before first paint.
const TEXT_KEY = 'gp_text';
const TEXT_SIZES = [['normal', TEXT_SIZE_VI.normal], ['large', TEXT_SIZE_VI.large], ['xlarge', TEXT_SIZE_VI.xlarge]];
const textPref = () => { try { const v = localStorage.getItem(TEXT_KEY); return v === 'large' || v === 'xlarge' ? v : 'normal'; } catch { return 'normal'; } };
function setText(v) {
  try { localStorage.setItem(TEXT_KEY, v); } catch { /* private window: not kept, this page still scales */ }
  if (v === 'normal') delete document.documentElement.dataset.text; else document.documentElement.dataset.text = v;
}
function settings() {
  const t = themePref();
  const x = textPref();
  main.innerHTML = `<h1>Cài đặt</h1>${section('Giao diện', `${[['', 'Theo hệ thống'], ['light', 'Sáng'], ['dark', 'Tối']].map(([v, l]) => `<label class="radio"><input type="radio" name="thm" value="${v}" ${t === v ? 'checked' : ''}> ${l}</label>`).join('')}`, { variant: 'card' })}`;
  main.insertAdjacentHTML('beforeend', `${section(TEXT_SIZE_VI.label, `${TEXT_SIZES.map(([v, l]) => `<label class="radio"><input type="radio" name="txt" value="${v}" ${x === v ? 'checked' : ''}> ${l}</label>`).join('')}`, { variant: 'card' })}`);
  main.insertAdjacentHTML('beforeend', `${section('Dòng họ', `
    ${followedRecs().map((f) => famRowHtml(f, `#/${f.slug}/cai-dat-dong-ho`)).join('')}
    <a class="famr add" href="#/${S.ALL_FAMS}/tree"><span class="famr-tx"><span class="famr-nm">＋ Tìm / lập dòng họ</span></span></a>`, { variant: 'card', cls: 'fam-sec' })}`);
  main.insertAdjacentHTML('beforeend', `${section('Cách gọi', calmRow({ href: hf('cach-goi'), title: 'Cách gọi', subtitle: kinRegionLabel(kinRegionPref()), dense: true }), { variant: 'card' })}`);
  main.insertAdjacentHTML('beforeend', `${section('Nhắc giỗ', `<label class="radio"><input type="checkbox" id="dgt" disabled> ${DG.toggle_label}</label><p class="sub">${DG.toggle_hint}</p><p class="sub" id="dgs" aria-live="polite"></p>`, { variant: 'card' })}`);
  main.insertAdjacentHTML('beforeend', `${section('Tài khoản', acctRow(), { variant: 'card' })}`);
  digestToggle();
  main.querySelectorAll('input[name=thm]').forEach((r) => { r.onchange = () => setTheme(r.value); });
  main.querySelectorAll('input[name=txt]').forEach((r) => { r.onchange = () => setText(r.value); });
  refreshFams();
  aiSection();
}
// Ứng dụng AI đã kết nối: signed out, a line on what it is and a sign-in button; signed in, the apps (revoke with a confirm),
// a "Kết nối ứng dụng AI" row that opens the connect sheet, and AI requests waiting for an admin.
const AI_ROLE = { admin: 'quản trị', editor: 'biên tập', member: 'thành viên' };
const aiTitle = (r) => { const t = AI_ACT(r.payload, r.action); return t.charAt(0).toUpperCase() + t.slice(1); };
const AI_ACT = (p, a) => ({ invite_member: `mời ${p.email} làm ${AI_ROLE[p.role] || p.role}`, change_role: `đổi ${p.name} thành ${AI_ROLE[p.role] || p.role}`, remove_member: `gỡ ${p.name}` })[a] || a;
async function aiSection() {
  const host = document.createElement('div'); host.className = 'cd ai-sec';
  main.append(host);
  const draw = async () => {
    const [c, q] = await Promise.all([fetch('/api/ai/connections', { cache: 'no-store' }), fetch('/api/ai/requests', { cache: 'no-store' })]);
    if (c.status === 401) {
      host.innerHTML = '<h3>Ứng dụng AI đã kết nối</h3><p class="sub">Cho phép Claude, ChatGPT… đọc/ghi gia phả của bạn, theo quyền của bạn.</p>'
        + '<button type="button" class="btn" data-login>Đăng nhập</button>';
      host.querySelector('[data-login]').onclick = () => loginDialog(); // the app's sign-in; Google returns to this page
      return;
    }
    if (!c.ok) { host.remove(); return; } // the section is optional: no list, no card
    const cj = await c.json(); const qj = q.ok ? await q.json().catch(() => ({})) : {};
    if (!Array.isArray(cj.items)) { host.remove(); return; }
    const reqItems = Array.isArray(qj.items) ? qj.items : [];
    const conn = cj.items.length ? cj.items.map((i) => `<div class="calm dense ai-row" data-id="${i.id}"><span class="calm-t"><b class="calm-n">${esc(i.client_name)}</b><span class="calm-s">${esc(i.family.name)}${i.last_used_at ? ' · dùng ' + fmtDate(i.last_used_at) : ''}</span></span>
      ${dangerButton('Gỡ kết nối', 'data-revoke', { size: 'sm' })}</div>`).join('') : '<p class="sub">Chưa có ứng dụng AI nào.</p>';
    const connect = `<button type="button" class="calm dense ai-connect" data-connect><span class="calm-t"><b class="calm-n">Kết nối ứng dụng AI</b><span class="calm-s">Claude, ChatGPT: lấy địa chỉ để dán vào ứng dụng</span></span></button>`;
    // Each request is a calm row; tapping it opens a sheet with the two decisions (one primary action).
    const reqs = reqItems.map((r) => `<button type="button" class="calm dense ai-req" data-req="${r.id}"><span class="calm-t"><b class="calm-n">${esc(aiTitle(r))}</b><span class="calm-s">${esc(r.client_name)} · ${esc(r.family.name)}</span></span></button>`).join('');
    host.innerHTML = `<h3>Ứng dụng AI đã kết nối</h3>${conn}${connect}${reqs ? '<h3>Yêu cầu từ AI</h3>' + reqs : ''}`;
    host.querySelector('[data-connect]').onclick = () => connectSheet();
    host.querySelectorAll('[data-revoke]').forEach((b) => b.onclick = () => {
      const id = b.closest('[data-id]').dataset.id;
      confirmDanger({ title: 'Gỡ kết nối này?', lose: 'Ứng dụng AI sẽ không truy cập được gia phả nữa.', restore: 'Có thể kết nối lại sau.', confirm: 'Gỡ kết nối',
        onConfirm: async () => { const r = await fetch(`/api/ai/connections/${id}/revoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); if (!r.ok) throw new Error('Không gỡ được. Thử lại sau.'); draw(); } });
    });
    host.querySelectorAll('[data-req]').forEach((btn) => btn.onclick = () => {
      const r = reqItems.find((x) => String(x.id) === btn.dataset.req);
      if (!r) return;
      const d = document.createElement('dialog'); d.className = 'dlg cfm ai-sheet';
      d.innerHTML = `<div class="cfm-body"><h2>${esc(aiTitle(r))}</h2>
        <p class="sub">${esc(r.client_name)} · ${esc(r.family.name)}</p>
        <div class="row end cfm-acts"><button type="button" class="btn gh" data-no>Không</button><button type="button" class="btn" data-yes>Duyệt</button></div></div>`;
      document.body.append(d);
      d.addEventListener('close', () => d.remove());
      d.querySelector('[data-no]').onclick = async () => { await fetch(`/api/ai/requests/${r.id}/reject`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); d.close(); draw(); };
      d.querySelector('[data-yes]').onclick = async () => { const res = await fetch(`/api/ai/requests/${r.id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); d.close(); if (!res.ok) toast((await res.json()).error || 'Không duyệt được.'); draw(); };
      d.showModal();
    });
  };
  await draw();
}
// The connect sheet: the MCP address (same origin as this page) to paste into the AI app, and short steps for each.
function connectSheet() {
  const url = `${location.origin}/mcp`;
  const d = document.createElement('dialog'); d.className = 'dlg cfm ai-sheet';
  d.innerHTML = `<div class="cfm-body"><h2>Kết nối ứng dụng AI</h2>
    <p class="sub">Sao chép địa chỉ này. Lần đầu, ứng dụng AI sẽ mở trang để bạn đăng nhập và cho phép.</p>
    <div class="ai-url"><code>${esc(url)}</code><button type="button" class="btn sm" data-copy>Chép</button></div>
    <h3>Claude</h3>
    <ol class="ai-steps"><li>Mở Settings → Connectors.</li><li>Chọn Add custom connector.</li><li>Dán địa chỉ trên rồi nhấn Add.</li></ol>
    <h3>ChatGPT</h3>
    <ol class="ai-steps"><li>Mở Plugins, chọn dấu + rồi Add custom MCP server.</li><li>Dán địa chỉ trên vào ô Connection, chọn xác thực OAuth nếu được hỏi.</li><li>Xác nhận cảnh báo, chọn Create as a plugin, đăng nhập và cho phép.</li></ol>
    <div class="row end cfm-acts"><button type="button" class="btn gh" data-close>Đóng</button></div></div>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.querySelector('[data-close]').onclick = () => d.close();
  d.querySelector('[data-copy]').onclick = () => {
    (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => toast('Đã chép địa chỉ.'), () => toast(`Địa chỉ: ${url}`));
  };
  d.showModal();
}



function more() {
  const acct = S.myAccount(); const signed = S.signedIn(); const role = S.myRole();
  // Each row: a 40px tile with the icon, the label, an inset divider between rows (Thêm = the More-page look).
  const tile = (ic) => `<span class="ibox" aria-hidden="true">${ic}</span>`;
  const row = (k, label, badge = '', icn) => calmRow({ href: hf(k), icon: tile(icon(icn || NAV.find((x) => x[0] === k)[3])), title: label, badge, dense: true });
  const bdg = (c) => (c ? ` <b class="badge">${c}</b>` : '');
  const grp = (title, rows) => (rows.filter(Boolean).length ? section(title, `<div class="mg-g">${rows.filter(Boolean).join('')}</div>`) : '');
  const view = grp('Xem', [row('map', 'Bản đồ'), row('stats', 'Thống kê'), row('verify', 'Cần bổ sung'), calmRow({ href: hf('consistency'), icon: tile(icon('info')), title: CSV.more_link, subtitle: CSV.more_sub, dense: true }), row('export', 'Tải về')]);
  const joinRow = signed && !S.isMember() ? calmRow({ href: hf('join'), icon: tile(icon('user')), title: acct.status === 'pending' ? 'Yêu cầu tham gia đang chờ duyệt' : 'Tham gia dòng họ', dense: true }) : '';
  const fam = grp('Dòng họ', [calmRow({ href: `#/${S.ALL_FAMS}/tree`, icon: tile(icon('search')), title: 'Tìm / lập dòng họ', dense: true }), S.isEditor() && !S.isAll() ? calmRow({ attrs: 'data-contact-import-fam', icon: tile(icon('user')), title: 'Nhập danh bạ', subtitle: 'vCard (.vcf) hoặc CSV, khớp với người trong họ', dense: true }) : '', row('gop-y', 'Góp ý', canAdminHere() ? bdg(sugCount) : ''), canAdminHere() ? row('members', 'Thành viên & quyền', bdg(joinCount)) : '', joinRow, signed ? row('nhan-quan-ly', 'Nhận quản lý cây', '', 'tree') : '', S.isMember() && !S.isAll() ? row('bieu-quyet', 'Biểu quyết', '', 'user') : '', S.isEditor() && !S.isAll() ? row('thung-rac', 'Thùng rác', '<span data-trash-badge></span>', 'trash') : '']);
  // Ứng dụng: settings and the build in use; the check asks the server now (same unsaved-changes guard as the notice)
  const verRow = calmRow({ attrs: 'id="chkupd"', icon: tile(icon('info')), title: 'Phiên bản', subtitle: buildLabel(BUILD), trailing: '<span class="mo-act">Kiểm tra cập nhật</span>', dense: true });
  const app = grp('Ứng dụng', [row('settings', 'Cài đặt'), verRow]);
  const act = activeAcc(); const ai = Math.max(0, (S.myAccounts().items || []).findIndex((x) => x.active));
  const who = S.editorName() || acct.name || acct.email || '';
  const roleLine = S.isAll() ? '' : (role === 'guest' ? 'Khách ở dòng họ này' : (ROLE_LBL[role] || ''));
  const nFam = act ? (act.memberships || []).length : 0;
  // Account block: last on the page, its own card, away from the rows.
  const acctBlock = signed
    ? `${card(`<span class="acct"><span class="av" style="background:${accCol(ai)}" aria-hidden="true">${esc((act?.initial) || who.trim().charAt(0).toUpperCase() || '?')}</span><span class="acct-tx"><b>${esc(act?.name || who)}</b>${(act?.email || acct.email) ? `<span class="sub">${esc(act?.email || acct.email)}</span>` : ''}<span class="sub">${esc([roleLine, nFam ? `${nFam} dòng họ` : ''].filter(Boolean).join(' · '))}</span></span><span class="acc-go" aria-hidden="true">›</span></span>`, { tag: 'button', cls: 'acct-card acct-open', attrs: `type="button" data-acct="sheet" aria-haspopup="dialog"` })}`
    : `${card(`<div class="acct"><div class="acct-tx"><b>Chưa đăng nhập</b><span class="sub">Đăng nhập để sửa và xem thông tin riêng tư.</span></div><button type="button" class="btn sm" id="login">Đăng nhập</button></div>`, { cls: 'acct-card' })}`;
  // Đăng xuất: its own red row, in a card of its own; opens the confirm (askSignOut)
  const out = signed ? section('', `<div class="mg-g">${calmRow({ attrs: 'id="logout"', icon: tile(icon('logout')), title: 'Đăng xuất', trailing: 'none', dense: true, danger: true })}</div>`) : '';
  // Quản lý tài khoản: the Account page of the active Google account (emails, sign-in methods, devices)
  const manage = signed && act?.kind === 'google' ? `<div class="mg-g acct-manage">${calmRow({ href: hf('tai-khoan'), icon: tile(icon('user')), title: 'Quản lý tài khoản', subtitle: 'Email, cách đăng nhập, thiết bị', dense: true })}</div>` : '';
  // Signed out: Đăng nhập is the first row (the account card at the bottom keeps its own button)
  const signInRow = signed ? '' : section('', `<div class="mg-g">${calmRow({ attrs: 'data-acct="in"', icon: tile(icon('user')), title: 'Đăng nhập', subtitle: 'Để sửa và xem thông tin riêng tư', dense: true })}</div>`);
  main.innerHTML = `<h1>Thêm</h1>${signInRow}${view}${fam}${app}<section class="mg mg-who">${acctBlock}${manage}</section>${out}`;
}
// Book inside the app shell (header, side nav, bottom nav); print/PDF from its own toolbar prints only the book.
// The version of the family's data the book was loaded with: when a sync brings changes after that, a bar at the top offers a
// reload (the book is not reloaded by itself: a page being read does not jump).
let bookSeen = null;
function bookLink(chi) {
  if (S.isAll()) { famPicker('book', 'Sách gia phả', 'Chọn dòng họ để mở sách.'); return; }
  main.classList.add('wide', 'bookm');
  bookSeen = { fam: S.curFamily(), ver: S.famVersion(S.curFamily()) };
  main.innerHTML = `<iframe class="bookfr" src="/book?inapp=1&family=${encodeURIComponent(S.curFamily())}${chi ? '&chi=' + encodeURIComponent(chi) : ''}" title="Sách gia phả"></iframe>`;
}
// Drawn or removed on every render: the bar shows while the family has changed since the book was loaded.
function bookBar() {
  const fr = main.querySelector('iframe.bookfr'); if (!fr) return;
  const fam = S.curFamily();
  const stale = !!bookSeen && bookSeen.fam === fam && S.famVersion(fam) !== bookSeen.ver;
  const bar = main.querySelector('.bkupd');
  if (stale && !bar) fr.insertAdjacentHTML('beforebegin', '<div class="fbar bkupd" role="status"><span>Có cập nhật —</span> <button type="button" class="btn sm" id="bkreload">Tải lại</button></div>');
  else if (!stale && bar) bar.remove();
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#bkreload')) return;
  const fam = S.curFamily(); bookSeen = { fam, ver: S.famVersion(fam) };
  const fr = main.querySelector('iframe.bookfr'); if (fr) fr.src = fr.src;
  main.querySelector('.bkupd')?.remove();
});

// ---------- my contributions: suggestions this device sent (receipts) and the signed-in account's ----------
const MST = { st: '', qRaw: '', q: '' };
const MSTAT = [['pending', 'Chờ duyệt', 'yellow'], ['approved', 'Đã duyệt', 'green'], ['rejected', 'Từ chối', 'red'], ['withdrawn', 'Đã rút', 'gray']];
const mineStat = (s) => MSTAT.find((x) => x[0] === s) || [s, s, 'gray'];
const MINE = { rows: null };
function mine() {
  const r = route();
  main.innerHTML = `${gopyHead('mine')}
    ${toolbar({ id: 'mq3', ph: 'Tìm tên người hoặc nội dung góp ý', val: MST.qRaw, active: MST.st ? 1 : 0 })}
    ${ltags(MST.st ? [['st', mineStat(MST.st)[1]]] : [])}
    ${fpanel(`<fieldset class="fset"><legend>Trạng thái</legend>${[['', 'Tất cả'], ...MSTAT.map(([v, l]) => [v, l])].map(([v, l]) => `<label class="radio"><input type="radio" name="ms" value="${v}" ${MST.st === v ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>`)}
    ${S.signedIn() ? '' : deviceNote(S.myAccount().google)}
    <div id="mlist2"><p class="sub pad">Đang tải…</p></div>
    <div id="mrecw"></div>`;
  $('#mlist2') && $('#mlist2').addEventListener('click', fpGroupClick);
  $('#mq3').oninput = (e) => { clearTimeout(mine.t); mine.t = setTimeout(() => { MST.qRaw = e.target.value; MST.q = fold(MST.qRaw).trim(); paintMine(); const i = $('#mq3'); i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length); }, 200); };
  main.querySelectorAll('input[name=ms]').forEach((x) => { x.onchange = () => { MST.st = x.value; render(); }; });
  setUntag((k) => { if (k === '*' || k === 'st') { MST.st = ''; render(); } });
  // #mine?r=... (recovery link): add its receipts to this device, then drop the query from the address
  const rec = r.qs.get('r');
  if (rec) {
    const list = S.decodeRecovery(rec);
    history.replaceState(null, '', hf('mine'));
    S.importReceipts(list).then((n) => { if (n) toast(`Đã thêm ${n} góp ý vào thiết bị này`); loadMine(); });
  } else loadMine();
}
async function loadMine() {
  if (!$('#mlist2')) return;
  MINE.drafts = await S.draftList(S.curFamily()).catch(() => []); MINE.queue = await S.queueItems().catch(() => []);
  try { MINE.rows = (await S.listMine()).items; MINE.err = null; } catch (e) { MINE.err = e.message; }
  paintMine();
}
function paintMine() {
  const box = $('#mlist2'); if (!box) return; const allRows = MINE.rows || [];
  const rows = allRows.filter((s) => (!MST.st || s.status === MST.st)
    && (!MST.q || fold([s.person_name, s.note, s.reason, ...Object.keys(s.changes).map(FL), ...Object.entries(s.changes).map(([k, v]) => sugShow(k, v))].join(' ')).includes(MST.q)));
  const groups = fpGroups();
  box.innerHTML = (MINE.err ? `<p class="err">${esc(MINE.err)}</p>` : '') + groups + rows.map(mineCard).join('')
    || (groups ? '' : `<p class="sub pad">${allRows.length ? 'Không có góp ý nào khớp.' : 'Chưa có góp ý nào trên thiết bị này. Mở hồ sơ người nhà và bấm “Sửa” để gửi.'}</p>`);
  const rw = $('#mrecw');
  if (rw) rw.innerHTML = S.receipts().length
    ? card(`<b>Khôi phục trên thiết bị khác</b><span class="sub">Ai có liên kết này xem và rút được các góp ý này. Chỉ gửi cho người tin cậy.</span><div class="row end"><button type="button" class="btn ter sm" id="mrec">Sao chép liên kết khôi phục</button></div>`, { cls: 'rec' })
    : '';
}
// "Bản nháp" (drafts of this family: Tiếp tục | Bỏ) and "Đang chờ gửi" (queued while offline) above the list.
function fpGroups() {
  const dr = (MINE.drafts || []).map((x) => `${card(`<div class="row btw"><b>${esc(fpDraftName(x))}</b><span class="tag sm">Bản nháp</span></div><span class="sub">Lưu lúc ${fmtTime(x.saved)} · ${Object.keys(x.changed || {}).length} mục</span><div class="row end">${dangerButton('Bỏ nháp', `data-dr-drop="${esc(x.key)}"`, { size: 'sm' })}<button class="btn sm" type="button" data-dr-go="${esc(x.key)}">Tiếp tục</button></div>`, { cls: 'rv mcard', attrs: `data-dkey="${esc(x.key)}"` })}`).join('');
  const qu = (MINE.queue || []).map((x) => `${card(`<div class="row btw"><b>${esc(x.label || 'Góp ý')}</b><span class="tag sm">Đang chờ mạng</span></div><span class="sub">Sẽ gửi khi có mạng · ${fmtTime(x.created)}</span>`, { cls: 'rv mcard' })}`).join('');
  return (dr ? `<h2 class="fp-h">Bản nháp</h2>${dr}` : '') + (qu ? `<h2 class="fp-h">Đang chờ gửi</h2>${qu}` : '');
}
const fpDraftName = (x) => (x.mode === 'patch' ? 'Sửa góp ý' : x.personId === 'new' ? 'Người mới' : (M.byId.get(x.personId)?.data.name || 'Người trong gia phả'));
function fpGroupClick(e) {
  const go = e.target.closest('[data-dr-go]'); const drop = e.target.closest('[data-dr-drop]');
  if (go) {
    const x = (MINE.drafts || []).find((d) => d.key === go.dataset.drGo); if (!x) return;
    if (x.mode === 'patch') { const s = (MINE.rows || []).find((r) => r.id === x.patchId); if (s) mineEdit(s, true); else toast('Góp ý này không còn trên máy chủ.'); return; }
    const p = x.personId !== 'new' ? M.byId.get(x.personId) : null;
    goForm(p ? { kind: 'sua', p, autoDraft: true } : { kind: 'them', autoDraft: true });
  } else if (drop) { const k = drop.dataset.drDrop; confirmDanger({ title: 'Bỏ bản nháp này?', lose: 'Các thay đổi chưa gửi trong bản nháp sẽ mất.', confirm: 'Bỏ nháp', onConfirm: async () => { await S.draftDelete(k); toast('Đã bỏ bản nháp'); loadMine(); } }); }
}
function mineCard(s) {
  const [, label, tone] = mineStat(s.status); const pend = s.status === 'pending';
  const who = s.is_new ? `<b>Người mới: ${esc(s.person_name || '(chưa có tên)')}</b>`
    : `<a class="plink" href="${hf(`person/${esc(s.person_id)}`)}"><b>${esc(s.person_name || 'Người trong gia phả')}</b></a>`;
  const dif = fieldDiff(Object.entries(s.changes).map(([f, v]) => frow(`<b>${esc(FL(f))}</b> <span>${esc(sugShow(f, v))}</span>`)).join(''));
  return `${card(`
    <div class="row btw">${who}${tag(label, { tone, sm: true })}</div>
    ${dif}
    ${s.note ? (s.note.length > NOTE_LONG ? `<p class="rv-note rv-clamp">“${esc(s.note)}”</p><button type="button" class="btn gh sm" data-note-more>Xem thêm</button>` : `<p class="rv-note">“${esc(s.note)}”</p>`) : ''}
    ${s.status === 'rejected' && s.reason ? `<p class="sub"><b>Lý do:</b> ${esc(s.reason)}</p>` : ''}
    <span class="sub">Gửi ${fmtTime(s.created_at)}</span>
    ${pend ? `<div class="row end">${dangerButton('Rút lại', `data-mine-act="withdraw" data-id="${s.id}"`, { size: 'sm' })}<button class="btn sm" type="button" data-mine-act="edit" data-id="${s.id}">Sửa</button></div>` : ''}
  `, { cls: 'rv mcard', attrs: `data-mid="${s.id}"` })}`;
}
function mineEdit(s, auto = false) {
  const patch = { id: s.id, d: { ...s.changes }, note: s.note || '' };
  const title = `Sửa góp ý${s.is_new ? '' : ': ' + (s.person_name || '')}`;
  const p = s.person_id ? M.byId.get(s.person_id) : null;
  if (p) goForm({ kind: 'sua', p, patch, title, autoDraft: auto }); else goForm({ kind: 'them', patch, title, autoDraft: auto });
}
function mineWithdraw(s) {
  confirmDanger({ title: 'Rút góp ý này?', lose: 'Quản trị sẽ không xem góp ý này nữa.', restore: 'Bạn có thể gửi lại sau.', confirm: 'Rút lại', onConfirm: async () => { await S.withdrawSuggestion(s.id); await loadMine(); } });
}
function mineRecovery() {
  const url = `${location.origin}/#mine?r=${S.encodeRecovery(S.receipts())}`;
  const warn = 'Ai có liên kết này xem và rút được các góp ý này. Chỉ gửi cho người tin cậy.';
  const show = () => dialog(`<h2>Liên kết khôi phục</h2><p class="sub">${warn}</p><label class="fld">Liên kết<input readonly value="${esc(url)}"></label><div class="row end"><button class="btn">Đóng</button></div>`, () => {});
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => toast('Đã chép liên kết khôi phục. ' + warn), show);
  else show();
}
main.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mine-act]');
  if (b) { const s = MINE.rows?.find((x) => String(x.id) === b.dataset.id); if (!s) return; if (b.dataset.mineAct === 'edit') mineEdit(s); else mineWithdraw(s); return; }
  if (e.target.closest('#mrec')) mineRecovery();
});

// ---------- dialogs ----------
const dialog = (html, onSubmit) => sheet(html, onSubmit, { after: () => render() }); // the shared sheet (ui.js)
elder.init({ loginDialog, render });
LK.setOnChange(() => renderSoon());
BT.setOnChange(() => renderSoon());
main.addEventListener('click', (e) => { if (e.target.closest?.('[data-bt-del]')) BT.deleteBranch(S.curFamily(), () => renderSoon()); });
PL.setOnChange(() => renderSoon());
VR.setOnChange(() => renderSoon());
VR.wire(main, { fam: () => { const pp = M.byId.get(route().arg); return pp?.fam || S.curFamily(); }, nameOf: (pid) => M.byId.get(pid)?.data?.name || '', done: () => { S.sync(); renderSoon(); } });
PL.wire(main, { fam: () => { const pp = M.byId.get(route().arg); return pp?.fam || S.curFamily(); }, textOf: (pid, field) => M.byId.get(pid)?.data?.[field] || '', done: () => renderSoon() });
addEventListener('hashchange', () => elder.handleHash());
elder.handleHash();
{ const m = /^#login-error=(.*)$/.exec(location.hash); if (m) { const t = decodeURIComponent(m[1]); history.replaceState(null, '', '#tree'); setTimeout(() => alert(t), 300); } }
function loginDialog() {
  const dl = dialog(`<h2>Đăng nhập để sửa</h2><p class="sub">Xem thì không cần đăng nhập. Mã sửa do người quản lý gia phả cấp.</p>
   <label class="fld">Mã sửa<input name="code" type="password" autocomplete="current-password" required id="code"></label>
   <div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn">Đăng nhập</button></div>
   <div class="pk-login" hidden><button type="button" class="btn" data-pk-login>Đăng nhập bằng passkey</button><p class="sub">Đăng nhập bằng vân tay / khuôn mặt trên điện thoại, không cần mật khẩu.</p><p class="err" role="alert"></p></div>
   <p><button type="button" class="btn ter" data-elder>Cách khác</button></p>
   <p class="gsep" hidden><a class="btn ter" href="${googleUrl(hashNext())}">Đăng nhập bằng Google</a></p>`, async (f) => { await S.login(f.get('code')); });
  elder.wireLogin(dl);
  fetch('/api/me').then((r) => r.json()).then((j) => { if (j.google) document.querySelectorAll('.gsep').forEach((e) => { e.hidden = false; }); }).catch(() => {});
}
const F = [['name', 'Họ tên'], ['name_han', 'Tên chữ Hán'], ['thu', 'Thứ (2, 3… hoặc Út)'], ['sex', 'Giới tính', [['m', 'Nam'], ['f', 'Nữ']]], ['gen', 'Đời'], ['spouse', 'Vợ / chồng'], ['other_parent', 'Mẹ / cha (vợ hoặc chồng của cha mẹ)'], ['married', 'Năm cưới'],
  ['born', 'Năm sinh'], ['birth_date', 'Ngày sinh (dd/mm/yyyy)'], ['birth_lunar', 'Ngày sinh âm lịch (dd/mm)'], ['died', 'Năm mất'], ['death_lunar', 'Ngày mất (ÂL, ví dụ 2/8)'], ['gio_lunar', 'Ngày giỗ (ÂL, nếu khác ngày mất)'], ['living', 'Tình trạng', [['', 'Chưa rõ'], ['living', 'Còn sống'], ['dead', 'Đã mất']]],
  ['place', 'Nơi sống'], ['alias', 'Tên khác'], ['title_name', 'Tên húy / tự / hiệu'], ['job', 'Nghề'], ['religion', 'Tôn giáo'], ['burial', 'An táng'], ['photo', 'Ảnh'],
  ['phone', 'Điện thoại'], ['email', 'Email'], ['zalo', 'Zalo'], ['facebook', 'Facebook'], ['address', 'Địa chỉ'], ['contact_public', 'Liên hệ công khai?', [['', 'Không'], ['yes', 'Có']]],
  ['note', 'Ghi chú'], ['verify', 'Cần xác minh'], ['source', 'Nguồn'], ['birth_place', 'Nơi sinh'], ['death_date', 'Ngày mất (dd/mm/yyyy)']];
// Resize in the browser (longest side 800 px, JPEG) and upload; the person keeps the returned URL.
async function uploadPhoto(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 800 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const r = await fetch(`/api/photos?family=${encodeURIComponent(S.curFamily())}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: c.toDataURL('image/jpeg', 0.82) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Tải ảnh lỗi.');
  PHOTO_PREVIEW.set(j.url, c.toDataURL('image/jpeg', 0.82)); // shown from the device until it is saved with its record
  return j.url;
}
// An event's photo: uploaded now (needs the network) and kept in the form until Lưu.
document.addEventListener('change', async (e) => {
  const inp = e.target.closest?.('[data-evx-photo]'); if (!inp || !inp.files[0]) return;
  const root = inp.closest('[data-evx]'); const msg = root.querySelector('[data-evx-photomsg]'); const list = root.querySelector('[data-phs]');
  if (list.querySelectorAll('[data-ph]').length >= EVENT_PHOTO_MAX) { msg.textContent = `Tối đa ${EVENT_PHOTO_MAX} ảnh.`; inp.value = ''; return; }
  if (!navigator.onLine) { msg.textContent = 'Cần có mạng để tải ảnh.'; inp.value = ''; return; }
  msg.textContent = 'Đang tải ảnh…';
  try { const url = await uploadPhoto(inp.files[0]); list.insertAdjacentHTML('beforeend', photoRow(url, PHOTO_PREVIEW.get(url))); msg.textContent = 'Đã tải ảnh. Bấm Lưu để giữ.'; }
  catch (err) { msg.textContent = err.message; }
  inp.value = '';
});
document.addEventListener('change', async (e) => {
  const inp = e.target.closest?.('[data-photo]'); if (!inp || !inp.files[0]) return;
  const box = inp.closest('.fld'); const msg = $('[data-photomsg]', box);
  if (!navigator.onLine) { msg.textContent = 'Cần có mạng để tải ảnh.'; return; }
  msg.textContent = 'Đang tải ảnh…';
  try {
    const url = await uploadPhoto(inp.files[0]);
    $('input[name=photo]', box).value = url;
    let im = $('.phup img', box); if (!im) { im = document.createElement('img'); im.alt = ''; $('.phup', box).prepend(im); } im.src = PHOTO_PREVIEW.get(url) || url;
    msg.textContent = 'Đã tải ảnh. Bấm Lưu để giữ.';
  } catch (err) { msg.textContent = err.message; }
});
// ---------- accounts on this device: switcher sheet, switch, sign-out ----------
const ACC_COL = ['#6929c4', '#198038', '#0043ce', '#b28600', '#9f1853', '#005d5d'];
const TOP_ROLE = ['owner', 'admin', 'editor', 'member'];
const accCol = (i) => ACC_COL[Math.max(0, i) % ACC_COL.length];
const activeAcc = () => (S.myAccounts().items || []).find((x) => x.active) || null;
const accName = () => activeAcc()?.name || S.editorName() || '';
const accWho = (a) => a.email || a.name;
// One line per account: "Chủ họ · Họ Dương — Củ Chi". Several families: "Quản trị ở 2 dòng họ ›" expands to the list.
function accMemLine(a) { const ms = a.memberships || []; return ms.length ? `${ROLE_LBL[ms[0].role] || ms[0].role} · ${ms[0].family.name}` : 'Chưa tham gia dòng họ nào'; }
function accSummary(ms) { const top = TOP_ROLE.find((r) => ms.some((m) => m.role === r)); return `${ROLE_LBL[top] || ''} ở ${ms.length} dòng họ`; }
function accRowHtml(a, i) {
  const ms = a.memberships || []; const id = a.email ? `data-email="${esc(a.email)}"` : 'data-code="1"';
  return `<div class="acc-row${a.active ? ' on' : ''}">
    <button type="button" class="acc-main" data-switch ${id}${a.active ? ' aria-current="true"' : ''}>
      <span class="av" style="background:${accCol(i)}" aria-hidden="true">${esc(a.initial)}</span>
      <span class="acc-tx"><b>${esc(a.name)}</b>${a.email ? `<span class="sub">${esc(a.email)}</span>` : ''}${ms.length <= 1 ? `<span class="acc-mem">${esc(accMemLine(a))}</span>` : ''}</span>
      ${a.active ? '<span class="acc-on" aria-label="Đang dùng"><svg viewBox="0 0 32 32" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M13 24 4 15l1.4-1.4 7.6 7.6L26.6 7l1.4 1.4z"/></svg></span>' : ''}
    </button>
    ${ms.length >= 2 ? `<button type="button" class="acc-more" aria-expanded="false" data-more>${esc(accSummary(ms))} ›</button>
      <ul class="acc-mems" hidden>${ms.map((m) => `<li>${esc(ROLE_LBL[m.role] || m.role)} · ${esc(m.family.name)}</li>`).join('')}</ul>` : ''}
  </div>`;
}
const googleUrl = (next = '') => '/api/auth/google' + (next ? '?next=' + encodeURIComponent(next) : '');
// Where the app is now, for the return after Google sign-in (plain route text only).
const hashNext = () => { const h = location.hash.slice(1).split('?')[0]; return /^[a-z0-9/_-]{1,80}$/i.test(h) ? h : ''; };
// The account sheet: bottom sheet on a phone, centred from md. One row per account, each with its own families and roles.
function openAccountSheet() {
  document.querySelector('dialog.acct-sh')?.remove();
  const { items = [], max = 5 } = S.myAccounts();
  const act = activeAcc();
  const d = document.createElement('dialog'); d.className = 'acct-sh'; d.setAttribute('aria-labelledby', 'acct-h');
  d.innerHTML = `<div class="acct-box"><div class="acct-grab" aria-hidden="true"></div>
    <div class="csw-hd"><h2 id="acct-h" tabindex="-1" autofocus>Tài khoản</h2><button type="button" class="csw-x" aria-label="Đóng" title="Đóng">${cic('close', 20)}</button></div>
    <div class="acc-list">${[...items.filter((x) => x.active), ...items.filter((x) => !x.active)].map(accRowHtml).join('')}</div>
    ${act?.kind === 'google' ? `<a class="acc-add acc-manage" href="${hf('tai-khoan')}">${cic('user', 20)}<span>Quản lý tài khoản</span><span class="acc-go" aria-hidden="true">›</span></a>` : ''}
    ${items.length < max ? `<a class="acc-add" href="${googleUrl(hashNext())}">${icon('plus')}<span>Thêm tài khoản</span></a>` : `<p class="sub acc-max">Đã có ${max} tài khoản trên thiết bị này. Đăng xuất bớt để thêm.</p>`}
    ${act ? '<button type="button" class="acc-out" data-out="one">Đăng xuất tài khoản này</button>' : ''}
    ${items.length ? '<button type="button" class="acc-out dng" data-danger data-out="all">Đăng xuất tất cả</button>' : ''}</div>`;
  document.body.append(d);
  const close = () => { d.close(); d.remove(); };
  d.querySelector('.csw-x').addEventListener('click', close);
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.addEventListener('click', (e) => {
    if (e.target === d) return close();
    if (e.target.closest('.acc-manage')) { close(); return; } // the link opens the Account page
    const more = e.target.closest('[data-more]');
    if (more) { const ul = more.nextElementSibling; ul.hidden = !ul.hidden; more.setAttribute('aria-expanded', String(!ul.hidden)); return; }
    const sw = e.target.closest('[data-switch]');
    if (sw) {
      const same = act && (sw.dataset.email ? act.email === sw.dataset.email : !act.email);
      if (same) return close();
      switchTo(sw.dataset.email ? { email: sw.dataset.email } : { code: true }); return;
    }
    if (e.target.closest('[data-out="one"]')) { close(); askSignOut(act); return; }
    if (e.target.closest('[data-out="all"]')) { close(); askSignOutAll(); }
  });
  d.showModal();
}
// Switch: the family on screen stays when the new account can see it (the server decides), else its default.
// The page then reloads, so the device data of that account opens.
async function switchTo(which) {
  const cur = S.curFamily();
  try {
    await flushDraft();
    const j = await S.switchAccount(which, cur);
    if (j.family !== cur) location.hash = j.family === 'duong' ? '#tree' : `#/${j.family}/tree`;
    location.reload();
  } catch (e) { alert(e.message); }
}
// Unsent changes and drafts of one account, named in the confirm. They stay on this device for that account.
function pendingWarn(p) {
  const unsent = p.outbox + p.queued;
  if (!unsent && !p.drafts) return '';
  const parts = [unsent ? `${unsent} thay đổi chưa gửi` : '', p.drafts ? `${p.drafts} bản nháp` : ''].filter(Boolean).join(' và ');
  return `Còn ${parts} của tài khoản này trên thiết bị này. Chúng vẫn được giữ lại và sẽ gửi khi tài khoản này đăng nhập lại.`;
}
// Sign out of one account (default: the active one). The others stay signed in.
async function askSignOut(item = activeAcc()) {
  if (!item) return;
  await flushDraft();
  const p = await S.pendingFor(item.key);
  const others = (S.myAccounts().items || []).length - 1;
  confirmModal({ title: 'Đăng xuất khỏi tài khoản này?', body: `${accWho(item)} sẽ không còn đăng nhập trên thiết bị này.${others ? ` ${others} tài khoản khác vẫn đăng nhập.` : ''} Bạn sẽ cần đăng nhập lại để sửa và xem thông tin riêng tư.`,
    warn: pendingWarn(p), ok: 'Đăng xuất', danger: true,
    onOk: async () => { try { await flushDraft(); await S.signOutAccounts(item.email ? { email: item.email } : { code: true }); location.reload(); } catch (e) { alert(e.message); } } });
}
// Sign out of every account on this device; the confirm counts the unsent items of all of them.
async function askSignOutAll() {
  await flushDraft();
  const items = S.myAccounts().items || [];
  const ps = await Promise.all(items.map((a) => S.pendingFor(a.key)));
  const sum = ps.reduce((t, p) => ({ outbox: t.outbox + p.outbox, queued: t.queued + p.queued, drafts: t.drafts + p.drafts }), { outbox: 0, queued: 0, drafts: 0 });
  confirmDanger({ title: 'Đăng xuất tất cả tài khoản?', lose: [`Bạn sẽ đăng xuất khỏi ${items.length} tài khoản trên thiết bị này. Bạn sẽ cần đăng nhập lại để sửa và xem thông tin riêng tư.`, pendingWarn(sum)].filter(Boolean).join(' '), restore: 'Đăng nhập lại bất cứ lúc nào.', confirm: 'Đăng xuất tất cả', onConfirm: async () => { await flushDraft(); await S.signOutAccounts({ all: true }); location.reload(); } });
}
// queued suggestions reach the server on reconnect: say so
S.hooks.queueFlushed = (r) => { if (r.sent) toast(`Đã gửi ${r.sent} góp ý đang chờ`); if (r.refused) toast(`${r.refused} góp ý bị máy chủ từ chối và không được gửi lại`); if (location.hash.includes('mine')) loadMine(); };

// ---------- edit / suggest / add as a PAGE: #/<family>/sua/<personId> and #/<family>/them ----------
// Entry points call goForm(); the page reads formSt (set just before navigating). After a reload formSt is gone:
// sua still loads the person from the store; them starts blank.
// Sections, in order: Tên · Gia đình · Sinh · Mất · Nơi sống & nghề · Ghi chú & nguồn · Người góp ý.
// Auto values (Đời, Thứ, âm lịch) are recomputed on every change and saved as computed. "Sửa" stores an override,
// "Tự tính" drops it. Pure rules: web/js/formrules.js.
const FP_WIDE = ['note', 'verify', 'source', 'spouse', 'address', 'birth_place', 'burial', 'contact_public'];
const FP_AU = { gen: 'Đời', thu: 'Thứ', birth_lunar: 'Âm lịch', death_lunar: 'Âm lịch' };
const FP_AU_INPUT = { gen: 'Đời (số)', thu: 'Thứ', birth_lunar: 'Âm lịch (ngày/tháng)', death_lunar: 'Âm lịch (ngày/tháng)' };
const FP_SIMPLE = ['name', 'name_han', 'alias', 'title_name', 'place', 'job', 'religion', 'spouse', 'married', 'birth_place', 'photo', 'note', 'verify', 'source', 'contact_public'];
let formSt = null;        // {kind: 'sua'|'them', p, prefill, title, only, patch, note}
let formDirty = false;    // unsaved changes on the form page
let formDraftSaved = false; // a draft of this form is on the device (leaving loses nothing)
let formHash = null;      // hash of the form page (the guard compares against it)
// Quan hệ → Tạo người mới (relui.js): the basic form with the relation's prefill; the relation sheet follows the person
setNewPersonHandler((o) => (S.isAll() ? goForm(o) : addBasic({ fam: S.curFamily(), prefill: o.prefill, title: o.title, model: { people: M.ps, byId: M.byId }, onPicked: (id) => { if (id) o.afterSave?.(id); } })));
function goForm(st) {
  formSt = st; formDirty = false;
  // In "Tất cả" a form belongs to one family: the person's (or the parent's), else the family picker comes first.
  const fOf = st.kind === 'sua' ? st.p?.fam : (st.prefill?.parent && M.byId.get(st.prefill.parent)?.fam);
  const target = S.isAll() && !fOf ? hf('them') : fOf && S.isAll() ? `#/${fOf}/${st.kind === 'sua' ? `sua/${st.p.id}` : 'them'}` : hf(st.kind === 'sua' ? `sua/${st.p.id}` : 'them');
  if (location.hash === target) render(); else location.hash = target;
}
// Leaving the form with unsaved changes asks first. Returns true when the render must stop.
function formGuard() {
  if (!formDirty || !formHash) return false;
  if (location.hash === formHash) return true; // same page (a sync re-render): keep what was typed
  if (formNow) fpDraftSave(formNow.form, formNow.st, true); // leaving: the draft is written now, nothing is lost, no prompt
  formDirty = false; return false;
}
let formNow = null; // the open form (its draft is written at once when the page is left)
addEventListener('beforeunload', (e) => { if (formDirty) { e.preventDefault(); e.returnValue = ''; } });
const fpE = (s) => esc(s ?? '');
const FL2 = (k) => F.find((f) => f[0] === k)?.[1] || k;
// A field with its inline error slot (under the field, filled by fpShowErrs).
const fpW = (k, wide, inner) => `<div class="fld-w${wide ? ' wide' : ''}">${inner}<p class="fld-err" data-err="${k}" hidden></p></div>`;
const fpIn = (k, label, d, wide = false, extra = '') => fpW(k, wide, `<label class="fld">${esc(label)}<input name="${k}" value="${fpE(d[k])}" autocomplete="off" ${extra}></label>`);
const fpParentText = (x) => `${x.data.name}${x.data.gen ? ' · đời ' + x.data.gen : ''}`;
const fpPickDesc = (x) => [x.data.gen ? 'đời ' + x.data.gen : '', years(x.data), x.data.place && x.data.place.split(/[,→]/)[0].trim()].filter(Boolean).join(' · ');

// The contact list in the person form: rows of [type][value][remove], then "+ Thêm liên hệ" and the import link.
const ctItems = (st) => { try { const a = JSON.parse(st.v.contacts || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const ctIdxOf = (el) => Number(el.closest('[data-ct-row]')?.dataset.ctRow ?? -1);
const ctInputOf = (c) => CTYPE[c.type] || CTYPE.other;
function ctRowHtml(c, i) {
  const t = ctInputOf(c);
  return `<div class="ct-row" data-ct-row="${i}">
    <select class="ct-type" data-ct-type aria-label="Loại liên hệ">${CONTACT_TYPES.map((o) => `<option value="${o.id}" ${o.id === c.type ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
    <input class="ct-val" data-ct-val type="${t.input}" inputmode="${t.mode}" autocomplete="${t.ac}" placeholder="${esc(t.ph)}" aria-label="${esc(t.label)}" value="${fpE(c.value)}">
    <button type="button" class="ct-del" data-ct-del="${i}" aria-label="Bớt dòng ${esc(t.label)}">×</button></div>`;
}
const ctListHtml = (items) => items.length ? items.map(ctRowHtml).join('') : '<p class="sub ct-empty">Chưa có liên hệ nào.</p>';
function ctEditorHtml(st) {
  return `<div class="ct-wrap wide"><div class="ct-list" data-ct-list>${ctListHtml(ctItems(st))}</div>
    <p class="fld-err" data-err="contacts" hidden></p>
    <div class="ct-acts"><button type="button" class="btn gh sm" data-ct-add>+ Thêm liên hệ</button>
    <button type="button" class="linkbtn" data-ct-import>Nhập từ danh bạ</button></div></div>`;
}
// The rows as they are on the page (typed values included).
function ctReadDom(form) {
  return [...form.querySelectorAll('[data-ct-row]')].map((r) => ({ type: r.querySelector('[data-ct-type]').value, value: r.querySelector('[data-ct-val]').value }));
}
// Redraws the rows from the state; focuses one row's field when asked.
function ctRedraw(form, st, focusIdx = -1, focusField = 'val') {
  const host = form.querySelector('[data-ct-list]'); if (!host) return;
  host.innerHTML = ctListHtml(ctItems(st));
  if (focusIdx >= 0) host.querySelector(`[data-ct-row="${focusIdx}"] [data-ct-${focusField}]`)?.focus();
}
// One change to the list: the typed values first, then the change, then the redraw, the live check and the draft.
function ctMutate(form, st, fn, focusIdx = -1, focusField = 'val') {
  fpSync(form, st);
  const list = ctItems(st); fn(list);
  st.v.contacts = JSON.stringify(list);
  ctRedraw(form, st, focusIdx, focusField);
  formDirty = true; fpLive(form, st); fpDraftSave(form, st);
}
// The list as the draft and the conflict check compare it (text), and whether a saved field differs from the record.
const baseVal = (rec, k) => (k === 'contacts' ? JSON.stringify(contactList(rec)) : String(rec[k] ?? ''));
const differs = (k, rec, v) => (k === 'contacts' ? !sameList(contactList(rec), v) : String(rec[k] ?? '') !== String(v ?? ''));

// Blocks of the form. Only-mode (a single action such as "Vợ / chồng") gets a plain list of those fields.
// The form state (st.v) holds a value for every field of the form, drawn or not. An accordion panel is drawn from that
// state the first time it opens, so a closed section costs no inputs; save, suggest and drafts read the state, so every
// section counts, drawn or not. Only-mode (a single action such as "Vợ / chồng") draws a plain list of its fields.
const FP_CONTACT = ['contact_public']; // the contact list ('contacts') is members-only: fpKeys adds it
// Fields of the form for this viewer (guests have no contact fields); only-mode: the listed fields.
const fpKeys = (only, member) => (only ? new Set(only) : new Set([...FP_SIMPLE.filter((k) => member || !FP_CONTACT.includes(k)),
  'sex', 'parent', 'other_parent', 'birth_smart', 'death_smart', 'dead', 'gio_lunar', 'burial', ...(member ? ['contacts'] : [])]));
// The values the form starts with: the record (or the merged suggestion, or the prefill of a new person).
function fpInitVals(st) {
  const { d } = st; const v = {};
  for (const k of st.keys) v[k] = d[k] == null ? '' : String(d[k]);
  if (st.keys.has('sex')) v.sex = d.sex === 'm' || d.sex === 'f' ? d.sex : '';
  if (st.keys.has('birth_smart')) v.birth_smart = smartText(d.birth_date, d.born);
  if (st.keys.has('death_smart')) v.death_smart = smartText(d.death_date, d.died);
  if (st.keys.has('dead')) v.dead = isDead(d) ? 'on' : '';
  if (st.keys.has('contact_public')) v.contact_public = d.contact_public === 'yes' ? 'yes' : '';
  if (st.keys.has('contacts')) v.contacts = JSON.stringify(contactList(d)); // the list, as JSON text (a draft holds text too)
  return v;
}
const fpDeath = (st) => `<div class="fp-2col">${fpW('death_smart', false, `<label class="fld">Ngày mất<input name="death_smart" value="${fpE(st.v.death_smart)}" inputmode="numeric" autocomplete="off" placeholder="5/3/1963 · 3/1963 · 1963"></label>`)}<div class="fp-au fld-w" data-au="death_lunar"></div></div>`
  + `${fpIn('gio_lunar', 'Ngày giỗ (ÂL), nếu khác ngày mất', st.v, true)}${fpIn('burial', 'Nơi an táng', st.v, true)}`;
// Cha/mẹ: the chosen parent, or the search box (only one of the two is in the page).
function fpPickBox(st) {
  const par = st.v.parent ? M.byId.get(st.v.parent) : null;
  return `<div class="fld-w wide fp-pick"><span class="fld-l" id="pk-l">Cha/mẹ</span>
      ${par ? `<div class="pk-chosen"><span class="pk-name">${fpE(fpParentText(par))}</span> <button type="button" class="linkbtn" data-pk-clear>Bỏ chọn</button></div>`
        : '<input type="search" class="pk-q" placeholder="Gõ tên cha hoặc mẹ" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="pk-list" aria-labelledby="pk-l">'}
      <div class="pk-list" id="pk-list" role="listbox" hidden></div>
      <input type="hidden" name="parent" value="${fpE(st.v.parent)}">
      <p class="fld-err" data-err="parent" hidden></p></div>`;
}
// The inner blocks of one accordion section, from the state.
function fpBody(st, id) {
  const v = st.v; const { suggest } = st;
  if (id === 'su') return evFormBody(st);
  if (id === 'ten') {
    const names = !!(v.alias || v.title_name);
    return fpIn('name', 'Họ tên', v, true, 'required')
      + fpIn('name_han', 'Tên chữ Hán (tùy chọn)', v, true, 'lang="zh-Hant" placeholder="Nhập chữ Hán"')
      + `<div class="fp-more wide">${names ? `<div class="fp-2col">${fpIn('alias', 'Tên khác', v)}${fpIn('title_name', 'Tên húy / tự / hiệu', v)}</div>`
        : '<button type="button" class="linkbtn fp-expand" data-expand>＋ Tên khác, tên húy</button>'}</div>`
      + `<fieldset class="fp-field wide"><legend>Giới tính</legend><div class="fp-seg2" role="radiogroup">
      <label class="fp-seg-o"><input type="radio" name="sex" value="m" ${v.sex === 'm' ? 'checked' : ''}>Nam</label>
      <label class="fp-seg-o"><input type="radio" name="sex" value="f" ${v.sex === 'f' ? 'checked' : ''}>Nữ</label></div></fieldset>`;
  }
  if (id === 'gd') {
    // Table-backed families: parents and spouses are edited only in Quan hệ (their values stay in the state, unchanged).
    const tableRel = S.relOf(st.p?.fam || st.fam || S.curFamily()).source === 'table';
    return tableRel ? '<p class="sub wide">Cha mẹ, vợ/chồng và con sửa ở mục Quan hệ trên hồ sơ.</p>'
      + fpIn('married', 'Năm cưới', v) + `<div class="fp-2col wide"><div class="fp-au fld-w" data-au="gen"></div><div class="fp-au fld-w" data-au="thu"></div></div>`
      : fpPickBox(st) + '<div data-oth-host></div>' + fpIn('spouse', 'Vợ/chồng', v, true) + fpIn('married', 'Năm cưới', v)
      + `<div class="fp-2col wide"><div class="fp-au fld-w" data-au="gen"></div><div class="fp-au fld-w" data-au="thu"></div></div>`;
  }
  if (id === 'sinh') {
    return `<div class="fp-2col wide">${fpW('birth_smart', false, `<label class="fld">Ngày sinh<input name="birth_smart" value="${fpE(v.birth_smart)}" inputmode="numeric" autocomplete="off" placeholder="5/3/1963 · 3/1963 · 1963"></label>`)}<div class="fp-au fld-w" data-au="birth_lunar"></div></div>`
      + ((suggest && !S.isMember()) ? '<p class="sub wide">Ngày đầy đủ chỉ thành viên xem được. Bạn có thể góp ý ngày sinh đầy đủ.</p>' : '')
      + fpIn('birth_place', 'Nơi sinh', v, true);
  }
  if (id === 'mat') {
    const dead = v.dead === 'on';
    return `<label class="fp-switch wide"><input type="checkbox" name="dead" role="switch" ${dead ? 'checked' : ''}><span>Đã mất</span></label>`
      + `<div class="fp-death wide" data-death data-on="${dead ? '1' : ''}">${dead ? fpDeath(st) : ''}</div>`;
  }
  if (id === 'noi') return fpIn('place', 'Nơi sống', v) + fpIn('job', 'Nghề', v) + fpIn('religion', 'Tôn giáo', v);
  if (id === 'lien') {
    return ctEditorHtml(st)
      + fpW('contact_public', true, `<label class="fld">Hiện liên hệ công khai?<select name="contact_public"><option value="" ${v.contact_public !== 'yes' ? 'selected' : ''}>Không</option><option value="yes" ${v.contact_public === 'yes' ? 'selected' : ''}>Có</option></select></label>`);
  }
  // ghi
  const photo = `<div class="fld-w wide"><div class="fld">Ảnh<div class="phup">${v.photo ? `<img src="${fpE(v.photo)}" alt="">` : ''}<input name="photo" value="${fpE(v.photo)}" placeholder="Dán link ảnh${suggest ? '' : ' hoặc chọn ảnh'}">${suggest ? '' : '<label class="btn gh sm">Chọn ảnh<input type="file" accept="image/*" hidden data-photo></label>'}</div>${suggest ? '' : '<span class="sub" data-photomsg></span>'}</div></div>`;
  return photo + fpIn('note', 'Ghi chú', v, true) + fpIn('verify', 'Cần xác minh', v, true) + fpIn('source', 'Nguồn', v, true);
}
// Blocks of the form. Only-mode draws a plain list of its fields; otherwise one accordion item per section (the closed ones are empty).
function fpSections(st) {
  if (st.only) return `${card(`<div class="fgrid">${st.only.map((k) => fpIn(k, FL2(k), st.v, FP_WIDE.includes(k))).join('')}</div>`, { tag: 'section', cls: 'fp-sec' })}`;
  const sec = (id, title) => {
    const open = !!st.open[id];
    if (open) st.rendered.add(id);
    return accItem({ id, title, open, body: open ? `<div class="fgrid">${fpBody(st, id)}</div>` : '' });
  };
  const ids = [['ten', 'Tên'], ['gd', 'Gia đình'], ['sinh', 'Sinh'], ['mat', 'Mất'], ['noi', 'Nơi sống & nghề'], ['ghi', 'Ghi chú & nguồn']];
  if (st.p && !st.patch) ids.splice(ids.length - 1, 0, ['su', 'Sự kiện & câu chuyện']); // events and stories: members' and editors' people (not new people)
  if (S.isMember()) ids.push(['lien', 'Liên hệ']); // Liên hệ: members and above only (guests never see or send contact fields)
  let out = `<div class="acc-group">${ids.map(([id, t]) => sec(id, t)).join('')}</div>`;
  if (st.patch) out += `${card(`<h3 class="fp-h">Ghi chú</h3><div class="fgrid"><label class="fld wide">Ghi chú (cho quản trị)<input name="suggest_note" maxlength="1000" autocomplete="off" value="${fpE(st.patch.note)}"></label></div>`, { tag: 'section', cls: 'fp-sec' })}`;
  if (st.contrib) out += `${card(`<h3 class="fp-h">Người góp ý</h3><div class="fgrid">
      <label class="fld">Tên của bạn<input name="by_name" maxlength="80" autocomplete="name"></label>
      <label class="fld">SĐT / Email (để quản trị liên hệ)<input name="by_contact" maxlength="200" autocomplete="off"></label>
      <label class="fld wide">Ghi chú (cho quản trị)<input name="suggest_note" maxlength="1000" autocomplete="off"></label></div>
      <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>`, { tag: 'section', cls: 'fp-sec' })}`;
  return out;
}
// The drawn inputs into the state (the closed panels keep theirs). Every change goes through here before it is read.
function fpSync(form, st) {
  if (st.keys.has('contacts') && form.querySelector('[data-ct-list]')) st.v.contacts = JSON.stringify(ctReadDom(form));
  for (const el of form.querySelectorAll('input[name],select[name]')) {
    const n = el.name; if (!st.keys.has(n) || el.type === 'file') continue;
    if (el.type === 'checkbox') st.v[n] = el.checked ? 'on' : '';
    else if (el.type === 'radio') { if (el.checked) st.v[n] = el.value; }
    else st.v[n] = el.value;
  }
}
// The state into the drawn inputs (a draft restore).
function fpPushDom(form, vals) {
  for (const [n, x] of Object.entries(vals)) {
    form.querySelectorAll(`[name="${n}"]`).forEach((el) => {
      if (el.type === 'file') return;
      if (el.type === 'radio') el.checked = el.value === x;
      else if (el.type === 'checkbox') el.checked = x === 'on';
      else el.value = x;
    });
  }
}
// Draws one accordion panel from the state, the first time it opens (its chips and errors are painted by fpLive).
function fpRender(form, st, id) {
  if (st.only || st.rendered.has(id)) return;
  const panel = document.getElementById('acc-p-' + id); if (!panel) return;
  st.rendered.add(id);
  panel.innerHTML = `<div class="fgrid">${fpBody(st, id)}</div>`;
  if (id === 'gd') fpOtherOpts(form, st, false);
}
// Opens an accordion section (drawing it first) by id: used for errors and for conflicts in a closed section.
function fpOpen(form, st, id) { fpRender(form, st, id); accToggle(id, true); }
// The death block exists only for a deceased person (its inputs are not in the page otherwise).
function fpPaintDeath(form, st, dead) {
  const host = form.querySelector('[data-death]'); if (!host) return;
  const want = dead ? '1' : '';
  if (host.dataset.on === want) return;
  host.dataset.on = want; host.innerHTML = dead ? fpDeath(st) : '';
}

// Current values of every field, the auto values, and the inline errors. Pure read of the form; no save.
// Current values of every field (from the state), the auto values, and the inline errors. No save.
function fpResolve(form, st) {
  fpSync(form, st);
  const { d, only, v } = st;
  const sv = (k) => String(v[k] ?? '').trim();
  const has = (k) => st.keys.has(k);
  const errs = {};
  const err = (k, msg) => { if (!errs[k]) errs[k] = msg; };
  const vals = {};
  const on = (k) => !only || only.includes(k);
  const put = (k, x) => { if (on(k)) vals[k] = x ?? ''; };
  const ovOf = (k) => { const a = st.A[k]; return a ? ((a.v ?? '').trim() || null) : null; };
  const eff = {};
  const dead = !only && sv('dead') === 'on';
  for (const k of FP_SIMPLE) if (has(k)) put(k, sv(k));
  if (has('name_han')) { const he = hanNameError(sv('name_han')); if (he) err('name_han', he); }
  if (only) { st.eff = eff; return { vals, errs, dead, eff }; }
  put('sex', sv('sex'));
  if (has('contact_public')) put('contact_public', sv('contact_public'));
  if (has('contacts')) {
    const rows = ctItems(st);
    const bad = rows.map((c, i) => [c, i]).find(([c]) => String(c.value || '').trim() && contactError(c));
    if (bad) err('contacts', `Dòng ${bad[1] + 1}: ${contactError(bad[0])}`);
    put('contacts', cleanList(rows));
  }
  put('gio_lunar', dead ? sv('gio_lunar') : '');
  put('burial', dead ? sv('burial') : '');
  const parentId = sv('parent');
  put('parent', parentId);
  put('other_parent', parentId ? sv('other_parent') : '');
  // Ngày sinh, Ngày mất
  const bp = parseSmartDate(sv('birth_smart'));
  if (!bp.ok) err('birth_smart', bp.error);
  const dp = dead ? parseSmartDate(sv('death_smart')) : { ok: true, kind: 'empty' };
  if (!dp.ok) err('death_smart', dp.error);
  const bok = bp.ok ? bp : { kind: 'empty' }; const dok = dp.ok ? dp : { kind: 'empty' };
  if (dead && bok.kind !== 'empty' && cmpDate(dok, bok) < 0) err('death_smart', 'Năm mất trước năm sinh.');
  put('born', yrOf(bok)); put('birth_date', fullDate(bok));
  put('died', dead ? yrOf(dok) : ''); put('death_date', dead ? fullDate(dok) : '');
  put('living', dead ? 'dead' : d.living === 'dead' ? 'living' : (d.living ?? ''));
  // Đời
  const ovg = ovOf('gen'); let gen; let genAuto;
  if (ovg != null) {
    if (!/^\d{1,2}$/.test(ovg) || +ovg < 1 || +ovg > 30) err('gen', 'Đời là số từ 1 đến 30.');
    gen = Number(ovg);
  } else { genAuto = !parentId && !st.p && d.gen ? undefined : suggestGen(parentId, M.byId); gen = genAuto === undefined ? d.gen : genAuto; }
  put('gen', gen ?? '');
  eff.gen = { raw: gen == null ? '' : String(gen), text: gen == null ? 'chưa rõ' : String(gen), auto: ovg == null,
    hint: ovg != null ? 'sửa tay' : !parentId ? (genAuto === undefined ? 'điền sẵn' : 'người gốc') : genAuto === undefined ? 'cha/mẹ chưa có đời' : 'tự tính' };
  // Thứ
  const ovt = ovOf('thu'); const year = yearOfData({ born: yrOf(bok), birth_date: fullDate(bok) });
  let thuAuto = null; let thu;
  if (ovt != null) thu = ovt;
  else { thuAuto = suggestThu({ parentId, selfId: st.p ? st.p.id : null, year, people: M.ps, base: st.base }); thu = thuAuto == null ? (d.thu ?? '') : String(thuAuto); }
  put('thu', thu);
  eff.thu = { raw: thu == null ? '' : String(thu), text: thu || 'chưa rõ', auto: ovt == null,
    hint: ovt != null ? 'sửa tay' : thuAuto != null ? 'tự tính (theo năm sinh)' : !parentId ? 'chọn cha/mẹ để tự tính' : 'nhập năm sinh để tự tính' };
  // Âm lịch (sinh, mất)
  const lunar = (k, sol, storedFallback, okHint) => {
    const ov = ovOf(k);
    if (ov != null) {
      if (!/^\d{1,2}\/\d{1,2}( nhuận)?$/.test(ov)) err(k, 'Nhập ngày/tháng âm, ví dụ 12/2.');
      put(k, ov); eff[k] = { raw: ov, text: ov, auto: false, hint: 'sửa tay' }; return;
    }
    if (sol.kind === 'full') {
      const lu = lunarOf(sol.day, sol.month, +sol.year);
      put(k, lu.stored); eff[k] = { raw: lu.stored, text: lu.label, auto: true, hint: 'tự tính' };
    } else {
      put(k, storedFallback ?? ''); eff[k] = storedFallback ? { raw: storedFallback, text: storedFallback, auto: true, hint: okHint } : { raw: '', text: 'Nhập ngày đủ để tự tính', ph: true, auto: true, hint: '' };
    }
  };
  lunar('birth_lunar', bok, d.birth_lunar, 'nhập ngày sinh đủ ngày/tháng/năm');
  if (dead) lunar('death_lunar', dok, d.death_lunar, 'nhập ngày mất đủ ngày/tháng/năm');
  else { put('death_lunar', ''); }
  st.eff = eff;
  return { vals, errs, dead, eff };
}

// Show the inline errors (and only them) under the fields.
function fpShowErrs(form, errs) {
  form.querySelectorAll('[data-err]').forEach((p) => {
    const k = p.dataset.err; p.textContent = errs[k] || ''; p.hidden = !errs[k];
    const inp = form.querySelector(`[name="${k}"],[data-ov="${k}"]`);
    if (inp) inp.setAttribute('aria-invalid', errs[k] ? 'true' : 'false');
  });
}

// One auto chip (Đời, Thứ, Âm lịch): the value and its origin, or the override editor after "Sửa".
function fpPaintAu(form, st, k, force = false) {
  const host = form.querySelector(`[data-au="${k}"]`); if (!host) return;
  const a = st.A[k];
  if (a && a.open && !force) return; // the open editor keeps what is typed
  const e = st.eff[k] || {};
  const html = a && a.open
    ? `<label class="fld">${esc(FP_AU_INPUT[k])}<input data-ov="${k}" value="${fpE(a.v)}" inputmode="${k === 'gen' ? 'numeric' : 'text'}" autocomplete="off"></label>
       <button type="button" class="linkbtn" data-au-reset="${k}">Tự tính</button><p class="fld-err" data-err="${k}" hidden></p>`
    : `<span class="fld-l">${esc(FP_AU[k])}</span><div class="fp-ro${e.ph ? ' ph' : ''}"><span class="fp-ro-v">${fpE(e.text || '—')}</span>${e.hint ? `<span class="fp-ro-h">${fpE(e.hint)}</span>` : ''}<button type="button" class="linkbtn fp-ro-e" data-au-edit="${k}">Sửa</button></div><p class="fld-err" data-err="${k}" hidden></p>`;
  if (host.dataset.h !== html) { host.dataset.h = html; host.innerHTML = html; }
}

// Options of "Mẹ/cha thứ hai": the spouses of the chosen parent. One spouse is selected by itself.
// Options of "Mẹ/cha thứ hai": the spouses of the chosen parent. One spouse is selected by itself. The value lives in the
// state, so it is kept while the parent's panel is closed.
function fpOtherOpts(form, st, parentChanged) {
  fpSync(form, st);
  const pid = st.v.parent;
  const inl = pid ? M.inlaws(pid) : [];
  let cur = parentChanged ? '' : (st.v.other_parent || st.d.other_parent || '');
  const opts = inl.map((q) => [q.id, q.data.name + (q.data.spouse_n ? ` (vợ/chồng ${q.data.spouse_n})` : '')]);
  if (cur && !opts.some(([x]) => x === cur)) { const q = M.byId.get(cur); opts.push([cur, q ? q.data.name : cur]); }
  if (!pid) cur = '';
  else if (!cur && inl.length === 1 && (parentChanged || !st.p)) cur = inl[0].id; // one spouse: picked for a new person or a parent just chosen; an existing record is not changed on load
  st.v.other_parent = cur;
  const host = form.querySelector('[data-oth-host]'); if (!host) return;
  if (!pid) { host.innerHTML = ''; return; }
  if (!host.firstElementChild) host.innerHTML = '<div class="fld-w" data-oth><label class="fld">Mẹ/cha thứ hai<select name="other_parent"></select></label><p class="sub fld-hint" data-oth-note></p><p class="fld-err" data-err="other_parent" hidden></p></div>';
  const sel = host.querySelector('select[name="other_parent"]');
  sel.innerHTML = '<option value="">Chưa rõ</option>' + opts.map(([x, t]) => `<option value="${fpE(x)}">${fpE(t)}</option>`).join('');
  sel.value = cur;
  host.querySelector('[data-oth-note]').textContent = !inl.length ? 'Chưa có vợ/chồng của cha/mẹ này trong dữ liệu.' : '';
}

// Cha/mẹ: type-ahead (fuzzy.js), excluding the person and their descendants (no loops). Delegated from the form, so it
// works on the box after each redraw.
function fpPickExcluded(st) {
  const s = new Set();
  const walk = (id) => { if (s.has(id)) return; s.add(id); for (const c of M.kids(id)) walk(c.id); };
  if (st.p) walk(st.p.id);
  return s;
}
function fpPickSearch(form, st, q) {
  const list = form.querySelector('.pk-list'); if (!list) return;
  const v = q.value.trim(); if (!v) { list.hidden = true; return; }
  const ex = fpPickExcluded(st);
  const hits = searchPeople(M.ps.filter((x) => !ex.has(x.id) && st.famPeople(x)), v, { limit: 6 });
  list.innerHTML = hits.map((x) => personItem({ name: x.data.name }, { variant: 'compact', attrs: `role="option" data-pk="${fpE(x.id)}"`, sub: fpE(fpPickDesc(x)) })).join('')
    || '<span class="sub pad">Không thấy tên nào.</span>';
  list.hidden = false; q.setAttribute('aria-expanded', 'true');
}
function fpPickKey(form, st, e) {
  const list = form.querySelector('.pk-list'); if (!list) return;
  if (e.key === 'Enter') { const first = list.querySelector('[data-pk]'); if (first) { e.preventDefault(); fpPickSet(form, st, first.dataset.pk); } }
  else if (e.key === 'Escape') list.hidden = true;
}
// The parent becomes id ('' clears it): the state takes it, the box and the other-parent choice are drawn again, the form is re-checked.
// "Dòng họ" on the form changed (Tất cả): the pickers take the new family's people, the parent is cleared when it is not one of them,
// and the mode (edit or suggest) follows that family's role.
function fpSwitchFam(form, st, f) {
  if (!st.fams.includes(f) || f === st.fam) return;
  fpSync(form, st);
  st.fam = f; st.famPeople = (x) => (x.fam || 'duong') === f; st.suggest = modeOf(f); st.mode = st.suggest ? 'suggest' : 'edit';
  st.draftKey = draftKeyOf(f, st.suggest, st.p, st.patch);
  const save = $('#fpsave'); if (save) save.textContent = st.suggest ? 'Gửi góp ý' : 'Lưu';
  const note = $('#fpnote'); if (note) note.hidden = !st.suggest || !S.signedIn();
  formDirty = true;
  if (st.v.parent && !st.famPeople(M.byId.get(st.v.parent) || {})) st.v.parent = '';
  fpPickSet(form, st, st.v.parent || '');
  fpLive(form, st); fpDraftSave(form, st);
}
function fpPickSet(form, st, id) {
  if (id && !M.byId.get(id)) return;
  if (id && st.famPeople && !st.famPeople(M.byId.get(id))) return; // a parent belongs to the form's family
  fpSync(form, st); st.v.parent = id;
  const box = form.querySelector('.fp-pick'); if (box) box.outerHTML = fpPickBox(st);
  fpOtherOpts(form, st, true); formDirty = true; fpLive(form, st);
}

// Type-ahead for Cha/mẹ (fuzzy.js). Excludes the person and their descendants (no loops).

// Recompute and repaint everything that depends on the inputs: errors, auto chips, the death block.
// Recompute and repaint everything that depends on the inputs: errors, auto chips, the death block, and the summaries.
function fpLive(form, st) {
  form.querySelectorAll('[data-ov]').forEach((el) => { const k = el.dataset.ov; if (st.A[k]) st.A[k].v = el.value; });
  const r = fpResolve(form, st);
  if (!st.only) {
    for (const k of Object.keys(r.errs)) if (FP_SEC_OF[k]) fpOpen(form, st, FP_SEC_OF[k]); // an error inside a closed section opens it
    fpPaintDeath(form, st, r.dead);
  }
  for (const k of ['gen', 'thu', 'birth_lunar', 'death_lunar']) fpPaintAu(form, st, k);
  fpShowErrs(form, r.errs);
  if (!st.only) fpSummaries(form, st, r);
  return r;
}
// One-line summary in each accordion header; "Chưa có" in grey when the section is empty.
const FP_SEC_OF = { contacts: 'lien', name: 'ten', name_han: 'ten', alias: 'ten', title_name: 'ten', parent: 'gd', other_parent: 'gd', spouse: 'gd', married: 'gd', gen: 'gd', thu: 'gd',
  birth_smart: 'sinh', birth_lunar: 'sinh', birth_place: 'sinh', death_smart: 'mat', death_lunar: 'mat', gio_lunar: 'mat', burial: 'mat' };
function fpSummaries(form, st, r) {
  const v = r.vals; const par = v.parent ? M.byId.get(v.parent) : null;
  const year = v.died || v.death_date;
  const cnt = (keys) => keys.filter((k) => v[k]).length;
  const sums = {
    ten: [v.name, v.alias || v.title_name].filter(Boolean).join(' · '),
    gd: [par ? 'Cha/mẹ ' + par.data.name : '', v.gen ? 'đời ' + v.gen : '', v.thu ? 'Thứ ' + v.thu : ''].filter(Boolean).join(' · '),
    sinh: [v.birth_date || v.born ? 'Sinh ' + (v.birth_date || v.born) : '', v.birth_place].filter(Boolean).join(' · '),
    mat: r.dead ? ['Đã mất', year].filter(Boolean).join(' ') : '',
    noi: [v.place, v.job].filter(Boolean).join(' · '),
    ghi: cnt(['photo', 'note', 'verify', 'source']) ? `${cnt(['photo', 'note', 'verify', 'source'])} mục` : '',
    su: evSumText(st),
    lien: ctItems(st).filter((c) => String(c.value || '').trim()).length ? `${ctItems(st).filter((c) => String(c.value || '').trim()).length} mục` : '',
  };
  for (const [k, txt] of Object.entries(sums)) {
    const el = form.querySelector(`[data-acc-sum="${k}"]`); if (!el) continue;
    el.textContent = txt || 'Chưa có'; el.classList.toggle('muted', !txt);
  }
}

// ---------- drafts: saved on this device 800 ms after a change, offered back on reopen; never sent by themselves ----------
const fpNet = (x) => x instanceof TypeError || navigator.onLine === false;
async function fpQueue(item, st) {
  await S.queueAdd({ ...item, fam: item.fam || S.curFamily() }); // kept until the server takes it (store.flushQueue)
  await S.draftDelete(st.draftKey); formDirty = false;
  toast('Đang chờ mạng — sẽ gửi khi có mạng'); location.hash = hf('mine');
}
const FP_NOSAVE = ['website'];
const FP_MAP = { birth_smart: ['born', 'birth_date'], death_smart: ['died', 'death_date'], dead: ['living', 'died', 'death_date', 'death_lunar'] };
const FP_AUK = ['gen', 'thu', 'birth_lunar', 'death_lunar'];
// Every field's current value: the state, plus the inputs outside it (the suggestion's note and contact).
function fpRaw(form, st) {
  fpSync(form, st);
  const o = { ...st.v };
  form.querySelectorAll('input[name],select[name]').forEach((el) => {
    const n = el.name; if (st.keys.has(n) || FP_NOSAVE.includes(n) || el.type === 'file') return;
    if (el.type === 'checkbox') o[n] = el.checked ? 'on' : '';
    else if (el.type === 'radio') { if (el.checked) o[n] = el.value; else if (!(n in o)) o[n] = ''; }
    else o[n] = el.value;
  });
  return o;
}
function fpStatus(t) { const s = document.getElementById('fpstat'); if (s) s.textContent = t; }
function fpDraftSave(form, st, now = false) {
  clearTimeout(st.dt);
  const run = async () => {
    if (st.draftHold || !form.isConnected) return;
    const cur = fpRaw(form, st); const changed = {};
    for (const k of Object.keys(cur)) if (cur[k] !== (st.raw0[k] ?? '')) changed[k] = cur[k];
    const over = {}; for (const k of FP_AUK) if (st.A[k]) over[k] = st.A[k];
    if (!Object.keys(changed).length && !Object.keys(over).length && !(st.evq || []).length) { await S.draftDelete(st.draftKey); fpStatus(''); return; }
    const base = {}; for (const n of Object.keys(changed)) for (const k of FP_MAP[n] || [n]) base[k] = baseVal(st.serverD, k);
    await S.draftSave(st.draftKey, { mode: st.mode, personId: st.p ? st.p.id : 'new', patchId: st.patch ? st.patch.id : null, changed, base, over, ev: st.evq || [] });
    formDraftSaved = true; fpStatus(`Đã lưu nháp ${fmtTime(Date.now())}`);
  };
  if (now) return run(); // resolves once the draft is written
  st.dt = setTimeout(run, 800);
  return undefined;
}
// A switch or a sign-out writes the open form's pending draft first (a debounced write would be lost or misplaced by the reload).
async function flushDraft() { if (formNow) await fpDraftSave(formNow.form, formNow.st, true).catch(() => {}); }
// On open: a draft of this form is offered (Tiếp tục | Bỏ nháp). From Góp ý của tôi "Tiếp tục" restores at once.
async function fpCheckDraft(form, st) {
  const dr = await S.draftGet(st.draftKey).catch(() => null);
  if (!dr || !form.isConnected) { st.draftHold = false; return; }
  if (st.autoDraft) { fpRestore(form, st, dr); return; }
  form.insertAdjacentHTML('beforebegin', `<div class="fp-draft" role="status"><p>Có bản nháp chưa gửi lúc ${fmtTime(dr.saved)} — </p><span class="fp-draft-acts">${dangerButton('Bỏ nháp', 'data-dr-drop', { size: 'sm' })} <button type="button" class="btn sm" data-dr-go>Tiếp tục</button></span></div>`);
  const bar = form.parentElement.querySelector('.fp-draft');
  bar.querySelector('[data-dr-go]').onclick = () => { bar.remove(); fpRestore(form, st, dr); };
  bar.querySelector('[data-dr-drop]').onclick = () => confirmDanger({ title: 'Bỏ bản nháp này?', lose: 'Các thay đổi chưa gửi trong bản nháp sẽ mất.', confirm: 'Bỏ nháp', onConfirm: async () => { bar.remove(); await S.draftDelete(st.draftKey); st.draftHold = false; fpStatus(''); } });
}
function fpRestore(form, st, dr) {
  const changed = dr.changed || {};
  const names = Object.keys(changed);
  for (const n of names) if (st.keys.has(n)) st.v[n] = String(changed[n] ?? '');
  for (const k of Object.keys(dr.over || {})) st.A[k] = dr.over[k];
  if (Array.isArray(dr.ev)) { st.evq = dr.ev; const sec = document.getElementById('acc-p-su'); if (sec && st.rendered.has('su')) evAfterChange(st); }
  fpPushDom(form, changed);
  if (names.includes('contacts')) ctRedraw(form, st);
  const box = form.querySelector('.fp-pick'); if (box && names.includes('parent')) box.outerHTML = fpPickBox(st);
  fpOtherOpts(form, st, false);
  for (const k of FP_AUK) fpPaintAu(form, st, k, true);
  // conflict: the record changed on the server after the draft was made; the draft's value is kept and marked
  const cur = st.p ? (M.byId.get(st.p.id)?.data || {}) : {};
  for (const n of names) {
    const keys = FP_MAP[n] || [n];
    if (!keys.some((k) => baseVal(cur, k) !== String(dr.base?.[k] ?? ''))) continue;
    if (FP_SEC_OF[n]) fpOpen(form, st, FP_SEC_OF[n]); // the marked field must be on the page
    const el = form.querySelector(`[name="${n}"]`); const w = el?.closest('.fld-w') || el?.parentElement;
    if (w && !w.querySelector('.fld-conf')) w.insertAdjacentHTML('beforeend', '<p class="fld-conf">Đã có người sửa</p>');
  }
  fpLive(form, st);
  st.draftHold = false; formDirty = true; formDraftSaved = true; fpDraftSave(form, st);
  fpStatus('Đã khôi phục bản nháp');
}

// Role-based mode of a family: editors change people directly, everyone else sends a suggestion (see can()).
const isMemberRole = (r) => ['owner', 'admin', 'editor', 'member'].includes(r);
const modeOf = (f) => !S.can(S.roleIn(f), 'edit');
const draftKeyOf = (f, mode, p, patch) => `${f}|${patch ? 'patch' : mode ? 'suggest' : 'edit'}|${patch ? patch.id : p ? p.id : 'new'}`;
function formPage(arg) {
  const view = route().view;
  const st0 = formSt && (view === 'them' ? formSt.kind === 'them' : formSt.kind === 'sua' && formSt.p?.id === arg) ? formSt : null;
  formHash = location.hash; formDirty = false; formDraftSaved = false;
  let p = st0?.p || null;
  if (view === 'sua' && !p) p = M.byId.get(arg) || null;
  if (view === 'sua' && !p) { main.innerHTML = '<h1>Sửa thông tin</h1><p class="sub">Không tìm thấy người này.</p>'; return; }
  const patch = st0?.patch || null;
  // "Tất cả": a new person is added to a family chosen on the form (the families in scope, last used first).
  const inAll = S.isAll() && view === 'them';
  const fams = inAll ? S.scopeFams() : [];
  if (inAll && !fams.length) { main.innerHTML = '<h1>Thêm người</h1><p class="sub">Theo dõi một dòng họ trước để thêm người.</p>'; return; }
  const used = S.getPrefs().fam_used || [];
  const usedRank = (f) => (used.indexOf(f) < 0 ? 1e9 : used.indexOf(f));
  const fam = inAll ? (fams.includes(st0?.fam) ? st0.fam : [...fams].sort((a, b) => usedRank(a) - usedRank(b))[0]) : S.curFamily();
  const suggest = modeOf(fam) || !!patch;
  const famMember = inAll ? fams.some((f) => isMemberRole(S.roleIn(f))) : S.isMember();
  const famPeople = (x) => (x.fam || 'duong') === fam;
  const serverD = p ? { ...p.data } : {};
  const d = patch ? { ...serverD, ...patch.d } : p ? { ...p.data } : { ...(st0?.prefill || {}) };
  const only = st0?.only || null;
  const st = { p, patch, suggest, d, only, title: st0?.title, base: inferThuBase(M.ps.filter(famPeople)), fam, inAll, fams, famPeople,
    A: { gen: null, thu: null, birth_lunar: null, death_lunar: null }, eff: {}, contrib: suggest && !patch && !S.isMember(),
    open: { ten: true, gd: !p && !patch, ...(st0?.open ? { [st0.open]: true } : {}) },  // Tên open; Gia đình open when adding a person; others collapsed; st0.open: the section a link asks for
    serverD: patch ? serverD : d, mode: patch ? 'patch' : suggest ? 'suggest' : 'edit', autoDraft: !!st0?.autoDraft, draftHold: true,
    draftKey: draftKeyOf(fam, suggest, p, patch),
    keys: fpKeys(only, famMember), rendered: new Set(), evq: [], evEd: null }; // every field's state (st.v) is set below; closed panels draw from it; evq: pending events and stories
  st.v = fpInitVals(st);
  const name = p ? p.data.name : (d.name || 'Người mới');
  const h = patch || suggest ? 'Góp ý' : view === 'sua' ? 'Sửa thông tin' : 'Thêm người';
  const back = p ? hf(`person/${p.id}`) : hf('tree');
  const saveLbl = suggest && !patch ? 'Gửi góp ý' : 'Lưu';
  const famField = inAll ? `<div class="fld-w wide fp-fam"><label class="fld">Dòng họ<select id="fpfam">${fams.map((f) => `<option value="${fpE(f)}" ${f === fam ? 'selected' : ''}>${fpE(S.familyName(f))}</option>`).join('')}</select></label></div>` : '';
  main.innerHTML = `<h1>${esc(h)}</h1>
    <h1 class="keep fp-name">${esc(name)}</h1>
    ${st.title ? `<p class="sub">${esc(st.title)}</p>` : ''}
    ${suggest && !patch && !S.signedIn() ? `<div class="ntc fp-guest" role="note"><b>Bạn chưa đăng nhập</b><span class="sub">Sửa của bạn sẽ gửi thành góp ý, quản trị duyệt trước khi hiện. Đăng nhập để theo dõi góp ý của mình, và sửa trực tiếp khi được cấp quyền.</span>
      <div class="row wrap"><button type="button" class="btn sm" data-fp-login>Đăng nhập</button><button type="button" class="btn gh sm" data-fp-guest-x>Tiếp tục góp ý</button></div></div>` : ''}
    <form id="fpform" class="form-stack fp-form" novalidate>
      ${famField}
      <p class="sub" id="fpnote"${suggest && S.signedIn() ? '' : ' hidden'}>Quản trị sẽ duyệt góp ý trước khi hiện.</p>
      ${fpSections(st)}
      <p class="err" role="alert" hidden></p>
    </form>
    <div class="fp-bar" role="toolbar" aria-label="Thao tác">
      <span class="fp-status" id="fpstat" role="status" aria-live="polite"></span>
      <button type="button" class="btn gh" data-fp-cancel>Huỷ</button>
      <button type="submit" form="fpform" class="btn" id="fpsave">${esc(saveLbl)}</button>
    </div>`;
  const form = $('#fpform');
  // guest sign-in note: Đăng nhập opens the sign-in dialog; Tiếp tục góp ý hides the note
  const gNote = main.querySelector('.fp-guest');
  if (gNote) gNote.addEventListener('click', (e) => { if (e.target.closest('[data-fp-login]')) loginDialog(); else if (e.target.closest('[data-fp-guest-x]')) gNote.hidden = true; });
  // a focused text field is centred: never under the bottom bar or the on-screen keyboard (toggles and radios do not move)
  form.addEventListener('focusin', (e) => { if (e.target.matches('input:not([type=checkbox]):not([type=radio]),textarea')) e.target.scrollIntoView({ block: 'center' }); });
  const live = (e) => {
    if (e.target.matches?.('[data-ct-type]')) { ctMutate(form, st, () => {}, ctIdxOf(e.target), 'val'); return; } // a new type: the row redraws with its input
    if (e.target.classList?.contains('pk-q') || e.target.id === 'fpfam') return; formDirty = true; fpLive(form, st); fpDraftSave(form, st);
  };
  form.addEventListener('input', live);
  form.addEventListener('change', live);
  form.addEventListener('change', (e) => { if (e.target.id === 'fpfam') fpSwitchFam(form, st, e.target.value); });
  form.addEventListener('input', (e) => { if (e.target.classList?.contains('pk-q')) fpPickSearch(form, st, e.target); });
  form.addEventListener('keydown', (e) => { if (e.target.classList?.contains('pk-q')) fpPickKey(form, st, e); });
  form.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-pk]'); if (b) { e.preventDefault(); fpPickSet(form, st, b.dataset.pk); } });
  form.addEventListener('click', (e) => {
    if (evFormClick(form, st, e)) return; // the events and stories section
    if (e.target.closest('[data-ct-add]')) { ctMutate(form, st, (l) => l.push({ type: 'phone', value: '' }), ctItems(st).length, 'val'); return; }
    const cdel = e.target.closest('[data-ct-del]'); if (cdel) { const i = Number(cdel.dataset.ctDel); ctMutate(form, st, (l) => l.splice(i, 1), -1); return; }
    if (e.target.closest('[data-ct-import]')) {
      openContactImport({ person: { id: st.p?.id || null, name: st.v.name || '' }, onPick: (items) => ctMutate(form, st, (l) => {
        for (const it of items) if (!l.some((x) => x.type === it.type && String(x.value).trim() === it.value)) l.push(it);
      }, -1) });
      return;
    }
    // a closed panel is drawn when it is opened (the document handler opens it after this one)
    const ab = e.target.closest('[data-acc-btn]'); if (ab && !st.rendered.has(ab.dataset.accBtn)) { fpRender(form, st, ab.dataset.accBtn); fpLive(form, st); }
    const exp = e.target.closest('[data-expand]');
    if (exp) { exp.closest('.fp-more').innerHTML = `<div class="fp-2col">${fpIn('alias', 'Tên khác', st.v)}${fpIn('title_name', 'Tên húy / tự / hiệu', st.v)}</div>`; form.querySelector('[name="alias"]')?.focus(); return; }
    if (e.target.closest('[data-pk-clear]')) { fpPickSet(form, st, ''); form.querySelector('.pk-q')?.focus(); return; }
    const ed = e.target.closest('[data-au-edit]');
    if (ed) { const k = ed.dataset.auEdit; st.A[k] = { open: true, v: st.eff[k]?.raw ?? '' }; fpPaintAu(form, st, k, true); form.querySelector(`[data-ov="${k}"]`)?.focus(); return; }
    const rs = e.target.closest('[data-au-reset]');
    if (rs) { const k = rs.dataset.auReset; st.A[k] = null; fpPaintAu(form, st, k, true); formDirty = true; fpLive(form, st); }
  });
  $('[data-fp-cancel]').onclick = () => { location.hash = back; };
  fpOtherOpts(form, st, false);
  fpLive(form, st);
  st.raw0 = fpRaw(form, st); // what was loaded: a draft holds only what differs from it
  formNow = { form, st };
  fpCheckDraft(form, st);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form); const err = form.querySelector('.err'); err.hidden = true;
    const r = fpLive(form, st);
    const errs = { ...r.errs };
    if (!r.vals.name) errs.name = 'Cần ghi họ tên.';
    fpShowErrs(form, errs);
    const bad = Object.keys(errs)[0];
    if (bad) { (form.querySelector(`[name="${bad}"]`) || form.querySelector(`[data-ov="${bad}"]`))?.focus(); return; }
    const vals = r.vals;
    try {
      if (patch) { // my own pending suggestion: the changes against the person's record (PATCH replaces them)
        const next = {};
        for (const [k, v] of Object.entries(vals)) if (differs(k, serverD, v)) next[k] = v;
        if (!Object.keys(next).length) throw new Error('Chưa có thông tin nào thay đổi.');
        const note = (f.get('suggest_note') || '').trim();
        try { await S.updateSuggestion(patch.id, { changes: next, note }); }
        catch (x) { if (!fpNet(x)) throw x; return fpQueue({ type: 'update', id: patch.id, changes: next, note, label: 'Sửa góp ý' }, st); }
        await S.draftDelete(st.draftKey); formDirty = false; toast('Đã lưu góp ý. Vẫn chờ quản trị duyệt.'); location.hash = hf('mine'); return;
      }
      const out = {};
      for (const [k, v] of Object.entries(vals)) if (differs(k, d, v)) out[k] = v;
      if (!Object.keys(out).length && (st.evq || []).length) { // only events or stories changed
        await evFlush(st, p.id); await S.draftDelete(st.draftKey); formDirty = false; toast(st.suggest ? 'Đã gửi góp ý. Bạn xem lại trong Góp ý của tôi.' : 'Đã lưu');
        location.hash = st.suggest ? hf('mine') : hf(`person/${p.id}`); return;
      }
      // a new person keeps every prefilled value (a value equal to the prefill is still new data)
      if (!p) { for (const k of Object.keys(d)) if (k in vals && out[k] === undefined && d[k] !== undefined && d[k] !== '' && d[k] !== null) out[k] = d[k]; out.source = out.source || 'Bổ sung ' + fmtDate(Date.now()); }
      if (!Object.keys(out).length) { err.hidden = false; err.textContent = st.suggest ? 'Chưa có thông tin nào thay đổi.' : 'Chưa có thay đổi nào để lưu.'; return; }
      if (st.suggest) {
        const body = { family: st.fam, person_id: p ? p.id : null, changes: out, by_name: (f.get('by_name') || '').trim(), by_contact: (f.get('by_contact') || '').trim(),
          note: (f.get('suggest_note') || '').trim(), website: f.get('website') || '' };
        let j;
        try { j = await S.suggest(body); }
        catch (x) { if (!fpNet(x)) throw x; return fpQueue({ type: 'suggest', body, fam: st.fam, label: `Góp ý: ${p ? p.data.name : (vals.name || 'Người mới')}` }, st); }
        S.addReceipt(j.id, j.receipt); // kept on this device: the sender can see and change it later in Góp ý của tôi
        if (p) await evFlush(st, p.id);
        await S.draftDelete(st.draftKey); formDirty = false; toast('Đã gửi góp ý. Bạn xem lại trong Góp ý của tôi.'); location.hash = hf('mine'); return;
      }
      const id = p ? p.id : S.newId();
      await S.edit(id, out, st.fam);
      if (navigator.onLine === false) toast('Đang chờ mạng — sẽ gửi khi có mạng');
      if (p) await evFlush(st, id);
      await S.draftDelete(st.draftKey);
      if (!p && st0?.afterSave) await st0.afterSave(id); // e.g. link a new parent to the child
      formDirty = false; toast('Đã lưu'); location.hash = S.isAll() ? `#/${st.fam}/person/${id}` : hf(`person/${id}`);
    } catch (x) { err.hidden = false; err.textContent = x.message; }
  };
}
// confirm: the shared confirm (ui.js); the dialog stays open until the action is done, a failure shows in it
// Destructive-style question with a pending OK: the dialog stays open while fn runs and closes when it resolves.
function confirmDialog(t, body, ok, fn) {
  closeConfirms();
  openConfirm({ id: 'cfm', title: t, message: body, confirmLabel: ok, cancelLabel: CFM_CANCEL, danger: true, onConfirm: async () => { await fn(); render(); } });
}
function prompt2(t, v, fn) { dialog(`<h2>${esc(t)}</h2><label class="fld">Nội dung<input name="v" value="${esc(v)}"></label><div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn">Lưu</button></div>`, (f) => fn(f.get('v'))); }
async function historyDialog(id) {
  const rows = await fetch('/api/history/' + id).then((r) => r.json()).catch(() => []);
  dialog(`<h2>Lịch sử sửa</h2><div class="histlog">${rows.map((r) => `<div class="li"><span class="grow"><b>${esc(r.field)}</b> <span class="sub">${esc(r.by_user || '')} · ${fmtTime(r.at)}</span><span class="sub">${esc(JSON.stringify(r.old_value))} → ${esc(JSON.stringify(r.new_value))}</span></span></div>`).join('') || '<p class="sub">Chưa có (hoặc đang offline).</p>'}</div><div class="row end"><button class="btn">Đóng</button></div>`, () => {});
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'login') loginDialog();
  if (t.id === 'logout') askSignOut();
  if (t.id === 'cbback') goBack();
});
// Giỗ date typed as lunar day/month: "3/8", "3-8", "3 tháng 8", "mồng 3 tháng 8" (accent-insensitive). null when not a date.
function giaDateQuery(raw) {
  const m = /^(?:mong|mung|ngay)?\s*(\d{1,2})\s*(?:\/|-|thang)\s*(\d{1,2})$/.exec(fold(raw).trim());
  if (!m) return null; const d = +m[1], mo = +m[2];
  return d >= 1 && d <= 30 && mo >= 1 && mo <= 12 ? { d, m: mo } : null;
}
// "/" and Ctrl+K open Tìm with its search field focused (the list view focuses #q after it renders)
let timFocus = false;
function focusTimSearch() { timFocus = true; if (location.hash === hf('list')) render(); else location.hash = hf('list'); }
// The top-bar search button: on Tìm just focus the field (the query stays); anywhere else open Tìm focused.
function openTopSearch() { if (route().view === 'list' && $('#q')) $('#q').focus({ preventScroll: true }); else focusTimSearch(); }
let gKey = 0;
addEventListener('keydown', (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]');
  if (typing || e.metaKey || e.altKey) { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); focusTimSearch(); } return; }
  if (e.key === '/' || (e.ctrlKey && e.key === 'k')) { e.preventDefault(); focusTimSearch(); return; }
  if (e.key === 'g') { gKey = Date.now(); return; }
  if (Date.now() - gKey < 1200) { const to = { c: 'tree', t: 'list', s: 'book', g: 'lich', b: 'map', k: 'stats' }[e.key]; gKey = 0; if (to) location.hash = hf(to); }
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('#ics,#share'); if (!b) return;
  const now = new Date(); const list = M.all.map((p) => { const g = gioOf(p.data); const at = g && nextAnniversary(g.d, g.m, now); return at ? { p, g, at } : null; }).filter(Boolean).sort((a, x) => a.at - x.at);
  if (!list.length) return;
  if (b.id === 'ics') {
    const ymd = (t) => `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
    const ev = list.map(({ p, g, at }) => `BEGIN:VEVENT\r\nUID:${p.id}-${ymd(at)}@${location.host}\r\nDTSTAMP:${ymd(now)}T000000Z\r\nDTSTART;VALUE=DATE:${ymd(at)}\r\nSUMMARY:Giỗ ${rank(p.data)} ${p.data.name} (${g.label} ÂL)\r\nDESCRIPTION:${location.origin}/#person/${p.id}\r\nBEGIN:VALARM\r\nTRIGGER:-P2D\r\nACTION:DISPLAY\r\nDESCRIPTION:Sắp đến ngày giỗ\r\nEND:VALARM\r\nEND:VEVENT`).join('\r\n');
    download('ngay-gio.ics', icsCalendar(ev), 'text/calendar');
  } else {
    const { p, g, at } = list[0];
    const text = `Giỗ ${rank(p.data)} ${p.data.name}: ${g.label} âm lịch, ${at.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' })}. ${location.origin}/#person/${p.id}`;
    (navigator.share ? navigator.share({ text }) : navigator.clipboard.writeText(text).then(() => { b.textContent = 'Đã chép, dán vào Zalo'; })).catch(() => {});
  }
});
// ---------- desktop tree chart (design D1) ----------
let zoom = null;
function treeDesk(jump) {
  if (!M.roots.length) { main.innerHTML = '<p class="sub">Đang tải dữ liệu…</p>'; return; }
  const chi = S.getPrefs().filters?.chi || '';
  const branches = branchesOf(M);
  const root = (chi && M.byId.get(chi)) || M.roots[0];
  let sel = jump || localStorageGet('gp_sel') || root.id; if (!M.byId.get(sel)) sel = root.id;
  for (const q of lineage(M, M.byId.get(sel))) open.add(q.id);
  const rootGen = root.data.gen || 1;
  const isOpen = (p) => open.has(p.id) || (p.data.gen || 0) - rootGen < 2 && !open.has('!' + p.id);
  const L = chartLayout(M, root, isOpen);
  if (zoom == null) zoom = Math.max(0.5, Math.min(1, ((main.clientWidth || innerWidth) - 340 - 16 - 48) / (L.w + 8)));
  const p = M.byId.get(sel); const d = p.data;
  main.innerHTML = `<h1 class="vh">Cây gia phả</h1>${BT.bannerHtml(S.curFamily())}<div class="lbar"><select id="chi" aria-label="Chọn chi"><option value="">Cả họ</option>${branches.map((b) => `<option value="${b.id}" ${b.id === chi ? 'selected' : ''}>Chi ${esc(rank(b.data))} ${esc(chiName(b.data.name))}</option>`).join('')}</select>
   <button class="btn ter sm" id="qs2">Tìm người</button><span class="grow"></span>
   <span class="seg"><button class="on" id="mchart">Sơ đồ</button><button id="mlist">Danh sách</button></span>
   <button class="btn gh sm" id="oall">Mở hết</button><button class="btn gh sm" id="call">Đóng hết</button></div>
   <div class="tdesk"><div class="canvas" id="cv"><div class="zbar"><button id="zin" aria-label="Phóng to">+</button><button id="zout" aria-label="Thu nhỏ">−</button><button id="zfit" aria-label="Vừa khung">⤢</button></div>${chartSvg(M, L, sel, zoom, (LK.ensure(S.curFamily()), LK.linkedIds(S.curFamily())))}
     <div class="clg"><span><i class="m"></i>Nam</span><span><i class="f"></i>Nữ</span><span><b class="badge">+6</b> bấm để mở nhánh</span></div></div>
   <aside class="tside"><div class="row"><span class="tag blue">Đời ${d.gen || '?'}</span>${S.isEditor() ? `<button class="btn gh sm" data-act="edit" data-id="${p.id}" style="margin-left:auto">Sửa</button>` : ''}</div>
     <h2 class="big">${esc(d.name)}</h2><span class="sub">${esc([rank(d), relation(M, p)].filter(Boolean).join(' · '))}</span>
     <div class="kpis s">${[['Giỗ (ÂL)', d.gio_lunar || d.death_lunar || '—', 'c3'], ['Con', M.kids(p.id).length, 'c5'], ['Cháu chắt', M.desc(p.id) - M.kids(p.id).length, 'c1']].filter(([, v]) => v && v !== '—').map(([l, v]) => `<div class="kpi"><span class="sub">${l}</span><b>${esc(v)}</b></div>`).join('')}</div>
     <dl class="facts cd">${[['Sinh', d.born], ['Mất', d.died], [d.sex === 'f' ? 'Chồng' : 'Vợ', d.spouse], ['Nơi sống', d.place], ['Tên khác', d.alias]].filter((x) => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
     <h3>Dòng dõi</h3><ol class="tl">${lineage(M, p).map((q) => `<li><a href="${hf(`tree/@${q.id}`)}"><b>${esc(q.data.name)}</b></a><span class="sub">Đời ${q.data.gen || '?'}${q.data.place ? ' · ' + esc(q.data.place.split('→').pop().trim()) : ''}</span></li>`).join('')}</ol>
     <a class="btn sm" href="${hf(`person/${p.id}`)}">Mở hồ sơ đầy đủ</a></aside></div>`;
  $('#chi').onchange = (e) => { setChi(e.target.value); render(); };
  $('#mlist')?.addEventListener('click', () => { localStorageSet('gp_tmode', 'list'); render(); });
  $('#qs2').onclick = () => focusTimSearch();
  $('#oall').onclick = () => { M.ps.forEach((x) => M.kids(x.id).length && open.add(x.id)); saveOpen(); render(); };
  $('#call').onclick = () => { open.clear(); M.ps.forEach((x) => open.add('!' + x.id)); saveOpen(); render(); };
  const cv = $('#cv'); const svg = cv.querySelector('svg');
  const setZ = (z) => { zoom = Math.max(0.3, Math.min(1.6, z)); render(); };
  $('#zin').onclick = () => setZ(zoom + 0.15); $('#zout').onclick = () => setZ(zoom - 0.15);
  $('#zfit').onclick = () => setZ(Math.min(1.2, (cv.clientWidth - 24) / (L.w + 8)));
  // keep the selected box in view; drag to pan
  if (treeKeep) { cv.scrollLeft = treeKeep.l; cv.scrollTop = treeKeep.t; } // same selection: keep where the reader was
  const sb = !treeKeep && svg.querySelector('.cbx.sel'); if (sb) { const r = sb.getBoundingClientRect(), c = cv.getBoundingClientRect(); cv.scrollLeft += r.left - c.left - c.width / 2 + r.width / 2; cv.scrollTop += r.top - c.top - 80; }
  let drag = null;
  cv.onpointerdown = (e) => { if (e.target.closest('.cbx,button')) return; drag = { x: e.clientX, y: e.clientY, l: cv.scrollLeft, t: cv.scrollTop }; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => { if (drag) { cv.scrollLeft = drag.l - (e.clientX - drag.x); cv.scrollTop = drag.t - (e.clientY - drag.y); } };
  cv.onpointerup = () => { drag = null; };
}
main.addEventListener('click', (e) => {
  if (e.target.closest('[data-tg]')) return;
  const g = e.target.closest('.cbx[data-sel]'); if (!g) return;
  localStorageSet('gp_sel', g.dataset.sel); history.replaceState(null, '', hf('tree')); render();
});
main.addEventListener('keydown', (e) => { const g = e.target.closest?.('.cbx[data-sel]'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => route().view === 'tree' && render(), 200); });
addEventListener('hashchange', () => { trailUpdate(); render(); UPD.decide('nav'); });
S.subscribe(() => { const a = document.activeElement; if (a && main.contains(a) && a.tagName === 'INPUT') { M = build(); chrome(); } else renderSoon(); });
// ---------- app update: a new deploy while the app is open (web/js/update.js) ----------
// Busy (a form with unsaved changes or a dialog open): "Có bản mới · Tải lại". Idle: applied by itself on start, when
// the app comes back, on a manual check, on the next navigation or when the app is hidden (a day at the latest).
let updReg = null, updApplying = false;
function applyUpdate() { // Tải lại: the waiting worker takes over (skip-waiting), then the page reloads
  if (updApplying) return; updApplying = true;
  const w = updReg?.waiting;
  if (w) { w.postMessage({ type: 'skip-waiting' }); setTimeout(() => location.reload(), 3000); } // controllerchange reloads
  else location.reload();
}
const UPD = createUpdater({
  build: BUILD,
  fetchVersion: () => fetch('/api/version', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error('version'); return r.json(); }),
  isIdle: () => !formDirty && !document.querySelector('dialog[open]'),
  applyNow: () => applyUpdate(),
  showNotice: (on) => updateNotice(on, () => applyUpdate()),
  store: { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) },
  now: () => Date.now(),
});
navigator.serviceWorker?.addEventListener('controllerchange', () => { if (updApplying) location.reload(); });
// Checks: at start and when the app comes back to the foreground, at most once a day (UPD.check); the browser's own
// worker check runs with each of them. Going to the background applies a pending update when idle.
function updChecks(reg) {
  const check = (why) => UPD.check(why).then((r) => { if (!r.skipped) return reg.update().catch(() => {}); })
    .then(() => UPD.decide(why));
  check('open');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check('visible'); else UPD.decide('hide');
  });
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then((reg) => {
  updReg = reg;
  if (reg.waiting && navigator.serviceWorker.controller) UPD.waitingFound();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) UPD.markPending('detect'); });
  });
  updChecks(reg);
}).catch(() => {});
else UPD.check('open');
document.addEventListener('click', (e) => { if (e.target.closest('#chkupd')) UPD.check('manual').then((r) => { if (r.ok && !r.newer) toast('Đã là bản mới nhất'); else if (!r.ok) toast('Chưa kiểm tra được. Thử lại khi có mạng.'); }); });
// A person page on a cold device fetches that person and their relatives first (store.init focus).
S.init({ focus: () => { const r = route(); return (r.view === 'person' || r.view === 'sua') && r.arg && r.fam !== S.ALL_FAMS ? { fam: r.fam, id: r.arg } : null; } })
  .then(() => { const r = S.lastAccountSync(); if (r?.first && r.matched) toast(`Đã đồng bộ ${r.matched} góp ý`); });

// shell: switcher + nav toggle (W12)
document.addEventListener('click', (e) => {
  if (e.target.closest('#nav a')) document.activeElement?.blur?.();
  if (e.target.closest('#swbtn')) openSwitcher();
  else if (e.target.closest('[data-acct="in"]')) loginDialog();
  else if (e.target.closest('[data-acct="sheet"]')) openAccountSheet();
  else if (e.target.closest('#topsearch')) openTopSearch();
  else if (e.target.closest('#thm')) setTheme(isDark() ? 'light' : 'dark');
  else if (e.target.closest('#sntoggle')) { localStorageSet('gp_rail', railPref() ? '0' : '1'); chrome(); e.target.closest('#sntoggle')?.blur(); }
});

// ---------- search suggestions (W16) ----------
const ac = { box: null, i: -1, hits: [] };
function acDesc(p) {
  const d = p.data;
  return [d.spouse_of ? inLaw(p) : `Đời ${d.gen || '?'}`, d.spouse_of ? (d.sex === 'm' ? 'chồng ' : 'vợ ') + (M.byId.get(d.spouse_of)?.data.name || '') : relation(M, p), years(d), d.place && d.place.split(/[,→]/)[0].trim()].filter(Boolean).join(' · ');
}
function acPick(p) {
  acHide();
  location.hash = hf(route().view === 'tree' ? 'tree/@' + (p.data.spouse_of || p.id) : 'person/' + p.id);
}
function acHide() { if (ac.box) ac.box.hidden = true; ac.i = -1; }
function acShow() {
  const inp = $('#q'); const v = route().view;
  if (!inp || document.activeElement !== inp || !['tree', 'list'].includes(v)) return acHide();
  const q = fold(inp.value).trim();
  if (q.length < 2) return acHide();
  ac.hits = searchPeople(M.all, inp.value, { all: true, limit: 8 });
  if (!ac.hits.length) return acHide(); // no suggestion: no popup; the page's own empty line says it
  if (!ac.box) { ac.box = document.createElement('div'); ac.box.className = 'acbox'; ac.box.setAttribute('role', 'listbox'); ac.box.id = 'acbox'; document.body.append(ac.box);
    ac.box.addEventListener('mousedown', (e) => { const o = e.target.closest('[data-ac]'); if (o) { e.preventDefault(); acPick(M.byId.get(o.dataset.ac)); } }); }
  const r = inp.getBoundingClientRect();
  const w = Math.min(Math.max(r.width, 320), innerWidth - 32); const l = Math.max(16, Math.min(r.left, innerWidth - 16 - w));
  Object.assign(ac.box.style, { left: l + 'px', top: r.bottom + 'px', width: w + 'px' });
  ac.box.innerHTML = ac.hits.map((p, i) => personItem({ rank: p.data.hidden_living ? '' : rank(p.data), name: nameOf(p.data) }, { variant: 'compact', tag: 'div', on: i === ac.i, attrs: `role="option" id="aco${i}" data-ac="${p.id}" aria-selected="${i === ac.i}"`, sub: esc(acDesc(p)) })).join('');
  inp.setAttribute('aria-controls', 'acbox'); inp.setAttribute('aria-expanded', 'true');
  ac.box.hidden = false;
}
document.addEventListener('input', (e) => { if (e.target.id === 'q') { ac.i = -1; acShow(); } });
document.addEventListener('focusin', (e) => { if (e.target.id === 'q') acShow(); });
document.addEventListener('focusout', (e) => { if (e.target.id === 'q') setTimeout(() => { if (document.activeElement?.id !== 'q') acHide(); }, 150); });
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'q' || !ac.box || ac.box.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = ac.hits.length; if (!n) return; ac.i = (ac.i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; acShow(); }
  else if (e.key === 'Enter' && ac.i >= 0) { e.preventDefault(); acPick(ac.hits[ac.i]); }
  else if (e.key === 'Escape') { acHide(); }
}, true);
// every modal (login, edit, quick search, family switcher) closes on a click outside its box
document.addEventListener('mousedown', (e) => {
  const d = e.target; if (!(d instanceof HTMLDialogElement) || !d.open) return;
  const r = d.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { d.close(); d.remove(); if (d.classList.contains('csw')) $('#swbtn')?.focus(); }
});
// The rail (tablet and up) opens over the page while focus is in it: Esc or a nav item tap gives the focus back to the page.
addEventListener('keydown', (e) => { const a = document.activeElement; if (e.key === 'Escape' && a?.closest?.('#nav')) a.blur(); });
addEventListener('hashchange', acHide); addEventListener('resize', () => acShow());
addEventListener('layoutchange', () => render()); addEventListener('scroll', () => { if (ac.box && !ac.box.hidden) acShow(); }, true);

// Giỗ page search: filter rows in place
document.addEventListener('input', (e) => {
  if (e.target.id !== 'gq') return;
  const q = fold(e.target.value).trim(); let n = 0;
  for (const r of main.querySelectorAll('.gior')) { const hit = (!q || r.dataset.q.includes(q)) && NW.kindHit(r); r.hidden = !hit; if (hit) n++; }
  let em = main.querySelector('#gqnone'); if (!n && !em) main.querySelector('.gior')?.parentElement.insertAdjacentHTML('beforeend', '<p class="sub pad" id="gqnone">Không thấy ngày giỗ nào.</p>'); else if (n && em) em.remove();
});

// ---------- Cây gia phả for all families: #/tat-ca/tree (the old find page is merged in) ----------
// Search (name, Hán, quê quán) filters both sections. "Dòng họ của bạn": followed or member families, one row each,
// opens the tree. "Khám phá · công khai": public families not followed, the row opens the read-only preview and
// "Theo dõi" follows it. "Xem cả họ X ›" sits under a row only when that surname has more than one family.
let cayQ = ''; let cayT = null;
function cayPage() {
  // a same-route re-render keeps the page (render() leaves it in place): repaint the list when the new data is in
  if ($('#flist') && $('#fq')) return paintCay(cayQ);
  // the shared list toolbar; no filter button on this page (filter: false), the add link is its one icon button
  main.innerHTML = `${toolbar({ id: 'fq', ph: 'Tìm họ, chữ Hán, quê quán', val: cayQ, filter: false, add: `<a class="fbtn" href="#lap-gia-pha" aria-label="Lập gia phả mới" title="Lập gia phả mới">${cic('plus', 20)}</a>` })}
    <div id="flist" class="cay"><p class="sub">Đang tìm…</p></div>`;
  paintCay(cayQ);
}
const cayRow = (f, counts, mine, showClan) => {
  const facts = mine ? ['Đang theo dõi', f.people != null ? `${f.people} người` : '', f.generations ? `${f.generations} đời` : ''].filter(Boolean).join(' · ')
    : [f.people != null ? `${f.people} người` : '', f.place].filter(Boolean).join(' · ');
  const row = calmRow({ href: `#/${f.slug}/tree`, tile: familyCrest(f, 'md'), title: f.short_name || f.name, subtitle: esc(facts), dense: true,
    action: mine ? '' : `<button type="button" class="btn sm cay-follow" data-fam-follow="${esc(f.id)}" aria-pressed="false">Theo dõi</button>` });
  const h = CL.clanHref(f.name, f.country); const n = counts.get(CL.familySurname(f.name)) || 1;
  const clan = showClan && h && n > 1 ? `<a class="cay-clan" href="${esc(h)}">Xem cả họ ${esc(CL.familySurname(f.name))} ›</a>` : '';
  return `<div class="cay-item">${row}${clan}</div>`;
};
async function paintCay(q) {
  const box = $('#flist'); if (!box) return;
  try {
    const [items, all] = await Promise.all([S.searchFamilies(q), q ? S.searchFamilies('') : null]);
    if (!$('#flist')) return;
    const counts = new Map();
    for (const f of all || items) { if (!CL.inClan(f.name, f.country)) continue; const k = CL.familySurname(f.name); counts.set(k, (counts.get(k) || 0) + 1); }
    const mine = items.filter((f) => f.my_role || S.isFollowing(f.id));
    const disc = items.filter((f) => !mine.includes(f) && f.visibility === 'public');
    // "Xem cả họ X ›" once per surname: under the first row of that surname, top to bottom
    const seen = new Set(); const once = (f) => { const k = CL.familySurname(f.name); if (seen.has(k)) return false; seen.add(k); return true; };
    let html = '';
    if (mine.length) html += `<h2 class="cay-h">Dòng họ của bạn · ${mine.length}</h2>${card(`${mine.map((f) => cayRow(f, counts, true, once(f))).join('')}`, { cls: 'cay-list' })}`;
    if (disc.length) html += `<h2 class="cay-h">Khám phá · công khai</h2>${card(`${disc.map((f) => cayRow(f, counts, false, once(f))).join('')}`, { cls: 'cay-list' })}`;
    if (!mine.length && !disc.length) html += `<p class="sub">Không thấy dòng họ nào${q ? ' khớp "' + esc(q) + '"' : ''}.</p>`;
    html += SUC.createCardHtml();
    html += '<p class="sub cay-help">Chạm một dòng để mở cây. Dòng họ chưa theo dõi mở ở chế độ xem trước.</p>';
    $('#flist').innerHTML = html;
  } catch (e) { $('#flist').innerHTML = `<p class="sub">${esc(e.message)}</p>`; }
}
document.addEventListener('input', (e) => {
  if (e.target.id !== 'fq') return;
  cayQ = e.target.value;
  clearTimeout(cayT); cayT = setTimeout(() => paintCay(cayQ.trim()), 220);
});

// ---------- one family's settings: #/<family>/cai-dat-dong-ho ----------
const VIS_OPTS = [['public', 'Công khai', 'Ai cũng tìm thấy và xem được.'],
  ['link', 'Ai có đường dẫn', 'Không hiện khi tìm kiếm. Chỉ mở được bằng đường dẫn.'],
  ['private', 'Riêng tư', 'Chỉ thành viên thấy. Người khác không tìm thấy và không mở được.']];
const famRowsHtml = (rows) => rows.map(([k, v]) => `<div class="famr-kv"><span class="sub">${esc(k)}</span><span>${esc(v || '—')}</span></div>`).join('');
function confirmPrivate(onOk, onCancel) {
  let ok = false;
  const d = dialog(`<h2>Đặt dòng họ thành riêng tư?</h2><p class="sub">Người không phải thành viên sẽ không còn tìm thấy hay mở được dòng họ này. Thành viên vẫn xem như bình thường.</p><div class="row end"><button type="button" class="btn gh" data-cancel>Hủy</button><button class="btn dng">Đặt riêng tư</button></div>`,
    () => { ok = true; return onOk(); });
  d.addEventListener('close', () => { if (!ok) onCancel(); });
}
// Chi và thủy tổ (clan step 1): everything is worked out from the tree (web/js/branches.js); the admin only overrides.
// Shown: computed values with a "Tự động" tag and the reason. One "Sửa tay" switch reveals the overrides + "Về tự động".
const clanDefault = (f) => [bareName(f.name), f.origin_place || f.place].filter(Boolean).join(' · ');
const branchLabel = (p) => `Chi ${rank(p.data)} ${p.data.name}`;
const autoTag = (auto) => tag(auto ? 'Tự động' : 'Sửa tay', { tone: auto ? 'blue' : 'gray', sm: true });
function clanOrderRows(list, arrows) {
  return list.map((p, i) => `<li class="clan-row" data-bid="${esc(p.id)}"><span class="clan-n">${i + 1}. ${esc(branchLabel(p))}</span>${arrows
    ? `<span class="clan-acts"><button type="button" class="btn gh sm" data-up aria-label="Đưa ${esc(p.data.name)} lên"${i ? '' : ' disabled'}>↑</button><button type="button" class="btn gh sm" data-dn aria-label="Đưa ${esc(p.data.name)} xuống"${i < list.length - 1 ? '' : ' disabled'}>↓</button></span>` : ''}</li>`).join('') || '<li class="sub">Dòng chưa chia nhánh.</li>';
}
// the computed view for a settings object (saved or being edited)
function clanView(f, c) {
  const fo = founderOf(M, c, f.id); const bi = branchInfo(M, c, f.id, { all: true });
  const kv = (k, v, tag, why) => `<div class="famr-kv"><span class="sub">${esc(k)}</span><span>${esc(v || '—')} ${tag || ''}${why ? `<span class="sub clan-why">${esc(why)}</span>` : ''}</span></div>`;
  return kv('Tên ngắn', c.short_name || clanDefault(f), autoTag(!c.short_name), c.short_name ? '' : 'tên họ và quê gốc')
    + kv('Thủy tổ', fo.person ? `Đời ${fo.person.data.gen ?? '?'} · ${rank(fo.person.data)} ${fo.person.data.name}` : '', fo.person ? autoTag(fo.auto) : '', fo.person && fo.auto ? fo.reason : '')
    + kv('Chi', bi.founders.length ? `${bi.founders.length} chi · đời ${bi.gen ?? '?'}` : '', autoTag(bi.auto), bi.reason)
    + `<h4 class="clan-h">Thứ tự chi ${autoTag(!c.branch_order)}<span class="sub">${c.branch_order ? '' : 'Thứ, ngày sinh, tên'}</span></h4>`;
}
function clanCard(f, admin) {
  const c = { short_name: f.short_name, founder_person_id: f.founder_person_id, branch_gen: f.branch_gen, branch_order: f.branch_order };
  const list = branchInfo(M, c, f.id, { all: true }).founders;
  const manualOn = !!(f.short_name || f.founder_person_id || f.branch_gen || f.branch_order);
  const view = `<div id="clan-view">${clanView(f, c)}</div><ol class="clan-list" id="clan-order">${clanOrderRows(list, admin && manualOn)}</ol>`;
  if (!admin) return section('Chi và thủy tổ', `${view}${famRowsHtml([['Quê gốc', f.origin_place], ['Quốc gia', f.country ? countryName(f.country) : '']])}`, { variant: 'card', attrs: 'id="clan"' });
  const people = M.ps.filter((p) => !p.fam || p.fam === f.id).filter((p) => !p.data.parent || !M.byId.get(p.data.parent) || (p.data.gen || 99) <= 3)
    .sort((x, y) => (x.data.gen || 99) - (y.data.gen || 99) || String(x.data.name).localeCompare(String(y.data.name), 'vi'));
  return section('Chi và thủy tổ', `
    <form id="fclan" class="form-stack">
      ${view}
      <label class="fld">Quê gốc<input name="origin_place" value="${esc(f.origin_place || '')}" maxlength="120"></label>
      <label class="fld">Quốc gia<input name="country" list="qg-list" value="${esc(f.country ? countryName(f.country) : '')}" placeholder="Gõ để tìm, ví dụ Việt Nam" autocomplete="off"></label>
      <datalist id="qg-list">${COUNTRIES.map(([, n]) => `<option value="${esc(n)}">`).join('')}</datalist>
      <label class="swt"><input type="checkbox" name="manual"${manualOn ? ' checked' : ''}> <span>Sửa tay <span class="sub">(chỉ khi tự động chưa đúng)</span></span></label>
      <fieldset id="clan-man" class="form-stack"${manualOn ? '' : ' hidden'}>
        <label class="fld">Tên ngắn<input name="short_name" value="${esc(f.short_name || '')}" maxlength="60" placeholder="${esc(clanDefault(f))}"></label>
        <label class="fld">Thủy tổ<select name="founder_person_id"><option value="">Tự động</option>${people.map((p) => `<option value="${esc(p.id)}"${p.id === f.founder_person_id ? ' selected' : ''}>Đời ${esc(p.data.gen || '?')} · ${esc(rank(p.data))} ${esc(p.data.name)}</option>`).join('')}</select></label>
        <label class="fld">Đời của chi<input name="branch_gen" type="number" inputmode="numeric" min="1" max="30" value="${esc(f.branch_gen || '')}" placeholder="Tự động"></label>
        <p class="sub">Thứ tự chi: dùng ↑ ↓ trong danh sách trên.</p>
        <div class="row"><button type="button" class="btn ter sm" id="clan-auto">Về tự động</button></div>
      </fieldset>
      <div class="row end"><button class="btn">Lưu</button></div>
      <p class="err" hidden></p>
    </form>`, { variant: 'card', attrs: 'id="clan"' });
}
function bindClan(f, slug) {
  const form = $('#fclan'); if (!form) return;
  let manual = Array.isArray(f.branch_order) ? [...f.branch_order] : null;
  const on = () => form.manual.checked;
  const cfg = () => (on() ? { short_name: form.short_name.value.trim() || null, founder_person_id: form.founder_person_id.value || null, branch_gen: Number(form.branch_gen.value) || null, branch_order: manual }
    : { short_name: null, founder_person_id: null, branch_gen: null, branch_order: null });
  const draw = () => {
    const c = cfg(); const ff = { ...f, origin_place: form.origin_place.value.trim() || null };
    $('#clan-view').innerHTML = clanView(ff, c);
    $('#clan-order').innerHTML = clanOrderRows(branchInfo(M, c, f.id, { all: true }).founders, on());
    $('#clan-man').hidden = !on();
  };
  form.manual.onchange = draw;
  for (const n of ['short_name', 'founder_person_id', 'origin_place']) form[n].oninput = draw;
  form.branch_gen.oninput = () => { manual = null; draw(); };
  $('#clan-order').onclick = (e) => {
    const b = e.target.closest('[data-up],[data-dn]'); if (!b) return;
    const ids = [...form.querySelectorAll('#clan-order [data-bid]')].map((x) => x.dataset.bid);
    const i = ids.indexOf(b.closest('[data-bid]').dataset.bid); const j = b.hasAttribute('data-up') ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]]; manual = ids; draw();
    form.querySelector(`[data-bid="${CSS.escape(ids[j])}"] ${b.hasAttribute('data-up') ? '[data-up]' : '[data-dn]'}`)?.focus();
  };
  $('#clan-auto').onclick = () => { manual = null; form.short_name.value = ''; form.founder_person_id.value = ''; form.branch_gen.value = ''; form.manual.checked = false; draw(); };
  form.onsubmit = async (e) => {
    e.preventDefault(); const err = form.querySelector('.err'); err.hidden = true;
    try {
      const qg = countryCode(form.country.value); if (qg === null) throw new Error('Chọn quốc gia trong danh sách (hoặc để trống).');
      await S.patchFamily(slug, { ...cfg(), origin_place: form.origin_place.value, country: qg });
      toast('Đã lưu chi và thủy tổ'); render();
    } catch (x) { err.hidden = false; err.textContent = x.message; }
  };
}
function famSettings() {
  const slug = S.curFamily(); const f = S.familyMeta(slug);
  if (!f) { main.innerHTML = '<h1>Cài đặt dòng họ</h1><p class="sub">Đang mở dòng họ…</p>'; return; }
  const admin = S.isAdmin(); const own = S.isOwner(); const mem = S.isMember(); const following = S.isFollowing(f.id);
  const disabled = admin ? '' : ' disabled';
  const defRec = followedRecs().find((x) => x.id === S.defaultFamily());
  const defLabel = defRec ? defRec.name : S.defaultFamily() === S.ALL_FAMS ? 'Tất cả dòng họ' : 'Họ Dương';
  // Dữ liệu: GEDCOM export for members, import for owners and admins (same rows, same sheet).
  const gxCard = (mem || admin) ? section('Dữ liệu', `
      ${mem ? calmRow({ attrs: 'id="gx-export"', title: 'Xuất GEDCOM', subtitle: 'Tệp .ged cho MyHeritage, Ancestry', dense: true, trailing: 'none' }) : ''}
      ${admin ? calmRow({ attrs: 'id="gx-import"', title: 'Nhập GEDCOM', subtitle: 'Xem trước rồi mới nhập', dense: true, trailing: 'none' }) : ''}`, { variant: 'card', attrs: 'id="gx"' }) : '';
  main.innerHTML = `<h1>Cài đặt dòng họ</h1>
    ${section('Thông tin', `
      ${admin ? `<form id="finfo" class="form-stack"><label class="fld">Tên dòng họ<input name="name" value="${esc(f.name)}" required maxlength="80"></label>
        <label class="fld">Chữ Hán<input name="han" value="${esc(f.han || '')}" maxlength="20"></label>
        <label class="fld">Quê quán<input name="place" value="${esc(f.place || '')}" maxlength="120"></label>
        <div class="row end"><button class="btn">Lưu thông tin</button></div><p class="err" hidden></p></form>`
        : `${famRowsHtml([['Tên', f.name], ['Chữ Hán', f.han], ['Quê quán', f.place]])}<p class="sub">Chỉ Chủ họ và Quản trị sửa được.</p>`}
    `, { variant: 'card' })}
    ${admin ? emblemField(f) : ''}
    ${clanCard(f, admin)}
    ${SN.originCardHtml(f, admin)}
    ${section('Ai thấy', `
      ${VIS_OPTS.map(([v, l, d]) => `<label class="radio fvis"><input type="radio" name="vis" value="${v}" ${f.visibility === v ? 'checked' : ''}${disabled}> <span><b>${l}</b><span class="sub">${d}</span></span></label>`).join('')}
      ${admin ? '' : '<p class="sub">Chỉ Chủ họ và Quản trị đổi được.</p>'}
    `, { variant: 'card' })}
    ${CN.voteRuleCard(own)}
    ${NW.postersCard(S.isOwner())}
    ${gxCard}
    ${card(`${calmRow({ attrs: 'id="setdef"', title: 'Mở khi vào ứng dụng', subtitle: defLabel, dense: true })}`)}
    ${admin ? `${card(`${calmRow({ href: hf('nguoi-ke-nhiem'), title: 'Người kế nhiệm', subtitle: 'Ủy thác · thời hạn · chuyển quyền', dense: true })}`)}` : ''}
    ${admin ? section('Thành viên', calmRow({ href: `#/${f.slug}/members`, title: 'Thành viên & quyền', dense: true }), { variant: 'card' }) : ''}
    ${section('Theo dõi', `
      ${own ? '<p class="sub">Chủ họ cần giao quyền Chủ họ cho người khác trước khi rời dòng họ.</p>'
        : mem ? calmRow({ attrs: 'id="leave" data-danger', title: 'Rời dòng họ', dense: true, danger: true })
          : following ? calmRow({ attrs: 'id="unfollow"', title: 'Bỏ theo dõi', dense: true })
            : calmRow({ attrs: 'id="follow"', title: 'Theo dõi dòng họ này', dense: true })}
    `, { variant: 'card' })}
    ${dangerZone(['<button type="button" class="btn ter sm" disabled>Chuyển quyền Chủ họ (Sắp có)</button>', dangerButton('Xóa dòng họ (Sắp có)', 'disabled', { size: 'sm' })])}`;
  if (admin) {
    $('#finfo').onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(e.target); const err = e.target.querySelector('.err');
      try { await S.patchFamily(slug, { name: fd.get('name'), han: fd.get('han'), place: fd.get('place') }); toast('Đã lưu thông tin'); render(); }
      catch (x) { err.hidden = false; err.textContent = x.message; }
    };
    bindEmblem(f, async (m) => { toast(m); await S.fetchFamily(slug, { fresh: true }); render(); });
    bindClan(f, slug);
    $('#origin-form').onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(e.target); const err = e.target.querySelector('.err');
      try { await S.patchFamily(slug, { origin_surname: fd.get('origin_surname'), origin_surname_han: fd.get('origin_surname_han'), origin_year: fd.get('origin_year'), origin_reason: fd.get('origin_reason'), origin_visibility: fd.get('origin_visibility') }); toast('Đã lưu họ gốc'); render(); }
      catch (x) { err.hidden = false; err.textContent = x.message; }
    };
  }
  main.querySelectorAll('input[name=vis]').forEach((r) => {
    r.onchange = () => {
      const save = async () => { try { await S.patchFamily(slug, { visibility: r.value }); toast('Đã lưu quyền xem'); } catch (x) { alert(x.message); } render(); };
      if (r.value === 'private') confirmPrivate(save, () => render()); else save();
    };
  });
  $('#setdef')?.addEventListener('click', openDefaultSheet);
  $('#unfollow')?.addEventListener('click', () => { S.unfollowFamily(f.id); render(); });
  $('#follow')?.addEventListener('click', () => { S.followFamily(f.id); render(); });
  $('#leave')?.addEventListener('click', () => confirmDanger({ title: 'Rời dòng họ?', lose: 'Bạn sẽ không còn là thành viên của dòng họ này.', restore: 'Muốn tham gia lại, xin tham gia lần nữa.', confirm: 'Rời dòng họ', onConfirm: async () => { await S.leaveFamily(slug); S.unfollowFamily(f.id); render(); } }));
  $('#gx-export')?.addEventListener('click', () => gedExport(slug));
  $('#gx-import')?.addEventListener('click', () => gedChoose(slug));
}
// GEDCOM: export downloads the file; import reads it here (UTF-8, or UTF-16 / Windows-1252 when that is what it is),
// asks the server for the plan (dry run) and shows it in the shared dialog. Apply sends the same text again.
const GED_MAX = 8 * 1024 * 1024;
async function gedExport(slug) {
  try {
    const r = await fetch(`/api/gedcom?family=${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Không tải được tệp.'); }
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `${slug}.ged`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (x) { toast(x.message); }
}
// One branch (the person, blood descendants, their spouses) as a .ged file; the server names it <ten>-nhanh.ged in ASCII.
async function gedBranch(id, slug) {
  try {
    const r = await fetch(`/api/persons/${encodeURIComponent(id)}/gedcom?scope=branch&family=${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Không tải được tệp.'); }
    const name = (/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] || 'nhanh.ged';
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (x) { toast(x.message); }
}
async function gedRead(file) {
  const buf = await file.arrayBuffer(); const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.slice(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.slice(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
async function gedPost(slug, content, dry) {
  const r = await fetch('/api/gedcom/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: slug, content, dry_run: dry }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không nhập được tệp.');
  return j;
}
// The file input exists only while the picker is open (an invisible control left in the page is a hidden-control bug).
function gedChoose(slug) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.ged,.gedcom,text/plain';
  input.onchange = () => gedPick(slug, input.files && input.files[0]);
  input.click();
}
async function gedPick(slug, file) {
  if (!file) return;
  if (file.size > GED_MAX) { toast('Tệp quá lớn (tối đa 8 MB).'); return; }
  try {
    const content = await gedRead(file);
    const pv = await gedPost(slug, content, true);
    gedSheet(slug, content, pv);
  } catch (x) { toast(x.message); }
}
function gedSheet(slug, content, pv) {
  const c = pv.counts;
  const nothing = !c.new && !c.conflicts && !c.events_new && !c.relations_new && !c.fields_fill && !c.stories_new;
  const rows = [['Người mới', c.new], ['Khớp người đã có', c.matched], ['Khác giá trị (vào Duyệt đóng góp)', c.conflicts],
    ['Thông tin còn thiếu sẽ thêm', c.fields_fill], ['Sự kiện mới', c.events_new], ['Câu chuyện mới', c.stories_new], ['Quan hệ mới', c.relations_new]];
  if (c.relations_pending) rows.push(['Quan hệ chờ chuyển dữ liệu (chưa nhập)', c.relations_pending]);
  if (c.stories_skipped) rows.push(['Câu chuyện đời khác đã có (giữ bản hiện tại)', c.stories_skipped]);
  const label = { new: 'Người mới', matched: 'Khớp', conflict: 'Khác giá trị, chờ duyệt' };
  const list = pv.items.slice(0, 50).map((it) => calmRow({ title: it.name, subtitle: `${label[it.action]}${it.events ? ` · ${it.events} sự kiện` : ''}`, dense: true, trailing: 'none' })).join('');
  const more = pv.items.length > 50 ? `<p class="sub">Và ${pv.items.length - 50} người khác.</p>` : '';
  const warn = pv.warnings_total ? `<details><summary class="sub">${pv.warnings_total} cảnh báo</summary>${pv.warnings.map((w) => `<p class="sub">${esc(w)}</p>`).join('')}</details>` : '';
  const body = `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
    ${list ? `<div>${list}</div>` : ''}${more}${warn}
    <p class="err" hidden></p>`;
  const actions = `<button type="button" class="btn ter" data-fpx>Hủy</button>${nothing ? '' : '<button type="button" class="btn" id="gx-apply">Nhập</button>'}`;
  document.body.insertAdjacentHTML('beforeend', fsheet('Nhập GEDCOM', body, actions));
  const d = document.body.lastElementChild;
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // outside click closes
  d.querySelector('#gx-apply')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const ap = await gedPost(slug, content, false); const a = ap.applied;
      d.close(); render();
      toast(`Đã nhập: ${a.persons_created} người mới, ${a.persons_filled} người được bổ sung, ${a.suggestions_queued} góp ý chờ duyệt`);
    } catch (x) { btn.disabled = false; const err = d.querySelector('.err'); err.hidden = false; err.textContent = x.message; }
  });
  d.showModal();
}
// Người kế nhiệm (sub-page of Cài đặt dòng họ): trusted contacts, inactivity term, death report, claims. Admins only.
function successionPage() {
  if (!S.isAdmin()) { main.innerHTML = '<h1>Người kế nhiệm</h1><p class="sub">Chỉ Chủ họ và Quản trị xem được trang này.</p>'; return; }
  main.innerHTML = `<h1>Người kế nhiệm</h1>${card(`<div id="succ-settings"><p class="sub">Đang tải…</p></div>`, { attrs: `id="succ-card"` })}`;
  SUC.paintSettings(S.curFamily());
}
// Vai trò và quyền (sub-page of Thành viên & quyền): the role legend.
function rolesPage() {
  main.innerHTML = `<h1>Vai trò và quyền</h1>${card(`<div class="rl">${ROLE_DESC.map(([r, t]) => `<div>${roleTag(r)}<span>${t}</span></div>`).join('')}</div>`, { cls: 'roles' })}`;
}
// Opening a family you do not follow: a bar offers to follow it. Members follow every family they belong to.
function famBar() {
  const slug = S.curFamily(); const f = S.familyMeta(slug);
  if (!f || S.isFollowing(slug) || NO_FAM.includes(route().view)) return;
  main.insertAdjacentHTML('afterbegin', `<div class="fbar" role="status"><span>Bạn chưa theo dõi <b>${esc(f.name)}</b>. Theo dõi để dòng họ hiện trong danh sách của bạn.</span><button type="button" class="btn sm" data-fam-follow="${esc(slug)}">Theo dõi</button></div>`);
}
// Family details for the page on screen; a link or private family that cannot be opened shows a plain message.
const famErr = { fam: null, msg: '' }; const famAsk = new Set();
// The family's details come from the device when it has them; otherwise the page waits for them (the book asks the server itself).
function famGate(view) {
  const fam = S.curFamily();
  if (NO_FAM.includes(view) || view === 'book' || fam === S.ALL_FAMS) return true;
  if (famErr.fam === fam) { main.innerHTML = `<h1>Dòng họ</h1><p class="sub">${esc(famErr.msg)}</p><p><a class="btn sm" href="#/${S.ALL_FAMS}/tree">Tìm / lập dòng họ</a></p>`; return false; }
  if (!S.familyMeta(fam) && !famAsk.has(fam)) {
    famAsk.add(fam);
    S.fetchFamily(fam).then(() => render(), (e) => { famErr.fam = fam; famErr.msg = e.status === 403 ? 'Dòng họ này là riêng tư. Chỉ thành viên mở được.' : 'Không tìm thấy dòng họ này. Kiểm tra lại đường dẫn.'; render(); });
  }
  if (S.familyMeta(fam) || S.hasData(fam)) return true;
  main.innerHTML = '<div class="skel" role="status" aria-live="polite"><p class="sub">Đang mở dòng họ…</p><span class="skel-l"></span><span class="skel-l w2"></span></div>';
  return false;
}
// Views that read the family's people: until the device has some (or the first pull ends), they draw a loading skeleton.
const DATA_VIEWS = ['tree', 'list', 'lich', 'tin', 'tin-sua', 'verify', 'map', 'stats', 'doi-chi', 'person', 'sua', 'su-kien', 'them', 'export', 'place', 'relpath'];
const skeleton = () => { main.innerHTML = '<div class="skel" role="status" aria-live="polite"><p class="sub">Đang tải dữ liệu…</p><span class="skel-l"></span><span class="skel-l w2"></span><span class="skel-l w3"></span></div>'; };
// Delegated follow buttons (follow bar, find page).
document.addEventListener('click', (e) => {
  const fo = e.target.closest('[data-fam-follow]'); const un = e.target.closest('[data-fam-unfollow]');
  if (fo) { S.followFamily(fo.dataset.famFollow); toast('Đã theo dõi'); render(); }
  else if (un) { S.unfollowFamily(un.dataset.famUnfollow); render(); }
});

SUC.init({ render, S, dialog, confirm: confirmDialog, googleUrl, hashNext, visOpts: VIS_OPTS });
CLM.init({ render, S, dialog }); CLM.wire();
