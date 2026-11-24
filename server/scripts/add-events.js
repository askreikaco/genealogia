// Add reviewed events to ONE person through the app's own event insert (one 'su_kien' history row each).
// Usage: cd server && NODE_PATH=./node_modules node scripts/add-events.js <spec.json> [--apply]
// Dry run (default) prints the table and writes nothing. --apply: one transaction; idempotent by legacy_key
// (needs migration 022); the person's own fields (born, died, ...) are never changed. DATABASE_URL from ../.env.
'use strict';
const fs = require('fs'); const path = require('path');
if (!process.env.DATABASE_URL) {
  const line = fs.readFileSync(path.resolve('..', '.env'), 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}
const { Pool } = require('pg');
const EV = require(path.resolve('events.js'));
const [file, flag] = process.argv.slice(2); const apply = flag === '--apply';
const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
const when = (e) => ({ exact: '', about: 'khoảng ', before: 'trước ', after: 'sau ', between: '' }[e.date_kind] || '') + (e.date_kind === 'between' ? `${e.date_from}–${e.date_to}` : e.date_from);
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const c = await pool.connect();
  try {
    await c.query('begin');
    const p = await c.query('select id, data from persons where id=$1 and family_id=$2 and not deleted', [spec.person_id, spec.family]);
    if (p.rowCount !== 1) throw new Error('person not found in that family');
    const have = new Set((await c.query('select legacy_key from events where person_id=$1 and legacy_key is not null', [spec.person_id])).rows.map((r) => r.legacy_key));
    console.log(`${spec.person_id} ${p.rows[0].data.name}: ${spec.events.length} proposed`);
    let n = 0;
    for (const e of spec.events) {
      const status = have.has(e.legacy_key) ? 'already there' : (apply ? 'added' : 'would add');
      console.log(`  ${status.padEnd(13)} | ${e.type.padEnd(10)} | ${when(e).padEnd(16)} | ${e.description.slice(0, 90)}…`);
      if (have.has(e.legacy_key) || !apply) continue;
      const ev = await EV.insertEvent(c, spec.family, spec.person_id, e, spec.by);
      await c.query('update events set legacy_key=$2 where id=$1', [ev.id, e.legacy_key]);
      n++;
    }
    if (apply) await c.query('commit'); else await c.query('rollback');
    console.log(apply ? `APPLIED: ${n} events` : 'DRY RUN: nothing written');
  } catch (e) { await c.query('rollback').catch(() => {}); console.error('FAILED', e.message); process.exitCode = 1; }
  finally { c.release(); await pool.end(); }
})();
