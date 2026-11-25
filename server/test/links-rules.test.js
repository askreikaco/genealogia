// Pure rules for "same person" links between family trees (server/links-rules.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../links-rules');

const P = (id, fam, data = {}, deleted = false) => ({ id, family_id: fam, deleted, data });

test('validateLink: both exist, not deleted, different trees, same sex when both set', () => {
  assert.equal(L.validateLink(P('N1aaaaaaa', 'a', { sex: 'f' }), P('N2bbbbbbb', 'b', { sex: 'f' })), null);
  assert.equal(L.validateLink(P('N1aaaaaaa', 'a', { sex: 'f' }), P('N2bbbbbbb', 'b', {})), null, 'unknown sex on one side is fine');
  assert.match(L.validateLink(P('N1aaaaaaa', 'a', { sex: 'f' }), P('N2bbbbbbb', 'b', { sex: 'm' })), /Giới tính/);
  assert.match(L.validateLink(P('N1aaaaaaa', 'a'), P('N2bbbbbbb', 'a')), /cùng một cây/);
  assert.match(L.validateLink(null, P('N2bbbbbbb', 'b')), /cây này/);
  assert.match(L.validateLink(P('N1aaaaaaa', 'a'), P('N2bbbbbbb', 'b', {}, true)), /cây kia/);
});

test('statusFor: accepted only when owner/admin of BOTH trees (an editor code is not admin of the other tree)', () => {
  assert.equal(L.statusFor('owner', 'owner'), 'accepted');
  assert.equal(L.statusFor('admin', 'owner'), 'accepted');
  assert.equal(L.statusFor('owner', 'editor'), 'pending');
  assert.equal(L.statusFor('editor', 'admin'), 'pending');
  assert.equal(L.statusFor('owner', 'guest'), 'pending');
  assert.equal(L.statusFor('admin', 'editor'), 'pending', 'an editor code on the other tree is not its owner: waits');
  assert.equal(L.statusFor('admin', 'guest'), 'pending');
});

test('canSeeOther: deceased to readers of that tree, living only to its members', () => {
  assert.equal(L.canSeeOther({ died: '1990' }, 'guest', true), true);
  assert.equal(L.canSeeOther({ living: 'dead' }, 'guest', true), true);
  assert.equal(L.canSeeOther({ name: 'x' }, 'guest', true), false, 'living person, viewer not a member there');
  assert.equal(L.canSeeOther({ name: 'x' }, 'member', true), true);
  assert.equal(L.canSeeOther({ died: '1990' }, 'owner', false), false, 'tree not readable');
});

test('who decides and who removes; pair key is order-free', () => {
  assert.equal(L.canDecide('owner'), true); assert.equal(L.canDecide('admin'), true); assert.equal(L.canDecide('editor'), false);
  assert.equal(L.canRemove('editor', 'admin'), true); assert.equal(L.canRemove('editor', 'member'), false);
  assert.equal(L.pairKey('a', 'N1', 'b', 'N2'), L.pairKey('b', 'N2', 'a', 'N1'));
});
