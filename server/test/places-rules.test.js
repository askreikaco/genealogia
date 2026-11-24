// Places gazetteer helpers: folding, date edges, names valid at a date, search score. Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../places-rules');

test('fold: accents, đ, punctuation, case', () => {
  assert.equal(R.fold('Đồng Mây, Xã  Bến-Lúa'), 'dong may xa ben lua');
  assert.equal(R.fold(null), '');
});

test('edge and isDate: years and months widen to the period edge', () => {
  assert.equal(R.edge('1976', false), '1976-01-01'); assert.equal(R.edge('1976', true), '1976-12-31');
  assert.equal(R.edge('1976-07', false), '1976-07-01'); assert.equal(R.edge('2025-07-01', true), '2025-07-01');
  assert.equal(R.edge('khoảng 1900', false), null);
  assert.ok(R.isDate('') && R.isDate('1800') && !R.isDate('x'));
});

test('validAt and nameAt: the name in force at a date; today = open-ended rows', () => {
  const names = [
    { name: 'Trấn Mây', lang: 'vi', valid_from: '1698', valid_to: '1832', is_primary: true },
    { name: 'Tỉnh Mây', lang: 'vi', valid_from: '1832', valid_to: '1976-02', is_primary: true },
    { name: 'Thành phố Mây', lang: 'vi', valid_from: '1976-02', valid_to: null, is_primary: true },
    { name: '雲鎮', lang: 'han', valid_from: '1698', valid_to: '1832' },
  ];
  assert.equal(R.nameAt(names, '1750'), 'Trấn Mây');
  assert.equal(R.nameAt(names, '1900-05-01'), 'Tỉnh Mây');
  assert.equal(R.nameAt(names, null), 'Thành phố Mây');
  assert.equal(R.nameAt(names, '1750', 'han'), '雲鎮');
  assert.equal(R.nameAt(names, '1500'), 'Thành phố Mây', 'before any name: falls back to the primary today');
  assert.ok(R.validAt({ valid_from: '1832', valid_to: '1976-02' }, '1976'), 'a year overlapping the end month counts');
  assert.ok(!R.validAt({ valid_from: '1832', valid_to: '1976-02' }, null), 'closed rows are not today');
});

test('score: exact > prefix > word start > none', () => {
  assert.equal(R.score('ben lua', 'ben lua'), 3);
  assert.equal(R.score('ben lua moi', 'ben lua'), 2);
  assert.equal(R.score('xa ben lua', 'ben'), 1);
  assert.equal(R.score('xa ben lua', 'en'), 0);
  assert.ok(R.isId('12') && !R.isId('1;drop') && !R.isId(''));
});
