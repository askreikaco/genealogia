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
import { openConfirm } from '../vendor/reika-ds/js/index.js';

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
  document.querySelectorAll('dialog#cfm[open], dialog#dcf[open]').forEach((x) => x.close());
  openConfirm({
    id: 'dcf', title, message: lose, note: restore || 'Không thể hoàn tác.', noteTone: restore ? 'info' : 'danger', danger: true, role: 'alertdialog',
    initialFocus: 'heading', confirmLabel: confirm, cancelLabel: 'Hủy', onCancel,
    typeToConfirm: typeName ? { value: typeName, label: 'Gõ “' + typeName + '” để xác nhận' } : undefined,
    reason: reason ? { label: reason, min: 3, max: 500 } : undefined,
    onConfirm: (r) => onConfirm?.({ reason: r.reason ?? '' }),
  });
  return document.getElementById('dcf');
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
