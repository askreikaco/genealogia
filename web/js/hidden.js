// A living person as a non-member sees them: the server (core.js publicView) sends hidden_living with name null.
// Every place a name renders goes through nameOf, so the label is one string (booktext.js living2) in every view.
import { tx } from './booktext.js';
import { PRIVACY_NOTE_VI } from './privacy-copy-vi.js';
import { icon } from '../vendor/reika-ds/js/html.js';

export const isHiddenLiving = (p) => !!(p && p.hidden_living);
export const nameOf = (p, lang = 'vi') => (isHiddenLiving(p) ? tx('living2', lang) : (p && p.name) || '');

// P1c: the members-only notice. Shown under the top bar to a non-member (logged out, or signed in without membership)
// when the view can hold a hidden living person. M is the current family's structure (model.js build()).
const NOTICE_VIEWS = ['list', 'tree', 'book', 'relpath'];
export function noticeNeeded({ view, arg, member, all, M }) {
  if (member || all || !M) return false;
  if (view === 'person') return isHiddenLiving(M.byId.get(arg)?.data);
  return NOTICE_VIEWS.includes(view) && M.everyone.some((p) => isHiddenLiving(p.data));
}
// Copy is constant text from privacy-copy-vi.js and hrefs are app-built, so no escaping is needed here.
// The join CTA always shows its text; a signed-out visitor follows it through Google login first (loginHref).
export function noticeHtml({ signedIn, joinHref, loginHref }) {
  const href = signedIn ? joinHref : loginHref;
  return `${icon('information', 'pnote-ic')}<p class="pnote-txt">${PRIVACY_NOTE_VI.text} <a class="pnote-cta" href="${href}">${PRIVACY_NOTE_VI.cta}</a><span class="pnote-sep"> · </span><span class="pnote-hint">${PRIVACY_NOTE_VI.card_hint}</span></p>`;
}
