// Tên chữ Hán (persons.data.name_han): the rule (server/core.js and web/js/formrules.js agree), the API field,
// and GEDCOM export and import (a second NAME with TYPE han). No database needed.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { validateValue, validateOp, mergeOp, hanNameError, publicView } = require('../core');
const G = require('../gedcom');

let R; let webRules;
test.before(async () => {
  R = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'events.js')).href);
  webRules = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'formrules.js')).href);
});

test('name_han: Han characters and spaces, at most 40 characters; empty is allowed', () => {
  for (const ok of ['阮文', '阮 文 ', '楊氏 𠀀', '  ', '']) assert.strictEqual(hanNameError(ok), null, JSON.stringify(ok));
  for (const bad of ['Nguyễn', 'Dương 文', '阮文1', '阮-文', '阮文!', '阮'.repeat(41)]) assert.notStrictEqual(hanNameError(bad), null, JSON.stringify(bad));
  assert.strictEqual(hanNameError('阮'.repeat(40)), null, '40 characters is the limit');
});

test('name_han: the server rule and the form rule give the same answer', async () => {
  for (const v of ['阮文', 'Nguyễn', '阮 文', '阮'.repeat(40), '阮'.repeat(41), '阮1', '']) {
    assert.strictEqual(hanNameError(v) === null, webRules.hanNameError(v) === null, JSON.stringify(v));
  }
});

test('name_han: validateValue and validateOp refuse a bad value and accept a good one', () => {
  assert.strictEqual(validateValue('name_han', '阮文'), null);
  assert.notStrictEqual(validateValue('name_han', 'Nguyễn'), null);
  assert.strictEqual(validateValue('name_han', 3), 'name_han must be text');
  assert.strictEqual(validateOp({ op_id: 'a', id: 'P001', fields: { name_han: '阮文' } }), null);
  assert.notStrictEqual(validateOp({ op_id: 'a', id: 'P001', fields: { name_han: 'Nguyễn' } }), null);
});

test('name_han: stored like any text field, an empty value clears it; the public view keeps it', () => {
  const m = mergeOp({ data: { name: 'Dương Văn Ất' }, field_ts: {} }, { op_id: 'a', id: 'P001', ts: 1, fields: { name_han: '楊文乙' } }, 10);
  assert.strictEqual(m.data.name_han, '楊文乙');
  const c = mergeOp(m, { op_id: 'b', id: 'P001', ts: 2, fields: { name_han: '' } }, 10);
  assert.strictEqual(c.data.name_han, undefined);
  assert.strictEqual(publicView({ name: 'A', died: '1950', name_han: '阮文' }).name_han, '阮文');
});

const fixture = () => ({
  persons: [{ id: 'P001', data: { name: 'Dương Văn Ất', sex: 'm', born: '1900', alias: 'Ất Cụ', name_han: '楊文乙' } },
    { id: 'P002', data: { name: 'Lê Thị Bảy', sex: 'f', born: '1905' } }],
  events: [], pc: [], cp: [],
});
const exportOf = (fx) => G.buildExport({ R, family: { name: 'Họ Dương' }, ...fx });
const planOf = (text, fx) => G.planImport(G.readGedcom(R, text), { R, F: null, persons: fx.persons, events: fx.events, pc: fx.pc, cp: fx.cp, relMode: 'table', newId: () => 'N000000' });

test('GEDCOM export: the Hán name is a second NAME with TYPE han, after the primary name and the alias', () => {
  const text = exportOf(fixture());
  const lines = text.split(/\r?\n/);
  const i = lines.indexOf('1 NAME Dương Văn Ất'.replace('Dương Văn Ất', '/Dương/ Văn Ất'));
  assert.ok(i >= 0, 'primary NAME line');
  const han = lines.indexOf('1 NAME 楊文乙');
  assert.ok(han > i, 'Hán NAME line after the primary name');
  assert.strictEqual(lines[han + 1], '2 TYPE han');
  assert.ok(lines.indexOf('2 TYPE aka') < han, 'alias NAME stays before the Hán NAME');
});

test('GEDCOM round trip: export then import keeps name_han and changes nothing', () => {
  const fx = fixture();
  const plan = planOf(exportOf(fx), fx);
  assert.strictEqual(plan.counts.conflicts, 0);
  assert.strictEqual(plan.counts.fields_fill, 0, JSON.stringify(plan.items.filter((i) => i.fields.length)));
  const doc = G.readGedcom(R, exportOf(fx));
  assert.strictEqual(doc.persons.find((p) => p.xref === 'P001').han, '楊文乙');
  assert.strictEqual(doc.persons.find((p) => p.xref === 'P001').name, 'Dương Văn Ất', 'the primary name is still the first NAME');
});

test('GEDCOM import: a Hán NAME fills an empty name_han; an invalid one is ignored', () => {
  const file = (han) => `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n0 @P001@ INDI\n1 NAME /Dương/ Văn Ất\n2 GIVN Văn Ất\n2 SURN Dương\n1 NAME ${han}\n2 TYPE han\n1 SEX M\n0 TRLR\n`;
  const fx = { persons: [{ id: 'P001', data: { name: 'Dương Văn Ất', sex: 'm' } }], events: [], pc: [], cp: [] };
  const ok = planOf(file('楊文乙'), fx);
  assert.strictEqual(ok.persons.find((p) => p.id === 'P001').fill.name_han, '楊文乙');
  const bad = planOf(file('Dương'), fx);
  assert.strictEqual(bad.persons.find((p) => p.id === 'P001').fill.name_han, undefined, 'a non-Hán value is not imported');
});

