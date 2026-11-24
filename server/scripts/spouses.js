// One-off: turn each bloodline person's spouse text ("vợ 1: A (1920, Củ Chi); vợ 2: B") into person records
// (dâu / rể) so everyone mentioned has a page. Idempotent: id N-sp-<pid>-<n>; existing ids are skipped.
// Usage: node scripts/spouses.js            (dry run: prints what it would create)
//        node scripts/spouses.js --apply    (writes; history by 'Hệ thống', source 'spouses')
'use strict';
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
function parse(text) {
  if (!text) return [];
  return text.split(/;(?![^(]*\))/).map((s, i) => { const [nm, ...rest] = s.trim().split('('); return { n: i + 1, name: nm.replace(/^(vợ|chồng|ông|bà)\s*\d*\s*:?\s*/iu, '').trim(), note: rest.join('(').replace(/\)\s*$/, '').trim() }; })
    .filter((x) => x.name && !/^(chưa rõ|không rõ|\?|có|không|rồi|đã mất)$/iu.test(x.name));
}
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query("select id, data from persons where not deleted and coalesce(data->>'spouse_of','') = ''");
  const have = new Set((await pool.query('select id from persons')).rows.map((r) => r.id));
  const plan = [];
  for (const r of rows) for (const s of parse(r.data.spouse)) {
    const id = `N-sp-${r.id.toLowerCase()}-${s.n}`; if (have.has(id)) continue;
    plan.push({ id, data: { name: s.name, sex: r.data.sex === 'f' ? 'm' : 'f', spouse_of: r.id, spouse_n: s.n, note: s.note, source: `Từ mục vợ/chồng của ${r.id}` } });
  }
  console.log(`${APPLY ? 'creating' : 'would create'} ${plan.length} spouse records`); plan.slice(0, 10).forEach((p) => console.log(' ', p.id, p.data.name, '|', p.data.note));
  if (APPLY && plan.length) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      for (const p of plan) {
        await c.query('insert into persons (id, data, updated_by) values ($1,$2,$3) on conflict (id) do nothing', [p.id, p.data, 'Hệ thống']);
        await c.query("insert into history (person_id, field, new_value, by_user, source) values ($1,'*',$2,'Hệ thống','spouses')", [p.id, JSON.stringify(p.data)]);
      }
      await c.query('commit'); console.log('done');
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
