// Reusable family sources (E2, migrations/041_sources.sql): rules, rows and usage. Routes: sources-routes.js.
// Events cite a source by source_id (and a page); the citation keeps a copy of the title and url (events.sources), so the
// GEDCOM export, the MCP and old code read the same shape. Renaming a source updates those copies (updateSource).
'use strict';
const crypto = require('crypto');

const KINDS = ['gia_pha', 'bia_mo', 'giay_to', 'loi_ke', 'web', 'khac'];
const ID_RE = /^D[0-9a-f]{12}$/;
const SRC_COLS = 's.id, s.family_id, s.title, s.kind, s.author, s.year, s.url, s.note, s.created_by, s.created_at, s.updated_at';

class SrcError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// The fields a client may set (cleaned). Pure. Returns { value } or { error }.
function cleanSource(input) {
  const v = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const str = (x, max) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
  const title = str(v.title, 300);
  if (!title) return { error: 'Cần tên nguồn.' };
  const kind = v.kind === undefined || v.kind === null || v.kind === '' ? 'khac' : v.kind;
  if (!KINDS.includes(kind)) return { error: 'Loại nguồn không hợp lệ.' };
  const url = str(v.url, 2000);
  if (url && !/^https?:\/\//i.test(url)) return { error: 'Link nguồn phải bắt đầu bằng http(s)://' };
  let year = null;
  if (v.year !== undefined && v.year !== null && v.year !== '') {
    const n = typeof v.year === 'number' ? v.year : /^\d{1,4}$/.test(String(v.year).trim()) ? Number(String(v.year).trim()) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > 9999) return { error: 'Năm của nguồn không hợp lệ.' };
    year = n;
  }
  return { value: { title, kind, author: str(v.author, 200) || null, year, url: url || null, note: str(v.note, 2000) || null } };
}
// Pure check for the API and the rules tests: null when fine.
function validateSource(input) { return cleanSource(input).error || null; }

function sourceOut(r) {
  return { id: r.id, title: r.title, kind: r.kind, author: r.author || '', year: r.year == null ? null : Number(r.year),
    url: r.url || '', note: r.note || '', uses: Number(r.uses || 0), created_by: r.created_by || '',
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at, updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at };
}

// Live sources of a family with how many events cite each one.
async function listSources(q, famId) {
  const { rows } = await q.query(
    `select ${SRC_COLS}, (select count(*) from events e where e.family_id = s.family_id
        and exists (select 1 from jsonb_array_elements(e.sources) x where x->>'source_id' = s.id)) as uses
     from sources s where s.family_id = $1 and s.deleted_at is null order by lower(s.title), s.id`, [famId]);
  return rows.map(sourceOut);
}
// One live source of the family (or null).
async function sourceIn(q, famId, id) {
  const { rows } = await q.query('select * from sources where id = $1 and family_id = $2 and deleted_at is null', [id, famId]);
  return rows[0] || null;
}
async function usesOf(q, famId, id) {
  const { rows } = await q.query(
    `select count(*) as n from events e where e.family_id = $1 and exists (select 1 from jsonb_array_elements(e.sources) x where x->>'source_id' = $2)`, [famId, id]);
  return Number(rows[0].n);
}

async function insertSource(q, famId, input, by) {
  const c = cleanSource(input);
  if (c.error) throw new SrcError(422, c.error);
  const id = 'D' + crypto.randomBytes(6).toString('hex');
  const v = c.value;
  const { rows } = await q.query(
    'insert into sources (id, family_id, title, kind, author, year, url, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *',
    [id, famId, v.title, v.kind, v.author, v.year, v.url, v.note, by || null]);
  return sourceOut({ ...rows[0], uses: 0 });
}

// Edits a source and refreshes the title and url copied into the citations that use it (one statement).
async function updateSource(q, famId, id, input) {
  const cur = await sourceIn(q, famId, id);
  if (!cur) return null;
  const c = cleanSource(input);
  if (c.error) throw new SrcError(422, c.error);
  const v = c.value;
  const { rows } = await q.query(
    `update sources set title = $3, kind = $4, author = $5, year = $6, url = $7, note = $8, updated_at = now()
     where id = $1 and family_id = $2 returning *`, [id, famId, v.title, v.kind, v.author, v.year, v.url, v.note]);
  await q.query(
    `update events set sources = (select jsonb_agg(case when x->>'source_id' = $1
        then x || jsonb_build_object('title', $3::text, 'url', coalesce($4::text, '')) else x end order by ord)
        from jsonb_array_elements(events.sources) with ordinality as t(x, ord))
     where family_id = $2 and exists (select 1 from jsonb_array_elements(events.sources) y where y->>'source_id' = $1)`,
    [id, famId, v.title, v.url]);
  return sourceOut({ ...rows[0], uses: await usesOf(q, famId, id) });
}

// Soft delete. Refused while an event cites it (the caller answers 409 with the count).
async function deleteSource(q, famId, id) {
  const cur = await sourceIn(q, famId, id);
  if (!cur) return { status: 'missing' };
  const n = await usesOf(q, famId, id);
  if (n > 0) return { status: 'in_use', uses: n };
  await q.query('update sources set deleted_at = now(), updated_at = now() where id = $1 and family_id = $2', [id, famId]);
  return { status: 'deleted' };
}

// An event's citations with source_id: the source must be live and in the same family. Title and url are copied from
// the source here (the client's copy is not trusted). Other citations are kept as they are. Returns a new event input.
async function resolveCitations(q, famId, input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.sources)) return input;
  const ids = [...new Set(input.sources.filter((s) => s && s.source_id).map((s) => String(s.source_id)))];
  if (!ids.length) return input;
  if (ids.some((x) => !ID_RE.test(x))) throw new SrcError(422, 'Nguồn không hợp lệ.');
  const { rows } = await q.query('select id, title, url from sources where family_id = $1 and deleted_at is null and id = any($2)', [famId, ids]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const sources = input.sources.map((s) => {
    if (!s || !s.source_id) return s;
    const src = byId.get(String(s.source_id));
    if (!src) throw new SrcError(422, 'Nguồn này không thuộc dòng họ hoặc đã bị xóa.');
    return { ...s, title: src.title, url: src.url || '' };
  });
  return { ...input, sources };
}

module.exports = { KINDS, ID_RE, SrcError, cleanSource, validateSource, sourceOut, listSources, sourceIn, usesOf, insertSource, updateSource,
  deleteSource, resolveCitations };
