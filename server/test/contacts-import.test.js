// Unit tests for contact import, on the device: web/js/contacts-parse.js (the same file the browser runs). vCard 3/4 and
// CSV parsing, phone and email cleaning, name matching (diacritics-insensitive, exact vs candidate), the Contact Picker shape.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

let CI; let fz;
const webJs = (f) => pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href;
test.before(async () => { CI = await import(webJs('contacts-parse.js')); fz = await import(webJs('fuzzy.js')); });

const VCF3 = [
  'BEGIN:VCARD', 'VERSION:3.0', 'N:Dương;Văn Cha;;;', 'FN:Dương Văn Cha',
  'TEL;TYPE=CELL:0900 000 001', 'TEL;TYPE=HOME:+84 28 3822 1234', 'EMAIL;TYPE=INTERNET:Cha@Example.test',
  'END:VCARD',
].join('\r\n');
const VCF4 = [
  'BEGIN:VCARD', 'VERSION:4.0', 'FN:Nguyễn Thị Hoa', 'N:Nguyễn;Thị Hoa;;;',
  'item1.TEL;VALUE=uri;TYPE=cell:tel:+84-912-345-678', 'item2.EMAIL:hoa@example.test',
  'NOTE:bỏ qua', 'END:VCARD',
].join('\n');
const VCF_NO_FN = 'BEGIN:VCARD\nVERSION:3.0\nN:Lê;Văn Ba;;;\nTEL:0911222333\nEND:VCARD\n';
const VCF_FOLDED = 'BEGIN:VCARD\nVERSION:3.0\nFN:Trần Văn\n  Tư\nTEL:0988777666\nEND:VCARD\n';
const VCF_ESC = 'BEGIN:VCARD\nVERSION:3.0\nFN:Phạm\\, Văn Năm\\; Jr\nTEL:0900000020\nEND:VCARD\n';

test('vCard 3.0: name from FN, phones and email cleaned, the email lower-cased', () => {
  const r = CI.parseContacts(VCF3, 'contacts.vcf');
  assert.equal(r.format, 'vcard');
  assert.deepEqual(r.contacts, [{ name: 'Dương Văn Cha', phones: ['0900000001', '+842838221234'], emails: ['cha@example.test'] }]);
});

test('vCard 4.0: tel: URI, item groups and parameters, extra properties ignored', () => {
  const [c] = CI.parseVcard(VCF4);
  assert.deepEqual(c, { name: 'Nguyễn Thị Hoa', phones: ['+84912345678'], emails: ['hoa@example.test'] });
});

test('vCard: no FN falls back to N (family given); folded lines are joined; escapes are read', () => {
  assert.deepEqual(CI.parseVcard(VCF_NO_FN), [{ name: 'Lê Văn Ba', phones: ['0911222333'], emails: [] }]);
  assert.deepEqual(CI.parseVcard(VCF_FOLDED), [{ name: 'Trần Văn Tư', phones: ['0988777666'], emails: [] }]);
  assert.equal(CI.parseVcard(VCF_ESC)[0].name, 'Phạm, Văn Năm; Jr');
});

test('vCard: several cards, empty cards dropped, CRLF and LF both work', () => {
  const text = `${VCF3}\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nEND:VCARD\r\n${VCF_NO_FN}`;
  const list = CI.parseVcard(text);
  assert.equal(list.length, 2);
  assert.equal(list[1].name, 'Lê Văn Ba');
});

test('CSV with a header in any order (Vietnamese labels too), ; or , delimiter, quotes', () => {
  const csv = 'Email,Điện thoại,Họ tên\n"a@b.test",0900000002,"Đặng, Thị Bảy"\n';
  assert.deepEqual(CI.parseCsv(csv), [{ name: 'Đặng, Thị Bảy', phones: ['0900000002'], emails: ['a@b.test'] }]);
  const semi = 'name;phone;email\nLý Văn Tám;0900000003;\n';
  assert.deepEqual(CI.parseCsv(semi), [{ name: 'Lý Văn Tám', phones: ['0900000003'], emails: [] }]);
});

test('CSV without a header: columns are name, phone, email; several phones in one cell; BOM and quoted quote', () => {
  const csv = '﻿Võ Văn Chín,"0900000004; 0900000005",v@x.test\n"Chữ ""Nghĩa""",0900000006,\n';
  const list = CI.parseCsv(csv);
  assert.deepEqual(list[0], { name: 'Võ Văn Chín', phones: ['0900000004', '0900000005'], emails: ['v@x.test'] });
  assert.equal(list[1].name, 'Chữ "Nghĩa"');
});

test('phones: junk and too-short numbers are dropped; emails must look like one', () => {
  assert.equal(CI.cleanPhone('12-34'), '');
  assert.equal(CI.cleanPhone('0900.000.007'), '0900000007');
  assert.equal(CI.cleanEmail('not-an-email'), '');
  assert.equal(CI.cleanEmail('mailto:Ok@Example.test'), 'ok@example.test');
  const c = CI.normalizeContact({ name: 'X', phones: ['abc', '0900000008', '0900000008'], emails: ['bad'] });
  assert.deepEqual(c, { name: 'X', phones: ['0900000008'], emails: [] });
  assert.equal(CI.normalizeContact({ name: '', phones: ['x'], emails: [] }), null);
});

test('parseContacts refuses oversized text and falls back to CSV for anything else', () => {
  assert.throws(() => CI.parseContacts('a'.repeat(CI.MAX_TEXT + 1)), /quá lớn/);
  assert.equal(CI.parseContacts('Nam,0900000009,\n').format, 'csv');
});

// Matching: persons as the server reads them (rows with data.name).
const PERSONS = [
  { id: 'P001', data: { name: 'Dương Văn Cha' } },
  { id: 'P002', data: { name: 'Dương Thị Mẹ' } },
  { id: 'P003', data: { name: 'Nguyễn Văn An' } },
  { id: 'P004', data: { name: 'Nguyen Van An' } }, // same letters without diacritics: two exact people
  { id: 'P005', data: { name: 'Trần Thị Bích' } },
  { id: 'P006', data: { name: 'Lê Đức Đông' } },
  { id: 'P007', data: { name: 'Cũ Đã Xóa' }, deleted: true },
];

test('matching: exact name (diacritics and token order ignored) is auto-checked; one exact only', () => {
  const [a, b] = CI.matchContacts([
    { name: 'văn cha dương', phones: [], emails: [] },
    { name: 'Trần Thị Bích', phones: ['0900000010'], emails: [] },
  ], PERSONS, fz);
  assert.equal(a.auto, true);
  assert.equal(a.candidates[0].id, 'P001');
  assert.equal(a.candidates[0].exact, true);
  assert.equal(b.candidates[0].id, 'P005');
  assert.equal(b.auto, true);
});

test('matching: two people with the same name letters -> both exact, nothing checked by default', () => {
  const [m] = CI.matchContacts([{ name: 'Nguyễn Văn An', phones: [], emails: [] }], PERSONS, fz);
  assert.equal(m.auto, false);
  assert.deepEqual(m.candidates.filter((c) => c.exact).map((c) => c.id).sort(), ['P003', 'P004']);
});

test('matching: a typo or a shorter name is a candidate (not exact, not checked); deleted people never match', () => {
  const [typo, short, none, deleted] = CI.matchContacts([
    { name: 'Lê Đức Dong', phones: [], emails: [] }, // typo-free after fold: exact
    { name: 'Dương Mẹ', phones: [], emails: [] }, // subset of "Dương Thị Mẹ": candidate
    { name: 'Hoàng Nam', phones: [], emails: [] },
    { name: 'Cu Da Xoa', phones: [], emails: [] },
  ], PERSONS, fz);
  assert.equal(typo.candidates[0].id, 'P006');
  assert.equal(typo.auto, true);
  assert.equal(short.candidates[0].id, 'P002');
  assert.equal(short.candidates[0].exact, false);
  assert.equal(short.auto, false);
  assert.equal(none.candidates.length, 0);
  assert.equal(deleted.candidates.length, 0);
});

test('matching: candidates are capped and contact values pass through', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ id: 'P10' + i, data: { name: 'Phạm Văn Nhiều ' + i } }));
  const [m] = CI.matchContacts([{ name: 'Phạm Văn Nhiều', phones: ['0900000011'], emails: ['n@x.test'] }], many, fz);
  assert.equal(m.candidates.length, 3);
  assert.deepEqual(m.phones, ['0900000011']);
  assert.deepEqual(m.emails, ['n@x.test']);
});

test('picker shape: name is a list, tel and email are lists; empty picker entries are dropped', () => {
  const list = CI.fromPicker([
    { name: ['Phan Văn Mười'], tel: ['090 000 0012'], email: ['M@X.test'] },
    { name: [], tel: [], email: [] },
  ]);
  assert.deepEqual(list, [{ name: 'Phan Văn Mười', phones: ['0900000012'], emails: ['m@x.test'] }]);
});
