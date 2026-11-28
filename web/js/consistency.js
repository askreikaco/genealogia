// Kiểm tra dữ liệu (C1), one page with two sections. The API lists rule ids and person ids only; every visible string
// comes from consistency-vi.js (VI) and needs-vi.js (NEEDS_VI).
//  - Cần xem lại (editors only): the rule issues, each with the ignore action (an editor hides one, or brings it back).
//  - Cần bổ sung thông tin (every member): people with no birth year (and no death year when known dead), with the live
//    estimate ("≈ range · ước tính") and a Góp ý action that opens that person's form (suggestion or edit).
import { esc } from './model.js';
import { toast, section, card, tag, emptyState, toolbar, fpanel } from './ui.js';
import { personItem } from './person-item.js';
import * as S from './store.js';
import { VI } from './consistency-vi.js';
import { NEEDS_VI } from './needs-vi.js';
import { estLabel, estRange } from './est-years.js';

const CV = { ...VI, ...NEEDS_VI };
const PAGE = 50; // people shown at once; "Xem thêm" adds one page
const fold = (x) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd');

async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'request_failed ' + r.status); e.status = r.status; throw e; }
  return j;
}

// One review issue: the rule label, its people (the shared person row, each linked to the profile), the detail the
// editor needs (the basis of a year conflict, the verify note) and the ignore action.
function issueCard(i, fam, hf, ignored, canEdit) {
  const people = i.personIds.map((id) => {
    const r = S.get(id, fam); const d = (r && r.data) || r || {};
    return personItem({ name: d.name || '', sex: d.sex || '' }, { href: hf(`person/${id}`) });
  }).join('');
  const tone = i.severity === 'error' ? 'red' : 'yellow';
  const lead = i.rule === 'verify_note' ? '' : NEEDS_VI.basis + ': ';
  const detail = i.detail && i.detail.length ? `<p class="sub cs-detail">${esc(lead + i.detail.join('; '))}</p>` : '';
  const action = canEdit ? `<div class="row end"><button type="button" class="btn ter sm" data-cs="${ignored ? 'restore' : 'ignore'}" data-rule="${esc(i.rule)}" data-ids="${esc(i.personIds.join(','))}">${ignored ? VI.unignore : VI.ignore}</button></div>` : '';
  return card(`<p>${tag(esc(CV['rule_' + i.rule] || i.rule), { tone, sm: true })}</p>${people}${detail}${action}`, { cls: 'cs-issue' });
}

// One row of Cần bổ sung thông tin: the person row, the generation and what is missing, the estimate (or that there is none).
function needRow(r, canSuggest, hf) {
  const missing = r.need.map((k) => (k === 'born' ? NEEDS_VI.need_born : NEEDS_VI.need_died)).join(' · ');
  const est = r.est
    ? `<span class="est-yr" title="${esc(NEEDS_VI.basis + ': ' + r.est.basis.join('; '))}">${esc(estLabel({ kind: r.est.kind, range: estRange(r.est.lo, r.est.hi) }))} · ${esc(NEEDS_VI.est_label)}</span>`
    : esc(NEEDS_VI.need_no_estimate);
  const sub = [r.gen ? `${NEEDS_VI.gen_label} ${r.gen}` : '', esc(missing), est].filter(Boolean).join(' · ');
  const action = canSuggest ? `<button type="button" class="btn ter sm" data-cs="suggest" data-id="${esc(r.id)}">${esc(NEEDS_VI.suggest)}</button>` : '';
  return personItem({ rank: r.sex === 'f' ? 'Bà' : r.sex === 'm' ? 'Ông' : '', name: r.name, sex: r.sex }, { href: hf(`person/${r.id}`), sub, action });
}

// The page in #main. suggest(personId): opens the person's form (Góp ý). focus: scroll to the needs section (?v=bo-sung).
export async function consistencyPage(main, { fam, hf, suggest = () => {}, focus = false }) {
  const f = encodeURIComponent(fam);
  const canEdit = S.isEditor();
  let showIgnored = false; let needs = null; let needsErr = '';
  const st = { q: '', kind: '', gen: '', n: PAGE };
  // a re-render of the same page keeps what is on screen until the new answers are in (no flash of the placeholder)
  if (!(main.querySelector('#csbox') && main.dataset.csFam === fam)) {
    main.innerHTML = `<h1>${esc(VI.page_title)}</h1><div id="csbox"><p class="sub pad">...</p></div>`;
    main.dataset.csFam = fam;
  }
  const box = () => main.querySelector('#csbox');

  async function loadNeeds() {
    try { needs = (await api('GET', `/api/trees/${f}/needs`)).rows || []; needsErr = ''; } catch (x) { needs = []; needsErr = x.status === 403 ? NEEDS_VI.members_only : x.message; }
  }

  // The filtered rows of the needs list (search, missing year, generation).
  function shownRows() {
    const q = fold(st.q).trim();
    return (needs || []).filter((r) => (!st.kind || r.need.includes(st.kind)) && (!st.gen || String(r.gen) === st.gen)
      && (!q || fold(r.name).includes(q)));
  }
  function listHtml() {
    if (needsErr) return `<p class="err">${esc(needsErr)}</p>`;
    const all = needs || []; const rows = shownRows();
    if (!all.length) return emptyState(NEEDS_VI.needs_empty);
    if (!rows.length) return emptyState(NEEDS_VI.needs_no_match);
    const part = rows.slice(0, st.n); const left = rows.length - part.length;
    return `${card(part.map((r) => needRow(r, true, hf)).join(''))}${left > 0 ? `<p><button type="button" class="btn ter sm" data-cs="more">${esc(NEEDS_VI.show_more)} (${left})</button></p>` : ''}`;
  }
  function paintList() {
    const el = box() && box().querySelector('#nd-list'); if (!el) return;
    el.innerHTML = listHtml();
    const c = box().querySelector('#nd-count'); if (c) c.textContent = needsErr ? '' : `${shownRows().length} / ${(needs || []).length} ${NEEDS_VI.needs_count}`;
  }
  const genOptions = () => [...new Set((needs || []).map((r) => r.gen).filter((g) => g))].sort((a, b) => a - b);
  const needBar = () => {
    const genSel = `<select id="ndgq" aria-label="${esc(NEEDS_VI.gen_label)}"><option value="">${esc(NEEDS_VI.gen_all)}</option>${genOptions().map((g) => `<option value="${g}" ${st.gen === String(g) ? 'selected' : ''}>${NEEDS_VI.gen_label} ${g}</option>`).join('')}</select>`;
    const kindSel = `<select id="ndkq" aria-label="${esc(NEEDS_VI.filter_all)}"><option value="">${esc(NEEDS_VI.filter_all)}</option><option value="born" ${st.kind === 'born' ? 'selected' : ''}>${esc(NEEDS_VI.filter_born)}</option><option value="died" ${st.kind === 'died' ? 'selected' : ''}>${esc(NEEDS_VI.filter_died)}</option></select>`;
    const active = (st.kind ? 1 : 0) + (st.gen ? 1 : 0);
    const radio = (v, l) => `<label class="radio"><input type="radio" name="ndk" value="${v}" ${st.kind === v ? 'checked' : ''}> ${esc(l)}</label>`;
    return `${toolbar({ id: 'ndq', ph: NEEDS_VI.search_ph, val: st.q, active, quick: kindSel + genSel })}
      ${fpanel(`<fieldset class="fset"><legend>${esc(NEEDS_VI.filter_all)}</legend>${radio('', NEEDS_VI.filter_all)}${radio('born', NEEDS_VI.filter_born)}${radio('died', NEEDS_VI.filter_died)}</fieldset>
      <fieldset class="fset"><legend>${esc(NEEDS_VI.gen_label)}</legend><select id="ndg" aria-label="${esc(NEEDS_VI.gen_label)}"><option value="">${esc(NEEDS_VI.gen_all)}</option>${genOptions().map((g) => `<option value="${g}" ${st.gen === String(g) ? 'selected' : ''}>${NEEDS_VI.gen_label} ${g}</option>`).join('')}</select></fieldset>`)}`;
  }

  async function paint() {
    const el = box(); if (!el) return;
    let issues = null; let open = []; let ign = [];
    if (canEdit) {
      try { const j = await api('GET', `/api/trees/${f}/consistency`); open = j.issues || []; ign = j.ignored || []; issues = true; }
      catch (x) { el.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
    }
    if (!needs) await loadNeeds();
    const errs = open.filter((i) => i.severity === 'error'); const warns = open.filter((i) => i.severity === 'warn');
    const review = issues ? (!open.length && !(showIgnored && ign.length) ? emptyState(VI.empty)
      : `${errs.length || warns.length ? section(NEEDS_VI.section_review, `<p class="sub">${esc(NEEDS_VI.review_intro)}</p>` + [...errs, ...warns].map((i) => issueCard(i, fam, hf, false, canEdit)).join(''), { level: 2 }) : ''}
      ${ign.length ? `<p><button type="button" class="btn ter sm" data-cs="toggle" aria-pressed="${showIgnored}">${esc(VI.show_ignored)} (${ign.length})</button></p>` : ''}
      ${showIgnored && ign.length ? section(VI.show_ignored, ign.map((i) => issueCard(i, fam, hf, true, canEdit)).join(''), { level: 2 }) : ''}`) : '';
    el.innerHTML = `${review}
      <div id="ndsec">${section(NEEDS_VI.section_needs, `<p class="sub">${esc(NEEDS_VI.needs_intro)}</p><div id="nd-bar">${needBar()}</div><p class="sub lcount" id="nd-count"></p><div id="nd-list"></div>`, { level: 2 })}</div>`;
    paintList();
    if (focus) { focus = false; el.querySelector('#ndsec')?.scrollIntoView({ block: 'start' }); }
  }

  box().onclick = async (e) => {
    const b = e.target.closest('[data-cs]'); if (!b) return;
    const act = b.dataset.cs;
    if (act === 'toggle') { showIgnored = !showIgnored; return paint(); }
    if (act === 'more') { st.n += PAGE; return paintList(); }
    if (act === 'suggest') return suggest(b.dataset.id);
    b.disabled = true;
    const body = { rule: b.dataset.rule, person_ids: (b.dataset.ids || '').split(',').filter(Boolean) };
    try {
      await api(act === 'restore' ? 'DELETE' : 'POST', `/api/trees/${f}/consistency/ignore`, body);
      paint();
    } catch (x) { b.disabled = false; toast(x.message); }
  };
  // filters: search (typing keeps the box), kind and generation (the quick selects and the sheet stay in step)
  let t = null;
  box().oninput = (e) => {
    if (e.target.id !== 'ndq') return;
    clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; st.n = PAGE; paintList(); }, 150);
  };
  box().onchange = (e) => {
    const id = e.target.id; const name = e.target.name;
    if (id === 'ndkq' || name === 'ndk') st.kind = e.target.value;
    else if (id === 'ndgq' || id === 'ndg') st.gen = e.target.value;
    else return;
    st.n = PAGE; box().querySelectorAll('#ndkq').forEach((s) => { s.value = st.kind; });
    box().querySelectorAll('#ndgq,#ndg').forEach((s) => { s.value = st.gen; });
    box().querySelectorAll('input[name=ndk]').forEach((r) => { r.checked = r.value === st.kind; });
    paintList();
  };
  await paint();
}
