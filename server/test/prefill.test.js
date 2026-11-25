// "+" prefill rules (web/js/prefill.js): what a new person, relation or event starts with.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'js', 'prefill.js'), 'utf8').replace(/^export /gm, '');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.P = { nameHit, nextOrder, relPrefill, listPrefill, gioPrefill, eventPrefill };', ctx);
const P = ctx.P;
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m);

test('nextOrder: 10 after nine children, 1 when none, halves and junk ignored', () => {
  assert.equal(P.nextOrder([1, 2, 3, 4, 5, 6, 7, 8, 9]), 10);
  assert.equal(P.nextOrder([]), 1);
  assert.equal(P.nextOrder([2.5, null, 'x', 0]), 3);
});

test('nameHit: accents ignored; an empty search hits nothing', () => {
  assert.equal(P.nameHit(['Giả Quang Nghĩa'], 'gia quang nghia'), true);
  assert.equal(P.nameHit(['Giả Quang Nghĩa'], 'Hùng'), false);
  assert.equal(P.nameHit(['Giả Quang Nghĩa'], ''), false);
});

test('child: generation +1, family name of the line; an unmatched search is the name', () => {
  const anchor = { name: 'Dương Văn Bảy', sex: 'm', gen: 7 };
  eq(P.relPrefill('child', { anchor }), { gen: 8, name: 'Dương ' });
  eq(P.relPrefill('child', { anchor, q: 'Giả Quang Nghĩa', qMatched: false }), { gen: 8, name: 'Giả Quang Nghĩa' });
  eq(P.relPrefill('child', { anchor, q: 'Giả Quang Nghĩa', qMatched: true }), { gen: 8, name: 'Dương ' }, 'a search that found someone is not a new name');
});

test('child of a daughter of the line: the family name follows her line (mother), not the son-in-law', () => {
  const anchor = { name: 'Dương Thị Tám', sex: 'f', gen: 7 };
  eq(P.relPrefill('child', { anchor, line: anchor }), { gen: 8, name: 'Dương ' });
});

test('child from a person married in: the line is the spouse they married into', () => {
  const anchor = { name: 'Giả Ngọc Giao', sex: 'f' };
  eq(P.relPrefill('child', { anchor, line: { name: 'Vương Minh Thuận' } }), { name: 'Vương ' }, 'no generation of her own');
});

test('spouse: opposite sex, no family name guessed; sibling: same generation; parent: generation -1', () => {
  eq(P.relPrefill('spouse', { anchor: { name: 'Dương Văn Một', sex: 'm', gen: 7 } }), { sex: 'f' });
  eq(P.relPrefill('spouse', { anchor: { name: 'Dương Thị Hai', sex: 'f', gen: 7 }, q: 'Lê Văn Ba' }), { sex: 'm', name: 'Lê Văn Ba' });
  eq(P.relPrefill('sibling', { anchor: { name: 'Dương Văn Một', gen: 7 } }), { gen: 7, name: 'Dương ' });
  eq(P.relPrefill('parent', { anchor: { name: 'Dương Văn Một', gen: 7 } }), { gen: 6, name: 'Dương ' });
  eq(P.relPrefill('parent', { anchor: { name: 'Dương Văn Một', gen: 1 } }), { name: 'Dương ' }, 'no generation 0');
});

test('list: generation, status, place; never a parent (relations set parents)', () => {
  eq(P.listPrefill({ gen: '8', living: true }), { gen: 8, living: 'living' });
  eq(P.listPrefill({ gen: '4', chi: { id: 'B1', gen: 3 } }), { gen: 4 }, 'a branch filter does not make a parent');
  eq(P.listPrefill({ living: 'dead', place: 'Củ Chi' }), { living: 'dead', place: 'Củ Chi' });
  eq(P.listPrefill({ q: 'Dương Văn Tư', qMatched: false }), { name: 'Dương Văn Tư' });
  eq(P.listPrefill({ q: '3/8', qMatched: false }), {}, 'a date is not a name');
});

test('giỗ: a person who died; day/month search is the giỗ date', () => {
  eq(P.gioPrefill({}), { living: 'dead' });
  eq(P.gioPrefill({ q: '3 / 08' }), { living: 'dead', gio_lunar: '3/8' });
  eq(P.gioPrefill({ q: 'Dương Văn Tư', qMatched: false }), { living: 'dead', name: 'Dương Văn Tư' });
});

test('event: one filtered type is the type; a year in the search is the date', () => {
  eq(P.eventPrefill({ types: ['quan_ngu'], q: 'nhập ngũ 1968' }), { type: 'quan_ngu', date_text: '1968' });
  eq(P.eventPrefill({ types: ['sinh', 'cuoi'], q: '' }), {}, 'two types: no guess');
});
