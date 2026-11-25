// Relationship path (web/js/relpath-path.js, the walk behind the Quan he page): siblings, cousin, uncle, in-law through a
// spouse, no path, same person, a path through a hidden person, and the common-ancestor mark (collateral walks only).
// No DB. Run: npm test (server/).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, '..', '..', 'web', 'js');
const load = async () => ({
  R: await import(pathToFileURL(path.join(WEB, 'relgraph.js')).href),
  P: await import(pathToFileURL(path.join(WEB, 'relpath-path.js')).href),
});

// ---- fixture (invented ids): grandparents GF+GM, uncle UN (+ wife UW), father FA, mother MO, F and sibling SIB,
// cousin C, F's spouse W (+ W's father WF), F's child KID. ZZ is not connected to anyone. ----
const kid = (parent, child) => ({ parent_id: parent, child_id: child, kind: 'ruot', birth_order: null });
const wed = (a, b) => ({ a_id: a, b_id: b, kind: 'cuoi', order_a: null, order_b: null });
const PC = [
  kid('GF', 'FA'), kid('GM', 'FA'), kid('GF', 'UN'), kid('GM', 'UN'),
  kid('FA', 'F'), kid('MO', 'F'), kid('FA', 'SIB'), kid('MO', 'SIB'),
  kid('UN', 'C'), kid('UW', 'C'), kid('F', 'KID'), kid('W', 'KID'), kid('WF', 'W'),
];
const CP = [wed('GF', 'GM'), wed('UN', 'UW'), wed('F', 'W')];

test('siblings: up to a shared parent, then down; the parent is the common ancestor', async () => {
  const { R, P } = await load();
  const r = P.relPath(R.index(PC, CP), 'F', 'SIB');
  assert.deepStrictEqual(r.steps.map((s) => s.hop), ['up', 'down']);
  assert.strictEqual(r.nodes[0], 'F'); assert.strictEqual(r.nodes[2], 'SIB');
  assert.strictEqual(r.apexIndex, 1);
  assert.ok(r.nodes[1] === 'FA' || r.nodes[1] === 'MO');
});

test('cousin: up two generations to the grandparent, down two; the grandparent is marked', async () => {
  const { R, P } = await load();
  const r = P.relPath(R.index(PC, CP), 'F', 'C');
  assert.deepStrictEqual(r.nodes, ['F', 'FA', 'GF', 'UN', 'C']);
  assert.deepStrictEqual(r.steps.map((s) => s.hop), ['up', 'up', 'down', 'down']);
  assert.strictEqual(r.apexIndex, 2);
  assert.strictEqual(r.nodes[r.apexIndex], 'GF');
});

test('uncle: up to the grandparent, down to the uncle; no spouse step', async () => {
  const { R, P } = await load();
  const r = P.relPath(R.index(PC, CP), 'F', 'UN');
  assert.deepStrictEqual(r.nodes, ['F', 'FA', 'GF', 'UN']);
  assert.strictEqual(r.apexIndex, 2);
  assert.deepStrictEqual(r.viaMarriage, [false, false, false]);
});

test('in-law through a spouse: the couple step is flagged, no common ancestor is marked', async () => {
  const { R, P } = await load();
  const r = P.relPath(R.index(PC, CP), 'F', 'WF');
  assert.deepStrictEqual(r.nodes, ['F', 'W', 'WF']);
  assert.deepStrictEqual(r.steps.map((s) => s.hop), ['spouse', 'up']);
  assert.deepStrictEqual(r.viaMarriage, [true, false]);
  assert.strictEqual(r.apexIndex, -1);
});

test('ancestor and descendant lines have no common ancestor to mark', async () => {
  const { R, P } = await load();
  const ix = R.index(PC, CP);
  assert.strictEqual(P.relPath(ix, 'F', 'GF').apexIndex, -1);
  assert.strictEqual(P.relPath(ix, 'F', 'KID').apexIndex, -1);
});

test('no path: a person with no links, or an unknown id, gives null', async () => {
  const { R, P } = await load();
  assert.strictEqual(P.relPath(R.index(PC, CP), 'F', 'ZZ'), null);
  assert.strictEqual(P.relPath(R.index(PC, CP), 'F', null), null);
});

test('same person: flagged, not a path', async () => {
  const { R, P } = await load();
  const r = P.relPath(R.index(PC, CP), 'F', 'F');
  assert.strictEqual(r.same, true);
  assert.strictEqual(r.steps.length, 0);
});

test('a path through a hidden person still connects; only that node is flagged hidden', async () => {
  const { R, P } = await load();
  const r = P.relPath(R.index(PC, CP), 'F', 'UN', { visible: (id) => id !== 'FA' });
  assert.deepStrictEqual(r.nodes, ['F', 'FA', 'GF', 'UN']);
  assert.deepStrictEqual(r.hidden, [false, true, false, false]);
  assert.strictEqual(r.apexIndex, 2);
});
