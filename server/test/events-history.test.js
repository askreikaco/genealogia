// Historical events pack (web/js/events-history.js): data checks and the country filter of Dòng đời (events-life.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const mod = (f) => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href);
const TODAY = '2026-01-01';
const year = (s) => parseInt(s, 10);

test('every event has a year, a title and a source link; ids unique', async () => {
  const H = await mod('events-history.js');
  assert.ok(H.HISTORY_VI.length >= 110 && H.HISTORY_JP.length >= 25 && H.HISTORY_KR.length >= 15, 'pack sizes');
  assert.equal(new Set(H.HISTORY_ALL.map((x) => x.id)).size, H.HISTORY_ALL.length, 'ids unique');
  for (const x of H.HISTORY_ALL) {
    assert.ok(/^-?\d{4}/.test(x.from), 'year: ' + JSON.stringify(x));
    assert.ok(x.label && x.label.trim().length > 3, 'title: ' + JSON.stringify(x));
    assert.ok(/^https:\/\/(vi|en)\.wikipedia\.org\/w\/index\.php\?search=\S+$/.test(x.source), 'source: ' + x.id);
  }
});

test('no duplicate (year, title) within a pack', async () => {
  const H = await mod('events-history.js');
  for (const [name, pack] of Object.entries(H.HISTORY_PACKS)) {
    const seen = new Set();
    for (const x of pack) {
      const key = `${year(x.from)}|${x.label}`;
      assert.ok(!seen.has(key), `${name}: duplicate ${key}`);
      seen.add(key);
    }
  }
});

test('each pack is sorted by year', async () => {
  const H = await mod('events-history.js');
  for (const [name, pack] of Object.entries(H.HISTORY_PACKS)) {
    for (let i = 1; i < pack.length; i++) {
      assert.ok(year(pack[i - 1].from) <= year(pack[i].from), `${name}: ${pack[i - 1].id} before ${pack[i].id}`);
    }
  }
});

test('the earliest entries are the legends and the first dated events', async () => {
  const H = await mod('events-history.js');
  assert.equal(H.HISTORY_VI[0].id, 'van-lang');
  assert.equal(H.HISTORY_JP[0].id, 'jp-jimmu');
  assert.equal(H.HISTORY_KR[0].id, 'kr-gojoseon');
});

test('country filter: a family sees its own country plus the world entries', async () => {
  const L = await mod('events-life.js');
  const H = await mod('events-history.js');
  // a life 1000–1100: Vietnamese Lý entries, Japanese Heian band, Korean Goryeo band
  const me = { born: '1000', died: '1100' };
  const ids = (country) => L.historyRows(me, H.HISTORY_ALL, { today: TODAY, all: true, country }).map((r) => r.id);
  const vn = ids('VN');
  assert.ok(vn.includes('h:thang-long') && vn.includes('h:ly-cong-uan') && vn.includes('h:ly'), 'VN sees Vietnamese entries');
  assert.ok(!vn.some((i) => i.startsWith('h:jp-')) && !vn.some((i) => i.startsWith('h:kr-')), 'VN sees no JP or KR entry');
  const jp = ids('JP');
  assert.ok(jp.includes('h:jp-heian'), 'JP sees its band');
  assert.ok(!jp.includes('h:thang-long') && !jp.some((i) => i.startsWith('h:kr-')), 'JP sees no VN or KR entry');
  const kr = ids('KR');
  assert.ok(kr.includes('h:kr-goryeo'), 'KR sees its band');
  assert.ok(!kr.includes('h:thang-long') && !kr.some((i) => i.startsWith('h:jp-')), 'KR sees no VN or JP entry');
  // world entries (region 'world') show for every country: the 1939 war starts, 1945 ends (a life 1900–1950)
  for (const c of ['VN', 'JP', 'KR']) {
    const w = L.historyRows({ born: '1900', died: '1950' }, H.HISTORY_ALL, { today: TODAY, all: true, country: c }).map((r) => r.id);
    assert.ok(w.includes('h:ww2:a') && w.includes('h:ww2:b'), 'world war for ' + c);
  }
  // a null or missing country is Vietnam (families.country null = VN)
  assert.deepEqual(ids(null), vn);
  assert.deepEqual(ids(undefined), vn);
});

test('Dòng đời shows a short key list per country', async () => {
  const L = await mod('events-life.js');
  const H = await mod('events-history.js');
  const jpRows = L.historyRows({ born: '1850', died: '1930' }, H.HISTORY_ALL, { today: TODAY, country: 'JP' });
  const jpIds = jpRows.map((r) => r.id);
  assert.ok(jpIds.includes('h:jp-perry') && jpIds.includes('h:jp-meiji'), 'JP key events: ' + jpIds.join(' '));
  assert.ok(jpRows.length <= 10, 'a short list: ' + jpRows.length);
  assert.ok(!jpIds.some((i) => i.startsWith('h:kr-')) && !jpIds.includes('h:dcs-1930'), 'no other country');
  // a Korean family born 1900 sees the 1910 annexation and the 1919 movement
  const kr = L.historyRows({ born: '1900', died: '1960' }, H.HISTORY_ALL, { today: TODAY, country: 'KR' }).map((r) => r.id);
  assert.ok(kr.includes('h:kr-annex') && kr.includes('h:kr-march1') && kr.includes('h:kr-war'), 'KR key events: ' + kr.join(' '));
});

test('years below 100 (0040 Hai Bà Trưng, 0043 Mã Viện) are key and show in a life that covers them; BCE legends never show inside a life', async () => {
  const L = await mod('events-life.js');
  const H = await mod('events-history.js');
  // events.js dayNum is exact for years 0–99, so these two are on Dòng đời (BCE legends stay out: startDays() returns null)
  const early = H.HISTORY_ALL.filter((x) => { const y = parseInt(x.from, 10); return y >= 0 && y < 100; });
  assert.ok(early.some((x) => x.id === 'hai-ba-trung') && early.some((x) => x.id === 'ma-vien'), 'stored');
  assert.ok(H.KEY_HISTORY.has('hai-ba-trung') && H.KEY_HISTORY.has('ma-vien'), 'key');
  const rows = L.historyRows({ born: '1000', died: '1100' }, H.HISTORY_ALL, { today: TODAY, all: true, country: 'VN' }).map((r) => r.id);
  assert.ok(!rows.some((i) => early.some((x) => i === 'h:' + x.id)), 'a life in 1000–1100 shows none of them');
  const old = L.historyRows({ born: '0020', died: '0060' }, H.HISTORY_ALL, { today: TODAY, country: 'VN' }).map((r) => r.id);
  assert.ok(old.includes('h:hai-ba-trung') && old.includes('h:ma-vien'), 'a life 20–60 shows both: ' + old.join(' '));
  assert.ok(!old.includes('h:van-lang') && !old.includes('h:au-lac'), 'BCE legends never show inside a life');
  assert.equal(H.HISTORY_VI.find((x) => x.id === 'van-lang').from, '-2879');
});
