// One ownership-claim entry (claim-rules.routeClaim): the family state picks the path; no double claims; a claimable
// tree is non-exclusive. Pure: no DB, no network.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../claim-rules');

const base = { state: 'owned', signedIn: true, isOwner: false, hasOpen: false, openHandover: false, openClaim: false };

test('owned family: the succession path applies', () => {
  assert.deepEqual(C.routeClaim(base), { path: 'succession', block: null });
});

test('unowned and abandoned families: the claim path applies (evidence, notice, approval)', () => {
  assert.deepEqual(C.routeClaim({ ...base, state: 'unowned' }), { path: 'claim', block: null });
  assert.deepEqual(C.routeClaim({ ...base, state: 'abandoned' }), { path: 'claim', block: null });
});

test('signed out: no path', () => {
  assert.match(C.routeClaim({ ...base, signedIn: false }).block, /đăng nhập/);
  assert.equal(C.routeClaim({ ...base, signedIn: false }).path, null);
});

test('an active owner gets no path (they already hold the tree)', () => {
  assert.equal(C.routeClaim({ ...base, isOwner: true }).path, null);
  assert.match(C.routeClaim({ ...base, state: 'unowned', isOwner: true }).block, /Chủ họ của cây/);
});

test('no double claim: the same person with an open claim is refused on either path', () => {
  assert.match(C.routeClaim({ ...base, state: 'abandoned', hasOpen: true }).block, /đã có đơn/);
  assert.match(C.routeClaim({ ...base, hasOpen: true }).block, /đã có đơn/);
});

test('an open handover blocks both paths', () => {
  assert.equal(C.routeClaim({ ...base, openHandover: true }).path, null);
  assert.equal(C.routeClaim({ ...base, state: 'abandoned', openHandover: true }).path, null);
});

test('claims are non-exclusive on a claimable tree: another person may claim while one waits', () => {
  assert.deepEqual(C.routeClaim({ ...base, state: 'abandoned', openClaim: true }), { path: 'claim', block: null });
});

test('an open claim blocks the succession path (one claim at a time for an owned family)', () => {
  assert.match(C.routeClaim({ ...base, state: 'owned', openClaim: true }).block, /đơn nhận quản lý/);
});
