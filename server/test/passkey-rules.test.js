// Passkey rules (no database): challenge lifetime, the sign-in counter check, the last-sign-in-method guard, the RP id.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const PR = require('../passkey-rules');

test('challenge: five minutes, and only before its expiry', () => {
  assert.equal(PR.CH_TTL_MS, 5 * 60e3);
  const now = 1e12;
  assert.equal(PR.challengeLive(new Date(now + 1000), now), true);
  assert.equal(PR.challengeLive(new Date(now), now), false, 'expiry itself is already too late');
  assert.equal(PR.challengeLive(new Date(now - 1), now), false);
  assert.equal(PR.challengeLive('not a date', now), false);
});

test('counter: must grow; an authenticator that never counts (0) is allowed', () => {
  assert.equal(PR.counterOk(0, 0), true);
  assert.equal(PR.counterOk(0, 7), true);
  assert.equal(PR.counterOk(5, 6), true);
  assert.equal(PR.counterOk(5, 5), false, 'the same counter again: a copied authenticator');
  assert.equal(PR.counterOk(5, 4), false, 'a counter that goes back');
  assert.equal(PR.counterOk('5', '6'), true, 'bigint columns arrive as strings');
  assert.equal(PR.counterOk(5, undefined), false, 'no counter from the authenticator is not growth');
});

test('last sign-in method: a passkey goes only when another way to sign in stays', () => {
  const google = { type: 'google', provider_sub: 'g1', value_norm: 'a@x.vn', verified_at: null };
  assert.match(PR.passkeyRemoveBlock([], 1), /cách đăng nhập duy nhất/);
  assert.equal(PR.passkeyRemoveBlock([], 2), '', 'another passkey stays');
  assert.equal(PR.passkeyRemoveBlock([google], 1), '', 'a linked Google stays');
  assert.match(PR.passkeyRemoveBlock([{ type: 'email', value_norm: 'a@x.vn', verified_at: 't' }], 1), /duy nhất/, 'an email is not a sign-in method on its own');
});

test('relying party id: GP_PASSKEY_RP_ID when set, else the host without its port', () => {
  assert.equal(PR.rpIdFor('example.test', ''), 'example.test');
  assert.equal(PR.rpIdFor('localhost:3000', ''), 'localhost');
  assert.equal(PR.rpIdFor('127.0.0.1:8080', 'example.test'), 'example.test', 'the configured id wins');
  assert.equal(PR.rpIdFor('example.test', '  '), 'example.test', 'a blank setting is ignored');
});
