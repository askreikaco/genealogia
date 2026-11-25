// "Same person" links between two family trees: propose, accept / reject, remove, list, and a person search in the
// other tree for the link sheet. Rules in links-rules.js. Mounted by server.js. History rows go on both persons.
'use strict';
const L = require('./links-rules');
const CR = require('./claim-rules');

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const yearOf = (v) => { const m = /(\d{4})/.exec(String(v || '')); return m ? m[1] : ''; };

function mount(app, d) {
  const { pool, who, famOf, findFamily, canRead, H, HttpError, readSession } = d;
  const personRow = async (q, id) => (await q.query('select id, family_id, deleted, data from persons where id=$1', [id])).rows[0] || null;
  const famLabel = (f) => f.short_name || f.name;
  const hist = (q, personId, label, oldV, newV, by) => q.query(
    "insert into history (person_id, field, old_value, new_value, by_user) values ($1,'lien_ket',$2,$3,$4)",
    [personId, oldV ? JSON.stringify(label) : null, newV ? JSON.stringify(label) : null, by]);
  const actor = (w) => w.editor || w.email || w.name || 'khách';

  // Propose a link from a person in family fA (viewer wA) to a person in another family. Also used by the match
  // suggestions (match-routes.js), so a suggested link follows exactly the same checks and statuses.
  async function propose(req, fA, wA, b) {
    if (!['owner', 'admin', 'editor'].includes(wA.role)) throw new HttpError(wA.email || wA.code ? 403 : 401, 'Cần quyền biên tập ở cây này.');
    b = b || {};
    if (!L.isPid(b.person) || !L.isPid(b.other_person)) throw new HttpError(400, 'Thiếu người cần liên kết.');
    const fB = await findFamily(b.other_family); if (!fB) throw new HttpError(404, 'Không tìm thấy cây kia.');
    const wB = await who(req, fB.id);
    if (!canRead(fB, wB)) throw new HttpError(403, 'Bạn chưa xem được cây kia.');
    const reason = String(b.reason || '').trim().slice(0, 300) || null;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const pa = await personRow(client, b.person); const pb = await personRow(client, b.other_person);
      if (pa && pa.family_id !== fA.id) throw new HttpError(404, 'Không tìm thấy người ở cây này.');
      if (pb && pb.family_id !== fB.id) throw new HttpError(404, 'Không tìm thấy người ở cây kia.');
      const err = L.validateLink(pa, pb); if (err) throw new HttpError(400, err);
      const dupe = await client.query(
        `select id, status from person_links where status <> 'rejected' and (
           (a_family=$1 and a_person=$2 and b_family=$3) or (b_family=$1 and b_person=$2 and a_family=$3)
           or (a_family=$3 and a_person=$4 and b_family=$1) or (b_family=$3 and b_person=$4 and a_family=$1))`, [fA.id, pa.id, fB.id, pb.id]);
      if (dupe.rowCount) throw new HttpError(409, dupe.rows[0].status === 'pending' ? 'Đã có liên kết đang chờ duyệt.' : 'Người này đã liên kết với cây kia.');
      // An editor code is admin in every tree (server.js whoFor): its rights count in the tree the request is made in only.
      const status = L.statusFor(wA.role, wB.code ? 'editor' : wB.role);
      const by = actor(wA);
      const ins = await client.query(
        `insert into person_links (a_family, a_person, b_family, b_person, status, reason, proposed_by, accepted_by, decided_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,
        [fA.id, pa.id, fB.id, pb.id, status, reason, by, status === 'accepted' ? by : null, status === 'accepted' ? new Date() : null]);
      if (!ins.rowCount) throw new HttpError(409, 'Liên kết này đã có (hoặc đã bị từ chối: gỡ rồi đề xuất lại).');
      if (status === 'accepted') {
        await hist(client, pa.id, `Cùng một người với ${pb.data.name || ''} (${famLabel(fB)})`, null, true, by);
        await hist(client, pb.id, `Cùng một người với ${pa.data.name || ''} (${famLabel(fA)})`, null, true, by);
      }
      await client.query('commit');
      return { id: ins.rows[0].id, status };
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }
  app.post('/api/links', H(async (req, res) => {
    const fA = await famOf(req); const wA = await who(req, fA.id);
    res.json({ ok: true, ...(await propose(req, fA, wA, req.body || {})) });
  }));

  // Accept or reject a pending link: owner/admin of the receiving tree (b).
  for (const action of ['accept', 'reject']) {
    app.post(`/api/links/:id/${action}`, H(async (req, res) => {
      const id = Number(req.params.id); if (!Number.isInteger(id)) throw new HttpError(400, 'Mã liên kết không hợp lệ.');
      const client = await pool.connect();
      try {
        await client.query('begin');
        const lk = (await client.query('select * from person_links where id=$1 for update', [id])).rows[0];
        if (!lk) throw new HttpError(404, 'Không tìm thấy liên kết.');
        if (lk.status !== 'pending') throw new HttpError(409, 'Liên kết này đã được xử lý.');
        const wB = await who(req, lk.b_family);
        const appAdmin = CR.isAppAdmin(readSession(req)?.email, CR.appAdmins(process.env.GP_APP_ADMINS)); // an app admin decides any pending link (claim-rules canDecideLink)
        if (!CR.canDecideLink({ roleB: wB.role, appAdmin })) throw new HttpError(wB.email || wB.code ? 403 : 401, 'Chỉ Chủ họ hoặc Quản trị của cây nhận duyệt được.');
        const by = actor(wB); const status = action === 'accept' ? 'accepted' : 'rejected';
        await client.query('update person_links set status=$2, accepted_by=$3, decided_at=now() where id=$1', [id, status, by]);
        if (status === 'accepted') {
          const pa = await personRow(client, lk.a_person); const pb = await personRow(client, lk.b_person);
          const fA = await findFamily(lk.a_family); const fB = await findFamily(lk.b_family);
          await hist(client, lk.a_person, `Cùng một người với ${pb?.data?.name || ''} (${famLabel(fB)})`, null, true, by);
          await hist(client, lk.b_person, `Cùng một người với ${pa?.data?.name || ''} (${famLabel(fA)})`, null, true, by);
        }
        await client.query('commit');
        res.json({ ok: true, status });
      } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
    }));
  }

  // Remove a link: owner/admin of either tree.
  app.delete('/api/links/:id', H(async (req, res) => {
    const id = Number(req.params.id); if (!Number.isInteger(id)) throw new HttpError(400, 'Mã liên kết không hợp lệ.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const lk = (await client.query('select * from person_links where id=$1 for update', [id])).rows[0];
      if (!lk) throw new HttpError(404, 'Không tìm thấy liên kết.');
      const wA = await who(req, lk.a_family); const wB = await who(req, lk.b_family);
      if (!L.canRemove(wA.role, wB.role)) throw new HttpError(wA.email || wA.code ? 403 : 401, 'Chỉ Chủ họ hoặc Quản trị của một trong hai cây gỡ được.');
      const TR = require('./trash'); const wT = isTopRole(wA) ? wA : wB;
      await TR.brake((await findFamily(isTopRole(wA) ? lk.a_family : lk.b_family)) || { id: lk.a_family, slug: lk.a_family, name: lk.a_family }, wT);
      await client.query('delete from person_links where id=$1', [id]);
      const trashId = await TR.put(client, { famId: isTopRole(wA) ? lk.a_family : lk.b_family, kind: 'person_link', itemId: id, personId: isTopRole(wA) ? lk.a_person : lk.b_person, label: 'Liên kết với cây khác', rows: [lk], w: wT, by: actor(wT) });
      if (lk.status === 'accepted') {
        const by = actor(isTopRole(wA) ? wA : wB);
        await hist(client, lk.a_person, 'Liên kết với cây khác', true, null, by);
        await hist(client, lk.b_person, 'Liên kết với cây khác', true, null, by);
      }
      await client.query('commit');
      res.json({ ok: true, trash_id: trashId });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));
  const isTopRole = (w) => L.isTop(w.role);

  // Tree context (#tree ↑/↓): for an accepted link, the other person's parents in their tree (visible ones by name,
  // same rule as the person) and whether they have any parent there at all.
  async function upInfo(status, fo, wo, other) {
    if (status !== 'accepted') return {};
    const pids = new Set((await pool.query('select parent_id from parent_child where family_id = $1 and child_id = $2', [fo.id, other.person])).rows.map((x) => x.parent_id));
    for (const k of ['parent', 'other_parent']) if (other.data[k]) pids.add(other.data[k]);
    const other_parents = [];
    if (pids.size) for (const p of (await pool.query('select id, data from persons where id = any($1) and family_id = $2 and not deleted', [[...pids], fo.id])).rows) {
      if (L.canSeeOther(p.data, wo.role, canRead(fo, wo))) other_parents.push({ id: p.id, name: p.data.name || '' });
    }
    return { other_parents, other_has_parents: pids.size > 0, other_inlaw: !!other.data.spouse_of };
  }
  // Links of one tree (accepted, plus pending ones this viewer proposed or may decide). The other side's person is
  // given only when the viewer may read it there (deceased: anyone who can read that tree; living: its members).
  app.get('/api/links', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id);
    if (!canRead(f, w)) throw new HttpError(403, 'Bạn chưa xem được cây này.');
    const { rows } = await pool.query(
      `select l.*, pa.data as a_data, pb.data as b_data from person_links l
       join persons pa on pa.id = l.a_person and not pa.deleted join persons pb on pb.id = l.b_person and not pb.deleted
       where (l.a_family = $1 or l.b_family = $1) and l.status <> 'rejected' order by l.id`, [f.id]);
    const out = [];
    for (const r of rows) {
      const hereA = r.a_family === f.id;
      const other = { family: hereA ? r.b_family : r.a_family, person: hereA ? r.b_person : r.a_person, data: hereA ? r.b_data : r.a_data };
      const fo = await findFamily(other.family); if (!fo) continue;
      const wo = await who(req, fo.id);
      const decide = r.status === 'pending' && !hereA && L.canDecide(w.role);
      if (r.status === 'pending' && !decide && !['owner', 'admin', 'editor'].includes(w.role)) continue;
      if (!L.canSeeOther(other.data, wo.role, canRead(fo, wo))) continue;
      out.push({ id: r.id, status: r.status, person: hereA ? r.a_person : r.b_person, other_family: fo.id, other_label: famLabel(fo),
        other_person: other.person, other_name: other.data.name || '', other_years: [yearOf(other.data.born || other.data.birth_date), yearOf(other.data.died)].filter(Boolean).join('–'),
        reason: r.reason, proposed_by: r.proposed_by, can_decide: decide, incoming: !hereA, ...(await upInfo(r.status, fo, wo, other)) });
    }
    res.json({ items: out });
  }));

  // Person search in another tree for the link sheet: by name, accent-insensitive, at most 20 rows; only trees the
  // viewer can read, and living people of a private tree only for its members (public trees show names anyway).
  app.get('/api/links/search', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id);
    if (!canRead(f, w)) throw new HttpError(403, 'Bạn chưa xem được cây này.');
    const q = fold(req.query.q).slice(0, 60);
    if (q.length < 2) return res.json({ items: [] });
    const { rows } = await pool.query("select id, data from persons where family_id=$1 and not deleted", [f.id]);
    const items = rows.filter((r) => fold(r.data.name).includes(q) || fold(r.data.alias).includes(q)).slice(0, 20)
      .map((r) => ({ id: r.id, name: r.data.name || '', sex: r.data.sex || '', years: [yearOf(r.data.born || r.data.birth_date), yearOf(r.data.died)].filter(Boolean).join('–'), gen: r.data.gen || null }));
    res.json({ items });
  }));
  return { propose };
}

module.exports = { mount };
