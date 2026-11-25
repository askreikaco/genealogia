// Desktop tree chart (design D1): boxes + connectors, open/close per branch, click a box to show details.
// Compact org-chart layout: a parent whose visible children are all leaves stacks them in a column.
import { rank, years, esc, spousesOf } from './model.js';
import { nameOf } from './hidden.js';

const BW = 168, BH = 70, HG = 18, VG = 34, IND = 20, SG = 8;

// Children of a person. When two or more spouses are recorded and the children name their mother/father spouse
// (other_parent), each spouse is a box of her own with her children under it; otherwise the children hang from the person.
function spouseGroups(M, p) {
  const sps = M.inlaws(p.id) || []; const kids = M.kids(p.id);
  if (sps.length < 2 || !kids.some((k) => k.data.other_parent)) return null;
  const gs = sps.map((s) => ({ sp: s, kids: kids.filter((k) => k.data.other_parent === s.id) }));
  const rest = kids.filter((k) => !sps.some((s) => s.id === k.data.other_parent));
  if (rest.length) gs.push({ sp: null, kids: rest });
  return gs;
}

export function chartLayout(M, root, isOpen) {
  const nodes = []; const paths = []; const meas = new Map();
  // Layout nodes: { key, p, kids(), kidCount, spouse, grouped }. Person nodes open/close; spouse nodes are always open.
  const personNode = (p) => {
    const gs = spouseGroups(M, p);
    return { key: p.id, p, kidCount: M.kids(p.id).length, grouped: !!gs,
      kids: () => (!isOpen(p) ? [] : gs ? gs.map((g) => spouseNode(p, g)) : M.kids(p.id).map(personNode)) };
  };
  const spouseNode = (p, g) => ({ key: 's:' + p.id + ':' + (g.sp ? g.sp.id : '-'), p: g.sp || { id: '', data: { name: 'Chưa rõ', sex: 'f' } },
    spouse: true, kidCount: 0, grouped: false, kids: () => g.kids.map(personNode) });
  const measure = (n) => {
    const ks = n.kids(); let r;
    if (!ks.length) r = { w: BW, h: BH, stack: false };
    else if (ks.every((c) => !c.kids().length)) { ks.forEach((c) => meas.set(c.key, { w: BW, h: BH, stack: false })); r = { w: IND + BW, h: BH + SG + ks.length * (BH + SG), stack: true }; }
    else { const cs = ks.map(measure); r = { w: Math.max(BW, cs.reduce((a, c) => a + c.w, 0) + HG * (cs.length - 1)), h: BH + VG + Math.max(...cs.map((c) => c.h)), stack: false }; }
    meas.set(n.key, r); return r;
  };
  const draw = (n, x, y) => {
    const m = meas.get(n.key); const ks = n.kids();
    const bx = m.stack ? x : x + (m.w - BW) / 2;
    nodes.push({ p: n.p, x: bx, y, kids: n.spouse ? 0 : n.kidCount, open: ks.length > 0, spouse: !!n.spouse, grouped: n.grouped });
    if (!ks.length) return;
    if (m.stack) {
      let cy = y + BH + SG; const lx = bx + 10;
      ks.forEach((c) => { draw(c, x + IND, cy); paths.push(`M${lx} ${cy + BH / 2}H${x + IND}`); cy += BH + SG; });
      paths.push(`M${lx} ${y + BH}V${cy - SG - BH / 2}`);
    } else {
      let cx = x + (m.w - (ks.reduce((a, c) => a + meas.get(c.key).w, 0) + HG * (ks.length - 1))) / 2;
      const top = y + BH + VG, my = y + BH + VG / 2, px = bx + BW / 2, cs = [];
      ks.forEach((c) => { const cm = meas.get(c.key); draw(c, cx, top); cs.push(cm.stack ? cx + 10 : cx + cm.w / 2); cx += cm.w + HG; });
      paths.push(`M${px} ${y + BH}V${my}`, `M${Math.min(px, ...cs)} ${my}H${Math.max(px, ...cs)}`, ...cs.map((c) => `M${c} ${my}V${top}`));
    }
  };
  const top = personNode(root); const m = measure(top); draw(top, 0, 0);
  return { nodes, paths, w: m.w, h: m.h };
}

export function chartSvg(M, L, selId, scale = 1, linked = new Set()) {
  // Spouses in order (married-in people from the projection, else the spouse text); one line, the rest counted.
  const spLine = (p, d) => {
    const sps = (M.inlaws(p.id) || []).map((q) => q.data.name);
    const names = sps.length ? sps : spousesOf(d).map((x) => x.name);
    if (!names.length) return '';
    const lbl = d.sex === 'f' ? 'Chồng' : 'Vợ';
    return `<text x="12" y="53" class="cm csp">${lbl}: ${esc(names[0].slice(0, 22))}${names.length > 1 ? ' +' + (names.length - 1) : ''}</text>`;
  };
  const box = (n) => {
    const d = n.p.data; const sx = d.sex === 'f' ? 'f' : d.sex === 'm' ? 'm' : 'u';
    const shape = sx === 'm' ? `<rect class="csx" x="${BW - 16}" y="${BH - 16}" width="8" height="8"/>` : sx === 'f' ? `<circle class="csx" cx="${BW - 12}" cy="${BH - 12}" r="4.5"/>` : '';
    const meta = n.spouse ? [d.spouse_n ? 'Vợ thứ ' + d.spouse_n : (sx === 'f' ? 'Vợ' : sx === 'm' ? 'Chồng' : 'Vợ/chồng'), years(d)].filter(Boolean).join(' · ')
      : [years(d), d.gio_lunar || d.death_lunar ? 'Giỗ ' + (d.gio_lunar || d.death_lunar) : ''].filter(Boolean).join(' · ') || 'Đời ' + (d.gen || '?');
    const tg = n.kids ? `<g class="ctg ${n.open ? 'op' : ''}" data-tg="${n.p.id}" transform="translate(${BW / 2 - 16},${BH - 9})"><rect width="32" height="18" rx="9"/><text x="16" y="13">${n.open ? '−' : '+' + n.kids}</text></g>` : '';
    const label = n.spouse ? (sx === 'f' ? 'Vợ: ' : sx === 'm' ? 'Chồng: ' : 'Vợ/chồng: ') + nameOf(d) : nameOf(d);
    const sel = n.p.id && n.p.id === selId;
    return `<g class="cbx ${sx}${n.spouse ? ' sp' : ''}${sel ? ' sel' : ''}" ${n.p.id ? `data-sel="${n.p.id}"` : ''} transform="translate(${n.x},${n.y})" tabindex="0" role="button" aria-label="${esc(rank(d))} ${esc(d.name)}${sx === 'm' ? ', nam' : sx === 'f' ? ', nữ' : ''}${years(d).includes('~') ? ', ' + years(d).replace(/~/g, 'khoảng ') : ''}">${shape}<rect class="b" width="${BW}" height="${BH}"/><rect class="s" width="4" height="${BH}"/>
      <text x="12" y="20" class="cn">${esc(label)}${d.name_han && !n.spouse ? `<tspan class="ch" lang="zh-Hant"> ${esc(d.name_han)}</tspan>` : ''}</text><text x="12" y="37" class="cm">${esc(n.spouse ? meta : rank(d) + ' · ' + meta)}</text>${n.grouped || n.spouse ? '' : spLine(n.p, d)}${n.p.id && linked.has(n.p.id) ? `<text class="clk" x="${BW - 8}" y="18" text-anchor="end"><title>Cũng có trong cây khác</title>⇄</text>` : ''}${tg}</g>`;
  };
  return `<svg class="tchart" viewBox="-4 -4 ${L.w + 8} ${L.h + 22}" width="${(L.w + 8) * scale}" height="${(L.h + 22) * scale}"><path class="cl" d="${L.paths.join('')}"/>${L.nodes.map(box).join('')}</svg>`;
}
