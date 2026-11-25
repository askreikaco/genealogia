// Consistency checker (C1): pure rules, no DB, no express. The API (consistency-routes.js) feeds it one tree's
// people, parent-child links, couples and life events, and gets back rule ids only. The UI turns a rule id into the
// Vietnamese text (web/js/consistency-vi.js), so no message text lives on the server.
// Dates: only the year is used (YYYY inside any date string). A person with no year is skipped by a rule that needs it.
'use strict';

const RULE = {
  DEATH_BEFORE_BIRTH: 'death_before_birth',
  PARENT_TOO_YOUNG: 'parent_too_young',
  FATHER_TOO_OLD: 'father_too_old',
  MOTHER_TOO_OLD: 'mother_too_old',
  BORN_AFTER_MOTHER_DEATH: 'born_after_mother_death',
  BORN_AFTER_FATHER_DEATH: 'born_after_father_death',
  MARRIED_TOO_YOUNG: 'married_too_young',
  PROBABLY_DECEASED: 'probably_deceased',
  EVENT_BEFORE_BIRTH: 'event_before_birth',
  EVENT_AFTER_DEATH: 'event_after_death',
  SAME_NAME_SIBLING: 'same_name_sibling',
  SPOUSE_AGE_GAP: 'spouse_age_gap',
};
const SEVERITY = {
  death_before_birth: 'error', parent_too_young: 'error', father_too_old: 'warn', mother_too_old: 'warn',
  born_after_mother_death: 'error', born_after_father_death: 'error', married_too_young: 'error',
  probably_deceased: 'warn', event_before_birth: 'error', event_after_death: 'error',
  same_name_sibling: 'warn', spouse_age_gap: 'warn',
};
// Event types that belong after a death (memorial and burial): never flagged as after-death.
const AFTER_DEATH_OK = new Set(['mat', 'an_tang']);
const LIMITS = { parentMinAge: 12, fatherMaxAge: 70, motherMaxAge: 55, marriedMinAge: 12, oldAge: 110, spouseGap: 40, postDeathYears: 1 };

const yearOf = (v) => { const m = /(\d{4})/.exec(String(v == null ? '' : v)); return m ? Number(m[1]) : null; };
const bornYear = (p) => yearOf(p.born || p.birth_date);
const diedYear = (p) => yearOf(p.died || p.death_date);
const hasDeathMark = (p) => p.living === 'dead' || !!(p.died || p.death_date || p.death_lunar || p.gio_lunar);
const key = (ids) => [...new Set(ids)].sort().join(',');

// persons: [{id, name, sex:'m'|'f'|'', born, birth_date, died, death_date, living, death_lunar, gio_lunar}]
// links: { pc: [{parent_id, child_id}], cp: [{a_id, b_id, start_year}] }   events: [{person_id, type, date_from}]
// now: the current year (passed in so tests are fixed). Returns [{rule, severity, personIds}], one per finding.
function checkTree({ persons = [], links = {}, events = [], now = new Date().getFullYear() } = {}) {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const out = [];
  const add = (rule, personIds) => out.push({ rule, severity: SEVERITY[rule], personIds: [...new Set(personIds)] });
  const parentsOf = new Map(); // child -> [{parent, kind}]
  const childrenOf = new Map(); // parent -> [child]
  for (const r of links.pc || []) {
    if (!byId.has(r.parent_id) || !byId.has(r.child_id)) continue;
    if (!parentsOf.has(r.child_id)) parentsOf.set(r.child_id, []);
    parentsOf.get(r.child_id).push(r.parent_id);
    if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
    childrenOf.get(r.parent_id).push(r.child_id);
  }
  for (const p of persons) {
    const by = bornYear(p); const dy = diedYear(p);
    if (by != null && dy != null && dy < by) add(RULE.DEATH_BEFORE_BIRTH, [p.id]);
    if (by == null) continue;
    if (dy == null && !hasDeathMark(p) && now - by > LIMITS.oldAge) add(RULE.PROBABLY_DECEASED, [p.id]);
    // parents, judged at the child's birth year
    for (const pid of parentsOf.get(p.id) || []) {
      const par = byId.get(pid); if (!par) continue;
      const py = bornYear(par); const pdy = diedYear(par);
      if (py != null && by - py < LIMITS.parentMinAge) add(RULE.PARENT_TOO_YOUNG, [p.id, pid]);
      if (py != null && par.sex === 'm' && by - py > LIMITS.fatherMaxAge) add(RULE.FATHER_TOO_OLD, [p.id, pid]);
      if (py != null && par.sex === 'f' && by - py > LIMITS.motherMaxAge) add(RULE.MOTHER_TOO_OLD, [p.id, pid]);
      if (pdy != null && by > pdy && par.sex === 'f') add(RULE.BORN_AFTER_MOTHER_DEATH, [p.id, pid]);
      if (pdy != null && by > pdy + LIMITS.postDeathYears && par.sex === 'm') add(RULE.BORN_AFTER_FATHER_DEATH, [p.id, pid]);
    }
  }
  // couples: marriage age and age gap
  for (const c of links.cp || []) {
    const a = byId.get(c.a_id); const b = byId.get(c.b_id); if (!a || !b) continue;
    const sy = Number(c.start_year) || null;
    for (const s of [a, b]) {
      const sby = bornYear(s);
      if (sy && sby != null && sy - sby < LIMITS.marriedMinAge) add(RULE.MARRIED_TOO_YOUNG, [s.id]);
    }
    const ay = bornYear(a); const bY = bornYear(b);
    if (ay != null && bY != null && Math.abs(ay - bY) > LIMITS.spouseGap) add(RULE.SPOUSE_AGE_GAP, [a.id, b.id]);
  }
  // life events: before birth, or after death except memorial and burial types
  for (const ev of events) {
    const p = byId.get(ev.person_id); if (!p) continue;
    const ey = yearOf(ev.date_from); if (ey == null) continue;
    const by = bornYear(p); const dy = diedYear(p);
    if (by != null && ey < by) add(RULE.EVENT_BEFORE_BIRTH, [p.id]);
    if (dy != null && ey > dy && !AFTER_DEATH_OK.has(ev.type)) add(RULE.EVENT_AFTER_DEATH, [p.id]);
  }
  // same-name siblings born the same year (possible duplicate)
  for (const [, kids] of childrenOf) {
    const seen = new Map();
    for (const cid of kids) {
      const k = byId.get(cid); const by = bornYear(k); const nm = String(k.name || '').trim().toLowerCase();
      if (!nm || by == null) continue;
      const sk = nm + '|' + by;
      if (seen.has(sk)) add(RULE.SAME_NAME_SIBLING, [seen.get(sk), cid]); else seen.set(sk, cid);
    }
  }
  return out.map((i) => ({ ...i, key: key(i.personIds) }));
}

module.exports = { checkTree, RULE, SEVERITY, LIMITS, yearOf, key };
