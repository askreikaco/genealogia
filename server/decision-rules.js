// Family decisions (biểu quyết): the one rule that exists now, remove_person (COUNCIL.md, trimmed 2026-11-24).
// Pure functions; every time is passed in as epoch ms. Used by server/decisions.js and server/test/council.test.js.
'use strict';
const DAY = 864e5;
const RULE = {
  kind: 'remove_person',
  label: 'Gỡ khỏi gia phả',
  windowDays: 7,          // the vote closes after this; decided then, never earlier
  num: 2, den: 3,         // YES >= 2/3 of the voters
  minOtherYes: 2,         // and at least 2 YES besides the requester's
  activeDays: 180,        // "active" = signed in within this many days (never signed in: from joining)
};
const CHOICES = ['yes', 'no', 'abstain'];
// When every eligible voter has voted, the vote closes this long after the last vote (a changed mind in that time counts).
const GRACE_MS = 10 * 60e3;  // abstain: counts as voted, never as yes (it does not help a removal pass)
// Who may see each ballot: 'open' = everyone who sees the decision sees who voted what; 'secret' (later, elections) = counts only.
const BALLOT = { remove_person: 'open', merge_person: 'open' };

// While a vote is open: participation only (who has voted and who has not). No choices, no counts of choices.
function participationParts({ n, voted }) {
  const pending = Math.max(0, n - voted);
  const pct = (x) => (n ? (x / n) * 100 : 0);
  return { n, voted, pending, voted_pct: pct(voted), pending_pct: pct(pending) };
}
// The bar of an election-style tally: shares of the voters (0 when there are none), and the YES count needed to pass.
function barParts({ n, yes, no, abstain = 0 }) {
  const pending = Math.max(0, n - yes - no - abstain);
  const pct = (x) => (n ? (x / n) * 100 : 0);
  const need = n ? Math.ceil((RULE.num * n) / RULE.den) : 0; // yes*den >= num*n, so this is the first passing count
  return { n, yes, no, abstain, pending, yes_pct: pct(yes), no_pct: pct(no), abstain_pct: pct(abstain), pending_pct: pct(pending), need, need_pct: pct(need) };
}
const ACTIVE_DAYS = () => Math.max(1, Number(process.env.GP_ACTIVE_DAYS) || RULE.activeDays);

const norm = (e) => (e ? String(e).trim().toLowerCase() : null);

// Who may vote: a family setting (Cài đặt dòng họ › Biểu quyết), stored on the family and copied onto each decision when
// it opens. Every eligible voter has exactly one equal vote. 'active' (status active, not deceased, signed in within
// activeDays; never signed in: from joining) applies to every option.
const VOTE_RULES = {
  council: { label: 'Chủ họ và Quản trị', help: 'Mặc định. Chủ họ và Quản trị đang hoạt động bỏ phiếu.', roles: ['owner', 'admin'], tenureDays: 0 },
  council_editors: { label: 'Chủ họ, Quản trị và Biên tập viên', help: 'Thêm những người có quyền biên tập đang hoạt động.', roles: ['owner', 'admin', 'editor'], tenureDays: 0 },
  members: { label: 'Mọi thành viên đã tham gia từ 90 ngày', help: 'Mọi thành viên đang hoạt động và đã tham gia từ 90 ngày trở lên.', roles: ['owner', 'admin', 'editor', 'member'], tenureDays: 90 },
};
const DEFAULT_VOTE_RULE = 'council';

// The voters, fixed when the vote opens. members: [{ email, role, status, lastSeenMs, baselineMs, tenureMs }].
function voterSet({ members, rule = DEFAULT_VOTE_RULE, deceased = new Set(), nowMs, days = ACTIVE_DAYS() }) {
  const key = VOTE_RULES[rule] ? rule : DEFAULT_VOTE_RULE;
  const spec = VOTE_RULES[key];
  const cutoff = nowMs - days * DAY;
  const dead = new Set([...deceased].map(norm));
  const active = (m) => m.status === 'active' && !!norm(m.email) && !dead.has(norm(m.email))
    && (m.lastSeenMs ?? m.baselineMs ?? 0) >= cutoff;
  const eligible = members.filter((m) => spec.roles.includes(m.role) && active(m)
    && (spec.tenureDays === 0 || (m.tenureMs != null && nowMs - m.tenureMs >= spec.tenureDays * DAY)));
  return { voters: [...new Set(eligible.map((m) => norm(m.email)))], rule: key };
}
// Only when the family has one active owner or admin: the vote goes to every active member with editor rights or above;
// it passes at the window end unless one of them votes NO. Returns the electorate for that case.
const soloElectorate = (members, deceased, nowMs, days = ACTIVE_DAYS()) => {
  const cutoff = nowMs - days * DAY; const dead = new Set([...deceased].map(norm));
  return [...new Set(members.filter((m) => ['owner', 'admin', 'editor'].includes(m.role) && m.status === 'active' && !!norm(m.email)
    && !dead.has(norm(m.email)) && (m.lastSeenMs ?? m.baselineMs ?? 0) >= cutoff).map((m) => norm(m.email)))];
};

// Tally of YES and NO among the voters. yes includes the requester's own YES; yesOthers does not.
function tally({ voters, ballots = [], requester }) {
  const vs = new Set(voters.map(norm)); const req = norm(requester);
  const cur = new Map();
  for (const b of ballots) { const e = norm(b.email); if (vs.has(e)) cur.set(e, b.choice); }
  let yes = 0; let yesOthers = 0; let no = 0; let abstain = 0;
  for (const [e, c] of cur) {
    if (c === 'yes') { yes += 1; if (e !== req) yesOthers += 1; } else if (c === 'no') no += 1; else if (c === 'abstain') abstain += 1;
  }
  return { n: vs.size, yes, yesOthers, no, abstain };
}

// Normal case: 2/3 of the voters YES (whole numbers: yes*3 >= 2*n) and YES besides the requester's: min(2, voters - 1),
// so with two council members the other one's YES is enough.
function passes(t) {
  const need = Math.min(RULE.minOtherYes, Math.max(0, t.n - 1));
  return t.n > 0 && t.yes * RULE.den >= RULE.num * t.n && t.yesOthers >= need;
}
// Solo case (one owner or admin): passes unless an editor-or-above voted NO.
function passesSolo(t) { return t.no === 0; }

// Decided at the window end only. 'open' before it.
function decisionStatus({ state = 'open', closesMs, nowMs, passed }) {
  if (state !== 'open') return state;
  if (nowMs < closesMs) return 'open';
  return passed ? 'passed' : 'failed';
}

// The "nhập nhầm" fast path: the creator's own record, under 24 h old, nothing attached.
function quickDeleteOk({ creator, me, createdMs, nowMs, relations = 0, events = 0, stories = 0, descendants = 0 }) {
  if (!norm(me) || norm(creator) !== norm(me)) return { ok: false, why: 'not-mine' };
  if (createdMs == null || nowMs - createdMs >= 24 * 3600e3) return { ok: false, why: 'too-old' };
  if (relations || events || stories || descendants) return { ok: false, why: 'has-links' };
  return { ok: true, why: null };
}

module.exports = { DAY, GRACE_MS, RULE, CHOICES, BALLOT, barParts, participationParts, VOTE_RULES, DEFAULT_VOTE_RULE, norm, voterSet, soloElectorate, tally, passes, passesSolo, decisionStatus, quickDeleteOk };
