// The match job's database side: load people of the trees as match contexts (match-rules.js), score every candidate
// pair across trees, and (with apply) store pairs at or above the bar in match_suggestions. Used by
// scripts/match-run.js and by the tests. Never writes person_links: a suggestion is only a suggestion.
'use strict';
const R = require('./match-rules');

// Contexts of the people of the given families (all families when `fams` is empty). Relatives come from both the
// relation tables (table-mode families) and the legacy fields, so either kind of family is covered.
async function loadPeople(q, fams = []) {
  const where = fams.length ? 'and family_id = any($1)' : '';
  const args = fams.length ? [fams] : [];
  const { rows } = await q.query(`select id, family_id, data from persons where not deleted ${where}`, args);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const nameOf = (id) => byId.get(id)?.data?.name || '';
  const parents = new Map(); const spouses = new Map(); const places = new Map();
  const push = (m, k, v) => { if (!k || !v) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    for (const r of (await q.query('select parent_id, child_id from parent_child where child_id = any($1)', [ids])).rows) push(parents, r.child_id, nameOf(r.parent_id));
    for (const r of (await q.query('select a_id, b_id from couple where a_id = any($1) or b_id = any($1)', [ids])).rows) { push(spouses, r.a_id, nameOf(r.b_id)); push(spouses, r.b_id, nameOf(r.a_id)); }
    try { for (const r of (await q.query('select person_id, place_id from person_places where person_id = any($1)', [ids])).rows) push(places, r.person_id, r.place_id); } catch { /* places tables absent: no place evidence */ }
  }
  for (const r of rows) { // legacy fields: parent / other_parent are ids, spouse_of an id (spouse is a name, read by toCtx)
    push(parents, r.id, nameOf(r.data.parent)); push(parents, r.id, nameOf(r.data.other_parent));
    if (r.data.spouse_of) { push(spouses, r.id, nameOf(r.data.spouse_of)); push(spouses, r.data.spouse_of, r.data.name || ''); }
  }
  const uniq = (xs) => [...new Set(xs || [])];
  return rows.map((r) => R.toCtx(r.id, r.family_id, r.data, { parents: uniq(parents.get(r.id)), spouses: uniq(spouses.get(r.id)), places: uniq(places.get(r.id)) }));
}

// Score all candidate pairs. family: only pairs with one side in that family. Returns { scored: [{a,b,score,reasons}]
// sorted best first, pairs, skipped (oversized buckets), alreadyLinked }.
async function scoreAll(q, { family = '', min = 0 } = {}) {
  const people = await loadPeople(q);
  const { pairs, skipped } = R.allPairs(people);
  const linked = new Set((await q.query("select a_person, b_person from person_links where status <> 'rejected'")).rows.map((r) => [r.a_person, r.b_person].sort().join('|')));
  let alreadyLinked = 0; const scored = [];
  for (const [a, b] of pairs) {
    if (family && a.family !== family && b.family !== family) continue;
    if (linked.has([a.id, b.id].sort().join('|'))) { alreadyLinked++; continue; }
    const r = R.scorePair(a, b);
    if (r.score >= min) scored.push({ a, b, score: r.score, reasons: r.reasons });
  }
  scored.sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id));
  return { people: people.length, pairs: pairs.length, scored, skipped, alreadyLinked };
}

// Candidate pairs of ONE tree: duplicates inside the tree (merge.js). Same scoring; persons of this tree only.
// Returns { scored, skipped } best first; nothing is written here (store() writes).
async function scoreWithin(q, fam, { min = 0 } = {}) {
  const people = await loadPeople(q, [fam]);
  const { pairs, skipped } = R.withinPairs(people);
  const scored = [];
  for (const [a, b] of pairs) {
    const r = R.scorePair(a, b, { sameTree: true });
    if (r.score >= min) scored.push({ a, b, score: r.score, reasons: r.reasons });
  }
  scored.sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id));
  return { scored, skipped };
}

// Store pairs at or above `min` (default MIN). Idempotent: a 'new' row gets the fresh score; a dismissed or linked
// pair keeps its status. Returns { inserted, updated, kept }.
async function store(q, scored, min = R.MIN) {
  let inserted = 0; let updated = 0; let kept = 0;
  for (const s of scored) {
    if (s.score < min) continue;
    const r = await q.query(
      `insert into match_suggestions (a_family, a_person, b_family, b_person, score, reasons)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (least(a_person, b_person), greatest(a_person, b_person)) do update
         set score = excluded.score, reasons = excluded.reasons, computed_at = now()
         where match_suggestions.status = 'new'
       returning (xmax = 0) as fresh`,
      [s.a.family, s.a.id, s.b.family, s.b.id, s.score, JSON.stringify(s.reasons)]);
    if (!r.rowCount) kept++; else if (r.rows[0].fresh) inserted++; else updated++;
  }
  return { inserted, updated, kept };
}

module.exports = { loadPeople, scoreAll, scoreWithin, store };
