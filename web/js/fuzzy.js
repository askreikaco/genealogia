// Fuzzy name matching for giapha (shared by the join step, the type-ahead and list search). Plain ES module, no build.
// Rules: fold accents (NFD, đ -> d), lower-case, split into tokens; order of tokens does not matter; a query may
// miss tokens; a token matches exactly, as a prefix (typing in progress), or with a typo: Damerau-Levenshtein
// distance <= 1 for tokens of 3-5 letters, <= 2 for 6 or more. Aliases count, a little less than the name.

export function foldText(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
}
export function tokens(s) {
  return foldText(s).split(/[^a-z0-9]+/).filter(Boolean);
}

// Optimal string alignment (Damerau-Levenshtein with adjacent transpositions).
export function editDistance(a, b) {
  const n = a.length, m = b.length;
  if (!n) return m; if (!m) return n;
  const d = Array.from({ length: n + 1 }, (_, i) => { const row = new Array(m + 1).fill(0); row[0] = i; return row; });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[n][m];
}
const maxTypo = (len) => (len >= 6 ? 2 : len >= 3 ? 1 : 0);

// How well one query token matches one name token: 1 exact, 0.9 prefix or typo, 0 no match.
export function tokenScore(q, t) {
  if (q === t) return 1;
  if (q.length >= 2 && t.startsWith(q)) return 0.9;
  const k = Math.max(maxTypo(q.length), maxTypo(t.length));
  if (k && Math.abs(q.length - t.length) <= k && editDistance(q, t) <= k) return 0.8;
  return 0;
}

// Score of a person against a query: 0..1, plus which query tokens matched.
export function scorePerson(query, person) {
  const q = tokens(query);
  const d = person?.data || {};
  const name = tokens(d.name);
  const alias = tokens(d.alias);
  if (!q.length) return { score: 0, matched: 0, total: 0 };
  let sum = 0; let matched = 0;
  for (const qt of q) {
    let best = 0;
    for (const t of name) best = Math.max(best, tokenScore(qt, t));
    for (const t of alias) best = Math.max(best, tokenScore(qt, t) * 0.9);
    if (best > 0) { matched++; sum += best; }
  }
  return { score: sum / q.length, matched, total: q.length };
}

// Ranked people for a query. opts.all: every query token must match (type-ahead, list search);
// default: partial matches allowed (join step). Ties: higher score, then closer generation to opts.gen, then name.
export function searchPeople(people, query, opts = {}) {
  const { limit = Infinity, all = false, gen = null } = opts;
  const hits = [];
  for (const p of people) {
    const s = scorePerson(query, p);
    if (!s.matched || (all && s.matched < s.total)) continue;
    hits.push({ p, s });
  }
  const genGap = (p) => (gen == null || p.data?.gen == null ? 0 : Math.abs(p.data.gen - gen));
  hits.sort((a, b) => (b.s.score - a.s.score) || (genGap(a.p) - genGap(b.p)) || String(a.p.data?.name || '').localeCompare(String(b.p.data?.name || ''), 'vi'));
  return hits.slice(0, limit).map((h) => h.p);
}
