// Unit tests for the succession rules (pure: no DB, no network). The clock is injected: every time is epoch ms.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../succession-rules');

const D = (iso) => Date.parse(iso);
const DAY = 864e5;

test('chain order: accepted contacts by priority, then admins by tenure, then editors by tenure; owner and repeats out', () => {
  const chain = R.buildChain({
    ownerEmail: 'Owner@Example.test',
    contacts: [{ email: 'c2@x.test', priority: 2 }, { email: 'c1@x.test', priority: 1, name: 'Cô Một' }, { email: 'owner@example.test', priority: 0 }],
    members: [
      { email: 'a-late@x.test', role: 'admin', tenureMs: 300 },
      { email: 'a-early@x.test', role: 'admin', tenureMs: 100 },
      { email: 'c1@x.test', role: 'admin', tenureMs: 50 },        // already a contact: stays in the contact slot
      { email: 'e-old@x.test', role: 'editor', tenureMs: 10 },
      { email: 'e-new@x.test', role: 'editor', tenureMs: 200 },
      { email: 'm@x.test', role: 'member', tenureMs: 1 },          // members are never in the chain
    ],
  });
  assert.deepStrictEqual(chain.map((c) => `${c.source}:${c.email}`), [
    'contact:c1@x.test', 'contact:c2@x.test', 'admin:a-early@x.test', 'admin:a-late@x.test', 'editor:e-old@x.test', 'editor:e-new@x.test',
  ]);
  assert.strictEqual(chain[0].name, 'Cô Một');
});

test('chain: nobody to hand over to gives an empty chain', () => {
  assert.deepStrictEqual(R.buildChain({ ownerEmail: 'o@x.test', members: [{ email: 'm@x.test', role: 'member' }] }), []);
});

test('backers: 3 when 3+ other active members; a majority when fewer; none when nobody', () => {
  assert.strictEqual(R.requiredBackers(0), null);
  assert.strictEqual(R.requiredBackers(1), 1);
  assert.strictEqual(R.requiredBackers(2), 2);
  assert.strictEqual(R.requiredBackers(3), 3);
  assert.strictEqual(R.requiredBackers(4), 3);
  assert.strictEqual(R.requiredBackers(9), 3);
  assert.strictEqual(R.backingReached([{ email: 'a' }, { email: 'b' }], 3), false);
  assert.strictEqual(R.backingReached([{ email: 'a' }, { email: 'b' }, { email: 'c' }], 4), true);
  assert.strictEqual(R.backingReached([{ email: 'a' }], 2), false, 'majority of 2 is 2');
  assert.strictEqual(R.backingReached([{ email: 'a' }, { email: 'b' }], 2), true);
  assert.strictEqual(R.backingReached([], 0), false, 'a claim with nobody to back it never passes');
});

test('inactivity timers: reminders at 1 month, 1 week and 1 day before the due time (injected clock)', () => {
  const base = D('2025-01-10T00:00:00Z');
  const plan = R.reminderPlan(base, 12);
  assert.strictEqual(new Date(plan.due).toISOString(), '2026-01-10T00:00:00.000Z');
  assert.deepStrictEqual(plan.stages.map((s) => s.stage), ['1m', '1w', '1d']);
  assert.deepStrictEqual(R.dueStages(D('2025-12-09T23:59:00Z'), base, 12), []);
  assert.deepStrictEqual(R.dueStages(D('2025-12-10T00:00:00Z'), base, 12), ['1m']);
  assert.deepStrictEqual(R.dueStages(D('2026-01-03T00:00:00Z'), base, 12), ['1m', '1w']);
  assert.deepStrictEqual(R.dueStages(D('2026-01-09T12:00:00Z'), base, 12), ['1m', '1w', '1d']);
  assert.strictEqual(R.isInactive(D('2026-01-09T23:59:59Z'), base, 12), false);
  assert.strictEqual(R.isInactive(D('2026-01-10T00:00:00Z'), base, 12), true);
});

test('months: a day past the month end is clamped (31 Jan + 1 month = 28 Feb)', () => {
  assert.strictEqual(new Date(R.addMonths(D('2026-01-31T00:00:00Z'), 1)).toISOString(), '2026-02-28T00:00:00.000Z');
  assert.strictEqual(new Date(R.addMonths(D('2028-01-31T00:00:00Z'), 1)).toISOString(), '2028-02-29T00:00:00.000Z', 'leap year');
  assert.strictEqual(new Date(R.addMonths(D('2026-03-31T00:00:00Z'), -1)).toISOString(), '2026-02-28T00:00:00.000Z');
});

test('windows: notice 14 days, offer 14 days, claim 30 days, reclaim 90 days, invite 14 days', () => {
  const t = D('2026-05-01T08:00:00Z');
  assert.strictEqual(R.noticeEnd(t) - t, 14 * DAY);
  assert.strictEqual(R.offerEnd(t) - t, 14 * DAY);
  assert.strictEqual(R.claimEnd(t) - t, 30 * DAY);
  assert.strictEqual(R.reclaimUntil(t) - t, 90 * DAY);
  assert.strictEqual(R.inviteEnd(t) - t, 14 * DAY);
});

test('codes: 6 digits, bound to the offer token, checked in constant time, one per minute', () => {
  const code = R.makeCode();
  assert.match(code, /^[0-9]{6}$/);
  const tokenHash = R.hashToken(R.makeToken());
  const stored = R.hashCode('123456', tokenHash);
  assert.strictEqual(R.codeMatches('123456', tokenHash, stored), true);
  assert.strictEqual(R.codeMatches(' 123456 ', tokenHash, stored), true, 'spaces around the code are fine');
  assert.strictEqual(R.codeMatches('123457', tokenHash, stored), false);
  assert.strictEqual(R.codeMatches('123456', R.hashToken('other'), stored), false, 'a code is not valid for another offer');
  assert.strictEqual(R.codeMatches('12345', tokenHash, stored), false, 'not 6 digits');
  assert.strictEqual(R.codeMatches('123456', tokenHash, null), false, 'no code issued');
  const t = D('2026-05-01T08:00:00Z');
  assert.strictEqual(R.canSendCode(t, null), true);
  assert.strictEqual(R.canSendCode(t + 59e3, t), false);
  assert.strictEqual(R.canSendCode(t + 60e3, t), true);
  assert.strictEqual(R.codeExpiry(t) - t, 15 * 60e3);
});

test('tokens: 32 random bytes, stored only as a sha256', () => {
  const a = R.makeToken(); const b = R.makeToken();
  assert.notStrictEqual(a, b);
  assert.ok(a.length >= 43);
  assert.match(R.hashToken(a), /^[0-9a-f]{64}$/);
  assert.strictEqual(R.hashToken(a), R.hashToken(a));
  assert.notStrictEqual(R.hashToken(a), a);
});

test('reclaim: only the previous owner, once, within 90 days, and never while they already own it', () => {
  const resolved = D('2026-03-01T00:00:00Z');
  const base = { resolvedAt: resolved, from: 'old@x.test', currentOwner: 'new@x.test' };
  assert.strictEqual(R.reclaimCheck({ ...base, now: resolved + 89 * DAY, requester: 'OLD@x.test' }).ok, true, 'case-insensitive');
  assert.strictEqual(R.reclaimCheck({ ...base, now: resolved + 90 * DAY, requester: 'old@x.test' }).ok, true, 'the 90th day is still inside');
  const late = R.reclaimCheck({ ...base, now: resolved + 91 * DAY, requester: 'old@x.test' });
  assert.deepStrictEqual([late.ok, late.reason], [false, 'expired']);
  assert.strictEqual(R.reclaimCheck({ ...base, now: resolved + DAY, requester: 'new@x.test' }).reason, 'not-previous-owner');
  assert.strictEqual(R.reclaimCheck({ ...base, now: resolved + DAY, requester: 'old@x.test', alreadyReclaimed: true }).reason, 'already-reclaimed');
  assert.strictEqual(R.reclaimCheck({ ...base, now: resolved + DAY, requester: 'old@x.test', currentOwner: 'old@x.test' }).reason, 'already-owner');
  assert.strictEqual(R.reclaimCheck({ now: resolved, resolvedAt: null, from: 'old@x.test', requester: 'old@x.test', currentOwner: 'new@x.test' }).reason, 'no-handover');
});

test('claim: only when nothing is open and the family has nobody to hand over to (or the last handover ended blocked)', () => {
  assert.strictEqual(R.claimAllowed({ openHandover: { id: 1 }, chainCount: 0, lastBlocked: true }), false);
  assert.strictEqual(R.claimAllowed({ openHandover: null, chainCount: 0, lastBlocked: false }), true);
  assert.strictEqual(R.claimAllowed({ openHandover: null, chainCount: 2, lastBlocked: false }), false);
  assert.strictEqual(R.claimAllowed({ openHandover: null, chainCount: 2, lastBlocked: true }), true, 'chain ran out');
});

test('Refuse carries the status and a message', () => {
  const e = new R.Refuse(409, 'Xung đột');
  assert.strictEqual(e.status, 409);
  assert.strictEqual(e.message, 'Xung đột');
  assert.strictEqual(e.refuse, true);
});
