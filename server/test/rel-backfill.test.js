// Backfill integration: dry run writes nothing; --apply writes a backup first, then rows; re-run adds nothing.
// Runs on a SCRATCH database (GP_TEST_DATABASE_URL). Uses temp families only; rows are removed at the end.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM_FIX = `relfix-${TAG}`; const FAM_SEED = `relseed-${TAG}`;
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'copy-shaped.json'), 'utf8'));
const SEED = require(path.join(__dirname, '..', 'seed', 'demo-persons.json'));
const SEED_PC = SEED.filter((r) => r.data.parent).length; // one parent link per person who has a parent
const B = require(path.join(__dirname, '..', 'scripts', 'rel-backfill.js'));
let pool; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relbf-'));

async function makeFamily(fam, rows) {
  await pool.query('insert into families (id, slug, name, visibility) values ($1,$1,$2,$3)', [fam, 'Thử ' + fam, 'public']);
  for (const r of rows) await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [r.id, fam, r.data, 'test']);
}
const counts = async (fam) => (await pool.query(
  'select (select count(*)::int from parent_child where family_id=$1) pc, (select count(*)::int from couple where family_id=$1) cp', [fam])).rows[0];

test.before(async () => {
  if (skip) return;
  pool = new Pool({ connectionString: URL_, max: 2 });
  // Persons ids are global keys: rename the seed ids per run so they never collide with the real family.
  const seedRows = SEED.map((r) => ({ id: `S${TAG}${r.id}`, data: { ...r.data, parent: r.data.parent ? `S${TAG}${r.data.parent}` : undefined } }));
  const fixRows = FIX.map((r) => ({ id: `F${TAG}${r.id}`, data: JSON.parse(JSON.stringify(r.data, (k, v) => (typeof v === 'string' && /^P\d/.test(v) ? `F${TAG}${v}` : v))) }));
  await makeFamily(FAM_SEED, seedRows);
  await makeFamily(FAM_FIX, fixRows);
});

test.after(async () => {
  if (skip) return;
  for (const f of [FAM_SEED, FAM_FIX]) {
    await pool.query('delete from relation_migrations where family_id=$1', [f]);
    await pool.query('delete from couple where family_id=$1', [f]);
    await pool.query('delete from parent_child where family_id=$1', [f]);
    await pool.query('delete from history where person_id in (select id from persons where family_id=$1)', [f]);
    await pool.query('delete from persons where family_id=$1', [f]);
    await pool.query('delete from families where id=$1', [f]);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  await pool.end();
});

test('seed shape: dry run writes nothing; apply writes one link per parent, backup first; re-run adds nothing', { skip }, async () => {
  const f = (await B.loadFamily(pool, FAM_SEED));
  const p = await B.plan(pool, f);
  assert.equal(p.would_insert.parent_child, SEED_PC);
  assert.deepEqual(await counts(FAM_SEED), { pc: 0, cp: 0 }, 'dry run: no rows');
  const r = await B.apply(pool, p, { backupDir: dir, by: 'test' });
  assert.deepEqual(r.inserted, { parent_child: SEED_PC, couple: 0 });
  assert.ok(fs.existsSync(r.backup), 'backup file written');
  const bk = JSON.parse(fs.readFileSync(r.backup, 'utf8'));
  assert.equal(bk.persons.length, SEED.length, 'backup holds every person of the family');
  assert.equal(bk.parent_child.length, 0, 'backup holds the rows that existed before (none)');
  const again = await B.apply(pool, await B.plan(pool, f), { backupDir: dir, by: 'test' });
  assert.deepEqual(again.inserted, { parent_child: 0, couple: 0 }, 'idempotent');
  assert.equal((await counts(FAM_SEED)).pc, SEED_PC);
});

test('copy-shaped fixture: in-laws and second parents become couple + parent_child rows; anomalies reported and skipped', { skip }, async () => {
  const f = await B.loadFamily(pool, FAM_FIX);
  const p = await B.plan(pool, f);
  assert.ok(p.anomalies.some((a) => a.type === 'parent_missing'));
  assert.deepEqual(await counts(FAM_FIX), { pc: 0, cp: 0 });
  const r = await B.apply(pool, p, { backupDir: dir, by: 'test' });
  assert.equal(r.inserted.couple, 5, 'W1, W2, X1, P001X, P012 (chain) partnerships');
  assert.equal(r.inserted.parent_child, p.pc.length);
  const { rows } = await pool.query("select kind, order_a, start_year from couple where family_id=$1 and b_id=$2", [FAM_FIX, `F${TAG}P003`]);
  assert.deepEqual(rows.map((x) => [x.kind, x.order_a, x.start_year]), [['cuoi', 2, 1985]]);
  const mig = await pool.query('select counts from relation_migrations where family_id=$1', [FAM_FIX]);
  assert.equal(mig.rows.length, 1, 'family marked as migrated');
  assert.equal(p.already_migrated, false);
  const again = await B.plan(pool, f);
  assert.equal(again.already_migrated, true);
});
