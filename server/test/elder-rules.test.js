// Unit tests (no database): code expiry and single use, approval roles, the two-approver rule, managers and cards,
// the 6-digit code, the rate limiter window.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../elder-rules');

const set = (...xs) => new Set(xs);
const future = (ms = 60e3) => new Date(Date.now() + ms);
const past = (ms = 60e3) => new Date(Date.now() - ms);

test('code state: pending until expiry, expired after 10 minutes, approved and consumed are terminal', () => {
  const now = Date.now();
  assert.equal(R.codeState({ status: 'pending', expires_at: future() }, now), 'pending');
  assert.equal(R.codeState({ status: 'pending', expires_at: past() }, now), 'expired');
  assert.equal(R.codeState({ status: 'approved', expires_at: future() }, now), 'approved');
  assert.equal(R.codeState({ status: 'consumed', expires_at: future() }, now), 'consumed');
  assert.equal(R.codeState(null, now), 'expired');
  assert.equal(R.CODE_TTL_MS, 10 * 60e3, 'codes live 10 minutes');
});

test('approval count: one approver for a member, two when the elder holds owner or admin', () => {
  assert.equal(R.approvalsNeeded('member'), 1);
  assert.equal(R.approvalsNeeded('editor'), 1);
  assert.equal(R.approvalsNeeded(null), 1);
  assert.equal(R.approvalsNeeded('admin'), 2);
  assert.equal(R.approvalsNeeded('owner'), 2);
});

test('who may approve: signed-in Google accounts only, top roles, managers of that person, the elder themself', () => {
  const base = { email: 'm@x.test', familyRole: 'editor', managedIds: set('P1'), selfIds: set() };
  assert.equal(R.canApprove(base, 'P1'), true, 'manager of P1');
  assert.equal(R.canApprove(base, 'P2'), false, 'not managed');
  assert.equal(R.canApprove({ ...base, managedIds: set(), selfIds: set('P1') }, 'P1'), true, 'the elder themself');
  assert.equal(R.canApprove({ ...base, familyRole: 'owner', managedIds: set() }, 'P9'), true, 'owner');
  assert.equal(R.canApprove({ ...base, familyRole: 'admin', managedIds: set() }, 'P9'), true, 'admin');
  assert.equal(R.canApprove({ ...base, familyRole: 'member', managedIds: set() }, 'P1'), false, 'member not managing');
  assert.equal(R.canApprove({ ...base, email: null, familyRole: 'admin' }, 'P1'), false, 'editor code cannot approve');
  assert.equal(R.canApprove(null, 'P1'), false);
});

test('two approvers: the second must be a different owner or admin', () => {
  assert.equal(R.secondApproverOk('a@x.test', { email: 'b@x.test', familyRole: 'owner' }), true);
  assert.equal(R.secondApproverOk('a@x.test', { email: 'b@x.test', familyRole: 'admin' }), true);
  assert.equal(R.secondApproverOk('a@x.test', { email: 'a@x.test', familyRole: 'owner' }), false, 'same person twice');
  assert.equal(R.secondApproverOk('a@x.test', { email: 'b@x.test', familyRole: 'editor' }), false, 'manager is not enough');
  assert.equal(R.secondApproverOk('a@x.test', { email: null, familyRole: 'admin' }), false, 'editor code');
  assert.equal(R.secondApproverOk('a@x.test', null), false);
});

test('managing a person (managers, devices, cards): top roles, managers, the elder device itself; not other devices', () => {
  assert.equal(R.canManagePerson({ familyRole: 'owner', managedIds: set() }, 'P1'), true);
  assert.equal(R.canManagePerson({ familyRole: 'member', managedIds: set('P1') }, 'P1'), true);
  assert.equal(R.canManagePerson({ familyRole: 'member', managedIds: set() }, 'P1'), false);
  assert.equal(R.canManagePerson({ device: true, personId: 'P1' }, 'P1'), true, 'the elder device');
  assert.equal(R.canManagePerson({ device: true, personId: 'P2' }, 'P1'), false, 'another elder device');
});

test('6-digit codes are zero-padded and come from the random source', () => {
  assert.equal(R.newUserCode(() => 7), '000007');
  assert.equal(R.newUserCode(() => 999999), '999999');
  assert.match(R.newUserCode(), /^\d{6}$/);
});

test('ids and hashes: device ids are 32 hex, secrets are unique, the hash is stable', () => {
  assert.equal(R.isDeviceId(R.newDeviceId()), true);
  assert.equal(R.isDeviceId('../../etc'), false);
  assert.notEqual(R.newSecret(), R.newSecret());
  assert.equal(R.sha256('abc'), R.sha256('abc'));
  assert.notEqual(R.sha256('abc'), R.sha256('abd'));
  assert.equal(R.sha256('token').length, 64, 'only the hash is stored');
});

test('rate limiter: max hits per window, reset after the window', () => {
  let now = 1000;
  const lim = R.makeLimiter(3, 60e3, () => now);
  assert.equal(lim.hit('ip').ok, true);
  assert.equal(lim.hit('ip').ok, true);
  assert.equal(lim.hit('ip').ok, true);
  const blocked = lim.hit('ip');
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec > 0 && blocked.retryAfterSec <= 60);
  assert.equal(lim.hit('other').ok, true, 'keys are separate');
  now += 60e3;
  assert.equal(lim.hit('ip').ok, true, 'a new window');
});

test('card and code expiry constants: devices last a year', () => {
  assert.equal(R.DEVICE_TTL_MS, 365 * 86400e3);
});

test('device label from the user agent: OS and browser, no version', () => {
  assert.equal(R.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), 'iPhone · Safari');
  assert.equal(R.deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36'), 'Android · Chrome');
  assert.equal(R.deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'), 'Mac · Safari');
  assert.equal(R.deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0 Safari/537.36 Edg/125.0'), 'Windows · Edge');
  assert.equal(R.deviceLabel(''), 'Thiết bị');
});
