// Relationship API core (database side). Pure rules: web/js/relgraph.js (shared with the browser).
// Families in relation_migrations read parent_child and couple; other families read the legacy person fields.
// Every write goes through applyRelOp (one transaction, idempotent by op_id, history "Thêm/Sửa/Gỡ quan hệ").
// After a write, the legacy fields of the touched people are mirrored from the tables (sheets and the book keep working).
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const LIB = pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'relgraph.js')).href;
let libP = null; const lib = () => libP || (libP = import(LIB));
const LEGACY = ['parent', 'other_parent', 'spouse_of', 'spouse_n'];
const NOTE_MAX = 500;
class RelError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const isTable = async (q, fam) => (await q.query('select 1 from relation_migrations where family_id = $1', [fam])).rowCount > 0;

// Names of the family's people (for messages and history).
async function namesOf(q, fam) {
  const { rows } = await q.query('select id, data->>\'name\' as name from persons where family_id = $1', [fam]);
  return new Map(rows.map((r) => [r.id, r.name || r.id]));
}
const roleOf = (sex) => (sex === 'f' ? 'mẹ' : sex === 'm' ? 'cha' : 'cha/mẹ');
const PC_LABEL = { ruot: 'ruột', nuoi: 'nuôi', ke: 'kế', khac: 'khác' };
const CP_LABEL = { cuoi: 'cưới', vo_le: 'vợ lẽ', ban_doi: 'bạn đời', ly_hon: 'ly hôn', goa: 'góa', khac: 'khác' };
// Neutral label for history and suggestions.
function relLabel(r, names, sexOf = () => '') {
  if (r.parent_id) {
    return `${names.get(r.parent_id) || r.parent_id} là ${roleOf(sexOf(r.parent_id))} (${PC_LABEL[r.kind] || r.kind}) của ${names.get(r.child_id) || r.child_id}`;
  }
  return `${names.get(r.a_id) || r.a_id} và ${names.get(r.b_id) || r.b_id}: ${CP_LABEL[r.kind] || r.kind}${r.start_year ? ', ' + r.start_year : ''}`;
}

// Viewer's relation rows and the person ids. full = members and above (private rows included).
// Table families: the tables. Legacy families: rows derived from the person fields (no private rows exist there).
async function readRel(q, fam, full) {
  if (await isTable(q, fam)) {
    const { rows: ids } = await q.query('select id from persons where family_id = $1', [fam]);
    const { rows: pc } = await q.query('select id, parent_id, child_id, kind, birth_order, private from parent_child where family_id = $1 order by id', [fam]);
    const { rows: cp } = await q.query('select id, a_id, b_id, kind, order_a, order_b, start_year, end_year, private, note from couple where family_id = $1 order by id', [fam]);
    const vis = (r) => full || !r.private;
    return { source: 'table', ids: ids.map((r) => r.id), pc: pc.filter(vis), cp: cp.filter(vis) };
  }
  const R = await lib();
  const { rows: persons } = await q.query('select id, data from persons where family_id = $1 and not deleted', [fam]);
  const L = R.legacyRows(persons.map((p) => ({ id: p.id, data: p.data || {} })));
  return { source: 'legacy', ids: persons.map((p) => p.id), pc: L.pc.map((r) => ({ ...r, id: null })), cp: L.cp.map((r) => ({ ...r, id: null })) };
}

// Person rows as the viewer may see them: in table families the legacy relation keys are replaced by the projection.
async function withRel(rel, rows, full) {
  if (rel.source !== 'table') return rows;
  const R = await lib();
  const proj = R.project(rel.ids, rel.pc, rel.cp);
  return rows.map((r) => {
    const data = { ...(r.data || {}) };
    for (const k of LEGACY) delete data[k];
    return { ...r, data: r.deleted ? r.data : { ...data, ...(proj.get(r.id) || {}) } };
  });
}

// Mirror: the legacy fields of touched people (and their partners) follow the projection, without history.
async function mirrorLegacy(q, fam, touched) {
  const R = await lib();
  const rel = await readRel(q, fam, true);
  const set = new Set(touched);
  for (const r of rel.cp) if (set.has(r.a_id) || set.has(r.b_id)) { set.add(r.a_id); set.add(r.b_id); }
  if (!set.size) return;
  const proj = R.project(rel.ids, rel.pc, rel.cp);
  const { rows } = await q.query('select id, data from persons where family_id = $1 and id = any($2::text[]) and not deleted', [fam, [...set]]);
  for (const p of rows) {
    const want = proj.get(p.id) || {}; const cur = p.data || {};
    if (LEGACY.every((k) => String(cur[k] ?? '') === String(want[k] ?? ''))) continue;
    const next = { ...cur };
    for (const k of LEGACY) { if (want[k] != null) next[k] = want[k]; else delete next[k]; }
    await q.query("update persons set data = $2, version = nextval('persons_version'), updated_at = now(), updated_by = 'quan hệ' where id = $1", [p.id, next]);
  }
  await q.query("update persons set version = nextval('persons_version') where family_id = $1 and id = any($2::text[])", [fam, touched]);
}

const isId = (s) => typeof s === 'string' && /^P\d{3,6}$|^N[0-9a-z-]{6,40}$/.test(s);
const intOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

// One relation op. op: { op_id, action: add|edit|remove, kind: parent_child|couple, id?, parent_id, child_id, a_id, b_id, ... }.
// Returns { applied, label, info } where info holds the neutral notes for a couple (never blocking).
async function applyRelOp(q, op, byUser, fam) {
  const R = await lib();
  if (!(await isTable(q, fam))) throw new RelError(409, 'Dòng họ này chưa chuyển dữ liệu quan hệ. Quản trị cần chạy rel-backfill trước.');
  if (!op || typeof op.op_id !== 'string' || !op.op_id || op.op_id.length > 80) throw new RelError(400, 'Thiếu mã thao tác.');
  if (!['add', 'edit', 'remove'].includes(op.action)) throw new RelError(400, 'Thao tác không hợp lệ.');
  if (!['parent_child', 'couple'].includes(op.kind)) throw new RelError(400, 'Loại quan hệ không hợp lệ.');
  const hint = [op.person_id, op.child_id, op.a_id, op.parent_id].find(isId) || 'rel';
  const seen = await q.query('insert into ops (op_id, person_id) values ($1,$2) on conflict do nothing returning op_id', [op.op_id, hint]);
  if (!seen.rowCount) return { applied: false, label: '', info: [] }; // retried op: already applied
  const names = await namesOf(q, fam);
  const sexes = new Map((await q.query("select id, data->>'sex' as s from persons where family_id = $1", [fam])).rows.map((r) => [r.id, r.s]));
  const sx = (id) => sexes.get(id) || '';
  const hist = async (personId, label, field, oldV, newV) => {
    const priv = field.endsWith('_rieng');
    await q.query('insert into history (person_id, field, old_value, new_value, by_user) values ($1,$2,$3,$4,$5)',
      [personId, priv ? 'quan_he_rieng' : 'quan_he', oldV == null ? null : JSON.stringify(label), newV == null ? null : JSON.stringify(label), byUser]);
  };

  if (op.kind === 'parent_child' && op.action === 'add') {
    const row = { parent_id: op.parent_id, child_id: op.child_id, kind: op.pc_kind || 'ruot', birth_order: intOrNull(op.birth_order), private: !!op.private };
    const err = R.validatePC({ ...row }); if (err) throw new RelError(400, err);
    const { rows: ps } = await q.query('select id, family_id, deleted from persons where id = any($1::text[]) for update', [[row.parent_id, row.child_id]]);
    if (ps.length !== 2 || ps.some((p) => p.family_id !== fam || p.deleted)) throw new RelError(404, 'Không tìm thấy người trong dòng họ này.');
    const pcRows = (await q.query('select parent_id, child_id, kind, birth_order, private, id from parent_child where family_id = $1', [fam])).rows;
    const path = R.cyclePath(R.index(pcRows, []), row.parent_id, row.child_id);
    if (path) throw new RelError(409, R.cycleMessage(path, (id) => names.get(id)));
    const { rows: ins } = await q.query(
      `insert into parent_child (family_id, parent_id, child_id, kind, birth_order, private, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) on conflict (family_id, parent_id, child_id) do nothing returning id`,
      [fam, row.parent_id, row.child_id, row.kind, row.birth_order, row.private, byUser]);
    if (!ins.length) throw new RelError(409, 'Quan hệ này đã có.');
    const label = `Thêm quan hệ: ${relLabel({ ...row }, names, sx)}`;
    for (const pid of [row.parent_id, row.child_id]) await hist(pid, label, row.private ? 'quan_he_rieng' : 'quan_he', null, label);
    await mirrorLegacy(q, fam, [row.parent_id, row.child_id]);
    return { applied: true, label, info: [] };
  }
  if (op.kind === 'couple' && op.action === 'add') {
    const row = { a_id: op.a_id, b_id: op.b_id, kind: op.cp_kind || 'cuoi', order_a: intOrNull(op.order_a), order_b: intOrNull(op.order_b),
      start_year: intOrNull(op.start_year), end_year: intOrNull(op.end_year), private: !!op.private, note: String(op.note || '').slice(0, NOTE_MAX) || null };
    const err = R.validateCP(row); if (err) throw new RelError(400, err);
    const { rows: ps } = await q.query('select id, family_id, deleted from persons where id = any($1::text[]) for update', [[row.a_id, row.b_id]]);
    if (ps.length !== 2 || ps.some((p) => p.family_id !== fam || p.deleted)) throw new RelError(404, 'Không tìm thấy người trong dòng họ này.');
    const dup = await q.query(`select 1 from couple where family_id = $1 and kind = $2 and coalesce(start_year,-1) = coalesce($3,-1)
      and ((a_id = $4 and b_id = $5) or (a_id = $5 and b_id = $4))`, [fam, row.kind, row.start_year, row.a_id, row.b_id]);
    if (dup.rowCount) throw new RelError(409, 'Quan hệ này đã có.');
    await q.query(`insert into couple (family_id, a_id, b_id, kind, order_a, order_b, start_year, end_year, private, note, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [fam, row.a_id, row.b_id, row.kind, row.order_a, row.order_b, row.start_year, row.end_year, row.private, row.note, byUser]);
    const label = `Thêm quan hệ: ${relLabel({ ...row }, names, sx)}`;
    for (const pid of [row.a_id, row.b_id]) await hist(pid, label, row.private ? 'quan_he_rieng' : 'quan_he', null, label);
    await mirrorLegacy(q, fam, [row.a_id, row.b_id]);
    const rel = await readRel(q, fam, true);
    return { applied: true, label, info: R.coupleNotes(R.index(rel.pc, rel.cp), row.a_id, row.b_id, (id) => names.get(id)) };
  }
  // edit / remove: the row must exist in this family
  const table = op.kind === 'parent_child' ? 'parent_child' : 'couple';
  const id = Number(op.id);
  if (!Number.isInteger(id) || id < 1) throw new RelError(400, 'Thiếu mã quan hệ.');
  const { rows: cur } = await q.query(`select * from ${table} where id = $1 and family_id = $2 for update`, [id, fam]);
  if (!cur.length) throw new RelError(404, 'Không tìm thấy quan hệ này.');
  const old = cur[0];
  if (op.action === 'remove') {
    await q.query(`delete from ${table} where id = $1 and family_id = $2`, [id, fam]);
    const label = `Gỡ quan hệ: ${relLabel(old, names, sx)}`;
    for (const pid of table === 'parent_child' ? [old.parent_id, old.child_id] : [old.a_id, old.b_id]) await hist(pid, label, old.private ? 'quan_he_rieng' : 'quan_he', label, null);
    await mirrorLegacy(q, fam, table === 'parent_child' ? [old.parent_id, old.child_id] : [old.a_id, old.b_id]);
    return { applied: true, label, info: [] };
  }
  // edit: only kind, order, years, note and privacy change. Who is linked to whom is fixed (remove and add to change it).
  let next; let err;
  if (table === 'parent_child') {
    next = { ...old, kind: op.pc_kind ?? old.kind, birth_order: op.birth_order !== undefined ? intOrNull(op.birth_order) : old.birth_order, private: op.private ?? old.private };
    err = R.validatePC({ parent_id: next.parent_id, child_id: next.child_id, kind: next.kind, birth_order: next.birth_order });
  } else {
    next = { ...old, kind: op.cp_kind ?? old.kind,
      order_a: op.order_a !== undefined ? intOrNull(op.order_a) : old.order_a, order_b: op.order_b !== undefined ? intOrNull(op.order_b) : old.order_b,
      start_year: op.start_year !== undefined ? intOrNull(op.start_year) : old.start_year, end_year: op.end_year !== undefined ? intOrNull(op.end_year) : old.end_year,
      private: op.private ?? old.private, note: op.note !== undefined ? (String(op.note || '').slice(0, NOTE_MAX) || null) : old.note };
    err = R.validateCP({ a_id: next.a_id, b_id: next.b_id, kind: next.kind, order_a: next.order_a, order_b: next.order_b, start_year: next.start_year, end_year: next.end_year });
  }
  if (err) throw new RelError(400, err);
  if (table === 'parent_child') {
    await q.query('update parent_child set kind=$2, birth_order=$3, private=$4 where id=$1', [id, next.kind, next.birth_order, next.private]);
  } else {
    await q.query('update couple set kind=$2, order_a=$3, order_b=$4, start_year=$5, end_year=$6, private=$7, note=$8 where id=$1',
      [id, next.kind, next.order_a, next.order_b, next.start_year, next.end_year, next.private, next.note]);
  }
  const label = `Sửa quan hệ: ${relLabel(next, names, sx)}`;
  for (const pid of table === 'parent_child' ? [old.parent_id, old.child_id] : [old.a_id, old.b_id]) await hist(pid, label, next.private ? 'quan_he_rieng' : 'quan_he', label, label);
  await mirrorLegacy(q, fam, table === 'parent_child' ? [old.parent_id, old.child_id] : [old.a_id, old.b_id]);
  const rel = table === 'couple' ? await readRel(q, fam, true) : null;
  return { applied: true, label, info: rel ? R.coupleNotes(R.index(rel.pc, rel.cp), next.a_id, next.b_id, (x) => names.get(x)) : [] };
}

// Projection of the whole family (members' view): Map person id -> { parent, other_parent, spouse_of, spouse_n }.
async function projectFamily(q, fam, full = true) {
  const R = await lib();
  const rel = await readRel(q, fam, full);
  return R.project(rel.ids, rel.pc, rel.cp);
}

// Row shapes of a relation request / suggestion (the same fields the API takes; pc_kind and cp_kind carry the kind).
const pcRowOf = (r) => ({ parent_id: r.parent_id, child_id: r.child_id, kind: r.pc_kind || 'ruot', birth_order: intOrNull(r.birth_order), private: !!r.private });
const cpRowOf = (r) => ({ a_id: r.a_id, b_id: r.b_id, kind: r.cp_kind || 'cuoi', order_a: intOrNull(r.order_a), order_b: intOrNull(r.order_b),
  start_year: intOrNull(r.start_year), end_year: intOrNull(r.end_year), private: !!r.private, note: String(r.note || '').slice(0, NOTE_MAX) || null });

// Shape of a relation suggestion, checked when it is sent (null = fine, else a message).
async function relShapeError(r) {
  const R = await lib();
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'Thiếu thông tin quan hệ.';
  if (!['add', 'edit', 'remove'].includes(r.action)) return 'Thao tác không hợp lệ.';
  if (!['parent_child', 'couple'].includes(r.kind)) return 'Loại quan hệ không hợp lệ.';
  if (r.action !== 'add') return Number.isInteger(Number(r.id)) && Number(r.id) >= 1 ? null : 'Thiếu mã quan hệ.';
  const ids = r.kind === 'parent_child' ? [r.parent_id, r.child_id] : [r.a_id, r.b_id];
  if (!ids.every(isId)) return 'Người này không có trong dữ liệu.';
  return r.kind === 'parent_child' ? R.validatePC(pcRowOf(r)) : R.validateCP(cpRowOf(r));
}

// Checks that can be made before approval: people exist, and no cycle. { status, message } or null.
async function precheckRel(q, fam, r) {
  const R = await lib();
  if (r.action !== 'add') {
    const table = r.kind === 'parent_child' ? 'parent_child' : 'couple';
    const { rowCount } = await q.query(`select 1 from ${table} where id = $1 and family_id = $2`, [Number(r.id), fam]);
    return rowCount ? null : { status: 404, message: 'Không tìm thấy quan hệ này.' };
  }
  const ids = r.kind === 'parent_child' ? [r.parent_id, r.child_id] : [r.a_id, r.b_id];
  const { rows } = await q.query('select id from persons where family_id = $1 and not deleted and id = any($2::text[])', [fam, ids]);
  if (new Set(rows.map((x) => x.id)).size !== 2) return { status: 404, message: 'Không tìm thấy người trong dòng họ này.' };
  if (r.kind === 'parent_child') {
    const pc = (await q.query('select parent_id, child_id, kind, birth_order, private, id from parent_child where family_id = $1', [fam])).rows;
    const path = R.cyclePath(R.index(pc, []), r.parent_id, r.child_id);
    if (path) { const names = await namesOf(q, fam); return { status: 409, message: R.cycleMessage(path, (x) => names.get(x)) }; }
  }
  return null;
}

// Label of a relation suggestion for the reviewer.
function relSuggestLabel(r, names) {
  if (r.action !== 'add') return `${r.action === 'edit' ? 'Sửa' : 'Gỡ'} quan hệ #${r.id}`;
  const row = r.kind === 'parent_child' ? pcRowOf(r) : cpRowOf(r);
  return `Thêm quan hệ: ${relLabel({ ...row, kind: row.kind }, names || new Map())}`;
}

module.exports = { RelError, readRel, withRel, applyRelOp, mirrorLegacy, isTable, relLabel, namesOf, LEGACY,
  projectFamily, relShapeError, precheckRel, relSuggestLabel };
