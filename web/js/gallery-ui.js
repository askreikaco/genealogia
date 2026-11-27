// Gallery on a person's profile (G1): the Ảnh section (thumbnails), the viewer (one large photo, prev/next) and the
// editor's controls (add, caption and year, set as profile, remove to the trash). Rules: gallery.js; API: gallery-routes.js.
// The page passes its own upload (uploadPhoto in app.js: the same resize and store as event photos) and a render callback.
import { esc } from './model.js';
import { cic, section, sheet, toast } from './ui.js';
import { dangerButton, dangerZone, confirmDanger, undoToast, restoreTrash } from './danger.js';
import { GAL_VI as V } from './gallery-vi.js';
import { GALLERY_MAX } from './gallery.js';

const json = async (r) => r.json().catch(() => ({}));
const fail = (j, fb) => new Error(j.error || fb);

export async function galLoad(fam, pid) {
  const r = await fetch(`/api/persons/${encodeURIComponent(pid)}/photos?family=${encodeURIComponent(fam)}`, { cache: 'no-store', credentials: 'same-origin' });
  if (r.status === 404) return null; // not shown to this viewer (a living person, for a guest)
  const j = await json(r);
  if (!r.ok) throw fail(j, V.err_load);
  return j;
}
const galCall = async (method, path, fam, body, fb) => {
  const r = await fetch(`${path}?family=${encodeURIComponent(fam)}`, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await json(r);
  if (!r.ok) throw fail(j, fb);
  return j;
};
const base = (pid) => `/api/persons/${encodeURIComponent(pid)}/photos`;

// The section's html (no heading when a viewer sees no photos).
export function galSection({ items, max = GALLERY_MAX, editor, pid }) {
  if (!items.length && !editor) return '';
  const thumbs = items.map((x, i) => `<button type="button" class="gal-th" data-gal-open="${i}" aria-label="${esc([x.caption || V.section, x.year, x.is_profile ? V.profile_now : ''].filter(Boolean).join(', '))}"><img src="${esc(x.url)}" alt="" loading="lazy"></button>`).join('');
  const full = items.length >= max;
  const body = `${items.length ? `<div class="stry-ph gal-grid">${thumbs}</div>` : `<p class="sub">${esc(V.empty)}</p>`}`
    + (editor ? `<div class="gal-tools"><label class="btn ter sm">${cic('plus', 16)} ${esc(V.add)}<input type="file" accept="image/*" hidden data-gal-file${full ? ' disabled' : ''}></label><span class="sub" data-gal-msg>${full ? esc(V.limit) : ''}</span></div>` : '');
  return section(esc(V.section), body, { variant: 'card', cls: 'gal', attrs: `data-gal="${esc(pid)}"` });
}

// The profile's Ảnh section: loads the gallery into the slot, then wires the thumbnails and the add button.
// ctx: { fam, pid, editor, upload(file) -> url, onProfile(url|null) (the header photo), render() }.
export async function galMount(main, ctx) {
  const slot = main.querySelector('[data-gal-slot]'); if (!slot) return;
  let j;
  try { j = await galLoad(ctx.fam, ctx.pid); } catch { return; }
  if (!j || !Array.isArray(j.items) || !slot.isConnected) return;
  slot.innerHTML = galSection({ items: j.items, max: j.max, editor: ctx.editor, pid: ctx.pid });
  const el = slot.querySelector('.gal'); if (!el) return;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gal-open]'); if (b) openViewer(ctx, j, Number(b.dataset.galOpen));
  });
  el.querySelector('[data-gal-file]')?.addEventListener('change', (e) => addFile(e, ctx));
}

async function addFile(e, ctx) {
  const inp = e.currentTarget; const file = inp.files[0]; if (!file) return;
  const msg = inp.closest('.gal-tools')?.querySelector('[data-gal-msg]');
  if (!navigator.onLine) { if (msg) msg.textContent = 'Cần có mạng để tải ảnh.'; inp.value = ''; return; }
  if (msg) msg.textContent = 'Đang tải ảnh…';
  try {
    const url = await ctx.upload(file);
    const j = await galCall('POST', base(ctx.pid), ctx.fam, { url, caption: '', year: null }, V.err_add);
    if (j.profile) ctx.onProfile(j.profile);
    ctx.render();
  } catch (err) { if (msg) msg.textContent = err.message; inp.value = ''; }
}

// The viewer: one photo large, prev/next, and for editors the caption and year, set as profile, and remove.
// items: the list as loaded; the editor's changes update it in place.
function openViewer(ctx, loaded, start) {
  const items = loaded.items.map((x) => ({ ...x })); let i = start;
  const d = sheet('<div class="gal-v" data-gal-v></div><div class="gal-ed" data-gal-ed></div><div class="row"><button type="button" class="btn ter" data-cancel>' + esc(V.close) + '</button></div>', null, { cls: 'galdlg' });
  const v = d.querySelector('[data-gal-v]'); const ed = d.querySelector('[data-gal-ed]');
  const cur = () => items[i];
  const draw = () => {
    const x = cur();
    v.innerHTML = `<figure class="gal-fig"><img class="gal-big" src="${esc(x.url)}" alt="${esc(x.caption)}"><figcaption class="sub">${esc([x.caption, x.year].filter((s) => s !== '' && s !== null).join(' · '))}</figcaption></figure>`
      + `<div class="gal-nav"><button type="button" class="btn ter sm" data-gal-prev aria-label="${esc(V.prev)}"${i === 0 ? ' disabled' : ''}>‹</button><span class="sub">${i + 1} / ${items.length}</span><button type="button" class="btn ter sm" data-gal-next aria-label="${esc(V.next)}"${i >= items.length - 1 ? ' disabled' : ''}>›</button></div>`;
    if (!ctx.editor) { ed.innerHTML = ''; return; }
    ed.innerHTML = `<label class="fld">${esc(V.caption)}<input name="caption" maxlength="200" value="${esc(x.caption)}"></label>`
      + `<label class="fld">${esc(V.year)}<input name="year" type="number" inputmode="numeric" min="1800" value="${x.year ?? ''}"></label>`
      + `<div class="row">${x.is_profile ? `<span class="tag">${esc(V.profile_now)}</span>` : `<button type="button" class="btn sm" data-gal-profile>${esc(V.set_profile)}</button>`}</div>`
      + `<div class="row"><button type="submit" class="btn sm">${esc(V.save)}</button></div><p class="err" hidden></p>`
      + dangerZone([dangerButton(V.remove, 'data-gal-del')], { note: V.remove_note });
  };
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-gal-prev]')) { i = Math.max(0, i - 1); return draw(); }
    if (e.target.closest('[data-gal-next]')) { i = Math.min(items.length - 1, i + 1); return draw(); }
    if (e.target.closest('[data-gal-profile]')) return setProfile(d, ctx, items, i);
    if (e.target.closest('[data-gal-del]')) return removeOne(d, ctx, items, i);
  });
  // Save: the caption and year (the form's submit). sheet() takes no submit handler here, so it is set on the form.
  d.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    if (!ctx.editor) return d.close();
    const f = new FormData(e.target); const x = cur();
    try {
      await galCall('PUT', `${base(ctx.pid)}/${encodeURIComponent(x.id)}`, ctx.fam, { caption: f.get('caption'), year: f.get('year') }, V.err_save);
      d.close(); d.remove(); ctx.render();
    } catch (err) { const m = d.querySelector('.err'); m.textContent = err.message; m.hidden = false; }
  };
  draw();
}

async function setProfile(d, ctx, items, i) {
  const x = items[i];
  try {
    const j = await galCall('POST', `${base(ctx.pid)}/${encodeURIComponent(x.id)}/profile`, ctx.fam, {}, V.err_profile);
    d.close(); d.remove();
    ctx.onProfile(j.profile);
    toast(V.profile_done);
    ctx.render();
  } catch (err) { const m = d.querySelector('.err'); m.textContent = err.message; m.hidden = false; }
}

function removeOne(d, ctx, items, i) {
  const x = items[i];
  confirmDanger({
    title: V.remove_ask, lose: x.caption ? `“${x.caption}” bị gỡ khỏi phần ảnh của hồ sơ này.` : 'Ảnh bị gỡ khỏi phần ảnh của hồ sơ này.',
    restore: V.remove_note, confirm: V.remove,
    onConfirm: async () => {
      const j = await galCall('POST', `${base(ctx.pid)}/${encodeURIComponent(x.id)}/delete`, ctx.fam, {}, V.err_remove);
      d.close(); d.remove();
      if (j.profile !== undefined) ctx.onProfile(j.profile);
      ctx.render();
      undoToast(V.removed, async () => {
        await restoreTrash(ctx.fam, j.trash_id);
        const fresh = await galLoad(ctx.fam, ctx.pid);
        const p = fresh?.items.find((y) => y.is_profile);
        ctx.onProfile(p ? p.url : null);
        ctx.render();
      });
    },
  });
}

