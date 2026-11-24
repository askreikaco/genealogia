// Derived family structure from the flat person list (recomputed on every change; 328 people is cheap).
import { list, familyMeta, curFamily } from './store.js';
import { branchOf } from './branches.js';

export { branchOf };

// Year of a stored date text: "1839", "1839-05-01", "khoảng 901", "trước CN 711" (negative). null when there is none.
export function yearOfText(s) {
  if (s == null || s === '') return null;
  const t = String(s);
  if (/^trước CN/i.test(t)) { const m = /(\d+)/.exec(t); return m ? -parseInt(m[1], 10) : null; }
  const four = /\b(\d{4})\b/.exec(t) || /(\d{1,4})/.exec(t);
  return four ? parseInt(four[1], 10) : null;
}
// Earliest known birth or death year of a person; Infinity when undated (sorts last).
const rootYear = (p) => {
  const ys = [p.data.born, p.data.birth_date, p.data.died, p.data.death_date].map(yearOfText).filter((y) => y !== null);
  return ys.length ? Math.min(...ys) : Infinity;
};
// M.branchCfg: each family's branch generation and manual branch order (Cài đặt dòng họ), read by web/js/branches.js.
export function build() {
  const M = buildFrom(list());
  M.branchCfg = (fam) => { const f = familyMeta(fam || curFamily()) || {}; return { founder_person_id: f.founder_person_id, branch_gen: f.branch_gen, branch_order: f.branch_order }; };
  return M;
}

// Pure: the same structure for any list of people (tests pass fixtures). Everyone is in `all` and `everyone`;
// `ps` is the bloodline only and feeds the tree layout, not any count.
export function buildFrom(all) {
  const ps = all.filter((p) => !p.data.spouse_of); // bloodline; in-laws hang off their spouse
  const byId = new Map(all.map((p) => [p.id, p]));
  const inl = new Map();
  for (const p of all) if (p.data.spouse_of) { if (!inl.has(p.data.spouse_of)) inl.set(p.data.spouse_of, []); inl.get(p.data.spouse_of).push(p); }
  for (const arr of inl.values()) arr.sort((a, b) => (a.data.spouse_n || 0) - (b.data.spouse_n || 0));
  const kids = new Map();
  for (const p of ps) { const k = p.data.parent || ''; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(p); }
  const ord = (p) => p.data.order ?? 1e9;
  for (const arr of kids.values()) arr.sort((a, b) => ord(a) - ord(b));
  // Roots (people with no parent in the family): manual order (data.order), then a group order (data.ext.order, the
  // same for every person of one group, so a group stays together), then the earliest known birth or death year, undated
  // last. Array.sort is stable, so ties keep the list order.
  const extOrd = (p) => (Number.isInteger(p.data.ext?.order) ? p.data.ext.order : Infinity);
  const roots = (kids.get('') || []).concat(ps.filter((p) => p.data.parent && !byId.has(p.data.parent)))
    .sort((a, b) => ord(a) - ord(b) || extOrd(a) - extOrd(b) || rootYear(a) - rootYear(b));
  // Register numbers (Gramps/NGSQ): sequential by generation over people who get an entry.
  const reg = new Map(); const dab = new Map(); const desc = new Map();
  const queue = roots.map((r, i) => { dab.set(r.id, String(i + 1)); return r; });
  let n = 0;
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]; if (hasEntry(p)) reg.set(p.id, ++n);
    (kids.get(p.id) || []).forEach((c, j) => { dab.set(c.id, dab.get(p.id) + '.' + (j + 1)); queue.push(c); });
  }
  const countDesc = (id) => { if (desc.has(id)) return desc.get(id); let s = 0; for (const c of kids.get(id) || []) s += 1 + countDesc(c.id); desc.set(id, s); return s; };
  for (const p of ps) countDesc(p.id);
  function hasEntry(p) { const d = p.data; return (kids.get(p.id) || []).length || d.spouse || d.born || d.died || d.death_lunar || d.gio_lunar || d.place || d.alias || d.note || d.verify || d.photo; }
  const kids2 = new Map(); for (const p of ps) if (p.data.other_parent) { if (!kids2.has(p.data.other_parent)) kids2.set(p.data.other_parent, []); kids2.get(p.data.other_parent).push(p); }
  // Everyone in tree order: each bloodline person, then the people married into them. Lists, counts and exports use this.
  const everyone = []; const seen = new Set();
  const put = (p) => { if (!seen.has(p.id)) { seen.add(p.id); everyone.push(p); } };
  for (const p of queue) { put(p); for (const s of inl.get(p.id) || []) put(s); }
  for (const p of all) put(p);
  return { ps, all, everyone, inlaws: (id) => inl.get(id) || [], kidsOf2: (id) => kids2.get(id) || [], byId, kids: (id) => kids.get(id) || [], roots, reg, dab, desc: (id) => desc.get(id) || 0, generations: queue };
}

export const rank = (d) => (d.sex === 'f' ? 'Bà' : 'Ông') + (d.thu ? ' ' + d.thu : '');
// Compact approximate years: a stored "khoảng 1780" / "about 1780" reads "~1780" (one formatter; the sentences keep "khoảng").
export const approxYear = (v) => String(v ?? '').replace(/^\s*(khoảng|khoang|about)\s*/i, '~');
export const years = (d) => {
  const b = d.born ? approxYear(d.born) : ''; const dd = d.died ? approxYear(d.died) : '';
  return b && dd ? `${b}–${dd}` : b ? `sinh ${b}` : dd ? `mất ${dd}` : '';
};
// The same text as HTML: an approximate value is a role="img" with the spoken label "khoảng …" (screen readers skip the "~").
export const yearsHtml = (d) => {
  const t = years(d);
  return /~/.test(t) ? `<span role="img" aria-label="${esc(t.replace(/~/g, 'khoảng '))}">${esc(t)}</span>` : esc(t);
};
export const parentOf = (m, p) => m.byId.get(p.data.parent);
export const relation = (m, p) => { const q = parentOf(m, p); return q ? `con ${q.data.sex === 'f' ? 'bà' : 'ông'} ${q.data.name}` : ''; };
export const isDead = (d) => d.living === 'dead' || !!(d.died || d.death_lunar || d.gio_lunar);
export function gioOf(d) { const s = d.gio_lunar || d.death_lunar; if (!s) return null; const [dd, mm] = s.split('/').map((x) => parseInt(x, 10)); return dd && mm ? { d: dd, m: mm, label: s } : null; }
// A person married in (spouse_of) has no parent or Đời of their own: for filters and counts they take both from their spouse.
export const baseOf = (m, p) => (p.data.spouse_of && m.byId.get(p.data.spouse_of)) || p;
export const genOf = (m, p) => baseOf(m, p).data.gen;
// Chi filter: true when chiId is the person's branch or any ancestor of it (empty chiId = no filter).
export function inChi(m, p, chiId) { if (!chiId) return true; let x = baseOf(m, p); while (x) { if (x.id === chiId) return true; x = m.byId.get(x.data.parent); } return false; }
export function lineage(m, p) { const out = []; let q = p; while (q) { out.unshift(q); q = parentOf(m, q); } return out; }
// "vợ 1: Nguyễn Thị A (1920, Củ Chi); vợ 2: B" -> [{ name, note, n }]
export function spousesOf(d) {
  if (!d.spouse) return [];
  return d.spouse.split(/;(?![^(]*\))/).map((s, i) => { const [nm, ...rest] = s.trim().split('('); return { n: i + 1, name: nm.replace(/^(vợ|chồng|ông|bà)\s*\d*\s*:?\s*/iu, '').trim(), note: rest.join('(').replace(/\)\s*$/, '').trim() }; })
    .filter((x) => x.name && !/^(chưa rõ|không rõ|\?|có|không|rồi|đã mất)$/iu.test(x.name));
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
