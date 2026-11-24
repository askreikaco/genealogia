// Two-way sync between persons (Postgres, source of truth for the app) and the Google Sheet "Thành viên" tab.
// One run: read Sheet -> plan (sheetmap.js) -> apply Sheet edits as ops (history source=sheet) -> write rows back -> save snapshots.
// Runs every SHEET_SYNC_MIN minutes when SHEET_SYNC=on; `node scripts/sheet-sync.js --dry-run` prints the plan only.
'use strict';
const crypto = require('crypto');
const { validateOp, mergeOp } = require('./core');
const { headerIndex, plan } = require('./sheetmap');
const { client, colName } = require('./gsheets');

const LOCK = 742001; // pg advisory lock id for this job

// Site settings that are not secrets but not public either: custom/sheetsync.json {"sheetId": "...", "saFile": "..."}
// (private downstream only; custom/ is never published). Env wins. No file and no env = sync not configured.
let siteCfg;
function siteConfig() {
  if (siteCfg === undefined) {
    try { siteCfg = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'custom', 'sheetsync.json'), 'utf8')); } catch { siteCfg = {}; }
  }
  return siteCfg;
}
function config() {
  return {
    spreadsheetId: process.env.SHEET_ID || siteConfig().sheetId || '',
    sheet: process.env.SHEET_TAB || 'Thành viên',
    keyFile: process.env.GOOGLE_SA_FILE || siteConfig().saFile || '',
    subject: process.env.GOOGLE_SA_SUBJECT || '',
  };
}

async function runSync(pool, { dryRun = false, log = console.log } = {}) {
  const cfg = config();
  if (!cfg.subject) throw new Error('GOOGLE_SA_SUBJECT not set');
  if (!cfg.spreadsheetId || !cfg.keyFile) throw new Error('sheet sync not configured: set SHEET_ID and GOOGLE_SA_FILE, or custom/sheetsync.json');
  const gs = client(cfg);
  const lock = await pool.query('select pg_try_advisory_lock($1) ok', [LOCK]);
  if (!lock.rows[0].ok) return { skipped: 'another sync is running' };
  try {
    const all = await gs.read();
    if (!all.length) throw new Error('sheet is empty (no header row)');
    const { idx, headers, added } = headerIndex(all[0]);
    const width = headers.length;
    const rows = all.slice(1).map((values, i) => ({ r: i + 2, values }));
    const persons = (await pool.query('select id, data, deleted, version, updated_at from persons')).rows;
    const snaps = new Map((await pool.query('select person_id, data from sheet_snap')).rows.map((s) => [s.person_id, s.data]));
    let maxP = Math.max(0, ...persons.map((p) => /^P(\d+)$/.exec(p.id)?.[1] | 0));
    const P = plan({ rows, idx, width, persons, snaps, nextId: () => 'P' + String(++maxP).padStart(3, '0') });
    const summary = { sheetRows: rows.length, ops: P.ops.length, created: P.created.length, rowUpdates: P.updates.length, appends: P.appends.length, headersAdded: added };
    if (dryRun) { log('DRY RUN', JSON.stringify(summary)); log('ops sample', JSON.stringify(P.ops.slice(0, 5))); return { dryRun: true, ...summary }; }

    // 1) Sheet edits -> persons (same merge rules as the app's /api/ops)
    const c = await pool.connect();
    try {
      for (const o of P.ops) {
        const op = { op_id: 'sheet-' + crypto.randomUUID(), id: o.id, fields: o.fields, ts: Date.now() };
        const err = validateOp(op); if (err) { log('sheet op rejected', o.id, err); continue; }
        await c.query('begin');
        const cur = await c.query('select data, field_ts, deleted from persons where id=$1 for update', [o.id]);
        const m = mergeOp(cur.rows[0], op);
        if (m.changes.length) {
          await c.query(`insert into persons (id, data, field_ts, deleted, updated_by) values ($1,$2,$3,$4,'Google Sheet')
            on conflict (id) do update set data=$2, field_ts=$3, deleted=$4, updated_by='Google Sheet', updated_at=now(), version=nextval('persons_version')`,
            [o.id, m.data, m.fieldTs, m.deleted]);
          for (const ch of m.changes) await c.query("insert into history (person_id, field, old_value, new_value, by_user, source) values ($1,$2,$3,$4,'Google Sheet','sheet')", [o.id, ch.field, JSON.stringify(ch.old), JSON.stringify(ch.new)]);
        }
        await c.query('commit');
      }
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }

    // 2) persons -> Sheet (headers, changed rows, new rows)
    const last = colName(width - 1);
    const writes = [];
    if (added.length) writes.push({ range: `A1:${last}1`, values: [headers] });
    for (const u of P.updates) writes.push({ range: `A${u.r}:${last}${u.r}`, values: [u.values] });
    for (let i = 0; i < writes.length; i += 200) await gs.write(writes.slice(i, i + 200));
    await gs.append(P.appends);

    // 3) snapshots = what both sides now agree on
    for (const s of P.snaps) await pool.query('insert into sheet_snap (person_id, data, synced_at) values ($1,$2,now()) on conflict (person_id) do update set data=$2, synced_at=now()', [s.id, s.data]);
    log('sheet sync', JSON.stringify(summary));
    return summary;
  } finally { await pool.query('select pg_advisory_unlock($1)', [LOCK]); }
}

module.exports = { runSync };
