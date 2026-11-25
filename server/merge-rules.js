// Merge of two duplicate people inside one tree: pure rules (no DB, no express). Tested in server/test/merge-rules.test.js.
// The merged-away person is archived through the trash (never hard-deleted); the field choices, the relation plan and the
// cycle guard are decided here. A merge is a family decision (decisions.js, kind 'merge_person').
'use strict';

const MERGE_LABEL = 'Gộp hai hồ sơ trùng';
// Legacy relation fields of a person record. They follow the same choice as any field here; merge.js then re-points the
// references to the merged-away person (in other records and in the relation tables) so they match the merged record.
const REL_FIELDS = ['parent', 'other_parent', 'spouse_of'];

const empty = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);

// The union of field names of two records, without internal keys, in a stable order.
function fieldNames(keep = {}, drop = {}) {
  return [...new Set([...Object.keys(keep), ...Object.keys(drop)])].sort();
}

// Default choice per field: the kept person's value unless it is empty, then the merged-away person's value.
// A choice is 'keep' or 'drop'.
function defaultChoices(keep, drop) {
  const out = {};
  for (const f of fieldNames(keep, drop)) out[f] = empty(keep[f]) && !empty(drop[f]) ? 'drop' : 'keep';
  return out;
}

// Which of two records is kept: the older profile (earliest created time; a missing time sorts last; tie -> lower id).
// a, b: { id, created } with created in ms or null. Returns [older, newer]. The client's choice of keeper is never used.
function olderFirst(a, b) {
  const ca = a.created ?? Infinity; const cb = b.created ?? Infinity;
  if (ca !== cb) return ca < cb ? [a, b] : [b, a];
  return a.id <= b.id ? [a, b] : [b, a];
}

// Per field of two records: 'conflict' (both set, different: the owner chooses), 'filled' (one side empty: the other
// side's value is used, no choice), 'same' (both set, equal). Fields empty on both sides are left out.
function classifyFields(keep = {}, drop = {}) {
  const out = { conflicts: [], filled: [], same: [] };
  for (const f of fieldNames(keep, drop)) {
    const k = keep[f]; const d = drop[f];
    if (empty(k) && empty(d)) continue;
    if (empty(k)) out.filled.push({ field: f, from: 'drop' });
    else if (empty(d)) out.filled.push({ field: f, from: 'keep' });
    else if (JSON.stringify(k) === JSON.stringify(d)) out.same.push(f);
    else out.conflicts.push(f);
  }
  return out;
}

// The merged record. choices: { field: 'keep' | 'drop' } for conflicting fields only; a conflict left out takes the
// default (kept person's value). A field with a value on one side only takes that value whatever the choice says.
function mergeData(keep = {}, drop = {}, choices = {}) {
  const def = defaultChoices(keep, drop);
  for (const [f, c] of Object.entries(choices)) {
    if (!(f in def)) throw new MergeError(400, `Trường không hợp lệ: ${f}.`);
    if (c !== 'keep' && c !== 'drop') throw new MergeError(400, 'Mỗi trường chỉ chọn "giữ" hoặc "bỏ".');
  }
  const out = {}; const changed = [];
  for (const f of Object.keys(def)) {
    const kEmpty = empty(keep[f]); const dEmpty = empty(drop[f]);
    const pick = kEmpty !== dEmpty ? (kEmpty ? 'drop' : 'keep') : ((choices[f] || def[f]) === 'drop' ? 'drop' : 'keep');
    const from = keep[f]; const to = pick === 'drop' ? drop[f] : keep[f];
    if (!empty(to)) out[f] = to;
    if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) changed.push({ field: f, from: from ?? null, to: to ?? null });
  }
  return { data: out, changed };
}

class MergeError extends Error { constructor(status, msg) { super(msg); this.name = "MergeError"; this.status = status; } }

// Cycle guard on the parent-child graph after the merge. edges: [{ parent, child }] before the merge.
// Every edge of the merged-away person moves to the kept one; the merge is refused when the kept person would be
// its own ancestor (or when the two people are parent and child, or partners, of each other).
function checkMerge(keep, drop, edges, couples = []) {
  if (!keep || !drop || keep === drop) return { ok: false, why: 'same' };
  if (edges.some((e) => (e.parent === keep && e.child === drop) || (e.parent === drop && e.child === keep))) return { ok: false, why: 'related' };
  if (couples.some((c) => (c.a === keep && c.b === drop) || (c.a === drop && c.b === keep))) return { ok: false, why: 'related' };
  const moved = edges.map((e) => ({ parent: e.parent === drop ? keep : e.parent, child: e.child === drop ? keep : e.child }));
  // children of each node after the merge
  const kids = new Map();
  for (const e of moved) { if (!kids.has(e.parent)) kids.set(e.parent, []); kids.get(e.parent).push(e.child); }
  // is keep reachable from its own children?
  const seen = new Set(); const stack = [...(kids.get(keep) || [])];
  while (stack.length) {
    const x = stack.pop();
    if (x === keep) return { ok: false, why: 'cycle' };
    if (seen.has(x)) continue;
    seen.add(x);
    for (const c of kids.get(x) || []) stack.push(c);
  }
  return { ok: true };
}

const WHY = {
  same: 'Cần chọn hai người khác nhau.',
  related: 'Hai người này là cha/mẹ – con hoặc vợ/chồng của nhau. Không gộp được.',
  cycle: 'Gộp hai người này sẽ làm một người thành tổ tiên của chính mình. Không gộp được.',
  access: 'Người này đang có quyền truy cập (người cao tuổi, người quản lý). Gỡ các quyền đó trước khi gộp.',
};

module.exports = { MERGE_LABEL, REL_FIELDS, defaultChoices, olderFirst, classifyFields, mergeData, checkMerge, MergeError, WHY };
