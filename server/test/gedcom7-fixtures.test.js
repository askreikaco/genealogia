// GEDCOM 7.0 fixtures (server/test/fixtures/gedcom7/): the reader must accept each file as version 7.0 and give the
// counts below. These are regression goldens; the files are hand-written (see fixtures/gedcom7/README.md for why).
// Pure: no database, no HTTP. Uses readGedcom the same way as gedcom.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const G = require('../gedcom');
let R;
test.before(async () => {
  R = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'events.js')).href);
});

const dir = path.join(__dirname, 'fixtures', 'gedcom7');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

// [file, persons, families]
const GOLDENS = [
  ['minimal.ged', 0, 0],
  ['family.ged', 3, 1],
  ['remarriage.ged', 4, 2],
];

for (const [file, persons, families] of GOLDENS) {
  test(`gedcom 7.0 fixture ${file}: reads as 7.0 with ${persons} persons and ${families} families`, () => {
    const doc = G.readGedcom(R, read(file));
    assert.equal(doc.version, '7.0');
    assert.equal(doc.persons.length, persons);
    assert.equal(doc.families.length, families);
    assert.ok(Array.isArray(doc.warnings));
  });
}

test('gedcom 7.0 fixture family.ged: dates of birth and death come through', () => {
  const doc = G.readGedcom(R, read('family.ged'));
  const van = doc.persons.find((p) => p.xref === 'I1');
  assert.ok(van, 'I1 present');
  const birth = van.facts.find((f) => f.tag === 'BIRT');
  const death = van.facts.find((f) => f.tag === 'DEAT');
  assert.equal(birth.place, 'Hue');
  assert.ok(birth.dateRaw && /1900/.test(birth.dateRaw), `birth date raw: ${birth.dateRaw}`);
  assert.ok(death.dateRaw && /1970/.test(death.dateRaw), `death date raw: ${death.dateRaw}`);
});
