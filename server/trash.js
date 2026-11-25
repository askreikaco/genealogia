// Thùng rác: layered safe delete (owner 2026-11-24, "historical data is precious"; MyHeritage / FamilySearch / WikiTree
// style safeguards). Migration 024.
// 1) the app shows an undo toast for 10 s after a delete (POST /api/trash/:id/restore);
// 2) every delete keeps the removed rows in `trash` for GP_TRASH_DAYS days (default 30); anyone who could delete the item
//    restores it, and a person comes back with the relations it had;
// 3) after that the item moves to the archive automatically; owners/admins restore from there. The archive keeps historical
//    data forever. Only events, stories and persons of a LIVING person (see LIVING_SQL) are purged from it, GP_ARCHIVE_LIVING_DAYS (365) days
//    after archiving, and only with GP_TRASH_PURGE=1 (otherwise the sweep logs what it would do). "Xóa vĩnh viễn ngay" =
//    owner + typed name;
// 4) a person delete needs a reason, shows its impact first and never cascades (relations stay in place and are saved);
//    a person with descendants or GP_DELETE_APPROVAL_RELS (4) relations needs a second owner/admin; a family with one
//    owner/admin waits 24 h instead (cancelable);
// 5) brake: more than GP_DELETE_LIMIT_HOUR (10) deletes an hour per account are refused, audited and owners told;
// 6) history rows (field 'thung_rac') for every delete / restore / archive / purge; followers of the person and the
//    family's owners/admins get a notice (mail when set up, an in-app badge always).
// 7) warnings 30 and 7 days before a living person's item is purged from the archive, to the deleter and the family's
//    owners/admins: an in-app notice always, a mail when mail is set up. Each is sent once (warned_30 / warned_7), also in
//    dry run (warnDue).
'use strict';
const { SYSTEM_MEMBER_SQL } = require('./system-accounts');
const TRASH_DAYS = Math.max(1, Number(process.env.GP_TRASH_DAYS) || 30);
const ARCHIVE_LIVING_DAYS = Math.max(1, Number(process.env.GP_ARCHIVE_LIVING_DAYS) || 365); const DELAY_H = 24;
// Living (purgeable) only when the person has no death field (died, death_lunar, gio_lunar, living 'dead') AND either the
// stored living is 'living', or the birth year is less than 110 years ago. Everyone else (undated, unknown living, old
// births) is kept in the archive forever. Only person, event and story items of such a person are purged.
const LIVING_SQL = `(t.kind in ('person','event','story') and exists (select 1 from persons p where p.id = (case when t.kind = 'person' then t.item_id else t.person_id end) and coalesce(
  not (coalesce(p.data->>'living','') = 'dead' or coalesce(p.data->>'died','') <> '' or coalesce(p.data->>'death_lunar','') <> '' or coalesce(p.data->>'gio_lunar','') <> '')
  and (p.data->>'living' = 'living' or coalesce(substring(coalesce(nullif(p.data->>'born',''), p.data->>'birth_date', '') from '[0-9]{4}')::int > extract(year from now())::int - 110, false)), false)))`;
const limitHour = () => Math.max(1, Number(process.env.GP_DELETE_LIMIT_HOUR) || 10);
const approvalRels = () => Math.max(1, Number(process.env.GP_DELETE_APPROVAL_RELS) || 4);
const TABLE = { event: 'events', story: 'stories', parent_child: 'parent_child', couple: 'couple', place_link: 'person_places', person_link: 'person_links' };
const KIND_VI = { person: 'Người', event: 'Sự kiện', story: 'Câu chuyện', parent_child: 'Quan hệ cha mẹ – con', couple: 'Quan hệ vợ chồng', place_link: 'Gắn địa danh', person_link: 'Liên kết với cây khác' };
// who may restore from the trash: the role that could delete it
const RESTORE_ROLE = { person: 'editor', event: 'editor', story: 'editor', parent_child: 'editor', couple: 'editor', place_link: 'editor', person_link: 'admin' };

let D = null; // { pool, mail, T, HttpError, ROLE_RANK, mirrorLegacy, isTable, publicUrl }
function init(d) { D = d; }
const actorKey = (w) => (w.email ? w.email : w.code ? `code:${w.name || ''}` : w.device ? `device:${w.device}` : 'guest');
const nowMs = "(extract(epoch from now()) * 1000)::bigint";

async function hist(q, personId, action, detail, by) {
  if (!personId) return;
  const v = JSON.stringify({ action, ...detail });
  await q.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'thung_rac',$2,$3,$4)",
    [personId, action === 'restore' ? null : v, action === 'restore' ? v : null, by]);
}
async function audit(famId, w, action, detail) {
  await D.pool.query('insert into trash_audit (family_id, actor_key, action, detail) values ($1,$2,$3,$4)', [famId, actorKey(w), action, detail || null]);
}

// Emails to tell: the family's owners/admins and the accounts that follow the person, minus the actor.
async function recipients(famId, personId, exceptEmail) {
  const { rows } = await D.pool.query(
    `select email from members where family_id=$1 and status='active' and role in ('owner','admin') and not ${SYSTEM_MEMBER_SQL}
     union select email from user_prefs where $2::text is not null and prefs->'follows' ? $2::text`, [famId, personId || null]);
  return [...new Set(rows.map((r) => String(r.email).toLowerCase()))].filter((e) => e && e !== String(exceptEmail || '').toLowerCase());
}
async function notify(fam, { kind, personId, exceptEmail, title, paras, path = 'thung-rac', only, mailIfSet = false }) {
  const to = only || await recipients(fam.id, personId, exceptEmail);
  const url = `${D.publicUrl()}/#/${fam.slug}/${path}`;
  for (const email of to) {
    await D.pool.query('insert into notices (email, family_id, kind, body) values ($1,$2,$3,$4)', [email, fam.id, kind, title]);
    if (mailIfSet && !D.mail.configured()) continue;
    const m = D.T.trashNotice({ family: fam.name, title, paras, url });
    await D.mail.send(D.pool, { familyId: fam.id, kind: `trash_${kind}`, to: email, subject: m.subject, html: m.html, text: m.text }).catch(() => {});
  }
  return to.length;
}

// The brake: refuses once this account deleted limitHour() items in the last hour (requests count too).
async function brake(fam, w) {
  const key = actorKey(w);
  const { rows } = await D.pool.query(
    `select count(*)::int n from trash where (deleted_key=$1 and deleted_at > now() - interval '1 hour')
       or (state='pending' and requested_key=$1 and requested_at > now() - interval '1 hour')`, [key]);
  if (rows[0].n < limitHour()) return;
  await audit(fam.id, w, 'brake', { count: rows[0].n, limit: limitHour() });
  const hour = new Date().toISOString().slice(0, 13);
  const owners = (await D.pool.query("select email from members where family_id=$1 and status='active' and role='owner'", [fam.id])).rows.map((r) => r.email);
  for (const email of owners) {
    await D.pool.query('insert into notices (email, family_id, kind, body) values ($1,$2,$3,$4)', [email, fam.id, 'brake', `Đã tạm dừng việc xóa của ${w.name || w.email || 'một tài khoản'}`]);
    await D.mail.sendOnce(D.pool, `trash-brake:${fam.id}:${key}:${hour}:${email}`, () => {
      const m = D.T.deleteBrake({ family: fam.name, who: w.name || w.email || key, count: rows[0].n, limit: limitHour(), url: `${D.publicUrl()}/#/${fam.slug}/thung-rac` });
      return { familyId: fam.id, kind: 'trash_brake', to: email, subject: m.subject, html: m.html, text: m.text };
    }).catch(() => {});
  }
  throw new D.HttpError(429, `Bạn đã xóa ${rows[0].n} mục trong một giờ qua. Để giữ an toàn dữ liệu, việc xóa tạm dừng và Chủ họ đã được báo. Xin thử lại sau.`);
}

// Puts removed rows into the trash (inside the caller's transaction). Returns the trash id.
async function put(q, { famId, kind, itemId, personId = null, label = '', reason = null, rows, w, by }) {
  const { rows: r } = await q.query(
    `insert into trash (family_id, kind, item_id, person_id, label, reason, payload, state, requested_by, requested_key, deleted_by, deleted_key, deleted_at)
     values ($1,$2,$3,$4,$5,$6,$7,'trash',$8,$9,$8,$9,now()) returning id`,
    [famId, kind, String(itemId), personId, label.slice(0, 300), reason, JSON.stringify({ rows }), by, actorKey(w)]);
  await hist(q, personId, 'delete', { kind, label, reason, trash_id: Number(r[0].id) }, by);
  return Number(r[0].id);
}

// What a person delete touches: descendants (relation rows and the legacy parent fields), relations, events, stories.
async function impact(q, famId, pid) {
  const d = await q.query(
    `with recursive e(parent, child) as (
       select parent_id, child_id from parent_child where family_id=$1
       union select data->>'parent', id from persons where family_id=$1 and not deleted and coalesce(data->>'parent','') <> ''
       union select data->>'other_parent', id from persons where family_id=$1 and not deleted and coalesce(data->>'other_parent','') <> ''),
     d(id) as (select child from e where parent=$2 union select e.child from e join d on e.parent=d.id)
     select count(*)::int n from d join persons p on p.id=d.id and not p.deleted and p.id <> $2`, [famId, pid]);
  const r = await q.query(
    `select (select count(*) from parent_child where family_id=$1 and (parent_id=$2 or child_id=$2))
          + (select count(*) from couple where family_id=$1 and (a_id=$2 or b_id=$2)) as tbl,
            (select count(*) from persons where family_id=$1 and not deleted and $2 in (data->>'parent', data->>'other_parent', data->>'spouse_of')) as refs,
            (select (case when coalesce(data->>'parent','')<>'' then 1 else 0 end) + (case when coalesce(data->>'other_parent','')<>'' then 1 else 0 end)
                  + (case when coalesce(data->>'spouse_of','')<>'' then 1 else 0 end) from persons where id=$2) as own,
            (select count(*) from events where family_id=$1 and person_id=$2) as events,
            (select count(*) from stories where family_id=$1 and person_id=$2) as stories`, [famId, pid]);
  const x = r.rows[0];
  const table = await D.isTable(q, famId);
  const relations = Number(table ? x.tbl : Number(x.refs) + Number(x.own || 0));
  const out = { descendants: d.rows[0].n, relations, events: Number(x.events), stories: Number(x.stories) };
  out.needsApproval = out.descendants > 0 || out.relations >= approvalRels();
  return out;
}
const admins = async (q, famId) => (await q.query("select email from members where family_id=$1 and status='active' and role in ('owner','admin')", [famId])).rows.map((r) => r.email);

// Marks the person deleted (no cascade: relation rows stay; the ones it had are saved for restore).
async function deletePerson(q, fam, pid, { w, by, reason, trashId = null }) {
  const cur = (await q.query('select id, data, deleted from persons where id=$1 and family_id=$2 for update', [pid, fam.id])).rows[0];
  if (!cur || cur.deleted) throw new D.HttpError(409, 'Người này không còn trong dữ liệu.');
  const rels = {
    parent_child: (await q.query('select * from parent_child where family_id=$1 and (parent_id=$2 or child_id=$2)', [fam.id, pid])).rows,
    couple: (await q.query('select * from couple where family_id=$1 and (a_id=$2 or b_id=$2)', [fam.id, pid])).rows,
  };
  await q.query(`update persons set deleted=true, updated_by=$2, updated_at=now(), version=nextval('persons_version'),
    field_ts = jsonb_set(coalesce(field_ts,'{}'::jsonb), '{_deleted}', to_jsonb(${nowMs})) where id=$1`, [pid, by]);
  await q.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'_deleted','false','true',$2)", [pid, by]);
  const label = cur.data?.name || pid;
  const payload = JSON.stringify({ person: { id: pid, name: label }, rels });
  if (trashId) {
    await q.query("update trash set state='trash', payload=$2, deleted_by=$3, deleted_key=$4, deleted_at=now() where id=$1", [trashId, payload, by, actorKey(w)]);
    await hist(q, pid, 'delete', { kind: 'person', label, reason, trash_id: trashId }, by);
    return trashId;
  }
  const { rows } = await q.query(
    `insert into trash (family_id, kind, item_id, person_id, label, reason, payload, state, requested_by, requested_key, deleted_by, deleted_key, deleted_at)
     values ($1,'person',$2,$2,$3,$4,$5,'trash',$6,$7,$6,$7,now()) returning id`, [fam.id, pid, label, reason, payload, by, actorKey(w)]);
  await hist(q, pid, 'delete', { kind: 'person', label, reason, trash_id: Number(rows[0].id) }, by);
  return Number(rows[0].id);
}

async function restoreRows(q, t) {
  const p = t.payload || {};
  if (t.kind === 'person') {
    const cur = (await q.query('select deleted from persons where id=$1 for update', [t.item_id])).rows[0];
    if (!cur) throw new D.HttpError(409, 'Không còn dữ liệu của người này.');
    if (cur.deleted) {
      await q.query(`update persons set deleted=false, updated_by=$2, updated_at=now(), version=nextval('persons_version'),
        field_ts = jsonb_set(coalesce(field_ts,'{}'::jsonb), '{_deleted}', to_jsonb(${nowMs})) where id=$1`, [t.item_id, t.restored_by]);
      await q.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'_deleted','true','false',$2)", [t.item_id, t.restored_by]);
    }
    // a merged-away person (merge.js): its relations, events and the kept person's fields go back to how they were
    if (p.merge) {
      try { await require('./merge').revert(q, t.family_id, p.merge); } catch (e) {
        if (e.name === 'MergeError') throw new D.HttpError(e.status, e.message);
        throw e;
      }
    }
    // the relations it had: put back the ones removed since, when the other person is still there
    const touched = new Set([t.item_id]);
    for (const [table, list] of Object.entries(p.rels || {})) {
      for (const row of list || []) {
        const ids = table === 'parent_child' ? [row.parent_id, row.child_id] : [row.a_id, row.b_id];
        if ((await q.query(`select 1 from ${table} where id=$1`, [row.id])).rowCount) continue;
        const alive = (await q.query('select count(*)::int n from persons where id = any($1) and not deleted', [ids])).rows[0].n;
        if (alive < 2) continue;
        await q.query('savepoint rel');
        try { await q.query(`insert into ${table} select * from jsonb_populate_record(null::${table}, $1)`, [JSON.stringify(row)]); ids.forEach((x) => touched.add(x)); await q.query('release savepoint rel'); } catch { await q.query('rollback to savepoint rel'); }
      }
    }
    if (await D.isTable(q, t.family_id)) await D.mirrorLegacy(q, t.family_id, [...touched]);
    return;
  }
  const table = TABLE[t.kind];
  for (const row of p.rows || []) {
    if (t.kind === 'parent_child' || t.kind === 'couple') {
      const ids = t.kind === 'parent_child' ? [row.parent_id, row.child_id] : [row.a_id, row.b_id];
      const alive = (await q.query('select count(*)::int n from persons where id = any($1) and not deleted', [ids])).rows[0].n;
      if (alive < 2) throw new D.HttpError(409, 'Một trong hai người của quan hệ này đã bị xóa. Khôi phục người đó trước.');
    }
    await q.query('savepoint r');
    try { await q.query(`insert into ${table} select * from jsonb_populate_record(null::${table}, $1)`, [JSON.stringify(row)]); await q.query('release savepoint r'); } catch (e) {
      await q.query('rollback to savepoint r');
      if (e.code === '23505') throw new D.HttpError(409, 'Không khôi phục được: đã có một mục trùng (có thể đã được thêm lại).');
      throw e;
    }
    if ((t.kind === 'parent_child' || t.kind === 'couple') && await D.isTable(q, t.family_id)) await D.mirrorLegacy(q, t.family_id, t.kind === 'parent_child' ? [row.parent_id, row.child_id] : [row.a_id, row.b_id]);
  }
}

// Runs pending person deletes whose 24 h delay is over (one-admin families).
async function runDue() {
  const { rows } = await D.pool.query("select t.*, f.slug, f.name as fam_name from trash t join families f on f.id=t.family_id where t.state='pending' and t.due_at is not null and t.due_at <= now()");
  let n = 0;
  for (const t of rows) {
    const c = await D.pool.connect();
    try {
      await c.query('begin');
      const fam = { id: t.family_id, slug: t.slug, name: t.fam_name };
      await deletePerson(c, fam, t.item_id, { w: { email: t.requested_key }, by: `${t.requested_by} (sau 24 giờ)`, reason: t.reason, trashId: t.id });
      await c.query("update trash set decided_by='Tự động sau 24 giờ', decided_at=now() where id=$1", [t.id]);
      await c.query('commit'); n++;
      notify(fam, { kind: 'person_deleted', personId: t.item_id, title: `${t.label} đã được chuyển vào Thùng rác`, paras: [`Lý do: ${t.reason}`, `Có thể khôi phục trong ${TRASH_DAYS} ngày.`] }).catch(() => {});
    } catch (e) {
      await c.query('rollback').catch(() => {});
      await D.pool.query("update trash set state='cancelled', decided_by=$2, decided_at=now() where id=$1", [t.id, `Không chạy được: ${String(e.message).slice(0, 120)}`]);
    } finally { c.release(); }
  }
  return n;
}

// Warnings before a living person's item is purged from the archive: 30 and 7 days before (ARCHIVE_LIVING_DAYS). Each
// stage is claimed (warned_N set in the same update) before the send, so a re-run never sends it again. The 7-day stage
// also marks the 30-day one, so a late sweep sends one warning, not two. Runs in dry run too: it changes no item's state.
async function warnRecipients(famId, deletedKey) {
  const { rows } = await D.pool.query(`select email from members where family_id=$1 and status='active' and role in ('owner','admin') and not ${SYSTEM_MEMBER_SQL}`, [famId]);
  const all = rows.map((r) => r.email);
  if (String(deletedKey || '').includes('@')) all.push(deletedKey);
  return [...new Set(all.map((e) => String(e).toLowerCase()))];
}
async function warnDue() {
  const sent = {};
  for (const stage of [7, 30]) {
    const n = Math.min(stage, ARCHIVE_LIVING_DAYS);
    const { rows } = await D.pool.query(
      `select t.*, f.slug, f.name as fam_name from trash t join families f on f.id=t.family_id
       where t.state='archive' and t.archived_at is not null and t.warned_${stage} is null and ${LIVING_SQL}
         and t.archived_at <= now() - (($1::int) * interval '1 day')`, [ARCHIVE_LIVING_DAYS - n]);
    sent[stage] = 0;
    for (const t of rows) {
      const claim = await D.pool.query(
        `update trash set warned_${stage}=now()${stage === 7 ? ', warned_30=coalesce(warned_30, now())' : ''}
         where id=$1 and warned_${stage} is null returning id`, [t.id]);
      if (!claim.rows.length) continue;
      const fam = { id: t.family_id, slug: t.slug, name: t.fam_name };
      await notify(fam, { kind: `warn_${stage}`, only: await warnRecipients(t.family_id, t.deleted_key), mailIfSet: true,
        title: `Mục '${t.label}' sẽ bị xóa vĩnh viễn khỏi lưu trữ sau ${n} ngày.`, paras: [`Khôi phục (Chủ họ, Quản trị): ${D.publicUrl()}/#/${fam.slug}/thung-rac`] })
        .catch((e) => console.error('trash warning failed:', e.message));
      sent[stage]++;
    }
  }
  return sent;
}

// Hourly sweep: due requests, the warnings, then trash -> archive after TRASH_DAYS, and the purge of living people's items
// from the archive after ARCHIVE_LIVING_DAYS. Only GP_TRASH_PURGE=1 moves or purges; otherwise it logs the counts (dry run).
// Returns { due, warned, archive, purge, applied }.
async function sweep({ apply = process.env.GP_TRASH_PURGE === '1', log = console.log } = {}) {
  const due = await runDue();
  const warned = await warnDue();
  const a = (await D.pool.query(`select count(*)::int n from trash where state='trash' and deleted_at < now() - interval '${TRASH_DAYS} days'`)).rows[0].n;
  const p = (await D.pool.query(`select count(*)::int n from trash t where t.state='archive' and t.archived_at < now() - interval '${ARCHIVE_LIVING_DAYS} days' and ${LIVING_SQL}`)).rows[0].n;
  if (apply) {
    await D.pool.query(`update trash set state='archive', archived_by='Tự động sau ${TRASH_DAYS} ngày', archived_at=now() where state='trash' and deleted_at < now() - interval '${TRASH_DAYS} days'`);
    await D.pool.query(`update trash t set state='purged', payload=null, purged_by='Tự động sau ${ARCHIVE_LIVING_DAYS} ngày lưu trữ (người còn sống)', purged_at=now()
      where t.state='archive' and t.archived_at < now() - interval '${ARCHIVE_LIVING_DAYS} days' and ${LIVING_SQL}`);
    await D.pool.query("insert into trash_audit (family_id, actor_key, action, detail) values (null,'sweep','sweep',$1)", [{ archive: a, purge: p, warned }]);
  }
  log(`trash sweep${apply ? '' : ' (dry run, GP_TRASH_PURGE not set)'}: ${due} due deletes run, ${a} ${apply ? 'moved' : 'would move'} to archive, warned ${warned[30]} at 30 days and ${warned[7]} at 7 days before purge, ${p} living ${apply ? 'purged' : 'would be purged'}`);
  return { due, warned, archive: a, purge: p, applied: apply };
}

const out = (t, w) => ({
  id: Number(t.id), kind: t.kind, kind_vi: KIND_VI[t.kind], item_id: t.item_id, person_id: t.person_id, label: t.label, reason: t.reason, state: t.state,
  impact: t.impact, deleted_by: t.deleted_by, deleted_at: t.deleted_at, requested_by: t.requested_by, requested_at: t.requested_at, due_at: t.due_at,
  archived_at: t.archived_at, mine: t.requested_key === actorKey(w),
  days_left: t.state === 'trash' && t.deleted_at ? Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(t.deleted_at)) / 864e5))
    : t.state === 'archive' && t.archived_at && t.living ? Math.max(0, ARCHIVE_LIVING_DAYS - Math.floor((Date.now() - new Date(t.archived_at)) / 864e5)) : null,
});

function mount(app, d) {
  init({ ...D, ...d });
  const { pool, who, famOf, H, HttpError, ROLE_RANK, actorName } = d;
  const role = async (req, min) => {
    const f = await famOf(req); const w = await who(req, f.id);
    if (ROLE_RANK[w.role] >= ROLE_RANK[min]) return { f, w };
    throw new HttpError(w.email || w.code ? 403 : 401, w.email || w.code ? 'Tài khoản này chưa có quyền cho việc này.' : 'Cần đăng nhập.');
  };
  const tx = async (fn) => {
    const c = await pool.connect();
    try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  };
  const row = async (q, f, id, lock = true) => {
    const t = (await q.query(`select * from trash where id=$1 and family_id=$2${lock ? ' for update' : ''}`, [Number(id) || 0, f.id])).rows[0];
    if (!t) throw new HttpError(404, 'Không tìm thấy mục này trong Thùng rác.');
    return t;
  };

  app.get('/api/trash', H(async (req, res) => {
    const { f, w } = await role(req, 'editor');
    await runDue().catch(() => {});
    const top = ROLE_RANK[w.role] >= ROLE_RANK.admin;
    const { rows } = await pool.query(`select t.*, ${LIVING_SQL} as living from trash t where t.family_id=$1 and state in (${top ? "'pending','trash','archive'" : "'pending','trash'"})
      order by coalesce(deleted_at, requested_at) desc limit 500`, [f.id]);
    res.json({ items: rows.map((t) => out(t, w)), can_archive: top, can_purge: w.role === 'owner', days: { trash: TRASH_DAYS } });
  }));
  app.get('/api/trash/count', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id);
    if (ROLE_RANK[w.role] < ROLE_RANK.editor) return res.json({ pending: 0, unread: 0 });
    const p = (await pool.query("select count(*)::int n from trash where family_id=$1 and state='pending'", [f.id])).rows[0].n;
    const u = w.email ? (await pool.query('select count(*)::int n from notices where email=$1 and family_id=$2 and read_at is null', [w.email, f.id])).rows[0].n : 0;
    res.json({ pending: p, unread: u });
  }));
  app.post('/api/trash/seen', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id);
    if (w.email) await pool.query('update notices set read_at=now() where email=$1 and family_id=$2 and read_at is null', [w.email, f.id]);
    res.json({ ok: true });
  }));

  app.get('/api/persons/:id/impact', H(async (req, res) => {
    const { f, w } = await role(req, 'editor');
    const p = (await pool.query('select id, data from persons where id=$1 and family_id=$2 and not deleted', [req.params.id, f.id])).rows[0];
    if (!p) throw new HttpError(404, 'Không tìm thấy người này.');
    const im = await impact(pool, f.id, p.id);
    const others = (await admins(pool, f.id)).filter((e) => e !== w.email);
    res.json({ ...im, trash_days: TRASH_DAYS, name: p.data?.name || p.id, approvers: others.length, delay_hours: im.needsApproval && !others.length ? DELAY_H : 0 });
  }));

  // Person delete: reason required; impact decides between now and a request (second owner/admin, or 24 h delay).
  app.post('/api/persons/:id/delete', H(async (req, res) => {
    throw new HttpError(409, 'Gỡ người này bằng "Gỡ khỏi gia phả": chọn nhập nhầm, ẩn, trùng, hoặc đề nghị Biểu quyết.');
    const { f, w } = await role(req, 'editor');
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (reason.length < 3) throw new HttpError(400, 'Cần ghi lý do xóa.');
    await brake(f, w);
    const by = actorName(w);
    const r = await tx(async (c) => {
      const p = (await c.query('select id, data from persons where id=$1 and family_id=$2 and not deleted for update', [req.params.id, f.id])).rows[0];
      if (!p) throw new HttpError(404, 'Không tìm thấy người này.');
      if ((await c.query("select 1 from trash where kind='person' and item_id=$1 and state='pending'", [p.id])).rowCount) throw new HttpError(409, 'Đã có yêu cầu xóa người này đang chờ duyệt.');
      const im = await impact(c, f.id, p.id);
      if (im.needsApproval) {
        const others = (await admins(c, f.id)).filter((e) => e !== w.email);
        const { rows } = await c.query(
          `insert into trash (family_id, kind, item_id, person_id, label, reason, state, impact, requested_by, requested_key, due_at)
           values ($1,'person',$2,$2,$3,$4,'pending',$5,$6,$7, case when $8::boolean then now() + interval '${DELAY_H} hours' else null end) returning *`,
          [f.id, p.id, p.data?.name || p.id, reason, im, by, actorKey(w), !others.length]);
        await hist(c, p.id, 'request', { kind: 'person', label: p.data?.name || p.id, reason }, by);
        return { pending: true, trash: rows[0], others, im, name: p.data?.name || p.id };
      }
      const id = await deletePerson(c, f, p.id, { w, by, reason });
      return { pending: false, id, im, name: p.data?.name || p.id };
    });
    if (r.pending) {
      await audit(f.id, w, 'request', { person: req.params.id, trash: Number(r.trash.id) });
      notify(f, { kind: 'delete_request', personId: req.params.id, exceptEmail: w.email, only: r.others.length ? r.others : undefined, path: 'thung-rac',
        title: `${by} đề nghị xóa ${r.name}`, paras: [`Lý do: ${reason}`, `Ảnh hưởng: ${r.im.descendants} con cháu, ${r.im.relations} quan hệ, ${r.im.events} sự kiện.`,
          r.others.length ? 'Cần một Chủ họ hoặc Quản trị khác duyệt.' : `Dòng họ chỉ có một người quản trị: việc xóa sẽ chạy sau ${DELAY_H} giờ nếu không hủy.`] }).catch(() => {});
      return res.json({ ok: true, pending: true, trash_id: Number(r.trash.id), due_at: r.trash.due_at, needs: r.others.length ? 'approval' : 'delay' });
    }
    notify(f, { kind: 'person_deleted', personId: req.params.id, exceptEmail: w.email, title: `${r.name} đã được chuyển vào Thùng rác`, paras: [`Người xóa: ${by}`, `Lý do: ${reason}`, `Có thể khôi phục trong ${TRASH_DAYS} ngày.`] }).catch(() => {});
    res.json({ ok: true, pending: false, trash_id: r.id });
  }));

  const top = (w) => ROLE_RANK[w.role] >= ROLE_RANK.admin;
  app.post('/api/trash/:id/approve', H(async (req, res) => {
    const { f, w } = await role(req, 'admin');
    const t = await tx(async (c) => {
      const t = await row(c, f, req.params.id);
      if (t.state !== 'pending') throw new HttpError(409, 'Yêu cầu này không còn chờ duyệt.');
      if (t.requested_key === actorKey(w)) throw new HttpError(403, 'Người đề nghị không tự duyệt được. Cần một Chủ họ hoặc Quản trị khác.');
      await deletePerson(c, f, t.item_id, { w: { email: t.requested_key }, by: t.requested_by, reason: t.reason, trashId: t.id });
      await c.query('update trash set decided_by=$2, decided_at=now() where id=$1', [t.id, actorName(w)]);
      await hist(c, t.person_id, 'approve', { kind: t.kind, label: t.label }, actorName(w));
      return t;
    });
    notify(f, { kind: 'person_deleted', personId: t.item_id, exceptEmail: w.email, title: `${t.label} đã được chuyển vào Thùng rác`, paras: [`Đề nghị: ${t.requested_by}. Duyệt: ${actorName(w)}.`, `Lý do: ${t.reason}`] }).catch(() => {});
    res.json({ ok: true, trash_id: Number(t.id) });
  }));
  app.post('/api/trash/:id/reject', H(async (req, res) => {
    const { f, w } = await role(req, 'admin');
    await tx(async (c) => {
      const t = await row(c, f, req.params.id);
      if (t.state !== 'pending') throw new HttpError(409, 'Yêu cầu này không còn chờ duyệt.');
      await c.query("update trash set state='rejected', decided_by=$2, decided_at=now() where id=$1", [t.id, actorName(w)]);
      await hist(c, t.person_id, 'reject', { kind: t.kind, label: t.label }, actorName(w));
    });
    res.json({ ok: true });
  }));
  app.post('/api/trash/:id/cancel', H(async (req, res) => {
    const { f, w } = await role(req, 'editor');
    await tx(async (c) => {
      const t = await row(c, f, req.params.id);
      if (t.state !== 'pending') throw new HttpError(409, 'Yêu cầu này không còn chờ duyệt.');
      if (t.requested_key !== actorKey(w) && !top(w)) throw new HttpError(403, 'Chỉ người đề nghị, Chủ họ hoặc Quản trị hủy được.');
      await c.query("update trash set state='cancelled', decided_by=$2, decided_at=now() where id=$1", [t.id, actorName(w)]);
      await hist(c, t.person_id, 'cancel', { kind: t.kind, label: t.label }, actorName(w));
    });
    res.json({ ok: true });
  }));

  app.post('/api/trash/:id/restore', H(async (req, res) => {
    const { f, w } = await role(req, 'editor');
    const t = await tx(async (c) => {
      const t = await row(c, f, req.params.id);
      if (t.payload?.council && !top(w)) throw new HttpError(403, 'Người này được Biểu quyết gỡ: chỉ Chủ họ hoặc Quản trị khôi phục được.');
      if (t.state === 'archive' && !top(w)) throw new HttpError(403, 'Mục trong lưu trữ: chỉ Chủ họ hoặc Quản trị khôi phục được.');
      if (!['trash', 'archive'].includes(t.state)) throw new HttpError(409, t.state === 'restored' ? 'Mục này đã được khôi phục.' : 'Mục này không còn khôi phục được.');
      if (ROLE_RANK[w.role] < ROLE_RANK[RESTORE_ROLE[t.kind]]) throw new HttpError(403, 'Tài khoản này chưa có quyền khôi phục mục này.');
      t.restored_by = actorName(w);
      await restoreRows(c, t);
      await c.query("update trash set state='restored', restored_by=$2, restored_at=now() where id=$1", [t.id, actorName(w)]);
      await hist(c, t.person_id, 'restore', { kind: t.kind, label: t.label }, actorName(w));
      return t;
    });
    if (t.kind === 'person') notify(f, { kind: 'person_restored', personId: t.item_id, exceptEmail: w.email, path: `person/${t.item_id}`, title: `${t.label} đã được khôi phục`, paras: [`Người khôi phục: ${actorName(w)}`] }).catch(() => {});
    d.onWrite?.();
    res.json({ ok: true, kind: t.kind, item_id: t.item_id, person_id: t.person_id });
  }));
  // Dọn: trash -> archive (one item, or all with id "all")
  app.post('/api/trash/:id/archive', H(async (req, res) => {
    const { f, w } = await role(req, 'admin');
    const ids = await tx(async (c) => {
      const list = req.params.id === 'all' ? (await c.query("select * from trash where family_id=$1 and state='trash' for update", [f.id])).rows : [await row(c, f, req.params.id)];
      for (const t of list) {
        if (t.state !== 'trash') throw new HttpError(409, 'Mục này không còn trong Thùng rác.');
        await c.query("update trash set state='archive', archived_by=$2, archived_at=now() where id=$1", [t.id, actorName(w)]);
        await hist(c, t.person_id, 'archive', { kind: t.kind, label: t.label }, actorName(w));
      }
      return list.map((t) => Number(t.id));
    });
    await audit(f.id, w, 'archive', { ids });
    res.json({ ok: true, archived: ids.length });
  }));
  // Xóa vĩnh viễn ngay: owner only, typed name (re-auth when the account step is live).
  app.post('/api/trash/:id/purge', H(async (req, res) => {
    const { f, w } = await role(req, 'owner');
    if (!w.email) throw new HttpError(403, 'Cần đăng nhập bằng tài khoản Chủ họ.');
    await tx(async (c) => {
      const t = await row(c, f, req.params.id);
      if (!['trash', 'archive'].includes(t.state)) throw new HttpError(409, 'Mục này không còn trong Thùng rác hay lưu trữ.');
      const norm = (s) => String(s || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
      if (norm(req.body?.confirm) !== norm(t.label)) throw new HttpError(400, `Gõ đúng “${t.label}” để xác nhận.`);
      await c.query("update trash set state='purged', payload=null, purged_by=$2, purged_at=now() where id=$1", [t.id, actorName(w)]);
      await hist(c, t.person_id, 'purge', { kind: t.kind, label: t.label }, actorName(w));
    });
    await audit(f.id, w, 'purge', { id: Number(req.params.id) });
    res.json({ ok: true });
  }));
}

module.exports = { init, mount, put, brake, impact, deletePerson, restoreRows, sweep, warnDue, runDue, actorKey, KIND_VI, TRASH_DAYS, ARCHIVE_LIVING_DAYS, limitHour };
