// "Có thể trùng" inside one tree (server: match-routes.js /api/duplicates, merge.js, decisions.js /api/merge/*).
// The review page lists the pairs of this tree's own people that the match engine finds alike. "So sánh và gộp" opens
// the compare sheet: the two records side by side, one choice per field, a reason. The merge is then a family vote
// (Biểu quyết): nothing moves until it passes; the merged-away person goes to the Thùng rác and can be restored there.
import { esc } from './model.js';
import { toast, cic, tag, section } from './ui.js';

const q = (fam) => `family=${encodeURIComponent(fam)}`;
async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Lỗi ' + r.status); e.status = r.status; throw e; }
  return j;
}
const FIELDS = [['name', 'Tên'], ['sex', 'Giới tính'], ['born', 'Năm sinh'], ['died', 'Năm mất'], ['place', 'Nơi ở'], ['birth_place', 'Nơi sinh'],
  ['death_place', 'Nơi mất'], ['burial', 'Mộ phần'], ['que_goc', 'Quê gốc'], ['living', 'Tình trạng'], ['note', 'Ghi chú']];
const REL = ['parent', 'other_parent', 'spouse_of', 'spouse_n'];
const SEX = { m: 'Nam', f: 'Nữ' };
const show = (k, v) => (k === 'sex' ? (SEX[v] || '') : String(v ?? ''));
const who = (name, yrs) => `<b>${esc(name || '(chưa có tên)')}</b>${yrs ? ` <span class="sub">(${esc(yrs)})</span>` : ''}`;

// The candidate list (one section per tree in scope; nothing when the viewer may not edit there or nothing waits).
export async function reviewSection(main, before, fams) {
  const got = await Promise.all(fams.map((f) => api('GET', `/api/duplicates?${q(f)}`).then((j) => ({ f, items: j.items || [] })).catch(() => ({ f, items: [] }))));
  if (!before.isConnected) return;
  const rows = got.flatMap(({ f, items }) => items.map((s) => ({ ...s, f })));
  let box = main.querySelector('#dpend');
  if (!box) { box = document.createElement('div'); box.id = 'dpend'; before.parentNode.insertBefore(box, before); }
  box.innerHTML = rows.length ? section('Có thể trùng trong cây này', `
    <p class="sub">Hai hồ sơ có thể là cùng một người. Gộp cần biểu quyết của dòng họ; hồ sơ bị gộp vào Thùng rác và khôi phục được.</p>
    ${rows.map((s) => `<div class="rv dp-row" data-dp-row="${s.id}">
      <p>${who(s.a.name, s.a.years)} <span aria-hidden="true">⇄</span><span class="vh">và</span> ${who(s.b.name, s.b.years)}</p>
      <p class="sub dp-why">${tag(`khớp ${Math.round(s.score * 100)}%`, { tone: 'gray', sm: true })} ${s.reasons.map(esc).join(' · ')}</p>
      ${s.pending ? '<p class="sub dp-why"><span class="tag sm">Đang biểu quyết</span> Đề nghị gộp hai hồ sơ này đang chờ dòng họ.</p>' : `<div class="row end"><button type="button" class="btn ter sm" data-dp="dismiss" data-id="${s.id}" data-fam="${esc(s.f)}">Không phải</button>
        <button type="button" class="btn sm" data-dp="compare" data-keep="${esc(s.a.id)}" data-drop="${esc(s.b.id)}" data-fam="${esc(s.f)}">So sánh và gộp</button></div>`}</div>`).join('')}`, { variant: 'card', cls: 'dp-pend', level: 2 }) : '';
  box.onclick = async (e) => {
    const b = e.target.closest('[data-dp]'); if (!b) return;
    if (b.dataset.dp === 'compare') return openCompare(b.dataset.fam, b.dataset.keep, b.dataset.drop, () => reviewSection(main, before, fams));
    b.disabled = true;
    try {
      await api('POST', `/api/duplicates/${b.dataset.id}/dismiss`, { family: b.dataset.fam });
      toast('Đã bỏ gợi ý.');
      reviewSection(main, before, fams);
    } catch (x) { b.disabled = false; toast(x.message); }
  };
}

// The compare sheet. keep/drop: the two records as the list shows them; the server keeps the older profile whatever
// the order, so the sheet is drawn from the preview's keep (the older one). Per field: a conflict (both set, different)
// gets a choice (default: the older one's value); a field set on one side only is filled in and shown as text; equal
// fields are counted in one line. Nothing to choose -> only the summary and the primary action.
export async function openCompare(fam, keep, drop, onDone) {
  document.querySelectorAll('dialog.dp-cmp').forEach((x) => { x.close(); x.remove(); });
  const d = document.createElement('dialog'); d.className = 'fpanel dp-cmp'; d.setAttribute('aria-labelledby', 'dp-h');
  d.innerHTML = `<div class="fp-hd"><h2 id="dp-h">So sánh hai hồ sơ</h2><button type="button" class="csw-x" data-fpx aria-label="Đóng">${cic('close', 20)}</button></div><div class="fp-body" id="dpbody"><p class="sub">Đang tải…</p></div>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  const label = Object.fromEntries(FIELDS);
  const shown = (f) => label[f] && !REL.includes(f);
  const load = async () => {
    const pv = await api('GET', `/api/merge/preview?${q(fam)}&keep=${encodeURIComponent(keep)}&drop=${encodeURIComponent(drop)}`);
    const body = d.querySelector('#dpbody');
    const conflicts = pv.fields.conflicts.filter(shown);
    const filled = pv.fields.filled.filter((x) => shown(x.field));
    const same = pv.fields.same.filter(shown);
    const conflictHtml = conflicts.map((f) => {
      const a = show(f, pv.keep.data[f]); const b = show(f, pv.drop.data[f]);
      const def = pv.defaults[f] || 'keep';
      return `<div class="frow dp-field" data-f="${esc(f)}"><b class="dp-label">${esc(label[f])}</b>
        <div class="dp-pick" role="radiogroup" aria-label="${esc(label[f])}">
          <label class="radio dp-opt"><input type="radio" name="c-${esc(f)}" value="keep" ${def === 'keep' ? 'checked' : ''}> <span>Giữ: ${esc(a || '—')}</span></label>
          <label class="radio dp-opt"><input type="radio" name="c-${esc(f)}" value="drop" ${def === 'drop' ? 'checked' : ''}> <span>Lấy từ hồ sơ kia: ${esc(b || '—')}</span></label></div></div>`;
    }).join('');
    const fillHtml = filled.length ? `<p class="sub dp-fill">Bổ sung: ${filled.map((x) => `${esc(label[x.field])} ${esc(show(x.field, pv[x.from].data[x.field]))}`).join(' · ')}</p>` : '';
    const sameHtml = same.length ? `<p class="sub dp-same">${same.length} trường giống nhau.</p>` : '';
    body.innerHTML = `<p class="sub">Hồ sơ giữ lại (cũ hơn): ${who(pv.keep.name)}. ${who(pv.drop.name)} sẽ được gộp vào đó.</p>
      ${conflicts.length ? `<div class="fdiff"><p class="sub">Khác nhau, cần chọn:</p>${conflictHtml}</div>` : ''}
      ${fillHtml}${sameHtml}
      <p class="sub">Hồ sơ còn lại sẽ vào Thùng rác, kèm quan hệ, sự kiện và câu chuyện được chuyển sang hồ sơ giữ lại. Việc này cần biểu quyết trong ${pv.days} ngày.</p>
      <label class="fld dp-reason">Lý do gộp<textarea id="dpwhy" rows="2" maxlength="500" placeholder="Ví dụ: cùng một người, đã đối chiếu giấy khai sinh"></textarea></label>
      <p class="dp-err sub" id="dperr" role="alert"></p>`;
    const foot = d.querySelector('#dpfoot'); if (foot) foot.remove();
    const f2 = document.createElement('div'); f2.id = 'dpfoot'; f2.className = 'fp-foot';
    f2.innerHTML = pv.can_propose ? `<button type="button" class="btn" id="dpgo">Đề nghị gộp</button>` : '<p class="sub">Chưa có Chủ họ hoặc Quản trị để biểu quyết.</p>';
    d.appendChild(f2);
    const go = f2.querySelector('#dpgo');
    if (go) go.onclick = async () => {
      const reason = body.querySelector('#dpwhy').value.trim();
      const choices = {};
      body.querySelectorAll('.dp-field').forEach((row) => { const c = row.querySelector('input:checked'); if (c) choices[row.dataset.f] = c.value; });
      if (reason.length < 3) { body.querySelector('#dperr').textContent = 'Cần ghi lý do gộp.'; return; }
      go.disabled = true;
      try {
        const r = await api('POST', '/api/merge/propose', { family: fam, keep: pv.keep.id, drop: pv.drop.id, choices, reason });
        toast(`Đã gửi đề nghị gộp. Biểu quyết trong ${pv.days} ngày.`);
        d.close(); onDone?.(r);
      } catch (x) { go.disabled = false; body.querySelector('#dperr').textContent = x.message; }
    };
  };
  try { await load(); } catch (x) { d.querySelector('#dpbody').innerHTML = `<p class="sub">${esc(x.message)}</p>`; }
}
