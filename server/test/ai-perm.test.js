// Pure rules for AI connections (ai-perm.js): the scope x role matrix. No database.
// effective = min(role in the family, scope ceiling). read/suggest stop at member, write at editor, admin at admin.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../ai-perm');

const ROLES = ['guest', 'member', 'editor', 'admin', 'owner'];

test('effective role is min(role, ceiling of the granted scopes)', () => {
  const cases = [
    // [role, scopes, expected effective]
    ['guest', ['read'], 'guest'], ['member', ['read'], 'member'], ['editor', ['read'], 'member'], ['admin', ['read'], 'member'], ['owner', ['read'], 'member'],
    ['guest', ['suggest'], 'guest'], ['member', ['suggest'], 'member'], ['editor', ['suggest'], 'member'], ['owner', ['suggest'], 'member'],
    ['guest', ['write'], 'guest'], ['member', ['write'], 'member'], ['editor', ['write'], 'editor'], ['admin', ['write'], 'editor'], ['owner', ['write'], 'editor'],
    ['guest', ['admin'], 'guest'], ['member', ['admin'], 'member'], ['editor', ['admin'], 'editor'], ['admin', ['admin'], 'admin'], ['owner', ['admin'], 'admin'],
    // several scopes: the highest ceiling wins, the user role still caps it
    ['editor', ['read', 'write'], 'editor'], ['member', ['read', 'write'], 'member'], ['admin', ['suggest', 'write', 'admin'], 'admin'],
  ];
  for (const [role, scopes, want] of cases) assert.equal(P.effectiveRole(role, scopes), want, `${role} with ${scopes.join('+')}`);
});

test('scope x role matrix: which tools each combination may run', () => {
  // One tool per scope level. A tool needs its scope (broader scopes include it) and the minimum effective role.
  const probe = { read: 'get_person', suggest: 'propose_changes', write: 'apply_changes', admin: 'invite_member' };
  const scopesOf = { read: ['read'], suggest: ['suggest'], write: ['write'], admin: ['admin'] };
  const want = {
    // role:  read  suggest  write  admin
    guest:   [true, true, false, false],
    member:  [true, true, false, false],
    editor:  [true, true, true, false],
    admin:   [true, true, true, true],
    owner:   [true, true, true, true],
  };
  for (const role of ROLES) {
    const got = Object.keys(probe).map((s) => P.toolAllowed(probe[s], scopesOf[s], role));
    const exp = want[role] || [false, false, false, false];
    assert.deepEqual(got, exp, `role ${role}`);
  }
});

test('a token with a broad scope holds the narrower ones too', () => {
  assert.equal(P.toolAllowed('get_person', ['write'], 'editor'), true);
  // a write token may propose; a member's proposal becomes a suggestion (ai-tools.js), it does not write
  assert.equal(P.toolAllowed('propose_changes', ['write'], 'member'), true);
  assert.equal(P.toolAllowed('apply_changes', ['suggest'], 'owner'), false, 'suggest alone cannot apply');
  assert.equal(P.toolAllowed('apply_changes', ['read', 'write'], 'editor'), true);
});

test('admin tools need the admin scope and an admin role (effective admin)', () => {
  assert.equal(P.toolAllowed('change_role', ['admin'], 'owner'), true);
  assert.equal(P.toolAllowed('change_role', ['admin'], 'editor'), false, 'editor with admin scope is capped at editor');
  assert.equal(P.toolAllowed('change_role', ['write'], 'owner'), false, 'write scope is not admin');
  assert.equal(P.toolAllowed('remove_member', ['admin'], 'admin'), true);
});

test('unknown tools are refused; ownership and deletion tools are not exposed', () => {
  assert.equal(P.toolAllowed('transfer_ownership', ['admin'], 'owner'), false);
  assert.equal(P.toolAllowed('delete_family', ['admin'], 'owner'), false);
  assert.equal(P.toolAllowed('delete_person', ['admin'], 'owner'), false);
  assert.equal(P.toolAllowed('nope', ['admin'], 'owner'), false);
});

test('tools listed per token follow the scopes', () => {
  const read = P.toolsForScopes(['read']);
  assert.ok(read.includes('get_person') && !read.includes('propose_changes') && !read.includes('apply_changes'));
  const sug = P.toolsForScopes(['suggest']);
  assert.ok(sug.includes('propose_changes') && sug.includes('get_person') && !sug.includes('apply_changes'));
  const adm = P.toolsForScopes(['admin']);
  assert.ok(adm.includes('invite_member') && adm.includes('apply_changes'));
});

test('scope lists are validated', () => {
  assert.deepEqual(P.normalizeScopes(['write', 'read', 'read']), ['read', 'write']);
  assert.equal(P.normalizeScopes([]), null);
  assert.equal(P.normalizeScopes(['delete']), null);
  assert.equal(P.normalizeScopes('read'), null);
});

test('unknown account roles count as guest', () => {
  assert.equal(P.effectiveRole('wizard', ['admin']), 'guest');
  assert.equal(P.effectiveRole(undefined, ['admin']), 'guest');
});
