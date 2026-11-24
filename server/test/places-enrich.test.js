// Places step 3, no database and no network: Wikidata / GeoNames answers are recorded fixtures (invented places).
// Candidates are parsed, scored against our place, and only EMPTY fields or names we lack become suggestions.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const E = require('../places-enrich');
const { validate } = require('../scripts/places-import-vn');

const FX = (f) => require(path.join(__dirname, 'fixtures', 'places', f));
const calls = [];
const fetchJson = async (url) => {
  calls.push(url);
  if (url.includes('wbsearchentities')) return FX('wikidata-search.json');
  if (url.startsWith('https://query.wikidata.org/sparql')) return FX('wikidata-sparql.json');
  if (url.includes('geonames.org/searchJSON')) return FX('geonames-search.json');
  throw new Error('unexpected ' + url);
};
const PLACE = { id: 1, kind: 'commune', lat: null, lon: null, wikidata_id: null, geonames_id: null,
  names: [{ name: 'Xã Bến Lúa', lang: 'vi', valid_from: '1956', valid_to: null, is_primary: true }], parent_names: ['Tỉnh Sông Lớn'] };

test('Wikidata: search + SPARQL parsed into candidates (type, coords, parent, names over time)', async () => {
  const c = await E.wikidataCandidates(PLACE, { fetchJson });
  assert.equal(c.length, 2);
  const a = c.find((x) => x.external_id === 'Q9990001');
  assert.equal(a.kind_hint, 'commune'); assert.equal(a.lat, 10.75); assert.equal(a.lon, 106.5); assert.ok(a.in_vn);
  assert.deepEqual(a.parent_labels, ['Tỉnh Sông Lớn']);
  assert.deepEqual(a.names.map((n) => [n.name, n.valid_from, n.valid_to]), [['Xã Bến Lúa', '1956', null], ['Làng Bến Thóc', '1700', '1956-03-15']]);
  assert.equal(c.find((x) => x.external_id === 'Q9990002').kind_hint, null, 'a river is no commune');
  assert.match(calls.find((u) => u.includes('sparql')), /wd%3AQ9990001/);
});

test('score: name + kind + parent + Vietnam; a same-name river stays below the bar', async () => {
  const c = await E.wikidataCandidates(PLACE, { fetchJson });
  assert.equal(E.score(PLACE, c.find((x) => x.external_id === 'Q9990001')), 1);
  assert.ok(E.score(PLACE, c.find((x) => x.external_id === 'Q9990002')) < E.MIN_CONFIDENCE);
  assert.equal(E.core('Thành phố Hồ Chí Minh'), 'ho chi minh');
  assert.equal(E.core('Xã Bến Lúa'), 'ben lua');
});

test('suggestions: empty fields + new names only, best candidate per source, licence + attribution kept', async () => {
  const cands = [...await E.wikidataCandidates(PLACE, { fetchJson }), ...await E.geonamesCandidates(PLACE, { fetchJson, user: 'demo' })];
  const s = E.suggestionsFor(PLACE, cands);
  const wd = s.filter((x) => x.source === 'wikidata'); const gn = s.filter((x) => x.source === 'geonames');
  assert.deepEqual(wd.map((x) => x.field), ['wikidata_id', 'coords', 'name']);
  assert.equal(wd.find((x) => x.field === 'name').value.name, 'Làng Bến Thóc', '"Xã Bến Lúa" is ours already');
  assert.ok(wd.every((x) => x.external_id === 'Q9990001' && x.licence === 'CC0-1.0'));
  assert.deepEqual(gn.map((x) => x.field), ['geonames_id', 'coords', 'name']);
  assert.equal(gn.find((x) => x.field === 'name').value.name, 'Ben Lua Commune', 'Bến Lúa = Xã Bến Lúa without the prefix');
  assert.ok(gn.every((x) => x.licence === 'CC-BY-4.0' && /GeoNames/.test(x.attribution)));
  // our copy wins: ids and coordinates already there -> only names are offered
  const filled = { ...PLACE, wikidata_id: 'Q1', geonames_id: 7, lat: 1, lon: 2 };
  assert.deepEqual(E.suggestionsFor(filled, cands).map((x) => x.field), ['name', 'name']);
});

test('GeoNames is skipped without a username (no request made)', async () => {
  const before = calls.length;
  assert.deepEqual(await E.geonamesCandidates(PLACE, { fetchJson, user: '' }), []);
  assert.equal(calls.length, before);
});

test('throttle: one call per second', async () => {
  let t = 0; const slept = [];
  const wait = E.throttle(1000, { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
  await wait(); t += 200; await wait(); t += 1500; await wait();
  assert.deepEqual(slept, [800]);
});

test('helpers: Wikidata dates, GeoNames feature codes, import file checks', () => {
  assert.equal(E.wdDate('1976-07-02T00:00:00Z'), '1976-07-02');
  assert.equal(E.wdDate('1802-01-01T00:00:00Z'), '1802');
  assert.equal(E.wdDate(''), null);
  assert.equal(E.kindFrom([], 'ADM1'), 'province');
  assert.equal(E.kindFrom([], 'PPLA'), 'village');
  assert.equal(E.kindFrom(['district of Vietnam'], null), 'district');
  assert.equal(validate({ code: 'T1', name: 'X', kind: 'province' }, 0), null);
  assert.match(validate({ code: 'T1', name: 'X', kind: 'planet' }, 0), /kind/);
  assert.match(validate({ code: 'T1', name: 'X', kind: 'district', valid_from: 'năm ấy' }, 0), /date/);
});
