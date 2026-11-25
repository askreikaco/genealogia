// Gỡ người by family vote (COUNCIL.md): the chooser (Nhập nhầm, Đề nghị gỡ), the vote card, the page "Biểu quyết"
// (Thêm › Dòng họ), the banner on a person's page, and the link from Thùng rác. Server: server/decisions.js.
// Removal is never the default: the chooser asks first, and the vote needs a reason.
import { esc } from './model.js';
import { toast, calmRow, section } from './ui.js';
import { choiceRow } from './choice.js';
import { collapsedGroups } from './groups.js';

const q = (fam) => `family=${encodeURIComponent(fam)}`;
async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Lỗi ' + r.status);
  return j;
}
const WHY = { 'not-mine': 'Chỉ người tạo hồ sơ mới dùng được.', 'too-old': 'Chỉ dùng được trong 24 giờ sau khi tạo hồ sơ.', 'has-links': 'Hồ sơ đã có quan hệ, sự kiện hoặc câu chuyện.' };
const days = (n) => (n === 1 ? '1 ngày' : `${n} ngày`);

const ROLE = { owner: 'Chủ họ', admin: 'Quản trị', editor: 'Biên tập', member: 'Thành viên' };
const IC = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>',
  minus: '<path d="M6 12h12"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
};
const ico = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;
const RULE_OPTS = {
  council: { label: 'Chủ họ và Quản trị', help: 'Mặc định. Chủ họ và Quản trị đang hoạt động bỏ phiếu.' },
  council_editors: { label: 'Chủ họ, Quản trị và Biên tập viên', help: 'Thêm những người có quyền biên tập đang hoạt động.' },
  members: { label: 'Mọi thành viên đã tham gia từ 90 ngày', help: 'Mọi thành viên đang hoạt động và đã tham gia từ 90 ngày trở lên.' },
};
const dmy = (iso) => { const x = new Date(iso); return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`; };
const legendText = (d) => `${d.bar.yes} đồng ý, ${d.bar.no} không đồng ý, ${d.bar.abstain} không ý kiến, ${d.bar.pending} chưa bỏ phiếu`;
const CHOICE_WORD = { yes: 'Đồng ý', no: 'Không đồng ý', abstain: 'Không ý kiến' };

// The bar: Đồng ý from the left, Không đồng ý from the right, Chưa bỏ phiếu between, a marker at the pass threshold with its
// label above it. Then the legend line with icons (colors match the segments). Plain divs; tokens only.
export function barHtml(d) {
  if (d.state === 'open') return partBarHtml(d);
  const b = d.bar; const text = legendText(d);
  const lbl = b.need_pct >= 50 ? `right:${100 - b.need_pct}%` : `left:${b.need_pct}%`;
  return `<div class="tbar">
    <p class="tbar-need" style="${lbl}">Cần ${b.need}</p>
    <div class="tbar-track" role="img" aria-label="${esc(text)}">
      <span class="tbar-yes" style="width:${b.yes_pct}%"></span><span class="tbar-pend" style="width:${b.pending_pct}%"></span><span class="tbar-abs" style="width:${b.abstain_pct}%"></span><span class="tbar-no" style="width:${b.no_pct}%"></span>
      <span class="tbar-mark" style="left:${b.need_pct}%"></span>
    </div>
    <p class="tbar-leg" role="group" aria-label="${esc(text)}" title="${esc(text)}"><span class="lg lg-y">${ico('check')}${b.yes}</span><span class="lg lg-n">${ico('x')}${b.no}</span><span class="lg lg-a">${ico('minus')}${b.abstain}</span><span class="lg lg-p">${ico('clock')}${b.pending}</span></p>
  </div>`;
}
// While open: participation only, two parts (accent = voted, grey = not yet). No choices, no threshold marker.
function partBarHtml(d) {
  const b = d.bar; const text = `${b.voted}/${b.n} đã bỏ phiếu · còn ${days(d.days_left)}`;
  return `<div class="tbar tbar-open">
    <div class="tbar-track" role="img" aria-label="${esc(text)}">
      <span class="tbar-yes" style="width:${b.voted_pct}%"></span><span class="tbar-pend" style="width:${b.pending_pct}%"></span>
    </div>
    <p class="tbar-leg tbar-t" title="${esc(text)}">${b.voted}/${b.n} đã bỏ phiếu · còn ${days(d.days_left)}</p>
  </div>`;
}
// The name groups: one collapsed row each (icon in its color, label, count, chevron; the whole row is the control, 48px+).
// Tapping expands the people (the shared person rows) inline; closed by default; not remembered. Empty groups are not shown.
// While open: Đã bỏ phiếu / Chưa bỏ phiếu, with no choices. Closed: the four choices (no-reasons inside Không đồng ý).
function groupsHtml(d) {
  if (!d.groups) return '';
  const who = (x) => ROLE[x.role] || '';
  const g = d.groups;
  const secs = d.state === 'open'
    ? [['voted', 'Đã bỏ phiếu', 'check', 'y', g.voted, who], ['pending', 'Chưa bỏ phiếu', 'clock', 'p', g.pending, who]]
    : [['yes', 'Đồng ý', 'check', 'y', g.yes, who], ['no', 'Không đồng ý', 'x', 'n', g.no, (x) => x.reason || ''],
       ['abstain', 'Không ý kiến', 'minus', 'a', g.abstain || [], who], ['pending', 'Chưa bỏ phiếu', 'clock', 'p', g.pending, who]];
  return collapsedGroups(secs.map(([key, title, icn, color, items, sub]) => ({ key, title, icn, color, items, sub })), { icon: ico });
}

// The vote card: title, one muted meta line (reason, time left), the bar and legend, the groups, the rule line, and the
// actions: two equal buttons when I have not voted; one line with "Đổi" once I have.
export function voteCard(d, { hf } = {}) {
  const open = d.state === 'open';
  const meta = open
    ? `<p class="vc-meta"><span>Lý do: ${esc(d.reason)}</span> · ${ico('clock')}<span>còn ${days(d.days_left)}</span></p>`
    : `<p class="vc-meta"><span>Lý do: ${esc(d.reason)}</span> · <span>${d.state === 'passed' ? 'Đã thông qua' : 'Không đạt'}</span></p>`;
  const rule = `<p class="vc-rule">${ico('info')}<span>${d.solo ? 'Một Chủ họ hoặc Quản trị' : 'Cần 2/3'} · hết hạn ${dmy(d.closes_at)}</span></p>`;
  // One row, three equal buttons, the same style before voting. After voting the chosen one is filled; tapping another changes it.
  const choices = `${choiceRow({ label: 'Bỏ phiếu', icon: ico, items: [
      { word: 'Đồng ý', icon: 'check', tone: 'yes', on: d.mine === 'yes', attrs: `data-dec-yes="${d.id}"` },
      { word: 'Không đồng ý', icon: 'x', tone: 'no', on: d.mine === 'no', attrs: `data-dec-nobox="${d.id}" aria-expanded="false"` },
      { word: 'Không ý kiến', icon: 'minus', tone: 'abs', on: d.mine === 'abs', attrs: `data-dec-abs="${d.id}"` }] })}
    <form class="vc-nof" data-dec-noform="${d.id}" hidden><label>Lý do (bắt buộc)<textarea name="reason" rows="2" maxlength="500" required></textarea></label>
      <button type="submit" class="btn vc-no">${ico('x')}<span>Gửi: không đồng ý</span></button></form>
    <p class="vc-help">Không ý kiến: tính là đã bỏ phiếu, không tính là đồng ý.</p>`;
  let acts = '';
  if (open && d.is_voter) acts = choices;
  else if (open) acts = '<p class="sub">Bạn không nằm trong nhóm được biểu quyết.</p>';
  const link = hf ? `<p class="vc-l"><a href="${hf('bieu-quyet')}">Xem trong Biểu quyết</a></p>` : '';
  return `<article class="vcard${open ? '' : ' vcard-done'}" data-decision="${d.id}" aria-label="Biểu quyết: đề nghị gỡ ${esc(d.subject_name)}">
    <h3 class="vc-h">Đề nghị gỡ ${esc(d.subject_name)} khỏi gia phả</h3>${meta}${barHtml(d)}${groupsHtml(d)}${acts}${rule}${link}</article>`;
}

// Chooser: Nhập nhầm (fast, own fresh record) and Đề nghị gỡ (the vote). Help under each, in words, no tooltips.
export async function openRemoval({ p, fam, onDone }) {
  let o;
  try { o = await api('GET', `/api/persons/${encodeURIComponent(p.id)}/removal?${q(fam)}`); }
  catch (e) { toast(e.message); return; }
  document.querySelectorAll('dialog.dcs').forEach((x) => { x.close(); x.remove(); });
  const d = document.createElement('dialog');
  d.className = 'dlg dcs'; d.setAttribute('aria-labelledby', 'dcs-h');
  const pending = o.decision
    ? `<p class="dcs-off">Đang có đề nghị gỡ người này. <a href="#/${encodeURIComponent(fam)}/bieu-quyet">Xem trong Biểu quyết</a></p>` : '';
  const quickOpt = o.quick.ok ? `<section class="dcs-opt"><h3>Nhập nhầm</h3><p class="sub">Hồ sơ bạn vừa tạo trong 24 giờ, chưa có quan hệ, sự kiện hay câu chuyện. Vào Thùng rác, hoàn tác được.</p>
        <button type="button" class="btn ter" data-dcs-quick>Nhập nhầm: gỡ ngay</button></section>` : '';
  const voteOpt = `<section class="dcs-opt"><h3>Đề nghị gỡ</h3>${o.quick.ok ? `<p class="sub">Chủ họ và Quản trị biểu quyết trong 7 ngày. Cần 2/3 đồng ý và ít nhất ${Math.min(2, o.voters - 1)} phiếu khác ngoài bạn.</p>` : '<p class="sub">Chủ họ và Quản trị biểu quyết trong 7 ngày: cần 2/3 đồng ý.</p>'}${pending}
        <form data-dcs-vote ${o.decision ? 'hidden' : ''}><label>Lý do (bắt buộc)<textarea name="reason" rows="2" maxlength="500" required></textarea></label>
        <button type="submit" class="btn">Gửi đề nghị gỡ</button></form></section>`;
  const heading = o.quick.ok ? `Chọn cách xử lý: ${esc(o.name)}` : `Đề nghị gỡ ${esc(o.name)}`;
  d.innerHTML = `<div class="dcs-body"><h2 id="dcs-h" class="dng-h" tabindex="-1">${heading}</h2>
    <div class="dcs-opts">${quickOpt}${voteOpt}
    </div>
    <div class="dcs-acts"><button type="button" class="btn ter" data-dcs-cancel>Hủy</button></div></div>`;
  document.body.appendChild(d);
  const close = () => { d.close(); d.remove(); };
  d.addEventListener('close', () => d.remove());
  d.querySelector('[data-dcs-cancel]').addEventListener('click', close);
  d.querySelector('[data-dcs-quick]')?.addEventListener('click', async () => {
    try {
      await api('POST', `/api/persons/${encodeURIComponent(p.id)}/removal?${q(fam)}`, { kind: 'quick' });
      close(); toast(`Đã đưa ${o.name} vào Thùng rác`); await onDone?.();
    } catch (e) { toast(e.message); }
  });
  d.querySelector('[data-dcs-vote]')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const reason = ev.currentTarget.reason.value.trim();
    try {
      await api('POST', `/api/persons/${encodeURIComponent(p.id)}/removal?${q(fam)}`, { kind: 'vote', reason });
      close(); toast('Đã gửi đề nghị. Chủ họ và Quản trị sẽ biểu quyết.'); await onDone?.();
    } catch (e) { toast(e.message); }
  });
  d.showModal();
  d.querySelector('#dcs-h')?.focus(); // programmatic focus only: no visible box (see .dng-h in app.css)
}

// The page Biểu quyết (Thêm › Dòng họ): open decisions first, then the closed ones.
export async function decisionsPage(main, { fam }) {
  const paint = async () => {
    let j;
    try { j = await api('GET', `/api/decisions?${q(fam)}`); }
    catch (e) { main.innerHTML = `<h1>Biểu quyết</h1><p class="sub">${esc(e.message)}</p>`; return; }
    const open = (j?.decisions || []).filter((x) => x.state === 'open'); const done = (j?.decisions || []).filter((x) => x.state !== 'open');
    main.innerHTML = `<h1>Biểu quyết</h1>
      <p class="sub">Việc của dòng họ, do Chủ họ và Quản trị quyết định. Mỗi đề nghị có thời hạn 7 ngày.</p>
      <h2 class="mg-h">Đang biểu quyết</h2>${open.length ? open.map((x) => voteCard(x)).join('') : '<p class="sub">Không có đề nghị nào đang mở.</p>'}
      <h2 class="mg-h">Đã kết thúc</h2>${done.length ? done.map((x) => voteCard(x)).join('') : '<p class="sub">Chưa có biểu quyết nào kết thúc.</p>'}`;
    bind(main, fam, paint);
  };
  await paint();
}

// Clicks inside a vote card: Đồng ý, the no form, and the no form's submit.
function bind(root, fam, reload) {
  if (root.dataset.decBound) return; // one pair of listeners per page, however often it repaints
  root.dataset.decBound = '1';
  root.addEventListener('click', async (ev) => {
    const chg = ev.target.closest('[data-dec-change]'); if (chg) { chg.closest('.vc-mine-line').nextElementSibling.hidden = false; return; }
    const abs = ev.target.closest('[data-dec-abs]');
    if (abs) { try { await api('POST', `/api/decisions/${abs.dataset.decAbs}/ballot?${q(fam)}`, { choice: 'abstain' }); toast('Đã ghi phiếu không ý kiến'); await reload(); } catch (e) { toast(e.message); } return; }
    const yes = ev.target.closest('[data-dec-yes]'); const box = ev.target.closest('[data-dec-nobox]');
    try {
      if (yes) { await api('POST', `/api/decisions/${yes.dataset.decYes}/ballot?${q(fam)}`, { choice: 'yes' }); toast('Đã ghi phiếu đồng ý'); await reload(); }
      if (box) { const f = root.querySelector(`[data-dec-noform="${box.dataset.decNobox}"]`); f.hidden = !f.hidden; box.setAttribute('aria-expanded', String(!f.hidden)); }
    } catch (e) { toast(e.message); }
  });
  root.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('[data-dec-noform]'); if (!f) return;
    ev.preventDefault();
    const reason = f.reason.value.trim();
    try { await api('POST', `/api/decisions/${f.dataset.decNoform}/ballot?${q(fam)}`, { choice: 'no', reason }); toast('Đã ghi phiếu không đồng ý'); await reload(); }
    catch (e) { toast(e.message); }
  });
}

// Banner on a person's page while their removal is being voted on (the same bar and legend, "Mở Biểu quyết" as a text link);
// a link on Thùng rác to the Biểu quyết page; the vote-rule setting on Cài đặt dòng họ.
export async function decorate(view, main, { fam, hf, personId }) {
  if (view === 'cai-dat-dong-ho') return decorateSettings(main, fam);
  if (view !== 'person' && view !== 'thung-rac') return;
  let j;
  try { j = await api('GET', `/api/decisions?${q(fam)}`); } catch { return; }
  const open = (j?.decisions || []).filter((x) => x.state === 'open' && x.kind === 'remove_person');
  if (view === 'person') {
    const d = open.find((x) => x.subject_ref === personId);
    if (d && !main.querySelector('.council-banner')) main.insertAdjacentHTML('afterbegin', `<div class="ntc council-banner" role="status">
      <p class="cb-line"><b>Đang biểu quyết</b> · ${d.voted}/${d.voters} đã bỏ phiếu · còn ${days(d.days_left)}</p>
      <p class="cb-act"><a class="cb-link" href="${hf('bieu-quyet')}">Mở Biểu quyết</a></p></div>`);
  } else if (open.length && !main.querySelector('.tr-council')) {
    main.insertAdjacentHTML('afterbegin', `<div class="ntc tr-council" role="note"><b>${open.length} đề nghị gỡ đang biểu quyết</b>
      <a class="btn ter sm" href="${hf('bieu-quyet')}">Mở Biểu quyết</a></div>`);
  }
}

// Cài đặt dòng họ › Biểu quyết: one field, three options with their help in one line each. Only the owner changes it.
export function voteRuleCard(isOwner) {
  const opts = Object.entries(RULE_OPTS).map(([v, o]) => `<label class="vr-opt"><input type="radio" name="vrule" value="${v}"${isOwner ? '' : ' disabled'}>
    <span><b>${esc(o.label)}</b><span class="sub">${esc(o.help)}</span></span></label>`).join('');
  return section('Biểu quyết', `
    <fieldset class="vrule"><legend>Ai được biểu quyết gỡ người khỏi gia phả</legend>${opts}</fieldset>
    <p class="sub">Mỗi người bỏ một phiếu, phiếu bằng nhau. Chỉ người đang hoạt động (đăng nhập trong 180 ngày, chưa đánh dấu đã mất) được biểu quyết.</p>
    ${isOwner ? '' : '<p class="sub">Chỉ Chủ họ đổi được.</p>'}`, { variant: 'card', attrs: 'id="vrule"' });
}
async function decorateSettings(main, fam) {
  let j;
  try { j = await api('GET', `/api/council-setting?${q(fam)}`); } catch { return; }
  main.querySelectorAll('input[name="vrule"]').forEach((r) => {
    r.checked = r.value === j.vote_rule;
    if (r.disabled || r.dataset.bound) return;
    r.dataset.bound = '1';
    r.addEventListener('change', async () => {
      try { await api('POST', `/api/council-setting?${q(fam)}`, { rule: r.value }); toast('Đã lưu. Đề nghị đang mở giữ nguyên người được biểu quyết.'); }
      catch (e) { toast(e.message); }
    });
  });
}
