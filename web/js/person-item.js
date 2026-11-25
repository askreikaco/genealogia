// personItem: the one person row for giapha (conv §36, "few components": variants and options, not copies).
// A calmRow (ui.js) with the person's surname tile, sex mark and rank+name, so every list shows a person the same way.
// Pages pass only what they show: sub (html, escaped by the caller), badge (html), attrs, href, action.
// One link (or one button for pickers) per row; the optional trailing action is a sibling, never nested.
// Variants: row (default: tile, chevron; dense for the compact picker list; tile:false for pickers that show no tile);
// card (phone search card, Tìm: no tile, flag = warn edge, foot = html under the sub line, action = icon button);
// compact (an option of a suggestion list or a picker, role=option: the name and one line of text; on = highlighted,
// sep = divider above (the last option of a list), tag 'div' for a list whose options are not buttons).
import { calmRow, surnameTile, sexMark, sexClass } from './ui.js';
import { esc } from './model.js';

const titleOf = (p, sep = ' ') => (p.rank ? `${p.rank}${sep}${p.name}` : p.name);

export function personItem(p, opts = {}) {
  if (opts.variant === 'card') return personCard(p, opts);
  if (opts.variant === 'compact') return personOption(p, opts);
  if (opts.variant === 'tree') return personTree(p, opts);
  const { href = '', attrs = '', sub = '', badge = '', tile = true, dense = false, trailing, action = '' } = opts;
  return calmRow({
    href, attrs, dense, action,
    tile: tile ? surnameTile(p.name) : '',
    title: titleOf(p), sex: p.sex || '', badge,
    subtitle: sub,
    trailing: trailing ?? (href ? 'chevron' : 'none'),
  });
}

// One card: a link (name, sex mark, badge, sub, foot) and one trailing action as a sibling, never inside the link.
function personCard(p, { href = '', sub = '', badge = '', foot = '', flag = false, action = '' }) {
  return `<div class="pi-card${flag ? ' flag' : ''}"><a class="grow" href="${esc(href)}"><b>${esc(titleOf(p))}${sexMark(p.sex || '')}</b>${badge}<span class="sub">${sub}</span>${foot}</a>${action}</div>`;
}

// One option: the name line and a text line. attrs: role and data-* for the page's handler (no sex mark, no tile).
function personOption(p, { attrs = '', sub = '', on = false, sep = false, tag = 'button' }) {
  const cls = `pi-opt${on ? ' on' : ''}${sep ? ' sep' : ''}`;
  const inner = `<b>${esc(titleOf(p))}</b><span>${sub}</span>`;
  return tag === 'div' ? `<div class="${cls}" ${attrs}>${inner}</div>` : `<button type="button" class="${cls}" ${attrs}>${inner}</button>`;
}

// Cây row: a div with the indent (--d). The link covers the name line and the sub line; action (the toggle) is a sibling.
function personTree(p, { depth = 0, href = '', sub = '', badge = '', hit = false, action = '' }) {
  return `<div class="tn ${sexClass(p.sex || '')}${hit ? ' hit' : ''}" style="--d:${depth}"><a href="${esc(href)}" class="tnm"><b>${esc(titleOf(p, ' · '))}${sexMark(p.sex || '')}</b>${badge}<span class="sub">${sub}</span></a>${action}</div>`;
}
