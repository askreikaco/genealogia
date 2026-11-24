// Fills an EMPTY persons table with the FICTIONAL demo family (server/seed/demo-persons.json), only when
// GP_DEMO_SEED=1 (tests and local runs). Without it nothing is written: a fresh database starts empty, and real
// family data comes back from backups only (never from the repo). Logged in history as source=seed.
'use strict';
const path = require('path');
const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const n = (await pool.query('select count(*)::int n from persons')).rows[0].n;
  if (n > 0) { console.log(`persons has ${n} rows: seed skipped`); await pool.end(); return; }
  if (process.env.GP_DEMO_SEED !== '1') {
    console.log('GP_DEMO_SEED is not 1: nothing seeded, the database stays empty (restore real data from a backup)');
    await pool.end(); return;
  }
  const rows = require(path.join(__dirname, '..', 'seed', 'demo-persons.json'));
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const r of rows) {
      await client.query('insert into persons (id, data, updated_by) values ($1,$2,$3)', [r.id, r.data, 'seed']);
      await client.query("insert into history (person_id, field, new_value, by_user, source) values ($1,'*',$2,'seed','seed')", [r.id, JSON.stringify(r.data)]);
    }
    await client.query('commit');
    console.log('seeded demo family', rows.length);
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); await pool.end(); }
})().catch((e) => { console.error(e); process.exit(1); });
