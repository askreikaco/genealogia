// Backfill accounts (account plan P1): one account per email that has PROOF of a past Google sign-in, with that email
// as its verified, primary identity; then account_id is filled on members, person_managers, user_prefs and suggestions
// for every account's verified emails. Emails without proof (invited, never signed in) are left alone: their account
// is made on their first Google sign-in, and roles keep working through the email meanwhile.
// Proof of sign-in: a Google passkey (passkeys.account 'g:<email>'), saved preferences (user_prefs, written only by a
// signed-in account), a suggestion sent while signed in (suggestions.account_email), or members.last_seen_at.
// DRY RUN by default (one transaction, rolled back; prints counts). --apply commits. Idempotent: a re-run creates
// nothing new. Take the database backup first (ops: giapha-backup.sh); this script only adds rows and fills nulls.
// Usage (from server/): node scripts/accounts-backfill.js [--apply]
'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const A = require('../accounts');

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // read only DATABASE_URL from ../.env (never printed)
  const line = fs.readFileSync(path.resolve(__dirname, '..', '..', '.env'), 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
  return line ? line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '') : '';
}

async function candidates(q) {
  const { rows } = await q.query(`
    select lower(email) as email, max(name) as name, array_agg(distinct src) as src from (
      select substr(account, 3) as email, '' as name, 'passkey' as src from passkeys where account like 'g:%'
      union all select email, '', 'prefs' from user_prefs
      union all select account_email, '', 'suggestion' from suggestions where account_email is not null
      union all select email, coalesce(name, ''), 'seen' from members where last_seen_at is not null
    ) x where email ~ '^[^[:space:]@]+@[^[:space:]@]+$' group by lower(email) order by 1`);
  return rows.filter((r) => A.isEmail(r.email));
}

async function run({ apply, pool, log = console.log }) {
  const c = await pool.connect();
  const out = { candidates: 0, existing: 0, created: 0, filled: {} };
  try {
    await c.query('begin');
    const list = await candidates(c);
    out.candidates = list.length;
    for (const r of list) {
      if (await A.byEmail(c, r.email)) { out.existing++; continue; }
      await A.createWithEmail(c, r.email, r.name);
      out.created++;
    }
    for (const [t, col] of [['members', 'email'], ['person_managers', 'email'], ['user_prefs', 'email'], ['suggestions', 'account_email']]) {
      const { rowCount } = await c.query(`update ${t} x set account_id = i.account_id from identities i
        where x.account_id is null and i.type = 'email' and i.verified_at is not null and i.value_norm = lower(x.${col})`);
      out.filled[t] = rowCount;
    }
    const { rows: left } = await c.query("select count(*)::int as n from members where account_id is null and status = 'active'");
    out.members_without_account = left[0].n; // invited, never signed in: filled on their first sign-in
    if (apply) await c.query('commit'); else await c.query('rollback');
    log(`${apply ? 'APPLIED' : 'DRY RUN (nothing written)'}: ${JSON.stringify(out)}`);
    return out;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}

module.exports = { run, candidates };

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const pool = new Pool({ connectionString: databaseUrl(), max: 2 });
  run({ apply, pool }).then(() => pool.end()).catch((e) => { console.error('FAILED', e.message); process.exitCode = 1; pool.end(); });
}
