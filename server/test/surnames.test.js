// Vietnamese family name -> Hán table (web/js/surnames-vi.js) and how the surname tile picks a name (web/js/ui.js surnameOf).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', '..', 'web');
const src = fs.readFileSync(path.join(WEB, 'js', 'surnames-vi.js'), 'utf8').replace(/^export /gm, '');
const ctx = {}; vm.createContext(ctx); vm.runInContext(src + '\n;globalThis.T = SURNAME_HAN;', ctx);
const T = ctx.T;

test('every entry: a Vietnamese name of one or two words -> one Hán character per word', () => {
  const keys = Object.keys(T);
  assert.ok(keys.length >= 150, `at least 150 names (has ${keys.length})`);
  for (const [k, v] of Object.entries(T)) {
    const words = k.split(' ');
    assert.ok(words.length <= 2 && words.every((w) => /^\p{Lu}\p{Ll}*$/u.test(w)), `name shape: ${k}`);
    assert.ok([...v].every((c) => /\p{Script=Han}/u.test(c)), `Hán only: ${k} -> ${v}`);
    assert.equal([...v].length, words.length, `one character per word: ${k} -> ${v}`);
  }
});

test('the names the owner asked for, and spellings that share a character', () => {
  assert.equal(T['Trà'], '茶');
  assert.equal(T['Huỳnh'], '黃'); assert.equal(T['Huỳnh'], T['Hoàng']);
  assert.equal(T['Võ'], T['Vũ']); assert.equal(T['Lã'], T['Lữ']); assert.equal(T['Khâu'], T['Khưu']);
  assert.equal(T['Dương'], '楊'); assert.equal(T['Nguyễn'], '阮');
});

test('surnameOf: a two-word family name only when the full name has three words or more', async () => {
  const ui = fs.readFileSync(path.join(WEB, 'js', 'ui.js'), 'utf8');
  const body = /export function surnameOf\(name\) \{[\s\S]*?\n\}/.exec(ui)[0].replace(/^export /, '');
  const c = { SURNAME_HAN: T }; vm.createContext(c); vm.runInContext(body + '\n;globalThis.f = surnameOf;', c);
  assert.equal(c.f('Âu Dương Lân'), 'Âu Dương');
  assert.equal(c.f('Tôn Thất Thuyết'), 'Tôn Thất');
  assert.equal(c.f('Tôn Nữ'), 'Tôn', 'two words: Tôn is the family name, Nữ the given name');
  assert.equal(c.f('  Huỳnh   Thị Triêng '), 'Huỳnh');
  assert.equal(c.f(''), '');
});
