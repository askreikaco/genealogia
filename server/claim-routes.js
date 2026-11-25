// Nhận quản lý: a signed-in person asks to manage a tree with no active owner (or only inactive or deceased owners).
// The public 30-day notice runs first; then an app admin (GP_APP_ADMINS) approves or rejects. Approval makes the
// claimant an owner and writes family_history (field 'quan_ly'). Rules in claim-rules.js. Mounted by server.js.
// Also: the app-admin review screen reads pending join links (person_links) so an app admin can decide them.
'use strict';
const CR = require('./claim-rules');

function mount(app, d) {
  const { pool, who, famOf, canRead, H, HttpError, readSession, mail, T, publicUrl } = d;
  const admins = () => CR.appAdmins(process.env.GP_APP_ADMINS);
  const emailOf = (req) => CR.norm(readSession(req)?.email) || null;
  const requireAdmin = (req) => {
    const e = emailOf(req);
    if (!CR.isAppAdmin(e, admins())) throw new HttpError(e ? 403 : 401, e ? 'Chỉ quản trị ứng dụng mới xem được.' : 'Cần đăng nhập.');
    return e;
  };
  const nameOf = (data) => (data && data.name) || '';

  // Active owners of a tree with their death / activity facts, then the tree state (claim-rules.treeState).
  async function ownersOf(q, famId) {
    const { rows } = await q.query(`select m.email, m.last_seen_at, m.approved_at, m.created_at, p.data as person_data
      from members m left join persons p on p.id = m.person_id and p.family_id = m.family_id
      where m.family_id = $1 and m.role = 'owner' and m.status = 'active'`, [famId]);
    const dead = new Set((await q.query('select email from council_deceased where family_id = $1', [famId])).rows.map((r) => CR.norm(r.email)));
    return rows.map((r) => CR.ownerFacts({ person_data: r.person_data, deceased_email: dead.has(CR.norm(r.email)) ? r.email : null,
      email: CR.norm(r.email), last_seen_at: r.last_seen_at, approved_at: r.approved_at, created_at: r.created_at }));
  }
  async function stateOf(q, famId, nowMs = Date.now()) {
    return CR.treeState(await ownersOf(q, famId), nowMs);
  }
  const histRow = (q, famId, field, oldV, newV, by) => q.query(
    'insert into family_history (family_id, field, old_value, new_value, by_user) values ($1,$2,$3,$4,$5)', [famId, field, oldV, newV, by]);
  const ownerEmails = async (q, famId) => (await ownersOf(q, famId)).map((o) => o.email).filter((e) => !CR.isSystemEmail(e));

  // The state of one tree for anyone who can read it: its state, whether this viewer may claim, and the notice.
  app.get('/api/claims', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id);
    if (!canRead(f, w)) throw new HttpError(403, 'Bạn chưa xem được cây này.');
    const nowMs = Date.now();
    const st = await stateOf(pool, f.id, nowMs);
    const open = (await pool.query(`select status, abandoned, claimant_email, (extract(epoch from notice_until) * 1000)::float8 as notice_until
      from tree_claims where family_id = $1 and status = 'notice' and notice_until > now()`, [f.id])).rows
      .map((r) => ({ ...r, notice_until: Number(r.notice_until) }));
    const mine = emailOf(req) ? (await pool.query(`select id, (extract(epoch from notice_until) * 1000)::float8 as until from tree_claims
      where family_id = $1 and claimant_email = $2 and status = 'notice'`, [f.id, emailOf(req)])).rows[0] : null;
    const block = CR.claimBlock({ state: st.state, signedIn: !!emailOf(req) && !w.code, isOwner: w.role === 'owner', hasOpen: !!mine });
    const notice = CR.publicNotice(open, nowMs);
    res.json({ state: st.state, owners: st.owners, can_claim: !block, block, notice,
      my_claim: mine ? { id: Number(mine.id), notice_until: Number(mine.until) } : null, days: CR.NOTICE_MS / CR.DAY });
  }));

  // Open a claim (one path for both entries: POST /api/claims and the routed POST /api/families/:ref/claim).
  // Evidence: text and/or one small file. Refused while a handover or another open claim is on the family.
  async function openTreeClaim(f, w, email, { evidence = '', file = null, name = '' } = {}) {
    const bad = CR.evidenceBlock({ evidence, file });
    if (bad) throw new HttpError(400, bad);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from families where id = $1 for update', [f.id]);
      const nowMs = Date.now();
      const st = await stateOf(client, f.id, nowMs);
      const hasOpen = (await client.query("select 1 from tree_claims where family_id = $1 and claimant_email = $2 and status = 'notice'", [f.id, email || ''])).rowCount > 0;
      const openHandover = (await client.query("select 1 from handover_requests where family_id = $1 and status = 'open'", [f.id])).rowCount > 0;
      const openClaim = (await client.query("select 1 from tree_claims where family_id = $1 and status = 'notice' and notice_until > now()", [f.id])).rowCount > 0;
      const r = CR.routeClaim({ state: st.state, signedIn: !!email && !w.code, isOwner: w.role === 'owner', hasOpen, openHandover, openClaim });
      if (r.block) throw new HttpError(409, r.block);
      if (r.path !== 'claim') throw new HttpError(409, 'Dòng họ này có Chủ họ đang quản lý: việc nhận quyền đi theo quy trình chuyển quyền.');
      const who = (name || w.name || email || '').slice(0, 120);
      const ins = await client.query(`insert into tree_claims (family_id, claimant_email, claimant_name, evidence, abandoned, notice_until)
        values ($1,$2,$3,$4,$5, now() + interval '30 days') returning id, (extract(epoch from notice_until) * 1000)::float8 as until`,
        [f.id, email, who, String(evidence || '').trim(), st.state === 'abandoned']);
      const id = Number(ins.rows[0].id); const until = Number(ins.rows[0].until);
      if (file) await client.query('insert into tree_claim_files (claim_id, name, mime, size, data) values ($1,$2,$3,$4,$5)', [id, file.name, file.type, file.bytes, file.buf]);
      await histRow(client, f.id, 'quan_ly', null, `mở đơn: ${who}${st.state === 'abandoned' ? ' (cây bỏ trống)' : ''}`, email);
      await client.query('commit');
      if (st.state === 'abandoned') {
        const owners = await ownerEmails(pool, f.id);
        const m = T.treeClaimOpened({ family: f.name, claimant: who, abandoned: true, until, url: `${publicUrl()}/#/${f.slug}/tree` });
        for (const o of owners) {
          await pool.query('insert into notices (email, family_id, kind, body) values ($1,$2,$3,$4)', [o, f.id, 'claim', m.subject]);
          await mail.send(pool, { familyId: f.id, kind: 'tree_claim', to: o, subject: m.subject, html: m.html, text: m.text }).catch(() => {});
        }
      }
      return { ok: true, id, notice_until: until, abandoned: st.state === 'abandoned' };
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }
  app.post('/api/claims', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id);
    const email = emailOf(req);
    const b = req.body || {};
    let file = null;
    if (b.file && typeof b.file === 'object') {
      const buf = Buffer.from(String(b.file.data || ''), 'base64');
      file = { name: String(b.file.name || 'tep').slice(0, 120), type: String(b.file.type || ''), bytes: buf.length, buf };
    }
    const evidence = String(b.evidence || '').slice(0, CR.MAX_EVIDENCE + 1);
    res.json(await openTreeClaim(f, w, email, { evidence, file, name: readSession(req)?.name || '' }));
  }));

  // The claimant withdraws an open claim.
  app.post('/api/claims/:id/withdraw', H(async (req, res) => {
    const id = Number(req.params.id); if (!Number.isInteger(id)) throw new HttpError(400, 'Mã đơn không hợp lệ.');
    const email = emailOf(req);
    if (!email) throw new HttpError(401, 'Cần đăng nhập.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const c = (await client.query('select * from tree_claims where id = $1 for update', [id])).rows[0];
      if (!c) throw new HttpError(404, 'Không tìm thấy đơn.');
      const bad = CR.withdrawBlock({ claim: c, email }); if (bad) throw new HttpError(409, bad);
      await client.query("update tree_claims set status = 'withdrawn', decided_at = now(), decided_by = $2 where id = $1", [id, email]);
      await client.query('commit');
      res.json({ ok: true });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));

  // ---- app admin: review screen ----
  app.get('/api/app/claims', H(async (req, res) => {
    requireAdmin(req);
    const nowMs = Date.now();
    const rows = (await pool.query(`select c.id, c.family_id, f.name as family_name, f.slug, c.claimant_email, c.claimant_name, c.evidence,
        c.abandoned, c.status, c.decided_at, c.decision_note, (extract(epoch from c.created_at) * 1000)::float8 as created_ms,
        (extract(epoch from c.notice_until) * 1000)::float8 as until, fl.name as file_name, fl.mime as file_mime, fl.size as file_size
      from tree_claims c join families f on f.id = c.family_id left join tree_claim_files fl on fl.claim_id = c.id
      where c.status = 'notice' or c.decided_at > now() - interval '30 days'
      order by (c.status = 'notice') desc, c.created_at desc limit 200`)).rows;
    const states = new Map();
    for (const r of rows) if (!states.has(r.family_id)) states.set(r.family_id, (await stateOf(pool, r.family_id, nowMs)).state);
    const claims = rows.map((r) => ({ id: Number(r.id), family_id: r.family_id, family_name: r.family_name, slug: r.slug,
      claimant_email: r.claimant_email, claimant_name: r.claimant_name, evidence: r.evidence, abandoned: r.abandoned, status: r.status,
      tree_state: states.get(r.family_id), created_ms: Number(r.created_ms), until: Number(r.until), ready: r.status === 'notice' && Number(r.until) <= nowMs,
      decided_at: r.decided_at, decision_note: r.decision_note,
      file: r.file_name ? { name: r.file_name, mime: r.file_mime, size: r.file_size } : null }));
    const links = (await pool.query(`select l.id, l.a_family, l.b_family, l.proposed_by, l.created_at, l.reason,
        fa.name as a_name, fb.name as b_name, pa.data as a_data, pb.data as b_data
      from person_links l join families fa on fa.id = l.a_family join families fb on fb.id = l.b_family
      join persons pa on pa.id = l.a_person join persons pb on pb.id = l.b_person
      where l.status = 'pending' order by l.id`)).rows.map((r) => ({ id: Number(r.id), proposed_by: r.proposed_by, reason: r.reason,
      created_at: r.created_at, from_family: r.a_name, from_person: nameOf(r.a_data), to_family: r.b_name, to_person: nameOf(r.b_data) }));
    res.json({ claims, links, now: nowMs });
  }));

  app.get('/api/app/claims/:id/file', H(async (req, res) => {
    requireAdmin(req);
    const id = Number(req.params.id); if (!Number.isInteger(id)) throw new HttpError(400, 'Mã đơn không hợp lệ.');
    const f = (await pool.query('select name, mime, data from tree_claim_files where claim_id = $1', [id])).rows[0];
    if (!f) throw new HttpError(404, 'Đơn này không có tệp.');
    res.set('cache-control', 'no-store').set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`).type(f.mime).send(f.data);
  }));

  // Approve after the notice ends: the claimant becomes an owner. Everything else in the tree is left as it is.
  app.post('/api/app/claims/:id/approve', H(async (req, res) => {
    const admin = requireAdmin(req);
    const id = Number(req.params.id); if (!Number.isInteger(id)) throw new HttpError(400, 'Mã đơn không hợp lệ.');
    const note = String((req.body || {}).note || '').trim().slice(0, 300);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const c = (await client.query('select *, (extract(epoch from notice_until) * 1000)::float8 as until_ms from tree_claims where id = $1 for update', [id])).rows[0];
      const bad = CR.approveBlock({ claim: c ? { status: c.status, notice_until: Number(c.until_ms) } : null, admin: true, nowMs: Date.now() });
      if (bad) throw new HttpError(409, bad);
      const fam = (await client.query('select id, slug, name from families where id = $1', [c.family_id])).rows[0];
      const existing = (await client.query('select id, role, status from members where family_id = $1 and email = $2 for update', [c.family_id, c.claimant_email])).rows[0] || null;
      const ch = CR.approvalChange(existing);
      if (existing) await client.query("update members set role = 'owner', status = 'active', approved_by = $2, approved_at = now() where id = $1", [existing.id, admin]);
      else await client.query("insert into members (email, name, family_id, role, status, approved_by, approved_at) values ($1,$2,$3,'owner','active',$4,now())",
        [c.claimant_email, c.claimant_name || null, c.family_id, admin]);
      await client.query("update tree_claims set status = 'approved', decided_at = now(), decided_by = $2, decision_note = $3 where id = $1", [id, admin, note]);
      await histRow(client, c.family_id, 'quan_ly', ch.from ? ch.from.role : null, `owner: ${c.claimant_name || c.claimant_email}`, admin);
      await client.query('commit');
      const m = T.treeClaimDecided({ family: fam.name, approved: true, url: `${publicUrl()}/#/${fam.slug}/tree` });
      await client.query('insert into notices (email, family_id, kind, body) values ($1,$2,$3,$4)', [c.claimant_email, c.family_id, 'claim', m.subject]);
      await mail.send(pool, { familyId: c.family_id, kind: 'tree_claim', to: c.claimant_email, subject: m.subject, html: m.html, text: m.text }).catch(() => {});
      // Ownership never changes silently: the other owners are told who was added.
      const others = (await ownerEmails(pool, c.family_id)).filter((e) => e !== c.claimant_email);
      const om = T.treeOwnerAdded({ family: fam.name, name: c.claimant_name || c.claimant_email, url: `${publicUrl()}/#/${fam.slug}/tree` });
      for (const o of others) {
        await pool.query('insert into notices (email, family_id, kind, body) values ($1,$2,$3,$4)', [o, c.family_id, 'claim', om.subject]);
        await mail.send(pool, { familyId: c.family_id, kind: 'tree_claim', to: o, subject: om.subject, html: om.html, text: om.text }).catch(() => {});
      }
      res.json({ ok: true, role: ch.role });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));

  // Reject with a reason (sent to the claimant).
  app.post('/api/app/claims/:id/reject', H(async (req, res) => {
    const admin = requireAdmin(req);
    const id = Number(req.params.id); if (!Number.isInteger(id)) throw new HttpError(400, 'Mã đơn không hợp lệ.');
    const reason = String((req.body || {}).reason || '').trim().slice(0, 300);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const c = (await client.query('select * from tree_claims where id = $1 for update', [id])).rows[0];
      const bad = CR.rejectBlock({ claim: c ? { status: c.status } : null, admin: true, reason });
      if (bad) throw new HttpError(409, bad);
      await client.query("update tree_claims set status = 'rejected', decided_at = now(), decided_by = $2, decision_note = $3 where id = $1", [id, admin, reason]);
      await client.query('commit');
      const fam = (await pool.query('select slug, name from families where id = $1', [c.family_id])).rows[0];
      const m = T.treeClaimDecided({ family: fam.name, approved: false, reason, url: `${publicUrl()}/#/${fam.slug}/tree` });
      await mail.send(pool, { familyId: c.family_id, kind: 'tree_claim', to: c.claimant_email, subject: m.subject, html: m.html, text: m.text }).catch(() => {});
      res.json({ ok: true });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));

  return { stateOf, ownersOf, requireAdmin, openTreeClaim };
}

module.exports = { mount };
