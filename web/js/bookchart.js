// Book family-tree figures: SVG boxes and connectors from the plan's geometry (bookplan.js), labels from person data.
// A figure is {root, w, h, s, paths, nodes:[[id, x, y, cut, desc, ref]]}; cut boxes name the page of their branch.
import { rank, years } from './bookplan.js';

const BW = 132, BH = 44;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// person(id) -> person data (null when unknown). Every node of a figure must be loaded before it is drawn.
export function figSvg(fig, person) {
  const box = ([id, x, y, cut, desc, ref]) => {
    const d = person(id) || { name: '', sex: 'm' }; const sx = d.sex === 'f' ? 'f' : 'm';
    const sub = cut ? `+${desc} người · tr. ${ref ?? '–'}` : years(d);
    return `<g class="bx ${sx} ${id === fig.root ? 'root' : ''} ${cut ? 'cut' : ''}" transform="translate(${x},${y})"><rect width="${BW}" height="${BH}"/>
      <text x="7" y="13" class="r">${esc(rank(d))}${d.gen ? ' · Đời ' + d.gen : ''}</text><text x="7" y="27" class="n">${esc(d.name)}</text>${sub ? `<text x="7" y="39" class="y">${esc(sub)}</text>` : ''}</g>`;
  };
  const s = fig.s;
  return `<svg class="chart" viewBox="-2 -2 ${fig.w + 4} ${fig.h + 4}" width="${((fig.w + 4) * s).toFixed(2)}" height="${((fig.h + 4) * s).toFixed(2)}" role="img" aria-label="Sơ đồ cây gia phả"><path d="${fig.paths}"/>${fig.nodes.map(box).join('')}</svg>`;
}
