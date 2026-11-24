// One sheet sync run. Usage: node scripts/sheet-sync.js [--dry-run]   (env: DATABASE_URL, GOOGLE_SA_SUBJECT, optional SHEET_ID/SHEET_TAB/GOOGLE_SA_FILE)
'use strict';
const { Pool } = require('pg');
const { runSync } = require('../sheetsync');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try { const r = await runSync(pool, { dryRun: process.argv.includes('--dry-run') }); console.log(JSON.stringify(r)); }
  finally { await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
