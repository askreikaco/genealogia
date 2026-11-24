// Elder access routes: device sign-in by code (approve on a signed-in phone), managers of a person, the devices list
// with remote sign-out, and printed sign-in cards. Mounted by server.js with the session helpers it already has.
'use strict';
const QR = require('qrcode');
const R = require('./elder-rules');

const isPid = (s) => /^P\d{3,6}$|^N[0-9a-z-]{6,40}$/.test(String(s || ''));
const isEmail = (s) => /^[^\s@]{1,200}@[^\s@]{1,200}$/.test(String(s || ''));
const qrSvg = (text) => QR.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });

function mount(app, d) {
  const { pool, who, readSessionAll, addAccount, sameSite, H, HttpError, famOf, mail } = d;
  // Failed lookups and starts per IP / per approver: a guessed 6-digit code is never useful for long.
  const startLimit = R.makeLimiter(10, 15 * 60e3);
  const guessLimit = R.makeLimiter(10, 15 * 60e3);
  const pubUrl = () => mail.publicUrl();
  const log = (fam, person, kind, actor, detail = '') => pool.query(
    'insert into elder_log (family_id, person_id, kind, actor, detail) values ($1,$2,$3,$4,$5)', [fam, person, kind, actor, detail]);
  const personOf = async (id) => {
    const { rows } = await pool.query('select id, family_id, data->>\'name\' as name from persons where id=$1 and deleted=false', [id]);
    return rows[0] || null;
  };
  // The signed-in actor in one family: email (Google only), role there, managed and own persons.
  async function actorIn(req, famId) {
    const w = await who(req, famId);
    if (w.device) return { device: true, personId: w.devicePerson, email: null, familyRole: null, managedIds: new Set(), selfIds: new Set() };
    const email = w.email || null;
    const familyRole = email ? (w.status === 'active' ? w.role : null) : (w.code ? 'admin' : null);
    let managedIds = new Set(), selfIds = new Set();
    if (email) {
      const m = await pool.query('select person_id from person_managers where family_id=$1 and email=$2', [famId, email]);
      managedIds = new Set(m.rows.map((r) => r.person_id));
      const s = await pool.query("select person_id from members where family_id=$1 and email=$2 and status='active' and person_id is not null", [famId, email]);
      selfIds = new Set(s.rows.map((r) => r.person_id));
    }
    return { email, familyRole, managedIds, selfIds, code: !!w.code, device: false };
  }
  const needActor = (a) => { if (!a || (!a.device && !a.email && !a.code && !a.familyRole)) throw new HttpError(401, 'Cần đăng nhập.'); };
  // Person-level gate (managers, devices, cards): the person must exist in the family the request names.
  async function personGate(req, personId, { noDevice = false } = {}) {
    if (!isPid(personId)) throw new HttpError(400, 'Mã người không hợp lệ.');
    const p = await personOf(personId);
    if (!p) throw new HttpError(404, 'Không tìm thấy người này.');
    const fam = await famOf({ ...req, query: { family: p.family_id }, body: {} });
    const a = await actorIn(req, fam.id);
    needActor(a);
    if (noDevice && a.device) throw new HttpError(403, 'Thiết bị này không được phép làm việc này.');
    if (!R.canManagePerson(a, personId)) throw new HttpError(403, 'Tài khoản này chưa có quyền cho việc này.');
    return { person: p, fam, actor: a };
  }
  const notifyOwners = async (fam, subject, text) => {
    const { rows } = await pool.query("select email from members where family_id=$1 and role='owner' and status='active'", [fam]);
    for (const r of rows) await mail.send(pool, { familyId: fam, kind: 'elder', to: r.email, subject, text, html: `<p>${text}</p>` }).catch(() => {});
  };
  const issueDeviceCookie = async (req, res, fam, person, approver, via) => {
    const id = R.newDeviceId();
    await pool.query(
      'insert into device_accounts (id, family_id, person_id, name, via, created_by, expires_at, device) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, fam, person.id, person.name || 'Thành viên', via, approver, new Date(Date.now() + R.DEVICE_TTL_MS), R.deviceLabel(req.get('user-agent'))]);
    const cookieOk = addAccount(req, res, { k: 'd', id, name: person.name || '' });
    return { id, cookieOk };
  };

  // ---- 0. act on behalf of a managed person ("thay mặt") ----
  // The client asks first (sets the banner), then sends x-act-as with each write; the server re-checks every write.
  app.post('/api/persons/:id/act-as', sameSite, H(async (req, res) => {
    const { person } = await personGate(req, req.params.id, { noDevice: true });
    res.json({ ok: true, name: person.name || person.id });
  }));
  app.use('/api', async (req, res, next) => {
    const h = req.get('x-act-as');
    if (!h || !/^(POST|PUT|PATCH|DELETE)$/.test(req.method)) return next();
    try {
      if (!isPid(h)) throw new HttpError(400, 'Mã người không hợp lệ.');
      const p = await personOf(h);
      if (!p) throw new HttpError(404, 'Không tìm thấy người này.');
      const fam = await famOf({ query: { family: p.family_id }, body: {} });
      const a = await actorIn(req, fam.id);
      needActor(a);
      if (a.device || !R.canManagePerson(a, h)) throw new HttpError(403, 'Tài khoản này chưa thay mặt người này.');
      req.actAs = { id: p.id, name: p.name || p.id };
      next();
    } catch (e) { if (e instanceof HttpError) return res.status(e.status).json({ error: e.message }); next(e); }
  });

  // ---- 1. device sign-in by code ----
  // Start: the elder's screen asks for a code. Returns the poll secret (kept on that device) and a QR of the approve link.
  app.post('/api/device/start', sameSite, H(async (req, res) => {
    const lim = startLimit.hit(req.ip);
    if (!lim.ok) throw new HttpError(429, `Thử quá nhiều lần. Đợi ${Math.ceil(lim.retryAfterSec / 60)} phút.`);
    const secret = R.newSecret(32);
    let userCode = null;
    for (let i = 0; i < 20 && !userCode; i++) {
      const c = R.newUserCode();
      const { rows } = await pool.query("select 1 from device_codes where user_code=$1 and status='pending' and expires_at > now() limit 1", [c]);
      if (!rows.length) userCode = c;
    }
    if (!userCode) throw new HttpError(503, 'Thử lại sau ít phút.');
    await pool.query('insert into device_codes (secret_hash, user_code, expires_at) values ($1,$2,$3)',
      [R.sha256(secret), userCode, new Date(Date.now() + R.CODE_TTL_MS)]);
    const approveUrl = `${pubUrl()}/#approve=${userCode}`;
    res.set('Cache-Control', 'no-store');
    res.json({ device_code: secret, user_code: userCode, expires_in: R.CODE_TTL_MS / 1000, interval: 3, qr_svg: await qrSvg(approveUrl) });
  }));
  // Poll from the elder's device: pending | expired | used | signed_in (the cookie is set on that device, once).
  app.post('/api/device/poll', sameSite, H(async (req, res) => {
    const secret = String(req.body?.device_code || '');
    res.set('Cache-Control', 'no-store');
    if (!secret || secret.length > 80) return res.json({ status: 'expired' });
    const hash = R.sha256(secret);
    const { rows } = await pool.query('select * from device_codes where secret_hash=$1', [hash]);
    const row = rows[0];
    const st = R.codeState(row, Date.now());
    if (st === 'pending') return res.json({ status: 'pending' });
    if (st === 'consumed') return res.json({ status: 'used' });
    if (st !== 'approved') return res.json({ status: 'expired' });
    // Single use: the first poll that flips the row wins; a second poll sees 'used'.
    const claim = await pool.query("update device_codes set status='consumed', consumed_at=now() where id=$1 and status='approved' returning id", [row.id]);
    if (!claim.rows.length) return res.json({ status: 'used' });
    const person = await personOf(row.person_id);
    if (!person) return res.json({ status: 'expired' });
    const { cookieOk } = await issueDeviceCookie(req, res, row.family_id, person, row.first_approver, 'code');
    if (!cookieOk) return res.status(409).json({ error: 'Đã có 5 tài khoản trên thiết bị này. Đăng xuất bớt tài khoản để thêm.' });
    await log(row.family_id, person.id, 'device_signin', row.first_approver, 'code');
    res.json({ status: 'signed_in', name: person.name || '' });
  }));
  // Approve sheet data: the code's state and the people this signed-in account may sign in for (one when already chosen).
  app.get('/api/device/code/:code', H(async (req, res) => {
    const code = String(req.params.code || '');
    if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Mã gồm 6 chữ số.');
    const { rows: [row] } = await pool.query("select * from device_codes where user_code=$1 and status='pending' and expires_at > now() order by id desc limit 1", [code]);
    if (!row) { guessLimit.hit(req.ip); throw new HttpError(404, 'Mã không đúng hoặc đã hết hạn.'); }
    const { rows: famRows } = await pool.query('select id from families');
    const choices = [];
    for (const f of famRows) {
      if (row.person_id && row.family_id !== f.id) continue;
      const a = await actorIn(req, f.id);
      if (!a.email) continue;
      let ids = [...a.managedIds, ...a.selfIds];
      if (R.isTop(a.familyRole)) {
        const { rows } = await pool.query('select id from persons where family_id=$1 and deleted=false', [f.id]);
        ids = rows.map((r) => r.id);
      }
      if (row.person_id) ids = ids.filter((id) => id === row.person_id);
      if (!ids.length) continue;
      const { rows: ps } = await pool.query("select id, data->>'name' as name from persons where family_id=$1 and deleted=false and id = any($2::text[]) order by data->>'name' limit 400", [f.id, ids]);
      choices.push(...ps.map((p) => ({ id: p.id, name: p.name || p.id, family_id: f.id })));
    }
    if (!choices.length) throw new HttpError(403, 'Tài khoản này chưa có quyền cho mã này.');
    res.set('Cache-Control', 'no-store');
    res.json({ waiting: row.approvals, choices });
  }));
  // Approve: a signed-in Google account that may act for the person. Elder with owner/admin: two approvers.
  app.post('/api/device/approve', sameSite, H(async (req, res) => {
    const code = String(req.body?.user_code || '');
    const pid = String(req.body?.person_id || '');
    if (!/^\d{6}$/.test(code) || !isPid(pid)) throw new HttpError(400, 'Thông tin không hợp lệ.');
    const person = await personOf(pid);
    if (!person) throw new HttpError(404, 'Không tìm thấy người này.');
    const fam = person.family_id;
    const a = await actorIn(req, fam);
    needActor(a);
    if (!a.email) throw new HttpError(403, 'Chỉ tài khoản Google đăng nhập mới được duyệt.');
    const lim = guessLimit.peek(a.email);
    if (lim) throw new HttpError(429, 'Thử quá nhiều lần. Đợi 15 phút.');
    const { rows: [row] } = await pool.query("select * from device_codes where user_code=$1 and status='pending' and expires_at > now() order by id desc limit 1", [code]);
    if (!row) { guessLimit.hit(a.email); throw new HttpError(404, 'Mã không đúng hoặc đã hết hạn.'); }
    if (row.person_id && row.person_id !== pid) throw new HttpError(409, 'Mã này đang chờ duyệt cho người khác.');
    if (!R.canApprove(a, pid)) throw new HttpError(403, 'Tài khoản này chưa có quyền cho người này.');
    const { rows: [el] } = await pool.query("select role from members where family_id=$1 and person_id=$2 and status='active' limit 1", [fam, pid]);
    const needed = R.approvalsNeeded(el?.role || null);
    if (row.approvals === 0) {
      const one = needed === 1;
      const { rowCount } = await pool.query(
        `update device_codes set person_id=$2, family_id=$3, approvals=1, first_approver=$4, status=$5
         where id=$1 and status='pending' and approvals=0`,
        [row.id, pid, fam, a.email, one ? 'approved' : 'pending']);
      if (!rowCount) throw new HttpError(409, 'Mã này vừa được duyệt. Thử lại.');
      await log(fam, pid, 'approve', a.email, one ? '1 of 1' : '1 of 2');
      await notifyOwners(fam, 'Đăng nhập cho người thân', `${person.name || pid}: ${a.email} vừa duyệt một lần đăng nhập${one ? '' : ' (chờ người duyệt thứ hai)'}.`);
      return res.json({ status: one ? 'approved' : 'waiting' });
    }
    // Second approval: a different owner or admin than the first.
    if (needed !== 2 || !R.secondApproverOk(row.first_approver, a)) throw new HttpError(403, 'Cần một Chủ họ hoặc Quản trị khác duyệt.');
    const { rowCount } = await pool.query("update device_codes set approvals=2, status='approved' where id=$1 and status='pending' and approvals=1", [row.id]);
    if (!rowCount) throw new HttpError(409, 'Mã này vừa được duyệt. Thử lại.');
    await log(fam, pid, 'approve', a.email, '2 of 2');
    await notifyOwners(fam, 'Đăng nhập cho người thân', `${person.name || pid}: ${a.email} vừa duyệt lần thứ hai.`);
    res.json({ status: 'approved' });
  }));

  // ---- 2. managers of a person ----
  app.get('/api/persons/:id/managers', H(async (req, res) => {
    const { person, fam } = await personGate(req, req.params.id);
    const { rows } = await pool.query(`select pm.email, m.name, m.role from person_managers pm
      left join members m on m.family_id = pm.family_id and m.email = pm.email and m.status = 'active'
      where pm.family_id=$1 and pm.person_id=$2 order by pm.email`, [fam.id, person.id]);
    res.set('Cache-Control', 'no-store');
    res.json({ person: { id: person.id, name: person.name }, managers: rows.map((r) => ({ email: r.email, name: r.name || r.email, role: r.role || null })) });
  }));
  // Add or remove a manager. The account must be an active member of the family (it signs in there with its own role).
  app.put('/api/persons/:id/managers', sameSite, H(async (req, res) => {
    const { person, fam, actor } = await personGate(req, req.params.id);
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'Email không hợp lệ.');
    if (typeof req.body?.on !== 'boolean') throw new HttpError(400, 'Thiếu lựa chọn thêm hay bỏ.');
    if (req.body.on) {
      const { rows } = await pool.query("select 1 from members where family_id=$1 and email=$2 and status='active'", [fam.id, email]);
      if (!rows.length) throw new HttpError(400, 'Người này chưa là thành viên dòng họ.');
      await pool.query('insert into person_managers (family_id, person_id, email, added_by) values ($1,$2,$3,$4) on conflict do nothing',
        [fam.id, person.id, email, actor.email || 'mã biên tập']);
    } else {
      await pool.query('delete from person_managers where family_id=$1 and person_id=$2 and email=$3', [fam.id, person.id, email]);
    }
    await log(fam.id, person.id, req.body.on ? 'manager_add' : 'manager_remove', actor.email || 'mã biên tập', email);
    res.json({ ok: true });
  }));

  // ---- 3. devices of a person, remote sign-out ----
  app.get('/api/persons/:id/devices', H(async (req, res) => {
    const { person, fam } = await personGate(req, req.params.id);
    const { rows } = await pool.query(`select id, name, via, device, created_at, last_seen_at, expires_at from device_accounts
      where family_id=$1 and person_id=$2 and revoked_at is null and expires_at > now() order by created_at desc`, [fam.id, person.id]);
    res.set('Cache-Control', 'no-store');
    res.json({ person: { id: person.id, name: person.name }, devices: rows });
  }));
  app.post('/api/devices/:id/revoke', sameSite, H(async (req, res) => {
    const id = String(req.params.id || '');
    if (!R.isDeviceId(id)) throw new HttpError(400, 'Mã thiết bị không hợp lệ.');
    const { rows: [dev] } = await pool.query('select id, family_id, person_id from device_accounts where id=$1 and revoked_at is null', [id]);
    if (!dev) throw new HttpError(404, 'Thiết bị này đã đăng xuất.');
    const fam = await famOf({ query: { family: dev.family_id }, body: {} });
    const a = await actorIn(req, fam.id);
    needActor(a);
    if (!R.canManagePerson(a, dev.person_id)) throw new HttpError(403, 'Tài khoản này chưa có quyền cho việc này.');
    await pool.query('update device_accounts set revoked_at=now(), revoked_by=$2 where id=$1', [id, a.email || 'mã biên tập']);
    await log(dev.family_id, dev.person_id, 'device_revoke', a.email || 'mã biên tập', '');
    res.json({ ok: true });
  }));

  // ---- 4. printed sign-in card (one active per person) ----
  app.get('/api/persons/:id/card', H(async (req, res) => {
    const { person, fam } = await personGate(req, req.params.id, { noDevice: true });
    const { rows } = await pool.query(`select id, created_at, uses, last_used_at from sign_in_cards
      where family_id=$1 and person_id=$2 and revoked_at is null`, [fam.id, person.id]);
    res.set('Cache-Control', 'no-store');
    res.json({ person: { id: person.id, name: person.name }, card: rows[0] || null });
  }));
  // Make a new card (the old one stops working). The token is shown once, in the URL and the QR of this response.
  app.post('/api/persons/:id/card', sameSite, H(async (req, res) => {
    const { person, fam, actor } = await personGate(req, req.params.id, { noDevice: true });
    const token = R.newSecret(24);
    await pool.query("update sign_in_cards set revoked_at=now(), revoked_by=$3 where family_id=$1 and person_id=$2 and revoked_at is null",
      [fam.id, person.id, actor.email || 'mã biên tập']);
    const { rows: [card] } = await pool.query('insert into sign_in_cards (family_id, person_id, token_hash, created_by) values ($1,$2,$3,$4) returning id, created_at',
      [fam.id, person.id, R.sha256(token), actor.email || 'mã biên tập']);
    await log(fam.id, person.id, 'card_print', actor.email || 'mã biên tập', String(card.id));
    const url = `${pubUrl()}/#card=${token}`;
    res.set('Cache-Control', 'no-store');
    res.json({ id: card.id, person: { id: person.id, name: person.name }, family: fam.name || '', url, qr_svg: await qrSvg(url) });
  }));
  app.post('/api/persons/:id/card/revoke', sameSite, H(async (req, res) => {
    const { person, fam, actor } = await personGate(req, req.params.id, { noDevice: true });
    await pool.query("update sign_in_cards set revoked_at=now(), revoked_by=$3 where family_id=$1 and person_id=$2 and revoked_at is null",
      [fam.id, person.id, actor.email || 'mã biên tập']);
    await log(fam.id, person.id, 'card_revoke', actor.email || 'mã biên tập', '');
    res.json({ ok: true });
  }));
  // The elder's device, after the card is scanned and the elder taps "Đăng nhập": the token must match an active card.
  app.post('/api/card/use', sameSite, H(async (req, res) => {
    const token = String(req.body?.token || '');
    if (!token || token.length > 120) throw new HttpError(400, 'Thẻ không hợp lệ.');
    const lim = guessLimit.hit('card:' + req.ip);
    if (!lim.ok) throw new HttpError(429, 'Thử quá nhiều lần. Đợi 15 phút.');
    const { rows: [card] } = await pool.query('select * from sign_in_cards where token_hash=$1 and revoked_at is null', [R.sha256(token)]);
    if (!card) throw new HttpError(404, 'Thẻ này không còn dùng được.');
    const person = await personOf(card.person_id);
    if (!person) throw new HttpError(404, 'Thẻ này không còn dùng được.');
    const { cookieOk } = await issueDeviceCookie(req, res, card.family_id, person, null, 'card');
    if (!cookieOk) throw new HttpError(409, 'Đã có 5 tài khoản trên thiết bị này. Đăng xuất bớt tài khoản để thêm.');
    await pool.query('update sign_in_cards set uses = uses + 1, last_used_at = now() where id=$1', [card.id]);
    await log(card.family_id, person.id, 'card_use', null, String(card.id));
    await notifyOwners(card.family_id, 'Thẻ đăng nhập được dùng', `${person.name || person.id} vừa đăng nhập bằng thẻ trên một thiết bị.`);
    res.json({ status: 'signed_in', name: person.name || '' });
  }));
}

module.exports = { mount, qrSvg };
