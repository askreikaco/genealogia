// Backfill parent_child + couple from the legacy person fields (parent, other_parent, spouse_of, spouse_n, married).
// DRY RUN by default: prints counts, 20 sample rows and every anomaly, writes nothing.
// --apply (explicit) writes a JSON backup of the affected rows FIRST, then inserts (idempotent: re-running adds nothing),
// then records the family in relation_migrations, which switches that family's reads to the new tables.
// Usage (server/): node scripts/rel-backfill.js [--family <id|slug>] [--apply] [--backup-dir <dir>]
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Pool } = require('pg');

const LIB = pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'relgraph.js')).href;
const relLib = () => import(LIB);

// Families to map: one (--family) or all. Persons not deleted, with their family.
async function loadFamily(pool, ref) {
  const { rows: fr } = await pool.query('select id, name from families where id = $1 or slug = $1', [ref]);
  if (!fr.length) throw new Error(`Không có dòng họ: ${ref}`);
  return fr[0];
}

// Dry-run plan for one family. Pure reads.
async function plan(pool, fam) {
  const R = await relLib();
  const { rows: persons } = await pool.query('select id, data from persons where family_id = $1 and not deleted order by id', [fam.id]);
  const L = R.legacyRows(persons.map((p) => ({ id: p.id, data: p.data || {} })));
  const { rows: mig } = await pool.query('select migrated_at from relation_migrations where family_id = $1', [fam.id]);
  const { rows: ex } = await pool.query('select (select count(*)::int from parent_child where family_id = $1) pc, (select count(*)::int from couple where family_id = $1) cp', [fam.id]);
  const name = new Map(persons.map((p) => [p.id, (p.data || {}).name || p.id]));
  const pcNew = L.pc.length; const cpNew = L.cp.length;
  const samples = [
    ...L.pc.slice(0, 12).map((r) => `parent_child  ${r.parent_id} ${name.get(r.parent_id)} -> ${r.child_id} ${name.get(r.child_id)} (${r.kind}, thứ ${r.birth_order ?? '-'})`),
    ...L.cp.slice(0, 8).map((r) => `couple        ${r.a_id} ${name.get(r.a_id)} + ${r.b_id} ${name.get(r.b_id)} (${r.kind}, ${r.order_a ?? '-'}, năm ${r.start_year ?? '-'})`),
  ].slice(0, 20);
  return {
    family: fam.id, name: fam.name, persons: persons.length, already_migrated: mig.length > 0, existing: ex[0],
    would_insert: { parent_child: pcNew, couple: cpNew }, anomalies: L.anomalies, samples, pc: L.pc, cp: L.cp, persons_rows: persons,
  };
}

// Apply one family's plan. Backup first (written and flushed before any insert), then one transaction.
async function apply(pool, p, { backupDir, by }) {
  fs.mkdirSync(backupDir, { recursive: true });
  const { rows: affected } = await pool.query(
    'select id, data, version from persons where family_id = $1 and not deleted', [p.family]);
  const { rows: pcOld } = await pool.query('select * from parent_child where family_id = $1', [p.family]);
  const { rows: cpOld } = await pool.query('select * from couple where family_id = $1', [p.family]);
  const file = path.join(backupDir, `rel-${p.family}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, JSON.stringify({ family: p.family, at: new Date().toISOString(), by, persons: affected, parent_child: pcOld, couple: cpOld }, null, 1));
  fs.fsyncSync(fd); fs.closeSync(fd);
  const client = await pool.connect();
  const ins = { parent_child: 0, couple: 0 };
  try {
    await client.query('begin');
    for (const r of p.pc) {
      const { rowCount } = await client.query(
        `insert into parent_child (family_id, parent_id, child_id, kind, birth_order, private, created_by)
         values ($1,$2,$3,$4,$5,false,$6) on conflict (family_id, parent_id, child_id) do nothing`,
        [p.family, r.parent_id, r.child_id, r.kind, r.birth_order, by]);
      ins.parent_child += rowCount;
    }
    for (const r of p.cp) {
      const { rowCount } = await client.query(
        `insert into couple (family_id, a_id, b_id, kind, order_a, order_b, start_year, end_year, private, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10)
         on conflict (family_id, a_id, b_id, kind, coalesce(start_year, -1)) do nothing`,
        [p.family, r.a_id, r.b_id, r.kind, r.order_a, r.order_b, r.start_year, r.end_year, r.note, by]);
      ins.couple += rowCount;
    }
    await client.query(
      `insert into relation_migrations (family_id, migrated_by, counts) values ($1,$2,$3)
       on conflict (family_id) do update set counts = excluded.counts`,
      [p.family, by, JSON.stringify({ inserted: ins, anomalies: p.anomalies.length, backup: path.basename(file) })]);
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  return { inserted: ins, backup: file };
}

function report(p) {
  const { anomalies, samples } = p;
  const byType = anomalies.reduce((m, a) => ((m[a.type] = (m[a.type] || 0) + 1), m), {});
  return [
    `== ${p.family} (${p.name}) persons=${p.persons} migrated=${p.already_migrated ? 'yes' : 'no'} existing parent_child=${p.existing.pc} couple=${p.existing.cp}`,
    `would insert: parent_child=${p.would_insert.parent_child} couple=${p.would_insert.couple}`,
    `anomalies: ${anomalies.length} ${JSON.stringify(byType)}`,
    ...anomalies.slice(0, 50).map((a) => `  - ${a.type} ${a.person}${a.ref ? ' -> ' + a.ref : ''}`),
    'sample rows:', ...samples.map((s) => '  ' + s),
  ].join('\n');
}

module.exports = { plan, apply, loadFamily, report };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
    const doApply = args.includes('--apply');
    const backupDir = val('--backup-dir') || path.join(process.cwd(), 'rel-backups');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    try {
      const fams = val('--family') ? [await loadFamily(pool, val('--family'))]
        : (await pool.query('select id, name from families order by id')).rows;
      for (const f of fams) {
        const p = await plan(pool, f);
        console.log(report(p));
        if (doApply && !p.already_migrated) {
          const r = await apply(pool, p, { backupDir, by: process.env.USER || 'rel-backfill' });
          console.log(`applied: inserted ${JSON.stringify(r.inserted)}; backup ${r.backup}`);
        } else if (doApply) console.log('already migrated: nothing written (re-run inserts are idempotent: use --family to reapply after a fix)');
        else console.log('dry run: nothing written. Re-run with --apply after owner approval.');
      }
    } finally { await pool.end(); }
  })().catch((e) => { console.error(e); process.exit(1); });
}
