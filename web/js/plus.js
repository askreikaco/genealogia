// "+" for everyone: the shared pieces of the góp ý flows that guests and signed-in non-members use (stories, relations,
// Tư liệu). The member flows are unchanged; a non-member's "+" sends a suggestion that family members review.
import { esc } from './model.js';
import { toolbar, addBtn, fsheet } from './ui.js';
import { PLUS_VI } from './plus-vi.js';

const SRCF_KEY = 'gp.srcf';
const SRCF_DEFAULT = { q: '', src: true, photo: true }; // Tư liệu: search text and the two kinds shown (both by default)
export function srcLoad() { try { return { ...SRCF_DEFAULT, ...JSON.parse(localStorage.getItem(SRCF_KEY) || '{}') }; } catch { return { ...SRCF_DEFAULT }; } }
export function srcSave(f) { try { localStorage.setItem(SRCF_KEY, JSON.stringify(f)); } catch { /* private window: the defaults */ } }

// Under a non-member's góp ý: who reviews it, and the link to join the family (joinHref: the family's join page).
export const gopYNote = (joinHref) => `<p class="sub">${esc(PLUS_VI.note_member)}</p><p><a class="btn ter sm" href="${esc(joinHref)}">${esc(PLUS_VI.join)}</a></p>`;
// The join page's hash for a family (the same link the app's own "Tham gia" uses).
// Members (who review and may edit) versus everyone else (who suggest).
export const isMemberRole = (r) => ['owner', 'admin', 'editor', 'member'].includes(r);
export const joinHrefOf = (fam) => `#${fam && fam !== 'duong' ? '/' + fam + '/' : ''}join`;

// Tư liệu toolbar: search · Bộ lọc · "+" (the add sheet with two actions).
export const srcBarHtml = (f) => toolbar({ id: 'srq', ph: PLUS_VI.src_ph, val: f.q, active: (f.src ? 0 : 1) + (f.photo ? 0 : 1), add: addBtn('data-src-add', PLUS_VI.add_title) });
// The filter sheet: one checkbox per kind (Nguồn, Ảnh), both on by default.
export const srcSheetHtml = (f) => fsheet(PLUS_VI.filter_title, `<fieldset class="fp-field"><div class="chkg">`
  + `<label class="chk"><input type="checkbox" data-src-f="src" ${f.src ? 'checked' : ''}> ${esc(PLUS_VI.f_src)}</label>`
  + `<label class="chk"><input type="checkbox" data-src-f="photo" ${f.photo ? 'checked' : ''}> ${esc(PLUS_VI.f_photo)}</label></div></fieldset>`);
// The "+" sheet's content: a sourced event, or a story with photos (text only for a non-member: see the story editor).
export const srcAddHtml = () => `<h2>${esc(PLUS_VI.add_sheet)}</h2>`
  + `<button type="button" class="btn" data-src-ev>${esc(PLUS_VI.add_src_event)}</button>`
  + `<button type="button" class="btn ter" data-src-story>${esc(PLUS_VI.add_photo_story)}</button>`;
