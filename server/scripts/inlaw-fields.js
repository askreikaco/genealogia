// One-off: for dâu / rể records, lift dates written in the note into fields (only fills EMPTY fields).
//  "1923–1983, mất 6/1 ÂL" -> born 1923, died 1983, death_lunar 6/1 ; "giỗ 25/11 ÂL" -> gio_lunar 25/11 ; "1967, Tân Thông Hội" -> born 1967
// Dry run by default; --apply writes (history by 'Hệ thống', source 'inlaw-fields').
'use strict';
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
function lift(note) {
  const o = {}; const n = String(note || '');
  let m = n.match(/(?:^|[\s,(;])(1[6-9]\d\d|20\d\d)\s*[–-]\s*(1[6-9]\d\d|20\d\d)/); if (m) { o.born = m[1]; o.died = m[2]; }
  else if ((m = n.match(/^\s*(1[6-9]\d\d|20\d\d)\b/))) o.born = m[1];
  if ((m = n.match(/mất\s+(\d{1,2}\/\d{1,2})\s*ÂL/i))) o.death_lunar = m[1];
  if ((m = n.match(/giỗ\s+(\d{1,2}\/\d{1,2})\s*ÂL/i))) o.gio_lunar = m[1];
  // place: the note parts that are not dates / giỗ / mất / remarks, e.g. "1967, Tân Thông Hội, Củ Chi" -> "Tân Thông Hội, Củ Chi"
  const parts = n.split(/[,;]/).map((x) => x.trim()).filter((x) => x && !/\d{4}|ÂL|giỗ|mất|(^|\s)(bà|ông)\s|cháu|quan|lễ sanh/iu.test(x));
  if (parts.length && parts.every((x) => /^[A-ZĐÂĂÊÔƠƯ]/.test(x))) o.place = parts.join(', ');
  return o;
}
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const rows = (await pool.query("select id, data from persons where not deleted and coalesce(data->>'spouse_of','') <> ''")).rows;
  const byId = new Map((await pool.query('select id, data from persons where not deleted')).rows.map((r) => [r.id, r.data]));
  const plan = [];
  for (const r of rows) {
    const l = lift(r.data.note); const sp = byId.get(r.data.spouse_of);
    if (sp) { if (sp.gen) l.gen = sp.gen; l.spouse = `${sp.sex === 'f' ? 'Bà' : 'Ông'}${sp.thu ? ' ' + sp.thu : ''} ${sp.name}`; if (sp.married) l.married = sp.married; }
    if (l.died || l.death_lunar || l.gio_lunar || r.data.died || r.data.death_lunar) l.living = 'dead';
    const ch = {}; for (const [k, v] of Object.entries(l)) if (!r.data[k]) ch[k] = v; if (Object.keys(ch).length) plan.push([r.id, ch]); }
  console.log(`${APPLY ? 'updating' : 'would update'} ${plan.length} in-law records`); plan.forEach(([id, ch]) => console.log(' ', id, JSON.stringify(ch)));
  if (APPLY && plan.length) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      for (const [id, ch] of plan) {
        await c.query("update persons set data = data || $2::jsonb, version = nextval('persons_version'), updated_at = now(), updated_by = 'Hệ thống' where id = $1", [id, JSON.stringify(ch)]);
        for (const [k, v] of Object.entries(ch)) await c.query("insert into history (person_id, field, old_value, new_value, by_user, source) values ($1,$2,null,$3,'Hệ thống','inlaw-fields')", [id, k, JSON.stringify(v)]);
      }
      await c.query('commit'); console.log('done');
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
