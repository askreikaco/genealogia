// Two-step sign-in rules (no database): RFC 6238 vectors, the step window and replay, the sealed secret, recovery codes
// and the attempt window. Routes and the database are in totp-api.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const T = require('../totp-rules');

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890" (ASCII). The 8-digit codes end in the 6 digits we compare.
const KEY = Buffer.from('12345678901234567890', 'ascii'); // RFC 6238 public test key
test('RFC 6238 test vectors (SHA-1, 8 digits, last six compared)', () => {
  const vectors = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']];
  for (const [t, want] of vectors) assert.equal(T.hotp(KEY, Math.floor(t / 30)), want, `t=${t}`);
});
test('base32 matches RFC 4648 and round-trips', () => {
  assert.equal(T.base32Encode(KEY), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const raw = crypto.randomBytes(20);
  assert.deepEqual(T.base32Decode(T.base32Encode(raw)), raw);
  assert.deepEqual(T.base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), KEY);
  assert.throws(() => T.base32Decode('AB1'));
});
test('window: the step before and after now are accepted, two steps away are not', () => {
  const now = 1111111111 * 1000; const cur = Math.floor(now / 30000);
  assert.equal(T.matchStep(KEY, T.hotp(KEY, cur), now), cur);
  assert.equal(T.matchStep(KEY, T.hotp(KEY, cur - 1), now), cur - 1);
  assert.equal(T.matchStep(KEY, T.hotp(KEY, cur + 1), now), cur + 1);
  assert.equal(T.matchStep(KEY, T.hotp(KEY, cur - 2), now), null);
  assert.equal(T.matchStep(KEY, T.hotp(KEY, cur + 2), now), null);
});
test('replay: a step already used (lastStep) is refused, a later one is accepted', () => {
  const now = 2000000000 * 1000; const cur = Math.floor(now / 30000);
  assert.equal(T.matchStep(KEY, T.hotp(KEY, cur), now, cur), null);
  assert.equal(T.matchStep(KEY, T.hotp(KEY, cur - 1), now, cur), null, 'older than the last step too');
  assert.equal(T.matchStep(KEY, T.hotp(KEY, cur + 1), now, cur), cur + 1);
});
test('only six digits, spaces allowed inside', () => {
  const now = 59 * 1000;
  assert.equal(T.matchStep(KEY, '287 082', now), 1);
  for (const bad of ['', '12345', '1234567', 'abcdef', '28708a', null, undefined]) assert.equal(T.matchStep(KEY, bad, now), null);
});
test('otpauth URI carries the secret, SHA1, 6 digits, 30 s', () => {
  const uri = T.otpauthUri({ secret: KEY, account: 'a@b.test', issuer: 'Gia phả' });
  assert.match(uri, /^otpauth:\/\/totp\/Gia%20ph%E1%BA%A3%3Aa%40b\.test\?/);
  assert.ok(uri.includes('secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'));
  assert.ok(uri.includes('algorithm=SHA1&digits=6&period=30'));
});
test('secret sealing: AES-256-GCM round-trip, tamper and wrong key refused, short secret gives no key', () => {
  const key = T.deriveKey('x'.repeat(40));
  assert.equal(key.length, 32);
  const sealed = T.seal(key, KEY);
  assert.notEqual(sealed, T.base32Encode(KEY));
  assert.deepEqual(T.open(key, sealed), KEY);
  const bytes = Buffer.from(sealed, 'base64'); bytes[bytes.length - 1] ^= 1;
  assert.throws(() => T.open(key, bytes.toString('base64')));
  assert.throws(() => T.open(T.deriveKey('y'.repeat(40)), sealed));
  assert.equal(T.deriveKey('short'), null);
});
test('recovery codes: ten, XXXX-XXXX, no look-alike letters, unique', () => {
  const codes = T.newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
});
test('recovery codes: stored hashed, checked with any spelling of the code', () => {
  const [c] = T.newRecoveryCodes(1);
  const stored = T.hashRecovery(c);
  assert.ok(!stored.includes(c.replace('-', '')));
  assert.equal(T.checkRecovery(c, stored), true);
  assert.equal(T.checkRecovery(c.toLowerCase().replace('-', ' '), stored), true);
  assert.equal(T.checkRecovery(T.newRecoveryCodes(1)[0], stored), false);
  assert.equal(T.checkRecovery(c, 'nonsense'), false);
  assert.equal(T.isRecoveryShape('abcd-2345'), true);
  assert.equal(T.isRecoveryShape('123456'), false);
});
test('attempts: five failures in ten minutes block; the window starts at the first failure', () => {
  const t0 = 1_000_000_000_000;
  const at = new Date(t0).toISOString();
  assert.equal(T.attemptsState(4, at, t0 + 1000).blocked, false);
  assert.equal(T.attemptsState(5, at, t0 + 1000).blocked, true);
  assert.equal(T.attemptsState(5, at, t0 + 10 * 60e3).blocked, false, 'window over');
  assert.equal(T.attemptsState(0, null, t0).blocked, false);
  assert.equal(T.attemptsState(5, at, t0 + 1000).until, t0 + 10 * 60e3);
});
