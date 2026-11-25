// Backfill: flat contact fields (phone, email, zalo, facebook, address, social) -> the contacts list (contact-rules.js).
// Usage (from server/):
//   node scripts/backfill-contacts.js                          -> DRY RUN (default): counts only, no values printed, writes nothing
//   node scripts/backfill-contacts.js --apply --backup <file>  -> writes a JSON backup of every row it changes FIRST, then
//                                                                 moves the values in ONE transaction (version bump, one
//                                                                 history row per person, by 'backfill')
// The read path already understands both shapes, so running this is optional for display; it keeps exports and the
// list in one place. Rows that already hold a list are never touched. Run it only with a fresh backup of the database.
'use strict';
const fs = require('fs');
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));
if (!process.env.DATABASE_URL) { // read only DATABASE_URL from ../.env (never printed)
  const f = path.resolve('..', '.env');
  const line = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL=')) : null;
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}
const { backfillPlan, LEGACY_KEYS } = require('../contact-rules');

// Pure: rows [{ id, data, family_id }] -> plans [{ id, family_id, flat, contacts, remove, flagged }]
function planAll(rows) {
  const plans = [];
  for (const r of rows) {
    const p = backfillPlan(r.data);
    if (p) plans.push({ id: r.id, family_id: r.family_id, flat: LEGACY_KEYS.filter((k) => r.data[k]).reduce((o, k) => ({ ...o, [k]: r.data[k] }), {}), ...p });
  }
  return plans;
}
// The summary printed by the dry run: counts by type and flags, never a value.
function summarize(plans) {
  const types = {};
  for (const p of plans) for (const c of p.contacts) types[c.type] = (types[c.type] || 0) + 1;
  return { persons: plans.length, items: plans.reduce((n, p) => n + p.contacts.length, 0), by_type: types, flagged: plans.filter((p) => p.flagged).length };
}
// Writes the plans in one transaction. Each person: data without the flat keys + contacts, version + 1, one history row.
async function applyPlans(client, plans, { by = 'backfill' } = {}) {
  await client.query('begin');
  try {
    for (const p of plans) {
      const { rowCount } = await client.query(
        `update persons set data = (data - $2::text[]) || jsonb_build_object('contacts', $3::jsonb), version = version + 1
          where id = $1 and not (data ? 'contacts')`, [p.id, p.remove, JSON.stringify(p.contacts)]);
      if (rowCount !== 1) throw new Error(`person ${p.id}: row changed or already has a list; nothing applied`);
      await client.query('insert into history (person_id, field, old_value, new_value, by_user, source) values ($1, $2, $3, $4, $5, $6)',
        [p.id, 'contacts', JSON.stringify(p.flat), JSON.stringify(p.contacts), by, 'backfill']);
    }
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; }
  return plans.length;
}

module.exports = { planAll, summarize, applyPlans };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const bi = args.indexOf('--backup');
  const backup = bi >= 0 ? args[bi + 1] : null;
  (async () => {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
      const { rows } = await client.query('select id, family_id, data from persons where data ?| $1::text[]', [LEGACY_KEYS]);
      const plans = planAll(rows);
      const s = summarize(plans);
      console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${rows.length} rows have flat contact fields; ${s.persons} to move, ${s.items} list items, ${s.flagged} flagged (kept as "other").`);
      console.log('items by type:', JSON.stringify(s.by_type));
      if (!apply) { console.log('Nothing written. Re-run with --apply --backup <file> after a database backup.'); return; }
      if (!backup) throw new Error('--apply needs --backup <file> (a JSON copy of the rows is written there first)');
      fs.writeFileSync(backup, JSON.stringify(rows.filter((r) => plans.some((p) => p.id === r.id)), null, 2), { mode: 0o600 });
      console.log(`backup written: ${backup}`);
      const n = await applyPlans(client, plans);
      console.log(`applied to ${n} persons.`);
    } finally { client.release(); await pool.end(); }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
