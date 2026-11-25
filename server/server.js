// genealogia server: static web app + JSON API.
// Public: read people, export. Login (editor code -> signed cookie): push edits.
'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');
const { FIELDS, publicView, withContacts, validateOp, validateValue, mergeOp, DELETE, isDead } = require('./core');
const SR = require('./surname-rules');
const REL = require('./relations');
const BRN = require('./branch-routes'); // branch trees by reference (reads, ops and suggestions of a branch)
const { RelError, readRel, withRel, applyRelOp, isTable, LEGACY } = REL;
const succession = require('./succession');
const mail = require('./mail');
const ACC = require('./accounts');
const mountElder = require('./elder-routes').mount;
const T = require('./mail-templates');
const TRASH = require('./trash');
const DEC = require('./decisions');
const NEWS = require('./news');
const mountSuccession = require('./succession-routes');
const mountLinks = require('./links-routes').mount;
const mountMatch = require('./match-routes').mount;
const mountClan = require('./clan-routes').mount;
const mountPlaces = require('./places-routes').mount;
const mountPlacesCurate = require('./places-curate-routes').mount;
const mountVariants = require('./variants-routes').mount;
const mountGedcom = require('./gedcom-routes');
const TWO = require('./totp-routes');
const TOTP_RULES = require('./totp-rules');
const EV = require('./events');
const { mountOAuth } = require('./ai-oauth');
const { mountMcp } = require('./ai-mcp');

const PORT = Number(process.env.PORT || 3090);
const SECRET = process.env.SESSION_SECRET || '';
// EDITORS="Tên hiển thị:sha256(code),Tên khác:sha256(code)" — codes are never stored in plain text.
// Optional family per entry: "Name:familyId:sha256(code)". Without it the code works in DEFAULT_FAMILY only (family null here).
const EDITORS = (process.env.EDITORS || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  const i = s.lastIndexOf(':'); const head = s.slice(0, i); const j = head.lastIndexOf(':');
  return j < 0 ? { name: head, family: null, hash: s.slice(i + 1).toLowerCase() }
    : { name: head.slice(0, j), family: head.slice(j + 1), hash: s.slice(i + 1).toLowerCase() };
});
if (!SECRET || SECRET.length < 32) console.warn('SESSION_SECRET missing or short: logins disabled');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
// Anonymous suggestions get a 20 KB body limit; everything else keeps 1 MB.
const jsonBig = express.json({ limit: '1mb' }); const jsonSmall = express.json({ limit: '20kb' }); const jsonImport = express.json({ limit: '10mb' });
app.use((req, res, next) => (req.path === '/api/suggest' ? jsonSmall : req.path === '/api/gedcom/import' ? jsonImport : jsonBig)(req, res, next));
// Server-side sessions (accounts.js): an account whose session row was revoked (Tài khoản › Thiết bị) is signed out of
// this device on its next request. Cookies from before sessions carry no session id and stay valid until they expire.
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  try { const s = readSessionAll(req); const sids = s ? s.accs.map((x) => x.sid).filter(Boolean) : []; if (sids.length) req._goneSids = await ACC.revokedOf(pool, sids); } catch (e) { console.error('session gate', e.message); }
  next();
});

// ---- session (HMAC-signed cookie, 30 days, httpOnly) ----
// One cookie holds every account signed in on this device: accs = [{k:'g', email, name, gn, fn} | {k:'c', name}]
// (k 'g' = Google account, k 'c' = editor code, at most one), a = index of the active account, at most MAX_ACCOUNTS.
// Older cookies (one account, no accs) read as a list of one.
const MAX_ACCOUNTS = 5;
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const EMAIL_RE = /^[^\s@]{1,200}@[^\s@]{1,200}$/;
const R_ID = /^[a-f0-9]{32}$/; // device account id (elder-routes.js)
function readSessionAll(req) {
  const m = /(?:^|;\s*)gp_s=([^;]+)/.exec(req.headers.cookie || '');
  if (!m || !SECRET) return null;
  const [body, sig] = decodeURIComponent(m[1]).split('.');
  if (!body || !sig || sign(body) !== sig) return null;
  let s; try { s = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!(s.exp > Date.now())) return null;
  const raw = Array.isArray(s.accs) ? s.accs : [{ k: s.email ? 'g' : 'c', name: s.name, email: s.email, gn: s.gn, fn: s.fn }];
  const accs = [];
  for (const x of raw.slice(0, MAX_ACCOUNTS)) {
    if (x?.k === 'c' && !accs.some((y) => y.k === 'c')) accs.push({ k: 'c', name: String(x.name || '').slice(0, 120) });
    else if (x?.k === 'd' && R_ID.test(String(x.id || '')) && !accs.some((y) => y.id === x.id)) accs.push({ k: 'd', id: String(x.id), name: String(x.name || '').slice(0, 120) });
    else if (x?.k === 'g' && EMAIL_RE.test(String(x.email || '')) && !accs.some((y) => y.email === x.email)) {
      accs.push({ k: 'g', email: String(x.email).toLowerCase(), name: String(x.name || '').slice(0, 120), gn: String(x.gn || '').slice(0, 80), fn: String(x.fn || '').slice(0, 80),
        // account id, server session id and the time of the last sign-in (re-auth window); absent on older cookies
        ...(ACC.UUID_RE.test(String(x.aid || '')) && ACC.SID_RE.test(String(x.sid || '')) ? { aid: String(x.aid), sid: String(x.sid), at: Number(x.at) || 0 } : {}) });
    }
  }
  if (!accs.length) return null;
  const a = Number.isInteger(s.a) && s.a >= 0 && s.a < accs.length ? s.a : 0;
  const gone = req._goneSids; // revoked sessions: those accounts are no longer signed in on this device
  if (gone && gone.size && accs.some((x) => x.sid && gone.has(x.sid))) {
    const act = accs[a]; const left = accs.filter((x) => !(x.sid && gone.has(x.sid)));
    return left.length ? { accs: left, a: Math.max(0, left.indexOf(act)), exp: s.exp } : null;
  }
  return { accs, a, exp: s.exp };
}
// The active account in the shape the rest of the server reads: { name, email?, gn?, fn?, exp }. null = not signed in.
function readSession(req) {
  const s = readSessionAll(req);
  if (!s) return null;
  const acc = s.accs[s.a];
  if (acc.k === 'd') return { name: acc.name, dev: acc.id, exp: s.exp };
  return acc.k === 'c' ? { name: acc.name, exp: s.exp } : { name: acc.name, email: acc.email, gn: acc.gn, fn: acc.fn, aid: acc.aid, sid: acc.sid, at: acc.at, exp: s.exp };
}
function writeSession(res, s) {
  const body = Buffer.from(JSON.stringify({ accs: s.accs, a: s.a, exp: Date.now() + 30 * 86400e3 })).toString('base64url');
  res.append('Set-Cookie', `gp_s=${encodeURIComponent(body + '.' + sign(body))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`);
}
const clearSession = (res) => res.append('Set-Cookie', 'gp_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
const sameAcc = (x, y) => x.k === y.k && (x.k === 'c' || (x.k === 'd' ? x.id === y.id : x.email === y.email));
// Adds an account (or refreshes it) and makes it the active one. Returns false when the device already holds MAX_ACCOUNTS others.
function addAccount(req, res, acc) {
  const cur = readSessionAll(req) || { accs: [], a: 0 };
  const accs = cur.accs.slice();
  const i = accs.findIndex((x) => sameAcc(x, acc));
  if (i >= 0) accs[i] = { ...accs[i], ...acc };
  else if (accs.length >= MAX_ACCOUNTS) return false;
  else accs.push(acc);
  writeSession(res, { accs, a: i >= 0 ? i : accs.length - 1 });
  return true;
}
// Account key: stable, not reversible to the email. Used by the client for per-account device storage.
const acctKey = (acc) => (acc.k === 'c' ? 'code' : acc.k === 'd' ? 'd-' + acc.id.slice(0, 24) : 'g-' + crypto.createHash('sha256').update(acc.email).digest('hex').slice(0, 24));
// Same-site guard for account changes: a cross-site page cannot make the browser send these (SameSite=Lax + this check).
function sameSite(req, res, next) {
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return res.status(403).json({ error: 'Yêu cầu từ trang khác bị chặn.' });
  const origin = req.get('origin');
  if (origin) { let host = ''; try { host = new URL(origin).host; } catch {} if (host !== req.get('host')) return res.status(403).json({ error: 'Yêu cầu từ trang khác bị chặn.' }); }
  if (!req.is('application/json')) return res.status(415).json({ error: 'Gửi dữ liệu dạng JSON.' });
  next();
}
// ---- roles (per family; see migrations/005 and 008) ----
// Editor-code session (no email) = admin in every family, as before. Google session (email) = the members row for
// that email in THAT family, read on every request so a removal or role change applies at once. No active row = guest.
const { ROLE_RANK } = require('./ai-perm'); // one order for web and AI (guest < member < editor < admin < owner)
const ROLES = ['owner', 'admin', 'editor', 'member'];
const isTop = (r) => r === 'owner' || r === 'admin';
const DEFAULT_FAMILY = 'duong';
// The family an editor code works in: its EDITORS entry's family, DEFAULT_FAMILY when it names none, null if unknown.
const codeFamily = (name) => { const e = EDITORS.find((x) => x.name === name); return e ? (e.family || DEFAULT_FAMILY) : null; };
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
// Route wrapper: HttpError -> its status and message; anything else -> the error handler.
const H = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (e) { if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.reauth ? { reauth: true } : {}) }); next(e); }
};
// Family by id or slug. Only lower-case letters, digits and dashes are accepted.
async function findFamily(ref) {
  const r = String(ref || '');
  if (!/^[a-z0-9-]{1,60}$/.test(r)) return null;
  const { rows } = await pool.query('select * from families where id=$1 or slug=$1 order by (id=$1) desc limit 1', [r]);
  return rows[0] || null;
}
// The family a request is about: ?family= (or body.family), id or slug; default 'duong' (old unscoped URLs).
async function famOf(req) {
  if (req.fam) return req.fam;
  const ref = req.query?.family ?? req.body?.family ?? DEFAULT_FAMILY;
  const f = await findFamily(typeof ref === 'string' ? ref : '');
  if (!f) throw new HttpError(404, 'Không tìm thấy dòng họ.');
  req.fam = f; return f;
}
// Private families: members only. Public and link families: anyone (link ones are reached by slug only).
const canRead = (f, w) => f.visibility !== 'private' || ROLE_RANK[w.role] >= ROLE_RANK.member;
async function who(req, famId = DEFAULT_FAMILY) {
  req.whoCache = req.whoCache || {};
  if (req.whoCache[famId]) return req.whoCache[famId];
  const w = await whoFor(readSession(req), famId);
  req.whoCache[famId] = w; req.who = w; return w;
}
// The role of a session in one family, for a cookie session (readSession shape) or an AI token's identity ({ name, email? }).
// No email = editor code (admin everywhere). Used by who() and by the AI connections (ai-tools.js), so both apply one rule.
async function whoFor(s, famId = DEFAULT_FAMILY) {
  let w = { role: 'guest', status: null, person_id: null, email: null, name: null, editor: null, code: false, memberId: null, family: famId };
  if (s && s.dev) { // device account (elder-routes.js): a member of its family while the device is not revoked or expired
    const { rows } = await pool.query('select id, person_id, name from device_accounts where id = $1 and family_id = $2 and revoked_at is null and expires_at > now()', [s.dev, famId]);
    const d = rows[0];
    w = { role: d ? 'member' : 'guest', status: d ? 'active' : null, person_id: d ? d.person_id : null, email: null, name: d ? d.name : null, editor: null, code: false, memberId: null, family: famId, device: d ? d.id : null, devicePerson: d ? d.person_id : null };
  } else if (s && !s.email) { // editor code: the same rights as before (admin), in its own family only; guest everywhere else
    const own = codeFamily(s.name) === famId;
    w = own ? { role: 'admin', status: 'active', person_id: null, email: null, name: s.name, editor: s.name, code: true, memberId: null, family: famId }
      : { role: 'guest', status: null, person_id: null, email: null, name: s.name, editor: null, code: false, memberId: null, family: famId };
  } else if (s) {
    const emails = s.aid ? [...new Set([s.email, ...await ACC.emailsOf(pool, s.aid)])] : [s.email];
    const { rows } = await pool.query(`select id, role, status, person_id, name, email from members where family_id = $2 and (email = any($1) or ($3::uuid is not null and account_id = $3::uuid))
      order by (status = 'active') desc, array_position(array['owner','admin','editor','member'], role), (email = $4) desc limit 1`, [emails, famId, s.aid || null, s.email]);
    const m = rows[0]; const active = !!m && m.status === 'active';
    w = { role: active ? m.role : 'guest', status: m ? m.status : null, person_id: active ? m.person_id : null,
      email: s.email, name: (m && m.name) || s.name || s.email, editor: active ? (m.name || s.name || s.email) : null, code: false,
      memberId: m ? m.id : null, family: famId };
    // The owner signing in is the answer to any open handover (notice, offers, death report, claim): it stops them.
    if (active && m.role === 'owner') {
      try { await succession.cancelOpen(pool, famId, m.email, Date.now()); } catch (e) { console.error('owner sign-in', e.message); }
    }
    if (m) // last_seen_at: at most one write an hour, not on every request
      pool.query("update members set last_seen_at = now() where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '1 hour')", [m.id]).catch(() => {});
  }
  return w;
}
// Active roles of a Google account in every family: { family_id: role }. Editor-code sessions are not listed.
async function rolesByFamily(req) {
  const s = readSession(req);
  if (s?.dev) { // an elder device: member of its family while not revoked (elder-routes.js)
    const { rows } = await pool.query('select family_id from device_accounts where id = $1 and revoked_at is null and expires_at > now()', [s.dev]);
    return Object.fromEntries(rows.map((r) => [r.family_id, 'member']));
  }
  if (!s?.email) { // editor code: its own family only, as admin (as before this change)
    const own = s && !s.dev && s.name ? codeFamily(s.name) : null;
    return own ? { [own]: 'admin' } : {};
  }
  const emails = s.aid ? [...new Set([s.email, ...await ACC.emailsOf(pool, s.aid)])] : [s.email];
  const { rows } = await pool.query("select family_id, role from members where status='active' and (email = any($1) or ($2::uuid is not null and account_id = $2::uuid))", [emails, s.aid || null]);
  const out = {}; // the highest role per family when several emails of the account are members
  for (const r of rows) if (!out[r.family_id] || ROLE_RANK[r.role] > ROLE_RANK[out[r.family_id]]) out[r.family_id] = r.role;
  return out;
}
// Gate: min role in the family the request is about. Not signed in -> 401; signed in without the role -> 403.
function need(min) {
  return async (req, res, next) => {
    try {
      const f = await famOf(req);
      const w = await who(req, f.id);
      if (ROLE_RANK[w.role] >= ROLE_RANK[min]) return next();
      if (w.email || w.code) return res.status(403).json({ error: 'Tài khoản này chưa có quyền cho việc này.' });
      return res.status(401).json({ error: 'Cần đăng nhập để sửa.' });
    } catch (e) { next(e); }
  };
}
// Same gate for a handler whose family comes from a row (suggestions, members): throws HttpError.
async function requireRole(req, famId, min) {
  const w = await who(req, famId);
  if (ROLE_RANK[w.role] >= ROLE_RANK[min]) return w;
  if (w.email || w.code) throw new HttpError(403, 'Tài khoản này chưa có quyền cho việc này.');
  throw new HttpError(401, 'Cần đăng nhập để sửa.');
}
const canSeePrivate = (w) => ROLE_RANK[w.role] >= ROLE_RANK.member;

const tries = new Map(); // ip -> [count, firstAt]
app.post('/api/login', (req, res) => {
  const ip = req.ip; const t = tries.get(ip) || [0, Date.now()];
  if (Date.now() - t[1] > 15 * 60e3) { t[0] = 0; t[1] = Date.now(); }
  if (t[0] >= 10) return res.status(429).json({ error: 'Thử quá nhiều lần. Đợi 15 phút.' });
  const code = String(req.body?.code || '');
  const h = crypto.createHash('sha256').update(code).digest('hex');
  const ed = SECRET && EDITORS.find((e) => e.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(e.hash), Buffer.from(h)));
  if (!ed) { t[0]++; tries.set(ip, t); return res.status(401).json({ error: 'Mã không đúng.' }); }
  if (!addAccount(req, res, { k: 'c', name: ed.name })) return res.status(409).json({ error: MAX_MSG });
  res.json({ name: ed.name });
});
// ---- Google sign-in (on when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set) ----
// GOOGLE_EDITORS="email@x.com:Tên hiển thị,other@y.com:Tên" seeds the members table (migrations + members-seed.js).
// Any verified Google account can sign in; what it may do comes from its members row (guest if none).
const G_ID = process.env.GOOGLE_CLIENT_ID || ''; const G_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const G_EDITORS = new Map((process.env.GOOGLE_EDITORS || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  const i = s.indexOf(':'); return i < 0 ? [s.toLowerCase(), s] : [s.slice(0, i).trim().toLowerCase(), s.slice(i + 1).trim()];
}));
const G_ON = !!(G_ID && G_SECRET && SECRET);
const G_REDIRECT = (req) => `https://${req.get('host')}/api/auth/google/callback`;
const MAX_MSG = 'Đã có 5 tài khoản trên thiết bị này. Đăng xuất bớt tài khoản để thêm.';
app.get('/api/auth/google', (req, res) => {
  if (!G_ON) return res.status(404).send('Chưa bật đăng nhập Google.');
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `gp_g=${state}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  // ?next=<hash>: come back to that app screen after sign-in (letters, digits, / - _ only; e.g. join, tat-ca/tree)
  const next = /^[a-z0-9/_-]{1,80}$/i.test(String(req.query.next || '')) ? String(req.query.next) : '';
  res.append('Set-Cookie', `gp_n=${next}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  // ?mode=reauth: confirm it is you (fresh sign-in for sensitive changes); ?mode=link: add this Google account to the signed-in account
  const mode = ['reauth', 'link'].includes(req.query.mode) ? req.query.mode : '';
  res.append('Set-Cookie', `gp_m=${mode}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const q = new URLSearchParams({ client_id: G_ID, redirect_uri: G_REDIRECT(req), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + q);
});
app.get('/api/auth/google/callback', async (req, res) => {
  const fail = (m) => res.redirect('/#login-error=' + encodeURIComponent(m));
  try {
    if (!G_ON) return fail('Chưa bật đăng nhập Google.');
    const st = /(?:^|;\s*)gp_g=([0-9a-f]{32})/.exec(req.headers.cookie || '')?.[1];
    if (!st || st !== req.query.state || !req.query.code) return fail('Phiên đăng nhập hết hạn, thử lại.');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(req.query.code), client_id: G_ID, client_secret: G_SECRET, redirect_uri: G_REDIRECT(req), grant_type: 'authorization_code' }) });
    if (!r.ok) return fail('Google từ chối đăng nhập.');
    const { id_token } = await r.json();
    // id_token came straight from Google over TLS with our secret: payload is trusted (no extra signature check needed)
    const c = JSON.parse(Buffer.from(String(id_token).split('.')[1] || '', 'base64url').toString());
    if (c.aud !== G_ID || !c.email_verified) return fail('Email Google chưa xác minh.');
    const email = String(c.email).toLowerCase();
    const sub = String(c.sub || '');
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(sub)) return fail('Google không gửi mã tài khoản.');
    res.append('Set-Cookie', 'gp_g=; Path=/api/auth; Max-Age=0');
    const mode = /(?:^|;\s*)gp_m=(reauth|link)(?:;|$)/.exec(req.headers.cookie || '')?.[1] || '';
    res.append('Set-Cookie', 'gp_m=; Path=/api/auth; Max-Age=0');
    if (mode) return googleAccountMode(req, res, mode, { sub, email, name: c.name });
    // Google's own name parts (for the join form's Họ / Tên); a bare full name is never split by us.
    // The account joins the list on this device and becomes the active one.
    const r2 = await ACC.resolveGoogle(pool, { sub, email, name: G_EDITORS.get(email) || c.name || email });
    const next = /(?:^|;\s*)gp_n=([a-z0-9/_-]{1,80})(?:;|$)/i.exec(req.headers.cookie || '')?.[1] || '';
    res.append('Set-Cookie', 'gp_n=; Path=/api/auth; Max-Age=0');
    const to = next === 'oauth/consent' ? '/oauth/consent' : next ? '/#' + next : '/'; // consent page: its own screen
    // Two-step sign-in on: the first factor is done, the session waits for the code (totp-routes.js)
    if (await TWO.enabledFor(pool, r2.accountId)) {
      if (r2.linked && !r2.created) await ACC.event(pool, r2.accountId, 'google_linked', { value: email }, req);
      await TWO.beginTwoStep(pool, req, res, { aid: r2.accountId, payload: { email, name: G_EDITORS.get(email) || c.name || email, gn: String(c.given_name || '').slice(0, 80), fn: String(c.family_name || '').slice(0, 80), to, via: 'google' } });
      return res.redirect('/#dang-nhap-2fa');
    }
    const sid = await ACC.createSession(pool, r2.accountId, req);
    await ACC.event(pool, r2.accountId, r2.created ? 'account_created' : 'signin', { via: 'google' }, req);
    if (r2.linked && !r2.created) await ACC.event(pool, r2.accountId, 'google_linked', { value: email }, req);
    const added = addAccount(req, res, { k: 'g', email, name: G_EDITORS.get(email) || c.name || email, gn: String(c.given_name || '').slice(0, 80), fn: String(c.family_name || '').slice(0, 80), aid: r2.accountId, sid, at: Date.now() });
    if (!added) await ACC.revoke(pool, [sid]);
    if (!added) return fail(MAX_MSG);
    res.redirect(to);
  } catch (e) { console.error('google login', e.message); fail('Lỗi đăng nhập Google.'); }
});

// Account page modes of the Google callback. reauth: the Google account must belong to the signed-in account; the
// session's sign-in time is renewed (10-minute window for sensitive changes). link: adds this Google account to the
// signed-in account (needs a fresh sign-in first; a Google account already on another account is refused).
async function googleAccountMode(req, res, mode, { sub, email }) {
  const back = (q) => res.redirect('/#tai-khoan' + (q ? '?' + q : ''));
  const s = readSessionAll(req); const acc = s && s.accs[s.a];
  if (!acc || acc.k !== 'g' || !acc.aid || !acc.sid) return back('err=' + encodeURIComponent('Mở trang Tài khoản rồi thử lại.'));
  if (mode === 'reauth') {
    const { rows } = await pool.query("select 1 from identities where account_id = $1 and type = 'google' and provider_sub = $2", [acc.aid, sub]);
    if (!rows.length) return back('err=' + encodeURIComponent('Tài khoản Google vừa chọn không thuộc tài khoản này. Chọn đúng tài khoản Google.'));
    if (await TWO.enabledFor(pool, acc.aid)) { // the code too: a fresh sign-in is both factors (totp-routes.js)
      await TWO.beginTwoStep(pool, req, res, { aid: acc.aid, mode: 'reauth', sid: acc.sid, payload: { to: '/#tai-khoan?ok=reauth' } });
      return res.redirect('/#dang-nhap-2fa');
    }
    await pool.query('update sessions set auth_at = now() where id = $1 and account_id = $2', [acc.sid, acc.aid]);
    await pool.query("update identities set last_used_at = now() where type = 'google' and provider_sub = $1", [sub]);
    await ACC.event(pool, acc.aid, 'reauth', {}, req);
    const accs = s.accs.slice(); accs[s.a] = { ...acc, at: Date.now() }; writeSession(res, { accs, a: s.a });
    return back('ok=reauth');
  }
  if (!ACC.fresh(acc.at)) return back('err=' + encodeURIComponent('Xác nhận lại bằng tài khoản hiện tại trước khi liên kết.'));
  const r = await ACC.linkGoogle(pool, acc.aid, { sub, email });
  if (!r.ok) return back('err=' + encodeURIComponent(r.error));
  if (!r.already) { await ACC.event(pool, acc.aid, 'google_linked', { value: email }, req); await accountApi.notify(acc.aid, `Đã liên kết Google ${email} với tài khoản`, req); }
  return back('ok=linked');
}
let accountApi = null; // set by the account routes below

// Sign out everything on this device (every account). Per account: /api/accounts/signout. Their server sessions end too.
app.post('/api/logout', async (req, res) => {
  const s = readSessionAll(req);
  if (s) await ACC.revoke(pool, s.accs.map((x) => x.sid).filter(Boolean)).catch(() => {});
  clearSession(res); res.json({ ok: true });
});
app.get('/api/me', async (req, res, next) => {
  try {
    const w = await who(req);
    res.set('Cache-Control', 'no-store');
    const sess = readSession(req);
    const all = readSessionAll(req);
    res.json({ roles: await rolesByFamily(req), editor: w.editor, role: w.role, status: w.status, person_id: w.person_id, email: w.email, name: w.name, google: G_ON,
      given_name: sess?.gn || '', family_name: sess?.fn || '',
      acct: all ? acctKey(all.accs[all.a]) : null, accounts: all ? all.accs.length : 0 });
  } catch (e) { next(e); }
});

// ---- accounts on this device (Google-style switcher). Each account lists only its own memberships. ----
const accountsView = async (s) => {
  const items = [];
  const fams = await pool.query('select id, slug, name, han, visibility from families order by name');
  for (const [i, acc] of s.accs.entries()) {
    let memberships;
    if (acc.k === 'd') { // device: member of its family only, while not revoked
      const { rows } = await pool.query('select f.id, f.slug, f.name, f.han from device_accounts d join families f on f.id = d.family_id where d.id = $1 and d.revoked_at is null and d.expires_at > now()', [acc.id]);
      memberships = rows.map((r) => ({ role: 'member', family: { id: r.id, slug: r.slug, name: r.name, han: r.han || '' } }));
    } else if (acc.k === 'c') { // editor code: admin in every family, as before
      memberships = fams.rows.map((f) => ({ role: 'admin', family: { id: f.id, slug: f.slug, name: f.name, han: f.han || '' } }));
    } else {
      const emails = acc.aid ? [...new Set([acc.email, ...await ACC.emailsOf(pool, acc.aid)])] : [acc.email];
      const { rows } = await pool.query(`select distinct on (f.name, f.id) m.role, f.id, f.slug, f.name, f.han from members m join families f on f.id = m.family_id
        where (m.email = any($1) or ($2::uuid is not null and m.account_id = $2::uuid)) and m.status = 'active'
        order by f.name, f.id, array_position(array['owner','admin','editor','member'], m.role)`, [emails, acc.aid || null]);
      memberships = rows.map((r) => ({ role: r.role, family: { id: r.id, slug: r.slug, name: r.name, han: r.han || '' } }));
    }
    const name = acc.k === 'c' ? 'Mã biên tập' : (acc.name || acc.email);
    items.push({ key: acctKey(acc), kind: acc.k === 'c' ? 'code' : acc.k === 'd' ? 'device' : 'google', email: acc.email || null, name,
      initial: (name.trim().charAt(0) || '?').toUpperCase(), active: i === s.a, memberships });
  }
  return items;
};
app.get('/api/accounts', H(async (req, res) => {
  const s = readSessionAll(req);
  res.set('Cache-Control', 'no-store');
  if (!s) return res.json({ max: MAX_ACCOUNTS, active: null, items: [] });
  res.json({ max: MAX_ACCOUNTS, active: acctKey(s.accs[s.a]), items: await accountsView(s) });
}));
// Which account a body names: {email} for a Google account, {code: true} for the editor-code account.
const pickAccount = (s, b) => {
  if (b?.code === true) return s.accs.findIndex((x) => x.k === 'c');
  if (typeof b?.device === 'string') return s.accs.findIndex((x) => x.k === 'd' && x.id === b.device);
  const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
  return email ? s.accs.findIndex((x) => x.k === 'g' && x.email === email) : -1;
};
// Where an account lands: the family on screen when it can see it (public or link, or a member), else its default
// (its own cloud default family, else its first family, else duong). 'tat-ca' stays when it is in scope.
async function landingFamily(acc, want) {
  const canSee = async (slug) => {
    const { rows } = await pool.query('select id, visibility from families where slug = $1', [slug]);
    const f = rows[0]; if (!f) return false;
    if (f.visibility !== 'private' || acc.k === 'c') return true;
    const { rows: m } = await pool.query("select 1 from members where family_id = $1 and email = $2 and status = 'active'", [f.id, acc.email]);
    return m.length > 0;
  };
  if (want === 'tat-ca') return 'tat-ca';
  if (typeof want === 'string' && /^[a-z0-9-]{1,60}$/.test(want) && await canSee(want)) return want;
  if (acc.k === 'g') {
    const { rows } = await pool.query('select prefs from user_prefs where email = $1', [acc.email]);
    const def = rows[0]?.prefs?.default_family;
    if (def === 'all' || def === 'tat-ca') return 'tat-ca';
    if (typeof def === 'string' && /^[a-z0-9-]{1,60}$/.test(def) && await canSee(def)) return def;
    const { rows: mine } = await pool.query("select f.slug from members m join families f on f.id = m.family_id where m.email = $1 and m.status = 'active' order by f.name limit 1", [acc.email]);
    if (mine[0]) return mine[0].slug;
  }
  return DEFAULT_FAMILY;
}
app.post('/api/accounts/switch', sameSite, H(async (req, res) => {
  const s = readSessionAll(req);
  if (!s) throw new HttpError(401, 'Chưa đăng nhập.');
  const idx = pickAccount(s, req.body);
  if (idx < 0) throw new HttpError(404, 'Tài khoản này không có trên thiết bị này.');
  writeSession(res, { accs: s.accs, a: idx });
  const family = await landingFamily(s.accs[idx], req.body?.family);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, active: acctKey(s.accs[idx]), family });
}));
// Sign out one account ({email} or {code: true}) or every account ({all: true}). The others stay signed in.
app.post('/api/accounts/signout', sameSite, H(async (req, res) => {
  const s = readSessionAll(req);
  if (!s) return res.json({ ok: true, active: null, accounts: 0 });
  const b = req.body || {};
  let accs;
  if (b.all === true) { accs = []; await ACC.revoke(pool, s.accs.map((x) => x.sid).filter(Boolean)); }
  else {
    const idx = pickAccount(s, b);
    if (idx < 0) throw new HttpError(404, 'Tài khoản này không có trên thiết bị này.');
    if (s.accs[idx].sid) await ACC.revoke(pool, [s.accs[idx].sid]); // this device's session of that account ends
    accs = s.accs.filter((_, i) => i !== idx);
    if (!accs.length) { clearSession(res); return res.json({ ok: true, active: null, accounts: 0 }); }
    const keep = s.accs[s.a];
    const a = Math.max(0, accs.findIndex((x) => sameAcc(x, keep)));
    writeSession(res, { accs, a });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, active: acctKey(accs[a]), accounts: accs.length });
  }
  clearSession(res);
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, active: null, accounts: 0 });
}));
// Elder access: device sign-in by code, managers, devices, sign-in cards (elder-routes.js).
mountElder(app, { pool, who, readSessionAll, addAccount, sameSite, H, HttpError, famOf, mail });
require('./passkey-routes').mount(app, { pool, who, addAccount, readSessionAll, sameSite, H, HttpError, famOf, notify: (...a) => accountApi.notify(...a) });
// Account page API (#tai-khoan): profile, emails, linked Google, devices, security activity (account-routes.js).
accountApi = require('./account-routes').mount(app, { pool, readSessionAll, writeSession, sameSite, H, HttpError, mail, T });
// Two-step sign-in and recovery codes (totp-routes.js): the account side and the second step of a sign-in.
TWO.mount(app, { pool, readSessionAll, writeSession, addAccount, sameSite, H, HttpError, notify: (...a) => accountApi.notify(...a), secretKey: TOTP_RULES.deriveKey(SECRET), maxMsg: MAX_MSG });

// Test only (NODE_ENV=test): a signed-in Google session for an email, without Google. Never registered in production.
if (process.env.NODE_ENV === 'test') {
  app.post('/api/test/session', (req, res) => {
    const email = String(req.body?.email || '').toLowerCase();
    if (!email || !SECRET) return res.status(400).json({ error: 'email' });
    // like Google: the account of this (test) Google id, a server session; auth_age_ms makes the sign-in look older
    const sub = String(req.body?.sub || 'test-' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 20));
    ACC.resolveGoogle(pool, { sub, email, name: String(req.body?.name || email) }).then(async (r) => {
      if (await TWO.enabledFor(pool, r.accountId)) { // two-step on: the code comes next (POST /api/auth/2fa/verify)
        await TWO.beginTwoStep(pool, req, res, { aid: r.accountId, payload: { email, name: String(req.body?.name || email), via: 'test', to: '/' } });
        return res.json({ needs_2fa: true });
      }
      const sid = await ACC.createSession(pool, r.accountId, req);
      await ACC.event(pool, r.accountId, r.created ? 'account_created' : 'signin', { via: 'test' }, req);
      const at = Date.now() - Math.max(0, Number(req.body?.auth_age_ms) || 0);
      await pool.query('update sessions set auth_at = $2 where id = $1', [sid, new Date(at)]);
      if (!addAccount(req, res, { k: 'g', email, name: String(req.body?.name || email), gn: String(req.body?.given_name || ''), fn: String(req.body?.family_name || ''), aid: r.accountId, sid, at })) return res.status(409).json({ error: MAX_MSG });
      res.json({ ok: true, account: r.accountId });
    }).catch((e) => res.status(500).json({ error: e.message }));
  });
}

// The stable person ID (persons.short_id, migration person_short_id) travels to the app as data.sid; it is not an
// editable field (core.js FIELDS), so ops can never change it.
const withSid = (data, sid) => (sid && data ? { ...data, sid } : data);
// ---- read (public; editors also get private contact fields) ----
// Persons of one family (?family=, default duong). A private family answers 403 to non-members.
// ?ids=a,b,c: only those persons (the book loads the pages it shows); at most 500 ids per request.
app.get('/api/persons', H(async (req, res) => {
  const f = await famOf(req);
  const since = Math.max(0, Number(req.query.since) || 0);
  const w = await who(req, f.id); const full = canSeePrivate(w);
  if (!canRead(f, w)) throw new HttpError(403, 'Dòng họ này là riêng tư.');
  let rows;
  // A branch tree (branch-routes.js) has no people of its own: its scope of the home tree is read, every time (a
  // descendant added at home joins the branch at once), so `since` does not narrow it.
  const br = f.branch_home ? await BRN.scopeRead(pool, f, full) : null;
  const famId = br ? br.home : f.id;
  if (br) {
    ({ rows } = await pool.query('select id, data, version, deleted, short_id from persons where family_id = $1 and id = any($2::text[]) order by version', [famId, br.set.size ? [...br.set] : ['']]));
  } else if (typeof req.query.ids === 'string') {
    const ids = [...new Set(req.query.ids.split(',').filter(Boolean))];
    if (ids.length > 500 || !ids.every(isPersonId)) throw new HttpError(400, 'Danh sách mã người không hợp lệ.');
    ({ rows } = await pool.query('select id, data, version, deleted, short_id from persons where family_id = $1 and id = any($2::text[]) order by version', [f.id, ids]));
  } else {
    ({ rows } = await pool.query(
      'select id, data, version, deleted, short_id from persons where family_id = $1 and version > $2 order by version limit 5000', [f.id, since]));
  }
  if (br && typeof req.query.ids === 'string') { const want = new Set(req.query.ids.split(',')); rows = rows.filter((r) => want.has(r.id)); }
  const rel = br ? br.rel : await readRel(pool, f.id, full);
  const items = (await withRel(rel, rows, full)).map((r) => ({ id: r.id, v: Number(r.version), deleted: r.deleted, data: r.deleted ? null : withSid(full ? withContacts(r.data) : publicView(r.data, { flag: true }), r.short_id) }));
  const next_since = items.length ? items[items.length - 1].v : since;
  res.set('Cache-Control', 'no-store');
  // rel: the family's relations as the viewer may see them; source 'legacy' = derived from the person fields (no backfill yet)
  res.json({ items, next_since, role: w.role, family: f.id, branch: !!br, rel: { source: rel.source, parent_child: rel.pc, couple: rel.cp } });
}));

// ---- book outline: the page plan of the printed book (web/js/bookplan.js), cached per family and data version ----
// Built from the same person view the client gets (publicView for non-members), so heights and page count match what it draws.
let bookPlanMod = null; const bookPlanLib = () => bookPlanMod || (bookPlanMod = import(require('url').pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'bookplan.js')).href));
const bookCache = new Map(); // key -> plan; at most a few entries (each family, branch and view level)
app.get('/api/book/outline', H(async (req, res) => {
  const f = await famOf(req);
  const w = await who(req, f.id);
  if (!canRead(f, w)) throw new HttpError(403, 'Dòng họ này là riêng tư.');
  const full = canSeePrivate(w);
  // scope params: root (or legacy chi), dir down|up|both, gen N (0 = all), spouses 0|1, daughters full|name, status all|living|dead
  const pid = (k) => (typeof req.query[k] === 'string' && isPersonId(req.query[k]) ? req.query[k] : '');
  const q = req.query;
  const opts = {
    root: pid('root') || pid('chi'),
    dir: ['up', 'both'].includes(q.dir) ? q.dir : 'down',
    maxGen: Math.max(0, parseInt(q.gen, 10) || 0),
    spouses: q.spouses !== '0',
    daughters: q.daughters === 'name' ? 'name' : 'full',
    status: ['living', 'dead'].includes(q.status) ? q.status : 'all',
    layout: ['gen', 'summary'].includes(q.layout) ? q.layout : 'branch',
    orient: q.orient === 'port' ? 'port' : 'land',
  };
  const optKey = [opts.root, opts.dir, opts.maxGen, opts.spouses ? 1 : 0, opts.daughters, opts.status, opts.layout, opts.orient].join('|');
  const view = await BRN.viewOf(pool, f, full); // a branch: its scope of the home tree
  const inView = (id) => !view.ids || view.ids.includes(id);
  const { rows: allRows } = await pool.query('select id, data, version, deleted, short_id from persons where family_id = $1', [view.famId]);
  const rows = allRows.filter((r) => inView(r.id));
  const ver = rows.reduce((m, r) => Math.max(m, Number(r.version)), 0);
  // the codes (mã người) are printed and sized by the plan, so a code change is a new plan too
  const sidDigest = crypto.createHash('sha1').update(rows.map((r) => r.id + ':' + (r.short_id || '')).join('|')).digest('hex');
  // stories: the book prints them as paragraphs of each entry; a living person's go to members only
  const { rows: stAll } = await pool.query('select person_id, kind, title, body from stories where family_id = $1 order by person_id, id', [view.famId]);
  const stRows = stAll.filter((r) => inView(r.person_id));
  const stDigest = crypto.createHash('sha1').update(JSON.stringify(stRows)).digest('hex');
  const key = [f.id, ver, full ? 'full' : 'public', optKey, stDigest, sidDigest, f.founder_person_id || ''].join('|');
  let plan = bookCache.get(key);
  if (!plan) {
    const lib = await bookPlanLib();
    const rel = view.rel || await readRel(pool, f.id, full);
    const R = await EV.rules();
    const stOf = new Map();
    for (const r of stRows) { if (!stOf.has(r.person_id)) stOf.set(r.person_id, []); stOf.get(r.person_id).push(r); }
    const all = (await withRel(rel, rows, full)).filter((r) => !r.deleted && r.data).map((r) => {
      const seen = R.canSeeEventsOf(r.data, { member: full, familyReadable: true });
      return { id: r.id, data: withSid(full ? withContacts(r.data) : publicView(r.data), r.short_id), st: seen ? (stOf.get(r.id) || []).map((s) => ({ kind: s.kind, title: s.title, body: s.body })) : [] };
    });
    const bm = lib.bookModel(all, { founder_person_id: f.founder_person_id || null });
    plan = lib.planBook(bm, opts);
    plan.preg = Object.fromEntries(bm.preg); // id -> the parent's entry number (#P), for "con của #P"
    if (bookCache.size >= 24) bookCache.delete(bookCache.keys().next().value);
    bookCache.set(key, plan);
  }
  const emblem = (await emblemFlags(f.id)).has(f.id);
  res.set('Cache-Control', 'no-store');
  res.json({ family: f.id, name: f.name, han: f.han || '', role: w.role, v: ver, plan, emblem });
}));

app.get('/api/history/:id', H(async (req, res) => {
  const { rows: fr } = await pool.query('select f.* from persons p join families f on f.id = p.family_id where p.id = $1', [req.params.id]);
  if (!fr.length) return res.json([]);
  const f = fr[0]; const w = await who(req, f.id);
  if (!canRead(f, w)) throw new HttpError(403, 'Dòng họ này là riêng tư.');
  // a living person's history (every changed field, the name included) goes to members only (the same rule as events)
  const { rows: pr } = await pool.query('select data from persons where id=$1', [req.params.id]);
  if (pr[0] && !(await EV.rules()).canSeeEventsOf(pr[0].data, { member: canSeePrivate(w), familyReadable: true })) return res.json([]);
  const { rows } = await pool.query('select field, old_value, new_value, by_user, source, at from history where person_id=$1 order by at desc limit 200', [req.params.id]);
  const hidden = ['phone', 'email', 'address', 'facebook', 'zalo', 'social', 'birth_date', 'birth_lunar', 'death_date', 'quan_he_rieng', 'su_kien', 'cau_chuyen', 'nguon_khac'];
  res.json(canSeePrivate(w) ? rows : rows.filter((r) => !hidden.includes(r.field)));
}));

// ---- life events and stories (migration 012, rules in web/js/events.js) ----
// Read: by person. A living person's events and stories go to members only; a deceased person's to anyone who can read the family.
// Write: editors directly (history "Thêm sự kiện…"); everyone else sends a suggestion (POST /api/suggest with changes._ev).
async function evPersonFor(famId, personId) {
  const { rows } = await pool.query('select id, data, deleted from persons where id=$1 and family_id=$2', [personId, famId]);
  return rows[0] && !rows[0].deleted ? rows[0] : null;
}
app.get('/api/events', H(async (req, res) => {
  const f = await famOf(req); const w = await who(req, f.id);
  if (!canRead(f, w)) throw new HttpError(403, 'Dòng họ này là riêng tư.');
  const view = await BRN.viewOf(pool, f, canSeePrivate(w)); // a branch reads the home tree's events of its people
  const p = await evPersonFor(view.famId, String(req.query.person || ''));
  if (!p || (view.ids && !view.ids.includes(p.id))) throw new HttpError(404, 'Không tìm thấy người này.');
  const R = await EV.rules();
  res.set('Cache-Control', 'no-store');
  if (!R.canSeeEventsOf(p.data, { member: canSeePrivate(w), familyReadable: true })) return res.json({ hidden: true, items: [], stories: [], role: w.role });
  res.json({ hidden: false, items: await EV.listEvents(pool, view.famId, p.id), stories: await EV.listStories(pool, view.famId, p.id), role: w.role });
}));

// One editor write: idempotent by op_id, one transaction, the author is the signed-in name (history).
async function evWrite(req, res, next, fn) {
  const f = req.fam; const w = await who(req, f.id);
  const opId = typeof req.body?.op_id === 'string' && req.body.op_id && req.body.op_id.length <= 80 ? req.body.op_id : null;
  if (!opId) return res.status(400).json({ error: 'Thiếu mã thao tác.' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client, f, w, opId);
    if (out === null) { await client.query('rollback'); return res.status(404).json({ error: 'Không tìm thấy mục này.' }); }
    if (out.duplicate) { await client.query('rollback'); return res.json({ ok: true, duplicate: true }); }
    await client.query('commit');
    res.json({ ok: true, ...out });
  } catch (e) {
    await client.query('rollback').catch(() => {});
    if (e instanceof HttpError || e instanceof EV.EvError) return res.status(e.status).json({ error: e.message });
    next(e);
  } finally { client.release(); }
}
const evPersonInput = async (client, f, b) => {
  const p = await EV.personIn(client, f.id, String(b.person_id || ''));
  if (!p) throw new HttpError(400, 'Người này không có trong dòng họ.');
  return p;
};
app.post('/api/events', need('editor'), (req, res, next) => evWrite(req, res, next, async (client, f, w, opId) => {
  const R = await EV.rules(); const err = R.validateEvent(req.body?.event); if (err) throw new HttpError(400, err);
  const p = await evPersonInput(client, f, req.body);
  if (!(await EV.claimOp(client, opId, p.id))) return { duplicate: true };
  return { event: await EV.insertEvent(client, f.id, p.id, req.body.event, actorName(w)) };
}));
app.put('/api/events/:id', need('editor'), (req, res, next) => evWrite(req, res, next, async (client, f, w, opId) => {
  const R = await EV.rules(); const err = R.validateEvent(req.body?.event); if (err) throw new HttpError(400, err);
  const cur = await client.query('select person_id from events where id=$1 and family_id=$2', [req.params.id, f.id]);
  if (!cur.rows[0]) return null;
  if (!(await EV.claimOp(client, opId, cur.rows[0].person_id))) return { duplicate: true };
  return { event: await EV.updateEvent(client, f.id, req.params.id, req.body.event, actorName(w)) };
}));
app.post('/api/events/:id/delete', need('editor'), (req, res, next) => evWrite(req, res, next, async (client, f, w, opId) => {
  const cur = await client.query('select person_id from events where id=$1 and family_id=$2', [req.params.id, f.id]);
  if (!cur.rows[0]) return null;
  if (!(await EV.claimOp(client, opId, cur.rows[0].person_id))) return { duplicate: true };
  await TRASH.brake(f, w);
  const full = (await client.query('select * from events where id=$1', [req.params.id])).rows[0];
  const deleted = await EV.deleteEvent(client, f.id, req.params.id, actorName(w));
  const label = [full.date_text, full.place, (full.description || '').slice(0, 60)].filter(Boolean).join(' · ') || 'Sự kiện';
  return { deleted, trash_id: await TRASH.put(client, { famId: f.id, kind: 'event', itemId: full.id, personId: full.person_id, label, rows: [full], w, by: actorName(w) }) };
}));
app.post('/api/stories', need('editor'), (req, res, next) => evWrite(req, res, next, async (client, f, w, opId) => {
  const R = await EV.rules(); const err = R.validateStory(req.body?.story); if (err) throw new HttpError(400, err);
  const p = await evPersonInput(client, f, req.body);
  if (!(await EV.claimOp(client, opId, p.id))) return { duplicate: true };
  return { story: await EV.upsertStory(client, f.id, p.id, req.body.story, actorName(w)) };
}));
app.put('/api/stories/:id', need('editor'), (req, res, next) => evWrite(req, res, next, async (client, f, w, opId) => {
  const R = await EV.rules(); const err = R.validateStory(req.body?.story); if (err) throw new HttpError(400, err);
  const cur = await client.query('select person_id from stories where id=$1 and family_id=$2', [req.params.id, f.id]);
  if (!cur.rows[0]) return null;
  if (!(await EV.claimOp(client, opId, cur.rows[0].person_id))) return { duplicate: true };
  return { story: await EV.updateStory(client, f.id, req.params.id, req.body.story, actorName(w)) };
}));
app.post('/api/stories/:id/delete', need('editor'), (req, res, next) => evWrite(req, res, next, async (client, f, w, opId) => {
  const cur = await client.query('select person_id from stories where id=$1 and family_id=$2', [req.params.id, f.id]);
  if (!cur.rows[0]) return null;
  if (!(await EV.claimOp(client, opId, cur.rows[0].person_id))) return { duplicate: true };
  await TRASH.brake(f, w);
  const full = (await client.query('select * from stories where id=$1', [req.params.id])).rows[0];
  const deleted = await EV.deleteStory(client, f.id, req.params.id, actorName(w));
  return { deleted, trash_id: await TRASH.put(client, { famId: f.id, kind: 'story', itemId: full.id, personId: full.person_id, label: full.title || 'Câu chuyện', rows: [full], w, by: actorName(w) }) };
}));

// ---- write (editors): idempotent ops, newest-wins per field ----
// One op inside the caller's transaction. Editors' edits and approved suggestions both go through here,
// so history and ops are recorded the same way. byUser is the author shown in history.
async function applyOp(client, op, byUser, famId) {
  const seen = await client.query('insert into ops (op_id, person_id) values ($1,$2) on conflict do nothing returning op_id', [op.op_id, op.id]);
  if (!seen.rowCount) return { changes: [] }; // retried op: already applied
  const cur = await client.query('select data, field_ts, deleted from persons where id=$1 for update', [op.id]);
  const m = mergeOp(cur.rows[0], op);
  if (m.changes.length) {
    await client.query(
      `insert into persons (id, data, field_ts, deleted, updated_by, family_id) values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set data=$2, field_ts=$3, deleted=$4, updated_by=$5, updated_at=now(), version=nextval('persons_version')`,
      [op.id, m.data, m.fieldTs, m.deleted, byUser, famId]);
    for (const c of m.changes) {
      await client.query('insert into history (person_id, field, old_value, new_value, by_user) values ($1,$2,$3,$4,$5)',
        [op.id, c.field, JSON.stringify(c.old), JSON.stringify(c.new), byUser]);
    }
  }
  return { changes: m.changes };
}

// ---- relations (editors): one op per request, idempotent by op_id (see relations.js) ----
app.post('/api/relations', need('editor'), async (req, res, next) => {
  bookCache.clear();
  const f = req.fam; const w = await who(req, f.id);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const b = req.body || {};
    const rmT = b.action === 'remove' ? { parent_child: 'parent_child', couple: 'couple' }[b.kind] : null;
    const rm = rmT ? (await client.query(`select * from ${rmT} where id=$1 and family_id=$2`, [Number(b.id) || 0, f.id])).rows[0] : null;
    if (rm) await TRASH.brake(f, w);
    const out = await applyRelOp(client, b, actorName(w), f.id);
    if (rm && out.applied) out.trash_id = await TRASH.put(client, { famId: f.id, kind: rmT, itemId: rm.id, personId: rmT === 'parent_child' ? rm.child_id : rm.a_id, label: (out.label || 'Quan hệ').replace(/^Gỡ quan hệ: /, ''), rows: [rm], w, by: actorName(w) });
    await client.query('commit');
    res.json(out);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    if (e instanceof RelError || e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    next(e);
  } finally { client.release(); }
});

// A branch tree takes ops from anyone who reads it (branchOps decides: applied at home for a home editor, else suggested).
const opsGate = async (req, res, next) => {
  try {
    const f = await famOf(req);
    if (!f.branch_home) return need('editor')(req, res, next);
    if (canRead(f, await who(req, f.id))) return next();
    return res.status(403).json({ error: 'Cây nhánh này là riêng tư.' });
  } catch (e) { next(e); }
};
app.post('/api/ops', opsGate, async (req, res, next) => {
  bookCache.clear(); // a write changes the book (the cache key also carries the data version)
  let ops = Array.isArray(req.body?.ops) ? req.body.ops.slice(0, 500) : [];
  let f = req.fam; let w = await who(req, f.id);
  if (f.branch_home) {
    const r = await BRN.branchOps(req, f, ops, { pool, who, findFamily, ROLE_RANK, checkSuggestChanges, canSeePrivate });
    if (r.result) return res.json(r.result);
    f = r.home; w = r.hw; ops = r.ops; res.locals.rejectedFromBranch = r.rejected;
  }
  const applied = []; const rejected = [...(res.locals.rejectedFromBranch || [])]; // ops about people outside the branch
  const client = await pool.connect();
  // In a table family the parent / spouse fields are read-only here: they follow the relation rows (Quan hệ).
  const relTable = await isTable(pool, f.id);
  const want = relTable ? await REL.projectFamily(pool, f.id) : null;
  try {
    for (const op of ops) {
      if (relTable && op && op.fields && typeof op.fields === 'object') {
        const keys = LEGACY.filter((k) => k in op.fields);
        const cur = (want && want.get(op.id)) || {};
        const clash = keys.filter((k) => String(op.fields[k] === '' ? '' : op.fields[k] ?? '') !== String(cur[k] ?? ''));
        if (clash.length) { rejected.push({ op_id: op?.op_id, reason: 'Quan hệ cha mẹ, vợ/chồng sửa ở mục Quan hệ.' }); continue; }
        for (const k of keys) delete op.fields[k];
        if (!Object.keys(op.fields).length) { applied.push(op.op_id); continue; }
      }
      const err = validateOp(op);
      if (err) { rejected.push({ op_id: op?.op_id, reason: err }); continue; }
      // a person delete needs a reason and goes through Thùng rác (POST /api/persons/:id/delete)
      if (op.fields && op.fields._deleted === true) { rejected.push({ op_id: op.op_id, reason: 'Xóa người cần lý do: dùng “Xóa người này” (đi qua Thùng rác).' }); continue; }
      const pf = await client.query('select family_id from persons where id=$1', [op.id]);
      if (pf.rows[0] && pf.rows[0].family_id !== f.id) { rejected.push({ op_id: op.op_id, reason: 'Người này không thuộc dòng họ này.' }); continue; }
      await client.query('begin');
      try {
        // A manager writing on behalf of a person (x-act-as, elder-routes.js): the history says so.
        await applyOp(client, op, req.actAs ? `${actorName(w)} · thay mặt ${req.actAs.name}` : actorName(w), f.id);
        await client.query('commit');
        applied.push(op.op_id);
      } catch (e) { await client.query('rollback'); throw e; }
    }
    res.json({ applied, rejected });
  } catch (e) { next(e); } finally { client.release(); }
});

// ---- anonymous suggestions: no sign-in, editors approve (see migrations/004_suggestions.sql) ----
// 3-way helpers: base = each changed field's value when the sender sent it (see migrations/007).
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const baseOf = (data, changes) => Object.fromEntries(Object.keys(changes).map((k) => [k, data?.[k] ?? null]));
// clean: current equals the base or the proposal. conflict: the person changed the field after it was sent.
// Rows without a base (sent before this existed): unknown, so conflict only if the field was edited since.
function fieldState(r, field, proposed) {
  const cur = r.current ? (r.current[field] ?? null) : null;
  const hasBase = !!r.base && Object.prototype.hasOwnProperty.call(r.base, field);
  const base = hasBase ? (r.base[field] ?? null) : null;
  let status;
  if (same(cur, proposed)) status = 'clean';
  else if (!hasBase) status = (r.edited_fields || []).includes(field) ? 'conflict' : 'clean';
  else status = same(cur, base) ? 'clean' : 'conflict';
  return { field, base, current: cur, proposed, status, edited: (r.edited_fields || []).includes(field), unknown_base: !hasBase,
    old: cur, new: proposed };
}
const SUG_WINDOW = 3600e3; const SUG_MAX = 10; const sugTries = new Map(); // ip_hash -> [count, windowStart]
function sugLimited(key) {
  const now = Date.now(); const t = sugTries.get(key);
  if (sugTries.size > 10000) sugTries.clear();
  if (!t || now - t[1] > SUG_WINDOW) { sugTries.set(key, [1, now]); return false; }
  if (t[0] >= SUG_MAX) return true;
  t[0]++; return false;
}
const ipHash = (req) => crypto.createHash('sha256').update(String(req.ip) + SECRET).digest('hex');
const isPersonId = (s) => /^P\d{3,6}$|^N[0-9a-z-]{6,40}$/.test(s);
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v.trim() : '');

// Checks a visitor's changes: FIELDS keys only, value rules as for editors, photo must be a web link.
async function checkSuggestChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return 'Thiếu thông tin cần sửa.';
  const keys = Object.keys(changes);
  if (!keys.length || keys.length > 40) return 'Chọn ít nhất 1 thông tin cần sửa.';
  if (keys.includes('_rel')) return keys.length === 1 ? await REL.relShapeError(changes._rel) : 'Một góp ý quan hệ chỉ gồm một quan hệ.';
  for (const k of keys) {
    if (!FIELDS[k]) return `Trường không hợp lệ: ${k}`;
    const err = validateValue(k, changes[k]); if (err) return err;
  }
  if (typeof changes.photo === 'string' && changes.photo && !/^https?:\/\//i.test(changes.photo)) return 'Link ảnh phải bắt đầu bằng http(s)://';
  return null;
}

app.post('/api/suggest', async (req, res, next) => {
  try {
    if (sugLimited(ipHash(req))) return res.status(429).json({ error: 'Bạn đã gửi nhiều góp ý. Thử lại sau 1 giờ.' });
    const b = req.body || {};
    if (JSON.stringify(b).length > 20 * 1024) return res.status(413).json({ error: 'Nội dung quá dài.' });
    if (str(b.website, 200)) return res.status(400).json({ error: 'Không gửi được. Thử lại.' }); // honeypot: bots fill it
    let f = await famOf(req);
    // A branch's suggestion is a suggestion for its home tree (same person ids); the sender must read the branch.
    const br = f.branch_home ? f : null;
    if (br) {
      if (!canRead(br, await who(req, br.id))) return res.status(403).json({ error: 'Cây nhánh này là riêng tư.' });
      f = await findFamily(br.branch_home);
    } else if (!canRead(f, await who(req, f.id))) return res.status(403).json({ error: 'Dòng họ này là riêng tư.' });
    const personId = b.person_id ? String(b.person_id) : null;
    if (personId !== null && !isPersonId(personId)) return res.status(400).json({ error: 'Người này không có trong dữ liệu.' });
    const isEv = !!b.changes && typeof b.changes === 'object' && Object.prototype.hasOwnProperty.call(b.changes, '_ev');
    const err = isEv ? (Object.keys(b.changes).length === 1 ? await EV.checkEvSuggest(b.changes._ev) : 'Một góp ý sự kiện chỉ gồm một mục.') : await checkSuggestChanges(b.changes);
    if (err) return res.status(400).json({ error: err });
    if (isEv && !personId) return res.status(400).json({ error: 'Chọn người cần góp ý sự kiện.' });
    const isRel = Object.prototype.hasOwnProperty.call(b.changes, '_rel');
    if (isRel && !(await isTable(pool, f.id))) return res.status(409).json({ error: 'Dòng họ này chưa chuyển dữ liệu quan hệ.' });
    if (isRel) { const pe = await REL.precheckRel(pool, f.id, b.changes._rel); if (pe) return res.status(pe.status).json({ error: pe.message }); }
    if (br && personId && !(await BRN.scopeRead(pool, br, true)).set.has(personId)) return res.status(400).json({ error: 'Người này không có trong cây nhánh.' });
    let curData = {};
    if (personId) {
      const { rows } = await pool.query('select deleted, data, family_id from persons where id=$1', [personId]);
      if (!rows.length || rows[0].deleted || rows[0].family_id !== f.id) return res.status(400).json({ error: 'Người này không có trong dữ liệu.' });
      curData = rows[0].data || {};
    } else if (!isRel && !isEv && !str(b.changes.name, 200)) return res.status(400).json({ error: 'Cần ghi họ tên người mới.' });
    if (isEv) { // an event or story of a living person is for members only, like the person's details
      const R = await EV.rules();
      if (!R.canSeeEventsOf(curData, { member: canSeePrivate(await who(req, f.id)), familyReadable: canRead(f, await who(req, f.id)) })) return res.status(403).json({ error: 'Thông tin này chỉ thành viên xem được.' });
    }
    // Members' suggestions carry the account's name and email (not what they type); guests type their own.
    const w = await who(req, f.id);
    const byName = canSeePrivate(w) && w.email ? w.name : str(b.by_name, 80);
    const byContact = canSeePrivate(w) && w.email ? w.email : str(b.by_contact, 200);
    // The receipt is the sender's only way back to this suggestion (see /api/suggestions/mine): we keep its hash, not the token.
    const receipt = crypto.randomBytes(24).toString('base64url');
    const { rows: ins } = await pool.query(
      'insert into suggestions (person_id, changes, note, by_name, by_contact, ip_hash, receipt_hash, account_email, base, family_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id',
      [personId, b.changes, str(b.note, 1000), byName, byContact, ipHash(req), receiptHash(receipt), w.email || null, isRel || isEv ? {} : baseOf(curData, b.changes), f.id]);
    res.json({ ok: true, id: ins[0].id, receipt });
  } catch (e) { next(e); }
});

const SUG_STATUS = ['pending', 'approved', 'rejected', 'withdrawn'];
// Editors only: pending items with the current value of each changed field (for the diff).
app.get('/api/suggestions', need('admin'), async (req, res, next) => {
  try {
    const status = SUG_STATUS.includes(req.query.status) ? req.query.status : 'pending';
    const { rows } = await pool.query(
      `select s.id, s.person_id, s.changes, s.base, s.note, s.by_name, s.by_contact, s.status, s.created_at, s.reviewed_by, s.reviewed_at, s.reason,
              p.data as current,
              coalesce((select array_agg(distinct h.field) from history h
                         where h.person_id = s.person_id and h.at > s.created_at
                           and h.field in (select jsonb_object_keys(s.changes))), '{}') as edited_fields
         from suggestions s left join persons p on p.id = s.person_id
        where s.status = $1 and s.family_id = $2 order by s.created_at desc limit 200`, [status, req.fam.id]);
    const counts = Object.fromEntries(SUG_STATUS.map((x) => [x, 0]));
    for (const r of (await pool.query('select status, count(*)::int n from suggestions where family_id = $1 group by status', [req.fam.id])).rows) counts[r.status] = r.n;
    const relNames = rows.some((r) => r.changes._rel) ? await REL.namesOf(pool, req.fam.id) : null;
    const evR = rows.some((r) => r.changes._ev) ? await EV.rules() : null;
    const items = rows.map((r) => ({
      id: r.id, status: r.status, person_id: r.person_id, is_new: !r.person_id,
      rel_label: r.changes._rel ? REL.relSuggestLabel(r.changes._rel, relNames) : undefined,
      ev_label: r.changes._ev ? EV.evLabel(r.changes._ev, (t) => evR.EVENT_TYPES[t]?.label || t) : undefined,
      person_name: r.current?.name || r.changes.name || '',
      // edited: the person's field changed after this suggestion was sent (warn the reviewer before approving)
      changes: r.changes._rel || r.changes._ev ? [] : Object.entries(r.changes).map(([field, nw]) => fieldState({ ...r, edited_fields: r.edited_fields }, field, nw)),
      note: r.note, by_name: r.by_name, by_contact: r.by_contact, created_at: r.created_at,
      reviewed_by: r.reviewed_by, reviewed_at: r.reviewed_at, reason: r.reason,
    }));
    res.set('Cache-Control', 'no-store');
    res.json({ items, counts });
  } catch (e) { next(e); }
});

// Approve: the change goes through applyOp (same as an editor edit). Author in history: "Đề xuất: <name>, duyệt: <editor>".
// The sender (by_contact, when it is an email) hears the decision once. notify_pending stays on until a mail was sent.
async function notifySender(s, approved, reason = '') {
  try {
    if (!s.notify_pending || !mail.EMAIL_RE.test(String(s.by_contact || '').trim())) return;
    const { rows } = await pool.query('select id, slug, name from families where id=$1', [s.family_id]);
    const fam = rows[0]; if (!fam) return;
    const sent = await mail.send(pool, { familyId: fam.id, kind: 'contribution', to: String(s.by_contact).trim(),
      ...T.contribution({ family: fam.name, approved, reason, url: `${mail.publicUrl()}/#/${fam.slug}/tree` }) });
    if (sent.status === 'sent') await pool.query('update suggestions set notify_pending=false where id=$1', [s.id]);
  } catch (e) { console.error('contribution mail', e.message); }
}
app.post('/api/suggestions/:id/approve', async (req, res, next) => {
  bookCache.clear(); // an approved suggestion changes persons, so the book plan
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'Không tìm thấy góp ý.' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query('select * from suggestions where id=$1 for update', [id]);
    const s = rows[0];
    if (!s) throw new HttpError(404, 'Không tìm thấy góp ý.');
    const w = await requireRole(req, s.family_id, 'admin');
    if (s.status !== 'pending') throw new HttpError(409, 'Góp ý này đã được xử lý.');
    if (s.changes && s.changes._rel) {
      if (req.body?.fields && Object.keys(req.body.fields).length) throw new HttpError(400, 'Góp ý quan hệ duyệt cả, không chọn từng trường.');
      const author = `Đề xuất: ${s.by_name || 'Khách'}, duyệt: ${actorName(w)}`;
      let out;
      try { out = await applyRelOp(client, { ...s.changes._rel, op_id: 'sug-' + s.id, person_id: s.person_id || undefined }, author, s.family_id); }
      catch (e) { if (e instanceof RelError) throw new HttpError(e.status, e.message); throw e; }
      await client.query("update suggestions set status='approved', reviewed_by=$2, reviewed_at=now() where id=$1", [id, actorName(w)]);
      await client.query('commit');
      await notifySender(s, true);
      return res.json({ ok: true, person_id: s.person_id, relation: out });
    }
    if (s.changes && s.changes._ev) {
      if (req.body?.fields && Object.keys(req.body.fields).length) throw new HttpError(400, 'Góp ý sự kiện duyệt cả, không chọn từng trường.');
      const author = `Đề xuất: ${s.by_name || 'Khách'}, duyệt: ${actorName(w)}`;
      const out = await EV.applyEvSuggestion(client, s.family_id, s, author);
      await client.query("update suggestions set status='approved', reviewed_by=$2, reviewed_at=now() where id=$1", [id, actorName(w)]);
      await client.query('commit');
      await notifySender(s, true);
      return res.json({ ok: true, person_id: s.person_id, ...out });
    }
    let personId = s.person_id;
    let cur = {};
    if (personId) {
      const p = await client.query('select deleted, data from persons where id=$1', [personId]);
      if (!p.rows.length || p.rows[0].deleted) throw new HttpError(409, 'Người này không còn trong dữ liệu.');
      cur = p.rows[0].data || {};
    } else {
      personId = 'N' + crypto.randomUUID().slice(0, 13); // same shape as the client's newId()
    }
    // 3-way decision per field (fieldState). Body: { fields: { <field>: 'proposed' | 'current' | { custom: value } } }.
    // Clean fields default to proposed; conflict fields must be chosen. 'current' leaves the field as it is.
    const choices = req.body?.fields ?? {};
    if (!choices || typeof choices !== 'object' || Array.isArray(choices)) throw new HttpError(400, 'Lựa chọn không hợp lệ.');
    for (const k of Object.keys(choices)) if (!(k in s.changes)) throw new HttpError(400, `Trường không có trong góp ý: ${k}`);
    const ed = s.person_id ? (await client.query(
      "select coalesce(array_agg(distinct h.field), '{}') as f from history h where h.person_id=$1 and h.at > $2 and h.field = any($3)",
      [s.person_id, s.created_at, Object.keys(s.changes)])).rows[0].f : [];
    const fields = {};
    for (const [field, proposed] of Object.entries(s.changes)) {
      const c = choices[field];
      if (c === undefined) {
        if (fieldState({ base: s.base, current: cur, edited_fields: ed }, field, proposed).status === 'conflict') throw new HttpError(400, `Cần chọn giá trị cho: ${field}`);
        fields[field] = proposed;
      } else if (c === 'proposed') fields[field] = proposed;
      else if (c === 'current') continue;
      else if (c && typeof c === 'object' && 'custom' in c) {
        const err = validateValue(field, c.custom); if (err) throw new HttpError(400, err);
        fields[field] = c.custom ?? null;
      } else throw new HttpError(400, `Lựa chọn không hợp lệ: ${field}`);
    }
    if (!Object.keys(fields).length) throw new HttpError(400, 'Chọn ít nhất một thay đổi để duyệt. Muốn bỏ hết, hãy từ chối.');
    const op = { op_id: 'sug-' + s.id, id: personId, fields, ts: Date.now() };
    const err = validateOp(op); if (err) throw new HttpError(422, err);
    const author = `Đề xuất: ${s.by_name || 'Khách'}, duyệt: ${actorName(w)}`;
    await applyOp(client, op, author, s.family_id);
    await client.query("update suggestions set status='approved', reviewed_by=$2, reviewed_at=now() where id=$1", [id, actorName(w)]);
    await client.query('commit');
    await notifySender(s, true);
    res.json({ ok: true, person_id: personId });
  } catch (e) {
    await client.query('rollback');
    if (e instanceof HttpError || e instanceof EV.EvError) return res.status(e.status).json({ error: e.message });
    next(e);
  } finally { client.release(); }
});

app.post('/api/suggestions/:id/reject', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'Không tìm thấy góp ý.' });
    const reason = str(req.body?.reason, 500);
    const { rows: sr } = await pool.query('select family_id, by_contact, notify_pending from suggestions where id=$1', [id]);
    if (!sr.length) return res.status(409).json({ error: 'Không tìm thấy góp ý đang chờ.' });
    const w = await requireRole(req, sr[0].family_id, 'admin');
    const { rowCount } = await pool.query(
      "update suggestions set status='rejected', reviewed_by=$2, reviewed_at=now(), reason=$3 where id=$1 and status='pending'",
      [id, actorName(w), reason]);
    if (!rowCount) return res.status(409).json({ error: 'Không tìm thấy góp ý đang chờ.' });
    await notifySender(sr[0], false, reason);
    res.json({ ok: true });
  } catch (e) { next(e); }
});


// ---- device data: a sender's receipt (anonymous) or a signed-in Google account can see and change its own suggestions ----
// Receipt = 24 random bytes, base64url (32 chars), given once on send; only sha256(receipt) is stored.
const RECEIPT_RE = /^[A-Za-z0-9_-]{32}$/;
const receiptHash = (r) => crypto.createHash('sha256').update(String(r)).digest('hex');
const suggId = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Không tìm thấy góp ý.'); return id; };
// [{id, hash}] from the client's list; anything malformed is dropped.
function parseReceipts(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200)
    .filter((x) => x && Number.isInteger(x.id) && x.id > 0 && typeof x.receipt === 'string' && RECEIPT_RE.test(x.receipt))
    .map((x) => ({ id: x.id, hash: receiptHash(x.receipt) }));
}
// The suggestion row, when the caller holds its receipt or is the signed-in account that sent or claimed it. Else null.
async function ownedSuggestion(id, receipt, email) {
  const { rows } = await pool.query('select id, status, person_id, receipt_hash, account_email from suggestions where id=$1', [id]);
  const s = rows[0]; if (!s) return null;
  const byReceipt = RECEIPT_RE.test(String(receipt || '')) && s.receipt_hash === receiptHash(receipt);
  const byAccount = !!email && s.account_email === email;
  return byReceipt || byAccount ? s : null;
}
async function requireGoogle(req) {
  const w = await who(req);
  if (w.email) return w.email;
  throw new HttpError(w.code ? 403 : 401, 'Đăng nhập bằng Google để đồng bộ.');
}

// Own suggestions by receipt (no sign-in), plus every row sent or claimed by the signed-in account.
app.post('/api/suggestions/mine', H(async (req, res) => {
  const list = parseReceipts(req.body?.receipts);
  const email = (await who(req)).email || null;
  const { rows } = await pool.query(
    `select s.id, s.person_id, s.changes, s.note, s.status, s.reason, s.created_at, p.data->>'name' as person_name
       from suggestions s left join persons p on p.id = s.person_id
      where exists (select 1 from unnest($1::int[], $2::text[]) as r(id, h) where r.id = s.id and r.h = s.receipt_hash)
         or ($3::text is not null and s.account_email = $3)
      order by s.created_at desc limit 500`,
    [list.map((x) => x.id), list.map((x) => x.hash), email]);
  res.set('Cache-Control', 'no-store');
  res.json({ items: rows.map((r) => ({
    id: r.id, status: r.status, person_id: r.person_id, is_new: !r.person_id,
    person_name: r.person_name || r.changes.name || '', changes: r.changes, note: r.note, reason: r.reason, created_at: r.created_at,
  })) });
}));
// Withdraw: only while pending. Receipt holder or owning account.
app.post('/api/suggestions/:id/withdraw', H(async (req, res) => {
  const id = suggId(req);
  const s = await ownedSuggestion(id, req.body?.receipt, (await who(req)).email);
  if (!s) throw new HttpError(404, 'Không tìm thấy góp ý.');
  if (s.status !== 'pending') throw new HttpError(409, 'Chỉ rút được góp ý đang chờ duyệt.');
  const { rowCount } = await pool.query("update suggestions set status='withdrawn', reviewed_at=now() where id=$1 and status='pending'", [id]);
  if (!rowCount) throw new HttpError(409, 'Chỉ rút được góp ý đang chờ duyệt.');
  res.json({ ok: true });
}));
// Edit a pending suggestion: same checks as /api/suggest. Replaces changes and note.
app.patch('/api/suggestions/:id', H(async (req, res) => {
  const id = suggId(req);
  const b = req.body || {};
  if (JSON.stringify(b).length > 20 * 1024) throw new HttpError(413, 'Nội dung quá dài.');
  const s = await ownedSuggestion(id, b.receipt, (await who(req)).email);
  if (!s) throw new HttpError(404, 'Không tìm thấy góp ý.');
  if (s.status !== 'pending') throw new HttpError(409, 'Chỉ sửa được góp ý đang chờ duyệt.');
  if (s.changes && s.changes._rel) throw new HttpError(409, 'Góp ý quan hệ không sửa được; hãy gửi lại.');
  const err = await checkSuggestChanges(b.changes); if (err) throw new HttpError(400, err);
  if (!s.person_id && !str(b.changes.name, 200)) throw new HttpError(400, 'Cần ghi họ tên người mới.');
  const cur = s.person_id ? ((await pool.query('select data from persons where id=$1', [s.person_id])).rows[0]?.data || {}) : {};
  const { rowCount } = await pool.query("update suggestions set changes=$2, note=$3, base=$4 where id=$1 and status='pending'", [id, b.changes, str(b.note, 1000), baseOf(cur, b.changes)]);
  if (!rowCount) throw new HttpError(409, 'Chỉ sửa được góp ý đang chờ duyệt.');
  res.json({ ok: true });
}));
// Signed in: attach local receipts to this account. Rows already claimed by another account are left alone.
app.post('/api/me/claim', H(async (req, res) => {
  const email = await requireGoogle(req);
  const list = parseReceipts(req.body?.receipts);
  if (!list.length) return res.json({ ok: true, matched: 0 });
  const ids = list.map((x) => x.id); const hashes = list.map((x) => x.hash);
  await pool.query(
    `update suggestions s set account_email = $1 from unnest($2::int[], $3::text[]) as r(id, h)
      where s.id = r.id and s.receipt_hash = r.h and (s.account_email is null or s.account_email = $1)`, [email, ids, hashes]);
  const { rows } = await pool.query(
    `select count(*)::int n from suggestions s where s.account_email = $1
      and exists (select 1 from unnest($2::int[], $3::text[]) as r(id, h) where r.id = s.id and r.h = s.receipt_hash)`, [email, ids, hashes]);
  res.json({ ok: true, matched: rows[0].n });
}));
// Preferences per Google account: follows, theme, filters, recent searches. PUT replaces the whole object (16 KB max).
const PREFS_MAX = 16 * 1024; const THEMES = ['', 'light', 'dark'];
function cleanPrefs(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Cài đặt không hợp lệ.');
  if (JSON.stringify(b).length > PREFS_MAX) throw new HttpError(413, 'Cài đặt quá lớn (tối đa 16 KB).');
  const out = {};
  if (b.follows !== undefined) {
    if (!Array.isArray(b.follows) || b.follows.length > 500 || !b.follows.every((x) => typeof x === 'string' && isPersonId(x))) throw new HttpError(400, 'Danh sách theo dõi không hợp lệ.');
    out.follows = [...new Set(b.follows)];
  }
  if (b.theme !== undefined) { if (!THEMES.includes(b.theme)) throw new HttpError(400, 'Giao diện không hợp lệ.'); out.theme = b.theme; }
  if (b.filters !== undefined) { if (!b.filters || typeof b.filters !== 'object' || Array.isArray(b.filters)) throw new HttpError(400, 'Bộ lọc không hợp lệ.'); out.filters = b.filters; }
  if (b.recent !== undefined) {
    if (!Array.isArray(b.recent) || b.recent.length > 10 || !b.recent.every((x) => typeof x === 'string' && x.length <= 100)) throw new HttpError(400, 'Tìm gần đây không hợp lệ.');
    out.recent = b.recent;
  }
  if (b.follows_families !== undefined) {
    if (!Array.isArray(b.follows_families) || b.follows_families.length > 100 || !b.follows_families.every((x) => typeof x === 'string' && /^[a-z0-9-]{1,60}$/.test(x))) throw new HttpError(400, 'Danh sách dòng họ theo dõi không hợp lệ.');
    out.follows_families = [...new Set(b.follows_families)];
  }
  if (b.default_family !== undefined) {
    if (typeof b.default_family !== 'string' || !(b.default_family === '' || b.default_family === 'all' || /^[a-z0-9-]{1,60}$/.test(b.default_family))) throw new HttpError(400, 'Dòng họ mở đầu không hợp lệ.'); // '' = no default (the client's start value)
    out.default_family = b.default_family;
  }
  return out;
}
app.get('/api/me/prefs', H(async (req, res) => {
  const email = await requireGoogle(req);
  const { rows } = await pool.query('select prefs from user_prefs where email=$1', [email]);
  res.set('Cache-Control', 'no-store');
  res.json({ prefs: rows[0]?.prefs || {} });
}));
app.put('/api/me/prefs', H(async (req, res) => {
  const email = await requireGoogle(req);
  const prefs = cleanPrefs(req.body);
  await pool.query('insert into user_prefs (email, prefs) values ($1,$2) on conflict (email) do update set prefs=$2, updated_at=now()', [email, prefs]);
  res.json({ ok: true });
}));

// ---- join + members (per family; roles: owner > admin > editor > member; guest = no active row) ----
const RELATIONS = ['self', 'child_of', 'spouse_of', 'grandchild_of'];
const actorName = (w) => w.editor || w.name || w.email || 'quản trị';
const personExists = async (id, famId) => { const { rows } = await pool.query('select 1 from persons where id=$1 and not deleted and family_id=$2', [id, famId]); return rows.length > 0; };
// Only the owner may hand out or take away admin / owner rights.
function checkRoleChange(actor, from, to) {
  if ((isTop(to) || isTop(from)) && actor.role !== 'owner') throw new HttpError(403, 'Chỉ Chủ họ mới đổi được vai trò Quản trị hoặc Chủ họ.');
}
const memberId = (req) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Không tìm thấy thành viên.'); return id; };
const pick = (r) => (r.rows[0] || null);

// Signed-in Google user asks to join a family (public or link; private families take no join requests). Stored as pending.
app.post('/api/join', need('guest'), H(async (req, res) => {
  const f = await famOf(req);
  if (f.visibility === 'private') throw new HttpError(403, 'Dòng họ này là riêng tư.');
  const w = await who(req, f.id);
  if (!w.email) throw new HttpError(w.code ? 403 : 401, 'Đăng nhập bằng Google để tham gia dòng họ.');
  if (w.role !== 'guest') throw new HttpError(409, 'Bạn đã là thành viên.');
  const b = req.body || {};
  const first = str(b.first_name, 40); const last = str(b.last_name, 40);
  if (!first) throw new HttpError(400, 'Cần ghi tên.');
  let personId = null; let relation = null; let relPerson = null;
  if (b.person_id) { // "Tôi là" this person
    if (!isPersonId(String(b.person_id)) || !(await personExists(String(b.person_id), f.id))) throw new HttpError(400, 'Người này không có trong dữ liệu.');
    personId = String(b.person_id); relation = 'self';
  } else if (b.relation) {
    if (!RELATIONS.includes(b.relation) || b.relation === 'self') throw new HttpError(400, 'Quan hệ không hợp lệ.');
    if (!b.rel_person_id || !isPersonId(String(b.rel_person_id)) || !(await personExists(String(b.rel_person_id), f.id))) throw new HttpError(400, 'Người này không có trong dữ liệu.');
    relation = b.relation; relPerson = String(b.rel_person_id);
  }
  const name = `${last} ${first}`.trim();
  const ex = pick(await pool.query('select status from members where email=$1 and family_id=$2', [w.email, f.id]));
  if (ex && ex.status === 'pending') throw new HttpError(409, 'Yêu cầu của bạn đang chờ duyệt.');
  const vals = [w.email, name, first, last, personId, relation, relPerson];
  if (ex) await pool.query("update members set name=$2, first_name=$3, last_name=$4, person_id=$5, relation=$6, rel_person_id=$7, status='pending', created_at=now(), approved_by=null, approved_at=null where email=$1 and family_id=$8", [...vals, f.id]);
  else await pool.query("insert into members (email, name, first_name, last_name, person_id, relation, rel_person_id, status, role, family_id) values ($1,$2,$3,$4,$5,$6,$7,'pending','member',$8)", [...vals, f.id]);
  res.json({ ok: true, status: 'pending', family: f.id });
}));
app.post('/api/join/cancel', need('guest'), H(async (req, res) => {
  const f = await famOf(req);
  const w = await who(req, f.id);
  if (!w.email) throw new HttpError(403, 'Đăng nhập bằng Google.');
  await pool.query("update members set status='removed' where email=$1 and family_id=$2 and status='pending'", [w.email, f.id]);
  res.json({ ok: true });
}));

// Mail to the person who asked to join (approved or rejected). Never fails the request.
async function notifyMember(memberId, fam, approved) {
  try {
    const { rows } = await pool.query('select email from members where id=$1', [memberId]);
    if (!rows[0]) return;
    await mail.send(pool, { familyId: fam.id, kind: 'join_decision', to: rows[0].email,
      ...T.joinDecision({ family: fam.name, approved, url: `${mail.publicUrl()}/#/${fam.slug}/tree` }) });
  } catch (e) { console.error('join mail', e.message); }
}
const MEMBER_ROWS = `select m.id, m.email, m.name, m.role, m.status, m.person_id, m.relation, m.rel_person_id, m.first_name, m.last_name,
    m.created_at, m.approved_by, m.approved_at, m.last_seen_at, p.data->>'name' as person_name, rp.data->>'name' as rel_name
  from members m left join persons p on p.id = m.person_id left join persons rp on rp.id = m.rel_person_id`;
app.get('/api/members', need('admin'), H(async (req, res) => {
  const f = await famOf(req); const w = await who(req, f.id);
  const { rows } = await pool.query(`${MEMBER_ROWS} where m.family_id=$1 and m.status <> 'removed' order by (m.status='pending') desc, m.role, m.created_at`, [f.id]);
  res.set('Cache-Control', 'no-store');
  res.json({ items: rows, counts: { pending: rows.filter((r) => r.status === 'pending').length }, me: w.role, family: f.id });
}));
// Approve a join request: role (default member), optional person link (null = not in the tree yet).
app.post('/api/members/:id/approve', need('admin'), H(async (req, res) => {
  const f = await famOf(req); const w = await who(req, f.id); const id = memberId(req);
  const role = req.body?.role || 'member';
  if (!ROLES.includes(role)) throw new HttpError(400, 'Vai trò không hợp lệ.');
  checkRoleChange(w, 'member', role);
  const m = pick(await pool.query('select status from members where id=$1 and family_id=$2', [id, f.id]));
  if (!m) throw new HttpError(404, 'Không tìm thấy thành viên.');
  if (m.status !== 'pending') throw new HttpError(409, 'Yêu cầu này đã được xử lý.');
  const hasPerson = Object.prototype.hasOwnProperty.call(req.body || {}, 'person_id');
  let personId = null;
  if (hasPerson && req.body.person_id) {
    if (!isPersonId(String(req.body.person_id)) || !(await personExists(String(req.body.person_id), f.id))) throw new HttpError(400, 'Người này không có trong dữ liệu.');
    personId = String(req.body.person_id);
  }
  await pool.query(`update members set status='active', role=$2, approved_by=$3, approved_at=now(),
      person_id = case when $4::boolean then $5 else person_id end where id=$1 and family_id=$6`, [id, role, actorName(w), hasPerson, personId, f.id]);
  await notifyMember(id, f, true);
  res.json({ ok: true });
}));
app.post('/api/members/:id/reject', need('admin'), H(async (req, res) => {
  const f = await famOf(req); const w = await who(req, f.id); const id = memberId(req);
  const { rowCount } = await pool.query("update members set status='removed', approved_by=$2, approved_at=now() where id=$1 and family_id=$3 and status='pending'", [id, actorName(w), f.id]);
  if (!rowCount) throw new HttpError(409, 'Yêu cầu này đã được xử lý.');
  await notifyMember(id, f, false);
  res.json({ ok: true });
}));
// Member actions: the admin routes and an approved AI request (ai-tools.js) share these. w = the acting account, f = the family.
async function doRoleChange(w, f, id, role) {
  if (!ROLES.includes(role)) throw new HttpError(400, 'Vai trò không hợp lệ.');
  const m = pick(await pool.query('select role, status from members where id=$1 and family_id=$2', [id, f.id]));
  if (!m || m.status !== 'active') throw new HttpError(404, 'Không tìm thấy thành viên đang hoạt động.');
  checkRoleChange(w, m.role, role);
  if (m.role === 'owner' && role !== 'owner' && !(await pool.query("select 1 from members where role='owner' and status='active' and family_id=$2 and id<>$1 limit 1", [id, f.id])).rowCount)
    throw new HttpError(409, 'Cần có ít nhất một Chủ họ.');
  await pool.query('update members set role=$2 where id=$1 and family_id=$3', [id, role, f.id]);
}
async function doRemove(w, f, id) {
  const m = pick(await pool.query('select role, status from members where id=$1 and family_id=$2', [id, f.id]));
  if (!m || m.status !== 'active') throw new HttpError(404, 'Không tìm thấy thành viên đang hoạt động.');
  if (m.role === 'owner') throw new HttpError(409, 'Đổi Chủ họ sang vai trò khác trước khi gỡ.');
  checkRoleChange(w, m.role, m.role);
  await pool.query("update members set status='removed' where id=$1 and family_id=$2", [id, f.id]);
}
// Invite by email: active at once, so the next Google sign-in with that email has the role in this family.
async function doInvite(w, f, email, role = 'member') {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new HttpError(400, 'Email không hợp lệ.');
  if (!ROLES.includes(role)) throw new HttpError(400, 'Vai trò không hợp lệ.');
  checkRoleChange(w, 'member', role);
  const ex = pick(await pool.query('select id, status from members where email=$1 and family_id=$2', [email, f.id]));
  if (ex && ex.status === 'active') throw new HttpError(409, 'Email này đã là thành viên.');
  if (ex) await pool.query("update members set status='active', role=$2, approved_by=$3, approved_at=now() where id=$1 and family_id=$4", [ex.id, role, actorName(w), f.id]);
  else await pool.query("insert into members (email, role, status, approved_by, approved_at, family_id) values ($1,$2,'active',$3,now(),$4)", [email, role, actorName(w), f.id]);
}
app.post('/api/members/:id/role', need('admin'), H(async (req, res) => {
  const f = await famOf(req); const w = await who(req, f.id);
  await doRoleChange(w, f, memberId(req), req.body?.role);
  res.json({ ok: true });
}));
app.post('/api/members/:id/remove', need('admin'), H(async (req, res) => {
  const f = await famOf(req); const w = await who(req, f.id);
  await doRemove(w, f, memberId(req));
  res.json({ ok: true });
}));
app.post('/api/members/invite', need('admin'), H(async (req, res) => {
  const f = await famOf(req); const w = await who(req, f.id);
  await doInvite(w, f, req.body?.email, req.body?.role || 'member');
  res.json({ ok: true });
}));

// ---- families (see migrations/008). Visibility: public = listed and open; link = open by slug only (never listed
// unless the account is a member); private = members only, everywhere. ----
const FAM_VIS = ['public', 'link', 'private'];
let fuzzyMod = null;
const fuzzy = async () => fuzzyMod || (fuzzyMod = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'fuzzy.js')).href));
// One family as the API shows it. $1 = the signed-in email (or null): my_role is that account's active role here.
const FAM_SELECT = `select f.id, f.slug, f.name, f.han, f.place, f.color, f.visibility, f.updated_at,
    f.short_name, f.founder_person_id, f.origin_place, f.branch_gen, f.branch_order, f.country,
    f.origin_surname, f.origin_surname_han, f.origin_year, f.origin_reason, f.origin_visibility,
    (select count(*)::int from persons p where p.family_id = f.id and not p.deleted) as people,
    (select count(distinct p.data->>'gen')::int from persons p where p.family_id = f.id and not p.deleted and p.data ? 'gen') as generations,
    (select m.role from members m where m.family_id = f.id and m.email = $1 and m.status = 'active') as my_role
  from families f`;
const famView = (r) => originGate({ ...r, my_role: r.my_role || null, is_member: !!r.my_role }, r.my_role || null);
// Họ gốc (origin_*) only for the viewers its visibility allows: all | members | editors (surname-rules.js). Hidden
// fields are removed, never sent as null, so a hidden origin cannot be read from the response.
const ORIGIN_KEYS = ['origin_surname', 'origin_surname_han', 'origin_year', 'origin_reason'];
function originGate(r, role) {
  if (SR.originVisibleTo(r.origin_visibility, role)) return r;
  const out = { ...r }; for (const k of ORIGIN_KEYS) delete out[k];
  return out;
}

// Search: public families whose name, place or Hán match every query token (fuzzy, see web/js/fuzzy.js),
// plus every family the account belongs to (matched or not). Link and private families only when a member.
app.get('/api/families', H(async (req, res) => {
  const q = str(req.query.q, 80);
  const email = readSession(req)?.email || null;
  const { rows } = await pool.query(`${FAM_SELECT} order by f.name`, [email]);
  const fz = await fuzzy();
  const qt = fz.tokens(q);
  const hits = rows.filter((r) => {
    if (r.my_role) return true; // members always see their families
    if (r.visibility !== 'public') return false; // link: by slug only; private: members only
    if (!qt.length) return true;
    // the họ gốc is searchable only where its visibility lets this viewer see it
    const origin = SR.originVisibleTo(r.origin_visibility, r.my_role) ? [r.origin_surname, r.origin_surname_han] : [];
    const hay = [...fz.tokens(r.name), ...fz.tokens(r.place), ...fz.tokens(r.han), ...fz.tokens(r.short_name), ...fz.tokens(r.origin_place), ...origin.flatMap((x) => fz.tokens(x))];
    return qt.every((t) => hay.some((h) => fz.tokenScore(t, h) > 0));
  });
  const em = await emblemFlags();
  res.set('Cache-Control', 'no-store');
  res.json({ items: hits.map((r) => famView({ ...r, ...(em.get(r.id) || { has_emblem: false, emblem_v: 0 }) })) });
}));
// One family by id or slug. A link family opens by slug; a private one only for its members.
app.get('/api/families/:ref', H(async (req, res) => {
  const f = await findFamily(req.params.ref);
  if (!f) throw new HttpError(404, 'Không tìm thấy dòng họ.');
  const w = await who(req, f.id);
  if (!canRead(f, w)) throw new HttpError(403, 'Dòng họ này là riêng tư.');
  const { rows } = await pool.query(`${FAM_SELECT} where f.id = $2`, [w.email, f.id]);
  res.set('Cache-Control', 'no-store');
  const em = (await emblemFlags(f.id)).get(f.id) || { has_emblem: false, emblem_v: 0 };
  const myRole = w.code ? 'admin' : (w.role === 'guest' ? null : w.role);
  res.json({ ...famView({ ...rows[0], ...em, my_role: myRole }), my_role: myRole });
}));
// Owner or admin of that family: name, han, place, visibility, and the clan fields (short name, founder, quê gốc,
// branch generation, manual branch order; migrations/018). Anyone else: 403 (401 when not signed in).
app.patch('/api/families/:ref', H(async (req, res) => {
  const f = await findFamily(req.params.ref);
  if (!f) throw new HttpError(404, 'Không tìm thấy dòng họ.');
  const w = await who(req, f.id);
  if (!isTop(w.role)) {
    if (w.email || w.code) throw new HttpError(403, 'Chỉ Chủ họ hoặc Quản trị mới sửa được thông tin dòng họ.');
    throw new HttpError(401, 'Cần đăng nhập để sửa.');
  }
  const b = req.body || {};
  const set = {};
  if (b.name !== undefined) { const n = str(b.name, 80); if (!n) throw new HttpError(400, 'Cần tên dòng họ.'); set.name = n; }
  if (b.han !== undefined) set.han = str(b.han, 20) || null;
  if (b.place !== undefined) set.place = str(b.place, 120) || null;
  if (b.visibility !== undefined) { if (!FAM_VIS.includes(b.visibility)) throw new HttpError(400, 'Quyền xem không hợp lệ.'); set.visibility = b.visibility; }
  if (b.short_name !== undefined) set.short_name = str(b.short_name, 60) || null;
  if (b.origin_place !== undefined) set.origin_place = str(b.origin_place, 120) || null;
  // Họ gốc (surname-rules.js): the family's original surname, its Hán, the year of the change, why, and who sees it.
  if (b.origin_surname !== undefined) set.origin_surname = str(b.origin_surname, 40) || null;
  if (b.origin_surname_han !== undefined) {
    const h = str(b.origin_surname_han, 40);
    if (h && !/^[\p{Script=Han}\s]+$/u.test(h)) throw new HttpError(400, 'Chữ Hán của họ gốc chỉ gồm chữ Hán và dấu cách.');
    set.origin_surname_han = h || null;
  }
  if (b.origin_year !== undefined) set.origin_year = str(b.origin_year, 20) || null;
  if (b.origin_reason !== undefined) set.origin_reason = str(b.origin_reason, 200) || null;
  if (b.origin_visibility !== undefined) { if (!['all', 'members', 'editors'].includes(b.origin_visibility)) throw new HttpError(400, 'Quyền xem họ gốc không hợp lệ.'); set.origin_visibility = b.origin_visibility; }
  if (b.country !== undefined) { const c = String(b.country || '').trim().toUpperCase(); if (c && !/^[A-Z]{2}$/.test(c)) throw new HttpError(400, 'Quốc gia không hợp lệ.'); set.country = c || null; }
  if (b.branch_gen !== undefined) { if (b.branch_gen === null || b.branch_gen === '') set.branch_gen = null; else { const g = Number(b.branch_gen); if (!Number.isInteger(g) || g < 1 || g > 30) throw new HttpError(400, 'Đời của chi không hợp lệ (1–30).'); set.branch_gen = g; } }
  if (b.branch_order !== undefined) {
    if (b.branch_order === null) set.branch_order = null;
    else if (!Array.isArray(b.branch_order) || b.branch_order.length > 500 || !b.branch_order.every((x) => typeof x === 'string' && x && x.length <= 64)) throw new HttpError(400, 'Thứ tự chi không hợp lệ.');
    else set.branch_order = JSON.stringify([...new Set(b.branch_order)]);
  }
  if (b.founder_person_id !== undefined) {
    const id = str(b.founder_person_id, 64);
    if (id && !(await pool.query('select 1 from persons where id = $1 and family_id = $2 and not deleted', [id, f.id])).rowCount) throw new HttpError(400, 'Thủy tổ phải là người trong dòng họ này.');
    set.founder_person_id = id || null;
  }
  const keys = Object.keys(set);
  if (!keys.length) throw new HttpError(400, 'Không có gì để lưu.');
  const sql = `update families set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`;
  await pool.query(sql, [f.id, ...keys.map((k) => set[k])]);
  const { rows } = await pool.query(`${FAM_SELECT} where f.id = $2`, [w.email, f.id]);
  res.json({ ok: true, family: famView(rows[0]) });
}));

// Family emblem: PNG, JPEG or WebP only (no SVG, so nothing to sanitise), 256 KB at most. Owner or admin uploads and removes;
// anyone who can read the family can see it.
const EMBLEM_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const EMBLEM_MAX = 256 * 1024;
const emblemMagic = (buf, mime) => (mime === 'image/png' ? buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  : mime === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  : mime === 'image/webp' ? buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP' : false);
// family id -> { has_emblem, emblem_v } for the given family (or all of them)
async function emblemFlags(id) {
  const { rows } = id ? await pool.query('select family_id, extract(epoch from updated_at)::bigint v from family_emblems where family_id = $1', [id])
    : await pool.query('select family_id, extract(epoch from updated_at)::bigint v from family_emblems');
  return new Map(rows.map((r) => [r.family_id, { has_emblem: true, emblem_v: Number(r.v) }]));
}
app.get('/api/families/:ref/emblem', H(async (req, res) => {
  const f = await findFamily(req.params.ref);
  if (!f) throw new HttpError(404, 'Không tìm thấy dòng họ.');
  const w = await who(req, f.id);
  if (!canRead(f, w)) throw new HttpError(403, 'Dòng họ này là riêng tư.');
  const { rows } = await pool.query('select mime, data from family_emblems where family_id = $1', [f.id]);
  if (!rows.length) throw new HttpError(404, 'Chưa có biểu tượng.');
  res.set('Content-Type', rows[0].mime);
  res.set('Cache-Control', 'private, no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(rows[0].data);
}));
app.put('/api/families/:ref/emblem', express.raw({ type: EMBLEM_TYPES, limit: EMBLEM_MAX }), H(async (req, res) => {
  const f = await findFamily(req.params.ref);
  if (!f) throw new HttpError(404, 'Không tìm thấy dòng họ.');
  const w = await who(req, f.id);
  if (!isTop(w.role)) {
    if (w.email || w.code) throw new HttpError(403, 'Chỉ Chủ họ hoặc Quản trị mới đổi biểu tượng.');
    throw new HttpError(401, 'Cần đăng nhập để đổi biểu tượng.');
  }
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(415, 'Chỉ nhận ảnh PNG, JPEG hoặc WebP.');
  if (!EMBLEM_TYPES.includes(mime) || !emblemMagic(req.body, mime)) throw new HttpError(415, 'Tệp không phải ảnh PNG, JPEG hoặc WebP hợp lệ.');
  await pool.query(`insert into family_emblems (family_id, mime, data, updated_at) values ($1, $2, $3, now())
    on conflict (family_id) do update set mime = excluded.mime, data = excluded.data, updated_at = now()`, [f.id, mime, req.body]);
  res.json({ ok: true });
}));
app.delete('/api/families/:ref/emblem', H(async (req, res) => {
  const f = await findFamily(req.params.ref);
  if (!f) throw new HttpError(404, 'Không tìm thấy dòng họ.');
  const w = await who(req, f.id);
  if (!isTop(w.role)) {
    if (w.email || w.code) throw new HttpError(403, 'Chỉ Chủ họ hoặc Quản trị mới đổi biểu tượng.');
    throw new HttpError(401, 'Cần đăng nhập để đổi biểu tượng.');
  }
  await pool.query('delete from family_emblems where family_id = $1', [f.id]);
  res.json({ ok: true });
}));

// Leave a family: a plain member or editor. The Chủ họ must hand the role over first. Idempotent.
app.post('/api/families/:ref/leave', H(async (req, res) => {
  const f = await findFamily(req.params.ref);
  if (!f) throw new HttpError(404, 'Không tìm thấy dòng họ.');
  const w = await who(req, f.id);
  if (!w.email) throw new HttpError(w.code ? 403 : 401, 'Đăng nhập để rời dòng họ.');
  if (w.role === 'guest') return res.json({ ok: true });
  if (w.role === 'owner') throw new HttpError(409, 'Chủ họ cần giao quyền Chủ họ cho người khác trước khi rời.');
  await pool.query("update members set status='removed' where email=$1 and family_id=$2 and status='active'", [w.email, f.id]);
  res.json({ ok: true });
}));
// Succession: trusted contacts, inactivity, death reports, claims, offers, reclaim, create a family (succession-routes.js).
const claimApi = require('./claim-routes').mount(app, { pool, who, famOf, canRead, H, HttpError, readSession, mail, T, publicUrl: mail.publicUrl }); // Nhận quản lý (claim-routes.js)
mountSuccession(app, { pool, who, readSession, findFamily, canRead, ROLE_RANK, claims: claimApi });
// "Same person" links between family trees (links-routes.js).
const linksApi = mountLinks(app, { pool, who, famOf, findFamily, canRead, H, HttpError, readSession });
// "Có thể là cùng một người" suggestions (match-routes.js; computed by scripts/match-run.js): a suggested link goes
// through the same proposal as a hand-made one.
mountMatch(app, { pool, who, famOf, findFamily, canRead, H, HttpError, propose: linksApi.propose });
// Consistency checker (C1): GET /api/trees/:tree/consistency and the ignore list (consistency-routes.js).
require('./consistency-routes').mount(app, { pool, who, findFamily, canRead, H, HttpError, readRel, express });
// "Tạo cây cho nhánh này": branch trees by reference (branch-routes.js). Its reads, writes and suggestions are routed below.
BRN.mount(app, { pool, who, famOf, findFamily, canRead, H, HttpError, ROLE_RANK });
// Clan view (clan-routes.js): every tree with one surname, grouped by accepted links; private trees only counted.
mountClan(app, { pool, readSession, rolesByFamily, H, HttpError });
// Places gazetteer (places-routes.js): shared by every family; a person's place links follow the family's roles.
// New places + the curator's queue of open-data suggestions (places-curate-routes.js); mounted first so that
// /api/places/pending is not read as a place id.
mountPlacesCurate(app, { pool, readSession, who, famOf, canRead, H, HttpError });
mountPlaces(app, { pool, readSession, who, famOf, canRead, H, HttpError,
  seeLife: async (data, member) => (await EV.rules()).canSeeEventsOf(data, { member, familyReadable: true }) });
// Conflicting data (variants-routes.js): several sourced values per field; choosing one writes the field through applyOp.
mountVariants(app, { pool, who, famOf, canRead, H, HttpError, ROLE_RANK, applyOp, actorName, validateValue,
  seeLife: async (data, member) => (await EV.rules()).canSeeEventsOf(data, { member, familyReadable: true }), onWrite: () => bookCache.clear() });
// Thùng rác: every delete is kept GP_TRASH_DAYS (default 30) days, then the archive (historical data kept; living people's items purged after GP_ARCHIVE_LIVING_DAYS, 365); person deletes need a reason (trash.js).
TRASH.mount(app, { pool, who, famOf, H, HttpError, ROLE_RANK, actorName, mail, T, mirrorLegacy: REL.mirrorLegacy, isTable: REL.isTable, publicUrl: mail.publicUrl, onWrite: () => bookCache.clear() });
// Biểu quyết (decisions.js): gỡ / khôi phục người by family vote; the chooser's options and the page's routes.
DEC.mount(app, { pool, who, famOf, H, HttpError, ROLE_RANK, actorName, mail, T, publicUrl: mail.publicUrl, onWrite: () => bookCache.clear() });
NEWS.mount(app, { pool, who, famOf, H, HttpError, ROLE_RANK, actorName, mail, T, publicUrl: mail.publicUrl });
// AI connections (MCP): OAuth for AI clients, consent in the app, the /mcp endpoint. The AI acts as the signed-in person
// (ai-perm.js); admin actions only become requests (ai_requests) that an admin approves in Cài đặt.
const aiDeps = { pool, whoFor, readSession, findFamily, canRead, actorName, applyOp, acctKey, sameSite, doInvite, doRoleChange, doRemove,
  onWrite: () => bookCache.clear() };
mountOAuth(app, aiDeps);
mountMcp(app, aiDeps);
// GEDCOM export and import (gedcom-routes.js): same gates as the rest of the API.
mountGedcom(app, { pool, need, famOf, who, HttpError, applyOp, actorName, clearBookCache: () => bookCache.clear() });

// ---- photos (editors upload; anyone can view) ----
app.post('/api/photos', need('editor'), express.json({ limit: '1mb' }), async (req, res, next) => {
  try {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ''));
    if (!m) return res.status(400).json({ error: 'Ảnh không hợp lệ.' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 600 * 1024) return res.status(413).json({ error: 'Ảnh quá lớn (tối đa 600 KB).' });
    const id = crypto.randomBytes(12).toString('hex');
    await pool.query('insert into photos (id, mime, bytes, by_user) values ($1,$2,$3,$4)', [id, m[1], buf, actorName(req.who)]);
    res.json({ url: `/api/photos/${id}` });
  } catch (e) { next(e); }
});
// A photo is served only to a viewer who may see a record that shows it: an event or story (the person's events rule:
// a living person's go to members), or a person's photo (the family is readable). A photo no record shows is served to
// nobody (uploads are shown by the editor from a local preview until they are saved). Unauthorized: 404, so the
// existence of a photo is not revealed. A photo that a guest may see is cacheable for everyone; any other is private.
async function photoAccess(req, id) {
  const url = '/api/photos/' + id;
  const R = await EV.rules();
  const refs = [];
  const evs = await pool.query('select e.family_id, p.data from events e join persons p on p.id=e.person_id and p.family_id=e.family_id where e.photos ? $1 and p.deleted=false', [url]);
  for (const r of evs.rows) refs.push({ kind: 'event', famId: r.family_id, data: r.data });
  const sts = await pool.query('select s.family_id, p.data from stories s join persons p on p.id=s.person_id and p.family_id=s.family_id where s.photos ? $1 and p.deleted=false', [url]);
  for (const r of sts.rows) refs.push({ kind: 'story', famId: r.family_id, data: r.data });
  const pes = await pool.query('select family_id, data from persons where data->>\'photo\' = $1 and deleted=false', [url]);
  for (const r of pes.rows) refs.push({ kind: 'person', famId: r.family_id, data: r.data });
  let allowed = false; let open = false;
  const fams = new Map();
  for (const r of refs) {
    if (!fams.has(r.famId)) fams.set(r.famId, (await pool.query('select id, visibility from families where id=$1', [r.famId])).rows[0] || null);
    const fam = fams.get(r.famId); if (!fam) continue;
    const ok = (w) => {
      const readable = canRead(fam, w);
      return r.kind === 'person' ? readable && (isDead(r.data) || canSeePrivate(w)) : readable && R.canSeeEventsOf(r.data, { member: canSeePrivate(w), familyReadable: true });
    };
    if (ok({ role: 'guest' })) { allowed = true; open = true; }
    else if (!allowed && ok(await who(req, fam.id))) allowed = true;
  }
  return { allowed, open };
}
app.get('/api/photos/:id', async (req, res, next) => {
  try {
    if (!/^[0-9a-f]{24}$/.test(req.params.id)) return res.status(404).end();
    const { rows } = await pool.query('select mime, bytes from photos where id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).end();
    const access = await photoAccess(req, req.params.id);
    if (!access.allowed) return res.status(404).end();
    res.set('Content-Type', rows[0].mime).set('Cache-Control', access.open ? 'public, max-age=31536000, immutable' : 'private, no-cache').send(rows[0].bytes);
  } catch (e) { next(e); }
});

// ---- giỗ calendar feed (public): /lich.ics?ids=P001,P002 (no ids = everyone with a giỗ). Lunar -> solar per year, 10 years. ----
let lunarMod = null;
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
app.get('/lich.ics', async (req, res, next) => {
  try {
    lunarMod = lunarMod || await import(require('url').pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'lunar.js')).href);
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter((s) => /^(P\d{3,6}|N[0-9a-z-]{6,40})$/.test(s)).slice(0, 200);
    const f = await famOf(req);
    if (!canRead(f, await who(req, f.id))) return res.status(403).end();
    const { rows } = await pool.query(ids.length ? 'select id, data from persons where not deleted and family_id = $2 and id = any($1)' : 'select id, data from persons where not deleted and family_id = $1', ids.length ? [ids, f.id] : [f.id]);
    const ymd = (t) => `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
    const now = new Date(); const y0 = now.getFullYear(); const ev = [];
    const site = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, ''); const siteHost = new URL(site).host;
    for (const r of rows) {
      const d = r.data; const s = d.gio_lunar || d.death_lunar; if (!s) continue;
      const [dd, mm] = s.split('/').map((x) => parseInt(x, 10)); if (!dd || !mm) continue;
      const nm = `${d.sex === 'f' ? 'Bà' : 'Ông'}${d.thu ? ' ' + d.thu : ''} ${d.name}`;
      for (let ly = y0 - 1; ly <= y0 + 10; ly++) {
        const at = lunarMod.lunarToSolar(dd, mm, ly); if (!at) continue;
        ev.push(['BEGIN:VEVENT', `UID:${r.id}-${ly}@${siteHost}`, `DTSTAMP:${ymd(now)}T000000Z`, `DTSTART;VALUE=DATE:${ymd(at)}`,
          `SUMMARY:${icsText(`Giỗ ${nm} (${dd}/${mm} ÂL)`)}`, `DESCRIPTION:${icsText(`${site}/#person/${r.id}`)}`, `URL:${site}/#person/${r.id}`,
          'BEGIN:VALARM', 'TRIGGER;RELATED=START:-PT16H', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(`Ngày mai: giỗ ${nm}`)}`, 'END:VALARM',
          'BEGIN:VALARM', 'TRIGGER;RELATED=START:PT7H', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(`Hôm nay: giỗ ${nm}`)}`, 'END:VALARM', 'END:VEVENT'].join('\r\n'));
      }
    }
    res.set('Content-Type', 'text/calendar; charset=utf-8').set('Cache-Control', 'public, max-age=21600')
      .send(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//genealogia//VI', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Ngày giỗ', 'X-WR-TIMEZONE:Asia/Ho_Chi_Minh', 'REFRESH-INTERVAL;VALUE=DURATION:P1D', ...ev, 'END:VCALENDAR', ''].join('\r\n'));
  } catch (e) { next(e); }
});

app.get('/healthz', async (_req, res) => {
  try { const r = await pool.query('select count(*)::int n from persons where not deleted'); res.json({ ok: true, persons: r.rows[0].n }); }
  catch { res.status(503).json({ ok: false }); }
});

// ---- static web app ----
const WEB = path.join(__dirname, '..', 'web');
// Build in use: the cache version in web/sw.js (bumped with each deploy). The app compares it with its own build
// (web/js/update.js BUILD) to show "Có bản mới". Never cached: the check must see the live build.
const SW_BUILD = (() => { try { return /const V = '([^']+)'/.exec(require('fs').readFileSync(path.join(WEB, 'sw.js'), 'utf8'))?.[1] || null; } catch { return null; } })();
// Commit in use: GIT_SHA from the deploy, else the checkout's HEAD (null when this is not a git checkout).
const GIT_SHA = process.env.GIT_SHA || (() => { try { return require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch { return null; } })();
app.get('/api/version', (req, res) => { res.set('cache-control', 'no-store'); res.json({ v: SW_BUILD, sha: GIT_SHA }); });
app.use(express.static(WEB, {
  // no-cache: Cloudflare and browsers must revalidate (ETag) so a deploy is visible at once
  setHeaders(res, p) { res.setHeader('Cache-Control', /\.(png|jpg|svg|webmanifest)$/.test(p) ? 'public, max-age=3600' : 'no-cache'); },
}));
// Book view may be embedded on other sites; the app itself may not.
app.get('/book', (_req, res) => { res.sendFile(path.join(WEB, 'book.html')); });
app.get(/^\/(?!api\/).*/, (_req, res) => { res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.sendFile(path.join(WEB, 'index.html')); });

app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.expose && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Dữ liệu gửi lên không hợp lệ.' }); // e.g. body too large
  console.error(err); res.status(500).json({ error: 'Lỗi máy chủ.' });
});

if (require.main === module) {
  // after a reboot the app may start before Postgres: wait (up to 60 s) before the first queries
  require('./db-wait').waitForDb(pool).then(() => require('./members-seed').seedMembers(pool))
    .catch((e) => console.error('seed members failed:', e.message));
  app.listen(PORT, '127.0.0.1', () => console.log(`giapha on :${PORT}`));
  // Succession daily run: checked hourly, runs when the last run (job_runs) is over 20 hours old. Restarts do not repeat it.
  const succTick = () => succession.runDailyIfDue(pool).then((st) => st && console.log('succession run', JSON.stringify(st)))
    .catch((e) => console.error('succession run failed:', e.message));
  setTimeout(succTick, 60e3); setInterval(succTick, 3600e3);
  // Places: look new places up in open data (off unless PLACES_ENRICH=1; GeoNames only with GEONAMES_USER).
  require('./places-enrich').startWorker({ pool });
  // Thùng rác: hourly, runs due delete requests; archive / purge only with GP_TRASH_PURGE=1 (else logs a dry run)
  const trashTick = () => { NEWS.sweep().catch((e) => console.error('news sweep failed:', e.message)); DEC.sweep().catch((e) => console.error('decision sweep failed:', e.message)); return TRASH.sweep().catch((e) => console.error('trash sweep failed:', e.message)); };
  setTimeout(trashTick, 120e3); setInterval(trashTick, 3600e3);
}
// Two-way Google Sheet sync (off unless SHEET_SYNC=on). Never overlaps: the job takes a pg advisory lock.
if (require.main === module && process.env.SHEET_SYNC === 'on') {
  const { runSync } = require('./sheetsync');
  const every = Math.max(1, Number(process.env.SHEET_SYNC_MIN) || 2) * 60e3;
  const tick = () => runSync(pool).catch((e) => console.error('sheet sync failed:', e.message));
  setTimeout(tick, 15e3); setInterval(tick, every);
}
module.exports = { app, pool };
