// Family emblem (家紋, seal or logo): the crest on family tiles and the book cover, and the admin field that changes it.
// The server keeps one raster image per family (PNG, JPEG or WebP, 256 KB at most); without one, the colored surname crest shows (ui.js).

import { dangerButton, dangerZone, dangerItem, dangerLabel, confirmDanger } from './danger.js';

const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX = 256 * 1024;
const ref = (f) => encodeURIComponent(f.id);
export const emblemSrc = (f) => `/api/families/${ref(f)}/emblem?v=${f.emblem_v || 0}`;

// The emblem image of a family (inside a crest square, ui.js familyCrest). '' when the family has none: the colored tile is used then.
export const famCrest = (f) => (f?.has_emblem ? `<img class="crest" alt="" src="${emblemSrc(f)}">` : '');

// Admin field for the family settings page. No file yet: one row adds it (no empty square). With a file: preview, change, remove.
export function emblemField(f) {
  const pick = '<input type="file" id="emb-file" accept="image/png,image/jpeg,image/webp" hidden>';
  const body = f.has_emblem
    ? `<div class="emb"><span class="crest-sq crest-lg" aria-hidden="true">${famCrest(f)}</span>
      <div class="emb-acts"><label class="btn ter sm">Đổi ảnh…${pick}</label>${dangerButton('Gỡ biểu tượng', 'id="emb-del"', { size: 'sm' })}</div></div>`
    : `<label class="calm dense emb-add" tabindex="0">${pick}<span class="calm-t"><b class="calm-n">Thêm biểu tượng</b><span class="calm-s">Ảnh PNG, JPEG hoặc WebP, tối đa 256 KB</span></span></label>`;
  return `<div class="cd"><h3>Biểu tượng dòng họ</h3>${body}<p class="err" id="emb-err" hidden></p></div>`;
}

// Wires the field after it is in the page. onDone(message) runs after a save or a removal.
export function bindEmblem(f, onDone) {
  const fail = (m) => { const e = document.getElementById('emb-err'); if (e) { e.hidden = false; e.textContent = m; } };
  document.getElementById('emb-file')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!TYPES.includes(file.type)) return fail('Chỉ nhận ảnh PNG, JPEG hoặc WebP.');
    if (file.size > MAX) return fail('Ảnh quá lớn (tối đa 256 KB).');
    const r = await fetch(`/api/families/${ref(f)}/emblem`, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
    if (!r.ok) return fail((await r.json().catch(() => ({}))).error || 'Không lưu được biểu tượng.');
    onDone('Đã lưu biểu tượng');
  });
  document.getElementById('emb-del')?.addEventListener('click', () => confirmDanger({ title: 'Gỡ biểu tượng dòng họ?', lose: 'Ảnh biểu tượng hiện tại bị xóa.', restore: 'Có thể tải ảnh lên lại bất cứ lúc nào.', confirm: 'Gỡ biểu tượng', onConfirm: async () => {
    const r = await fetch(`/api/families/${ref(f)}/emblem`, { method: 'DELETE' });
    if (!r.ok) { fail('Không gỡ được biểu tượng.'); throw new Error('Không gỡ được biểu tượng.'); }
    onDone('Đã gỡ biểu tượng');
  } }));
}
