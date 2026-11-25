// "Có thể là cùng một người": pure scoring of a person pair across two family trees (no DB, no express). Tested in
// test/match-rules.test.js. Suggestions only: a score never links anything; a person still proposes the link and the
// other tree still accepts it (links-routes.js).
// Score 0..1 from: the name (surname and given name must match after folding accents/đ; middle name adds or costs),
// sex, birth and death years (tolerance grows when a year is approximate), parents' and spouses' names, and shared
// places (a place id from person_places, else the same folded place text). A year that clearly disagrees costs more
// than any agreement gives, so namesakes of different generations stay far below the bar.
// Scale: blocking keys (surname | given name | birth decade) so a pair of trees compares only people who could match,
// never every person with every person.
'use strict';

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const APPROX = /kho[aả]ng|~|\bk\.|\bc\.|ước|uoc|chừng|chung|trước|truoc|sau\b/i;
const yearOf = (v) => { const m = /(\d{4})/.exec(String(v || '')); return m ? Number(m[1]) : null; };
const MIN = 0.8; // stored suggestions start here
const SR = require('./surname-rules');

// Aliases (surname-rules.js names[]): every name a person carried (birth, changed, aka) is a second context of the same
// person, with its own surname and the years it was used (alias.win). Only names that differ from the primary name count.
// A context is compared only when its years overlap the other person's life (scorePair), so a surname used before
// 1232 never matches someone born after it. Context = toCtx() plus alias: { of, win: { from, to } }.
// The primary name's first word is its surname; the rest (middle name and given name) carries over, with the given
// name replaced when the mark gives one.
function aliasCtxs(id, family, data = {}, extra = {}) {
  const primary = fold(data.name); const toks = String(data.name || '').trim().split(/\s+/).filter(Boolean);
  const seen = new Set([primary]); const out = [];
  for (const e of SR.timelineOf(data)) {
    if (!['birth', 'changed', 'aka'].includes(e.type) || !e.surname) continue;
    const rest = toks.slice(1); const given = String(e.given || '').trim();
    const tail = given ? [...rest.slice(0, -1), given] : rest;
    if (!tail.length) continue;
    const name = [e.surname.trim(), ...tail].join(' ');
    if (seen.has(fold(name))) continue;
    seen.add(fold(name));
    const c = toCtx(id, family, { ...data, name }, extra);
    c.alias = { of: e.surname.trim(), win: { from: SR.yearOf(e.from), to: SR.yearOf(e.to) } };
    out.push(c);
  }
  return out;
}

// One person as the rules see it. data: the person's data; extra: { parents: [name], spouses: [name], places: [placeId] }.
function toCtx(id, family, data = {}, extra = {}) {
  const t = fold(data.name).split(' ').filter(Boolean);
  const bornRaw = data.born || data.birth_date || ''; const diedRaw = data.died || data.death_date || '';
  return {
    id, family, sex: data.sex || '',
    surname: t.length > 1 ? t[0] : '', given: t.length ? t[t.length - 1] : '', middle: t.slice(1, -1).join(' '), full: t.join(' '),
    by: yearOf(bornRaw), byApprox: APPROX.test(String(bornRaw)), dy: yearOf(diedRaw), dyApprox: APPROX.test(String(diedRaw)),
    parents: (extra.parents || []).map(fold).filter(Boolean), spouses: [...(extra.spouses || []), data.spouse || ''].map(fold).filter(Boolean),
    places: new Set((extra.places || []).map(Number).filter(Number.isFinite)),
    placeTexts: [data.place, data.birth_place, data.burial].map(fold).filter((x) => x.length >= 3),
  };
}

// Years: same = full weight, 1 apart = 3/4, inside the tolerance = 2/5, beyond = a penalty.
function yearPart(a, b, aApprox, bApprox, w, penalty, label, out) {
  if (a == null || b == null) return 0;
  const diff = Math.abs(a - b); const tol = aApprox || bApprox ? 5 : 2;
  if (diff === 0) { out.push(`cùng năm ${label} ${a}`); return w; }
  if (diff === 1) { out.push(`năm ${label} lệch 1 (${a}, ${b})`); return w * 0.75; }
  if (diff <= tol) { out.push(`năm ${label} gần nhau (${a}, ${b})`); return w * 0.4; }
  out.push(`năm ${label} khác xa (${a}, ${b})`); return -penalty;
}
// Names of relatives: the same full name counts most; the same given name a little.
function overlap(xs, ys, wFull, wGiven, label, out) {
  if (!xs.length || !ys.length) return 0;
  const full = xs.find((x) => ys.includes(x));
  if (full) { out.push(`cùng tên ${label}`); return wFull; }
  const g = (s) => s.split(' ').pop();
  const giv = xs.find((x) => ys.some((y) => g(y) === g(x)));
  if (giv) { out.push(`${label} trùng tên gọi`); return wGiven; }
  return 0;
}

// a, b: toCtx() objects. Returns { score 0..1 (2 decimals), reasons: [text] }.
// opts.sameTree: the two people are in one tree (duplicates inside a tree, merge.js); otherwise they must be in two trees.
function scorePair(a, b, opts = {}) {
  const reasons = [];
  if (!a || !b || (a.family === b.family && !opts.sameTree)) return { score: 0, reasons: ['cùng một cây'] };
  for (const [x, y] of [[a, b], [b, a]]) {
    if (x.alias && !SR.windowOverlaps(x.alias.win, { by: y.by, dy: y.dy })) return { score: 0, reasons: ['họ đã dùng không đúng thời kỳ'] };
  }
  if (!a.given || a.given !== b.given) return { score: 0, reasons: ['khác tên'] };
  if (a.surname && b.surname && a.surname !== b.surname) return { score: 0, reasons: ['khác họ'] };
  if (a.sex && b.sex && a.sex !== b.sex) return { score: 0, reasons: ['khác giới tính'] };
  let s = 0.45; reasons.push('cùng họ tên gọi');
  if (a.middle && b.middle) { if (a.middle === b.middle) { s += 0.1; reasons[0] = 'cùng họ tên'; } else { s -= 0.1; reasons.push('tên đệm khác'); } }
  else if (a.full === b.full) { s += 0.1; reasons[0] = 'cùng họ tên'; } else s += 0.05;
  if (a.sex && b.sex) s += 0.05;
  let evidence = 0;
  const yb = yearPart(a.by, b.by, a.byApprox, b.byApprox, 0.2, 0.4, 'sinh', reasons); s += yb; if (yb > 0) evidence++;
  const yd = yearPart(a.dy, b.dy, a.dyApprox, b.dyApprox, 0.1, 0.3, 'mất', reasons); s += yd; if (yd > 0) evidence++;
  const po = overlap(a.parents, b.parents, 0.2, 0.1, 'cha/mẹ', reasons); s += po; if (po > 0) evidence++;
  const so = overlap(a.spouses, b.spouses, 0.15, 0.08, 'vợ/chồng', reasons); s += so; if (so > 0) evidence++;
  let pl = 0;
  if ([...a.places].some((x) => b.places.has(x))) { pl = 0.1; reasons.push('cùng địa danh'); }
  else if (a.placeTexts.some((x) => b.placeTexts.includes(x))) { pl = 0.05; reasons.push('cùng nơi (theo chữ ghi)'); }
  s += pl; if (pl > 0) evidence++;
  if (!evidence) { s = Math.min(s, 0.6); reasons.push('chỉ trùng tên, chưa có gì khác để đối chiếu'); }
  if (a.alias || b.alias) reasons.push(`theo họ đã dùng: ${[a, b].filter((x) => x.alias).map((x) => x.alias.of).join(', ')}`);
  return { score: Math.round(Math.max(0, Math.min(1, s)) * 100) / 100, reasons };
}

// Blocking: key = surname | given name | birth decade ('x' when unknown).
const keyOf = (c) => `${c.surname}|${c.given}|${c.by == null ? 'x' : Math.floor(c.by / 10)}`;
// Candidate pairs between two lists of contexts: same surname + given name, birth decades within one of each other
// (or unknown on one side). Cost ~ the matches found, not |A| x |B|.
function candidatePairs(listA, listB) {
  const byName = new Map(); // surname|given -> Map(decade -> [ctx])
  for (const c of listB) {
    if (!c.given) continue;
    const nk = `${c.surname}|${c.given}`; const dk = c.by == null ? 'x' : Math.floor(c.by / 10);
    if (!byName.has(nk)) byName.set(nk, new Map());
    const m = byName.get(nk); if (!m.has(dk)) m.set(dk, []); m.get(dk).push(c);
  }
  const out = [];
  for (const a of listA) {
    if (!a.given) continue;
    const m = byName.get(`${a.surname}|${a.given}`); if (!m) continue;
    if (a.by == null) { for (const list of m.values()) for (const b of list) out.push([a, b]); continue; }
    const d = Math.floor(a.by / 10);
    for (const k of [d - 1, d, d + 1, 'x']) for (const b of m.get(k) || []) out.push([a, b]);
  }
  return out;
}

// Every candidate pair across ALL trees at once (a married-in person often sits in another surname's tree): people are
// bucketed by surname | given name, and only people of different trees inside one bucket, with compatible birth
// decades, are paired. A bucket larger than `cap` (a very common name with no other key) is skipped and reported.
function allPairs(list, { cap = 400 } = {}) {
  const buckets = new Map();
  for (const c of list) { if (!c.given) continue; const k = `${c.surname}|${c.given}`; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(c); }
  const pairs = []; const skipped = [];
  for (const [k, xs] of buckets) {
    if (xs.length < 2 || new Set(xs.map((x) => x.family)).size < 2) continue;
    if (xs.length > cap) { skipped.push({ key: k, size: xs.length }); continue; }
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
      const a = xs[i]; const b = xs[j];
      if (a.family === b.family || a.id === b.id) continue;
      if (a.by != null && b.by != null && Math.abs(Math.floor(a.by / 10) - Math.floor(b.by / 10)) > 1) continue;
      pairs.push(a.family < b.family || (a.family === b.family && a.id < b.id) ? [a, b] : [b, a]);
    }
  }
  return { pairs, skipped };
}

// Candidate pairs INSIDE one tree: the same blocking as allPairs (surname | given name, birth decades within one), but
// only people of the same tree. Used for "có thể trùng" inside a tree (match-store.js scoreWithin).
function withinPairs(list, { cap = 400 } = {}) {
  const buckets = new Map();
  for (const c of list) { if (!c.given) continue; const k = `${c.surname}|${c.given}`; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(c); }
  const pairs = []; const skipped = [];
  for (const [k, xs] of buckets) {
    if (xs.length < 2) continue;
    if (xs.length > cap) { skipped.push({ key: k, size: xs.length }); continue; }
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
      const a = xs[i]; const b = xs[j];
      if (a.id === b.id) continue; // a person and its own alias
      if (a.by != null && b.by != null && Math.abs(Math.floor(a.by / 10) - Math.floor(b.by / 10)) > 1) continue;
      pairs.push(a.id < b.id ? [a, b] : [b, a]);
    }
  }
  return { pairs, skipped };
}

// Possible duplicates of a person about to be added to one tree (the add flow, web/js/addflow.js): the tree's own
// people scored with the same duplicate rules (sameTree). people: toCtx() contexts of the tree; data: the entered
// { name, sex, born, birth_date, died, death_date }. Best first, at most `limit`, only at or above `min`.
function candidatesFor(people, data = {}, { min = MIN, limit = 5 } = {}) {
  const me = toCtx('', '', data, {});
  const out = [];
  for (const c of people) {
    const r = scorePair(me, c, { sameTree: true });
    if (r.score >= min) out.push({ id: c.id, score: r.score, reasons: r.reasons });
  }
  out.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
  return out.slice(0, limit);
}

module.exports = { fold, toCtx, aliasCtxs, scorePair, candidatePairs, allPairs, withinPairs, candidatesFor, keyOf, MIN };
