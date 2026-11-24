// Root order of a family (web/js/model.js buildFrom): manual order (data.order), then the group order
// (data.ext.order, one value per group), then the earliest known birth or death year, undated last. No database.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

let L = null;
const lib = async () => L || (L = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'model.js')).href));
const roots = async (list) => (await lib()).buildFrom(list).roots.map((p) => p.id);
const P = (id, data) => ({ id, fam: 'f', data: { name: id, ...data } });

test('roots sort by the earliest known year, undated last', async () => {
  const r = await roots([P('late', { born: '1900' }), P('none', {}), P('early', { born: '1700' }), P('mid', { died: '1850' })]);
  assert.deepStrictEqual(r, ['early', 'mid', 'late', 'none']);
});

test('a dated death earlier than the birth year of another root sorts first (earliest known year)', async () => {
  const r = await roots([P('b', { born: '1900' }), P('a', { died: '1880' })]);
  assert.deepStrictEqual(r, ['a', 'b']);
});

test('group order keeps a group together; years decide inside a group', async () => {
  const r = await roots([
    P('g2-a', { born: '1500', ext: { order: 2, group: 'Q2' } }),
    P('g1-late', { born: '1900', ext: { order: 1, group: 'Q1' } }),
    P('g1-early', { born: '1850', ext: { order: 1, group: 'Q1' } }),
    P('g2-b', { ext: { order: 2, group: 'Q2' } }),
    P('plain', { born: '1000' }),
  ]);
  // group 1 (order 1), then group 2 (order 2, the 1500 root before the undated one), then the plain root (no order)
  assert.deepStrictEqual(r, ['g1-early', 'g1-late', 'g2-a', 'g2-b', 'plain']);
});

test('manual data.order still wins over everything', async () => {
  const r = await roots([P('dated', { born: '1500' }), P('manual', { order: 1, born: '1900' })]);
  assert.deepStrictEqual(r, ['manual', 'dated']);
});

test('yearOfText reads plain, dated and approximate years', async () => {
  const { yearOfText } = await lib();
  assert.strictEqual(yearOfText('1839'), 1839);
  assert.strictEqual(yearOfText('1839-05-01'), 1839);
  assert.strictEqual(yearOfText('khoảng 901'), 901);
  assert.strictEqual(yearOfText('trước CN 711'), -711);
  assert.strictEqual(yearOfText(''), null);
});
