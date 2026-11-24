// Succession rules as pure functions (no DB, no network, no clock: every time is passed in as epoch ms).
// Tested in test/succession-rules.test.js. The engine (succession.js) and the routes use these.
'use strict';
const crypto = require('crypto');
const { isSystemAccount } = require('./system-accounts');

const DAY = 864e5;
const RULES = {
  INACTIVE_MONTHS: [3, 6, 12, 18], // owner_inactive_months choices (Cài đặt dòng họ)
  NOTICE_DAYS: 14,                 // notice to the owner before offers start (cancel by signing in)
  OFFER_DAYS: 14,                  // each offer stays open this long
  CLAIM_DAYS: 30,                  // member claim: backers window, and then the objection window (owner refusal, member objection)
  RECLAIM_DAYS: 90,                // previous owner may take the role back this long after a handover
  CODE_MINUTES: 15,                // email code for an offer
  CODE_TRIES: 5,                   // wrong codes in all for one offer; the 5th closes the offer (the chain moves on)
  CODE_RESEND_MS: 60e3,            // one code per minute per offer
  INVITE_DAYS: 14,                 // trusted-contact invite
  MAX_CONTACTS: 3,                 // trusted contacts per family (accepted or invited)
  CLAIM_BACKERS: 3,                // backers needed when there are at least this many other active members
};

// Calendar months in UTC (Date rolls over month ends the usual way). n may be negative.
// A day past the month's end is clamped to the last day (31 Jan + 1 month = 28/29 Feb).
function addMonths(ms, n) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

// The owner's inactivity: the baseline is the owner's last sign-in (or the moment they joined, if never seen).
// Reminders come one month, one week and one day before the due time. Due = baseline + months.
function reminderPlan(baselineMs, months) {
  const due = addMonths(baselineMs, months);
  return {
    due,
    stages: [
      { stage: '1m', at: addMonths(due, -1) },
      { stage: '1w', at: due - 7 * DAY },
      { stage: '1d', at: due - DAY },
    ],
  };
}
// The reminder stages that are due by `now` (their time has come), oldest first.
const dueStages = (now, baselineMs, months) => reminderPlan(baselineMs, months).stages.filter((s) => s.at <= now).map((s) => s.stage);
const isInactive = (now, baselineMs, months) => now >= reminderPlan(baselineMs, months).due;

const addDays = (ms, n) => ms + n * DAY;
const noticeEnd = (startMs) => addDays(startMs, RULES.NOTICE_DAYS);
const offerEnd = (offeredMs) => addDays(offeredMs, RULES.OFFER_DAYS);
const claimEnd = (startMs) => addDays(startMs, RULES.CLAIM_DAYS);
const reclaimUntil = (resolvedMs) => addDays(resolvedMs, RULES.RECLAIM_DAYS);
const inviteEnd = (createdMs) => addDays(createdMs, RULES.INVITE_DAYS);

// The offer chain, in order: accepted trusted contacts by priority, then admins by tenure, then editors by tenure.
// Each email once (the first place it appears wins). The owner is never in the chain.
// contacts: [{ email, name, priority }]; members: [{ email, name, role, tenureMs }] (role 'admin' | 'editor' | 'member' | 'owner').
function buildChain({ contacts = [], members = [], ownerEmail = null }) {
  const owner = norm(ownerEmail);
  const seen = new Set([owner].filter(Boolean));
  const out = [];
  const add = (email, source, name) => {
    const e = norm(email);
    if (!e || seen.has(e)) return;
    seen.add(e); out.push({ email: e, source, name: name || null });
  };
  const byPriority = [...contacts].sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity) || String(a.email).localeCompare(String(b.email)));
  for (const c of byPriority) if (!isSystemAccount({ emails: [c.email] })) add(c.email, 'contact', c.name);
  const byTenure = (role) => members
    .filter((m) => m.role === role && !isSystemAccount({ emails: [m.email] }))
    .sort((a, b) => (a.tenureMs ?? Infinity) - (b.tenureMs ?? Infinity) || String(a.email).localeCompare(String(b.email)));
  for (const m of byTenure('admin')) add(m.email, 'admin', m.name);
  for (const m of byTenure('editor')) add(m.email, 'editor', m.name);
  return out;
}

// Backers needed for a claim: 3 when there are 3 or more other active members; a majority when fewer; null when none
// (then nobody can back the claim, and it cannot pass).
function requiredBackers(others) {
  if (others >= RULES.CLAIM_BACKERS) return RULES.CLAIM_BACKERS;
  if (others >= 1) return Math.floor(others / 2) + 1;
  return null;
}
const backingReached = (backers, others) => { const need = requiredBackers(others); return need !== null && backers.length >= need; };

// Tokens for links (offers and invites): 32 random bytes, sent once. Only the sha256 is stored.
const makeToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
// The 6-digit code. Stored bound to its offer's token hash, so a code cannot be used on another offer.
const makeCode = () => String(crypto.randomInt(0, 1e6)).padStart(6, '0');
const hashCode = (code, tokenHash) => crypto.createHash('sha256').update(`${tokenHash}:${String(code).trim()}`).digest('hex');
function codeMatches(code, tokenHash, storedHash) {
  if (!storedHash || !/^[0-9]{6}$/.test(String(code || '').trim())) return false;
  const a = Buffer.from(hashCode(code, tokenHash)); const b = Buffer.from(storedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const codeExpiry = (now) => now + RULES.CODE_MINUTES * 60e3;
const canSendCode = (now, lastSentMs) => !lastSentMs || now - lastSentMs >= RULES.CODE_RESEND_MS;

// Reclaim: the previous owner (`from`) may take the role back within 90 days, once, while the new owner is not them.
function reclaimCheck({ now, resolvedAt, from, requester, currentOwner, alreadyReclaimed = false }) {
  const who = norm(requester); const prev = norm(from); const cur = norm(currentOwner);
  if (!who || !prev || who !== prev) return { ok: false, reason: 'not-previous-owner' };
  if (alreadyReclaimed) return { ok: false, reason: 'already-reclaimed' };
  if (!resolvedAt) return { ok: false, reason: 'no-handover' };
  const until = reclaimUntil(resolvedAt);
  if (now > until) return { ok: false, reason: 'expired', until };
  if (cur === who) return { ok: false, reason: 'already-owner', until };
  return { ok: true, until };
}

// A new claim may start only when no handover is open, and the family has nobody to hand over to (no accepted
// contact, active admin or editor), or the last handover ended blocked (the chain ran out).
function claimAllowed({ openHandover, chainCount, lastBlocked }) {
  if (openHandover) return false;
  return chainCount === 0 || !!lastBlocked;
}

const norm = (e) => (e ? String(e).trim().toLowerCase() : null);

module.exports = {
  RULES, DAY, addMonths, reminderPlan, dueStages, isInactive, noticeEnd, offerEnd, claimEnd, reclaimUntil, inviteEnd,
  buildChain, requiredBackers, backingReached, makeToken, hashToken, makeCode, hashCode, codeMatches, codeExpiry, canSendCode,
  reclaimCheck, claimAllowed, norm,
};

// An error the routes answer with its status (the message is in Vietnamese and safe to show).
class Refuse extends Error {
  constructor(status, msg) { super(msg); this.status = status; this.refuse = true; }
}
module.exports.Refuse = Refuse;
