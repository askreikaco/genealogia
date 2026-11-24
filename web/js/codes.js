// Person codes (mã người), Vietnamese gia phả numbering: surname letter · generation · sibling ranks from the thủy tổ.
//   D-1        the thủy tổ (founder) of the Dương family, generation 1
//   D-2.2      the founder's 2nd child (generation 2)
//   D-3.2.1    that child's 1st child (generation 3)
// The generation is the founder's generation plus the depth, so the first number always reads as "Đời N". Ranks follow
// birth order (Thứ / order), then birth date, then name, then id; adopted children and children of every spouse are
// ranked together under their parent, as the tree shows them. People who married in, and people not descended from the
// founder, get no code. Codes are computed, never stored: when birth order or the thủy tổ changes, codes below change.
// Plain ES module (no DOM): the app, the book outline (server) and server/test/codes.test.js all import it.
import { founderOf, birthKey } from './branches.js';

const collator = new Intl.Collator('vi');
const asNum = (v) => { const n = typeof v === 'number' ? v : parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : null; };
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'D');

export const CODE_HELP = 'Mã người: chữ đầu của họ, đời, rồi thứ tự anh chị em từ thủy tổ xuống. Mã đổi khi thứ tự anh chị em hoặc thủy tổ thay đổi.';

export function surnameLetter(name) {
  const w = fold(name).trim().split(/\s+/)[0] || '';
  return (w.match(/[A-Za-z]/)?.[0] || 'X').toUpperCase();
}
// sibling order: Thứ/order (missing last), birth date (missing last), name, id
export function siblingCompare(a, b) {
  const oa = asNum(a.data.order) ?? asNum(a.data.thu); const ob = asNum(b.data.order) ?? asNum(b.data.thu);
  if (oa !== ob) return oa === null ? 1 : ob === null ? -1 : oa - ob;
  const ba = birthKey(a.data); const bb = birthKey(b.data);
  if (ba !== bb) return ba === null ? 1 : bb === null ? -1 : ba - bb;
  return collator.compare(String(a.data.name || ''), String(b.data.name || '')) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
// id -> code for every family in M (M.ps carries .fam on combined pages; one family otherwise).
export function personCodes(M, cfg = M.branchCfg) {
  const out = new Map();
  const fams = [...new Set(M.ps.map((p) => p.fam))];
  for (const fam of fams) {
    const f = founderOf(M, cfg, fam)?.person; if (!f) continue;
    const L = surnameLetter(f.data.name); const g0 = asNum(f.data.gen) ?? 1;
    const seen = new Set();
    const walk = (p, path) => {
      if (seen.has(p.id)) return; seen.add(p.id);
      out.set(p.id, `${L}-${[g0 + path.length, ...path].join('.')}`);
      [...M.kids(p.id)].filter((k) => k.fam === p.fam && !k.data.spouse_of).sort(siblingCompare).forEach((k, i) => walk(k, [...path, i + 1]));
    };
    walk(f, []);
  }
  return out;
}
// Cached per model object (the app rebuilds M when data changes).
const cache = new WeakMap();
export function codeOf(M, id) {
  let m = cache.get(M); if (!m) { m = personCodes(M); cache.set(M, m); }
  return m.get(id) || '';
}
// "d-3.2", "D 3.2.1", "D-3.2." -> "D-3.2" / "D-3.2.1"; null when the text is not a code.
export function codeQuery(q) {
  const t = fold(q).toUpperCase().replace(/\s+/g, '').replace(/^([A-Z])(?=\d)/, '$1-').replace(/\.$/, '');
  return /^[A-Z]-\d+(\.\d+)*$/.test(t) ? t : null;
}
// exact code, or that generation under a path: "D-3.2" matches D-3.2.1 and D-3.2.2 (not D-3.21 or D-4.2.1.1)
export const matchCode = (code, cq) => !!code && !!cq && (code === cq || code.startsWith(cq + '.'));
