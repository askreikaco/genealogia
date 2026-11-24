// Places step 3: look a place up in open data and keep OUR copy. For a place (its names, kind and parents) this asks
// Wikidata (CC0) and, when GEONAMES_USER is set, GeoNames (CC BY 4.0) for candidates, scores them, and turns the best
// one per source into suggestions (an external id, coordinates, more names over time). Suggestions wait for a curator;
// accepting one only fills an EMPTY field or adds a name, never overwrites (places-routes.js). The worker is off unless
// PLACES_ENRICH=1, asks at most one request per second, retries with backoff and gives up after 3 tries.
'use strict';
const R = require('./places-rules');

const LICENCE = { wikidata: 'CC0-1.0', geonames: 'CC-BY-4.0' };
const ATTRIBUTION = { wikidata: 'Wikidata', geonames: 'GeoNames (geonames.org), CC BY 4.0' };
const MIN_CONFIDENCE = 0.6;
const MAX_TRIES = 3;
const UA = 'genealogia-places/1 (self-hosted family tree; contact: instance admin)';

// Administrative words in front of Vietnamese place names: "Xã Bến Lúa" and "Bến Lúa" are the same place.
const PREFIX = /^(tinh|thanh pho|tp|huyen|quan|thi xa|thi tran|xa|phuong|lang|thon|ap|xom|ban|chau|phu|tong|trang|so|dao|dac khu)\s+/;
const core = (s) => { let t = R.fold(s); for (let i = 0; i < 2; i++) t = t.replace(PREFIX, ''); return t; };

// Which external types fit our kinds (English labels from Wikidata, feature codes from GeoNames).
const KIND_WORDS = {
  country: /country|sovereign state/, province: /province|municipality of vietnam|centrally/, district: /district|county|town|city/,
  commune: /commune|ward|township|municipality/, village: /village|hamlet|settlement/, hamlet: /hamlet|village/,
  cemetery: /cemetery/, temple: /temple|pagoda|shrine|church/,
};
const KIND_FCODE = { country: /^PCL/, province: /^ADM1/, district: /^ADM2/, commune: /^ADM3/, village: /^PPL/, hamlet: /^PPL/ };

// '1976-07-02T00:00:00Z' -> '1976-07-02'; 1 January (how year-precision dates come back) -> just the year.
function wdDate(v) {
  const m = /^[+]?(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  if (!m) return null;
  return m[2] === '01' && m[3] === '01' ? m[1] : `${m[1]}-${m[2]}-${m[3]}`;
}

// Score one candidate against our place: name 0.5 / 0.35 / 0.2, kind 0.2, a parent we know 0.2, in Vietnam 0.1.
function score(place, cand) {
  const ours = (place.names || []).map((n) => core(n.name)).filter(Boolean);
  const theirs = [cand.label, ...(cand.names || []).map((n) => n.name)].map(core).filter(Boolean);
  let s = 0;
  if (ours.some((a) => theirs.includes(a))) s += 0.5;
  else if (ours.some((a) => theirs.some((b) => a.startsWith(b) || b.startsWith(a)))) s += 0.35;
  else if (ours.some((a) => theirs.some((b) => a.includes(b) || b.includes(a)))) s += 0.2;
  if (place.kind && cand.kind_hint && cand.kind_hint === place.kind) s += 0.2;
  const parents = (place.parent_names || []).map(core).filter(Boolean);
  if (parents.length && (cand.parent_labels || []).map(core).some((p) => parents.includes(p))) s += 0.2;
  if (cand.in_vn) s += 0.1;
  return Math.round(Math.min(1, s) * 100) / 100;
}

function kindFrom(labels, fcode) {
  if (fcode) for (const [k, re] of Object.entries(KIND_FCODE)) if (re.test(fcode)) return k;
  const t = (labels || []).join(' | ').toLowerCase();
  for (const [k, re] of Object.entries(KIND_WORDS)) if (re.test(t)) return k;
  return null;
}

// ---------- Wikidata ----------
const WD_API = 'https://www.wikidata.org/w/api.php';
const WD_SPARQL = 'https://query.wikidata.org/sparql';
function sparqlFor(ids) {
  return `SELECT ?item ?itemLabel ?typeLabel ?coord ?parentLabel ?country ?name ?from ?to WHERE {
  VALUES ?item { ${ids.map((q) => 'wd:' + q).join(' ')} }
  OPTIONAL { ?item wdt:P31 ?type. }
  OPTIONAL { ?item wdt:P625 ?coord. }
  OPTIONAL { ?item wdt:P131 ?parent. }
  OPTIONAL { ?item wdt:P17 ?country. }
  OPTIONAL { { ?item p:P1448 ?st. ?st ps:P1448 ?name. } UNION { ?item p:P1813 ?st. ?st ps:P1813 ?name. }
             OPTIONAL { ?st pq:P580 ?from. } OPTIONAL { ?st pq:P582 ?to. } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "vi,en". }
}`;
}
async function wikidataCandidates(place, { fetchJson }) {
  const term = (place.names || []).find((n) => n.is_primary && !n.valid_to)?.name || place.names?.[0]?.name;
  if (!term) return [];
  const q = new URLSearchParams({ action: 'wbsearchentities', search: term, language: 'vi', uselang: 'vi', type: 'item', limit: '7', format: 'json' });
  let found = (await fetchJson(`${WD_API}?${q}`)).search || [];
  if (!found.length && core(term) !== R.fold(term)) { // "Xã Bến Lúa" not found: try "Bến Lúa"
    const words = term.trim().split(/\s+/); q.set('search', words.slice(words.length - core(term).split(' ').length).join(' '));
    found = (await fetchJson(`${WD_API}?${q}`)).search || [];
  }
  const ids = found.map((x) => x.id).filter((x) => /^Q\d+$/.test(x)).slice(0, 5);
  if (!ids.length) return [];
  const rows = (await fetchJson(`${WD_SPARQL}?${new URLSearchParams({ format: 'json', query: sparqlFor(ids) })}`)).results?.bindings || [];
  const by = new Map(ids.map((id) => [id, { source: 'wikidata', external_id: id, label: (found.find((f) => f.id === id) || {}).label || '', types: new Set(), parents: new Set(), names: new Map(), lat: null, lon: null, in_vn: false }]));
  for (const b of rows) {
    const id = String(b.item?.value || '').split('/').pop(); const c = by.get(id); if (!c) continue;
    if (b.itemLabel?.value && !/^Q\d+$/.test(b.itemLabel.value)) c.label = c.label || b.itemLabel.value;
    if (b.typeLabel?.value) c.types.add(b.typeLabel.value);
    if (b.parentLabel?.value) c.parents.add(b.parentLabel.value);
    if (String(b.country?.value || '').endsWith('/Q881')) c.in_vn = true;
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value || '');
    if (m && c.lat === null) { c.lon = Number(m[1]); c.lat = Number(m[2]); }
    if (b.name?.value) {
      const n = { name: b.name.value, lang: b.name['xml:lang'] || 'vi', valid_from: wdDate(b.from?.value), valid_to: wdDate(b.to?.value) };
      c.names.set(`${R.fold(n.name)}|${n.lang}|${n.valid_from}|${n.valid_to}`, n);
    }
  }
  return [...by.values()].map((c) => ({ source: c.source, external_id: c.external_id, label: c.label, lat: c.lat, lon: c.lon, in_vn: c.in_vn,
    kind_hint: kindFrom([...c.types]), parent_labels: [...c.parents], names: [...c.names.values()], url: `https://www.wikidata.org/wiki/${c.external_id}` }));
}

// ---------- GeoNames ----------
async function geonamesCandidates(place, { fetchJson, user }) {
  if (!user) return [];
  const term = (place.names || []).find((n) => n.is_primary && !n.valid_to)?.name || place.names?.[0]?.name;
  if (!term) return [];
  const q = new URLSearchParams({ q: core(term) || term, country: 'VN', maxRows: '5', style: 'FULL', lang: 'vi', username: user });
  const j = await fetchJson(`https://secure.geonames.org/searchJSON?${q}`);
  if (j.status) throw new Error(`GeoNames: ${j.status.message || 'error'}`);
  return (j.geonames || []).map((g) => ({ source: 'geonames', external_id: String(g.geonameId), label: g.name, lat: Number(g.lat), lon: Number(g.lng),
    in_vn: g.countryCode === 'VN', kind_hint: kindFrom([], g.fcode), parent_labels: [g.adminName1, g.adminName2, g.adminName3].filter(Boolean),
    names: (g.alternateNames || []).filter((a) => ['vi', 'en', 'fr', 'zh'].includes(a.lang)).slice(0, 6).map((a) => ({ name: a.name, lang: a.lang, valid_from: null, valid_to: null })),
    url: `https://www.geonames.org/${g.geonameId}` }));
}

// The suggestion rows for the best candidate of each source (at or above `min`): only fields that are still empty on
// our place, and only names we do not have yet.
function suggestionsFor(place, cands, { min = MIN_CONFIDENCE } = {}) {
  const out = [];
  const have = new Set((place.names || []).map((n) => `${core(n.name)}|${n.lang || 'vi'}`)); // "Xã Bến Lúa" = "Bến Lúa"
  for (const source of ['wikidata', 'geonames']) {
    const best = cands.filter((c) => c.source === source).map((c) => ({ c, s: score(place, c) })).sort((a, b) => b.s - a.s)[0];
    if (!best || best.s < min) continue;
    const { c, s } = best;
    const row = (field, value) => out.push({ source, external_id: c.external_id, field, value, confidence: s, licence: LICENCE[source], attribution: ATTRIBUTION[source] });
    if (source === 'wikidata' && !place.wikidata_id) row('wikidata_id', { id: c.external_id, label: c.label, url: c.url });
    if (source === 'geonames' && !place.geonames_id) row('geonames_id', { id: Number(c.external_id), label: c.label, url: c.url });
    if (place.lat == null && Number.isFinite(c.lat) && Number.isFinite(c.lon)) row('coords', { lat: c.lat, lon: c.lon });
    for (const n of c.names) {
      const k = `${core(n.name)}|${n.lang || 'vi'}`;
      if (!n.name || have.has(k)) continue;
      have.add(k); row('name', { name: n.name, lang: n.lang || 'vi', valid_from: n.valid_from || null, valid_to: n.valid_to || null });
    }
  }
  return out;
}

// At most one call per `ms` (the clock and sleep are injectable for tests).
function throttle(ms, { now = () => Date.now(), sleep = (t) => new Promise((r) => setTimeout(r, t)) } = {}) {
  let last = -Infinity;
  return async () => { const wait = last + ms - now(); if (wait > 0) await sleep(wait); last = now(); };
}

// Everything the scorer needs about one of our places.
async function loadPlace(q, id) {
  const { rows: [p] } = await q.query('select id, kind, lat, lon, wikidata_id, geonames_id, official_code from places where id=$1', [id]);
  if (!p) return null;
  const names = (await q.query('select name, lang, valid_from, valid_to, is_primary from place_names where place_id=$1', [id])).rows;
  const parent_names = (await q.query(`select n.name from place_parents pp join place_names n on n.place_id = pp.parent_id where pp.place_id=$1`, [id])).rows.map((r) => r.name);
  return { ...p, names, parent_names };
}

async function enrichPlace(pool, placeId, { fetchJson, geonamesUser = '', wait = async () => {} }) {
  const place = await loadPlace(pool, placeId);
  if (!place) return 0;
  const get = async (url) => { await wait(); return fetchJson(url); };
  const cands = [...await wikidataCandidates(place, { fetchJson: get }), ...await geonamesCandidates(place, { fetchJson: get, user: geonamesUser })];
  let n = 0;
  for (const s of suggestionsFor(place, cands)) {
    const r = await pool.query(`insert into place_suggestions (place_id, source, external_id, field, value, confidence, licence, attribution)
      values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`, [placeId, s.source, s.external_id, s.field, s.value, s.confidence, s.licence, s.attribution]);
    n += r.rowCount;
  }
  return n;
}

// Queue one job per place (a place with an open job is left alone).
const enqueue = (q, placeId) => q.query("insert into places_enrich_jobs (place_id) values ($1) on conflict do nothing", [placeId]);

// One job: claim the oldest due one, run it, mark it done, or queue it again later (1, 4 minutes) until MAX_TRIES.
async function runOnce(pool, deps) {
  const { rows: [job] } = await pool.query(`update places_enrich_jobs set status='running', tries=tries+1, updated_at=now()
    where id = (select id from places_enrich_jobs where status='queued' and next_at <= now() order by next_at, id for update skip locked limit 1)
    returning id, place_id, tries`);
  if (!job) return null;
  try {
    const n = await enrichPlace(pool, job.place_id, deps);
    await pool.query("update places_enrich_jobs set status='done', last_error=null, updated_at=now() where id=$1", [job.id]);
    return { id: job.id, status: 'done', suggestions: n };
  } catch (e) {
    const failed = job.tries >= MAX_TRIES;
    await pool.query(`update places_enrich_jobs set status=$2, last_error=$3, next_at=now() + ($4 || ' minutes')::interval, updated_at=now() where id=$1`,
      [job.id, failed ? 'failed' : 'queued', String(e.message || e).slice(0, 500), String(4 ** (job.tries - 1))]);
    return { id: job.id, status: failed ? 'failed' : 'queued', error: String(e.message || e) };
  }
}

async function realFetchJson(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json, application/sparql-results+json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// The in-process worker: one job every few seconds, one request per second. Returns a stop function (or null: off).
function startWorker({ pool, env = process.env, log = console, everyMs = 5000 }) {
  if (env.PLACES_ENRICH !== '1') return null;
  const deps = { fetchJson: realFetchJson, geonamesUser: env.GEONAMES_USER || '', wait: throttle(1000) };
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try { const r = await runOnce(pool, deps); if (r && r.status !== 'done') log.warn?.('places enrich', r.status, r.error); }
    catch (e) { log.warn?.('places enrich tick', e.message); } finally { busy = false; }
  };
  const h = setInterval(tick, everyMs); h.unref?.();
  return () => clearInterval(h);
}

module.exports = { LICENCE, ATTRIBUTION, MIN_CONFIDENCE, MAX_TRIES, core, score, kindFrom, wdDate, sparqlFor, wikidataCandidates, geonamesCandidates,
  suggestionsFor, throttle, loadPlace, enrichPlace, enqueue, runOnce, startWorker };
