// Backfill: profile facts (An táng, Nghề, Tôn giáo, Nơi sống, dated note sentences) -> Dòng đời events.
// DRY RUN by default: per family, counts per type, skipped and anomalies, sample rows; writes nothing.
// --apply: writes a JSON backup of the family's events FIRST, then adds the missing events in one transaction through
// the app's own event insert (one 'su_kien' history row each), tagged with legacy_key. Idempotent: a re-run adds
// nothing (op id per person + source, and a unique (person_id, legacy_key) index). Profile fields are never changed.
// Usage (from server/): node scripts/facts-to-events.js [--family <id|slug>] [--no-notes] [--apply] [--backup-dir <dir>] [--by <name>]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { proposeFacts } = require('../facts-events');
const EV = require('../events');

// One op id per person + source: a backfilled event someone deleted later is never added again.
const opIdOf = (personId, key) => 'facts-' + crypto.createHash('sha1').update(personId + '|' + key).digest('hex').slice(0, 20);

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // read only DATABASE_URL from ../.env (never printed)
  const line = fs.readFileSync(path.resolve(__dirname, '..', '..', '.env'), 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
  return line ? line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '') : '';
}

async function loadFamilies(q, ref) {
  if (!ref) return (await q.query('select id, name from families order by id')).rows;
  const { rows } = await q.query('select id, name from families where id = $1 or slug = $1', [ref]);
  if (!rows.length) throw new Error(`Không có dòng họ: ${ref}`);
  return rows;
}

// Dry-run plan for one family. Reads only.
async function plan(q, fam, { notes = true } = {}) {
  const { rows: persons } = await q.query('select id, data from persons where family_id = $1 and not deleted order by id', [fam.id]);
  const { rows: evs } = await q.query('select person_id, type, date_from, legacy_key from events where family_id = $1', [fam.id]);
  const byPerson = new Map(); const done = new Set();
  for (const e of evs) {
    if (!byPerson.has(e.person_id)) byPerson.set(e.person_id, []);
    byPerson.get(e.person_id).push(e);
    if (e.legacy_key) done.add(e.person_id + '|' + e.legacy_key);
  }
  const { rows: ops } = await q.query("select op_id from ops where op_id like 'facts-%'");
  const claimed = new Set(ops.map((o) => o.op_id));
  const perType = {}; const skipped = {}; const anomalies = []; const samples = []; const inserts = []; let already = 0;
  for (const p of persons) {
    // events this backfill added earlier do not block their own source (they are counted as already done)
    const typed = (byPerson.get(p.id) || []).filter((e) => !e.legacy_key);
    const r = await proposeFacts(p.data, { notes, existing: typed });
    for (const a of r.anomalies) anomalies.push({ ...a, person: p.id });
    for (const s of r.skipped) skipped[s.reason] = (skipped[s.reason] || 0) + 1;
    for (const row of r.rows) {
      if (done.has(p.id + '|' + row.legacy_key)) { already++; continue; }
      if (claimed.has(opIdOf(p.id, row.legacy_key))) { skipped.removed = (skipped.removed || 0) + 1; continue; }
      perType[row.type] = (perType[row.type] || 0) + 1;
      inserts.push({ person_id: p.id, ...row });
      if (samples.length < 20) samples.push(`${p.id} | ${row.from} -> ${row.type} "${row.date_text}" ${row.place}${row.description ? ' / ' + row.description.slice(0, 80) : ''}`);
    }
  }
  return { family: fam.id, name: fam.name, persons: persons.length, already, perType, skipped, anomalies, samples, inserts };
}

function report(p) {
  return [
    `== ${p.family} (${p.name}) persons=${p.persons}`,
    `would add: ${p.inserts.length} ${JSON.stringify(p.perType)}`,
    `already added earlier: ${p.already}`,
    `skipped: ${JSON.stringify(p.skipped)} (derived = Dòng đời shows it from the profile; profile = undated field the profile already shows; has_event = the person already has that event; removed = added before, then deleted by someone)`,
    `anomalies: ${p.anomalies.length}`, ...p.anomalies.slice(0, 30).map((a) => `  - ${a.type} ${a.person} field=${a.field}`),
    'sample rows:', ...p.samples.map((s) => '  ' + s),
  ].join('\n');
}

// Apply one family's plan: backup, then one transaction. Returns { inserted, backup }.
async function apply(pool, p, { backupDir, by }) {
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const { rows: old } = await pool.query('select * from events where family_id = $1', [p.family]);
  const file = path.join(backupDir, `facts-${p.family}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const fd = fs.openSync(file, 'w', 0o600);
  fs.writeSync(fd, JSON.stringify({ family: p.family, at: new Date().toISOString(), by, events: old }, null, 1));
  fs.fsyncSync(fd); fs.closeSync(fd);
  const c = await pool.connect();
  let inserted = 0;
  try {
    await c.query('begin');
    for (const r of p.inserts) {
      const opId = opIdOf(r.person_id, r.legacy_key);
      const have = await c.query('select 1 from events where person_id = $1 and legacy_key = $2', [r.person_id, r.legacy_key]);
      if (have.rowCount) continue;
      if (!(await EV.claimOp(c, opId, r.person_id))) continue;
      const ev = await EV.insertEvent(c, p.family, r.person_id, r, by);
      await c.query('update events set legacy_key = $2 where id = $1', [ev.id, r.legacy_key]);
      inserted++;
    }
    await c.query('commit');
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  return { inserted, backup: file };
}

module.exports = { plan, apply, loadFamilies, report };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
    const doApply = args.includes('--apply');
    const notes = !args.includes('--no-notes');
    const backupDir = val('--backup-dir') || path.join(process.cwd(), 'facts-backups');
    const by = val('--by') || 'facts-to-events';
    const pool = new Pool({ connectionString: databaseUrl(), max: 2 });
    try {
      for (const f of await loadFamilies(pool, val('--family'))) {
        const p = await plan(pool, f, { notes });
        console.log(report(p));
        if (doApply) {
          const r = await apply(pool, p, { backupDir, by });
          console.log(`applied: added ${r.inserted}; backup ${r.backup}`);
        } else console.log('dry run: nothing written.');
      }
    } finally { await pool.end(); }
  })().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
}
