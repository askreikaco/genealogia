// Pure rules for elder access: device sign-in codes, approvals, sign-in cards, rate limits. No I/O (tested in test/elder-rules.test.js).
'use strict';
const crypto = require('crypto');

const CODE_TTL_MS = 10 * 60e3;          // a sign-in code lives 10 minutes
const DEVICE_TTL_MS = 365 * 86400e3;    // an elder device stays signed in for a year, until revoked
const TOP = new Set(['owner', 'admin']);

const isTop = (role) => TOP.has(role);
// Two approvals when the elder holds owner or admin in the family (re-link of a top role needs a second person).
const approvalsNeeded = (elderFamilyRole) => (isTop(elderFamilyRole) ? 2 : 1);

// Who may approve a sign-in for `personId`. A device (no email) and the shared editor code can never approve:
// every approval is tied to a signed-in Google account, so it can be logged and notified.
// actor = { email, familyRole, managedIds: Set<personId>, selfIds: Set<personId> }
function canApprove(actor, personId) {
  if (!actor || !actor.email) return false;
  if (isTop(actor.familyRole)) return true;
  return actor.managedIds.has(personId) || actor.selfIds.has(personId);
}
// Second approval: a different signed-in owner or admin than the first.
function secondApproverOk(firstEmail, second) {
  return !!second && !!second.email && second.email !== firstEmail && isTop(second.familyRole);
}
// Same rule for who may manage a person (managers, devices, cards): top roles, managers, or the elder themself.
// actor may be a device account: { device: true, personId }.
function canManagePerson(actor, personId) {
  if (!actor) return false;
  if (actor.device) return actor.personId === personId;
  if (isTop(actor.familyRole)) return true;
  return actor.managedIds?.has(personId) || actor.selfIds?.has(personId) || false;
}
// P1d: who may set a living person's own visibility to non-members (self_visibility). Only the linked account (selfIds),
// its managers (managedIds) or the person's own device. Family owners and admins are NOT included: they cannot change it.
function canSetSelfVisibility(actor, personId) {
  if (!actor) return false;
  if (actor.device) return actor.personId === personId;
  if (!actor.email) return false;
  return !!(actor.managedIds?.has(personId) || actor.selfIds?.has(personId));
}
// State of a sign-in request at `now`: pending | approved | consumed | expired.
function codeState(row, now) {
  if (!row) return 'expired';
  if (row.status === 'consumed') return 'consumed';
  if (row.status === 'approved') return 'approved';
  if (new Date(row.expires_at).getTime() <= now) return 'expired';
  return 'pending';
}
// A 6-digit code, uniform. `randomInt` is injectable for tests.
const newUserCode = (randomInt = crypto.randomInt) => String(randomInt(0, 1000000)).padStart(6, '0');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newSecret = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const newDeviceId = () => crypto.randomBytes(16).toString('hex');
const isDeviceId = (s) => /^[a-f0-9]{32}$/.test(String(s || ''));
// A short label for a device from its user agent: 'iPhone · Safari', 'Android · Chrome', 'Mac · Safari'. No version, no id.
function deviceLabel(ua) {
  const u = String(ua || '');
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android'
    : /Windows/.test(u) ? 'Windows' : /Macintosh|Mac OS/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : '';
  const br = /Edg\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox'
    : /Chrome\/|CriOS\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ').slice(0, 60) || 'Thiết bị';
}

// In-memory fixed window limiter: `max` hits per `windowMs` per key. Returns { ok, retryAfterSec }.
function makeLimiter(max, windowMs, now = () => Date.now()) {
  const m = new Map();
  return {
    hit(key) {
      const t = now(); const e = m.get(key);
      if (!e || t - e.at >= windowMs) { m.set(key, { n: 1, at: t }); return { ok: true, retryAfterSec: 0 }; }
      e.n++;
      if (e.n > max) return { ok: false, retryAfterSec: Math.ceil((e.at + windowMs - t) / 1000) };
      return { ok: true, retryAfterSec: 0 };
    },
    peek(key) { const e = m.get(key); const t = now(); return !!e && t - e.at < windowMs && e.n >= max; },
    reset() { m.clear(); },
  };
}

module.exports = {
  CODE_TTL_MS, DEVICE_TTL_MS, isTop, approvalsNeeded, canApprove, secondApproverOk, canManagePerson, canSetSelfVisibility,
  codeState, newUserCode, sha256, newSecret, newDeviceId, isDeviceId, makeLimiter, deviceLabel,
};
