// Two-step sign-in (TOTP) and recovery codes. Account side (Tài khoản › Bảo mật): set up, confirm, regenerate, turn off;
// each needs a fresh sign-in (10 minutes). Sign-in side: when the account has it on, a Google sign-in (or a fresh
// sign-in for a change) stops after the first factor and asks for a code here (/api/auth/2fa/verify). A passkey
// sign-in is already strong and skips it. Rules: totp-rules.js. Secrets are never logged.
'use strict';
const crypto = require('crypto');
const QR = require('qrcode');
const A = require('./accounts');
const TR = require('./totp-rules');

const PENDING_MS = 5 * 60e3;
const PENDING_COOKIE = 'gp_2fa';
const ISSUER = 'Gia phả họ Dương';

// Is the second step on for this account? (an enrolment in progress does not count)
async function enabledFor(pool, aid) {
  const { rows } = await pool.query('select 1 from totp_factors where account_id = $1 and enabled', [aid]);
  return rows.length > 0;
}
// Status for the Account page: on or not, when it went on, and how many recovery codes are left.
async function statusOf(pool, aid) {
  const { rows: [f] } = await pool.query('select enabled, enabled_at from totp_factors where account_id = $1', [aid]);
  const { rows: [r] } = await pool.query('select count(*)::int as n from recovery_codes where account_id = $1 and used_at is null', [aid]);
  return { enabled: !!f?.enabled, since: f?.enabled ? f.enabled_at : null, recovery_left: f?.enabled ? r.n : 0 };
}
// Opens the second step for a sign-in (or a fresh sign-in): one row, its id in an HttpOnly cookie for five minutes.
async function beginTwoStep(pool, req, res, { aid, mode = '', sid = '', payload = {} }) {
  const tok = crypto.randomBytes(24).toString('base64url');
  await pool.query('insert into login_2fa (id, account_id, mode, sid, payload, expires_at) values ($1,$2,$3,$4,$5,$6)',
    [A.sha(tok), aid, mode, sid, payload, new Date(Date.now() + PENDING_MS)]);
  res.append('Set-Cookie', `${PENDING_COOKIE}=${tok}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${PENDING_MS / 1000}`);
}
const clearPending = (res) => res.append('Set-Cookie', `${PENDING_COOKIE}=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
// The stored secret, or null when it cannot be opened (the key changed): codes then fail; recovery codes still work.
function secretOf(key, enc) {
  try { return TR.open(key, enc); } catch { return null; }
}
const cookieOf = (req) => /(?:^|;\s*)gp_2fa=([A-Za-z0-9_-]{20,80})/.exec(req.headers.cookie || '')?.[1] || '';

function mount(app, d) {
  const { pool, readSessionAll, writeSession, addAccount, sameSite, H, HttpError, notify, secretKey, maxMsg } = d;
  const need = () => { if (!secretKey) throw new HttpError(503, 'Máy chủ chưa bật xác minh 2 bước.'); return secretKey; };
  const wrong = 'Mã chưa đúng. Kiểm tra đồng hồ trên điện thoại rồi thử lại.';
  const tooMany = 'Thử quá nhiều lần. Đợi 10 phút rồi thử lại.';

  // The signed-in Google account of this request (cookie session). Legacy cookies without an account id must reopen the page.
  function accountCtx(req) {
    const s = readSessionAll(req);
    const acc = s && s.accs[s.a];
    if (!acc) throw new HttpError(401, 'Cần đăng nhập.');
    if (acc.k !== 'g' || !acc.aid) throw Object.assign(new HttpError(401, 'Mở trang Tài khoản rồi thử lại.'), { reauth: true });
    return { s, acc, aid: acc.aid, sid: acc.sid, at: Number(acc.at) || 0 };
  }
  function needFresh(c) {
    if (!A.fresh(c.at)) throw Object.assign(new HttpError(401, 'Vui lòng đăng nhập lại để xác nhận đây là bạn.'), { reauth: true });
  }
  // System accounts (.invalid only, see system-accounts.js) do not use two-step sign-in.
  async function notSystem(aid) {
    const ids = await A.identitiesOf(pool, aid);
    const mail = A.verifiedEmails(ids).map((x) => x.value_norm);
    if (mail.length && mail.every((m) => m.endsWith('.invalid'))) throw new HttpError(403, 'Tài khoản hệ thống không dùng xác minh 2 bước.');
  }
  // Failed attempts: counted per account, refused while the window is full (checked before the code is read).
  async function checkBlocked(aid) {
    const { rows: [f] } = await pool.query('select fail_count, fail_at from totp_factors where account_id = $1', [aid]);
    if (TR.attemptsState(f?.fail_count, f?.fail_at).blocked) throw new HttpError(429, tooMany);
  }
  async function recordFail(aid, req) {
    await pool.query(`update totp_factors set
        fail_count = case when fail_at is null or fail_at < now() - ($2::bigint * interval '1 millisecond') then 1 else fail_count + 1 end,
        fail_at = case when fail_at is null or fail_at < now() - ($2::bigint * interval '1 millisecond') then now() else fail_at end
      where account_id = $1`, [aid, TR.ATTEMPT_WIN_MS]);
    await A.event(pool, aid, 'totp_failed', {}, req);
  }
  const clearFails = (aid) => pool.query('update totp_factors set fail_count = 0, fail_at = null where account_id = $1', [aid]);
  // Replaces the recovery codes (all old ones stop working). Returns the new codes, shown once.
  async function issueRecovery(cl, aid) {
    await cl.query('delete from recovery_codes where account_id = $1', [aid]);
    const codes = TR.newRecoveryCodes();
    for (const c of codes) await cl.query('insert into recovery_codes (account_id, code_hash) values ($1, $2)', [aid, TR.hashRecovery(c)]);
    return codes;
  }
  // A code (6 digits, once per 30 s step) or a recovery code (8 characters, once). true when it is accepted.
  async function checkCode(aid, key, raw) {
    const c = String(raw || '').replace(/[\s-]/g, '');
    if (/^\d{6}$/.test(c)) {
      const { rows: [f] } = await pool.query('select secret_enc, last_step from totp_factors where account_id = $1 and enabled', [aid]);
      if (!f) return false;
      const sec = secretOf(key, f.secret_enc);
      const step = sec && TR.matchStep(sec, c, Date.now(), f.last_step);
      if (!step) return false;
      // claimed in the same statement: two requests with one code cannot both pass
      const { rowCount } = await pool.query('update totp_factors set last_step = $2 where account_id = $1 and last_step < $2', [aid, step]);
      return rowCount === 1;
    }
    if (TR.isRecoveryShape(c)) {
      const { rows } = await pool.query('select id, code_hash from recovery_codes where account_id = $1 and used_at is null', [aid]);
      const hit = rows.find((r) => TR.checkRecovery(c, r.code_hash));
      if (!hit) return false;
      const { rowCount } = await pool.query('update recovery_codes set used_at = now() where id = $1 and used_at is null', [hit.id]);
      return rowCount === 1;
    }
    return false;
  }

  // ---- account side ----
  app.post('/api/account/totp/setup', sameSite, H(async (req, res) => {
    const key = need(); const c = accountCtx(req); needFresh(c); await notSystem(c.aid);
    const secret = TR.newSecret();
    const { rowCount } = await pool.query(`insert into totp_factors (account_id, secret_enc) values ($1, $2)
      on conflict (account_id) do update set secret_enc = excluded.secret_enc, enabled = false, last_step = 0, fail_count = 0, fail_at = null
      where totp_factors.enabled = false`, [c.aid, TR.seal(key, secret)]);
    if (!rowCount) throw new HttpError(409, 'Xác minh 2 bước đã bật. Tắt trước khi thiết lập lại.');
    const uri = TR.otpauthUri({ secret, account: c.acc.email, issuer: ISSUER });
    res.set('Cache-Control', 'no-store');
    res.json({ secret: TR.base32Encode(secret), uri, qr: await QR.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
  }));
  app.post('/api/account/totp/confirm', sameSite, H(async (req, res) => {
    const key = need(); const c = accountCtx(req); needFresh(c);
    const { rows: [f] } = await pool.query('select secret_enc, last_step from totp_factors where account_id = $1 and enabled = false', [c.aid]);
    if (!f) throw new HttpError(400, 'Chưa bắt đầu thiết lập. Bấm Bật lại từ đầu.');
    await checkBlocked(c.aid);
    const sec = secretOf(key, f.secret_enc);
    if (!sec) throw new HttpError(409, 'Không đọc được khóa đã lưu. Bấm Bật lại từ đầu.');
    const step = TR.matchStep(sec, req.body?.code, Date.now(), 0);
    if (step === null) { await recordFail(c.aid, req); throw new HttpError(401, wrong); }
    const cl = await pool.connect();
    let codes;
    try {
      await cl.query('begin');
      const { rowCount } = await cl.query('update totp_factors set enabled = true, enabled_at = now(), last_step = $2, fail_count = 0, fail_at = null where account_id = $1 and enabled = false', [c.aid, step]);
      if (!rowCount) throw new HttpError(409, 'Xác minh 2 bước đã bật.');
      codes = await issueRecovery(cl, c.aid);
      await cl.query('commit');
    } catch (e) { await cl.query('rollback').catch(() => {}); throw e; } finally { cl.release(); }
    await A.event(pool, c.aid, 'totp_enabled', {}, req);
    if (notify) await notify(c.aid, 'Đã bật xác minh 2 bước', req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, recovery_codes: codes });
  }));
  app.post('/api/account/totp/recovery', sameSite, H(async (req, res) => {
    const c = accountCtx(req); needFresh(c);
    if (!(await enabledFor(pool, c.aid))) throw new HttpError(400, 'Bật xác minh 2 bước trước.');
    const cl = await pool.connect();
    let codes;
    try { await cl.query('begin'); codes = await issueRecovery(cl, c.aid); await cl.query('commit'); } catch (e) { await cl.query('rollback').catch(() => {}); throw e; } finally { cl.release(); }
    await A.event(pool, c.aid, 'recovery_regenerated', {}, req);
    if (notify) await notify(c.aid, 'Đã tạo mã khôi phục mới; mã cũ không còn dùng được', req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, recovery_codes: codes });
  }));
  app.delete('/api/account/totp', sameSite, H(async (req, res) => {
    const c = accountCtx(req); needFresh(c);
    const cl = await pool.connect();
    try {
      await cl.query('begin');
      await cl.query('delete from recovery_codes where account_id = $1', [c.aid]);
      await cl.query('delete from totp_factors where account_id = $1', [c.aid]);
      await cl.query('commit');
    } catch (e) { await cl.query('rollback').catch(() => {}); throw e; } finally { cl.release(); }
    await A.event(pool, c.aid, 'totp_disabled', {}, req);
    if (notify) await notify(c.aid, 'Đã tắt xác minh 2 bước', req);
    res.json({ ok: true });
  }));

  // ---- sign-in side: the second step ----
  async function pendingRow(req) {
    const tok = cookieOf(req);
    if (!tok) return null;
    const { rows: [row] } = await pool.query('select * from login_2fa where id = $1 and expires_at > now()', [A.sha(tok)]);
    return row || null;
  }
  app.get('/api/auth/2fa/state', H(async (req, res) => {
    const row = await pendingRow(req);
    res.set('Cache-Control', 'no-store');
    res.json({ pending: !!row, email: row?.payload?.email || '' });
  }));
  app.post('/api/auth/2fa/verify', sameSite, H(async (req, res) => {
    const key = need();
    const row = await pendingRow(req);
    if (!row || !(await enabledFor(pool, row.account_id))) { clearPending(res); throw new HttpError(401, 'Phiên xác minh đã hết hạn. Đăng nhập lại.'); }
    await checkBlocked(row.account_id);
    if (!(await checkCode(row.account_id, key, req.body?.code))) {
      await recordFail(row.account_id, req);
      throw new HttpError(401, wrong);
    }
    await clearFails(row.account_id);
    // the pending row is used once: a second request that raced this one finds nothing to finish
    const { rowCount } = await pool.query('delete from login_2fa where id = $1', [row.id]);
    clearPending(res);
    if (rowCount !== 1) throw new HttpError(401, 'Phiên xác minh đã hết hạn. Đăng nhập lại.');
    res.set('Cache-Control', 'no-store');
    if (row.mode === 'reauth') { // a fresh sign-in for a sensitive change: renew this device's sign-in time
      const s = readSessionAll(req);
      const acc = s && s.accs[s.a];
      if (!acc || acc.k !== 'g' || acc.aid !== row.account_id || acc.sid !== row.sid) throw new HttpError(401, 'Mở trang Tài khoản rồi thử lại.');
      await pool.query('update sessions set auth_at = now() where id = $1 and account_id = $2', [row.sid, row.account_id]);
      await A.event(pool, row.account_id, 'reauth', { two_step: true }, req);
      const accs = s.accs.slice(); accs[s.a] = { ...acc, at: Date.now() };
      writeSession(res, { accs, a: s.a });
      return res.json({ ok: true, to: row.payload?.to || '/' });
    }
    // a sign-in: the session starts now, after both factors
    const p = row.payload || {};
    const sid = await A.createSession(pool, row.account_id, req);
    await A.event(pool, row.account_id, 'signin', { via: p.via || 'google', two_step: true }, req);
    if (!addAccount(req, res, { k: 'g', email: p.email, name: p.name, gn: p.gn || '', fn: p.fn || '', aid: row.account_id, sid, at: Date.now() })) {
      await A.revoke(pool, [sid]);
      throw new HttpError(409, maxMsg);
    }
    res.json({ ok: true, to: p.to || '/' });
  }));
}

module.exports = { mount, enabledFor, statusOf, beginTwoStep };
