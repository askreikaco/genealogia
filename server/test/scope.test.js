// Unit tests for "Tất cả dòng họ" scope (web/js/store.js scopeOf). No database needed.
// Scope = followed or member families, minus refused ones and private families where the account has no role.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const web = (f) => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href);

const META = new Map([
  ['duong', { id: 'duong', slug: 'duong', visibility: 'public' }],
  ['dong-a', { id: 'dong-a', slug: 'dong-a', visibility: 'public' }],
  ['kin', { id: 'kin', slug: 'kin', visibility: 'link' }],
  ['secret', { id: 'secret', slug: 'secret', visibility: 'private' }],
]);

test('scope: followed families, deduplicated, and the reserved all-id never counts', async () => {
  const { scopeOf } = await web('store.js');
  assert.deepStrictEqual(scopeOf(['duong', 'dong-a', 'duong', 'tat-ca'], {}, META), ['duong', 'dong-a']);
});

test('scope: member families are included even when not followed', async () => {
  const { scopeOf } = await web('store.js');
  assert.deepStrictEqual(scopeOf(['duong'], { 'dong-a': 'member' }, META).sort(), ['dong-a', 'duong']);
});

test('privacy: a private family is not in scope for a non-member, even if followed', async () => {
  const { scopeOf } = await web('store.js');
  assert.deepStrictEqual(scopeOf(['duong', 'secret'], {}, META), ['duong']);
});

test('privacy: a private family is in scope for a member of it', async () => {
  const { scopeOf } = await web('store.js');
  assert.deepStrictEqual(scopeOf(['duong', 'secret'], { secret: 'editor' }, META).sort(), ['duong', 'secret']);
});

test('privacy: a family the server refused (denied) drops out; link families stay', async () => {
  const { scopeOf } = await web('store.js');
  assert.deepStrictEqual(scopeOf(['duong', 'kin', 'dong-a'], {}, META, new Set(['kin'])), ['duong', 'dong-a']);
  assert.deepStrictEqual(scopeOf(['kin'], {}, META), ['kin']);
});

test('scope: unknown metadata is treated as public (the default family before its details load)', async () => {
  const { scopeOf } = await web('store.js');
  assert.deepStrictEqual(scopeOf(['duong', 'new-fam'], {}, new Map()), ['duong', 'new-fam']);
});
