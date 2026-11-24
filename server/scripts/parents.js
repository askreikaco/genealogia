// One-off: set other_parent (mẹ / cha còn lại) on children whose parent has exactly ONE spouse record.
// Parents with several spouses stay unknown (the app asks in the edit form). Dry run by default; --apply writes.
'use strict';
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const rows = (await pool.query('select id, data from persons where not deleted')).rows;
  const sp = new Map();
  for (const r of rows) if (r.data.spouse_of) { if (!sp.has(r.data.spouse_of)) sp.set(r.data.spouse_of, []); sp.get(r.data.spouse_of).push(r.id); }
  const set = []; const unknown = [];
  for (const r of rows) {
    const d = r.data; if (!d.parent || d.spouse_of || d.other_parent) continue;
    const s = sp.get(d.parent) || [];
    if (s.length === 1) set.push([r.id, s[0]]); else if (s.length > 1) unknown.push(r.id);
  }
  console.log(`${APPLY ? 'setting' : 'would set'} other_parent on ${set.length} children; ${unknown.length} children of parents with several spouses left unknown`);
  set.slice(0, 8).forEach((x) => console.log(' ', x[0], '->', x[1]));
  if (APPLY && set.length) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      for (const [id, op] of set) {
        await c.query("update persons set data = data || jsonb_build_object('other_parent', $2::text), version = nextval('persons_version'), updated_at = now(), updated_by = 'Hệ thống' where id = $1", [id, op]);
        await c.query("insert into history (person_id, field, old_value, new_value, by_user, source) values ($1, 'other_parent', null, $2, 'Hệ thống', 'parents')", [id, JSON.stringify(op)]);
      }
      await c.query('commit'); console.log('done');
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
