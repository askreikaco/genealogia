// Estimated birth and death years for EVERY person of a family at once (pure rules, no DOM, no DB). Replaces the
// single-person estimator of PR #54 (events-estimate.js, removed). Tested in server/test/estimate-graph.test.js.
//
// Each person has born:[lo,hi] and died:[lo,hi] (years, open = unbounded). Constraints are interval bounds on the
// difference of two people's years (x − y ∈ [dmin,dmax]); they are applied both ways until nothing changes (at most
// PASSES passes). Intervals only ever narrow, so a known date always wins and nothing is written back to born/died.
//   seeds        known born/died (exact, or ±APPROX_SPAN for "khoảng"); own dated events and years in the note
//                (alive at that year); "mất lúc N tuổi" (died − born = N); living 'living' (no death); years ≤ today
//   parent→child child − father ∈ [15,50], child − mother ∈ [15,45] (unknown sex [15,50]);
//                child born ≤ mother's death; ≤ father's death + 1 (a known sex only)
//   spouses      |born − born| ≤ 20;  siblings (same parent)  |born − born| ≤ 25
//   death        died − born ∈ [0,100] for a person not living
//   generation   25–30 years per generation from the nearest relative with both bounds; ONLY for a person whose
//                birth is still wholly open after the other rules (the weakest rule)
// Deceased by rule: not known dead, not living, and born more than 110 years ago (the rule of events-life.js).
// Basis: short Vietnamese text per bound (which relative, which rule); hops: edges from the nearest seed.
import { birthIso, isoOfDied } from './events.js';

export const PASSES = 20;
export const APPROX_SPAN = 5; // "khoảng 1780" = 1775–1785
export const SHOW_MAX_WIDTH = 60; // an estimate is shown (profile, tree, lists, needs) only when its range is at most this many years
const INF = Infinity;
const MAX_BASIS = 3;

const yr = (iso) => (iso ? Number(String(iso).slice(0, 4)) : null);
const YEAR_RE = /(?<!\d)(1[0-9]{3}|20[0-9]{2})(?!\d)/g;
const APPROX = (s) => /^~|khoảng/i.test(String(s || ''));
const fin = (f) => f.lo > -INF && f.hi < INF;
const span = (r) => (r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`);
const cap = (list) => [...new Set(list.filter(Boolean))].slice(0, MAX_BASIS);

// Years written in a note: "được cấp đất sau 1802", "năm 1972 vào Nam".
export function noteYears(text) {
  return [...String(text || '').matchAll(YEAR_RE)].map((m) => Number(m[1])).filter((y) => y > 1000 && y < 2100);
}
// "mất lúc 42 tuổi", "mất năm 42 tuổi", "thọ 80 tuổi", "hưởng thọ 80" -> 42 / 80
export function ageAtDeathOf(text) {
  const m = /(?:mất|qua đời|từ trần)\s+(?:lúc|năm|khi)?\s*(\d{1,3})\s*tuổi|(?:hưởng\s+)?thọ\s+(\d{1,3})/i.exec(String(text || ''));
  const n = m ? Number(m[1] || m[2]) : null;
  return n && n > 0 && n < 120 ? n : null;
}

// A bound with the hop it came from and the basis texts that explain it.
const field = () => ({ lo: -INF, hi: INF, hl: INF, hh: INF, bl: [], bh: [] });
// A bound keeps the rule that moved it (the relative and the rule, not the whole chain: the hop count says how far).
function setLo(f, v, hop, why) { if (!(v > f.lo)) return false; f.lo = v; f.hl = hop; f.bl = [why]; return true; }
function setHi(f, v, hop, why) { if (!(v < f.hi)) return false; f.hi = v; f.hh = hop; f.bh = [why]; return true; }

// X − Y ∈ [dmin,dmax], applied both ways. whyX is the basis text of a bound on X, whyY of a bound on Y.
// Returns true when a bound moved.
function link(X, Y, dmin, dmax, whyX, whyY = whyX) {
  let ch = false;
  ch = setLo(X, Y.lo + dmin, Y.hl + 1, whyX) || ch;
  ch = setHi(X, Y.hi + dmax, Y.hh + 1, whyX) || ch;
  ch = setLo(Y, X.lo - dmax, X.hl + 1, whyY) || ch;
  ch = setHi(Y, X.hi - dmin, X.hh + 1, whyY) || ch;
  return ch;
}

// persons: Map id -> data. R: { parents(id), children(id), partners(id) -> [{ id }] } (relAccess / legacyAccess).
// eventsOf(id): the person's stored events. today: ISO date (tests pass a fixed one).
// Returns Map id -> estimate for every person in persons:
//   { id, bornKnown, diedKnown, born:[lo,hi]|null, died:[lo,hi]|null, from, to, label:{born,died}, confidence,
//     conflict, bornBasis, diedBasis, diedEvidence, basis, hops, living, dead, ruleDead, genFallback }
// A person with no estimated bound has born and died null. conflict: lo > hi, the intervals are kept as they are.
export function estimateFamily(persons, R, { eventsOf = () => [], today = null } = {}) {
  const todayY = today ? yr(today) : new Date().getUTCFullYear();
  const st = new Map(); const edges = []; const flags = new Map();
  const nm = (pid) => (persons.get(pid) || {}).name || '';
  const sexOf = (pid) => (persons.get(pid) || {}).sex;
  const livingOf = (pid) => (persons.get(pid) || {}).living === 'living';
  for (const [id, d] of persons) {
    const ageD = ageAtDeathOf(d.note);
    const knownDead = !!(d.died || d.living === 'dead' || d.gio_lunar || d.death_lunar || ageD);
    st.set(id, { born: field(), died: field() });
    flags.set(id, { living: livingOf(id), knownDead, ageD, bornKnown: false, diedKnown: false, genFallback: false, lastOwn: -INF });
  }
  const seedBorn = (id, lo, hi, why) => { const s = st.get(id); setLo(s.born, lo, 0, why); setHi(s.born, hi, 0, why); };
  const seedDied = (id, lo, hi, why) => { const s = st.get(id); setLo(s.died, lo, 0, why); setHi(s.died, hi, 0, why); };
  const bornHi = (id, y, why) => setHi(st.get(id).born, y, 0, why);
  const diedLo = (id, y, why) => setLo(st.get(id).died, y, 0, why);

  for (const [id, d] of persons) {
    const f = flags.get(id); const s = st.get(id);
    const b = yr(birthIso(d));
    if (b) { const a = APPROX(d.birth_date || d.born) ? APPROX_SPAN : 0; seedBorn(id, b - a, b + a, `năm sinh ${b}`); f.bornKnown = true; }
    const dd = yr(isoOfDied(d.died));
    if (dd && !f.living) { const a = APPROX(d.died) ? APPROX_SPAN : 0; seedDied(id, dd - a, dd + a, `năm mất ${dd}`); f.diedKnown = true; }
    if (!f.living) setHi(s.died, todayY, 0, 'đến hôm nay');
    setHi(s.born, todayY, 0, 'đến hôm nay');
    // own dated events: a birth or a death fixes its year; any other event means alive at it
    for (const e of eventsOf(id) || []) {
      const y0 = yr(e.date_from); if (!y0) continue; const y1 = yr(e.date_to) || y0;
      const dated = e.date_kind === 'exact' || e.date_kind === 'about' || e.date_kind === 'between';
      if (e.type === 'sinh' && dated) seedBorn(id, Math.min(y0, y1), Math.max(y0, y1), `sự kiện sinh năm ${span([y0, y1])}`);
      else if (e.type === 'mat' && dated) { seedDied(id, Math.min(y0, y1), Math.max(y0, y1), `sự kiện mất năm ${span([y0, y1])}`); bornHi(id, y0, `sự kiện mất năm ${y0}`); }
      else { bornHi(id, y0, `sự kiện năm ${y0}: còn sống`); if (!f.living) diedLo(id, y1, `sự kiện năm ${y1}: còn sống`); }
    }
    // years written in the note: alive at each of them
    const ny = noteYears(d.note);
    if (ny.length) { bornHi(id, Math.min(...ny), `ghi chú năm ${Math.min(...ny)}`); if (!f.living) diedLo(id, Math.max(...ny), `ghi chú năm ${Math.max(...ny)}`); }
    // the last own event (or year in the note) : the life is not over before it (the deceased rule below)
    f.lastOwn = Math.max(f.lastOwn, ...ny, ...(eventsOf(id) || []).map((e) => yr(e.date_to) || yr(e.date_from) || -INF));
    if (!f.living) {
      if (f.ageD) edges.push({ x: s.died, y: s.born, dmin: f.ageD, dmax: f.ageD, whyX: `mất lúc ${f.ageD} tuổi`, whyY: `mất lúc ${f.ageD} tuổi` });
      edges.push({ x: s.died, y: s.born, dmin: 0, dmax: 100, whyX: 'sống tối đa 100 năm', whyY: 'sống tối đa 100 năm' });
    }
  }

  // parent -> child, child -> parent death bounds, spouses, siblings
  const seen = new Set();
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const [c, cd] of persons) {
    const cs = st.get(c);
    for (const p of R.parents(c) || []) {
      if (p === c || !persons.has(p)) continue;
      const ps = sexOf(p); const who = ps === 'f' ? 'mẹ' : ps === 'm' ? 'cha' : 'cha/mẹ';
      const hi = ps === 'f' ? 45 : 50;
      edges.push({ x: cs.born, y: st.get(p).born, dmin: 15, dmax: hi, whyX: `${who} ${nm(p)}: con sinh ${15}–${hi} năm sau`, whyY: `con ${nm(c)}: ${who} sinh ${15}–${hi} năm trước con` });
      if (ps === 'f' && !livingOf(p)) edges.push({ x: cs.born, y: st.get(p).died, dmin: -INF, dmax: 0, whyX: `mẹ ${nm(p)} còn sống khi con sinh`, whyY: `con ${nm(c)} sinh trước khi mẹ mất` });
      if (ps === 'm' && !livingOf(p)) edges.push({ x: cs.born, y: st.get(p).died, dmin: -INF, dmax: 1, whyX: `cha ${nm(p)} còn sống khi con sinh`, whyY: `con ${nm(c)} sinh trước khi cha mất` });
    }
    for (const q of R.partners(c) || []) {
      if (!persons.has(q.id) || q.id === c || seen.has(pairKey(c, q.id))) continue;
      seen.add(pairKey(c, q.id));
      edges.push({ x: cs.born, y: st.get(q.id).born, dmin: -20, dmax: 20, whyX: `vợ/chồng ${nm(q.id)}: sinh cách nhau ≤ 20 năm`, whyY: `vợ/chồng ${nm(c)}: sinh cách nhau ≤ 20 năm` });
    }
  }
  for (const [p] of persons) {
    const kids = (R.children(p) || []).filter((k) => persons.has(k));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const [a, b] = [kids[i], kids[j]];
      if (seen.has(pairKey(a, b))) continue; seen.add(pairKey(a, b));
      edges.push({ x: st.get(a).born, y: st.get(b).born, dmin: -25, dmax: 25, whyX: `anh chị em ${nm(b)}: sinh cách nhau ≤ 25 năm`, whyY: `anh chị em ${nm(a)}: sinh cách nhau ≤ 25 năm` });
    }
  }

  const run = () => { for (let pass = 0; pass < PASSES; pass++) { let ch = false; for (const e of edges) ch = link(e.x, e.y, e.dmin, e.dmax, e.whyX, e.whyY) || ch; if (!ch) break; } };
  run();

  // generation fallback: a person whose birth is still wholly open takes 25–30 years per generation from the nearest
  // relative with a bounded birth (nearest by generation number, then the narrower one)
  const gen = (pid) => { const g = Number((persons.get(pid) || {}).gen); return Number.isFinite(g) && g > 0 ? g : null; };
  const anchors = [...st].filter(([pid, s]) => fin(s.born) && gen(pid) !== null).map(([pid]) => pid);
  const fallback = [];
  for (const [id, s] of st) {
    // open: no bound but the cap at today (set for everyone above)
    if (gen(id) === null || s.born.lo > -INF || s.born.hi !== todayY) continue;
    let best = null;
    for (const oid of anchors) {
      if (oid === id) continue;
      const g = gen(id) - gen(oid); if (!g) continue;
      const w = st.get(oid).born.hi - st.get(oid).born.lo;
      if (!best || Math.abs(g) < Math.abs(best.g) || (Math.abs(g) === Math.abs(best.g) && w < best.w)) best = { oid, g, w };
    }
    if (best) fallback.push({ id, best });
  }
  for (const { id, best } of fallback) {
    const a = 25 * best.g; const b = 30 * best.g;
    const why = `đời ${gen(id)}, gần nhất có năm sinh: ${nm(best.oid)} (đời ${gen(best.oid)}): 25–30 năm mỗi đời`;
    link(st.get(id).born, st.get(best.oid).born, Math.min(a, b), Math.max(a, b), why, why);
    flags.get(id).genFallback = true;
  }
  run();

  // output
  const out = new Map();
  for (const [id, s] of st) {
    const f = flags.get(id); const d = persons.get(id);
    const born = fin(s.born) ? [s.born.lo, s.born.hi] : null;
    const ruleDead = !f.living && !f.knownDead && !!born && born[1] < todayY - 110;
    let died = !f.living && fin(s.died) ? [s.died.lo, s.died.hi] : null;
    if (ruleDead) {
      // the existing deceased rule (events-life.js lifeWindow): the life ends at the later of the last own event and
      // 60 years after birth, never after today; kept inside the propagated death interval when they overlap
      const lo = Math.min(todayY, Math.max(f.lastOwn, born[0] + 60)); const hi = Math.min(todayY, Math.max(f.lastOwn, born[1] + 60));
      const a = Math.max(lo, died ? died[0] : -INF); const b = Math.min(hi, died ? died[1] : INF);
      if (a <= b) died = [a, b];
    }
    const conflict = (s.born.lo > s.born.hi) || (s.died.lo > s.died.hi);
    // a single year per side only when the intervals agree (a conflict keeps the intervals, never one guessed year)
    const from = born && !conflict ? Math.round((born[0] + born[1]) / 2) : null;
    let to = died && !conflict ? Math.round((died[0] + died[1]) / 2) : null;
    if (from !== null && to !== null) to = Math.max(to, from + 1);
    const hops = Math.min(...[s.born.hl, s.born.hh, s.died.hl, s.died.hh].filter((h) => h < INF), INF);
    const width = Math.min(born ? born[1] - born[0] : INF, died ? died[1] - died[0] : INF);
    const confidence = width <= 15 && hops <= 2 && !f.genFallback ? 'high' : width <= 30 && !f.genFallback ? 'medium' : 'low';
    const bornBasis = cap([...s.born.bl, ...s.born.bh]);
    // evidence for the death year: a bound from another rule (relatives, own events, notes, age at death). The lifespan
    // default (100 years, "đến hôm nay", the rule of 110 years) is not evidence: a death range without it is not shown.
    const lifespanOnly = (t) => t === 'đến hôm nay' || t === 'sống tối đa 100 năm';
    const diedEvidence = [...s.died.bl, ...s.died.bh].some((t) => !lifespanOnly(t)) || f.lastOwn > -INF || !!f.ageD;
    const diedBasis = cap([...(ruleDead ? ['quy tắc: sinh hơn 110 năm trước, không ghi nhận còn sống → mất ≈ sinh + 60 năm'] : []), ...s.died.bl, ...s.died.bh]);
    out.set(id, {
      id, bornKnown: f.bornKnown, diedKnown: f.diedKnown, born, died, from: from === null ? null : String(from),
      to: to === null ? null : String(to), label: { born: born ? span(born) : '', died: died ? span(died) : '' },
      confidence, conflict, bornBasis, diedBasis, basis: cap([...bornBasis, ...diedBasis]), hops: hops === INF ? null : hops,
      living: f.living, dead: f.knownDead, ruleDead, diedEvidence, genFallback: f.genFallback, name: d.name || '',
    });
  }
  return out;
}

// Same estimate for a family, memoized: recomputed only when the persons, relations or stored events change (signature).
const memo = new Map();
export function estimateFamilyCached(key, persons, R, opts = {}) {
  const parts = [];
  for (const [id, d] of persons) {
    parts.push([id, d.born ?? '', d.birth_date ?? '', d.died ?? '', d.living ?? '', d.sex ?? '', d.gen ?? '', d.note ?? '', d.gio_lunar ?? '', d.death_lunar ?? '', d.name ?? '',
      (R.parents(id) || []).join(','), (R.children(id) || []).join(','), (R.partners(id) || []).map((p) => p.id).join(','),
      ((opts.eventsOf || (() => []))(id) || []).map((e) => `${e.type}:${e.date_kind}:${e.date_from}:${e.date_to}`).join(',')].join('\u0001'));
  }
  const sig = `${opts.today ? yr(opts.today) : ''}\u0002${parts.join('\u0002')}`;
  const hit = memo.get(key);
  if (hit && hit.sig === sig) return hit.out;
  const out = estimateFamily(persons, R, opts);
  memo.set(key, { sig, out });
  if (memo.size > 50) memo.delete(memo.keys().next().value);
  return out;
}

// The summary of one person as Dòng đời and the profile use it: null when both years are known, or nothing is estimated.
export function estimateLife(id, persons, R, opts = {}) {
  const r = estimateFamily(persons, R, opts).get(id);
  if (!r || (r.bornKnown && r.diedKnown) || (!r.born && !r.died)) return null;
  return r;
}
