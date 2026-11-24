// Clan page #ho/<slug>: every family tree with this surname that the viewer may see, grouped by accepted "same person"
// links (⇄), oldest founder first, 50 entries a page (server: clan-routes.js; rules: clan-core.js). Read only.
// Trees the viewer cannot see are a count only. Online only: the page needs the server.
import { esc } from './model.js';
import { calmRow, surnameTile, surnameTileOf } from './ui.js';
import { clanHref, familySurname } from './clan-core.js';

export { clanHref, familySurname };
// "Xem cả họ Dương ›" for a family name (empty when the name has no surname).
export const clanLinkHtml = (familyName, cls = 'clan-in') => {
  const h = clanHref(familyName); const s = familySurname(familyName);
  return h ? `<a class="${cls}" href="${esc(h)}">Xem cả họ ${esc(s)} ›</a>` : '';
};

const num = (n) => Number(n || 0).toLocaleString('vi-VN');
// Clan meta for the #tree tree-cards: { trees, han } the viewer can see. Cached 5 minutes; onReady once when it changes.
const metas = new Map();
export function clanMeta(familyName, onReady) {
  const h = clanHref(familyName); if (!h) return null;
  const slug = h.slice(4); const c = metas.get(slug);
  if (c && (c.loading || Date.now() - c.at < 300e3)) return c;
  metas.set(slug, { ...(c || { trees: 0, han: '' }), at: c?.at || 0, loading: true });
  fetch(`/api/clans/${encodeURIComponent(slug)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
    const n = { at: Date.now(), trees: j?.kpis?.trees || 0, han: j?.han || '' }; metas.set(slug, n);
    if (n.trees !== (c?.trees || 0) || n.han !== (c?.han || '')) onReady();
  }).catch(() => metas.set(slug, { at: Date.now(), trees: c?.trees || 0, han: c?.han || '' }));
  return metas.get(slug);
}
// Editors: the best "same person?" suggestions to other trees (match engine), shown dimmed as "Có thể liên quan".
const hints = new Map();
export function matchHints(fam, onReady) {
  const c = hints.get(fam);
  if (c && (c.loading || Date.now() - c.at < 300e3)) return c.items;
  hints.set(fam, { at: c?.at || 0, items: c?.items || [], loading: true });
  fetch(`/api/match-suggestions?family=${encodeURIComponent(fam)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { items: [] })).then((j) => {
    const items = j.items || []; hints.set(fam, { at: Date.now(), items });
    if (items.length !== (c?.items || []).length) onReady();
  }).catch(() => hints.set(fam, { at: Date.now(), items: [] }));
  return c?.items || [];
}
// One tree-card in the #tree list (same box as a person card; the shared surname tile (ui.js) and a muted "CÂY" label
// instead of the sex rule), preceded by its connector line: style 'solid' (proven person link) | 'dash' (unproven) |
// 'dot' (grouped by surname), why = the short reason shown on the connector. The rail is decorative; the reason is text.
// tile: HTML from surnameTile / surnameTileOf (the surname of the tree's clan, or of the person shown on the card).
export function treeCardHtml({ depth = 0, style = 'dot', kind, why = '', title, sub = '', href, tile = '', maybe = false }) {
  const head = `<div class="tgen tlk tl-${style}" style="--d:${depth}"><span>${esc(kind)}</span>${why ? `<span class="tlk-why">${esc(why)}</span>` : ''}</div>`;
  return head + `<a class="tcard${maybe ? ' maybe' : ''}" style="--d:${depth}" href="${esc(href)}">${tile}<span class="tcn"><b>${esc(title)}</b><span class="sub"><span class="tlbl">Cây</span>${sub ? ' · ' + esc(sub) : ''}</span></span><span aria-hidden="true">›</span></a>`;
}
// The tree's line legend: opened from the tree's ⋯ menu as a sheet (tap, never a hover tip). One plain sentence per line.
export const treeLinesHelpHtml = () => '<div class="tlg tlg-help">'
  + '<p><i class="tl-solid" aria-hidden="true"></i><span><b>đã nối người</b>: hai người đã được nối trong gia phả là cha/mẹ và con.</span></p>'
  + '<p><i class="tl-dash" aria-hidden="true"></i><span><b>chưa chứng minh</b>: có thể là cha/mẹ và con, nhưng chưa có bằng chứng để nối.</span></p>'
  + '<p><i class="tl-dot" aria-hidden="true"></i><span><b>nhóm theo họ</b>: chỉ cùng họ, chưa nối người nào.</span></p></div>';
const famHref = (slug) => `#${slug === 'duong' ? '' : '/' + slug + '/'}tree`;
const founderText = (t) => {
  if (!t.founder) return '';
  const y = t.founder.born ? `sinh ${t.founder.born}` : t.founder.died ? `mất ${t.founder.died}` : '';
  return `thủy tổ ${t.founder.name}${y ? ' · ' + y : ''}`;
};
function treeRow(t, surname) {
  const sub = [founderText(t), t.origin, `${num(t.people)} người`].filter(Boolean).map(esc).join(' · ')
    + (t.shared ? ` · <span class="clan-lk"><span aria-hidden="true">⇄</span> ${num(t.shared)} người chung</span>` : '');
  return calmRow({ href: famHref(t.slug), tile: surnameTile(surname), title: t.label, subtitle: sub, attrs: `data-clan-tree="${esc(t.id)}"` });
}
const groupHtml = (g, surname) => `<section class="cd clan-clu" aria-label="Cụm ${esc(g.label)}">
  <b class="clan-h">Cụm ${esc(g.trees[0].founder ? g.trees[0].founder.name : g.label)}${g.year ? ` (${g.year})` : ''}</b>
  <span class="sub">${g.trees.length} cây · ${num(g.people)} người</span>
  <div class="clan-rows">${g.trees.map((t) => treeRow(t, surname)).join('')}</div></section>`;

let seq = 0; // the newest request wins (the user may move on while one loads). The loading state has no h1, so the bar
// takes the page title (Họ X) when it arrives.
export async function clanPage(main, slug, { page = 1 } = {}) {
  const my = ++seq;
  main.innerHTML = '<div class="skel" role="status" aria-live="polite"><p class="sub">Đang tải…</p><span class="skel-l"></span><span class="skel-l w2"></span></div>';
  let j;
  try {
    const r = await fetch(`/api/clans/${encodeURIComponent(slug)}?page=${page}`, { cache: 'no-store' });
    j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Không tải được.');
  } catch (e) {
    if (my !== seq) return;
    main.innerHTML = `<h1>Cả họ</h1><p class="sub">${esc(navigator.onLine === false ? 'Trang này cần mạng.' : e.message)}</p><p><a class="btn sm" href="#/tat-ca/tree">Tìm / lập dòng họ</a></p>`;
    return;
  }
  if (my !== seq || !/^#(\/[a-z0-9-]+\/)?ho\//.test(location.hash)) return;
  const s = j.surname;
  const pager = j.pages > 1 ? `<nav class="clan-pg" aria-label="Trang">
    ${j.page > 1 ? `<a class="btn ter sm" href="#ho/${esc(slug)}?trang=${j.page - 1}">‹ Trang trước</a>` : '<span></span>'}
    <span class="sub">Trang ${j.page}/${j.pages}</span>
    ${j.page < j.pages ? `<a class="btn ter sm" href="#ho/${esc(slug)}?trang=${j.page + 1}">Trang sau ›</a>` : '<span></span>'}</nav>` : '';
  const unlinked = j.unlinked.length || (j.page === j.pages && j.private_count) ? `<section class="cd clan-clu clan-un" aria-label="Cây chưa liên kết">
    <b class="clan-h">Cây chưa liên kết</b><span class="sub">Chưa có người nào được hai cây xác nhận là cùng một người.</span>
    <div class="clan-rows">${j.unlinked.map((t) => treeRow(t, s)).join('')}</div>
    ${j.page === j.pages && j.private_count ? `<p class="clan-priv">+${num(j.private_count)} cây riêng tư</p>` : ''}</section>` : '';
  main.innerHTML = `<h1>Họ ${esc(s)}${j.han ? ` <span lang="zh-Hant">${esc(j.han)}</span>` : ''}</h1>
    <div class="kpis s"><div class="kpi"><span class="sub">Cụm dòng họ</span><b>${num(j.kpis.groups)}</b></div><div class="kpi"><span class="sub">Cây</span><b>${num(j.kpis.trees)}</b></div><div class="kpi"><span class="sub">Người</span><b>${num(j.kpis.people)}</b></div></div>
    <p class="sub clan-note">Các cây mang họ ${esc(s)}. Một cụm là các cây đã được hai bên xác nhận có người chung (⇄), xếp theo thủy tổ: năm sớm nhất trước. Cây riêng tư chỉ hiện số lượng.</p>
    <div class="clan-lay">${j.groups.map((g) => groupHtml(g, s)).join('')}${unlinked}</div>${pager}`;
}
