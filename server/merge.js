// Merge of two duplicate people inside one tree (database side). Rules: merge-rules.js. Called only from a passed
// family vote (decisions.js settle) and from the tests. One transaction: the kept person takes the chosen field values,
// every relation / event / story / place / variant / cross-tree link of the merged-away person moves to the kept one
// (duplicate rows are dropped, each change is recorded), and the merged-away person goes to the trash (trash.js, 30 days,
// then the archive). Undo = restoring that trash item (trash.js restoreRows -> revert here). Nothing is hard-deleted.
'use strict';
const TRASH = require('./trash');
const REL = require('./relations');
const RULES = require('./merge-rules');
const { MergeError, mergeData, checkMerge, WHY } = RULES;

// Tables whose rows point at a person. cols: the person-id columns; pk: the key columns (restore finds the row by it).
const TABLES = [
  { table: 'parent_child', cols: ['parent_id', 'child_id'], pk: ['id'] },
  { table: 'couple', cols: ['a_id', 'b_id'], pk: ['id'], sym: true },
  { table: 'events', cols: ['person_id'], pk: ['id'] },
  { table: 'stories', cols: ['person_id'], pk: ['id'] },
  { table: 'person_places', cols: ['person_id'], pk: ['person_id', 'field'] },
  { table: 'field_variants', cols: ['person_id'], pk: ['id'] },
];
const LEGACY_REL = ['parent', 'other_parent', 'spouse_of'];
const nowMs = () => Date.now();

async function hist(q, personId, action, detail, by) {
  await q.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'merge',$2,$3,$4)",
    [personId, action === 'restore' ? null : JSON.stringify({ action, ...detail }), action === 'restore' ? JSON.stringify({ action, ...detail }) : null, by]);
}

// The family's parent-child edges and partnerships: the relation tables when the family is migrated, else the legacy fields.
async function graphOf(q, famId) {
  if (await REL.isTable(q, famId)) {
    const edges = (await q.query('select parent_id as parent, child_id as child from parent_child where family_id=$1', [famId])).rows;
    const couples = (await q.query('select a_id as a, b_id as b from couple where family_id=$1', [famId])).rows;
    return { edges, couples, table: true };
  }
  const { rows } = await q.query('select id, data from persons where family_id=$1 and not deleted', [famId]);
  const edges = []; const couples = []; const seen = new Set();
  for (const r of rows) {
    for (const k of ['parent', 'other_parent']) if (r.data?.[k]) edges.push({ parent: r.data[k], child: r.id });
    if (r.data?.spouse_of) { const key = [r.id, r.data.spouse_of].sort().join('|'); if (!seen.has(key)) { seen.add(key); couples.push({ a: r.id, b: r.data.spouse_of }); } }
  }
  return { edges, couples, table: false };
}

// Writes the undo record of one change: the row as it was before (pre) and its key after the change (post).
const pkOf = (row, pk) => Object.fromEntries(pk.map((c) => [c, row[c]]));
const pkWhere = (pk, from = 1) => pk.map((c, i) => `"${c}" = $${i + from}`).join(' and ');

// Moves every row of one table that points at the merged-away person to the kept one. A row that would duplicate an
// existing one (unique key) is removed instead; both are recorded so the restore can put them back.
async function repoint(q, spec, dropId, keepId, entries) {
  const { rows } = await q.query(`select * from ${spec.table} where ${spec.cols.map((c) => `"${c}" = $1`).join(' or ')} order by ${spec.pk.map((c) => `"${c}"`).join(', ')}`, [dropId]);
  for (const row of rows) {
    const next = { ...row };
    for (const c of spec.cols) if (next[c] === dropId) next[c] = keepId;
    // a partnership is one row in either order: the same couple already there (kept person first or second) is not repeated
    if (spec.sym && (await q.query(`select 1 from ${spec.table} where family_id=$1 and kind=$2 and coalesce(start_year,-1)=coalesce($3,-1)
        and ((a_id=$4 and b_id=$5) or (a_id=$5 and b_id=$4)) and id<>$6`, [row.family_id, row.kind, row.start_year, next.a_id, next.b_id, row.id])).rowCount) {
      await q.query(`delete from ${spec.table} where ${pkWhere(spec.pk)}`, spec.pk.map((c) => row[c]));
      entries.push({ table: spec.table, pk: spec.pk, action: 'delete', pre: row, post: null });
      continue;
    }
    await q.query('savepoint mg');
    try {
      await q.query(`update ${spec.table} set ${spec.cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ')} where ${pkWhere(spec.pk, spec.cols.length + 1)}`,
        [...spec.cols.map((c) => next[c]), ...spec.pk.map((c) => row[c])]);
      await q.query('release savepoint mg');
      entries.push({ table: spec.table, pk: spec.pk, action: 'update', pre: row, post: pkOf(next, spec.pk) });
    } catch (e) {
      await q.query('rollback to savepoint mg');
      if (e.code !== '23505') throw e;
      await q.query(`delete from ${spec.table} where ${pkWhere(spec.pk)}`, spec.pk.map((c) => row[c]));
      entries.push({ table: spec.table, pk: spec.pk, action: 'delete', pre: row, post: null });
    }
  }
}

// Cross-tree links (person_links) of the merged-away person, on either side.
async function repointLinks(q, famId, dropId, keepId, entries) {
  const { rows } = await q.query('select * from person_links where (a_family=$1 and a_person=$2) or (b_family=$1 and b_person=$2) order by id', [famId, dropId]);
  for (const row of rows) {
    const next = { ...row };
    if (next.a_family === famId && next.a_person === dropId) next.a_person = keepId;
    if (next.b_family === famId && next.b_person === dropId) next.b_person = keepId;
    const self = next.a_family === next.b_family && next.a_person === next.b_person;
    await q.query('savepoint mg');
    try {
      if (self) throw Object.assign(new Error('self'), { code: '23505' });
      await q.query('update person_links set a_person=$2, b_person=$3 where id=$1', [row.id, next.a_person, next.b_person]);
      await q.query('release savepoint mg');
      entries.push({ table: 'person_links', pk: ['id'], action: 'update', pre: row, post: { id: row.id } });
    } catch (e) {
      await q.query('rollback to savepoint mg');
      if (e.code !== '23505') throw e;
      await q.query('delete from person_links where id=$1', [row.id]);
      entries.push({ table: 'person_links', pk: ['id'], action: 'delete', pre: row, post: null });
    }
  }
}

// Event participants (events.people: a list of person ids) and, in a legacy family, the legacy relation fields of the
// people who point at the merged-away person.
async function repointLists(q, famId, tableMode, dropId, keepId, entries) {
  const evs = (await q.query('select * from events where people @> $1::jsonb order by id', [JSON.stringify([dropId])])).rows;
  for (const row of evs) {
    const people = [...new Set((row.people || []).map((x) => (x === dropId ? keepId : x)))];
    await q.query('update events set people=$2 where id=$1', [row.id, JSON.stringify(people)]);
    entries.push({ table: 'events', pk: ['id'], action: 'update', pre: row, post: { id: row.id } });
  }
  if (tableMode) return;
  const refs = (await q.query(`select id, data from persons where family_id=$1 and not deleted and (${LEGACY_REL.map((k) => `data->>'${k}' = $2`).join(' or ')}) order by id`, [famId, dropId])).rows;
  for (const row of refs) {
    const data = { ...row.data };
    for (const k of LEGACY_REL) if (data[k] === dropId) data[k] = keepId;
    await q.query('update persons set data=$2 where id=$1', [row.id, JSON.stringify(data)]);
    entries.push({ table: 'persons', pk: ['id'], action: 'update', pre: { id: row.id, data: row.data }, post: { id: row.id } });
  }
}

// Plan and checks only (no writes): the two people, the merged record, the cycle / relation guard.
async function preview(q, fam, keepId, dropId, choices = {}) {
  const { rows } = await q.query('select id, family_id, data, deleted from persons where id = any($1::text[])', [[keepId, dropId]]);
  const keep = rows.find((r) => r.id === keepId); const drop = rows.find((r) => r.id === dropId);
  if (!keep || !drop || keep.family_id !== fam || drop.family_id !== fam || keep.deleted || drop.deleted) throw new MergeError(404, 'Không tìm thấy hai người này trong dòng họ.');
  // access granted to the merged-away person (elder sign-in, device, manager) is not moved: remove it first
  const access = (await q.query(`select (select count(*) from device_accounts where family_id=$1 and person_id=$2 and revoked_at is null)
      + (select count(*) from sign_in_cards where family_id=$1 and person_id=$2 and revoked_at is null)
      + (select count(*) from person_managers where family_id=$1 and person_id=$2) as n`, [fam, dropId])).rows[0].n;
  if (Number(access) > 0) throw new MergeError(409, WHY.access);
  const g = await graphOf(q, fam);
  const chk = checkMerge(keepId, dropId, g.edges, g.couples);
  if (!chk.ok) throw new MergeError(409, WHY[chk.why]);
  const { data, changed } = mergeData(keep.data, drop.data, choices);
  for (const k of LEGACY_REL) if (data[k] === keepId || data[k] === dropId) throw new MergeError(409, WHY.related);
  return { keep, drop, data, changed, table: g.table };
}

// Apply a passed merge (inside the caller's transaction). Returns { trash_id, changed, moved }.
async function apply(q, fam, { keepId, dropId, choices = {}, by, w, reason, decisionId = null }) {
  const locked = (await q.query('select id from persons where id = any($1::text[]) order by id for update', [[keepId, dropId]])).rows;
  if (locked.length !== 2) throw new MergeError(409, 'Không còn đủ hai người để gộp.');
  const { keep, drop, data, changed, table } = await preview(q, fam.id, keepId, dropId, choices);
  const entries = [];
  const touched = new Set([keepId]);
  const g0 = await graphOf(q, fam.id);
  for (const e of g0.edges) if (e.parent === dropId || e.child === dropId) { touched.add(e.parent); touched.add(e.child); }
  for (const c of g0.couples) if (c.a === dropId || c.b === dropId) { touched.add(c.a); touched.add(c.b); }
  for (const spec of TABLES) await repoint(q, spec, dropId, keepId, entries);
  await repointLinks(q, fam.id, dropId, keepId, entries);
  await repointLists(q, fam.id, table, dropId, keepId, entries);
  const tsObj = Object.fromEntries(changed.map((c) => [c.field, nowMs()]));
  await q.query(`update persons set data=$2, updated_by=$3, updated_at=now(), version=nextval('persons_version'),
    field_ts = coalesce(field_ts,'{}'::jsonb) || $4::jsonb where id=$1`, [keepId, JSON.stringify(data), by, JSON.stringify(tsObj)]);
  if (table) await REL.mirrorLegacy(q, fam.id, [...touched]);
  const trashId = await TRASH.deletePerson(q, fam, dropId, { w: w || { email: by }, by, reason: reason || 'Gộp với hồ sơ trùng' });
  await q.query("update trash set label=$2, payload = coalesce(payload,'{}'::jsonb) || $3::jsonb where id=$1", [trashId, drop.data?.name || dropId,
    JSON.stringify({ merge: { keep: keepId, keep_name: keep.data?.name || keepId, keep_before: keep.data, changed, entries, table, touched: [...touched] },
      ...(decisionId ? { council: Number(decisionId) } : {}) })]);
  await hist(q, keepId, 'merge', { drop: dropId, drop_name: drop.data?.name || dropId, changed: changed.map((c) => c.field), trash_id: Number(trashId), decision_id: decisionId ? Number(decisionId) : null }, by);
  await hist(q, dropId, 'merge', { into: keepId, into_name: keep.data?.name || keepId, trash_id: Number(trashId), decision_id: decisionId ? Number(decisionId) : null }, by);
  return { trash_id: Number(trashId), changed: changed.length, moved: entries.length };
}

async function undoRow(q, e) {
  if (e.action === 'delete') {
    await q.query('savepoint rv');
    try { await q.query(`insert into ${e.table} select * from jsonb_populate_record(null::${e.table}, $1)`, [JSON.stringify(e.pre)]); await q.query('release savepoint rv'); } catch (err) {
      await q.query('rollback to savepoint rv');
      if (err.code === '23505') throw new MergeError(409, 'Không hoàn tác được: đã có một mục trùng (có thể đã được thêm lại).');
      throw err;
    }
    return;
  }
  const cols = Object.keys(e.pre);
  await q.query('savepoint rv');
  try {
    await q.query(`update ${e.table} t set ${cols.map((c) => `"${c}" = p."${c}"`).join(', ')} from jsonb_populate_record(null::${e.table}, $1) p where ${e.pk.map((c, i) => `t."${c}" = $${i + 2}`).join(' and ')}`,
      [JSON.stringify(e.pre), ...e.pk.map((c) => e.post[c])]);
    await q.query('release savepoint rv');
  } catch (err) {
    await q.query('rollback to savepoint rv');
    if (err.code === '23505') throw new MergeError(409, 'Không hoàn tác được: đã có một mục trùng (có thể đã được thêm lại).');
    throw err;
  }
}

// Undo of an applied merge, called by trash.js when the merged-away person is restored (inside its transaction).
async function revert(q, famId, m) {
  for (const e of [...(m.entries || [])].reverse()) await undoRow(q, e);
  const cur = (await q.query('select data from persons where id=$1 for update', [m.keep])).rows[0];
  if (cur) {
    const d = { ...(cur.data || {}) };
    // a field the kept person changed after the merge keeps that later value
    for (const ch of m.changed || []) {
      if (JSON.stringify(d[ch.field] ?? null) !== JSON.stringify(ch.to ?? null)) continue;
      if (ch.from == null) delete d[ch.field]; else d[ch.field] = ch.from;
    }
    await q.query("update persons set data=$2, updated_at=now(), version=nextval('persons_version') where id=$1", [m.keep, JSON.stringify(d)]);
  }
  if (m.table) await REL.mirrorLegacy(q, famId, m.touched || [m.keep]);
  await hist(q, m.keep, 'restore', { merged_person: m.keep }, 'Hoàn tác gộp');
}

module.exports = { TABLES, preview, apply, revert, graphOf, MergeError, WHY };
