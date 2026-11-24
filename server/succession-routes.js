// HTTP routes for succession (trusted contacts, inactivity, death reports, claims, offers, reclaim) and for creating a
// family. Mounted by server.js with the helpers it already uses for sessions and roles (ctx). Business rules live in
// succession.js and succession-rules.js; this file only reads the request, checks who asks, and answers.
'use strict';
const crypto = require('crypto');
const S = require('./succession');
const R = require('./succession-rules');
const { SYSTEM_MEMBER_SQL } = require('./system-accounts');
const { Refuse } = R;

const FAM_VIS = ['public', 'link', 'private'];
const STR = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isHttpUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } };

module.exports = function mountSuccession(app, ctx) {
  const { pool, who, readSession, findFamily, canRead, ROLE_RANK } = ctx;
  // Route wrapper: a Refuse answers its status and message; anything else goes to the error handler.
  const SH = (fn) => async (req, res, next) => {
    try { await fn(req, res); } catch (e) {
      if (e && e.refuse) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  };
  const famByRef = async (req) => {
    const f = await findFamily(req.params.ref);
    if (!f) throw new Refuse(404, 'Không tìm thấy dòng họ.');
    return f;
  };
  const googleEmail = (req) => readSession(req)?.email || null;
  const needGoogle = (req) => { const e = googleEmail(req); if (!e) throw new Refuse(401, 'Đăng nhập bằng Google để làm việc này.'); return e; };
  const needRole = (w, min) => { if (ROLE_RANK[w.role] < ROLE_RANK[min] || (!w.email && !w.code)) throw new Refuse(403, 'Tài khoản này chưa có quyền cho việc này.'); };
  const needOwner = (w) => { if (w.role !== 'owner' || !w.email) throw new Refuse(403, 'Chỉ Chủ họ làm được việc này.'); };
  const idParam = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) throw new Refuse(404, 'Không tìm thấy.'); return id; };

  // ---- state for the settings page and the banners ----
  app.get('/api/families/:ref/succession', SH(async (req, res) => {
    const fam = await famByRef(req);
    const w = await who(req, fam.id);
    if (!canRead(fam, w)) throw new Refuse(403, 'Dòng họ này là riêng tư.');
    const now = Date.now();
    const member = !!w.email && ROLE_RANK[w.role] >= ROLE_RANK.member;
    const admin = (!!w.email || w.code) && ROLE_RANK[w.role] >= ROLE_RANK.admin;
    const open = member || admin ? await S.openHandover(pool, fam.id) : null;
    const contacts = admin ? await S.listContacts(pool, fam.id) : [];
    const owner = await S.ownerOf(pool, fam.id);
    const chain = await S.chainFor(pool, fam.id, owner?.email);
    const last = await S.lastHandover(pool, fam.id);
    const isOwner = w.role === 'owner' && !!w.email;
    const otherAdmins = admin ? (await pool.query(`select count(*)::int n from members where family_id=$1 and status='active' and role='admin' and email <> $2 and not ${SYSTEM_MEMBER_SQL}`, [fam.id, owner?.email || ''])).rows[0].n : 0;
    const acceptedContacts = contacts.filter((c) => c.status === 'accepted').length;
    const myEmail = w.email;
    const alreadyBacked = !!open && Array.isArray(open.backers) && open.backers.some((b) => b.email === myEmail);
    const reclaim = isOwner || !myEmail ? null : await (async () => {
      const st = await S.reclaimState(pool, fam, myEmail, now);
      return st.ok ? { until: new Date(st.until).toISOString() } : null;
    })();
    res.set('Cache-Control', 'no-store');
    res.json({
      family: fam.id,
      my_role: w.role,
      inactive_months: fam.owner_inactive_months,
      months_choices: R.RULES.INACTIVE_MONTHS,
      max_contacts: R.RULES.MAX_CONTACTS,
      handover: open ? {
        id: open.id, kind: open.kind, stage: open.stage, started_at: open.started_at, deadline_at: open.deadline_at,
        claimant: open.kind === 'claim' ? open.claimant_email : undefined,
        backers: open.kind === 'claim' ? (Array.isArray(open.backers) ? open.backers.length : 0) : undefined,
        evidence: admin ? open.evidence : undefined,
      } : null,
      can_report: member && !open && !!myEmail,
      can_confirm: !!open && open.kind === 'deceased' && open.stage === 'reported' && !!myEmail && await S.canConfirm(pool, fam.id, myEmail),
      can_back: !!open && open.kind === 'claim' && open.stage === 'backing' && member && !!myEmail && !alreadyBacked && open.claimant_email !== myEmail,
      can_object: !!open && open.kind === 'claim' && open.stage === 'objection' && member && !!myEmail && open.claimant_email !== myEmail,
      can_claim: member && !open && !!myEmail && R.claimAllowed({ openHandover: null, chainCount: chain.length, lastBlocked: last?.status === 'blocked' }),
      can_cancel: isOwner && !!open,
      reclaim,
      owner_banner: isOwner && acceptedContacts === 0 && otherAdmins === 0,
      contacts: admin ? contacts.map((c) => ({ id: c.id, email: c.email, name: c.name, status: c.status, priority: c.priority, accepted_at: c.accepted_at })) : undefined,
      chain: admin ? chain.map((c) => ({ email: S.maskEmail(c.email), source: c.source })) : undefined,
      is_owner: isOwner,
    });
  }));

  // ---- owner settings ----
  app.post('/api/families/:ref/succession/settings', SH(async (req, res) => {
    const fam = await famByRef(req); const w = await who(req, fam.id); needOwner(w);
    await S.setInactiveMonths(pool, fam, req.body?.owner_inactive_months);
    res.json({ ok: true, inactive_months: Number(req.body.owner_inactive_months) });
  }));

  // ---- trusted contacts ----
  app.get('/api/families/:ref/trusted', SH(async (req, res) => {
    const fam = await famByRef(req); const w = await who(req, fam.id);
    needRole(w, 'admin');
    res.set('Cache-Control', 'no-store');
    res.json({ items: await S.listContacts(pool, fam.id) });
  }));
  app.post('/api/families/:ref/trusted', SH(async (req, res) => {
    const fam = await famByRef(req); const w = await who(req, fam.id); needOwner(w);
    const id = await S.inviteContact(pool, fam, { email: req.body?.email, name: STR(req.body?.name, 80), inviter: w.name || 'Chủ họ', now: Date.now() });
    res.json({ ok: true, id });
  }));
  app.post('/api/families/:ref/trusted/:id/resend', SH(async (req, res) => {
    const fam = await famByRef(req); const w = await who(req, fam.id); needOwner(w);
    await S.resendInvite(pool, fam, { id: idParam(req), inviter: w.name || 'Chủ họ', now: Date.now() });
    res.json({ ok: true });
  }));
  app.post('/api/families/:ref/trusted/:id/remove', SH(async (req, res) => {
    const fam = await famByRef(req); const w = await who(req, fam.id); needOwner(w);
    await S.removeContact(pool, fam, idParam(req));
    res.json({ ok: true });
  }));
  app.post('/api/families/:ref/trusted/order', SH(async (req, res) => {
    const fam = await famByRef(req); const w = await who(req, fam.id); needOwner(w);
    await S.reorderContacts(pool, fam, req.body?.ids);
    res.json({ ok: true });
  }));
  // The invite page: what the link is for (no email, no token in the answer).
  app.get('/api/trusted/:token', SH(async (req, res) => {
    const info = await S.contactInvite(pool, String(req.params.token || ''), Date.now());
    if (!info) throw new Refuse(404, 'Lời mời không còn hiệu lực.');
    res.set('Cache-Control', 'no-store');
    res.json(info);
  }));
  app.post('/api/trusted/:token/accept', SH(async (req, res) => {
    const email = needGoogle(req);
    res.json(await S.acceptContact(pool, String(req.params.token || ''), email, Date.now()));
  }));

  // ---- handover: report, confirm, cancel, claim, back, reclaim ----
  app.post('/api/families/:ref/handover/report', SH(async (req, res) => {
    const fam = await famByRef(req); const w = await who(req, fam.id);
    if (!w.email || ROLE_RANK[w.role] < ROLE_RANK.member) throw new Refuse(403, 'Chỉ thành viên của dòng họ mới báo được.');
    const evidence = STR(req.body?.evidence, 1000);
    const photo = STR(req.body?.photo_link, 500);
    if (photo && !isHttpUrl(photo)) throw new Refuse(400, 'Đường dẫn ảnh phải bắt đầu bằng http hoặc https.');
    const id = await S.reportDeceased(pool, fam, { email: w.email, evidence, photo, now: Date.now() });
    res.json({ ok: true, id });
  }));
  app.post('/api/handover/:id/confirm', SH(async (req, res) => {
    const email = needGoogle(req);
    const r = await S.requestById(pool, idParam(req));
    if (!r) throw new Refuse(404, 'Không tìm thấy việc này.');
    const out = await S.confirmDeceased(pool, r, email, Date.now());
    res.json({ ok: true, deadline_at: out.deadline });
  }));
  app.post('/api/families/:ref/handover/cancel', SH(async (req, res) => {
    const fam = await famByRef(req); const w = await who(req, fam.id); needOwner(w);
    const n = await S.cancelOpen(pool, fam.id, w.email, Date.now());
    res.json({ ok: true, cancelled: n });
  }));
  app.post('/api/families/:ref/claim', SH(async (req, res) => {
    const fam = await famByRef(req); const w = await who(req, fam.id);
    if (!w.email || ROLE_RANK[w.role] < ROLE_RANK.member) throw new Refuse(403, 'Chỉ thành viên của dòng họ mới xin nhận quyền.');
    const id = await S.startClaim(pool, fam, w.email, Date.now());
    res.json({ ok: true, id });
  }));
  app.post('/api/handover/:id/back', SH(async (req, res) => {
    const email = needGoogle(req);
    const r = await S.requestById(pool, idParam(req));
    if (!r) throw new Refuse(404, 'Không tìm thấy việc này.');
    const fam = await S.famRow(pool, r.family_id);
    const w = await who(req, fam.id);
    if (!w.email || ROLE_RANK[w.role] < ROLE_RANK.member) throw new Refuse(403, 'Chỉ thành viên của dòng họ mới ủng hộ được.');
    res.json(await S.backClaim(pool, r, email, Date.now()));
  }));
  app.post('/api/handover/:id/object', SH(async (req, res) => {
    const email = needGoogle(req);
    const r = await S.requestById(pool, idParam(req));
    if (!r) throw new Refuse(404, 'Không tìm thấy việc này.');
    const fam = await S.famRow(pool, r.family_id);
    const w = await who(req, fam.id);
    if (!w.email || ROLE_RANK[w.role] < ROLE_RANK.member) throw new Refuse(403, 'Chỉ thành viên của dòng họ mới phản đối được.');
    res.json(await S.objectClaim(pool, r, email, Date.now()));
  }));
  app.post('/api/families/:ref/reclaim', SH(async (req, res) => {
    const fam = await famByRef(req);
    const email = needGoogle(req);
    res.json(await S.reclaim(pool, fam, email, Date.now()));
  }));

  // ---- offers (the link from the email; the code is the second check) ----
  app.get('/api/offers/:token', SH(async (req, res) => {
    const token = String(req.params.token || '');
    const o = await S.offerByToken(pool, token, Date.now());
    if (!o) throw new Refuse(404, 'Lời mời không còn hiệu lực.');
    const fam = await S.famRow(pool, o.family_id);
    res.set('Cache-Control', 'no-store');
    res.json({ family: fam.name, slug: fam.slug, expires_at: o.expires_at, expired: !!o.expired, email: S.maskEmail(o.email), code_sent: !!o.code_expires_at && new Date(o.code_expires_at).getTime() > Date.now() });
  }));
  app.post('/api/offers/:token/code', SH(async (req, res) => {
    res.json({ ok: true, ...(await S.sendOfferCode(pool, String(req.params.token || ''), Date.now())) });
  }));
  app.post('/api/offers/:token/accept', SH(async (req, res) => {
    res.json(await S.acceptOffer(pool, String(req.params.token || ''), String(req.body?.code || ''), Date.now()));
  }));
  app.post('/api/offers/:token/decline', SH(async (req, res) => {
    res.json(await S.declineOffer(pool, String(req.params.token || ''), Date.now()));
  }));

  // ---- create a family: the signed-in Google account becomes its owner ----
  const slugify = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const MAX_OWNED = 10;
  app.post('/api/families', SH(async (req, res) => {
    const email = needGoogle(req);
    const b = req.body || {};
    const name = STR(b.name, 80);
    if (!name) throw new Refuse(400, 'Cần ghi tên họ.');
    const han = STR(b.han, 20) || null;
    const place = STR(b.place, 120) || null;
    const visibility = b.visibility ?? 'public';
    if (!FAM_VIS.includes(visibility)) throw new Refuse(400, 'Quyền xem không hợp lệ.');
    const personName = STR(b.first_person?.name, 80);
    const sex = ['m', 'f', ''].includes(b.first_person?.sex) ? b.first_person.sex : '';
    const owned = (await pool.query("select count(*)::int n from members where email=$1 and role='owner' and status='active'", [email])).rows[0].n;
    if (owned >= MAX_OWNED) throw new Refuse(409, `Mỗi tài khoản làm Chủ họ tối đa ${MAX_OWNED} dòng họ.`);
    const base = slugify(name) || 'ho-' + crypto.randomBytes(3).toString('hex');
    let slug = base; let n = 2;
    while ((await pool.query('select 1 from families where id=$1 or slug=$1', [slug])).rowCount) slug = `${base}-${n++}`;
    const account = readSession(req);
    const ownerName = account?.name || email;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('insert into families (id, slug, name, han, place, visibility) values ($1,$1,$2,$3,$4,$5)', [slug, name, han, place, visibility]);
      await client.query("insert into members (email, name, role, status, approved_by, approved_at, family_id) values ($1,$2,'owner','active','tạo mới',now(),$3)", [email, ownerName, slug]);
      // a new family keeps its relations in the relation tables from day 1 (no legacy parent fields to migrate)
      await client.query("insert into relation_migrations (family_id, migrated_at, migrated_by, counts) values ($1, now(), $2, $3) on conflict do nothing", [slug, 'new family', { note: 'created empty in table mode' }]);
      if (personName) {
        const id = 'N' + crypto.randomUUID().slice(0, 13);
        const data = { name: personName, gen: 1, ...(sex ? { sex } : {}) };
        await client.query('insert into persons (id, data, updated_by, family_id) values ($1,$2,$3,$4)', [id, data, email, slug]);
        await client.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'name',null,$2,$3)", [id, JSON.stringify(personName), email]);
      }
      await client.query('commit');
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true, family: { id: slug, slug, name } });
  }));

  // Test only (NODE_ENV=test): runs the engine at an injected time (optionally for one family), without the daily guard.
  if (process.env.NODE_ENV === 'test') {
    app.post('/api/test/succession/tick', SH(async (req, res) => {
      const at = Date.parse(String(req.body?.now || ''));
      if (!Number.isFinite(at)) throw new Refuse(400, 'now');
      const only = req.body?.family ? [String(req.body.family)] : null;
      res.json({ ok: true, stats: await S.runEngine(pool, at, { only }) });
    }));
  }

};
