// Collapsed name groups, shared by the vote card (council.js) and the RSVP "Ai đi" card (news-client.js): one row per
// group (icon in its color, label, count, chevron; the whole row is the control). Tapping expands the people as shared
// person rows. Closed by default; empty groups are not shown; more than 5 people fold behind "Xem thêm".
import { esc } from './model.js';
import { calmRow } from './ui.js';

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(-2).map((w) => w[0] || '').join('').toUpperCase();
const FOLD = 5;

// sections: [{ key, title, icn, color, items: [{ name, ... }], sub: (item) => string }]; icon: the caller's icon function.
export function collapsedGroups(sections, { icon }) {
  const row = (x, sub) => calmRow({ dense: true, trailing: 'none', tile: `<span class="vg-av" aria-hidden="true">${esc(initials(x.name))}</span>`, title: x.name, subtitle: esc(sub) });
  const grp = ({ key, title, icn, color, items, sub }) => {
    if (!items.length) return '';
    const shown = items.slice(0, FOLD).map((x) => row(x, sub(x))).join('');
    const more = items.length > FOLD ? `<div class="vg-more" hidden>${items.slice(FOLD).map((x) => row(x, sub(x))).join('')}</div><button type="button" class="btn ter sm" data-vg-fold>Xem thêm (${items.length - FOLD})</button>` : '';
    return `<details class="vg" data-group="${key}">
      <summary class="vg-row"><span class="vg-ic vg-${color}">${icon(icn)}</span><span class="vg-t">${title} · ${items.length} người</span><span class="vg-chev">${icon('chev')}</span></summary>
      <div class="vg-l">${shown}${more}</div></details>`;
  };
  const html = sections.map(grp).join('');
  return html ? `<div class="vgs">${html}</div>` : '';
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-vg-fold]'); if (!b) return;
  b.previousElementSibling.hidden = false; b.remove();
});
