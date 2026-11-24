// Dòng đời: life events derived from the tree (web/js/events-life.js) and the historical pack (events-history.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const mod = (f) => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href);
const TODAY = '2026-01-01';
const living = (d) => !(d.living === 'dead' || !!(d.died || d.death_lunar || d.gio_lunar));
const guest = (d) => !living(d);
const all = () => true;
const labels = (rows) => rows.map((r) => r.label);

// An invented family on the old fields (parent / other_parent / spouse_of).
const legacy = () => new Map([
  ['A', { name: 'Ông Cố Thử', sex: 'm', born: '1880', died: '1950' }],
  ['B', { name: 'Bà Cố Thử', sex: 'f', spouse_of: 'A', born: '1885', died: '1940' }],
  ['P', { name: 'Ông Thử Một', sex: 'm', parent: 'A', other_parent: 'B', born: '1910', died: '1990' }],
  ['Y', { name: 'Em Thử Hai', sex: 'f', parent: 'A', other_parent: 'B', born: '1915', died: '1970' }],
  ['O', { name: 'Anh Thử Cả', sex: 'm', parent: 'A', other_parent: 'B', born: '1905', died: '1960' }],
  ['W', { name: 'Bà Thử Vợ', sex: 'f', spouse_of: 'P', born: '1912', died: '1985' }],
  ['C', { name: 'Con Thử Ba', sex: 'm', parent: 'P', born: '1935', died: '2000' }],
  ['L', { name: 'Con Thử Sống', sex: 'f', parent: 'P', born: '1940' }],
  ['G', { name: 'Cháu Thử Bốn', sex: 'm', parent: 'C', born: '1960', died: '2010' }],
  ['G2', { name: 'Cháu Thử Muộn', sex: 'm', parent: 'C', born: '1995', died: '2015' }],
]);

test('self anchors, parents, spouse, younger siblings, children and grandchildren (old fields)', async () => {
  const L = await mod('events-life.js');
  const rows = L.deriveLifeEvents('P', legacy(), { visible: all, today: TODAY });
  const ls = labels(rows);
  for (const want of ['Ra đời', 'Mất', 'Cha Ông Cố Thử mất', 'Mẹ Bà Cố Thử mất', 'Vợ Bà Thử Vợ mất', 'Em gái Em Thử Hai ra đời',
    'Con Con Thử Ba ra đời', 'Con Con Thử Sống ra đời', 'Cháu Cháu Thử Bốn ra đời · con của Con Thử Ba']) {
    assert.ok(ls.includes(want), `missing ${want}: ${JSON.stringify(ls)}`);
  }
  assert.ok(!ls.some((x) => x.includes('Anh Thử Cả')), 'an older sibling is not a timeline event');
  const g = rows.find((r) => r.label.startsWith('Cháu')); assert.equal(g.group, 'desc'); assert.equal(g.person_id, 'G');
  assert.equal(rows.find((r) => r.label === 'Ra đời').group, 'self');
  assert.equal(rows.find((r) => r.label.startsWith('Mẹ')).group, 'family');
});

test('lifetime window: events after the death are left out; anchors always stay', async () => {
  const L = await mod('events-life.js');
  const ls = labels(L.deriveLifeEvents('P', legacy(), { visible: all, today: TODAY }));
  assert.ok(!ls.some((x) => x.includes('Cháu Thử Muộn')), 'grandchild born 1995 after the death in 1990');
  const rows = L.deriveLifeEvents('P', legacy(), { visible: all, today: TODAY });
  assert.ok(!rows.some((r) => r.label === 'Con Con Thử Ba mất'), 'child died 2000, after the person (1990)');
  // a living person: the window ends today
  // born 1980: a person born more than 110 years ago with no death date counts as deceased (see below)
  const m = legacy(); m.get('P').died = undefined; m.get('P').born = '1980';
  assert.ok(labels(L.deriveLifeEvents('P', m, { visible: all, today: TODAY })).some((x) => x.includes('Cháu Thử Muộn')));
});

test('no birth date: the window opens 15 years before the earliest known event', async () => {
  const L = await mod('events-life.js');
  const m = legacy(); m.get('P').born = undefined; // earliest other event: Cha mất 1950? no: Mẹ mất 1940, children 1935
  const rows = L.deriveLifeEvents('P', m, { visible: all, today: TODAY });
  assert.ok(!rows.some((r) => r.label === 'Ra đời'));
  const w = L.lifeWindow(m.get('P'), { today: TODAY, events: [{ date_kind: 'exact', date_from: '1935' }] });
  assert.equal(new Date(w.from * 864e5).getUTCFullYear(), 1920);
});

test('deceased without a death date: the window ends 60 years after birth or the last own event, never after today', async () => {
  const L = await mod('events-life.js');
  const H = await mod('events-history.js');
  const E = await mod('events.js');
  const toYear = (w) => new Date(w.to * 864e5).getUTCFullYear();
  // (a) living 'dead', no dates, one stored event in 1801: from 1786, to = 1801 vs 1786 + 60 = 1846
  const ev1801 = [{ date_kind: 'exact', date_from: '1801' }];
  const a = L.lifeWindow({ living: 'dead' }, { today: TODAY, events: ev1801 });
  assert.equal(toYear(a), 1846);
  const hist = L.historyRows({ living: 'dead' }, H.HISTORY_VI, { today: TODAY, events: ev1801, all: true });
  assert.ok(hist.length > 0, 'history rows exist before 1846');
  assert.ok(hist.every((r) => Number(String(r.date_from).slice(0, 4)) <= 1846), 'no history row after 1846');
  // a stored event in 1850 extends the window to 1850
  const a2 = L.lifeWindow({ living: 'dead' }, { today: TODAY, events: [...ev1801, { date_kind: 'exact', date_from: '1850' }] });
  assert.equal(toYear(a2), 1850);
  // (b) born 1900, no death date, living unknown: born more than 110 years ago, so deceased; to = 1960
  const b = L.lifeWindow({ born: '1900' }, { today: '2026-11-24' });
  assert.equal(toYear(b), 1960);
  // (c) living person born 1980: the window ends today
  const c = L.lifeWindow({ born: '1980' }, { today: '2026-11-24' });
  assert.equal(c.to, E.startDays('2026-11-24'));
  // (d) a death date still wins: the end of the death year
  const d = L.lifeWindow({ born: '1900', died: '1950', living: 'dead' }, { today: '2026-11-24' });
  assert.equal(d.to, E.endDays('1950'));
});

test('privacy: a living relative is hidden from a guest, shown to a member', async () => {
  const L = await mod('events-life.js');
  assert.ok(!labels(L.deriveLifeEvents('P', legacy(), { visible: guest, today: TODAY })).includes('Con Con Thử Sống ra đời'));
  assert.ok(labels(L.deriveLifeEvents('P', legacy(), { visible: all, today: TODAY })).includes('Con Con Thử Sống ra đời'));
});

test('de-duplicate: a stored event of the same type and year wins', async () => {
  const L = await mod('events-life.js');
  const stored = { P: [{ id: 'e1', type: 'sinh', date_kind: 'exact', date_from: '1910-03-05' }] };
  const rows = L.deriveLifeEvents('P', legacy(), { visible: all, today: TODAY, eventsOf: (id) => stored[id] || [] });
  assert.ok(!rows.some((r) => r.label === 'Ra đời'), 'stored birth replaces the derived anchor');
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'ids unique');
});

test('relation-table families: parents, partners with the wedding year, children from the table', async () => {
  const L = await mod('events-life.js');
  const R = await mod('relgraph.js');
  const persons = new Map([
    ['F', { name: 'Cha Bảng', sex: 'm', born: '1900', died: '1960' }], ['M', { name: 'Mẹ Bảng', sex: 'f', born: '1905', died: '1955' }],
    ['X', { name: 'Người Bảng', sex: 'm', born: '1930', died: '2000' }], ['S', { name: 'Vợ Bảng', sex: 'f', born: '1932', died: '1999' }],
    ['K', { name: 'Con Bảng', sex: 'f', born: '1958' }], ['K2', { name: 'Cháu Bảng', sex: 'm', born: '1985', died: '1990' }],
  ]);
  const ix = R.index([
    { parent_id: 'F', child_id: 'X', kind: 'ruot' }, { parent_id: 'M', child_id: 'X', kind: 'ruot' },
    { parent_id: 'X', child_id: 'K', kind: 'ruot' }, { parent_id: 'K', child_id: 'K2', kind: 'ruot' },
  ], [{ id: 1, a_id: 'X', b_id: 'S', kind: 'cuoi', start_year: 1955 }]);
  const ls = labels(L.deriveLifeEvents('X', persons, { rel: L.relAccess(ix), visible: all, today: TODAY }));
  for (const want of ['Cha Cha Bảng mất', 'Mẹ Mẹ Bảng mất', 'Kết hôn với Vợ Bảng', 'Vợ Vợ Bảng mất', 'Con Con Bảng ra đời', 'Cháu Cháu Bảng ra đời · con của Con Bảng']) {
    assert.ok(ls.includes(want), `missing ${want}: ${JSON.stringify(ls)}`);
  }
});

test('history pack: shape, bands, war start/end, only inside the lifetime', async () => {
  const L = await mod('events-life.js');
  const H = await mod('events-history.js');
  assert.ok(H.HISTORY_VI.length >= 40);
  assert.equal(new Set(H.HISTORY_VI.map((x) => x.id)).size, H.HISTORY_VI.length, 'ids unique');
  for (const x of H.HISTORY_VI) {
    assert.ok(x.id && x.label && ['era', 'reign', 'war', 'event', 'period'].includes(x.kind) && ['vn', 'world'].includes(x.region), JSON.stringify(x));
    assert.ok(/^\d{4}(-\d{2}(-\d{2})?)?$/.test(x.from) && (!x.to || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(x.to)), JSON.stringify(x));
    assert.ok(/^https:\/\/vi\.wikipedia\.org\//.test(x.source), x.id);
  }
  const rows = L.historyRows({ born: '1940', died: '1980' }, H.HISTORY_VI, { today: TODAY });
  const ids = rows.map((r) => r.id);
  for (const want of ['h:dong-duong:a', 'h:dong-duong:b', 'h:vn-war:a', 'h:vn-war:b', 'h:bao-dai', 'h:nan-doi', 'h:doc-lap-1945']) {
    assert.ok(ids.includes(want), `missing ${want}: ${ids.join(' ')}`);
  }
  // key events only by default: no Genève/Paris rows, no Nguyễn era band next to the king's band, no world wars
  for (const no of ['h:geneve-1954', 'h:paris-1973', 'h:nguyen', 'h:ww2:b']) assert.ok(!ids.includes(no), 'not key: ' + no);
  assert.ok(rows.length <= 10, 'a short list: ' + rows.length);
  const every = L.historyRows({ born: '1940', died: '1980' }, H.HISTORY_VI, { today: TODAY, all: true }).map((r) => r.id);
  for (const want of ['h:geneve-1954', 'h:paris-1973', 'h:nguyen', 'h:ww2:b']) assert.ok(every.includes(want), 'all: ' + want);
  for (const id of H.KEY_HISTORY) assert.ok(H.HISTORY_VI.some((x) => x.id === id), 'key id exists: ' + id);
  assert.ok(!ids.includes('h:doi-moi-1986') && !ids.includes('h:tu-duc') && !ids.includes('h:ww2:a'), 'outside the life');
  const band = rows.find((r) => r.id === 'h:bao-dai');
  assert.ok(band.band && band.date_from === '1940', 'a band that started before the birth sits at the birth year');
  assert.ok(rows.every((r) => r.group === 'hist' && r.derived));
  // COVID-19 for a person living through it: start/end rows, the band, Vietnam's own dates
  const covid = L.historyRows({ born: '1950' }, H.HISTORY_VI, { today: TODAY, all: true }).map((r) => r.id);
  const key50 = L.historyRows({ born: '1950' }, H.HISTORY_VI, { today: TODAY }).map((r) => r.id);
  for (const want of ['h:covid:a', 'h:covid:b', 'h:sars-2003', 'h:tay-nam:a', 'h:tay-nam:b', 'h:phia-bac']) assert.ok(key50.includes(want), 'key: ' + want);
  for (const no of ['h:covid-1', 'h:covid-band', 'h:covid-vn-2020', 'h:gian-cach-2020']) assert.ok(!key50.includes(no), 'COVID is start + end only: ' + no);
  assert.ok(!key50.includes('h:phia-bac:a') && !key50.includes('h:phia-bac:b'), 'a war within one year is one row');
  for (const want of ['h:covid:a', 'h:covid:b', 'h:covid-band', 'h:covid-vn-2020', 'h:gian-cach-2020', 'h:wto-2007', 'h:bao-linda-1997']) {
    assert.ok(covid.includes(want), 'missing ' + want);
  }
  assert.ok(!L.historyRows({ born: '1950', died: '2019' }, H.HISTORY_VI, { today: TODAY }).some((r) => r.id.startsWith('h:covid')), 'none after the death');
});

test('niên hiệu dates: every Nguyễn reign converts year N to y1 + N − 1; out of range and Dục Đức are refused', async () => {
  const H = await mod('events-history.js');
  const E = await mod('events.js');
  const Y1 = { 'Gia Long': [1802, 19], 'Minh Mạng': [1820, 22], 'Thiệu Trị': [1841, 7], 'Tự Đức': [1848, 36], 'Hiệp Hòa': [1883, 1],
    'Kiến Phúc': [1884, 1], 'Hàm Nghi': [1885, 1], 'Đồng Khánh': [1886, 4], 'Thành Thái': [1889, 19], 'Duy Tân': [1907, 10],
    'Khải Định': [1916, 10], 'Bảo Đại': [1926, 20] };
  for (const [k, [y1, max]] of Object.entries(Y1)) {
    assert.equal(H.parseReignYear(`${k} thứ 1`).year, y1, k);
    assert.equal(H.parseReignYear(`${k} năm thứ ${max}`).year, y1 + max - 1, `${k} last year`);
    assert.ok(H.parseReignYear(`${k} thứ ${max + 1}`).error, `${k} beyond the reign`);
  }
  assert.equal(H.parseReignYear('Tự Đức thứ 10').year, 1857);
  assert.equal(H.parseReignYear('năm Tu Duc 10').year, 1857, 'no accents, "năm" first');
  assert.ok(H.parseReignYear('Dục Đức thứ 1').error, 'Dục Đức has no era name');
  assert.ok(H.parseReignYear('Tự Đức thứ 0').error);
  assert.equal(H.parseReignYear('1857'), null, 'a plain year is not a reign');
  const p = E.parseEventDate('Tự Đức thứ 10');
  assert.deepEqual([p.kind, p.from, p.reign], ['about', '1857', 'Tự Đức']);
  assert.ok(E.parseEventDate('Kiến Phúc thứ 3').error);
  assert.equal(E.birthIso({ birth_date: 'Thành Thái thứ 5' }), '1893', 'a person born in Thành Thái 5');
});

test('a stored mat event with a date (no died): no history rows after its end; a death date still wins', async () => {
  const L = await mod('events-life.js');
  const H = await mod('events-history.js');
  const E = await mod('events.js');
  const toYear = (w) => new Date(w.to * 864e5).getUTCFullYear();
  const own = [{ id: 'm1', type: 'mat', date_kind: 'between', date_from: '1816', date_to: '1828' }];
  const me = { born: '1790' };
  // the recorded death (1828) ends the window, not the 60-years-after-birth rule (1850)
  assert.equal(toYear(L.lifeWindow(me, { today: TODAY, events: own })), 1828);
  assert.equal(L.lifeWindow(me, { today: TODAY, events: own }).to, E.endDays('1828'));
  const hist = L.historyRows(me, H.HISTORY_VI, { today: TODAY, events: own, all: true });
  assert.ok(hist.length > 0, 'history rows exist before 1828');
  assert.ok(hist.every((r) => Number(String(r.date_from).slice(0, 4)) <= 1828), 'no history row after 1828');
  // a derived mat row of a relative (died 1900) is not the person's own death
  const relDerived = [{ id: 'd1', derived: true, group: 'family', type: 'mat', date_kind: 'exact', date_from: '1816' }];
  assert.equal(toYear(L.lifeWindow(me, { today: TODAY, events: relDerived })), 1850);
  // a death date still wins over the stored mat event
  const dd = L.lifeWindow({ born: '1790', died: '1850' }, { today: TODAY, events: own });
  assert.equal(dd.to, E.endDays('1850'));
});
