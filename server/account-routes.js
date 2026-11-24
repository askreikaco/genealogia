// Account page API (account plan P1): this account's profile, sign-in methods (emails, Google; phone, Apple, Zalo,
// Facebook and 2-step later), devices and sessions, security activity, families and roles.
// Only the signed-in Google-type account itself reads or changes these; nothing here is shown to any family.
// Sensitive changes (add or remove a method, primary email, sign out other devices) need a sign-in within 10 minutes
// (REAUTH_MS): the client sends the person through Google again (/api/auth/google?mode=reauth) and retries.
'use strict';
const A = require('./accounts');

function mount(app, d) {
  const { pool, readSessionAll, writeSession, sameSite, H, HttpError, mail, T } = d;

  // The active account of this request: { s, i, acc, aid, sid, at }. Cookies from before accounts (no aid) get their
  // account and a session now (auth time unknown = 0, so a sensitive change asks for a fresh sign-in first).
  async function ctx(req, res) {
    const s = readSessionAll(req);
    const acc = s && s.accs[s.a];
    if (!acc) throw new HttpError(401, 'Cần đăng nhập.');
    if (acc.k !== 'g') throw new HttpError(403, 'Tài khoản mã biên tập hoặc thiết bị không có trang tài khoản.');
    if (!A.UUID_RE.test(String(acc.aid || '')) || !A.SID_RE.test(String(acc.sid || ''))) {
      const aid = await A.ensureByEmail(pool, acc.email, acc.name);
      const sid = await A.createSession(pool, aid, req);
      await A.event(pool, aid, 'session_upgraded', {}, req);
      const accs = s.accs.slice(); accs[s.a] = { ...acc, aid, sid, at: 0 };
      writeSession(res, { accs, a: s.a });
      return { s: { ...s, accs }, i: s.a, acc: accs[s.a], aid, sid, at: 0 };
    }
    return { s, i: s.a, acc, aid: acc.aid, sid: acc.sid, at: Number(acc.at) || 0 };
  }
  const needFresh = (c) => { if (!A.fresh(c.at)) throw Object.assign(new HttpError(401, 'Vui lòng đăng nhập lại để xác nhận đây là bạn.'), { reauth: true }); };
  // Route wrapper that also passes { reauth: true } to the client.
  const HR = (fn) => async (req, res, next) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.reauth ? { reauth: true } : {}) });
      next(e);
    }
  };
  const handle = (sid) => A.sha('s:' + sid).slice(0, 20); // what the page sees instead of the session id
  const passkeysOf = async (emails) => {
    if (!emails.length) return [];
    const { rows } = await pool.query('select id, label, created_at, last_used_at, transports from passkeys where account = any($1) order by created_at', [emails.map((e) => 'g:' + e)]);
    return rows;
  };
  // Tell every verified email of the account about a change (new method, removed method). Never blocks the change.
  async function notify(aid, what, req) {
    try {
      const emails = await A.emailsOf(pool, aid);
      const msg = T.accountChanged({ what, when: new Date(), device: A.deviceLabel(req.get('user-agent')), url: mail.publicUrl() + '/#tai-khoan' });
      for (const to of emails) await mail.send(pool, { kind: 'account', to, ...msg });
    } catch (e) { console.error('account notify', e.message); }
  }

  app.get('/api/account', HR(async (req, res) => {
    const c = await ctx(req, res);
    res.set('Cache-Control', 'no-store');
    const { rows: [acct] } = await pool.query('select id, name, created_at from accounts where id = $1', [c.aid]);
    if (!acct) throw new HttpError(404, 'Không tìm thấy tài khoản.');
    const ids = await A.identitiesOf(pool, c.aid);
    const emails = A.verifiedEmails(ids).map((x) => x.value_norm);
    const pks = await passkeysOf(emails);
    const { rows: sess } = await pool.query('select id, label, ip_prefix, created_at, last_seen_at from sessions where account_id = $1 and revoked_at is null order by last_seen_at desc limit 50', [c.aid]);
    const { rows: ev } = await pool.query('select kind, detail, ip_prefix, ua, at from account_events where account_id = $1 order by at desc limit 20', [c.aid]);
    const { rows: fam } = await pool.query(`select distinct on (f.id) f.id, f.slug, f.name, m.role from members m join families f on f.id = m.family_id
      where m.status = 'active' and (m.account_id = $1 or m.email = any($2)) order by f.id, array_position(array['owner','admin','editor','member'], m.role)`, [c.aid, emails]);
    res.json({
      id: acct.id, name: acct.name || c.acc.name || '', created_at: acct.created_at,
      fresh: A.fresh(c.at), fresh_until: c.at ? c.at + A.REAUTH_MS : 0,
      methods: A.signInCount(ids, pks.length),
      emails: ids.filter((x) => x.type === 'email').map((x) => ({ id: String(x.id), email: x.value_norm, primary: x.is_primary, verified: !!x.verified_at })),
      linked: ids.filter((x) => x.provider_sub).map((x) => ({ id: String(x.id), type: x.type, email: x.value_norm, linked_at: x.created_at, last_used_at: x.last_used_at })),
      passkeys: pks.map((p) => ({ id: String(p.id), label: p.label || 'Passkey', created_at: p.created_at, last_used_at: p.last_used_at })),
      sessions: sess.map((r) => ({ id: handle(r.id), label: r.label, ip: r.ip_prefix, created_at: r.created_at, last_seen_at: r.last_seen_at, current: r.id === c.sid })),
      events: ev.map((r) => ({ kind: r.kind, detail: r.detail, at: r.at, device: r.ua, ip: r.ip_prefix })),
      families: fam.map((r) => ({ slug: r.slug, name: r.name, role: r.role })),
      // later phases, shown as "Sắp có" on the page; P2b: owners/admins will need a passkey or an authenticator app
      soon: { phone: true, apple: true, zalo: true, facebook: true, totp: true, recovery_codes: true },
    });
  }));

  app.patch('/api/account', sameSite, HR(async (req, res) => {
    const c = await ctx(req, res);
    const name = String(req.body?.name ?? '').trim();
    if (!name || name.length > 120) throw new HttpError(400, 'Tên hiển thị từ 1 đến 120 ký tự.');
    await pool.query('update accounts set name = $2 where id = $1', [c.aid, name]);
    await A.event(pool, c.aid, 'name_changed', {}, req);
    res.json({ ok: true });
  }));

  // Add an email: a link is mailed to it; the email counts (roles, sign-in later) only after the link is opened.
  // The answer is the same whether or not the address belongs to someone else (no account enumeration).
  app.post('/api/account/emails', sameSite, HR(async (req, res) => {
    const c = await ctx(req, res); needFresh(c);
    if (!A.hit('em:a:' + c.aid, 5, 3600e3) || !A.hit('em:ip:' + req.ip, 20, 3600e3)) throw new HttpError(429, 'Thêm email quá nhiều lần. Thử lại sau một giờ.');
    const email = A.normEmail(req.body?.email);
    if (!A.isEmail(email)) throw new HttpError(400, 'Địa chỉ email không hợp lệ.');
    const ids = await A.identitiesOf(pool, c.aid);
    const mine = ids.find((x) => x.type === 'email' && x.value_norm === email);
    if (mine?.verified_at) throw new HttpError(409, 'Email này đã có trong tài khoản.');
    if (ids.filter((x) => x.type === 'email').length >= 10) throw new HttpError(400, 'Một tài khoản có tối đa 10 email.');
    if (!mine) await pool.query("insert into identities (account_id, type, value_norm) values ($1, 'email', $2) on conflict do nothing", [c.aid, email]);
    const tok = await A.newToken(pool, c.aid, 'email_verify', email, A.VERIFY_MS);
    const url = mail.publicUrl() + '/api/account/email/verify?t=' + encodeURIComponent(tok);
    await mail.send(pool, { kind: 'account', to: email, ...T.accountVerifyEmail({ url, minutes: A.VERIFY_MS / 60e3 }) });
    await A.event(pool, c.aid, 'email_added', { email }, req);
    res.json({ ok: true, sent: true });
  }));
  // The link in the mail. Works in any browser (the token names the account). Ends on the Account page.
  app.get('/api/account/email/verify', H(async (req, res) => {
    const back = (q) => res.redirect('/#tai-khoan?' + q);
    if (!A.hit('ev:ip:' + req.ip, 30, 3600e3)) return back('err=' + encodeURIComponent('Thử quá nhiều lần. Đợi một giờ.'));
    const t = await A.useToken(pool, String(req.query.t || ''), 'email_verify');
    if (!t) return back('err=' + encodeURIComponent('Đường dẫn xác minh đã hết hạn hoặc đã dùng. Thêm email lại để nhận đường dẫn mới.'));
    const other = await A.byEmail(pool, t.target);
    if (other && other !== t.account_id) return back('err=' + encodeURIComponent('Email này đã thuộc một tài khoản khác. Gộp tài khoản sẽ có sau.'));
    await pool.query("update identities set verified_at = now() where account_id = $1 and type = 'email' and value_norm = $2 and verified_at is null", [t.account_id, t.target]);
    await A.fillAccountIds(pool, t.account_id);
    await A.event(pool, t.account_id, 'email_verified', { email: t.target }, req);
    await notify(t.account_id, `Đã thêm email ${t.target} vào tài khoản`, req);
    back('ok=email');
  }));
  app.post('/api/account/emails/:id/primary', sameSite, HR(async (req, res) => {
    const c = await ctx(req, res); needFresh(c);
    const ids = await A.identitiesOf(pool, c.aid);
    if (!A.canBePrimary(ids, req.params.id)) throw new HttpError(400, 'Chỉ email đã xác minh mới làm email chính được.');
    const cl = await pool.connect();
    try {
      await cl.query('begin');
      await cl.query('update identities set is_primary = false where account_id = $1 and is_primary', [c.aid]);
      await cl.query('update identities set is_primary = true where account_id = $1 and id = $2', [c.aid, req.params.id]);
      await cl.query('commit');
    } catch (e) { await cl.query('rollback').catch(() => {}); throw e; } finally { cl.release(); }
    await A.event(pool, c.aid, 'primary_changed', {}, req);
    res.json({ ok: true });
  }));
  // Remove an email or unlink a provider. Keeps at least one sign-in method and one verified email.
  app.delete('/api/account/identities/:id', sameSite, HR(async (req, res) => {
    const c = await ctx(req, res); needFresh(c);
    if (!/^\d{1,18}$/.test(req.params.id)) throw new HttpError(400, 'Mã không hợp lệ.');
    const ids = await A.identitiesOf(pool, c.aid);
    const emails = A.verifiedEmails(ids).map((x) => x.value_norm);
    const why = A.removeBlock(ids, req.params.id, (await passkeysOf(emails)).length);
    if (why) throw new HttpError(why === 'Không tìm thấy.' ? 404 : 409, why);
    const x = ids.find((i) => String(i.id) === req.params.id);
    await pool.query('delete from identities where account_id = $1 and id = $2', [c.aid, req.params.id]);
    if (x.type === 'email' && x.verified_at) {
      // the email no longer carries this account's roles: rows that came only from it lose the account id
      await pool.query('update members set account_id = null where account_id = $1 and email = $2', [c.aid, x.value_norm]);
    }
    await A.event(pool, c.aid, x.type === 'email' ? 'email_removed' : x.type + '_unlinked', { value: x.value_norm }, req);
    await notify(c.aid, x.type === 'email' ? `Đã gỡ email ${x.value_norm} khỏi tài khoản` : `Đã gỡ liên kết ${x.type === 'google' ? 'Google' : x.type} (${x.value_norm})`, req);
    res.json({ ok: true });
  }));

  // Devices: sign out one (any of this account's sessions, this device included) or every other one.
  app.post('/api/account/sessions/:h/revoke', sameSite, HR(async (req, res) => {
    const c = await ctx(req, res);
    const { rows } = await pool.query('select id from sessions where account_id = $1 and revoked_at is null', [c.aid]);
    const row = rows.find((r) => handle(r.id) === req.params.h);
    if (!row) throw new HttpError(404, 'Không tìm thấy phiên này.');
    await A.revoke(pool, [row.id]);
    await A.event(pool, c.aid, 'session_revoked', { current: row.id === c.sid }, req);
    if (row.id === c.sid) { // this device: the account leaves the cookie, the others stay
      const accs = c.s.accs.filter((_, i) => i !== c.i);
      if (accs.length) writeSession(res, { accs, a: 0 }); else res.append('Set-Cookie', 'gp_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    }
    res.json({ ok: true, current: row.id === c.sid });
  }));
  app.post('/api/account/sessions/revoke-others', sameSite, HR(async (req, res) => {
    const c = await ctx(req, res); needFresh(c);
    const { rows } = await pool.query('select id from sessions where account_id = $1 and revoked_at is null and id <> $2', [c.aid, c.sid]);
    await A.revoke(pool, rows.map((r) => r.id));
    await A.event(pool, c.aid, 'sessions_revoked_others', { n: rows.length }, req);
    res.json({ ok: true, n: rows.length });
  }));
  return { notify };
}

module.exports = { mount };
