// Life events derived from the tree for one person's Dòng đời (never stored). Pure rules, no DOM, no DB.
// Tested in server/test/events-life.test.js.
//
// Groups (each one a switch in the timeline filter):
//   self   own birth and death (anchors), own marriages
//   family father's and mother's death, spouse's death, younger siblings' births
//   desc   children's births, marriages and deaths; grandchildren's births
// Only events inside the person's lifetime are kept: birth .. death. Without a death date the end is today while living.
// A deceased person with no death date (living 'dead', or born more than 110 years ago) ends at the later of their own
// last event and 60 years after birth, never after today, so no history or relatives' events pile up to today. With no birth date,
// the window opens 15 years before the earliest known event. A stored event of the same type and year wins
// (no duplicate). Every derived row points at the person it is about (person_id), and follows that person's
// privacy: visible(data) false -> left out (living relatives are for members only).
import { historyItems, KEY_HISTORY } from './events-history.js';
import { startDays, endDays, eventDays, birthIso, isoOfDied } from './events.js';

const nm = (d) => (d && d.name) || '';
const yearOf = (iso) => (iso ? Number(String(iso).slice(0, 4)) : null);

// Relation access from the relation table index (relgraph index()): ids only.
export function relAccess(ix) {
  if (!ix) return null;
  return {
    parents: (id) => (ix.parentsOf.get(id) || []).map((r) => r.parent_id),
    children: (id) => (ix.childrenOf.get(id) || []).map((r) => r.child_id),
    partners: (id) => (ix.partnersOf.get(id) || []).map((p) => ({ id: p.other, start_year: p.row.start_year ?? null, kind: p.row.kind || '' })),
  };
}

// Families still on the old fields: parent / other_parent, spouse_of (a married-in person points at the bloodline person).
export function legacyAccess(persons) {
  const kids = new Map();
  for (const [id, d] of persons) for (const p of [d.parent, d.other_parent]) if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(id); }
  return {
    parents: (id) => { const d = persons.get(id); return d ? [d.parent, d.other_parent].filter(Boolean) : []; },
    children: (id) => kids.get(id) || [],
    partners: (id) => {
      const d = persons.get(id); if (!d) return [];
      const hub = d.spouse_of || id; const out = [];
      for (const [sid, sd] of persons) if (sid !== id && (sid === hub || sd.spouse_of === hub)) out.push({ id: sid, start_year: null, kind: '' });
      return out;
    },
  };
}

// Death of a record as an event date: died "1990" or "5/3/1990"; no year -> null.
function deathEv(d) {
  if (!d) return null;
  const iso = isoOfDied(d.died);
  return iso ? { date_kind: d.died && /^~|khoảng/i.test(String(d.died)) ? 'about' : 'exact', date_from: iso } : null;
}
function birthEv(d) {
  const iso = birthIso(d);
  if (!iso) return null;
  return { date_kind: /^~|khoảng/i.test(String(d.born || '')) ? 'about' : 'exact', date_from: iso };
}

// persons: Map id -> data. rel: relAccess(ix) for relation-table families, else null (old fields).
// eventsOf(id): stored events of that person. visible(data): may this viewer see that person's facts.
// today: ISO date for the window end of a living person (tests pass a fixed one).
export function deriveLifeEvents(personId, persons, { rel = null, eventsOf = () => [], visible = () => true, today = null } = {}) {
  const me = persons.get(personId); if (!me) return [];
  const R = rel || legacyAccess(persons);
  const out = [];
  const add = (group, type, label, otherId, ev) => {
    if (!ev || !ev.date_from) return;
    const od = persons.get(otherId);
    if (otherId !== personId && (!od || !visible(od))) return;
    out.push({ id: `d:${group}:${type}:${otherId}:${ev.date_from}`, derived: true, group, type, person_id: otherId, label,
      date_kind: ev.date_kind || 'exact', date_from: ev.date_from, date_to: ev.date_to || null, place: ev.place || '' });
  };
  const kin = (d, m, f) => (d && d.sex === 'f' ? f : m);

  // self
  const myBirth = birthEv(me); const myDeath = deathEv(me);
  if (myBirth) add('self', 'sinh', 'Ra đời', personId, myBirth);
  if (myDeath) add('self', 'mat', 'Mất', personId, myDeath);
  for (const p of R.partners(personId)) {
    const pd = persons.get(p.id); if (!pd) continue;
    if (p.start_year) add('self', 'cuoi', `Kết hôn với ${nm(pd)}`, p.id, { date_kind: 'exact', date_from: String(p.start_year) });
    const dd = deathEv(pd); if (dd) add('family', 'mat', `${kin(pd, 'Chồng', 'Vợ')} ${nm(pd)} mất`, p.id, dd);
  }
  // family: parents' deaths, younger siblings' births
  const parents = R.parents(personId);
  for (const pid of parents) {
    const pd = persons.get(pid); const dd = deathEv(pd);
    if (dd) add('family', 'mat', `${kin(pd, 'Cha', 'Mẹ')} ${nm(pd)} mất`, pid, dd);
  }
  const myDays = myBirth ? startDays(myBirth.date_from) : null;
  if (myDays !== null) {
    const sibs = new Set(); for (const pid of parents) for (const c of R.children(pid)) if (c !== personId) sibs.add(c);
    for (const sid of sibs) {
      const sd = persons.get(sid); const b = birthEv(sd);
      if (b && startDays(b.date_from) > myDays) add('family', 'sinh', `${kin(sd, 'Em trai', 'Em gái')} ${nm(sd)} ra đời`, sid, b);
    }
  }
  // descendants: children (birth, marriage, death), grandchildren (birth)
  for (const cid of R.children(personId)) {
    const cd = persons.get(cid); if (!cd) continue;
    add('desc', 'sinh', `Con ${nm(cd)} ra đời`, cid, birthEv(cd));
    add('desc', 'mat', `Con ${nm(cd)} mất`, cid, deathEv(cd));
    const wed = (eventsOf(cid) || []).find((e) => e.type === 'cuoi' && e.date_from && !e.derived);
    if (wed) add('desc', 'cuoi', `Con ${nm(cd)} kết hôn`, cid, wed);
    else { const p = R.partners(cid).find((x) => x.start_year); if (p) add('desc', 'cuoi', `Con ${nm(cd)} kết hôn`, cid, { date_kind: 'exact', date_from: String(p.start_year) }); }
    for (const gid of R.children(cid)) {
      const gd = persons.get(gid); if (!gd) continue;
      add('desc', 'sinh', `Cháu ${nm(gd)} ra đời · con của ${nm(cd)}`, gid, birthEv(gd));
    }
  }

  // de-duplicate: one row per id; a stored event of the same type and year on the same person wins
  const stored = (eventsOf(personId) || []).filter((e) => !e.derived);
  const seen = new Set();
  const uniq = out.filter((e) => {
    if (seen.has(e.id)) return false; seen.add(e.id);
    if (e.person_id === personId && stored.some((s) => s.type === e.type && yearOf(s.date_from) === yearOf(e.date_from))) return false;
    return true;
  });
  return inLifetime(uniq, me, { today, stored });
}

// End day of the person's own recorded death: a stored (not derived) 'mat' event with a date. Derived rows of
// relatives are derived:true, so they never count. Earliest end wins when there are several. null when none.
function recordedDeathEnd(events) {
  const ends = events.filter((e) => !e.derived && e.type === 'mat' && e.date_from)
    .map((e) => endDays(e.date_to || e.date_from)).filter((x) => x !== null);
  return ends.length ? Math.min(...ends) : null;
}

// The lifetime window [from, to] in day numbers. Self anchors always stay.
export function lifeWindow(me, { today = null, events = [] } = {}) {
  const b = birthEv(me); const d = deathEv(me);
  let from = b ? startDays(b.date_from) : null;
  if (from === null) {
    const days = events.map(eventDays).filter((x) => x !== null);
    from = days.length ? Math.min(...days) - Math.round(15 * 365.2425) : null;
  }
  const todayDays = startDays(today || new Date().toISOString().slice(0, 10));
  // A death date (died) wins; else the recorded death event; else the deceased-without-date rule below.
  const recorded = d ? null : recordedDeathEnd(events);
  let end = d ? endDays(d.date_from) : (recorded !== null ? recorded : todayDays);
  const deceased = me.living === 'dead' || (from !== null && from < todayDays - Math.round(110 * 365.2425));
  if (!d && recorded === null && deceased) {
    const own = events.filter((e) => !e.derived || e.group === 'self').map(eventDays).filter((x) => x !== null);
    if (from !== null) own.push(from + Math.round(60 * 365.2425));
    if (own.length) end = Math.min(todayDays, Math.max(...own));
  }
  return { from, to: end };
}
function inLifetime(rows, me, { today, stored }) {
  const w = lifeWindow(me, { today, events: [...stored, ...rows.filter((r) => r.group !== 'self')] });
  return rows.filter((r) => {
    if (r.group === 'self' && (r.type === 'sinh' || r.type === 'mat')) return true;
    const x = eventDays(r); if (x === null) return false;
    return (w.from === null || x >= w.from) && (w.to === null || x <= w.to);
  });
}

// Historical context rows from a pack (events-history.js), inside the lifetime window only: era/reign bands, war
// start/end rows, single events. Marked group 'hist' (never counted as family events).
// window: { from, to } years/ISO to use instead of the lifetime (an estimated life, estimate-graph.js).
export function historyRows(me, pack, { today = null, events = [], regions = ['vn', 'world'], all = false, window = null } = {}) {
  const w = window ? { from: startDays(window.from), to: endDays(window.to) } : lifeWindow(me, { today, events });
  if (w.from === null || w.to === null) return [];
  const inside = (iso) => { const x = startDays(iso); return x !== null && x >= w.from && x <= w.to; };
  const overlaps = (a, b) => { const s = startDays(a); const e = endDays(b); return s !== null && e !== null && s <= w.to && e >= w.from; };
  const lifeStartYear = new Date(w.from * 864e5).getUTCFullYear();
  const clampStart = (a) => (startDays(a) < w.from ? String(lifeStartYear) : a);
  return historyItems(pack.filter((h) => regions.includes(h.region) && (all || KEY_HISTORY.has(h.id))), { inside, overlaps, clampStart })
    .map((r) => ({ ...r, derived: true, group: 'hist', type: 'khac', person_id: null }));
}

// Auto rows for an estimated life (never stored): "Sinh (ước tính)" when the birth year is missing, and "Mất (ước tính)"
// when the person is dead or deceased by rule and the death year is missing. est: estimate-graph.js summary of this
// person. A stored birth or death of the same type replaces the row. Each row: group 'self', estimated, range "a–b".
export function estimatedLifeRows(personId, est, stored = []) {
  if (!est || est.conflict) return [];
  const has = (t) => stored.some((s) => s.type === t && !s.derived);
  const row = (type, label, r, basis) => ({
    id: `est:${type}:${personId}`, derived: true, estimated: true, group: 'self', type, label, person_id: personId,
    date_kind: 'between', date_from: String(r[0]), date_to: String(r[1]), date_text: '', place: '',
    range: r[0] === r[1] ? String(r[0]) : `${r[0]}–${r[1]}`, mid: Math.round((r[0] + r[1]) / 2), basis: basis || [],
  });
  const out = [];
  if (!est.bornKnown && est.born && !has('sinh')) out.push(row('sinh', 'Sinh (ước tính)', est.born, est.bornBasis));
  if (!est.diedKnown && est.died && (est.dead || est.ruleDead) && !has('mat')) out.push(row('mat', 'Mất (ước tính)', est.died, est.diedBasis));
  return out;
}
