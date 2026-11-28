// Reusable sources (E2), no database: the source rules (sources.js), the event citation rules (web/js/events.js) and
// the GEDCOM mapping of sources and citations (gedcom.js): the top-level SOUR records, PAGE, QUAY, and a round trip
// export -> read -> plan (the citations come back linked to the family's sources or planned as new ones).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const S = require('../sources');
const G = require('../gedcom');
let R; let F;
test.before(async () => {
  R = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'events.js')).href);
  F = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'fuzzy.js')).href);
});

test('source rules: a title is required; kind is one of the six; the url is http(s); the year is 0..9999', () => {
  assert.equal(S.validateSource({ title: 'Gia phả 1950' }), null);
  assert.equal(S.validateSource({ title: '   ' }), 'Cần tên nguồn.');
  assert.equal(S.validateSource({}), 'Cần tên nguồn.');
  assert.equal(S.validateSource({ title: 'x'.repeat(301) }), null, 'a long title is cut to 300, not refused');
  for (const kind of S.KINDS) assert.equal(S.validateSource({ title: 'x', kind }), null, kind);
  assert.ok(S.validateSource({ title: 'x', kind: 'sach' }));
  assert.equal(S.cleanSource({ title: 'x' }).value.kind, 'khac');
  assert.ok(S.validateSource({ title: 'x', url: 'javascript:alert(1)' }));
  assert.equal(S.validateSource({ title: 'x', url: 'https://example.test/a' }), null);
  assert.equal(S.cleanSource({ title: 'x', year: '1950' }).value.year, 1950);
  assert.equal(S.cleanSource({ title: 'x', year: '' }).value.year, null);
  assert.ok(S.validateSource({ title: 'x', year: 'abc' }));
  assert.ok(S.validateSource({ title: 'x', year: 10000 }));
  assert.ok(S.validateSource({ title: 'x', year: -1 }));
  assert.equal(S.cleanSource({ title: '  Sổ  ', author: '  A  ' }).value.title, 'Sổ');
});

test('event citations: a source_id must look like one; a page is at most 200 characters', () => {
  const ev = (sources) => ({ type: 'hoc', date_kind: 'exact', date_from: '1980', people: [], sources, is_preferred: true });
  assert.equal(R.validateEvent(ev([{ source_id: 'D0123456789ab', title: 'Sổ', page: 'tr. 12', quality: 'goc' }])), null);
  assert.ok(R.validateEvent(ev([{ source_id: '../etc', title: 'Sổ' }])));
  assert.ok(R.validateEvent(ev([{ source_id: 'E0123456789ab', title: 'Sổ' }])), 'an event id is not a source id');
  assert.ok(R.validateEvent(ev([{ title: 'Sổ', page: 'p'.repeat(201) }])));
  assert.equal(R.validateEvent(ev([{ title: 'Sổ', quality: null }])), null, 'no quality chosen (null) is fine');
  assert.ok(R.validateEvent(ev([{ title: 'Sổ', quality: 'tot' }])));
  assert.equal(R.validateEvent(ev([{ title: 'Sổ', page: 'p'.repeat(200) }])), null);
});

// A family with two sources (one cited with a page and quality, one cited without a source record) and one event.
function family() {
  const sources = [
    { id: 'D1a2b3c4d5e6f', title: 'Gia phả viết tay 1950', kind: 'gia_pha', author: 'Dương Văn Ất', year: 1950, url: '', note: 'Bìa nâu' },
    { id: 'Dfedcba987654', title: 'Bia mộ Hòa Thọ', kind: 'bia_mo', author: '', year: null, url: 'https://example.test/mo', note: '' },
  ];
  const persons = [{ id: 'P001', data: { name: 'Dương Văn Ất', sex: 'm', born: '1900', died: '1970' } }];
  const events = [
    { id: 'E000000000001', person_id: 'P001', type: 'hoc', date_kind: 'exact', date_from: '1920', date_to: null, place: 'Quảng Nam', description: 'Học trường làng',
      lunar: '', sources: [{ source_id: 'D1a2b3c4d5e6f', title: 'Gia phả viết tay 1950', page: 'tr. 12', quality: 'goc' }] },
    { id: 'E000000000002', person_id: 'P001', type: 'mat', date_kind: 'exact', date_from: '1970', date_to: null, place: 'Quảng Nam', description: 'Mất tại nhà',
      lunar: '', sources: [{ source_id: 'Dfedcba987654', title: 'Bia mộ Hòa Thọ', url: 'https://example.test/mo', quality: 'suy_doan' },
        { title: 'Ghi chú cũ', url: '', quality: 'loi_ke', page: 'đoạn 2' }] },
  ];
  return { sources, persons, events };
}

test('GEDCOM export: one top-level SOUR per source, PAGE and QUAY on each citation, the mapping of quality', () => {
  const { sources, persons, events } = family();
  const text = G.buildExport({ R, family: { id: 'x', name: 'Thử' }, persons, events, sources, now: new Date('2026-01-01T00:00:00Z') });
  const lines = text.split('\n');
  const recs = lines.filter((l) => /^0 @S\d+@ SOUR$/.test(l));
  assert.equal(recs.length, 3, 'two family sources and the inline citation without a source id');
  assert.match(text, /^1 TITL Gia phả viết tay 1950$/m);
  assert.match(text, /^1 AUTH Dương Văn Ất$/m);
  assert.match(text, /^1 PUBL 1950$/m);
  assert.match(text, /^1 _KIND gia_pha$/m);
  assert.match(text, /^1 NOTE Bìa nâu$/m);
  assert.match(text, /^1 NOTE https:\/\/example\.test\/mo$/m);
  assert.match(text, /^3 PAGE tr\. 12$/m);
  assert.match(text, /^3 PAGE đoạn 2$/m);
  // quality -> QUAY: goc 3 (direct, primary), loi_ke 2 (secondary), suy_doan 1 (questionable)
  assert.match(text, /^3 QUAY 3$/m); assert.match(text, /^3 QUAY 1$/m); assert.match(text, /^3 QUAY 2$/m);
});

test('GEDCOM read and plan: a file of this app maps back to the family sources and the citations keep page and quality', () => {
  const { sources, persons, events } = family();
  const text = G.buildExport({ R, family: { id: 'x', name: 'Thử' }, persons, events, sources, now: new Date('2026-01-01T00:00:00Z') });
  const doc = G.readGedcom(R, text);
  assert.equal(doc.sources.length, 3);
  const gp = doc.sources.find((s) => s.title === 'Gia phả viết tay 1950');
  assert.equal(gp.kind, 'gia_pha'); assert.equal(gp.year, 1950); assert.equal(gp.author, 'Dương Văn Ất'); assert.equal(gp.note, 'Bìa nâu');
  const plan = G.planImport(doc, { R, F, persons: [], events: [], stories: [], sources: [], pc: [], cp: [], relMode: 'table', newId: (x) => 'N' + x });
  // nothing in the family yet: all three citation sources are planned as new (one per title and url)
  assert.equal(plan.newSources.length, 3);
  const person = plan.persons[0];
  assert.equal(person.events.length, 2);
  // a birth or a death date the importer writes to the person's fields keeps no citation (only events do)
  const cite = person.events.find((e) => e.type === 'hoc').sources[0];
  assert.equal(cite.page, 'tr. 12'); assert.equal(cite.quality, 'goc'); assert.ok(cite.source_key);
  const keyOf = (t) => plan.newSources.find((n) => n.input.title === t).key;
  assert.equal(cite.source_key, keyOf('Gia phả viết tay 1950'));
  assert.equal(person.events.find((e) => e.type === 'mat').sources[0].quality, 'suy_doan');
});

test('GEDCOM plan with the family already holding the sources: citations link to them, nothing new is planned', () => {
  const { sources, persons, events } = family();
  const text = G.buildExport({ R, family: { id: 'x', name: 'Thử' }, persons, events, sources, now: new Date('2026-01-01T00:00:00Z') });
  const doc = G.readGedcom(R, text);
  const have = [{ id: 'D1a2b3c4d5e6f', title: 'Gia phả viết tay 1950', url: '' }, { id: 'Dfedcba987654', title: 'Bia mộ Hòa Thọ', url: 'https://example.test/mo' }];
  const plan = G.planImport(doc, { R, F, persons: [], events: [], stories: [], sources: have, pc: [], cp: [], relMode: 'table', newId: (x) => 'N' + x });
  assert.deepEqual(plan.newSources.map((n) => n.input.title), ['Ghi chú cũ'], 'only the citation without a record is new');
  const cites = plan.persons[0].events.flatMap((e) => e.sources);
  assert.equal(cites.find((c) => c.title === 'Gia phả viết tay 1950').source_id, 'D1a2b3c4d5e6f');
  assert.equal(cites.find((c) => c.title === 'Bia mộ Hòa Thọ').source_id, 'Dfedcba987654');
});

test('a file from another program (a SOUR record with a pointer and no PUBL or kind) still imports', () => {
  const text = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', '0 @I1@ INDI', '1 NAME Nguyễn Văn A', '1 BIRT', '2 DATE 1901',
    '2 SOUR @S9@', '3 PAGE 22', '0 @S9@ SOUR', '1 TITL Sổ hộ tịch', '0 TRLR', ''].join('\n');
  const doc = G.readGedcom(R, text);
  const src = doc.sources.find((s) => s.title === 'Sổ hộ tịch');
  assert.equal(src.kind, 'khac'); assert.equal(src.year, null); assert.equal(src.url, '');
  const fact = doc.persons[0].facts.find((f) => f.tag === 'BIRT');
  assert.equal(fact.sources[0].title, 'Sổ hộ tịch'); assert.equal(fact.sources[0].page, '22');
});
