// Unit tests for the fuzzy name matcher shared with the web app (web/js/fuzzy.js). No database needed.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const load = () => import(require('url').pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'fuzzy.js')).href);
const P = (name, extra = {}) => ({ id: 'P' + name.length, data: { name, ...extra } });

test('accents and đ are folded, case ignored', async () => {
  const f = await load();
  assert.equal(f.foldText('Đặng Thị ÁNH'), 'dang thi anh');
  assert.deepEqual(f.tokens('Dương  Minh-Khang'), ['duong', 'minh', 'khang']);
});

test('"Vuong Mihn Thuan" and "Thuan Vuong" both find Vương Minh Thuận', async () => {
  const f = await load();
  const people = [P('Vương Minh Thuận'), P('Vương Quốc Víh'), P('Nguyễn Văn Khang')];
  assert.equal(f.searchPeople(people, 'Vuong Mihn Thuan', { limit: 1 })[0].data.name, 'Vương Minh Thuận');
  assert.equal(f.searchPeople(people, 'Thuan Vuong', { limit: 1 })[0].data.name, 'Vương Minh Thuận');
  assert.equal(f.searchPeople(people, 'Thuan Vuong', { all: true }).length, 1);
});

test('"Tuan" finds Thuan (typo within distance 1)', async () => {
  const f = await load();
  const people = [P('Vương Minh Thuận'), P('Vương Quốc Víh')];
  assert.equal(f.searchPeople(people, 'Tuan', { limit: 1 })[0].data.name, 'Vương Minh Thuận');
  assert.equal(f.editDistance('tuan', 'thuan'), 1);
});

test('short tokens need an exact match, longer tokens allow two typos', async () => {
  const f = await load();
  assert.equal(f.tokenScore('an', 'on'), 0); // 2-letter token: no typo (prefix rule only)
  assert.ok(f.tokenScore('nguyen', 'nguyn') > 0);
  assert.ok(f.tokenScore('nguyen', 'nguyeen') > 0);
  assert.equal(f.tokenScore('nguyen', 'nguen'), 0.8); // two edits: allowed for length >= 6
  assert.equal(f.tokenScore('minh', 'mihn'), 0.8); // adjacent transposition counts as one
  assert.equal(f.tokenScore('khang', 'long'), 0);
});

test('missing tokens are fine for the join step, not for the strict search', async () => {
  const f = await load();
  const people = [P('Vương Minh Thuận')];
  assert.equal(f.searchPeople(people, 'Vương Minh').length, 1);
  assert.equal(f.searchPeople(people, 'Vương Minh', { all: true }).length, 1);
  assert.equal(f.searchPeople(people, 'Dương Quốc Hùng', { all: true }).length, 0);
  assert.equal(f.searchPeople(people, 'Dương Quốc Hùng').length, 1); // partial: shares "Dương"
});

test('aliases are searched too; ties go to the closest generation', async () => {
  const f = await load();
  const people = [P('Dương Văn Thái', { alias: 'Ông Hai' }), P('Dương Văn Thịnh', { gen: 5 }), P('Dương Văn Thịnh', { gen: 8 })];
  assert.equal(f.searchPeople(people, 'ong hai')[0].data.name, 'Dương Văn Thái');
  const ranked = f.searchPeople([P('A Thịnh', { gen: 8 }), P('A Thịnh', { gen: 5 })], 'thinh', { gen: 5 });
  assert.equal(ranked[0].data.gen, 5);
});

test('limit caps the suggestions (join step shows the top 5)', async () => {
  const f = await load();
  const people = Array.from({ length: 12 }, (_, i) => P('Vương Minh ' + i));
  assert.equal(f.searchPeople(people, 'Vuong Minh', { limit: 5 }).length, 5);
});
