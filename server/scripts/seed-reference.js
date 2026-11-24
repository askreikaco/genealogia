// Seed PUBLIC REFERENCE TREES (tham khảo) from a spec JSON: families, persons and relations, all owned by one
// reference account. A re-run matches persons by their Wikidata QID (persons.data.ext.wikidata), so nothing is duplicated.
// Usage (from server/): node scripts/seed-reference.js <spec.json> [--apply]
// Dry run (default) prints the plan and writes nothing. --apply writes in ONE transaction; a tree with a conflict is
// skipped as a whole. Never modifies a person that lacks the matching QID, never touches a non-reference family.
// A field written in the spec overwrites the person's value; a field left out of the spec is never cleared.
// Spec: { "trees": [ { slug, name, surname, han, country, visibility, tags, source, persons: [...], links: [...] } ] }
//   person: { ref (QID), name, alt_names: [], sex ('m'|'f'|''), born, died, note, source_url }
//   link:   { parent, child } (parent-child, by QID) | { a, b, kind: 'couple' } (spouses, by QID)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const REF_EMAIL = 'reference@giapha.invalid'; // reserved .invalid domain: no person can sign in as it
const REF_NAME = 'Tài khoản tham khảo (Wikidata)';
const WHO = 'seed-reference';
const QID = /^Q\d+$/;
const SLUG = /^ref-[a-z0-9-]{3,60}$/;

if (!process.env.DATABASE_URL) { // read only DATABASE_URL from the repo-root .env (never printed)
  const envFile = path.resolve(__dirname, '..', '..', '.env');
  const line = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL=')) : null;
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

// ---- spec ----------------------------------------------------------------------------------------------------------
function loadSpec(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw.trees) || !raw.trees.length) throw new Error('spec needs "trees": [ ... ]');
  const allRefs = new Set();
  for (const t of raw.trees) {
    if (!SLUG.test(t.slug || '')) throw new Error(`bad slug "${t.slug}": use ref-<a-z0-9->`);
    if (!t.name) throw new Error(`${t.slug}: name missing`);
    if (t.visibility !== 'public') throw new Error(`${t.slug}: visibility must be 'public'`);
    if (!Array.isArray(t.persons) || !t.persons.length) throw new Error(`${t.slug}: no persons`);
    const refs = new Set();
    for (const p of t.persons) {
      if (!QID.test(p.ref || '')) throw new Error(`${t.slug}: bad QID "${p.ref}"`);
      if (refs.has(p.ref) || allRefs.has(p.ref)) throw new Error(`${t.slug}: duplicate QID ${p.ref} (one person, one tree)`);
      if (!p.name) throw new Error(`${t.slug}: ${p.ref} has no name`);
      if (p.order !== undefined && !Number.isInteger(p.order)) throw new Error(`${t.slug}: ${p.ref} order must be an integer`);
      refs.add(p.ref); allRefs.add(p.ref);
    }
    for (const l of t.links || []) {
      const ends = l.kind === 'couple' ? [l.a, l.b] : [l.parent, l.child];
      if (!ends.every((q) => refs.has(q))) throw new Error(`${t.slug}: link ${JSON.stringify(l)} names a person outside the tree`);
      if (ends[0] === ends[1]) throw new Error(`${t.slug}: link to self ${JSON.stringify(l)}`);
    }
  }
  return raw.trees;
}

// ---- ids and data --------------------------------------------------------------------------------------------------
// jsonb returns object keys in its own order: compare with sorted keys, or every re-run looks like a change.
const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v));
// Stable person id: N + lower-case QID + short hash of the tree slug (fits the app's id rule, ^N[0-9a-z-]{6,40}$).
const personId = (qid, slug) => `N${qid.toLowerCase()}-${crypto.createHash('sha1').update(slug).digest('hex').slice(0, 8)}`;

function personData(p, t) {
  const d = { name: p.name, living: 'dead', source: p.source_url || `https://www.wikidata.org/wiki/${p.ref}`,
    ext: { wikidata: p.ref, tree: t.slug, tags: t.tags || [], ...(p.group ? { group: p.group } : {}), ...(Number.isInteger(p.order) ? { order: p.order } : {}) } };
  if (p.alt_names && p.alt_names.length) d.alias = p.alt_names.join(' · ');
  if (p.sex) d.sex = p.sex;
  if (p.born) d.born = p.born;
  if (p.died) d.died = p.died;
  if (p.note) d.note = p.note;
  return d;
}

// ---- database reads (plan) -----------------------------------------------------------------------------------------
async function accountPlan(q) {
  const { rows } = await q.query("select account_id from identities where type = 'email' and value_norm = $1 and provider_sub is null", [REF_EMAIL]);
  if (!rows.length) return { action: 'create', id: null };
  const id = rows[0].account_id;
  const others = (await q.query("select count(*)::int n from identities where account_id = $1 and not (type = 'email' and value_norm = $2)", [id, REF_EMAIL])).rows[0].n;
  if (others) throw new Error('refusing: the reference account has other sign-in methods (not a reference account)');
  return { action: 'exists', id };
}

async function hasCountryColumn(q) {
  return (await q.query("select 1 from information_schema.columns where table_name = 'families' and column_name = 'country'")).rowCount > 0;
}

// Cycle check on the parent-child graph of one tree (a loop would make the tree unreadable).
function hasCycle(pairs) {
  const kids = new Map();
  for (const [p, c] of pairs) kids.set(p, [...(kids.get(p) || []), c]);
  const state = new Map();
  const visit = (n) => {
    if (state.get(n) === 1) return true;
    if (state.get(n) === 2) return false;
    state.set(n, 1);
    for (const k of kids.get(n) || []) if (visit(k)) return true;
    state.set(n, 2);
    return false;
  };
  return [...kids.keys()].some((n) => visit(n));
}

async function planTree(q, t, hasCountry) {
  const plan = { slug: t.slug, name: t.name, country: t.country || null, conflicts: [], warnings: [], family: null, persons: [], pc: [], cp: [], ids: new Map() };
  const f = (await q.query('select id, name, han from families where id = $1 or slug = $1', [t.slug])).rows[0];
  if (f) {
    const own = (await q.query("select 1 from members where family_id = $1 and email = $2 and role = 'owner' and status = 'active'", [t.slug, REF_EMAIL])).rowCount;
    if (!own) plan.conflicts.push(`family ${t.slug} exists and is not owned by the reference account`);
    const same = f.name === t.name && (f.han || null) === (t.han || null);
    plan.family = { action: same ? 'skip' : 'update' };
  } else {
    plan.family = { action: 'create' };
  }
  if (!hasCountry && t.country) plan.warnings.push(`families.country column missing: ${t.country} not stored`);

  for (const p of t.persons) {
    const data = personData(p, t);
    const hits = (await q.query("select id, family_id, data, deleted from persons where data->'ext'->>'wikidata' = $1", [p.ref])).rows;
    const other = hits.find((h) => h.family_id !== t.slug);
    if (other) { plan.conflicts.push(`${p.ref} is in family ${other.family_id} (${other.id}): not touched`); plan.persons.push({ action: 'conflict', qid: p.ref }); continue; }
    const here = hits.filter((h) => h.family_id === t.slug);
    if (here.length > 1) { plan.conflicts.push(`${p.ref} appears ${here.length} times in ${t.slug}`); plan.persons.push({ action: 'conflict', qid: p.ref }); continue; }
    if (here.length === 1) {
      const h = here[0];
      if (h.deleted) { plan.conflicts.push(`${p.ref} (${h.id}) is deleted: not restored`); plan.persons.push({ action: 'conflict', qid: p.ref }); continue; }
      const changed = Object.keys(data).filter((k) => canon(h.data[k]) !== canon(data[k]));
      plan.ids.set(p.ref, h.id);
      plan.persons.push({ action: changed.length ? 'update' : 'skip', qid: p.ref, id: h.id, before: h.data, data: { ...h.data, ...Object.fromEntries(changed.map((k) => [k, data[k]])) }, changed });
      continue;
    }
    const id = personId(p.ref, t.slug);
    if ((await q.query('select 1 from persons where id = $1', [id])).rowCount) { plan.conflicts.push(`id ${id} already used`); plan.persons.push({ action: 'conflict', qid: p.ref }); continue; }
    plan.ids.set(p.ref, id);
    plan.persons.push({ action: 'create', qid: p.ref, id, data });
  }

  const pairs = [];
  for (const l of t.links || []) {
    if (l.kind === 'couple') {
      const a = plan.ids.get(l.a); const b = plan.ids.get(l.b);
      if (!a || !b) continue; // an endpoint is in conflict: already reported
      const exists = (await q.query('select 1 from couple where family_id = $1 and ((a_id = $2 and b_id = $3) or (a_id = $3 and b_id = $2))', [t.slug, a, b])).rowCount;
      plan.cp.push({ action: exists ? 'skip' : 'create', a, b });
    } else {
      const p = plan.ids.get(l.parent); const c = plan.ids.get(l.child);
      if (!p || !c) continue;
      pairs.push([l.parent, l.child]);
      const exists = (await q.query('select 1 from parent_child where family_id = $1 and parent_id = $2 and child_id = $3', [t.slug, p, c])).rowCount;
      plan.pc.push({ action: exists ? 'skip' : 'create', p, c });
    }
  }
  if (hasCycle(pairs)) plan.conflicts.push('parent-child links form a loop: check the source data');
  return plan;
}

// ---- writes (apply) ------------------------------------------------------------------------------------------------
async function ensureAccount(c, plan) {
  if (plan.action === 'exists') return plan.id;
  const { rows } = await c.query('insert into accounts (name) values ($1) returning id', [REF_NAME]);
  await c.query("insert into identities (account_id, type, value_norm, verified_at, is_primary) values ($1, 'email', $2, now(), true)", [rows[0].id, REF_EMAIL]);
  return rows[0].id;
}

async function applyTree(c, plan, t, accountId, hasCountry) {
  if (plan.family.action === 'create') {
    await c.query('insert into families (id, slug, name, han, visibility) values ($1, $1, $2, $3, $4)', [t.slug, t.name, t.han || null, 'public']);
    await c.query("insert into members (email, name, role, status, approved_by, approved_at, family_id, account_id) values ($1, $2, 'owner', 'active', $3, now(), $4, $5) on conflict do nothing",
      [REF_EMAIL, REF_NAME, WHO, t.slug, accountId]);
    // a new family keeps its relations in the relation tables (same as the app's family create)
    await c.query("insert into relation_migrations (family_id, migrated_by, counts) values ($1, $2, $3) on conflict do nothing", [t.slug, WHO, { note: 'reference seed, table mode' }]);
  } else if (plan.family.action === 'update') {
    await c.query('update families set name = $2, han = $3, updated_at = now() where id = $1', [t.slug, t.name, t.han || null]);
  }
  if (hasCountry && t.country) await c.query('update families set country = $2 where id = $1', [t.slug, t.country]);

  for (const p of plan.persons) {
    if (p.action === 'create') {
      await c.query('insert into persons (id, data, updated_by, family_id) values ($1, $2, $3, $4)', [p.id, p.data, WHO, t.slug]);
      await c.query("insert into history (person_id, field, old_value, new_value, by_user, source) values ($1, '*', null, $2, $3, 'seed')", [p.id, JSON.stringify(p.data), WHO]);
    } else if (p.action === 'update') {
      const ts = Object.fromEntries(p.changed.map((k) => [k, Date.now()]));
      await c.query("update persons set data = $2, field_ts = field_ts || $3::jsonb, updated_by = $4, updated_at = now(), version = nextval('persons_version') where id = $1",
        [p.id, p.data, JSON.stringify(ts), WHO]);
      for (const k of p.changed) { // one history row per changed field, old value from the plan's read
        await c.query("insert into history (person_id, field, old_value, new_value, by_user, source) values ($1, $2, $3, $4, $5, 'seed')",
          [p.id, k, JSON.stringify(p.before[k] ?? null), JSON.stringify(p.data[k]), WHO]);
      }
    }
  }
  for (const r of plan.pc) {
    if (r.action !== 'create') continue;
    await c.query("insert into parent_child (family_id, parent_id, child_id, kind, created_by) values ($1, $2, $3, 'ruot', $4) on conflict do nothing", [t.slug, r.p, r.c, WHO]);
  }
  for (const r of plan.cp) {
    if (r.action !== 'create') continue;
    await c.query("insert into couple (family_id, a_id, b_id, kind, note, created_by) values ($1, $2, $3, 'khac', 'Wikidata P26 (vợ/chồng)', $4) on conflict do nothing", [t.slug, r.a, r.b, WHO]);
  }
}

// ---- main ----------------------------------------------------------------------------------------------------------
(async () => {
  const [file, flag] = process.argv.slice(2);
  if (!file) { console.error('usage: node scripts/seed-reference.js <spec.json> [--apply]'); process.exit(2); }
  const apply = flag === '--apply';
  const trees = loadSpec(file);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  const tot = { create: 0, update: 0, skip: 0, conflict: 0 };
  try {
    console.log(`reference seed: ${trees.length} tree(s), mode ${apply ? 'APPLY' : 'DRY RUN'}`);
    const acc = await accountPlan(c);
    console.log(`account ${REF_EMAIL}: ${acc.action === 'create' ? 'would create' : 'exists'}`);
    const hasCountry = await hasCountryColumn(c);
    const plans = [];
    for (const t of trees) plans.push({ t, plan: await planTree(c, t, hasCountry) });

    for (const { t, plan } of plans) {
      const count = (arr) => ({ create: arr.filter((x) => x.action === 'create').length, update: arr.filter((x) => x.action === 'update').length, skip: arr.filter((x) => x.action === 'skip').length, conflict: arr.filter((x) => x.action === 'conflict').length });
      const P = count(plan.persons); const L = count(plan.pc); const C = count(plan.cp);
      // TOTAL counts what would be written; a tree with conflicts is written by no run, so it adds its conflicts only
      const writes = plan.conflicts.length ? { create: 0, update: 0, skip: 0 } : {
        create: P.create + L.create + C.create + (plan.family.action === 'create' ? 1 : 0),
        update: P.update + (plan.family.action === 'update' ? 1 : 0),
        skip: P.skip + L.skip + C.skip + (plan.family.action === 'skip' ? 1 : 0),
      };
      for (const [k, v] of Object.entries({ ...writes, conflict: P.conflict })) tot[k] += v;
      console.log(`\n[${plan.slug}] ${plan.name}${plan.country ? ` (${plan.country})` : ''}`);
      console.log(`  family        ${plan.family.action}`);
      console.log(`  persons       create ${P.create} | update ${P.update} | skip ${P.skip} | conflict ${P.conflict}`);
      console.log(`  parent_child  create ${L.create} | skip ${L.skip}`);
      console.log(`  couple        create ${C.create} | skip ${C.skip}`);
      for (const w of plan.warnings) console.log(`  WARN ${w}`);
      for (const x of plan.conflicts) console.log(`  CONFLICT ${x}`);
      if (plan.conflicts.length && apply) console.log('  -> tree skipped (conflicts): nothing written for it');
    }
    console.log(`\nTOTAL create=${tot.create} update=${tot.update} skip=${tot.skip} conflict=${tot.conflict}`);

    if (!apply) { console.log('DRY RUN: nothing written'); return; }
    await c.query('begin');
    const accountId = await ensureAccount(c, acc);
    let done = 0;
    for (const { t, plan } of plans) {
      if (plan.conflicts.length) continue;
      await applyTree(c, plan, t, accountId, hasCountry);
      done++;
    }
    await c.query('commit');
    console.log(`APPLIED: ${done} of ${plans.length} tree(s)`);
  } catch (e) {
    await c.query('rollback').catch(() => {});
    console.error('FAILED', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
