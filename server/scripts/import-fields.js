// One-off import of reviewed field values into giapha persons, through the app's own op merge + history.
// Usage: cd server && node scripts/import-fields.js <ops.json> [--apply]
// Dry run (default) prints per person: field names changed (contact values masked). --apply writes in ONE transaction:
// ops row (idempotent op_id), persons upsert with version bump, one history row per changed field (by = ops.by).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
process.chdir(path.resolve('.'));
if (!process.env.DATABASE_URL) { // read only DATABASE_URL from ../.env (never printed)
  const line = fs.readFileSync(path.resolve('..', '.env'), 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}
const { Pool } = require('pg');
const { mergeOp, validateOp, CONTACT } = require(path.resolve('core.js'));

const [file, flag] = process.argv.slice(2);
const apply = flag === '--apply';
const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
const mask = (k, v) => (CONTACT.includes(k) ? (v ? `<${String(v).length} ký tự>` : v) : v);

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let total = 0;
  try {
    await client.query('begin');
    for (const item of spec.set) {
      const cur = await client.query('select data, field_ts, deleted, family_id from persons where id=$1 for update', [item.id]);
      if (!cur.rows[0] || cur.rows[0].deleted) throw new Error(`missing person ${item.id}`);
      const fields = { ...item.fields };
      if (item.note_add) {
        const old = cur.rows[0].data.note || '';
        if (!old.includes(item.note_add)) fields.note = old ? `${old}\n${item.note_add}` : item.note_add;
      }
      if (!Object.keys(fields).length) { console.log(item.id, 'no change'); continue; }
      const hash = crypto.createHash('sha1').update(item.id + JSON.stringify(fields)).digest('hex').slice(0, 16);
      const op = { op_id: `import-fc-${hash}`, id: item.id, fields, ts: Date.now() };
      const err = validateOp(op); if (err) throw new Error(`${item.id}: ${err}`);
      const m = mergeOp(cur.rows[0], op);
      console.log(item.id, m.changes.map((c) => `${c.field}: ${JSON.stringify(mask(c.field, c.old))} -> ${JSON.stringify(mask(c.field, c.new))}`).join(' | ') || 'no change');
      total += m.changes.length;
      if (!apply || !m.changes.length) continue;
      const seen = await client.query('insert into ops (op_id, person_id) values ($1,$2) on conflict do nothing returning op_id', [op.op_id, op.id]);
      if (!seen.rowCount) { console.log(item.id, 'already applied'); continue; }
      await client.query(`update persons set data=$2, field_ts=$3, updated_by=$4, updated_at=now(), version=nextval('persons_version') where id=$1`,
        [op.id, m.data, m.fieldTs, spec.by]);
      for (const c of m.changes) {
        await client.query('insert into history (person_id, field, old_value, new_value, by_user) values ($1,$2,$3,$4,$5)',
          [op.id, c.field, JSON.stringify(c.old), JSON.stringify(c.new), spec.by]);
      }
    }
    if (apply) await client.query('commit'); else await client.query('rollback');
    console.log(apply ? 'APPLIED' : 'DRY RUN', 'changes:', total);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    console.error('FAILED', e.message); process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
})();
