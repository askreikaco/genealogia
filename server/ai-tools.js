// AI tools (phase 1). A thin layer over the web app's own functions: the same role check (whoFor), the same privacy view
// (core.publicView, canRead, the events rules), the same suggestion table and the same write functions (applyOp,
// REL.applyRelOp, EV.applyEvSuggestion, the member actions). The AI acts as the token's account, never above it:
// the role is effectiveRole(role in the family, granted scopes) from ai-perm.js.
'use strict';
const crypto = require('crypto');
const core = require('./core');
const REL = require('./relations');
const EV = require('./events');
const P = require('./ai-perm');

const ROLES = ['owner', 'admin', 'editor', 'member'];
const LIST_MAX = 25;
const BATCH_TTL_MS = 24 * 3600e3;
const DIFF_MAX = 200;
const SUMMARY_KEYS = ['name', 'name_han', 'alias', 'thu', 'sex', 'gen', 'order', 'parent', 'spouse_of', 'spouse_n', 'living', 'born', 'died',
  'birth_place', 'place', 'job', 'title_name'];
const HIDDEN_KEYS = ['photo', 'lat', 'lon', 'geo_precision'];

class AiError extends Error {
  constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; }
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newId = (p) => p + crypto.randomBytes(12).toString('hex');
const isPersonId = (s) => typeof s === 'string' && /^P\d{3,6}$|^N[0-9a-z-]{6,40}$/.test(s);
const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const trunc = (v, n = 300) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v);

// The account a token acts as, in the token's family: the identity's role, lowered to min(role, scope ceiling).
async function account(ctx) {
  const base = await ctx.deps.whoFor(ctx.tok.identity, ctx.tok.family_id);
  const role = P.effectiveRole(base.role, ctx.tok.scopes);
  const eff = { ...base, role, userRole: base.role };
  eff.by = `${ctx.deps.actorName(eff)} qua AI · ${ctx.tok.client_name}`; // history / suggestion author tag
  return eff;
}
// The family the token is bound to, read by an account that may see it (private families: members only).
async function readable(ctx) {
  const eff = await account(ctx);
  const fam = await ctx.deps.findFamily(ctx.tok.family_id);
  if (!fam) throw new AiError(404, 'Không tìm thấy dòng họ.');
  if (!ctx.deps.canRead(fam, eff)) throw new AiError(403, 'Dòng họ này là riêng tư.');
  return { eff, fam, full: P.ROLE_RANK[eff.role] >= P.ROLE_RANK.member };
}
const personRow = async (ctx, famId, id) => {
  if (!isPersonId(id)) return null;
  const { rows } = await ctx.deps.pool.query('select id, data, deleted, version from persons where id = $1 and family_id = $2', [id, famId]);
  return rows[0] && !rows[0].deleted ? rows[0] : null;
};
// What a viewer may see of a person: the web's view (publicView for non-members, the full record for members).
function personView(data, full) {
  const v = full ? { ...data } : core.publicView(data);
  for (const k of HIDDEN_KEYS) delete v[k];
  return v;
}
const summaryOf = (id, data, full) => {
  const v = personView(data, full); const out = { id };
  for (const k of SUMMARY_KEYS) if (v[k] !== undefined && v[k] !== null && v[k] !== '') out[k] = v[k];
  return out;
};
const nameOf = async (ctx, famId, ids) => {
  const uniq = [...new Set(ids.filter(isPersonId))];
  if (!uniq.length) return new Map();
  const { rows } = await ctx.deps.pool.query('select id, data from persons where family_id = $1 and not deleted and id = any($2::text[])', [famId, uniq]);
  return new Map(rows.map((r) => [r.id, r.data?.name || r.id]));
};

// ---- read tools ----
async function listFamilies(ctx) {
  const { eff, fam } = await readable(ctx);
  const { rows } = await ctx.deps.pool.query('select count(*)::int n from persons where family_id = $1 and not deleted', [fam.id]);
  return { families: [{ slug: fam.slug, name: fam.name, han: fam.han || '', place: fam.place || '', visibility: fam.visibility,
    people: rows[0].n, your_role: eff.role }] };
}
async function searchPeople(ctx, { query, limit = 10 }) {
  const { full, fam } = await readable(ctx);
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) throw new AiError(400, 'Nhập tên cần tìm.');
  const { rows } = await ctx.deps.pool.query('select id, data from persons where family_id = $1 and not deleted order by id', [fam.id]);
  const hits = [];
  for (const r of rows) {
    const hay = fold([r.data?.name, r.data?.alias, r.data?.thu, r.data?.title_name].join(' '));
    if (words.every((w) => hay.includes(w))) hits.push(summaryOf(r.id, r.data, full));
    if (hits.length >= Math.min(Math.max(1, Number(limit) || 10), LIST_MAX)) break;
  }
  return { people: hits, count: hits.length };
}
async function getPerson(ctx, { person_id }) {
  const { full, fam } = await readable(ctx);
  const p = await personRow(ctx, fam.id, person_id);
  if (!p) throw new AiError(404, 'Không tìm thấy người này.');
  return { person: { id: p.id, ...personView(p.data, full) } };
}
async function getRelatives(ctx, { person_id }) {
  const { full, fam } = await readable(ctx);
  const p = await personRow(ctx, fam.id, person_id);
  if (!p) throw new AiError(404, 'Không tìm thấy người này.');
  const rel = await REL.readRel(ctx.deps.pool, fam.id, full);
  const pc = rel.pc.filter((r) => full || !r.private);
  const cp = rel.cp.filter((r) => full || !r.private);
  const parents = pc.filter((r) => r.child_id === person_id).map((r) => ({ id: r.parent_id, kind: r.kind }));
  const children = pc.filter((r) => r.parent_id === person_id).map((r) => ({ id: r.child_id, kind: r.kind, order: r.birth_order }));
  const partners = cp.filter((r) => r.a_id === person_id || r.b_id === person_id)
    .map((r) => ({ id: r.a_id === person_id ? r.b_id : r.a_id, kind: r.kind, start_year: r.start_year ?? null, end_year: r.end_year ?? null }));
  const parentIds = new Set(parents.map((x) => x.id));
  const siblings = [...new Set(pc.filter((r) => parentIds.has(r.parent_id) && r.child_id !== person_id).map((r) => r.child_id))]
    .map((id) => ({ id }));
  const names = await nameOf(ctx, fam.id, [...parents, ...children, ...partners, ...siblings].map((x) => x.id));
  const withName = (list) => list.filter((x) => names.has(x.id)).map((x) => ({ ...x, name: names.get(x.id) }));
  return { person_id, parents: withName(parents), children: withName(children), partners: withName(partners), siblings: withName(siblings), source: rel.source };
}
async function getTimeline(ctx, { person_id }) {
  const { full, fam } = await readable(ctx);
  const p = await personRow(ctx, fam.id, person_id);
  if (!p) throw new AiError(404, 'Không tìm thấy người này.');
  const R = await EV.rules();
  if (!R.canSeeEventsOf(p.data, { member: full, familyReadable: true })) return { hidden: true, items: [], stories: [] };
  const items = await EV.listEvents(ctx.deps.pool, fam.id, person_id);
  const stories = await EV.listStories(ctx.deps.pool, fam.id, person_id);
  return { hidden: false, items: items.slice(0, 200), stories: stories.slice(0, 50) };
}
async function getBookLink(ctx, args) {
  const { fam } = await readable(ctx);
  const u = new URL('/book', ctx.base);
  u.searchParams.set('family', fam.slug);
  if (args.root) { if (!isPersonId(args.root)) throw new AiError(400, 'Mã người không hợp lệ.'); u.searchParams.set('root', args.root); }
  if (args.dir && args.dir !== 'down') u.searchParams.set('dir', args.dir);
  if (args.gen) u.searchParams.set('gen', String(args.gen));
  if (args.spouses === false) u.searchParams.set('spouses', '0');
  if (args.status && args.status !== 'all') u.searchParams.set('status', args.status);
  const url = u.toString();
  const embed = new URL(url); embed.searchParams.set('embed', '1');
  const print = new URL(url); print.searchParams.set('inapp', '1');
  return { url, embed_url: embed.toString(), embed_html: `<iframe src="${embed.toString()}" width="100%" height="640" style="border:0" loading="lazy" title="Sách gia phả"></iframe>`,
    print_url: print.toString(), note: 'Mở print_url rồi chọn In > Lưu thành PDF. Server không tạo PDF.' };
}

// ---- suggest / write: propose_changes, add_event, add_relation ----
// items: [{ type:'edit', person_id, fields } | { type:'event', person_id, item } | { type:'relation', relation }]
async function validateItems(ctx, fam, items) {
  const errors = []; const out = [];
  for (const [index, it] of items.entries()) {
    const bad = (error) => errors.push({ index, error });
    if (it.type === 'edit') {
      const fields = it.fields || {};
      if ('_deleted' in fields) { bad('Xóa người không có trong AI. Quản trị làm trong app.'); continue; }
      const err = core.validateOp({ op_id: 'ai-check', id: it.person_id, fields });
      if (err) { bad(err); continue; }
      const p = await personRow(ctx, fam.id, it.person_id);
      if (!p) { bad('Người này không có trong dòng họ.'); continue; }
      out.push({ index, type: 'edit', person_id: it.person_id, fields, name: p.data?.name || '', base: Object.fromEntries(Object.keys(fields).map((k) => [k, p.data?.[k] ?? null])),
        current: p.data || {}, version: Number(p.version) });
    } else if (it.type === 'event') {
      const ev = { action: 'add', kind: 'event', item: it.item };
      const err = await EV.checkEvSuggest(ev);
      if (err) { bad(err); continue; }
      if (!(await EV.personIn(ctx.deps.pool, fam.id, it.person_id))) { bad('Người này không có trong dòng họ.'); continue; }
      out.push({ index, type: 'event', person_id: it.person_id, ev, name: '' });
    } else if (it.type === 'relation') {
      const rel = { ...it.relation };
      if (rel.action !== 'add') { bad('AI chỉ thêm quan hệ (action "add").'); continue; }
      const err = await REL.relShapeError(rel);
      if (err) { bad(err); continue; }
      if (!(await REL.isTable(ctx.deps.pool, fam.id))) { bad('Dòng họ này chưa chuyển dữ liệu quan hệ.'); continue; }
      const pe = await REL.precheckRel(ctx.deps.pool, fam.id, rel);
      if (pe) { bad(pe.message); continue; }
      out.push({ index, type: 'relation', relation: rel, name: '' });
    } else bad('Loại mục không hợp lệ.');
  }
  return { out, errors };
}
// Conflicts inside one batch: the same field of the same person twice (the second would overwrite the first).
function batchConflicts(out) {
  const seen = new Map(); const conflicts = [];
  for (const c of out) {
    if (c.type !== 'edit') continue;
    for (const f of Object.keys(c.fields)) {
      const k = c.person_id + '|' + f;
      if (seen.has(k)) conflicts.push({ index: c.index, person_id: c.person_id, field: f, reason: `Trường này cũng có ở mục ${seen.get(k) + 1} của cùng lô.` });
      else seen.set(k, c.index);
    }
  }
  return conflicts;
}
function previewOf(out, conflicts) {
  const diff = [];
  let fields = 0; let noop = 0;
  for (const c of out) {
    if (c.type !== 'edit') continue;
    for (const [f, nv] of Object.entries(c.fields)) {
      fields++;
      const old = c.current[f] ?? null; const val = nv === '' ? null : nv;
      const isNoop = same(old, val);
      if (isNoop) noop++;
      if (diff.length < DIFF_MAX) diff.push({ index: c.index, person_id: c.person_id, name: c.name, field: f, old: trunc(old), new: trunc(val), noop: isNoop });
    }
  }
  return {
    counts: { records: out.length, people: new Set(out.map((c) => c.person_id).filter(Boolean)).size,
      field_changes: fields, no_change: noop, events: out.filter((c) => c.type === 'event').length, relations: out.filter((c) => c.type === 'relation').length },
    diff, diff_truncated: fields > DIFF_MAX, conflicts,
  };
}
async function proposeChanges(ctx, items) {
  const { eff, fam } = await readable(ctx);
  if (!P.scopeIncludes(ctx.tok.scopes, 'suggest')) throw new AiError(403, 'Mã này không có quyền góp ý.');
  if (!Array.isArray(items) || !items.length) throw new AiError(400, 'Cần ít nhất một thay đổi.');
  if (items.length > P.MAX_BATCH) throw new AiError(422, `Tối đa ${P.MAX_BATCH} mục mỗi lô.`);
  const { out, errors } = await validateItems(ctx, fam, items);
  if (errors.length) throw new AiError(422, 'Có mục chưa hợp lệ. Sửa rồi gửi lại.', { errors });
  const writer = P.ROLE_RANK[eff.role] >= P.ROLE_RANK.editor;
  if (!writer) return suggestOut(ctx, eff, fam, out);
  const conflicts = batchConflicts(out);
  const preview = previewOf(out, conflicts);
  const versions = Object.fromEntries(out.filter((c) => c.type === 'edit').map((c) => [c.person_id, c.version]));
  const id = newId('b');
  const changes = out.map(({ index, type, person_id, fields, base, ev, relation }) => ({ index, type, person_id, fields, base, ev, relation }));
  const expires = new Date(Date.now() + BATCH_TTL_MS);
  await ctx.deps.pool.query(
    `insert into ai_batches (id, token_id, family_id, status, changes, preview, versions, expires_at) values ($1,$2,$3,'previewed',$4,$5,$6,$7)`,
    [id, ctx.tok.id, fam.id, JSON.stringify(changes), JSON.stringify(preview), JSON.stringify(versions), expires]);
  return { mode: 'preview', batch_id: id, preview, expires_at: expires.toISOString(),
    next: `Gọi apply_changes với batch_id "${id}" và op_id mới để ghi. Chỉ ghi khi không có xung đột.` };
}
// Not a writer (guest or member, or a suggest-only token): every item becomes a suggestion for the admins' review.
async function suggestOut(ctx, eff, fam, out) {
  const { pool } = ctx.deps; const ids = [];
  const ip = sha('ai:' + ctx.tok.id);
  for (const c of out) {
    let changes; let personId = null; let base = {};
    if (c.type === 'edit') { changes = c.fields; personId = c.person_id; base = c.base; }
    else if (c.type === 'event') { changes = { _ev: c.ev }; personId = c.person_id; }
    else changes = { _rel: c.relation };
    const { rows } = await pool.query(
      `insert into suggestions (person_id, changes, note, by_name, by_contact, ip_hash, receipt_hash, account_email, base, family_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [personId, changes, '', eff.by, eff.email || '', ip, sha(crypto.randomBytes(16)), eff.email || null, base, fam.id]);
    ids.push({ id: rows[0].id, type: c.type, person_id: personId });
  }
  return { mode: 'suggested', suggestions: ids, note: 'Đã gửi góp ý. Quản trị duyệt trong Cài đặt › Ứng dụng AI.' };
}
async function applyChanges(ctx, { batch_id, op_id }) {
  const { eff, fam } = await readable(ctx);
  if (P.ROLE_RANK[eff.role] < P.ROLE_RANK.editor) throw new AiError(403, 'Cần quyền biên tập để áp dụng.');
  if (typeof op_id !== 'string' || !op_id || op_id.length > 80) throw new AiError(400, 'Thiếu mã thao tác (op_id).');
  const { rows } = await ctx.deps.pool.query('select * from ai_batches where id = $1 and token_id = $2 and family_id = $3', [batch_id, ctx.tok.id, fam.id]);
  const b = rows[0];
  if (!b) throw new AiError(404, 'Không tìm thấy lô này.');
  if (b.status === 'applied') {
    if (b.apply_op_id === op_id) return { ...b.result, duplicate: true };
    throw new AiError(409, 'Lô này đã áp dụng.', { result: b.result });
  }
  if (new Date(b.expires_at) < new Date()) throw new AiError(410, 'Lô đã hết hạn. Xem trước lại.');
  if (b.preview?.conflicts?.length) throw new AiError(409, 'Lô còn xung đột. Xem trước lại.', { conflicts: b.preview.conflicts });
  // Stale check: a person changed after the preview -> the preview is no longer true; preview again.
  const stale = [];
  for (const [pid, v] of Object.entries(b.versions || {})) {
    const cur = await ctx.deps.pool.query('select version, deleted from persons where id = $1 and family_id = $2', [pid, fam.id]);
    if (!cur.rows[0] || cur.rows[0].deleted || Number(cur.rows[0].version) !== Number(v)) stale.push(pid);
  }
  if (stale.length) throw new AiError(409, 'Dữ liệu đã đổi sau khi xem trước. Xem trước lại.', { stale });
  const by = eff.by; const { pool } = ctx.deps;
  const client = await pool.connect();
  try {
    await client.query('begin');
    let n = 0;
    for (const c of b.changes) {
      const key = `${b.id}-${c.index}`;
      if (c.type === 'edit') await ctx.deps.applyOp(client, { op_id: key, id: c.person_id, fields: c.fields, ts: Date.now() }, by, fam.id);
      else if (c.type === 'event') await EV.applyEvSuggestion(client, fam.id, { person_id: c.person_id, changes: { _ev: c.ev } }, by);
      else await REL.applyRelOp(client, { ...c.relation, op_id: key }, by, fam.id);
      n++;
    }
    const result = { ok: true, batch_id: b.id, applied: n, counts: b.preview?.counts || {} };
    await client.query("update ai_batches set status='applied', apply_op_id=$2, result=$3, applied_at=now() where id=$1", [b.id, op_id, JSON.stringify(result)]);
    await client.query('commit');
    ctx.deps.onWrite();
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    if (e.status) throw new AiError(e.status, e.message);
    throw e;
  } finally { client.release(); }
}

// ---- admin actions: never run by the AI. They become a request an admin approves in the app. ----
async function requestAdminAction(ctx, action, args, { elicited = false, cancelled = false } = {}) {
  const { eff, fam } = await readable(ctx);
  if (P.ROLE_RANK[eff.role] < P.ROLE_RANK.admin) throw new AiError(403, 'Cần quyền quản trị để yêu cầu việc này.');
  let payload;
  if (action === 'invite_member') {
    const email = String(args.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new AiError(400, 'Email không hợp lệ.');
    const role = args.role || 'member';
    if (!ROLES.includes(role) || role === 'owner') throw new AiError(400, 'Vai trò không hợp lệ (chủ họ không chuyển qua AI).');
    payload = { email, role };
  } else {
    const id = Number(args.member_id);
    if (!Number.isInteger(id) || id < 1) throw new AiError(400, 'Thiếu mã thành viên.');
    const { rows } = await ctx.deps.pool.query("select id, role, status, name, email from members where id = $1 and family_id = $2", [id, fam.id]);
    const m = rows[0];
    if (!m || m.status !== 'active') throw new AiError(404, 'Không tìm thấy thành viên đang hoạt động.');
    if (m.role === 'owner') throw new AiError(409, 'Chủ họ không đổi hay gỡ qua AI.');
    if (action === 'change_role') {
      if (!['admin', 'editor', 'member'].includes(args.role)) throw new AiError(400, 'Vai trò không hợp lệ (chủ họ không chuyển qua AI).');
      payload = { member_id: id, role: args.role, from: m.role, name: m.name || m.email || '' };
    } else payload = { member_id: id, from: m.role, name: m.name || m.email || '' };
  }
  const status = cancelled ? 'cancelled' : 'pending';
  const { rows } = await ctx.deps.pool.query(
    'insert into ai_requests (family_id, token_id, client_name, requested_by, action, payload, elicited, status) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
    [fam.id, ctx.tok.id, ctx.tok.client_name, ctx.deps.actorName(eff), action, JSON.stringify(payload), elicited, status]);
  if (cancelled) return { request_id: rows[0].id, status: 'cancelled', message: 'Bạn đã không xác nhận. Chưa có gì thay đổi.' };
  return { request_id: rows[0].id, status: 'pending', message: 'Đã gửi yêu cầu. Quản trị duyệt trong Cài đặt › Ứng dụng AI. Chưa có gì thay đổi.' };
}

// Approval of a pending request by an admin in the app (the approver's own role applies, not the AI's).
async function approveRequest(deps, session, id) {
  const { rows } = await deps.pool.query('select r.*, f.id as fid from ai_requests r join families f on f.id = r.family_id where r.id = $1', [id]);
  const r = rows[0];
  if (!r) throw new AiError(404, 'Không tìm thấy yêu cầu.');
  const w = await deps.whoFor(session, r.family_id);
  if (P.ROLE_RANK[w.role] < P.ROLE_RANK.admin) throw new AiError(403, 'Chỉ quản trị mới duyệt được.');
  if (r.status !== 'pending') throw new AiError(409, 'Yêu cầu này đã được xử lý.');
  const f = await deps.findFamily(r.family_id);
  const p = r.payload;
  try {
    if (r.action === 'invite_member') await deps.doInvite(w, f, p.email, p.role);
    else if (r.action === 'change_role') await deps.doRoleChange(w, f, p.member_id, p.role);
    else await deps.doRemove(w, f, p.member_id);
  } catch (e) {
    if (e.status) throw new AiError(e.status, e.message);
    throw e;
  }
  await deps.pool.query("update ai_requests set status='approved', decided_by=$2, decided_at=now() where id=$1", [id, deps.actorName(w)]);
  deps.onWrite();
  return { ok: true };
}
async function rejectRequest(deps, session, id, reason) {
  const { rows } = await deps.pool.query('select family_id, status from ai_requests where id = $1', [id]);
  const r = rows[0];
  if (!r) throw new AiError(404, 'Không tìm thấy yêu cầu.');
  const w = await deps.whoFor(session, r.family_id);
  if (P.ROLE_RANK[w.role] < P.ROLE_RANK.admin) throw new AiError(403, 'Chỉ quản trị mới duyệt được.');
  if (r.status !== 'pending') throw new AiError(409, 'Yêu cầu này đã được xử lý.');
  await deps.pool.query("update ai_requests set status='rejected', decided_by=$2, decided_at=now(), reason=$3 where id=$1",
    [id, deps.actorName(w), String(reason || '').slice(0, 300)]);
  return { ok: true };
}

module.exports = { AiError, account, listFamilies, searchPeople, getPerson, getRelatives, getTimeline, getBookLink,
  proposeChanges, applyChanges, requestAdminAction, approveRequest, rejectRequest, ROLES, isPersonId };
