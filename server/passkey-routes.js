// Passkeys (WebAuthn): register on a signed-in account (a Google account, or an elder device), sign in with one without
// typing anything (discoverable credentials, empty allowCredentials). Verification is @simplewebauthn/server; challenges
// are one-time rows (passkey_challenges, 5 minutes). Rules (challenge life, counter, last-method guard, RP id) live in
// passkey-rules.js. Adding a passkey to a Google account needs a sign-in within 10 minutes (the same check as the Account
// page: the client gets { reauth: true } and sends the person through Google again).
'use strict';
const crypto = require('crypto');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const R = require('./elder-rules');
const A = require('./accounts');
const PR = require('./passkey-rules');

const RP_NAME = 'Gia phả họ Dương';
const NOT_VERIFIED = 'Không xác minh được vân tay hoặc Face ID.';
// The relying party id (see passkey-rules.rpIdFor); the origin is what the browser sees.
function rpFor(req) {
  const host = String(req.get('host') || '');
  return { rpID: PR.rpIdFor(host), origin: `${req.protocol}://${host}` };
}
const userIdOf = (key) => new Uint8Array(crypto.createHash('sha256').update(key).digest());

function mount(app, d) {
  const { pool, who, addAccount, readSessionAll, sameSite, H, HttpError, famOf, notify } = d;
  // The account a signed-in request acts as: a device, or a Google account with an active membership.
  async function accountOf(req) {
    const fam = await famOf(req);
    const w = await who(req, fam.id);
    if (w.device) return { key: 'd:' + w.device, label: w.name || 'Thiết bị', device: w.device, family: fam.id };
    if (w.email && w.status === 'active') {
      return { key: 'g:' + w.email, label: w.email, email: w.email, family: fam.id, aid: await A.byEmail(pool, w.email) };
    }
    throw new HttpError(401, 'Cần đăng nhập.');
  }
  // A Google account adds a passkey only after a fresh sign-in (its session's auth time, not the device's).
  function needFresh(a, req) {
    if (!a.email) return;
    const s = readSessionAll(req);
    const cur = s && s.accs[s.a];
    if (!A.fresh(cur?.at)) {
      const e = new HttpError(401, 'Vui lòng đăng nhập lại để xác nhận đây là bạn.');
      e.reauth = true;
      throw e;
    }
  }
  async function newChallenge(challenge, kind, account, family) {
    const id = R.newSecret(16);
    await pool.query('insert into passkey_challenges (id, challenge, kind, account, family_id, expires_at) values ($1,$2,$3,$4,$5,$6)',
      [id, challenge, kind, account, family, new Date(Date.now() + PR.CH_TTL_MS)]);
    return id;
  }
  // Takes a challenge once: a second use (or an expired one) finds nothing.
  const takeChallenge = async (id, kind) => {
    const { rows } = await pool.query('delete from passkey_challenges where id=$1 and kind=$2 and expires_at > now() returning *', [String(id || ''), kind]);
    return rows[0] || null;
  };

  app.get('/api/passkey/mine', H(async (req, res) => {
    const a = await accountOf(req);
    const { rows } = await pool.query('select count(*)::int as n from passkeys where account = $1', [a.key]);
    res.set('Cache-Control', 'no-store');
    res.json({ count: rows[0].n });
  }));

  app.post('/api/passkey/register/options', sameSite, H(async (req, res) => {
    const a = await accountOf(req);
    needFresh(a, req);
    const { rows: have } = await pool.query('select cred_id, transports from passkeys where account = $1', [a.key]);
    if (have.length >= PR.MAX_PASSKEYS) throw new HttpError(400, `Tối đa ${PR.MAX_PASSKEYS} passkey. Gỡ bớt trước khi thêm.`);
    const { rpID } = rpFor(req);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID, userName: a.label, userID: userIdOf(a.key), attestationType: 'none',
      excludeCredentials: have.map((r) => ({ id: r.cred_id, transports: r.transports })),
      // Discoverable (resident) key, so the sign-in needs no email; the person verifies with fingerprint or face.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    const ch = await newChallenge(options.challenge, 'reg', a.key, a.family);
    res.set('Cache-Control', 'no-store');
    res.json({ ch, options });
  }));

  app.post('/api/passkey/register/verify', sameSite, H(async (req, res) => {
    const a = await accountOf(req);
    needFresh(a, req);
    const row = await takeChallenge(req.body?.ch, 'reg');
    if (!row || row.account !== a.key) throw new HttpError(400, 'Phiên đăng ký đã hết hạn, thử lại.');
    const { rpID, origin } = rpFor(req);
    let v;
    try {
      v = await verifyRegistrationResponse({ response: req.body?.response, expectedChallenge: row.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
    } catch { throw new HttpError(400, NOT_VERIFIED); }
    if (!v.verified || !v.registrationInfo) throw new HttpError(400, NOT_VERIFIED);
    const c = v.registrationInfo.credential;
    const label = req.get('user-agent') ? R.deviceLabel(req.get('user-agent')) : 'Thiết bị';
    await pool.query('insert into passkeys (cred_id, public_key, counter, transports, account, account_id, family_id, label) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [c.id, Buffer.from(c.publicKey), c.counter, c.transports || [], a.key, a.aid || null, a.family, label]);
    if (a.aid) {
      await A.event(pool, a.aid, 'passkey_added', { label }, req);
      if (notify) await notify(a.aid, `Đã thêm passkey trên ${label}`, req);
    }
    res.json({ ok: true });
  }));

  // Sign in with a passkey (no session needed, no email typed): the passkey's account decides the cookie.
  app.post('/api/passkey/login/options', sameSite, H(async (req, res) => {
    const { rpID } = rpFor(req);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
    const ch = await newChallenge(options.challenge, 'auth', null, null);
    res.set('Cache-Control', 'no-store');
    res.json({ ch, options });
  }));
  app.post('/api/passkey/login/verify', sameSite, H(async (req, res) => {
    const row = await takeChallenge(req.body?.ch, 'auth');
    if (!row) throw new HttpError(400, 'Phiên đăng nhập đã hết hạn, thử lại.');
    const response = req.body?.response;
    const { rows: [pk] } = await pool.query('select * from passkeys where cred_id = $1', [String(response?.id || '')]);
    if (!pk) throw new HttpError(401, 'Không tìm thấy vân tay hoặc Face ID này.');
    const { rpID, origin } = rpFor(req);
    let v;
    try {
      v = await verifyAuthenticationResponse({ response, expectedChallenge: row.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: pk.cred_id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: pk.transports } });
    } catch { throw new HttpError(401, NOT_VERIFIED); }
    const newCounter = v.authenticationInfo?.newCounter ?? 0;
    // A counter that does not grow means a copied authenticator: refuse (when the authenticator counts at all).
    if (!v.verified || !PR.counterOk(pk.counter, newCounter)) throw new HttpError(401, NOT_VERIFIED);
    await pool.query('update passkeys set counter=$2, last_used_at=now() where id=$1', [pk.id, newCounter]);
    let acc;
    if (pk.account.startsWith('d:')) {
      const { rows } = await pool.query('select id, name from device_accounts where id=$1 and revoked_at is null and expires_at > now()', [pk.account.slice(2)]);
      if (!rows[0]) throw new HttpError(401, 'Thiết bị này đã đăng xuất. Đăng nhập lại bằng mã hoặc thẻ.');
      acc = { k: 'd', id: rows[0].id, name: rows[0].name || '' };
    } else {
      const email = pk.account.slice(2);
      const { rows } = await pool.query("select name from members where email=$1 and status='active' limit 1", [email]);
      if (!rows[0]) throw new HttpError(401, 'Tài khoản này chưa còn quyền trong dòng họ.');
      const aid = await A.byEmail(pool, email);
      if (!aid) throw new HttpError(401, 'Tài khoản này chưa còn quyền trong dòng họ.');
      // Like a Google sign-in: a server session and a fresh sign-in time for this account.
      const sid = await A.createSession(pool, aid, req);
      await A.event(pool, aid, 'signin', { via: 'passkey' }, req);
      acc = { k: 'g', email, name: rows[0].name || email, gn: '', fn: '', aid, sid, at: Date.now() };
    }
    if (!addAccount(req, res, acc)) throw new HttpError(409, 'Đã có 5 tài khoản trên thiết bị này. Đăng xuất bớt tài khoản để thêm.');
    res.json({ ok: true });
  }));
}

module.exports = { mount, rpFor };
