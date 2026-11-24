// Relationship graph (pure, no DOM, no DB). Shared by the server (API, backfill, legacy projection) and the web app.
// Tables: parent_child (migration 009) and couple. A couple row is oriented: a = the person the link was added from,
// order_a = ordinal of b among a's partners, order_b = ordinal of a among b's partners (null when unknown).
export const PC_KINDS = ['ruot', 'nuoi', 'ke', 'khac'];
export const CP_KINDS = ['cuoi', 'vo_le', 'ban_doi', 'ly_hon', 'goa', 'khac'];
export const PC_LABEL = { ruot: 'ruột', nuoi: 'nuôi', ke: 'kế', khac: 'khác' };
export const CP_LABEL = { cuoi: 'cưới', vo_le: 'vợ lẽ', ban_doi: 'bạn đời', ly_hon: 'ly hôn', goa: 'góa', khac: 'khác' };
const PC_RANK = { ruot: 0, nuoi: 1, ke: 2, khac: 3 };
const MAX_YEAR = 3000;

const isInt = (v) => Number.isInteger(v);
const yearOk = (v) => v === null || v === undefined || (isInt(v) && v >= 1 && v <= MAX_YEAR);
const orderOk = (v) => v === null || v === undefined || (isInt(v) && v >= 1 && v <= 99);

// Input checks for one relation row. Returns an error message or null.
export function validatePC(r) {
  if (!r || typeof r.parent_id !== 'string' || typeof r.child_id !== 'string') return 'Thiếu người cha/mẹ hoặc con.';
  if (r.parent_id === r.child_id) return 'Một người không thể là cha/mẹ của chính mình.';
  if (!PC_KINDS.includes(r.kind ?? 'ruot')) return 'Loại quan hệ cha mẹ không hợp lệ.';
  if (!orderOk(r.birth_order ?? null)) return 'Thứ tự con phải là số từ 1 đến 99.';
  return null;
}
export function validateCP(r) {
  if (!r || typeof r.a_id !== 'string' || typeof r.b_id !== 'string') return 'Thiếu người trong quan hệ vợ/chồng.';
  if (r.a_id === r.b_id) return 'Một người không thể là vợ/chồng của chính mình.';
  if (!CP_KINDS.includes(r.kind ?? 'cuoi')) return 'Loại quan hệ vợ/chồng không hợp lệ.';
  if (!orderOk(r.order_a ?? null) || !orderOk(r.order_b ?? null)) return 'Thứ tự phải là số từ 1 đến 99.';
  if (!yearOk(r.start_year ?? null) || !yearOk(r.end_year ?? null)) return 'Năm phải là số hợp lệ.';
  if (r.start_year && r.end_year && r.end_year < r.start_year) return 'Năm kết thúc phải sau năm bắt đầu.';
  return null;
}

// Parent-child index. parentsOf(child): sorted by kind rank, birth order, then row id.
export function index(pc = [], cp = []) {
  const parentsOf = new Map(); const childrenOf = new Map(); const partnersOf = new Map();
  const put = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const r of pc) { put(parentsOf, r.child_id, r); put(childrenOf, r.parent_id, r); }
  for (const arr of parentsOf.values()) arr.sort((x, y) => (PC_RANK[x.kind] - PC_RANK[y.kind]) || ((x.birth_order ?? 1e9) - (y.birth_order ?? 1e9)) || ((x.id ?? 0) - (y.id ?? 0)));
  for (const r of cp) {
    put(partnersOf, r.a_id, { row: r, other: r.b_id, order: r.order_a ?? null, mine: 'a' });
    put(partnersOf, r.b_id, { row: r, other: r.a_id, order: r.order_b ?? null, mine: 'b' });
  }
  const pOrd = (x, y) => ((x.order ?? 1e9) - (y.order ?? 1e9)) || ((x.row.start_year ?? 1e9) - (y.row.start_year ?? 1e9)) || ((x.row.id ?? 0) - (y.row.id ?? 0));
  for (const arr of partnersOf.values()) arr.sort(pOrd);
  return { parentsOf, childrenOf, partnersOf, pc, cp };
}

// Ancestors of id (BFS over parent links), each with the link path back to id. Used for cycle checks and common ancestors.
function ancestorsWithPath(ix, id) {
  const out = new Map([[id, [id]]]); const q = [id];
  for (let i = 0; i < q.length && out.size < 5000; i++) {
    const cur = q[i];
    for (const r of ix.parentsOf.get(cur) || []) if (!out.has(r.parent_id)) { out.set(r.parent_id, [...out.get(cur), r.parent_id]); q.push(r.parent_id); }
  }
  return out;
}

// Adding parent -> child would make child its own ancestor when child is already an ancestor of parent.
// Returns null when allowed, else the path [parent, ..., child] (each step is "is a child of" the next).
export function cyclePath(ix, parentId, childId) {
  if (parentId === childId) return [parentId, childId];
  const anc = ancestorsWithPath(ix, parentId);
  return anc.has(childId) ? anc.get(childId) : null;
}

// Neutral sentence for a path: "B là con của A, C là con của B". Names come from nameOf(id).
export function cycleMessage(path, nameOf) {
  const n = (id) => nameOf(id) || 'người này';
  const steps = [];
  for (let i = 0; i + 1 < path.length; i++) steps.push(`${n(path[i])} là con của ${n(path[i + 1])}`);
  return `Không thể thêm: ${n(path[path.length - 1])} đã là tổ tiên của ${n(path[0])} (${steps.join('; ')}). Một người không thể là tổ tiên của chính mình.`;
}

// Legacy person fields -> relation rows (the backfill mapping). persons: [{ id, data }] of one family, not deleted.
// Returns { pc, cp, anomalies }. Rows that would create a cycle are left out and reported.
export function legacyRows(persons) {
  const ids = new Set(persons.map((p) => p.id)); const anomalies = []; const pc = []; const cp = [];
  const byId = new Map(persons.map((p) => [p.id, p]));
  let seq = 0;
  // siblings: birth_order = ordinal of the legacy "order" value among children of the same parent (ties by id)
  const kidsByParent = new Map();
  for (const p of persons) {
    const par = p.data?.parent;
    if (par) { if (!kidsByParent.has(par)) kidsByParent.set(par, []); kidsByParent.get(par).push(p); }
  }
  const birthOrder = new Map();
  for (const arr of kidsByParent.values()) {
    arr.sort((a, b) => ((a.data.order ?? 1e9) - (b.data.order ?? 1e9)) || (a.id < b.id ? -1 : 1));
    arr.forEach((p, i) => birthOrder.set(p.id, i + 1));
  }
  const ix0 = () => index(pc, cp);
  const addPC = (parent_id, child_id, order) => {
    const row = { id: ++seq, parent_id, child_id, kind: 'ruot', birth_order: order ?? null, private: false };
    const path = cyclePath(ix0(), parent_id, child_id);
    if (path) { anomalies.push({ type: 'cycle', person: child_id, parent: parent_id }); return; }
    pc.push(row);
  };
  for (const p of persons) {
    const d = p.data || {};
    if (d.parent) {
      if (!ids.has(d.parent)) anomalies.push({ type: 'parent_missing', person: p.id, ref: d.parent });
      else if (d.parent === p.id) anomalies.push({ type: 'self_parent', person: p.id });
      else addPC(d.parent, p.id, birthOrder.get(p.id));
    }
    if (d.other_parent) {
      if (!ids.has(d.other_parent)) anomalies.push({ type: 'other_parent_missing', person: p.id, ref: d.other_parent });
      else if (d.other_parent === d.parent) anomalies.push({ type: 'other_parent_same', person: p.id });
      else if (d.other_parent === p.id) anomalies.push({ type: 'self_parent', person: p.id });
      else addPC(d.other_parent, p.id, null);
    }
  }
  for (const p of persons) {
    const d = p.data || {};
    if (!d.spouse_of) { if (d.spouse_n) anomalies.push({ type: 'spouse_n_without_spouse_of', person: p.id }); continue; }
    if (!ids.has(d.spouse_of)) { anomalies.push({ type: 'spouse_missing', person: p.id, ref: d.spouse_of }); continue; }
    if (d.spouse_of === p.id) { anomalies.push({ type: 'self_spouse', person: p.id }); continue; }
    const anchor = byId.get(d.spouse_of);
    if (anchor.data?.spouse_of) anomalies.push({ type: 'spouse_chain', person: p.id, ref: d.spouse_of });
    const n = Number.isInteger(d.spouse_n) && d.spouse_n >= 1 ? d.spouse_n : null;
    cp.push({ id: ++seq, a_id: d.spouse_of, b_id: p.id, kind: 'cuoi', order_a: n, order_b: null,
      start_year: yearFrom(d.married), end_year: null, private: false, note: null });
  }
  return { pc, cp, anomalies };
}
function yearFrom(s) { const m = /(\d{4})/.exec(String(s || '')); const y = m ? Number(m[1]) : null; return y && y >= 1 && y <= MAX_YEAR ? y : null; }

// Projection: the legacy-shaped fields the tree, book and sheets read, derived from the relation rows.
// pc/cp must already be filtered for the viewer (private rows dropped for guests).
// Returns Map id -> { parent, other_parent, spouse_of, spouse_n } (only keys that have a value).
//  - parent: first parent link (ruot > nuoi > ke > khac, then birth order); other_parent: the next distinct parent.
//  - spouse_of: a person with no parent link and no children in the tree is an in-law of its partner who is in the tree.
//    Orientation (a = the anchor side) decides when both sides are isolated. Chains resolve to the blood person.
export function project(ids, pc, cp) {
  const ix = index(pc, cp); const out = new Map();
  const parentOf = new Map(); const other = new Map();
  for (const id of ids) {
    const ps = ix.parentsOf.get(id) || [];
    if (ps.length) {
      parentOf.set(id, ps[0].parent_id);
      const second = ps.find((r) => r.parent_id !== ps[0].parent_id);
      if (second) other.set(id, second.parent_id);
    }
  }
  const hasKids = new Set(parentOf.values());
  const isolated = (id) => !parentOf.has(id) && !hasKids.has(id);
  const spouseOf = new Map(); const spouseN = new Map();
  for (const id of ids) {
    if (!isolated(id)) continue;
    for (const pr of ix.partnersOf.get(id) || []) {
      const q = pr.other;
      // in-law: the partner is in the tree, or this person is the b side of a link anchored at q (orientation)
      if (!isolated(q) || pr.mine === 'b') {
        spouseOf.set(id, q);
        const back = (ix.partnersOf.get(q) || []).find((x) => x.row === pr.row);
        spouseN.set(id, back ? back.order : null);
        break;
      }
    }
  }
  // Chains: an in-law whose anchor is itself an in-law points at that anchor's anchor (at most 5 hops).
  for (const id of [...spouseOf.keys()]) {
    let q = spouseOf.get(id); let hops = 0;
    while (spouseOf.has(q) && hops++ < 5) q = spouseOf.get(q);
    if (spouseOf.has(q) || q === id) { spouseOf.delete(id); spouseN.delete(id); } else spouseOf.set(id, q);
  }
  for (const id of ids) {
    const o = {};
    if (parentOf.has(id)) o.parent = parentOf.get(id);
    if (other.has(id)) o.other_parent = other.get(id);
    if (spouseOf.has(id)) { o.spouse_of = spouseOf.get(id); if (spouseN.get(id) != null) o.spouse_n = spouseN.get(id); }
    if (Object.keys(o).length) out.set(id, o);
  }
  return out;
}

// Neutral, factual notes about a couple (information only; never blocking). nameOf(id) -> display name.
export function coupleNotes(ix, a, b, nameOf = () => '') {
  const notes = [];
  const pa = new Set((ix.parentsOf.get(a) || []).map((r) => r.parent_id));
  const pb = new Set((ix.parentsOf.get(b) || []).map((r) => r.parent_id));
  if ([...pa].some((x) => pb.has(x))) notes.push('Hai người cũng là anh chị em trong cây.');
  else if (pa.has(b) || pb.has(a)) notes.push('Hai người là cha/mẹ và con trong cây.');
  else {
    const aa = ancestorsWithPath(ix, a); const ab = ancestorsWithPath(ix, b);
    const common = [...aa.keys()].filter((x) => x !== a && ab.has(x));
    if (common.length) notes.push('Hai người có chung tổ tiên trong cây.');
  }
  return notes;
}

// Siblings of id: anyone sharing a parent link (not 'khac'). Returns [{ id, shared: 'cha mẹ' | 'cha' | 'mẹ' | 'cha/mẹ' }].
export function siblingsOf(ix, id, sexOf = () => '') {
  const mine = new Map();
  for (const r of ix.parentsOf.get(id) || []) if (r.kind !== 'khac') mine.set(r.parent_id, r);
  const seen = new Map();
  for (const p of mine.keys()) for (const r of ix.childrenOf.get(p) || []) {
    if (r.child_id === id || r.kind === 'khac') continue;
    if (!seen.has(r.child_id)) seen.set(r.child_id, new Set());
    seen.get(r.child_id).add(p);
  }
  return [...seen].map(([sid, ps]) => {
    const sexes = [...ps].map((x) => sexOf(x));
    const hasF = sexes.includes('f'); const hasM = sexes.includes('m');
    const shared = ps.size >= 2 ? 'cha mẹ' : hasM && !hasF ? 'cha' : hasF && !hasM ? 'mẹ' : 'cha/mẹ';
    return { id: sid, shared };
  }).sort((x, y) => (x.id < y.id ? -1 : 1));
}

// All descendants of id, each person once (for counts on a profile).
export function descendantIds(ix, id) {
  const out = new Set(); const q = [id];
  for (let i = 0; i < q.length && out.size < 20000; i++) for (const r of ix.childrenOf.get(q[i]) || []) if (!out.has(r.child_id) && r.child_id !== id) { out.add(r.child_id); q.push(r.child_id); }
  return out;
}

// Pedigree (ancestor tree) with collapse: the first time an ancestor appears it is drawn in full; any later
// appearance is a link { id, ref } to where it was first drawn (ref = the path label), never a second subtree.
export function pedigree(ix, rootId, depth = 4, nameOf = () => '') {
  const first = new Map();
  const build = (id, gen, path) => {
    if (first.has(id)) return { id, gen, repeat: true, ref: first.get(id) };
    first.set(id, path.map(nameOf).join(' › '));
    const node = { id, gen, parents: [] };
    if (gen < depth) for (const r of ix.parentsOf.get(id) || []) node.parents.push({ kind: r.kind, ...build(r.parent_id, gen + 1, [...path, r.parent_id]) });
    return node;
  };
  return build(rootId, 0, [rootId]);
}

// Blood and adopted lineage below id, by generation: levels[0] = children, levels[1] = grandchildren, levels[2] = great-grandchildren...
// Only parent links of kind ruot / nuoi are walked (step, other and married-in links are not lineage). Each person appears once
// (pedigree collapse: the first place in the walk wins). Within a level: parent order, then birth order, then row id.
export function descendantLevels(ix, id) {
  const seen = new Set([id]); const levels = []; let frontier = [id];
  for (let d = 0; frontier.length && d < 50; d++) {
    const next = [];
    for (const pid of frontier) {
      const kids = (ix.childrenOf.get(pid) || []).filter((r) => r.kind === 'ruot' || r.kind === 'nuoi')
        .sort((x, y) => ((x.birth_order ?? 1e9) - (y.birth_order ?? 1e9)) || ((x.id ?? 0) - (y.id ?? 0)));
      for (const r of kids) if (!seen.has(r.child_id)) { seen.add(r.child_id); next.push({ id: r.child_id, parent: pid, row: r }); }
    }
    if (next.length) levels.push(next);
    frontier = next.map((x) => x.id);
  }
  return levels;
}

// Tổ tiên rows, flat in walk order. One entry per drawn ancestor: id, gen, repeat, ref, name and label all come from
// the same node, so a row's link, name and label can never point at different people. labelOf(id, entry) -> text.
export function pedigreeRows(ix, rootId, depth = 4, nameOf = () => '', labelOf = () => '') {
  const out = [];
  const walk = (n) => {
    for (const x of n.parents || []) {
      out.push({ id: x.id, gen: x.gen, repeat: !!x.repeat, ref: x.repeat ? x.ref : '', name: nameOf(x.id), label: labelOf(x.id, x) });
      if (!x.repeat) walk(x);
    }
  };
  walk(pedigree(ix, rootId, depth, nameOf));
  return out;
}
