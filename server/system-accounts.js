// System accounts: QA and reference accounts whose only email identities are on the reserved .invalid domain
// (RFC 2606: no mailbox exists). They are not people: no handover offer, no death-report confirmation, no claim
// backing or objection notice, and they are not counted as an active admin. One predicate for the app (JS) and
// one SQL condition for queries over the members table.
'use strict';
const SYSTEM_DOMAIN = '.invalid';
const norm = (s) => String(s || '').trim().toLowerCase();

// account: { emails: [address, ...] }, every email identity of the account (verified or not).
// True when there is at least one email and every one of them is on the reserved domain.
function isSystemAccount(account) {
  const emails = (account?.emails || []).map(norm).filter(Boolean);
  return emails.length > 0 && emails.every((e) => e.endsWith(SYSTEM_DOMAIN));
}

// SQL condition over the members table (referenced as `members`): TRUE when the row is a system account, i.e. its own
// email is on the reserved domain, or its linked account has email identities and all of them are on that domain.
const SYSTEM_MEMBER_SQL = `(members.email like '%.invalid' or (members.account_id is not null
  and exists (select 1 from identities si where si.account_id = members.account_id and si.type = 'email')
  and not exists (select 1 from identities si where si.account_id = members.account_id and si.type = 'email' and si.value_norm not like '%.invalid')))`;

module.exports = { SYSTEM_DOMAIN, isSystemAccount, SYSTEM_MEMBER_SQL };
