// Give every person without a stable ID (persons.short_id) one, through the database's own generator.
// Usage: cd server && NODE_PATH=./node_modules node scripts/person-ids-backfill.js [--apply]
// Dry run (default): counts per family, writes nothing. --apply: one transaction, row by row (each new ID is checked
// against every ID set before it), version bumped so open apps sync the ID. Re-running changes nothing.
// DATABASE_URL is read from the environment or ../.env and never printed.
'use strict';
const fs = require('fs');
const path = require('path');
if (!process.env.DATABASE_URL) {
  try {
    const line = fs.readFileSync(path.resolve(__dirname, '..', '..', '.env'), 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  } catch {}
}
const { Pool } = require('pg');
const apply = process.argv.includes('--apply');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const c = await pool.connect();
  try {
    const per = await c.query("select coalesce(family_id,'(none)') as fam, count(*)::int as n from persons where short_id is null group by 1 order by 1");
    const missing = per.rows.reduce((s, r) => s + r.n, 0);
    for (const r of per.rows) console.log(`family ${r.fam}: ${r.n} without an ID`);
    console.log(`missing: ${missing}`);
    if (!apply) { console.log('DRY RUN: nothing written. Run with --apply to set them.'); return; }
    await c.query('begin');
    const ids = (await c.query('select id from persons where short_id is null order by id')).rows.map((r) => r.id);
    let n = 0;
    for (const id of ids) {
      const u = await c.query("update persons set short_id = giapha_new_short_id(), version = nextval('persons_version') where id = $1 and short_id is null", [id]);
      n += u.rowCount;
    }
    await c.query('commit');
    console.log(`APPLIED updated: ${n}`);
  } catch (e) { await c.query('rollback').catch(() => {}); console.error('FAILED', e.message); process.exitCode = 1; }
  finally { c.release(); await pool.end(); }
})();
