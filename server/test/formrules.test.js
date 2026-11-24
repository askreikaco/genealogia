// Unit tests for the person-form rules (web/js/formrules.js, web/js/lunar.js). No database needed.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const web = (f) => import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href);
const NOW = new Date(2026, 10, 21);
const P = (id, data) => ({ id, data: { ...data } });

test('smart date: year, month/year, full date, separators', async () => {
  const r = await web('formrules.js');
  assert.deepEqual(r.parseSmartDate('1963', NOW), { ok: true, kind: 'year', year: '1963' });
  assert.deepEqual(r.parseSmartDate('3/1963', NOW), { ok: true, kind: 'month', year: '1963', month: 3 });
  assert.deepEqual(r.parseSmartDate('5/3/1963', NOW), { ok: true, kind: 'full', year: '1963', month: 3, day: 5 });
  assert.deepEqual(r.parseSmartDate(' 05-03-1963 ', NOW), { ok: true, kind: 'full', year: '1963', month: 3, day: 5 });
  assert.deepEqual(r.parseSmartDate('', NOW), { ok: true, kind: 'empty' });
  assert.equal(r.fullDate(r.parseSmartDate('5/3/1963', NOW)), '05/03/1963');
  assert.equal(r.yearOf(r.parseSmartDate('3/1963', NOW)), '1963');
});

test('smart date: impossible or malformed input is rejected with a message', async () => {
  const r = await web('formrules.js');
  for (const bad of ['31/2/1963', '29/2/1963', '13/1963', '0/1/1963', '5/3/63', '1963-x', '1/2/3/4', '1/1/3000', '1/1/999', 'abc']) {
    const p = r.parseSmartDate(bad, NOW);
    assert.equal(p.ok, false, bad + ' should be rejected');
    assert.ok(p.error, bad + ' needs a message');
  }
  assert.equal(r.parseSmartDate('29/2/1964', NOW).ok, true, '1964 is a leap year');
  assert.equal(r.parseSmartDate('29/2/1900', NOW).ok, false, '1900 is not a leap year');
});

test('death before birth is detected at the precision both dates have', async () => {
  const r = await web('formrules.js');
  const y = (s) => r.parseSmartDate(s, NOW);
  assert.ok(r.cmpDate(y('1950'), y('1960')) < 0);
  assert.equal(r.cmpDate(y('1960'), y('1960')), 0);
  assert.ok(r.cmpDate(y('3/1960'), y('5/1960')) < 0);
  assert.ok(r.cmpDate(y('5/3/1960'), y('4/3/1960')) > 0);
  assert.equal(r.cmpDate(y('5/3/1960'), y('')), null);
});

test('Đời: parent + 1, root is 1, unknown parent đời gives no value', async () => {
  const r = await web('formrules.js');
  const byId = new Map([['A', P('A', { gen: 6 })], ['B', P('B', {})]]);
  assert.equal(r.suggestGen('', byId), 1);
  assert.equal(r.suggestGen('A', byId), 7);
  assert.equal(r.suggestGen('B', byId), undefined);
  assert.equal(r.suggestGen('ZZ', byId), 1, 'parent missing from the data counts as a root');
});

test('Thứ: three dated siblings, child placed by birth year', async () => {
  const r = await web('formrules.js');
  const people = [P('S1', { parent: 'F', born: '1950', order: 0, thu: '1' }), P('S2', { parent: 'F', born: '1955', order: 1, thu: '2' }),
    P('S3', { parent: 'F', born: '1960', order: 2, thu: '3' }), P('U', { parent: 'F', order: 3 }), P('X', { parent: 'G', born: '1958' })];
  assert.equal(r.suggestThu({ parentId: 'F', year: 1958, people, base: 1 }), 3, 'after 1950 and 1955, before 1960');
  assert.equal(r.suggestThu({ parentId: 'F', year: 1945, people, base: 1 }), 1, 'eldest');
  assert.equal(r.suggestThu({ parentId: 'F', year: 1990, people, base: 1 }), 4, 'youngest');
  assert.equal(r.suggestThu({ parentId: 'F', year: 1955, people, base: 1 }), 3, 'same year goes after');
  assert.equal(r.suggestThu({ parentId: 'F', year: null, people, base: 1 }), null, 'no birth year: no suggestion');
  assert.equal(r.suggestThu({ parentId: '', year: 1958, people, base: 1 }), null, 'no parent: no suggestion');
  assert.equal(r.suggestThu({ parentId: 'F', selfId: 'S2', year: 1955, people, base: 1 }), 2, 'editing S2 does not count itself');
});

test('Thứ: unknown-year siblings are last and do not shift the count', async () => {
  const r = await web('formrules.js');
  const people = [P('A', { parent: 'F', order: 0 }), P('B', { parent: 'F', born: '1940', order: 1 }), P('C', { parent: 'F', order: 2 })];
  assert.equal(r.suggestThu({ parentId: 'F', year: 1950, people, base: 1 }), 2);
});

test('Thứ convention: eldest usually 1 gives base 1, eldest usually 2 (Nam Bộ "Hai") gives base 2', async () => {
  const r = await web('formrules.js');
  const family = (eldestThu) => [P('E', { parent: 'F', born: '1900', thu: String(eldestThu), order: 0 }), P('Y', { parent: 'F', born: '1910', thu: String(eldestThu + 1), order: 1 }),
    P('Q', { parent: 'G', born: '1900', thu: String(eldestThu), order: 2 }), P('R', { parent: 'G', born: '1905', thu: String(eldestThu + 1), order: 3 })];
  assert.equal(r.inferThuBase(family(1)), 1);
  assert.equal(r.inferThuBase(family(2)), 2);
  assert.equal(r.inferThuBase([P('a', { parent: 'F', thu: 'Út' }), P('b', { parent: 'F', thu: '2' })]), 1, 'no numeric eldest: default 1');
});

test('Thứ convention from the seed data', async () => {
  const r = await web('formrules.js');
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'demo-persons.json'), 'utf8'));
  const base = r.inferThuBase(seed.filter((p) => !p.data.spouse_of));
  assert.ok(base === 1 || base === 2);
});

test('lunar auto: solar date to âm lịch, Tết 1963 is 1/1, round trip holds', async () => {
  const L = await web('lunar.js');
  const r = await web('formrules.js');
  const tet = L.lunarToSolar(1, 1, 1963);
  assert.deepEqual([tet.getFullYear(), tet.getMonth() + 1, tet.getDate()], [1963, 1, 25]);
  assert.deepEqual(L.solarToLunar(25, 1, 1963), { day: 1, month: 1, year: 1963, leap: false });
  const lu = r.lunarOf(5, 3, 1963);
  assert.equal(lu.stored, '10/2');
  assert.equal(lu.label, '10/2 Quý Mão');
  assert.equal(L.yearName(1963), 'Quý Mão');
  assert.equal(L.yearName(2000), 'Canh Thìn');
  for (const [d, m, y] of [[5, 3, 1963], [1, 1, 2000], [30, 4, 1975], [2, 9, 1945], [29, 2, 2024]]) {
    const l = L.solarToLunar(d, m, y);
    const back = L.lunarToSolar(l.day, l.month, l.year, l.leap ? 1 : 0);
    assert.deepEqual([back.getFullYear(), back.getMonth() + 1, back.getDate()], [y, m, d], `${d}/${m}/${y}`);
  }
});

test('lunar auto: a leap month is stored with "nhuận" and still parses for giỗ', async () => {
  const r = await web('formrules.js');
  const L = await web('lunar.js');
  // 2023 has a leap 2nd month (2/2 nhuận 2023 is 1 Mar 2023 in the lunar calendar)
  const d = L.lunarToSolar(1, 2, 2023, 1);
  const lu = r.lunarOf(d.getDate(), d.getMonth() + 1, d.getFullYear());
  assert.match(lu.stored, /^\d+\/\d+ nhuận$/);
  assert.equal(parseInt(lu.stored.split('/')[1], 10), 2);
});
