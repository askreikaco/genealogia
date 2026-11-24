// Apply every migrations/*.sql in order (each file is idempotent).
'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    console.log('applied', f);
  }
  await require('../members-seed').seedMembers(pool);
  console.log('members seeded from env');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
