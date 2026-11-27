// P1d: how living people show to people outside the family. The family card (owner or admin; choosing names asks for
// consent first) and the person's own card (only the linked account, its manager or the person's device sees it).
// Copy: living-vis-vi.js (generated from the copy JSON). The server is the authority; these cards only ask it.
import { LIVING_VIS_VI as V } from './living-vis-vi.js';
import { esc } from './model.js';
import { section, toast } from './ui.js';
import { openConfirm } from '../vendor/reika-ds/js/index.js';

const FAM_OPTS = [['private', V.fam_opt_private], ['names', V.fam_opt_names]];
const SELF_OPTS = [['inherit', V.self_opt_inherit], ['private', V.self_opt_private], ['names', V.self_opt_names]];
const radios = (name, opts, cur, disabled) => opts.map(([v, l]) => `<label class="vr-opt"><input type="radio" name="${name}" value="${v}"${v === cur ? ' checked' : ''}${disabled ? ' disabled' : ''}>
    <span><b>${esc(l)}</b></span></label>`).join('');

// Cài đặt dòng họ: one choice, two options. Only the owner or an admin changes it.
export function livingFamilyCard(f, admin) {
  const cur = f.living_visibility === 'names' ? 'names' : 'private';
  return section(V.fam_label, `<fieldset class="vrule">${radios('lvfam', FAM_OPTS, cur, !admin)}</fieldset>
    ${admin ? '' : `<p class="sub">${esc(V.fam_only_owner)}</p>`}`, { variant: 'card', attrs: 'id="lvfam"' });
}
// Choosing names opens the consent confirm; cancel keeps the setting as it was. patch(slug, body) saves; rerender redraws.
export function wireLivingFamily(main, slug, patch, rerender) {
  const committed = main.querySelector('input[name=lvfam]:checked')?.value || 'private'; // the saved choice, read at render
  main.querySelectorAll('input[name=lvfam]').forEach((r) => {
    if (r.disabled) return;
    r.onchange = () => {
      const save = async () => { try { await patch(slug, { living_visibility: r.value }); toast(V.saved); } catch (x) { toast(x.message); } rerender(); };
      if (r.value !== 'names') { save(); return; }
      // Cancel (or Esc, or the backdrop) puts the saved choice back at once; nothing is saved.
      const restore = () => main.querySelectorAll('input[name=lvfam]').forEach((x) => { x.checked = x.value === committed; });
      openConfirm({ id: 'lvcfm', title: V.confirm_title, message: V.consent, confirmLabel: V.fam_opt_names, cancelLabel: 'Huỷ',
        onConfirm: save, onCancel: restore });
    };
  });
}

// The person's own card: shown only when the server says this viewer may change it (GET ...self-visibility: can_set).
export function livingSelfCard(info) {
  return section(V.self_label, `<fieldset class="vrule">${radios('lvself', SELF_OPTS, info.value || 'inherit', false)}</fieldset>
    <p class="sub">${esc(V.self_hint)}</p>`, { variant: 'card', attrs: 'id="lvself"' });
}
const selfUrl = (pid) => `/api/persons/${encodeURIComponent(pid)}/self-visibility`;
function wireLivingSelf(main, pid) {
  main.querySelectorAll('input[name=lvself]').forEach((r) => {
    r.onchange = async () => {
      try {
        const res = await fetch(selfUrl(pid), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: r.value }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || 'Không lưu được.');
        toast(V.saved);
      } catch (x) { toast(x.message); }
    };
  });
}
// Adds the card to a person's full profile when the viewer may change the setting; a guest or other member gets nothing.
export async function decorateSelf(main, pid) {
  let info;
  try { const r = await fetch(selfUrl(pid), { cache: 'no-store' }); if (!r.ok) return; info = await r.json(); } catch { return; }
  if (!info.can_set || main.querySelector('#lvself')) return;
  if (!main.querySelector('.prof')) return;
  main.insertAdjacentHTML('beforeend', livingSelfCard(info)); // after the profile block (.prof is a flex row): the end of the Thông tin tab
  wireLivingSelf(main, pid);
}
