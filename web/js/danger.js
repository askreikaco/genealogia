// Destructive actions: ONE component for every delete / remove / leave / sign-out-all in the app.
// Delete cannot be undone, so it is never a primary button and never next to Save:
//   dangerButton(label, attrs, { size })  red outline button, marked data-danger (the guard test looks for it)
//   dangerZone(buttons, { title, note })  a separated "Vùng nguy hiểm" section at the bottom of a page or sheet
//   dangerItem(label, fn, attrs)          a ⋯ menu item: red, last, a divider above it; fn must call confirmDanger
//   dangerLabel(label)                    marks a destructive label that is passed on to a menu helper
//   confirmDanger({ ... })                the one confirm dialog: says what will be lost, whether it can be
//                                         restored, optional "type the name" and reason, red confirm never the default
//   undoToast(msg, onUndo)                after a delete: "Đã xóa … · Hoàn tác" for 10 s (restores from Thùng rác)
//   restoreTrash(fam, id)                 POST /api/trash/:id/restore
// The guard test (server/test/danger-guard.test.js) fails when a delete-like control in web/js is made without these.
import { esc } from './model.js';

export const dangerLabel = (label) => label;

export function dangerButton(label, attrs = '', { size = '' } = {}) {
  return `<button type="button" class="btn dng-o${size ? ' ' + size : ''}" data-danger ${attrs}>${esc(label)}</button>`;
}

export function dangerZone(buttons, { title = 'Vùng nguy hiểm', note = '' } = {}) {
  const list = (Array.isArray(buttons) ? buttons : [buttons]).filter(Boolean);
  if (!list.length) return '';
  return `<section class="dzone" aria-label="${esc(title)}"><h2 class="dzone-h">${esc(title)}</h2>`
    + `${note ? `<p class="sub">${esc(note)}</p>` : ''}<div class="dzone-acts">${list.join('')}</div></section>`;
}

export function dangerItem(label, fn, attrs = '') { return [esc(label), fn, true, `data-danger ${attrs}`]; }

const norm = (s) => String(s || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

// title: the question ("Xóa sự kiện này?"); lose: exactly what goes away; restore: how to get it back, when that is
// possible (else the dialog says "Không thể hoàn tác."); typeName: for high-impact deletes the user types it first;
// reason: a label for a required reason (passed to onConfirm({ reason })).
// onConfirm may be async; an error stays in the dialog. Escape and "Hủy" cancel; focus starts on the heading.
export function confirmDanger({ title, lose = '', restore = '', confirm = 'Xóa vĩnh viễn', typeName = '', reason = '', onConfirm, onCancel }) {
  document.querySelectorAll('dialog.dcf').forEach((x) => { x.close(); x.remove(); });
  const d = document.createElement('dialog');
  d.className = 'dlg dcf'; d.setAttribute('role', 'alertdialog');
  d.setAttribute('aria-labelledby', 'dcf-h'); d.setAttribute('aria-describedby', 'dcf-b');
  d.innerHTML = `<div class="dcf-body"><h2 id="dcf-h" class="dng-h" tabindex="-1">${esc(title)}</h2>`
    + `<div id="dcf-b">${lose ? `<p class="sub">${esc(lose)}</p>` : ''}<p class="dcf-note">${esc(restore || 'Không thể hoàn tác.')}</p></div>`
    + (reason ? `<label class="fld">${esc(reason)}<textarea data-dcf-reason rows="2" maxlength="500"></textarea></label>` : '')
    + (typeName ? `<label class="fld">Gõ “${esc(typeName)}” để xác nhận<input data-dcf-type autocomplete="off" spellcheck="false" autocapitalize="off"></label>` : '')
    + '<p class="err" data-dcf-err role="alert" hidden></p>'
    + `<div class="row end dcf-acts"><button type="button" class="btn gh" data-dcf-no>Hủy</button>`
    + `<button type="button" class="btn dng" data-dcf-ok${typeName || reason ? ' disabled' : ''}>${esc(confirm)}</button></div></div>`;
  document.body.append(d);
  const ok = d.querySelector('[data-dcf-ok]');
  let done = false;
  const typed = d.querySelector('[data-dcf-type]'); const why = d.querySelector('[data-dcf-reason]');
  const check = () => { ok.disabled = (typed && norm(typed.value) !== norm(typeName)) || (why && why.value.trim().length < 3); };
  typed?.addEventListener('input', check); why?.addEventListener('input', check);
  d.addEventListener('close', () => { if (!done) onCancel?.(); d.remove(); });
  d.querySelector('[data-dcf-no]').onclick = () => d.close();
  ok.onclick = async () => {
    if (ok.disabled) return;
    ok.disabled = true;
    try { await onConfirm?.({ reason: why ? why.value.trim() : '' }); done = true; d.close(); } catch (e) {
      const er = d.querySelector('[data-dcf-err]'); er.hidden = false; er.textContent = e?.message || String(e); check();
    }
  };
  d.showModal();
  d.querySelector('#dcf-h').focus();
  return d;
}

// After a delete: the item is in Thùng rác; "Hoàn tác" restores it for 10 s.
export function undoToast(msg, onUndo, { ms = 10000 } = {}) {
  document.querySelectorAll('.toast.undo').forEach((x) => x.remove());
  const t = document.createElement('div'); t.className = 'toast undo'; t.setAttribute('role', 'status');
  t.innerHTML = `<span data-undo-msg>${esc(msg)}</span><button type="button" class="undo-b" data-undo>Hoàn tác</button>`;
  document.body.append(t);
  let end = setTimeout(() => t.remove(), ms);
  const b = t.querySelector('[data-undo]'); const m = t.querySelector('[data-undo-msg]');
  b.onclick = async () => {
    clearTimeout(end); b.disabled = true;
    try { await onUndo(); m.textContent = 'Đã hoàn tác'; } catch (e) { m.textContent = e?.message || String(e); }
    b.remove(); end = setTimeout(() => t.remove(), 3000);
  };
  return t;
}
export async function restoreTrash(fam, id) {
  const r = await fetch(`/api/trash/${encodeURIComponent(id)}/restore?family=${encodeURIComponent(fam)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Không khôi phục được.');
  return j;
}
