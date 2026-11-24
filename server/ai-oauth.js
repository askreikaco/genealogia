// OAuth 2.1 for AI clients: metadata (RFC 9728 / RFC 8414), dynamic client registration (RFC 7591), authorization code
// with PKCE (S256) after a consent in the app, token issue / refresh / revocation (RFC 7009), and the Settings APIs
// (connections, approval of AI requests). Tokens and codes are stored as sha256 hashes. Tested in test/ai-oauth.test.js.
'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const P = require('./ai-perm');
const T = require('./ai-tools');

const ACCESS_TTL_S = 3600; const REFRESH_TTL_MS = 30 * 86400e3; const CODE_TTL_MS = 600e3; const AUTH_TTL_MS = 600e3;
const MAX_CLIENTS = 500; const REG_PER_HOUR = Number(process.env.AI_REG_PER_HOUR) || 20; // per IP per hour (tests raise it)
const WEB = path.join(__dirname, '..', 'web');
const rnd = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const origin = (req) => `${req.protocol}://${req.get('host')}`;

// Redirect URIs: https, or http on this machine (native apps, e.g. http://localhost:PORT/callback). No fragments.
function okRedirect(u) {
  try {
    const x = new URL(u);
    if (x.hash) return false;
    if (x.protocol === 'https:') return true;
    return x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname);
  } catch { return false; }
}
function redirectWith(uri, params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}
// PKCE: BASE64URL(SHA256(verifier)) must equal the challenge stored at /oauth/authorize.
function pkceOk(verifier, challenge) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(crypto.createHash('sha256').update(verifier).digest('base64url'));
  const b = Buffer.from(String(challenge));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const readCookie = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{8,80})`).exec(req.headers.cookie || '')?.[1] || null;
const acctOf = (sess) => (sess.email ? { k: 'g', email: sess.email } : { k: 'c' });
const toErr = (res, e, next) => {
  if (e.status) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
  next(e);
};
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { toErr(res, e, next); } };

// Families this account may connect an AI to: the ones it is an active member of (a code account sees all).
async function connectableFamilies(deps, sess) {
  const { rows } = await deps.pool.query('select id, slug, name, han, visibility from families order by name');
  if (!sess.email) return rows.map((f) => ({ ...f, role: 'admin' }));
  const { rows: ms } = await deps.pool.query("select family_id, role from members where email = $1 and status = 'active'", [sess.email]);
  const roles = new Map(ms.map((m) => [m.family_id, m.role]));
  return rows.filter((f) => roles.has(f.id)).map((f) => ({ ...f, role: roles.get(f.id) }));
}
async function issueTokens(deps, { clientId, clientName, identity, accountKey, familyId, scopes, grantId }) {
  const access = 'gpat_' + rnd(32); const refresh = 'gpr_' + rnd(32);
  await deps.pool.query(
    `insert into ai_tokens (token_hash, refresh_hash, client_id, client_name, identity, account_key, family_id, scopes, expires_at, refresh_expires_at, grant_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(secs => $9), $10, $11)`,
    [sha(access), sha(refresh), clientId, clientName, JSON.stringify(identity), accountKey, familyId, scopes, ACCESS_TTL_S, new Date(Date.now() + REFRESH_TTL_MS), grantId]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: scopes.join(' ') };
}

function mountOAuth(app, deps) {
  const { pool } = deps;
  const regHits = new Map();
  const tokenErr = (res, error, description) => res.status(400).json({ error, error_description: description });

  // ---- metadata ----
  const protectedMeta = (req, res) => res.json({ resource: `${origin(req)}/mcp`, authorization_servers: [origin(req)], scopes_supported: P.SCOPES,
    bearer_methods_supported: ['header'], resource_name: 'Gia phả (giapha)' });
  app.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], protectedMeta);
  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    const o = origin(req);
    res.json({ issuer: o, authorization_endpoint: `${o}/oauth/authorize`, token_endpoint: `${o}/oauth/token`, registration_endpoint: `${o}/oauth/register`,
      revocation_endpoint: `${o}/oauth/revoke`, scopes_supported: P.SCOPES, response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
  });

  // ---- dynamic client registration (public clients, no secret) ----
  app.post('/oauth/register', wrap(async (req, res) => {
    const now = Date.now(); const ip = String(req.ip); const h = regHits.get(ip) || [];
    const recent = h.filter((t) => now - t < 3600e3);
    if (recent.length >= REG_PER_HOUR) return res.status(429).json({ error: 'too_many_requests', error_description: 'Đăng ký quá nhiều. Thử lại sau.' });
    regHits.set(ip, [...recent, now]);
    const b = req.body || {};
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 5 || !uris.every(okRedirect)) return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Địa chỉ quay lại không hợp lệ.' });
    if (b.token_endpoint_auth_method && b.token_endpoint_auth_method !== 'none') return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'Chỉ hỗ trợ client công khai (none).' });
    const { rows: c } = await pool.query('select count(*)::int n from ai_clients');
    if (c[0].n >= MAX_CLIENTS) return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'Đã đủ số ứng dụng AI.' });
    const name = String(b.client_name || 'Ứng dụng AI').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Ứng dụng AI';
    const clientId = 'c' + rnd(18);
    await pool.query('insert into ai_clients (client_id, client_name, redirect_uris) values ($1,$2,$3)', [clientId, name, uris]);
    res.status(201).json({ client_id: clientId, client_id_issued_at: Math.floor(now / 1000), client_name: name, redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
  }));

  // ---- authorization: validate, remember the request (cookie), send the person to the consent page ----
  app.get('/oauth/authorize', wrap(async (req, res) => {
    const q = req.query; const o = origin(req);
    const page = (code, msg) => res.status(code).type('html').send(`<!doctype html><meta charset="utf-8"><title>Không kết nối được</title><p>${msg}</p>`);
    const { rows } = await pool.query('select * from ai_clients where client_id = $1', [String(q.client_id || '')]);
    const client = rows[0];
    if (!client) return page(400, 'Ứng dụng AI này chưa đăng ký.');
    if (typeof q.redirect_uri !== 'string' || !client.redirect_uris.includes(q.redirect_uri)) return page(400, 'Địa chỉ quay lại không khớp với ứng dụng đã đăng ký.');
    const state = typeof q.state === 'string' && q.state.length <= 500 ? q.state : undefined;
    const fail = (error, description) => res.redirect(302, redirectWith(q.redirect_uri, { error, error_description: description, state }));
    if (q.response_type !== 'code') return fail('unsupported_response_type', 'Chỉ hỗ trợ response_type=code.');
    if (q.code_challenge_method !== 'S256' || typeof q.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge))
      return fail('invalid_request', 'Cần PKCE (S256).');
    if (q.resource && q.resource !== `${o}/mcp`) return fail('invalid_target', 'Tài nguyên không đúng.');
    const scopes = P.normalizeScopes(String(q.scope || 'read').split(/\s+/).filter(Boolean));
    if (!scopes) return fail('invalid_scope', 'Quyền không hợp lệ.');
    const id = rnd(24);
    await pool.query('insert into ai_auth_requests (id, client_id, redirect_uri, code_challenge, state, scopes, resource, expires_at) values ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8))',
      [id, client.client_id, q.redirect_uri, q.code_challenge, state || null, scopes, q.resource || null, AUTH_TTL_MS / 1000]);
    res.append('Set-Cookie', `gp_oa=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    res.redirect(302, '/oauth/consent');
  }));
  app.get('/oauth/consent', (req, res) => {
    res.set('X-Frame-Options', 'DENY').set('Cache-Control', 'no-store');
    res.sendFile(path.join(WEB, 'oauth-consent.html'));
  });
  // The pending request in the cookie (not expired), with its client.
  async function pending(req) {
    const id = readCookie(req, 'gp_oa');
    if (!id) return null;
    const { rows } = await pool.query('select a.*, c.client_name from ai_auth_requests a join ai_clients c on c.client_id = a.client_id where a.id = $1 and a.expires_at > now()', [id]);
    return rows[0] || null;
  }
  app.get('/api/oauth/request', wrap(async (req, res) => {
    const ar = await pending(req);
    res.set('Cache-Control', 'no-store');
    if (!ar) return res.status(404).json({ error: 'Yêu cầu này đã hết hạn. Hãy kết nối lại từ ứng dụng AI.' });
    const base = { client_name: ar.client_name, scopes: ar.scopes, redirect_host: new URL(ar.redirect_uri).host };
    const sess = deps.readSession(req);
    if (!sess) return res.json({ ...base, signed_in: false });
    const families = (await connectableFamilies(deps, sess)).map((f) => ({ id: f.id, slug: f.slug, name: f.name, han: f.han || '', visibility: f.visibility, role: f.role }));
    res.json({ ...base, signed_in: true, account: sess.name || sess.email || '', families });
  }));
  // The person's decision. allow: a code for the chosen family and the chosen scopes (a subset of the requested ones).
  app.post('/api/oauth/consent', deps.sameSite, wrap(async (req, res) => {
    const ar = await pending(req);
    if (!ar) return res.status(404).json({ error: 'Yêu cầu này đã hết hạn.' });
    const sess = deps.readSession(req);
    if (!sess) return res.status(401).json({ error: 'Đăng nhập để cho phép.' });
    const b = req.body || {};
    res.set('Cache-Control', 'no-store');
    await pool.query('delete from ai_auth_requests where id = $1', [ar.id]);
    res.append('Set-Cookie', 'gp_oa=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    if (b.decision !== 'allow') return res.json({ redirect: redirectWith(ar.redirect_uri, { error: 'access_denied', error_description: 'Người dùng từ chối.', state: ar.state || undefined }) });
    const fam = (await connectableFamilies(deps, sess)).find((f) => f.slug === b.family || f.id === b.family);
    if (!fam) return res.status(403).json({ error: 'Không chọn được dòng họ này.' });
    const scopes = P.normalizeScopes(b.scopes);
    if (!scopes || scopes.some((s) => !ar.scopes.includes(s))) return res.status(400).json({ error: 'Quyền không hợp lệ.' });
    const code = rnd(32);
    await pool.query(
      `insert into ai_codes (code_hash, client_id, redirect_uri, code_challenge, family_id, scopes, identity, account_key, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(secs => $9))`,
      [sha(code), ar.client_id, ar.redirect_uri, ar.code_challenge, fam.id, scopes,
        JSON.stringify({ name: sess.name || sess.email || '', email: sess.email || null }), deps.acctKey(acctOf(sess)), CODE_TTL_MS / 1000]);
    res.json({ redirect: redirectWith(ar.redirect_uri, { code, state: ar.state || undefined }), family: fam.slug, scopes });
  }));

  // ---- token endpoint: authorization_code (one use, PKCE) and refresh_token (rotated) ----
  app.post('/oauth/token', express.urlencoded({ extended: false }), wrap(async (req, res) => {
    const b = req.body || {};
    res.set('Cache-Control', 'no-store');
    if (b.grant_type === 'authorization_code') {
      const { rows } = await pool.query('delete from ai_codes where code_hash = $1 returning *', [sha(String(b.code || ''))]);
      const c = rows[0];
      if (!c || new Date(c.expires_at) < new Date()) return tokenErr(res, 'invalid_grant', 'Mã đã dùng hoặc hết hạn.');
      if (c.client_id !== b.client_id || c.redirect_uri !== b.redirect_uri) return tokenErr(res, 'invalid_grant', 'Ứng dụng hoặc địa chỉ quay lại không khớp.');
      if (!pkceOk(b.code_verifier, c.code_challenge)) return tokenErr(res, 'invalid_grant', 'Sai mã kiểm chứng PKCE.');
      const { rows: cl } = await pool.query('select client_name from ai_clients where client_id = $1', [c.client_id]);
      return res.json(await issueTokens(deps, { clientId: c.client_id, clientName: cl[0]?.client_name || 'Ứng dụng AI', identity: c.identity,
        accountKey: c.account_key, familyId: c.family_id, scopes: c.scopes, grantId: rnd(12) }));
    }
    if (b.grant_type === 'refresh_token') {
      // RFC 9700: a refresh token is used once. Presenting a rotated one again means it leaked: the whole grant is revoked.
      const { rows } = await pool.query('select * from ai_tokens where refresh_hash = $1', [sha(String(b.refresh_token || ''))]);
      const t = rows[0];
      if (!t || t.client_id !== b.client_id) return tokenErr(res, 'invalid_grant', 'Phiên đã hết hoặc đã thu hồi.');
      if (t.rotated_at) {
        await pool.query('update ai_tokens set revoked_at = now() where grant_id = $1 and revoked_at is null', [t.grant_id]);
        return tokenErr(res, 'invalid_grant', 'Phiên này đã bị thu hồi.');
      }
      if (t.revoked_at || new Date(t.refresh_expires_at) < new Date()) return tokenErr(res, 'invalid_grant', 'Phiên đã hết hoặc đã thu hồi.');
      await pool.query('update ai_tokens set revoked_at = now(), rotated_at = now() where id = $1', [t.id]); // rotation: the old pair stops here
      return res.json(await issueTokens(deps, { clientId: t.client_id, clientName: t.client_name, identity: t.identity, accountKey: t.account_key,
        familyId: t.family_id, scopes: t.scopes, grantId: t.grant_id }));
    }
    return tokenErr(res, 'unsupported_grant_type', 'Chỉ hỗ trợ authorization_code và refresh_token.');
  }));
  // Revocation (RFC 7009): the access or refresh token; always 200.
  app.post('/oauth/revoke', express.urlencoded({ extended: false }), wrap(async (req, res) => {
    const t = String(req.body?.token || '');
    if (t) await pool.query('update ai_tokens set revoked_at = now() where (token_hash = $1 or refresh_hash = $1) and revoked_at is null', [sha(t)]);
    res.status(200).end();
  }));

  // ---- Settings: connections of the active account (calm rows; revoke with confirm in the UI) ----
  app.get('/api/ai/connections', wrap(async (req, res) => {
    const sess = deps.readSession(req);
    if (!sess) return res.status(401).json({ error: 'Đăng nhập để xem.' });
    res.set('Cache-Control', 'no-store');
    const { rows } = await pool.query(
      `select t.id, t.client_name, t.scopes, t.created_at, t.last_used_at, f.slug, f.name as family_name
         from ai_tokens t join families f on f.id = t.family_id
        where t.account_key = $1 and t.revoked_at is null and t.refresh_expires_at > now() order by t.created_at desc limit 100`,
      [deps.acctKey(acctOf(sess))]);
    res.json({ items: rows.map((r) => ({ id: r.id, client_name: r.client_name, scopes: r.scopes, created_at: r.created_at, last_used_at: r.last_used_at,
      family: { slug: r.slug, name: r.family_name } })) });
  }));
  app.post('/api/ai/connections/:id/revoke', deps.sameSite, wrap(async (req, res) => {
    const sess = deps.readSession(req);
    if (!sess) return res.status(401).json({ error: 'Đăng nhập để thu hồi.' });
    const id = Number(req.params.id);
    const { rowCount } = await pool.query('update ai_tokens set revoked_at = now() where id = $1 and account_key = $2 and revoked_at is null', [id, deps.acctKey(acctOf(sess))]);
    if (!rowCount) return res.status(404).json({ error: 'Không tìm thấy kết nối này.' });
    res.json({ ok: true });
  }));

  // ---- Settings: AI requests waiting for an admin (families where this account is admin or owner) ----
  app.get('/api/ai/requests', wrap(async (req, res) => {
    const sess = deps.readSession(req);
    if (!sess) return res.status(401).json({ error: 'Đăng nhập để xem.' });
    res.set('Cache-Control', 'no-store');
    const { rows } = await pool.query(
      `select r.id, r.family_id, f.name as family_name, r.client_name, r.requested_by, r.action, r.payload, r.elicited, r.created_at
         from ai_requests r join families f on f.id = r.family_id where r.status = 'pending' order by r.created_at desc limit 200`);
    const items = [];
    for (const r of rows) {
      const w = await deps.whoFor(sess, r.family_id);
      if (P.ROLE_RANK[w.role] >= P.ROLE_RANK.admin) items.push({ id: r.id, family: { id: r.family_id, name: r.family_name }, client_name: r.client_name,
        requested_by: r.requested_by, action: r.action, payload: r.payload, elicited: r.elicited, created_at: r.created_at });
    }
    res.json({ items });
  }));
  const reqDeps = () => ({ pool, whoFor: deps.whoFor, findFamily: deps.findFamily, doInvite: deps.doInvite, doRoleChange: deps.doRoleChange,
    doRemove: deps.doRemove, actorName: deps.actorName, onWrite: deps.onWrite });
  app.post('/api/ai/requests/:id/approve', deps.sameSite, wrap(async (req, res) => {
    const sess = deps.readSession(req);
    if (!sess) return res.status(401).json({ error: 'Đăng nhập để duyệt.' });
    res.json(await T.approveRequest(reqDeps(), sess, Number(req.params.id)));
  }));
  app.post('/api/ai/requests/:id/reject', deps.sameSite, wrap(async (req, res) => {
    const sess = deps.readSession(req);
    if (!sess) return res.status(401).json({ error: 'Đăng nhập để từ chối.' });
    res.json(await T.rejectRequest(reqDeps(), sess, Number(req.params.id), req.body?.reason));
  }));
}

module.exports = { mountOAuth, okRedirect, pkceOk, redirectWith, sha };
