// Consistency page (consistency-rules.js on the server; the API lists rule ids and person ids only). The page
// shows the names from the people on screen, groups the open issues by severity, and lets an editor hide one
// (ignore button) or bring it back. Every visible string comes from consistency-vi.js (VI), so this file is ASCII.
import { esc } from './model.js';
import { toast, section, card, tag, emptyState } from './ui.js';
import { personItem } from './person-item.js';
import * as S from './store.js';
import { VI } from './consistency-vi.js';

async function api(method, url, body) {
  const r = await fetch(url, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'request_failed ' + r.status); e.status = r.status; throw e; }
  return j;
}

// One issue: the rule label, its people (the shared person row, each linked to the profile) and the ignore action.
function issueCard(i, fam, hf, ignored, canEdit) {
  const people = i.personIds.map((id) => {
    const r = S.get(id, fam); const d = (r && r.data) || r || {};
    return personItem({ name: d.name || '', sex: d.sex || '' }, { href: hf(`person/${id}`) });
  }).join('');
  const tone = i.severity === 'error' ? 'red' : 'yellow';
  const action = canEdit ? `<div class="row end"><button type="button" class="btn ter sm" data-cs="${ignored ? 'restore' : 'ignore'}" data-rule="${esc(i.rule)}" data-ids="${esc(i.personIds.join(','))}">${ignored ? VI.unignore : VI.ignore}</button></div>` : '';
  return card(`<p>${tag(esc(VI['rule_' + i.rule] || i.rule), { tone, sm: true })}</p>${people}${action}`, { cls: 'cs-issue' });
}

// The page in #main: one section per severity, the toggle for ignored issues.
export async function consistencyPage(main, { fam, hf }) {
  let showIgnored = false;
  main.innerHTML = `<h1>${esc(VI.page_title)}</h1><div id="csbox"><p class="sub pad">...</p></div>`;
  const box = () => main.querySelector('#csbox');
  const canEdit = S.isEditor();

  async function paint() {
    const el = box(); if (!el) return;
    let j;
    try { j = await api('GET', `/api/trees/${encodeURIComponent(fam)}/consistency`); } catch (x) { el.innerHTML = `<p class="err">${esc(x.message)}</p>`; return; }
    const open = j.issues || []; const ign = j.ignored || [];
    const errs = open.filter((i) => i.severity === 'error'); const warns = open.filter((i) => i.severity === 'warn');
    const body = !open.length && !(showIgnored && ign.length) ? emptyState(VI.empty) : '';
    el.innerHTML = `${body}
      ${errs.length ? section(VI.sev_error, errs.map((i) => issueCard(i, fam, hf, false, canEdit)).join(''), { level: 2 }) : ''}
      ${warns.length ? section(VI.sev_warn, warns.map((i) => issueCard(i, fam, hf, false, canEdit)).join(''), { level: 2 }) : ''}
      ${ign.length ? `<p><button type="button" class="btn ter sm" data-cs="toggle" aria-pressed="${showIgnored}">${esc(VI.show_ignored)} (${ign.length})</button></p>` : ''}
      ${showIgnored && ign.length ? section(VI.show_ignored, ign.map((i) => issueCard(i, fam, hf, true, canEdit)).join(''), { level: 2 }) : ''}`;
  }

  box().onclick = async (e) => {
    const b = e.target.closest('[data-cs]'); if (!b) return;
    const act = b.dataset.cs;
    if (act === 'toggle') { showIgnored = !showIgnored; return paint(); }
    b.disabled = true;
    const body = { rule: b.dataset.rule, person_ids: (b.dataset.ids || '').split(',').filter(Boolean) };
    try {
      await api(act === 'restore' ? 'DELETE' : 'POST', `/api/trees/${encodeURIComponent(fam)}/consistency/ignore`, body);
      paint();
    } catch (x) { b.disabled = false; toast(x.message); }
  };
  await paint();
}
