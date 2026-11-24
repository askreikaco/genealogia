// Kinship engine (pure, dependency-free ES module; browser and Node). No DOM, no DB.
// kinPath(graph, egoId, otherId, opts) -> descriptor of how `other` is related to `ego`, or null (same person, or not connected).
//   graph: a relgraph.js index (or raw { pc, cp }). opts: { sex(id) -> 'm'|'f'|'', year(id) -> number|null }.
// The walk is Dijkstra over parent / child / couple links: fewest hops first, then blood-most link kinds
// (ruot < nuoi < ke/khac < couple). Pedigree collapse therefore yields one canonical path per person.
// Descriptor fields:
//   up, down        generations above / below ego (couple hops count 0)
//   shape           'ancestor' | 'descendant' | 'collateral' (up then down, no couple hop) | 'inlaw' (any couple hop) | 'other'
//   line            'paternal' | 'maternal' | 'mixed' (side of the optimal first parent link; mixed = both, unknown, or no parent link first)
//   sexOther        'm' | 'f' | ''
//   viaSexes        sexes of the people strictly between ego and other, in path order
//   elderYounger    'elder' | 'younger' | null: other against the branch ego comes from at the common ancestor (birth order, else year)
//   kind            'blood' | 'adopted' (nuoi) | 'step' (ke, khac) | 'inlaw' (any couple hop)
//   collateralDegree  up + down (the 촌수 count; couple hops are not counted in the generations)
//   path            notation: F M (parent by sex), s d c (child), B Z Sb (sibling of the parent, pivot of a collateral),
//                   H W X (spouse). E.g. 'FF', 'MBd' (mother's brother's daughter), 'Hs'
//   spouseAt        null | 'first' | 'last' | 'mid' (position of the couple hop)
//   top             other has no recorded parents (the top of a line)
//   hops            number of links on the path
import { index } from '../relgraph.js';

const HOP = 1000; // cost = hops * HOP + weight; weights stay below HOP for any real path
const WEIGHT = { ruot: 0, nuoi: 1, ke: 2, khac: 2, couple: 3 };
const LIMIT = 20000; // people settled at most (guard against malformed data)

// Binary min-heap of [cost, id]; ties broken by id so the walk is deterministic.
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  less(x, y) { return x[0] < y[0] || (x[0] === y[0] && String(x[1]) < String(y[1])); }
  push(v) {
    const a = this.a; a.push(v); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

function neighbours(ix, id) {
  const out = [];
  for (const r of ix.parentsOf.get(id) || []) out.push({ to: r.parent_id, hop: 'up', kind: r.kind || 'ruot', row: r, w: WEIGHT[r.kind || 'ruot'] ?? 2 });
  for (const r of ix.childrenOf.get(id) || []) out.push({ to: r.child_id, hop: 'down', kind: r.kind || 'ruot', row: r, w: WEIGHT[r.kind || 'ruot'] ?? 2 });
  for (const x of ix.partnersOf.get(id) || []) out.push({ to: x.other, hop: 'spouse', kind: 'couple', row: x.row, w: WEIGHT.couple });
  return out;
}

// Cheapest walk from -> to: { cost, steps: [{ from, to, hop, kind, row }] } or null.
function shortest(ix, from, to) {
  if (from === to) return null;
  const dist = new Map([[from, 0]]); const prev = new Map(); const done = new Set();
  const h = new Heap(); h.push([0, from]);
  while (h.size && done.size < LIMIT) {
    const [c, cur] = h.pop();
    if (done.has(cur)) continue;
    done.add(cur);
    if (cur === to) break;
    for (const e of neighbours(ix, cur)) {
      const nc = c + HOP + e.w;
      if (nc < (dist.has(e.to) ? dist.get(e.to) : Infinity)) { dist.set(e.to, nc); prev.set(e.to, { from: cur, ...e }); h.push([nc, e.to]); }
    }
  }
  if (!done.has(to)) return null;
  const steps = [];
  for (let x = to; x !== from; x = prev.get(x).from) steps.unshift(prev.get(x));
  return { cost: dist.get(to), steps };
}

// Side of the relation: the parents of ego that lie on an optimal walk to other. Only father (m) or only mother (f) gives a side.
function lineOf(ix, egoId, otherId, cost, sex) {
  const sides = new Set();
  for (const r of ix.parentsOf.get(egoId) || []) {
    const rest = r.parent_id === otherId ? 0 : (shortest(ix, r.parent_id, otherId)?.cost ?? Infinity);
    if (HOP + (WEIGHT[r.kind || 'ruot'] ?? 2) + rest === cost) sides.add(sex(r.parent_id) || '?');
  }
  if (sides.size === 1 && sides.has('m')) return 'paternal';
  if (sides.size === 1 && sides.has('f')) return 'maternal';
  return 'mixed';
}

// Birth order decides first (smaller = elder, both rows under the same parent); the year is the fallback.
function elderOf(ix, parentId, xo, xe, year) {
  const rows = ix.childrenOf.get(parentId) || [];
  const order = (x) => rows.find((r) => r.child_id === x)?.birth_order ?? null;
  const a = order(xo); const b = order(xe);
  if (a != null && b != null && a !== b) return a < b ? 'elder' : 'younger';
  const ya = year(xo); const yb = year(xe);
  if (ya && yb && ya !== yb) return ya < yb ? 'elder' : 'younger';
  return null;
}

const LET = {
  up: { m: 'F', f: 'M', '': 'P' }, down: { m: 's', f: 'd', '': 'c' },
  spouse: { m: 'H', f: 'W', '': 'X' }, sib: { m: 'B', f: 'Z', '': 'Sb' },
};
// Notation. A collateral (up^k down^m) is written as its parent chain, then one sibling token for the branch
// (the pivot is the sibling of ego's branch root), then the remaining descent: MBd = mother's brother's daughter.
function notation(shape, steps, nodes, sex, k) {
  const s = (i) => sex(nodes[i]) || '';
  const out = [];
  if (shape === 'collateral') {
    for (let i = 0; i < k - 1; i++) out.push(LET.up[s(i + 1)]);
    out.push(LET.sib[s(k + 1)]);
    for (let i = k + 1; i < steps.length; i++) out.push(LET.down[s(i + 1)]);
  } else {
    steps.forEach((st, i) => out.push(LET[st.hop][s(i + 1)]));
  }
  return out.join('');
}

// Canonical descriptor of other relative to ego (see the header for fields). Null when no walk connects them.
export function kinPath(graph, egoId, otherId, opts = {}) {
  if (egoId == null || otherId == null || egoId === otherId) return null;
  const ix = graph && graph.parentsOf ? graph : index(graph?.pc || [], graph?.cp || []);
  const sex = opts.sex || (() => ''); const year = opts.year || (() => null);
  const best = shortest(ix, egoId, otherId);
  if (!best) return null;
  const { steps } = best;
  const nodes = [egoId, ...steps.map((s) => s.to)];
  const ups = steps.filter((s) => s.hop === 'up').length;
  const downs = steps.filter((s) => s.hop === 'down').length;
  const spouses = steps.filter((s) => s.hop === 'spouse').length;
  const seq = steps.filter((s) => s.hop !== 'spouse').map((s) => s.hop);
  const upThenDown = seq.lastIndexOf('up') < seq.indexOf('down') || seq.indexOf('down') < 0;
  const shape = spouses ? 'inlaw' : !downs ? 'ancestor' : !ups ? 'descendant' : (!spouses && upThenDown) ? 'collateral' : 'other';
  const kinds = steps.map((s) => s.kind);
  const kind = spouses ? 'inlaw' : kinds.some((k) => k === 'ke' || k === 'khac') ? 'step' : kinds.includes('nuoi') ? 'adopted' : 'blood';
  const at = steps.flatMap((s, i) => (s.hop === 'spouse' ? [i] : []));
  const spouseAt = !at.length ? null : at.length > 1 ? 'mid' : at[0] === 0 ? 'first' : at[0] === steps.length - 1 ? 'last' : 'mid';
  let elderYounger = null;
  if (shape === 'collateral') elderYounger = elderOf(ix, nodes[ups], nodes[ups + 1], nodes[ups - 1], year);
  return {
    ego: egoId, other: otherId, up: ups, down: downs, shape,
    line: lineOf(ix, egoId, otherId, best.cost, sex),
    kind, spouseAt, elderYounger,
    sexOther: sex(otherId) || '',
    viaSexes: nodes.slice(1, -1).map((id) => sex(id) || ''),
    collateralDegree: ups + downs,
    path: notation(shape, steps, nodes, sex, ups),
    top: !(ix.parentsOf.get(otherId) || []).length,
    hops: steps.length,
  };
}

// A descriptor for a plain lineal (or collateral) relation with no graph: lineDesc(0, 2) is a grandchild.
export function lineDesc(up, down, sexOther = '') {
  const shape = down === 0 ? 'ancestor' : up === 0 ? 'descendant' : 'collateral';
  return {
    ego: null, other: null, up, down, shape, line: 'mixed', kind: 'blood', spouseAt: null, elderYounger: null,
    sexOther, viaSexes: [], collateralDegree: up + down, path: '', top: false, hops: up + down,
  };
}
