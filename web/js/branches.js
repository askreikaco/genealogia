// Thủy tổ (founder) and branches (chi), worked out from the tree; the admin's values in Cài đặt dòng họ only override.
// One rule for the tree, Tìm, map, stats, book plan and Cài đặt dòng họ.
//   founder  AUTO: among blood people with no parent in the tree (people who married in never count), the lowest
//            generation, then the earliest birth, then the most descendants, then the name.
//   branches AUTO: walk down from the founder while the line has one child with descendants; the first person with two
//            or more children who have descendants is where the line splits; those children are the branch founders.
//            A line that never splits is one chi (the thủy tổ's).
//            Override: branch_gen (every blood person at that generation who has children).
//   order    AUTO: birth order (Thứ, chi trưởng first), then birth date/year, then name (Vietnamese collation); unknown
//            last. Override: branch_order (founder ids; ids not in it follow in the automatic order).
// cfg: { founder_person_id, branch_gen, branch_order } or a function fam -> cfg (combined pages span several families).
// Plain ES module, no imports: server/test/branches.test.js loads it as-is.
export const BRANCH_GEN = 3;
const collator = new Intl.Collator('vi');

const asNum = (v) => { const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : null; };
const cfgFor = (cfg, fam) => (typeof cfg === 'function' ? cfg(fam) : cfg) || {};
// Birth as a sortable number yyyymmdd (missing month/day = 0); null when unknown. Accepts dd/mm/yyyy, yyyy-mm-dd, yyyy.
export function birthKey(d = {}) {
  const s = String(d.birth_date || d.born || '');
  let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return +m[3] * 10000 + +m[2] * 100 + +m[1];
  m = s.match(/(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/); if (m) return +m[1] * 10000 + +m[2] * 100 + (+m[3] || 0);
  m = s.match(/\d{4}/); return m ? +m[0] * 10000 : null;
}
const birthOrder = (d) => asNum(d.order) ?? asNum(d.thu);
const byName = (a, b) => collator.compare(String(a.data.name || ''), String(b.data.name || ''));
const fams = (M) => [...new Set(M.ps.map((p) => p.fam))];
const ofFam = (M, fam) => (fam === undefined ? M.ps : M.ps.filter((p) => p.fam === fam));
const hasDesc = (M, p) => (M.desc ? M.desc(p.id) > 0 : M.kids(p.id).length > 0);
const descN = (M, p) => (M.desc ? M.desc(p.id) : M.kids(p.id).length);

// ---- founder ----
export function autoFounder(M, fam) {
  const ps = ofFam(M, fam);
  const roots = ps.filter((p) => !p.data.parent || !M.byId.get(p.data.parent));
  const g = (p) => asNum(p.data.gen) ?? Infinity; const b = (p) => birthKey(p.data) ?? Infinity;
  return [...roots].sort((x, y) => g(x) - g(y) || b(x) - b(y) || descN(M, y) - descN(M, x) || byName(x, y))[0] || null;
}
export function founderOf(M, cfg = M.branchCfg, fam = fams(M)[0]) {
  const c = cfgFor(cfg, fam); const set = c.founder_person_id && M.byId.get(c.founder_person_id);
  if (set) return { person: set, auto: false };
  const p = autoFounder(M, fam);
  return { person: p, auto: true, reason: 'người sớm nhất không có cha mẹ trong cây' };
}

// ---- sort ----
// [birth order, birth] for each ancestor from the root down to p: siblings by Thứ; cousins by their elder line first.
function lineKey(M, p) {
  const out = []; let q = p; const seen = new Set();
  while (q && !seen.has(q.id)) { seen.add(q.id); out.unshift([birthOrder(q.data) ?? Infinity, birthKey(q.data) ?? Infinity]); q = M.byId.get(q.data.parent); }
  return out;
}
function cmpLine(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) for (let j = 0; j < 2; j++) if (a[i][j] !== b[i][j]) return a[i][j] < b[i][j] ? -1 : 1;
  return a.length - b.length;
}
export function sortBranches(M, list, manual) {
  const pos = new Map((Array.isArray(manual) ? manual : []).map((id, i) => [id, i]));
  const keyed = list.map((p) => ({ p, m: pos.has(p.id) ? pos.get(p.id) : Infinity, k: lineKey(M, p) }));
  keyed.sort((x, y) => (x.m !== y.m ? (x.m < y.m ? -1 : 1) : cmpLine(x.k, y.k) || byName(x.p, y.p)));
  return keyed.map((x) => x.p);
}

// ---- branches of one family ----
// { founders, gen, auto, reason, splitAt } — founders sorted; gen = their generation (or the override).
export function branchInfo(M, cfg = M.branchCfg, fam = fams(M)[0], opts = {}) {
  // memo per built model (M is rebuilt on every change) when the family settings come from the model itself
  const memo = cfg === M.branchCfg ? (M._branchMemo ||= new Map()) : null; const key = `${fam}|${!!opts.all}`;
  if (memo?.has(key)) return memo.get(key);
  const r = branchInfoRaw(M, cfg, fam, opts); memo?.set(key, r); return r;
}
function branchInfoRaw(M, cfg, fam, opts) {
  const c = cfgFor(cfg, fam);
  const over = asNum(c.branch_gen);
  if (over) {
    const list = ofFam(M, fam).filter((p) => asNum(p.data.gen) === over && (opts.all || M.kids(p.id).length));
    return { founders: sortBranches(M, list, c.branch_order), gen: over, auto: false, reason: `sửa tay: đời ${over}` };
  }
  const { person: root } = founderOf(M, cfg, fam);
  let q = root; const seen = new Set();
  while (q && !seen.has(q.id)) {
    seen.add(q.id);
    const kids = M.kids(q.id).filter((k) => hasDesc(M, k));
    if (kids.length >= 2) {
      const list = opts.all ? M.kids(q.id) : kids;
      const gen = asNum(kids[0].data.gen);
      return { founders: sortBranches(M, list, c.branch_order), gen, auto: true, splitAt: q, reason: `chia nhánh ở đời ${gen ?? '?'}` };
    }
    q = kids[0];
  }
  // the line never splits: the whole line is one chi, founded by the thủy tổ
  return { founders: root ? [root] : [], gen: root ? asNum(root.data.gen) : null, auto: true, splitAt: null, reason: 'dòng chưa chia nhánh: cả dòng là một chi' };
}

// Branch founders of M (every family on a combined page). opts.all: also founders without descendants.
export function branchesOf(M, cfg = M.branchCfg, opts = {}) {
  return fams(M).flatMap((f) => branchInfo(M, cfg, f, opts).founders);
}
// The branch founder a person belongs to (their ancestor among the branch founders), or null.
export function branchOf(M, p, cfg = M.branchCfg) {
  const set = new Set(branchInfo(M, cfg, p.fam, { all: true }).founders.map((x) => x.id));
  let q = p; const seen = new Set();
  while (q && !seen.has(q.id)) { if (set.has(q.id)) return q; seen.add(q.id); q = M.byId.get(q.data.parent); }
  return null;
}
// The generation of the branch founders for a person's family (book plan uses it for the "early generations" block).
export const branchGen = (cfg, p, M) => (M ? branchInfo(M, cfg, p?.fam).gen : asNum(cfgFor(cfg, p?.fam).branch_gen)) || BRANCH_GEN;
