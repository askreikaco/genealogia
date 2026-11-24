// Bootstrap members from env (idempotent). Editors listed in GOOGLE_EDITORS become active admins;
// GOOGLE_OWNER (or else the first GOOGLE_EDITORS email) becomes owner when the family has no owner yet.
'use strict';
function parseEditors(env) {
  return (env.GOOGLE_EDITORS || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf(':'); return i < 0 ? [s.toLowerCase(), s] : [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()];
  });
}
// Seeds go to the original family (migration 005/008 default). Unique key is (family_id, email) since 008.
const SEED_FAMILY = 'duong';
async function seedMembers(pool, env = process.env) {
  const entries = parseEditors(env);
  for (const [email, name] of entries) {
    await pool.query(`insert into members (email, name, role, status, approved_by, approved_at, family_id)
      values ($1, $2, 'admin', 'active', 'seed', now(), $3) on conflict (family_id, email) do nothing`, [email, name, SEED_FAMILY]);
  }
  const owner = (env.GOOGLE_OWNER || entries[0]?.[0] || '').trim().toLowerCase();
  if (owner && !(await pool.query("select 1 from members where role = 'owner' and status = 'active' and family_id = $1 limit 1", [SEED_FAMILY])).rowCount) {
    const name = entries.find((e) => e[0] === owner)?.[1] || owner;
    await pool.query(`insert into members (email, name, role, status, approved_by, approved_at, family_id)
      values ($1, $2, 'owner', 'active', 'seed', now(), $3)
      on conflict (family_id, email) do update set role = 'owner', status = 'active'`, [owner, name, SEED_FAMILY]);
  }
}
module.exports = { seedMembers, parseEditors };
