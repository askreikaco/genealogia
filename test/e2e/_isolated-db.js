// Per-file Postgres schema for the e2e files that write rows (GP_TEST_DATABASE_URL is shared by every file and by the
// server unit tests). The file's server pool gets search_path=<its own schema> through the connection options, so its
// migrations, fixtures, deletes and reads only ever see its own rows: the order of the files does not matter, and a
// file never wipes or restores another file's people. The schema is dropped and rebuilt at the start of each run.
'use strict';
const path = require('path');
const { Pool } = require(require.resolve('pg', { paths: [path.join(__dirname, '..', '..', 'server')] }));

function isolatedDb(baseUrl, name) {
  const schema = `e2e_${name.replace(/[^a-z0-9_]/g, '_')}`;
  const sep = baseUrl.includes('?') ? '&' : '?';
  const url = `${baseUrl}${sep}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
  const admin = (fn) => { const p = new Pool({ connectionString: baseUrl, max: 1 }); return fn(p).finally(() => p.end()); };
  return {
    schema, url,
    create: () => admin(async (p) => { await p.query(`drop schema if exists ${schema} cascade`); await p.query(`create schema ${schema}`); }),
    drop: () => admin((p) => p.query(`drop schema if exists ${schema} cascade`)),
  };
}
module.exports = { isolatedDb };
