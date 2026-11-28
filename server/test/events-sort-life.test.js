// Unit tests for sortEvents: the person's life order (lifeAnchors: own birth, dated life events, undated ones between
// birth and death, own death, burial) and the default order for several people (unchanged). No DB.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const lib = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'events.js')).href);
const ids = (list) => list.map((e) => e.id);
const sinh = { id: 'b', type: 'sinh', date_kind: 'exact', date_from: '1900', is_preferred: true };
const mat = { id: 'm', type: 'mat', date_kind: 'exact', date_from: '1950', is_preferred: true };
const nghe = { id: 'n', type: 'nghe', date_kind: 'exact', date_from: '1920', is_preferred: true };
const khac = { id: 'k', type: 'khac', date_kind: null, date_from: null, is_preferred: true };
const antang = { id: 'a', type: 'an_tang', date_kind: null, date_from: null, is_preferred: true };

test('lifeAnchors: birth, the dated life event, the undated life event, death, burial (owner order)', async () => {
  const E = await lib();
  assert.deepEqual(ids(E.sortEvents([mat, khac, sinh, nghe, antang], { lifeAnchors: true })), ['b', 'n', 'k', 'm', 'a']);
});

test('lifeAnchors: a dated event later than the death still sorts by its date (before the death row)', async () => {
  const E = await lib();
  const late = { id: 'l', type: 'chuyen_nha', date_kind: 'exact', date_from: '1960', is_preferred: true };
  assert.deepEqual(ids(E.sortEvents([mat, late, sinh], { lifeAnchors: true })), ['b', 'l', 'm']);
});

test('lifeAnchors: a relative (derived) death is dated like any other event, not moved to the end', async () => {
  const E = await lib();
  const relDeath = { id: 'r', type: 'mat', derived: true, date_kind: 'exact', date_from: '1930', is_preferred: true };
  assert.deepEqual(ids(E.sortEvents([mat, nghe, relDeath, sinh], { lifeAnchors: true })), ['b', 'n', 'r', 'm']);
});

test('default (several people): dated by date, undated last; unchanged', async () => {
  const E = await lib();
  assert.deepEqual(ids(E.sortEvents([mat, khac, sinh, nghe, antang])), ['b', 'n', 'm', 'a', 'k']);
  assert.deepEqual(ids(E.sortEvents([mat, khac, sinh, nghe, antang], {})), ['b', 'n', 'm', 'a', 'k']);
});
