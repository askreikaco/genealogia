// Google Sheet <-> persons mapping and two-way merge plan. Pure (no I/O); tested in test/sheetmap.test.js.
// Columns are matched by header text, so owners may reorder or add columns in the Sheet.
'use strict';

const enumMap = (pairs) => ({ toSheet: Object.fromEntries(pairs), fromSheet: Object.fromEntries(pairs.map(([a, b]) => [b.toLowerCase(), a])) });
const SEX = enumMap([['m', 'Nam'], ['f', 'Nữ']]);
const LIVING = enumMap([['living', 'Còn sống'], ['dead', 'Đã mất'], ['unknown', 'Chưa rõ']]);
const PUBLIC = enumMap([['yes', 'Có'], ['no', 'Không']]);

// [header, field, kind]; kind: text | int | enum map | 'id' | 'parentName' (derived, write-only) | 'updated' (write-only) | 'deleted'
const COLS = [
  ['ID', 'id', 'id'], ['Đời', 'gen', 'int'], ['Thứ', 'thu', 'text'], ['Họ tên', 'name', 'text'], ['Giới tính', 'sex', SEX],
  ['Cha/Mẹ (ID)', 'parent', 'text'], ['Cha/Mẹ (tên)', null, 'parentName'], ['Vợ/Chồng', 'spouse', 'text'], ['Vợ/chồng của (ID)', 'spouse_of', 'text'], ['Thứ tự vợ/chồng', 'spouse_n', 'int'], ['Mẹ/Cha còn lại (ID)', 'other_parent', 'text'],
  ['Năm sinh', 'born', 'text'], ['Ngày sinh', 'birth_date', 'text'], ['Ngày sinh (ÂL)', 'birth_lunar', 'text'], ['Năm mất', 'died', 'text'], ['Ngày mất (ÂL)', 'death_lunar', 'text'], ['Ngày giỗ (ÂL)', 'gio_lunar', 'text'],
  ['Nơi sống', 'place', 'text'], ['Tên khác', 'alias', 'text'], ['Ghi chú', 'note', 'text'], ['Cần xác minh', 'verify', 'text'],
  ['Còn sống', 'living', LIVING], ['Tên húy / tự / hiệu', 'title_name', 'text'], ['Nghề nghiệp', 'job', 'text'], ['Tôn giáo', 'religion', 'text'],
  ['Ngày cưới', 'married', 'text'], ['An táng (mộ phần)', 'burial', 'text'], ['Ảnh (link)', 'photo', 'text'], ['Điện thoại', 'phone', 'text'],
  ['Email', 'email', 'text'], ['Địa chỉ', 'address', 'text'], ['Facebook', 'facebook', 'text'], ['Zalo', 'zalo', 'text'],
  ['Mạng xã hội khác', 'social', 'text'], ['Liên hệ công khai?', 'contact_public', PUBLIC], ['Nguồn', 'source', 'text'],
  ['Cập nhật lúc', null, 'updated'], ['Đã xóa', '_deleted', 'deleted'],
];
const FIELDS = COLS.filter((c) => c[1] && c[1] !== 'id').map((c) => c[1]);
const norm = (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : typeof v === 'string' ? v.trim() : v);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

// Header row -> column index per header (missing headers are appended at the end, in COLS order).
function headerIndex(headerRow) {
  const idx = {}; const out = [...headerRow];
  headerRow.forEach((h, i) => { if (h) idx[String(h).trim()] = i; });
  const added = [];
  for (const [h] of COLS) if (!(h in idx)) { idx[h] = out.length; out.push(h); added.push(h); }
  return { idx, headers: out, added };
}

function rowToData(idx, row) {
  const get = (h) => norm(row[idx[h]] ?? null);
  const id = get('ID'); const data = {};
  for (const [h, f, kind] of COLS) {
    if (!f || f === 'id') continue;
    let v = get(h);
    if (kind === 'int') { const n = parseInt(v, 10); v = Number.isFinite(n) ? n : null; }
    else if (kind === 'deleted') v = v ? /^(có|x|yes|true|1)$/i.test(String(v)) : false;
    else if (kind && kind.fromSheet) v = v == null ? null : kind.fromSheet[String(v).toLowerCase()] ?? null;
    data[f] = v;
  }
  return { id, data };
}

function dataToRow(idx, width, id, data, deleted, parentName, updatedAt) {
  const row = new Array(width).fill('');
  for (const [h, f, kind] of COLS) {
    const i = idx[h]; let v;
    if (kind === 'id') v = id;
    else if (kind === 'parentName') v = parentName || '';
    else if (kind === 'updated') v = updatedAt || '';
    else if (kind === 'deleted') v = deleted ? 'Có' : '';
    else if (kind && kind.toSheet) v = data[f] ? kind.toSheet[data[f]] || '' : '';
    else v = data[f] ?? '';
    row[i] = v === null ? '' : v;
  }
  return row;
}
const pick = (d, deleted) => { const o = {}; for (const f of FIELDS) o[f] = f === '_deleted' ? !!deleted : norm(d?.[f] ?? null); return o; };

/**
 * plan({rows, idx, width, persons, snaps, nextId, now})
 * rows: [{r (1-based sheet row), values}] data rows; persons: [{id, data, deleted, version, updated_at}]; snaps: Map(id -> data)
 * Sheet edits since the last snapshot win for the fields they touch; app edits fill the rest and are written back.
 * Returns { ops: [{id, fields}], updates: [{r, values}], appends: [values], snaps: [{id, data}], created: [id] }
 */
function plan({ rows, idx, width, persons, snaps, nextId, now = new Date() }) {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const nameOf = (id) => byId.get(id)?.data?.name || '';
  const out = { ops: [], updates: [], appends: [], snaps: [], created: [] };
  const seen = new Set();
  const stamp = (p) => (p?.updated_at ? new Date(p.updated_at).toISOString().slice(0, 16).replace('T', ' ') : '');
  for (const { r, values } of rows) {
    const { id: sid, data: sd } = rowToData(idx, values);
    if (!sid) {
      if (!sd.name) continue; // empty row
      const id = nextId(); const fields = {}; for (const f of FIELDS) if (f !== '_deleted' && sd[f] != null) fields[f] = sd[f];
      fields.order = r; out.ops.push({ id, fields }); out.created.push(id);
      out.updates.push({ r, values: dataToRow(idx, width, id, fields, false, nameOf(fields.parent), now.toISOString().slice(0, 16).replace('T', ' ')) });
      out.snaps.push({ id, data: pick(fields, false) }); seen.add(id); continue;
    }
    if (seen.has(sid)) continue; // duplicate ID row: first one wins
    seen.add(sid);
    const p = byId.get(sid);
    const db = pick(p?.data, p?.deleted); const sheet = pick(sd, sd._deleted); const snap = snaps.get(sid);
    const fields = {};
    if (!p) { for (const f of FIELDS) if (sheet[f] != null && sheet[f] !== false) fields[f] = sheet[f]; }
    else if (!snap) { for (const f of FIELDS) if (db[f] == null && sheet[f] != null && sheet[f] !== false) fields[f] = sheet[f]; } // first link: app wins, sheet fills gaps
    else { for (const f of FIELDS) if (!same(sheet[f], snap[f]) && !same(sheet[f], db[f])) fields[f] = sheet[f] ?? ''; }
    if (Object.keys(fields).length) out.ops.push({ id: sid, fields });
    const merged = { ...db }; for (const [f, v] of Object.entries(fields)) merged[f] = norm(v === '' ? null : v);
    const row = dataToRow(idx, width, sid, merged, merged._deleted, nameOf(merged.parent), stamp(p));
    if (row.some((v, i) => String(v) !== String(values[i] ?? ''))) out.updates.push({ r, values: row });
    out.snaps.push({ id: sid, data: merged });
  }
  for (const p of persons) if (!seen.has(p.id) && !p.deleted) {
    out.appends.push(dataToRow(idx, width, p.id, p.data, false, nameOf(p.data.parent), stamp(p)));
    out.snaps.push({ id: p.id, data: pick(p.data, false) });
  }
  return out;
}

module.exports = { COLS, FIELDS, headerIndex, rowToData, dataToRow, plan, norm };
