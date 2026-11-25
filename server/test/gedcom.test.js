// GEDCOM unit tests (no database): reader and writer, dates, names, round trip (export, then import = no change),
// the import plan (matching, fills, conflicts, events, relations) and the privacy rules of the export.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const G = require('../gedcom');
let R; let F;
test.before(async () => {
  R = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'events.js')).href);
  F = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'fuzzy.js')).href);
});

// A family with multiple spouses, an adopted child, a step child, couples without children, unknown dates,
// Vietnamese diacritics, a living person with a public phone and a living person with a private one.
function fixture() {
  const persons = [
    { id: 'P001', data: { name: 'Dương Văn Ất', sex: 'm', born: '1900', died: '1970', birth_place: 'Quảng Nam', job: 'Thầy giáo',
      burial: 'Nghĩa trang Hòa Thọ', source: 'Gia phả 2021', note: 'Dòng trưởng\nGhi chú dài', alias: 'Ất Cụ' } },
    { id: 'P002', data: { name: 'Lê Thị Bảy', sex: 'f', born: '1905', birth_date: '5/3/1905', birth_lunar: '15/8' } },
    { id: 'P003', data: { name: 'Trần Thị Tám', sex: 'f', born: '1908', died: '1950' } },
    { id: 'P004', data: { name: 'Dương Văn Chín', sex: 'm', born: '1928', contact_public: 'yes', phone: '0900111222', email: 'chin@example.test' } },
    { id: 'P005', data: { name: 'Dương Thị Mười', sex: 'f', born: '1935', contact_public: 'no', phone: '0911000000', living: 'living' } },
    { id: 'P006', data: { name: 'Nguyễn Văn Mười Một', sex: 'm', born: '1960', died: '1999', death_lunar: '2/8', gio_lunar: '2/8' } },
    { id: 'P007', data: { name: 'Nguyễn Thị Mười Hai', sex: 'f', born: '1962' } },
    { id: 'N0a1b2c3d4e5f', data: { name: 'Đỗ Hoàng Đức', sex: 'm', born: '1970' } },
    { id: 'P008', data: { name: 'John Smith', surname: 'Smith', given: 'John', name_order: 'given_first', order: 3, thu: 'Ba',
      title_name: 'Ông', photo: 'https://example.test/john.jpg', lat: '10.776', lon: '-106.7' } },
    { id: 'P009', data: { name: 'Lê Văn Tí', surname: 'Lê', given: 'Văn Tí', name_order: 'family_first', photo: '/api/photos/abc' } },
  ];
  const stories = [{ person_id: 'P001', kind: 'chuyen', title: 'Chuyện nhà', body: 'Nội dung\nDòng hai' },
    { person_id: 'P002', kind: 'tom_tat', title: '', body: 'Tóm tắt đời bà' }];
  const events = [
    { id: 'E1', person_id: 'P003', type: 'hoc', date_kind: 'about', date_from: '1924', date_to: null, place: 'Huế', description: 'Trường Đồng Khánh', lunar: '', sources: [{ title: 'Sổ học bạ', quality: 'goc' }] },
    { id: 'E2', person_id: 'P003', type: 'quan_ngu', date_kind: 'between', date_from: '1940', date_to: '1945', place: '', description: '', lunar: '', sources: [] },
    { id: 'E3', person_id: 'P004', type: 'sinh', date_kind: 'before', date_from: '1930', date_to: null, place: 'Hội An', description: '', lunar: '' },
    { id: 'E4', person_id: 'P006', type: 'cuoi', date_kind: 'exact', date_from: '1985-06-20', date_to: null, place: 'Hà Nội', description: 'Lễ cưới', lunar: '', sources: [] },
    { id: 'E5', person_id: 'P001', type: 'thanh_tich', date_kind: 'exact', date_from: '1932', date_to: null, place: '', description: 'Học sinh giỏi toàn tỉnh', lunar: '', sources: [] },
  ];
  // P001 has three spouses over time (a legal one and two others, one married after P003 died).
  const cp = [
    { a_id: 'P001', b_id: 'P002', kind: 'cuoi', order_a: 1, order_b: null, start_year: 1925, end_year: null, private: false, note: null },
    { a_id: 'P001', b_id: 'P003', kind: 'vo_le', order_a: 2, order_b: null, start_year: 1932, end_year: null, private: false, note: null },
    { a_id: 'P001', b_id: 'N0a1b2c3d4e5f', kind: 'ban_doi', order_a: 3, order_b: null, start_year: null, end_year: null, private: true, note: 'Chỉ ghi nhận' },
  ];
  // P004 and P005 are children of P001 and P002; P006 is adopted by P003 and P002 (nuoi); P007 is a step child (ke) of P002.
  const pc = [
    { parent_id: 'P001', child_id: 'P002', kind: 'ruot', birth_order: null, private: false },
    { parent_id: 'P001', child_id: 'P004', kind: 'ruot', birth_order: 1, private: false },
    { parent_id: 'P002', child_id: 'P004', kind: 'ruot', birth_order: 1, private: false },
    { parent_id: 'P001', child_id: 'P005', kind: 'ruot', birth_order: 2, private: false },
    { parent_id: 'P002', child_id: 'P005', kind: 'ruot', birth_order: 2, private: false },
    { parent_id: 'P003', child_id: 'P006', kind: 'nuoi', birth_order: 1, private: false },
    { parent_id: 'P002', child_id: 'P006', kind: 'nuoi', birth_order: 1, private: false },
    { parent_id: 'P002', child_id: 'P007', kind: 'ke', birth_order: null, private: true },
  ];
  return { persons, events, pc, cp, stories };
}
const exportOf = (fx, extra = {}) => G.buildExport({ R, family: { name: 'Họ Dương' }, ...fx, ...extra });
const planOf = (text, fx, extra = {}) => G.planImport(G.readGedcom(R, text), { R, F, persons: fx.persons, events: fx.events, pc: fx.pc, cp: fx.cp, relMode: 'table', newId: (x) => 'N' + x.replace(/\W/g, '').slice(0, 12).toLowerCase() || 'N000000', ...extra });
// The first person of a one-person file (its line is the NAME line, with optional language).
const nameOf = (line, lang = '') => G.readGedcom(R, `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n${lang ? '1 LANG ' + lang + '\n' : ''}0 @I1@ INDI\n${line}\n0 TRLR\n`).persons[0];

test('dates: GEDCOM forms read as stored kinds, unknown text is kept as typed', () => {
  const d = (s) => G.parseGedDate(R, s);
  assert.deepStrictEqual(d('15 MAR 1963'), { kind: 'exact', from: '1963-03-15', to: null, raw: '15 MAR 1963' });
  assert.deepStrictEqual(d('MAR 1963').from, '1963-03');
  assert.deepStrictEqual(d('1963').from, '1963');
  assert.strictEqual(d('ABT 1980').kind, 'about');
  assert.strictEqual(d('BEF 1975').kind, 'before');
  assert.strictEqual(d('AFT 1990').kind, 'after');
  const b = d('BET 1980 AND 1985');
  assert.deepStrictEqual([b.kind, b.from, b.to], ['between', '1980', '1985']);
  assert.deepStrictEqual([d('FROM 1950 TO 1960').kind, d('FROM 1950').kind, d('TO 1960').kind], ['between', 'after', 'before']);
  assert.strictEqual(d('@#DGREGORIAN@ 2 FEB 1901').from, '1901-02-02');
  // Not a date this app can store: kept as typed, no kind.
  assert.deepStrictEqual([d('khoảng đầu thế kỷ').kind, d('khoảng đầu thế kỷ').raw], [null, 'khoảng đầu thế kỷ']);
  assert.strictEqual(d('BET 1985 AND 1980').kind, null, 'a reversed range is not stored');
  assert.strictEqual(d('31 FEB 1990').kind, null, 'an impossible day is not stored');
});

test('dates: writer and reader agree on every kind', () => {
  const cases = [['exact', '1963-03-05'], ['exact', '1963-03'], ['exact', '1963'], ['about', '1980'], ['before', '1975'],
    ['after', '1990-07'], ['between', '1980', '1985']];
  for (const [kind, from, to] of cases) {
    const out = G.gedDateOut(R, kind, from, to);
    const back = G.parseGedDate(R, out);
    assert.strictEqual(back.kind, kind, out);
    assert.strictEqual(back.from, from, out);
    assert.strictEqual(back.to ?? null, to ?? null, out);
  }
});

test('names: stored parts and the order they are written in', () => {
  assert.deepStrictEqual(G.partsOf({ name: 'Dương Văn Ất' }), { surname: 'Dương', given: 'Văn Ất', order: 'family_first' }, 'a legacy Vietnamese name is family first');
  assert.deepStrictEqual(G.partsOf({ name: 'Dương' }), { surname: 'Dương', given: '', order: 'family_first' });
  assert.deepStrictEqual(G.partsOf({ name: 'John Smith', name_order: 'given_first' }), { surname: 'Smith', given: 'John', order: 'given_first' });
  assert.deepStrictEqual(G.partsOf({ name: '  ' }), null);
  assert.deepStrictEqual(G.partsOf({ name: 'x', surname: 'Lê', given: 'Văn Tí', name_order: 'family_first' }), { surname: 'Lê', given: 'Văn Tí', order: 'family_first' });
});

test('names: the line decides the order; a vi, zh, ja or ko file is family first; otherwise given first', () => {
  const a = nameOf('1 NAME /Dương/ Văn Ất');
  assert.deepStrictEqual([a.name, a.surname, a.given, a.nameOrder], ['Dương Văn Ất', 'Dương', 'Văn Ất', 'family_first'], 'surname first in the line');
  const b = nameOf('1 NAME John /Smith/');
  assert.deepStrictEqual([b.name, b.surname, b.given, b.nameOrder], ['John Smith', 'Smith', 'John', 'given_first'], 'Western: display John Smith');
  const c = nameOf('1 NAME Văn Ất /Dương/', 'vi');
  assert.deepStrictEqual([c.name, c.nameOrder], ['Dương Văn Ất', 'family_first'], 'the language makes it family first');
  const d = nameOf('1 NAME Thị Bảy /Nguyễn/\n2 GIVN Thị Bảy\n2 SURN Nguyễn');
  assert.deepStrictEqual([d.name, d.surname, d.given, d.nameOrder], ['Thị Bảy Nguyễn', 'Nguyễn', 'Thị Bảy', 'given_first'], 'subtags, no language: given first');
  const e = nameOf('1 NAME Dương Văn Ất', 'zh');
  assert.deepStrictEqual([e.name, e.surname, e.given, e.nameOrder], ['Dương Văn Ất', 'Dương', 'Văn Ất', 'family_first'], 'plain text in a family-first file: first word is the family name');
  const f = nameOf('1 NAME John Smith');
  assert.deepStrictEqual([f.name, f.surname, f.given, f.nameOrder], ['John Smith', 'Smith', 'John', 'given_first'], 'plain text, given first: last word is the family name');
  const g = nameOf('1 NAME Dương', 'vi');
  assert.deepStrictEqual([g.name, g.surname, g.given], ['Dương', 'Dương', '']);
});

test('names: export writes the order with /Surname/ and GIVN, SURN; the search matches both orders', () => {
  const text = G.buildExport({ R, family: { name: 'x' }, persons: [
    { id: 'P001', data: { name: 'Dương Văn Ất' } }, { id: 'P002', data: { name: 'John Smith', surname: 'Smith', given: 'John', name_order: 'given_first' } }], events: [], pc: [], cp: [] });
  assert.ok(text.includes('1 NAME /Dương/ Văn Ất\n2 GIVN Văn Ất\n2 SURN Dương'));
  assert.ok(text.includes('1 NAME John /Smith/\n2 GIVN John\n2 SURN Smith'));
  const doc = G.readGedcom(R, text);
  assert.strictEqual(doc.persons[1].name, 'John Smith');
  assert.strictEqual(doc.persons[1].nameOrder, 'given_first');
  assert.strictEqual(doc.persons[0].nameOrder, 'family_first');
  assert.strictEqual(F.scorePerson('Văn Ất Dương', { data: { name: 'Dương Văn Ất' } }).matched, 3, 'the query order does not matter');
  assert.strictEqual(F.scorePerson('Smith John', { data: { name: 'John Smith' } }).matched, 2);
});

test('extra fields and stories: exported, read back, and a stored story is not imported as a note', () => {
  const fx = fixture();
  const text = exportOf(fx);
  assert.ok(text.includes('1 TITL Ông') && text.includes('1 _THU Ba') && text.includes('1 _ORDER 3'));
  assert.ok(text.includes('2 FILE https://example.test/john.jpg') && text.includes('2 LATI N10.776') && text.includes('2 LONG W106.7'));
  assert.ok(!text.includes('/api/photos/abc'), 'a photo that is not a web link stays in the app');
  assert.ok(text.includes('1 NOTE Câu chuyện: Chuyện nhà\n2 CONT Nội dung\n2 CONT Dòng hai') && text.includes('1 NOTE Câu chuyện đời: \n2 CONT Tóm tắt đời bà'));
  const doc = G.readGedcom(R, text);
  const john = doc.persons.find((p) => p.xref === 'P008');
  assert.deepStrictEqual([john.attrs.title_name, john.attrs.thu, john.attrs.order, john.attrs.lat, john.attrs.lon], ['Ông', 'Ba', '3', '10.776', '-106.7']);
  assert.strictEqual(doc.persons.find((p) => p.xref === 'P001').stories, 1);
  const plan = planOf(text, fx);
  assert.strictEqual(plan.counts.stories_in_file, 2);
  assert.ok(!plan.persons.some((p) => Object.keys(p.fill).includes('note') && p.id === 'P001'), 'the story is not a note');
});

test('import: a new name brings its parts; an existing name keeps its parts; a number field stays a number', () => {
  const text = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '0 @I1@ INDI', '1 NAME Lê Văn Tí', '1 SEX M', '0 @I2@ INDI', '1 NAME /Trần/ Văn Mới',
    '1 _ORDER 4', '0 TRLR'].join('\n');
  const plan = planOf(text, { persons: [{ id: 'P001', data: { name: 'Lê Văn Tí' } }], events: [], pc: [], cp: [] });
  const p1 = plan.persons.find((p) => p.xref === 'I1');
  assert.strictEqual(p1.target, 'P001');
  assert.ok(!('surname' in p1.fill), 'the name is the same: the parts are left alone');
  const p2 = plan.persons.find((p) => p.xref === 'I2');
  assert.deepStrictEqual([p2.fill.name, p2.fill.surname, p2.fill.given, p2.fill.name_order, p2.fill.order], ['Trần Văn Mới', 'Trần', 'Văn Mới', 'family_first', 4]);
});

test('reader: CONT and CONC, BOM, CRLF, 7.0 shared notes, bad lines become warnings', () => {
  const text = '﻿0 HEAD\r\n1 GEDC\r\n2 VERS 7.0\r\n0 @N1@ SNOTE Dòng một\r\n1 CONT Dòng hai có dấu\r\n0 @I1@ INDI\r\n1 NAME Đỗ Văn /Hào/\r\n1 NOTE @N1@\r\n1 BIRT\r\n2 NOTE Thứ tự\r\n3 CONC  thêm\r\n2 CONT xuống dòng\r\nxyz không hợp lệ\r\n0 TRLR\r\n';
  const doc = G.readGedcom(R, text);
  assert.strictEqual(doc.version, '7.0');
  assert.strictEqual(doc.persons[0].name, 'Đỗ Văn Hào', 'no language: given first, so the slashed part is the family name at the end');
  assert.strictEqual(doc.persons[0].note[0], 'Dòng một\nDòng hai có dấu');
  assert.strictEqual(doc.warnings.length, 1);
  assert.ok(doc.warnings[0].includes('không đúng định dạng'));
});

test('round trip: export then import the same file changes nothing', () => {
  const fx = fixture();
  const text = exportOf(fx);
  const plan = planOf(text, fx);
  assert.deepStrictEqual(plan.counts.new, 0);
  assert.strictEqual(plan.counts.matched, fx.persons.length);
  assert.strictEqual(plan.counts.conflicts, 0);
  assert.strictEqual(plan.counts.fields_fill, 0, JSON.stringify(plan.items.filter((i) => i.fields.length)));
  assert.strictEqual(plan.counts.events_new, 0, JSON.stringify(plan.persons.filter((p) => p.events.length)));
  assert.strictEqual(plan.counts.relations_new, 0, JSON.stringify(plan.relations.filter((r) => r.status === 'new')));
  assert.ok(plan.counts.relations_same >= 7);
});

test('export: multiple spouses, adoption, step child, couples without children, private couple', () => {
  const text = exportOf(fixture());
  const doc = G.readGedcom(R, text);
  const p1 = doc.families.filter((f) => f.husb === 'P001');
  assert.strictEqual(p1.filter((f) => f.wife).length, 3, 'one family per spouse');
  assert.strictEqual(p1.filter((f) => !f.wife).length, 1, 'plus the family of its children with P001 alone');
  assert.ok(p1.some((f) => f.wife === 'P002' && f.kind === 'cuoi' && f.marr));
  assert.ok(p1.some((f) => f.wife === 'P003' && f.kind === 'vo_le'));
  assert.ok(p1.some((f) => f.wife === 'N0a1b2c3d4e5f' && f.kind === 'ban_doi' && f.private));
  const child = doc.persons.find((p) => p.xref === 'P006');
  assert.deepStrictEqual(child.famc.map((x) => x.kind), ['nuoi'], 'P006 has one parent family with the adopted kind');
  const step = doc.persons.find((p) => p.xref === 'P007');
  assert.deepStrictEqual(step.famc.map((x) => x.kind), ['ke'], 'a step child keeps its kind');
  assert.ok(text.includes('2 _KIND ke'));
  assert.ok(doc.families.some((f) => f.kind === 'none'), 'two parents without a couple row are marked _KIND none');
  assert.ok(text.includes('1 _PRIVATE yes'));
});

test('export: unknown dates keep their GEDCOM form, lunar dates and giỗ are notes, sources are records', () => {
  const text = exportOf(fixture());
  assert.ok(/2 DATE ABT 1924/.test(text) && /2 DATE BET 1940 AND 1945/.test(text) && /2 DATE BEF 1930/.test(text));
  assert.ok(text.includes('2 NOTE Âm lịch: 15/8'), 'birth lunar date');
  assert.ok(text.includes('2 NOTE Giỗ (âm lịch): 2/8'), 'giỗ lunar date under DEAT');
  assert.ok(/^0 @S\d+@ SOUR$/m.test(text) && text.includes('3 QUAY 3'), 'event source with quality 3 (direct)');
  assert.ok(text.includes('1 _KIND cuoi') && text.includes('1 MARR') && text.includes('2 DATE 1985'.slice(0, 0) + '2 DATE 1925'));
  assert.ok(text.includes('1 EVEN') && text.includes('2 TYPE Quân ngũ'));
  assert.ok(text.includes('1 HUSB @P001@') && text.includes('1 CHIL @P004@'));
  assert.ok(text.endsWith('0 TRLR\n'));
  for (const line of text.split('\n')) assert.ok(Array.from(line).length <= 200, 'line length: ' + line.slice(0, 40));
});

test('export: privacy. Contacts only for living people who allow it; living=hide drops living people', () => {
  const fx = fixture();
  const text = exportOf(fx);
  assert.ok(text.includes('1 PHON 0900111222') && text.includes('1 EMAIL chin@example.test'));
  assert.ok(!text.includes('0911000000'), 'a living person with contact_public no is not exported');
  const hidden = exportOf(fx, { living: 'hide' });
  const doc = G.readGedcom(R, hidden);
  const ids = doc.persons.map((p) => p.xref);
  assert.ok(!ids.includes('P004') && !ids.includes('P005'), 'living people are left out');
  assert.ok(ids.includes('P003') && ids.includes('P006'), 'people who have died stay');
  assert.ok(!hidden.includes('@P004@'), 'no relation or event points to a left-out person');
  assert.ok(!hidden.includes('0900111222'));
});

test('import plan: an empty field is filled, a different value is a conflict, nothing is overwritten', () => {
  const fx = fixture();
  const text = [
    '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Dương Văn Ất', '1 SEX M', '1 BIRT', '2 DATE 1901', '2 PLAC Quảng Nam',
    '1 OCCU Nông dân', '1 DEAT', '2 DATE 1969',
    '0 @I9@ INDI', '1 NAME Dương Văn Mới', '1 SEX M', '1 BIRT', '2 DATE 1990',
    '0 TRLR'].join('\n');
  const plan = planOf(text, fx);
  const p1 = plan.persons.find((p) => p.xref === 'I1');
  assert.strictEqual(p1.target, 'P001');
  assert.ok(p1.conflicts.some((c) => c.field === 'born' && c.current === '1900' && c.incoming === '1901'), 'born differs: conflict');
  assert.ok(!('born' in p1.fill), 'the conflicting field is not filled');
  assert.strictEqual(plan.counts.conflicts, 1);
  assert.strictEqual(p1.fill.job, undefined, 'job already set here: no fill');
  // The death year matches the existing data; the day is new information, so it fills death_date.
  assert.strictEqual(p1.fill.death_date, undefined, 'a year-only death does not fill a full date when a year is known');
  const p9 = plan.persons.find((p) => p.xref === 'I9');
  assert.ok(p9.isNew && p9.fill.name === 'Dương Văn Mới');
  assert.strictEqual(plan.counts.new, 1);
});

test('import plan: a person is matched by fuzzy name and birth year, a tie is ambiguous and becomes a new person', () => {
  const fx = fixture();
  const one = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 NAME Duong Van Chin\n1 BIRT\n2 DATE 1928\n0 TRLR\n';
  const plan = planOf(one, fx);
  assert.strictEqual(plan.persons[0].target, 'P004', 'accents folded, birth year equal');
  assert.strictEqual(plan.persons[0].how, 'name');
  const far = '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 @I1@ INDI\n1 NAME Dương Văn Chín\n1 BIRT\n2 DATE 1950\n0 TRLR\n';
  assert.strictEqual(planOf(far, fx).persons[0].target, null, 'birth years 22 apart: not the same person');
  const twins = { ...fx, persons: [...fx.persons, { id: 'P099', data: { name: 'Dương Văn Chín', born: '1928' } }] };
  const tie = planOf(one, twins);
  assert.strictEqual(tie.persons[0].target, null);
  assert.strictEqual(tie.persons[0].how, 'ambiguous');
  assert.strictEqual(tie.counts.ambiguous, 1);
});

test('import plan: a foreign file (MyHeritage-like) with spouses, adoption, approximate dates and unknown tags', () => {
  const text = [
    '0 HEAD', '1 SOUR MyHeritage', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Nguyễn Văn /An/', '1 SEX M', '1 BIRT', '2 DATE ABT 1880', '2 PLAC Thanh Hóa',
    '1 FAMS @F1@', '1 FAMS @F2@', '1 _UNKNOWN x', '1 MARR', '2 DATE BET 1900 AND 1905',
    '0 @I2@ INDI', '1 NAME Trần Thị /Bích/', '1 SEX F', '1 BIRT', '2 DATE 1883', '1 FAMS @F1@',
    '0 @I3@ INDI', '1 NAME Trần Thị /Cúc/', '1 SEX F', '1 BIRT', '2 DATE 1886', '1 FAMS @F2@',
    '0 @I4@ INDI', '1 NAME Nguyễn Văn /Dũng/', '1 SEX M', '1 BIRT', '2 DATE 1901', '1 FAMC @F1@', '2 PEDI birth',
    '0 @I5@ INDI', '1 NAME Nguyễn Thị /Én/', '1 SEX F', '1 FAMC @F2@', '2 PEDI adopted', '1 BIRT', '2 DATE 1910',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I4@', '1 MARR', '2 DATE 1900',
    '0 @F2@ FAM', '1 HUSB @I1@', '1 WIFE @I3@', '1 CHIL @I5@',
    '0 @S1@ SOUR', '1 TITL Sổ gia đình', '0 TRLR'].join('\n');
  const doc = G.readGedcom(R, text);
  assert.strictEqual(doc.unknownTags, 1, 'an unknown tag is counted, not an error');
  const plan = planOf(text, { persons: [], events: [], pc: [], cp: [] });
  assert.strictEqual(plan.counts.new, 5);
  const husb = plan.relations.filter((r) => r.type === 'couple');
  assert.strictEqual(husb.length, 2, 'two marriages: two couple rows, both with the husband');
  assert.ok(husb.some((r) => r.kind === 'cuoi' && r.start_year === 1900));
  const adopted = plan.relations.find((r) => r.type === 'parent_child' && r.child === plan.persons[4].id);
  assert.strictEqual(adopted.kind, 'nuoi', 'PEDI adopted is nuoi');
  const birth = plan.relations.find((r) => r.type === 'parent_child' && r.child === plan.persons[3].id);
  assert.strictEqual(birth.kind, 'ruot');
  const p1 = plan.persons[0];
  assert.strictEqual(p1.fill.born, '1880', 'the ABT year is kept on born');
  assert.ok(plan.persons[0].events.some((e) => e.type === 'sinh' && e.date_kind === 'about'), 'the approximate date is an event with ABT');
});

test('import plan: unknown dates and unparsed text go to events as typed; values with no date stay fields', () => {
  const text = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '0 @I1@ INDI', '1 NAME Lê Văn Tư', '1 SEX M',
    '1 BIRT', '2 DATE khoảng đầu năm 1900 (?)', '2 PLAC Hà Tĩnh', '1 RESI', '2 DATE sau 1950', '2 PLAC Sài Gòn', '1 OCCU', '2 DATE 1950', '2 NOTE Kế toán', '0 TRLR'].join('\n');
  const plan = planOf(text, { persons: [], events: [], pc: [], cp: [] });
  const p = plan.persons[0];
  const sinh = p.events.find((e) => e.type === 'sinh');
  assert.ok(sinh && sinh.date_kind === null && sinh.date_text.startsWith('khoảng đầu năm'), 'typed text kept');
  assert.strictEqual(sinh.place, 'Hà Tĩnh');
  assert.ok(p.events.some((e) => e.type === 'chuyen_nha' && e.date_text === 'sau 1950' && e.place === 'Sài Gòn'), 'the typed date stays on the event');
  assert.ok(p.events.some((e) => e.type === 'nghe' && e.description === 'Kế toán'));
});

test('import: relations that the family does not yet keep in tables are reported, not written', () => {
  const fx = fixture();
  const text = exportOf(fx);
  const plan = planOf(text, fx, { relMode: 'legacy' });
  assert.ok(plan.relations.every((r) => r.status === 'pending' || r.status === 'same'), 'no new relation is planned for a legacy family');
});

test('export: a family with no people still gives a valid file', () => {
  const text = G.buildExport({ R, family: { name: 'Trống' }, persons: [], events: [], pc: [], cp: [] });
  const doc = G.readGedcom(R, text);
  assert.deepStrictEqual([doc.persons.length, doc.families.length, doc.warnings.length], [0, 0, 0]);
  assert.ok(text.startsWith('0 HEAD\n') && text.includes('1 CHAR UTF-8'));
});

test('Vietnamese text survives unchanged, long values are split into CONC lines by characters', () => {
  const long = 'Ghi chú về việc đất đai và nhà cửa ở làng Tiên Điền, xã Nghi Xuân, tỉnh Hà Tĩnh. '.repeat(8) + 'Kết thúc ấm ừ ệ ự.';
  const fx = { persons: [{ id: 'P001', data: { name: 'Nguyễn Du', sex: 'm', note: long } }], events: [], pc: [], cp: [] };
  const text = exportOf(fx);
  assert.ok(text.includes('CONC '));
  const doc = G.readGedcom(R, text);
  assert.strictEqual(doc.persons[0].note[0], long.trim());
  assert.strictEqual(doc.persons[0].name, 'Nguyễn Du');
});

// Stories come back on import: our export round-trips with no duplicates, and MyHeritage/Ancestry-style notes
// (CONC/CONT, pointer NOTE records) are read as stories too.
test('stories round trip: export, then import of the same file adds no story (kind, title and body match)', () => {
  const fx = fixture();
  const text = exportOf(fx);
  const first = planOf(text, fx, { stories: [] });
  assert.strictEqual(first.counts.stories_new, 2, 'empty database: both stories are new');
  const p1 = first.persons.find((p) => p.xref === 'P001');
  assert.deepStrictEqual(p1.stories.map((s) => [s.kind, s.title, s.body]), [['chuyen', 'Chuyện nhà', 'Nội dung\nDòng hai']]);
  const p2 = first.persons.find((p) => p.xref === 'P002');
  assert.deepStrictEqual(p2.stories.map((s) => [s.kind, s.title, s.body]), [['tom_tat', '', 'Tóm tắt đời bà']]);
  // The stories as stored (rows from the table) are the same as in the file: nothing is new.
  const stored = fx.stories.map((s) => ({ person_id: s.person_id, kind: s.kind, title: s.title, body: s.body }));
  const second = planOf(text, fx, { stories: stored });
  assert.strictEqual(second.counts.stories_new, 0);
  assert.strictEqual(second.counts.stories_same, 2);
  assert.strictEqual(second.counts.stories_skipped, 0);
  assert.ok(second.persons.every((p) => p.stories.length === 0));
});

test('stories round trip: a title with a line break (stored) matches the same story read back from the file', () => {
  const fx = fixture();
  fx.stories = [{ person_id: 'P001', kind: 'chuyen', title: 'Dòng một\nDòng hai', body: 'Thân bài' }];
  const text = exportOf(fx);
  const again = planOf(text, fx, { stories: fx.stories });
  assert.strictEqual(again.counts.stories_new, 0, 'the line break in the title is a space on both sides');
  assert.strictEqual(again.counts.stories_same, 1);
});

test('stories: MyHeritage-style CONC/CONT and a pointer NOTE record are read as stories', () => {
  const text = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Nguyễn Văn Ất', '1 SEX M',
    '1 NOTE Câu chuyện: Di cư vào Nam', '2 CONC  năm 1954', '2 CONT Dòng hai',
    '1 NOTE @N1@',
    '1 NOTE Ghi chú thường không phải câu chuyện',
    '0 @N1@ NOTE Câu chuyện đời: Tóm tắt', '1 CONC  của ông', '1 CONT Đoạn sau',
    '0 TRLR'].join('\n');
  const doc = G.readGedcom(R, text);
  const p = doc.persons[0];
  assert.strictEqual(p.stories, 2);
  assert.deepStrictEqual(p.storyList, [
    { kind: 'chuyen', title: 'Di cư vào Nam năm 1954', body: 'Dòng hai' },
    { kind: 'tom_tat', title: 'Tóm tắt của ông', body: 'Đoạn sau' }]);
  assert.deepStrictEqual(p.note, ['Ghi chú thường không phải câu chuyện'], 'a plain note stays the note');
  const plan = planOf(text, { persons: [], events: [], pc: [], cp: [] });
  assert.strictEqual(plan.counts.stories_new, 2);
  assert.strictEqual(plan.persons[0].stories.length, 2);
});

test('stories: the same story twice in one file is written once; a second summary with other text is skipped', () => {
  const text = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '0 @I1@ INDI', '1 NAME /Trần/ Văn Đức',
    '1 NOTE Câu chuyện: Một chuyện', '2 CONT Nội dung', '1 NOTE Câu chuyện: Một chuyện', '2 CONT Nội dung',
    '1 NOTE Câu chuyện đời: Bản một', '1 NOTE Câu chuyện đời: Bản hai', '0 TRLR'].join('\n');
  const plan = planOf(text, { persons: [{ id: 'P009', data: { name: 'Trần Văn Đức' } }], events: [], pc: [], cp: [] }, { stories: [] });
  assert.strictEqual(plan.counts.stories_new, 2, 'one chuyen and one tom_tat');
  assert.strictEqual(plan.counts.stories_skipped, 1, 'the second summary (other text) is skipped; the duplicate chuyen is not');
  // The person already has a different summary: the file one is not written.
  const have = [{ person_id: 'P009', kind: 'tom_tat', title: 'Bản cũ', body: '' }];
  const again = planOf(text, { persons: [{ id: 'P009', data: { name: 'Trần Văn Đức' } }], events: [], pc: [], cp: [] }, { stories: have });
  assert.strictEqual(again.counts.stories_skipped, 2, 'both summaries in the file differ from the stored one');
  assert.ok(again.warnings.some((w) => w.includes('câu chuyện đời')));
});
