// Accounts: one account (stable id) with many sign-in identities, server-side sessions, security events.
// Pure rules (no database) first, then the database helpers used by server.js and account-routes.js.
'use strict';
const crypto = require('crypto');

const EMAIL_RE = /^[^\s@]{1,200}@[^\s@]{1,200}\.[^\s@]{1,50}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SID_RE = /^[0-9a-f]{32}$/;
const REAUTH_MS = 10 * 60e3; // sensitive changes need a sign-in within the last 10 minutes
const VERIFY_MS = 30 * 60e3; // an email verification link lives 30 minutes
const SIGNIN_TYPES = ['google', 'apple', 'zalo', 'facebook', 'phone']; // identities that can sign in (P1: google)

const normEmail = (s) => String(s || '').trim().toLowerCase();
const isEmail = (s) => EMAIL_RE.test(normEmail(s)) && normEmail(s).length <= 254;
const newId = () => crypto.randomBytes(16).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
// The network the request came from, never the full address: a.b.c.0/24 for IPv4, the first 3 groups for IPv6.
function ipPrefix(ip) {
  const s = String(ip || '').replace(/^::ffff:/, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(s);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (s.includes(':')) return s.split(':').slice(0, 3).join(':') + '::/48';
  return '';
}
// A short device name from the user agent ("iPhone · Safari", "Android · Chrome", "Mac · Safari", "Windows · Edge");
// never the full string. In-app browsers common in Vietnam (Zalo, Facebook, Messenger) and Cốc Cốc are named; iOS
// browsers say which app (Chrome/Firefox/Edge on iOS use WebKit but carry CriOS/FxiOS/EdgiOS). Unknown parts fall back to
// "Thiết bị khác" / "Trình duyệt".
function deviceLabel(ua) {
  const u = String(ua || '');
  const os = /iPhone|iPod/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /CrOS/.test(u) ? 'Chromebook'
    : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux|X11/.test(u) ? 'Linux' : 'Thiết bị khác';
  const br = /Zalo/i.test(u) ? 'Zalo' : /\bFB_IAB\b|FBAN|FBAV/.test(u) ? (/Messenger|FBAN\/MessengerForiOS|Orca-Android/.test(u) ? 'Messenger' : 'Facebook')
    : /Instagram/.test(u) ? 'Instagram' : /coc_coc_browser/.test(u) ? 'Cốc Cốc' : /SamsungBrowser\//.test(u) ? 'Samsung Internet'
    : /Edg(e|A|iOS)?\//.test(u) ? 'Edge' : /OPR\/|Opera|OPiOS/.test(u) ? 'Opera' : /Firefox\/|FxiOS/.test(u) ? 'Firefox'
    : /CriOS|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) && /Version\//.test(u) ? 'Safari' : 'Trình duyệt';
  return `${os} · ${br}`;
}
const fresh = (authAt, now = Date.now()) => Number(authAt) > 0 && now - Number(authAt) <= REAUTH_MS;

// Rules over an account's identities (rows: {id, type, value_norm, verified_at, is_primary}) and its passkey count.
// Sign-in methods: linked providers (Google now; Apple, Zalo, Facebook, phone later) and passkeys.
const signInCount = (ids, passkeys = 0) => ids.filter((x) => SIGNIN_TYPES.includes(x.type) && (x.type !== 'phone' || x.verified_at)).length + passkeys;
const verifiedEmails = (ids) => ids.filter((x) => x.type === 'email' && x.verified_at);
// Why an identity cannot be removed (Vietnamese, shown to the person), or '' when it can.
function removeBlock(ids, id, passkeys = 0) {
  const x = ids.find((i) => String(i.id) === String(id));
  if (!x) return 'Không tìm thấy.';
  if (x.type === 'email') {
    if (x.is_primary) return 'Đây là email chính. Chọn email khác làm email chính trước.';
    if (x.verified_at && verifiedEmails(ids).length <= 1) return 'Tài khoản cần ít nhất một email đã xác minh.';
    return '';
  }
  if (SIGNIN_TYPES.includes(x.type) && signInCount(ids, passkeys) <= 1) return 'Đây là cách đăng nhập duy nhất. Thêm cách khác trước khi gỡ.';
  return '';
}
// Which email becomes primary: the requested one when verified, else null.
const canBePrimary = (ids, id) => { const x = ids.find((i) => String(i.id) === String(id)); return !!(x && x.type === 'email' && x.verified_at); };

// ---- rate limits (in memory; per process) ----
const buckets = new Map();
// true when the key is still under max hits within win ms (and counts this hit).
function hit(key, max, win, now = Date.now()) {
  const b = buckets.get(key) || { n: 0, at: now };
  if (now - b.at > win) { b.n = 0; b.at = now; }
  b.n++; buckets.set(key, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.at > win) buckets.delete(k);
  return b.n <= max;
}

// ---- database helpers ----
async function event(db, accountId, kind, detail = {}, req = null) {
  await db.query('insert into account_events (account_id, kind, detail, ip_prefix, ua) values ($1,$2,$3,$4,$5)',
    [accountId, kind, detail, req ? ipPrefix(req.ip) : '', req ? deviceLabel(req.get?.('user-agent')) : '']);
}
async function identitiesOf(db, accountId) {
  const { rows } = await db.query('select id, type, value_norm, provider_sub, verified_at, is_primary, created_at, last_used_at from identities where account_id = $1 order by type, is_primary desc, created_at', [accountId]);
  return rows;
}
async function emailsOf(db, accountId) {
  const { rows } = await db.query("select value_norm from identities where account_id = $1 and type = 'email' and verified_at is not null", [accountId]);
  return rows.map((r) => r.value_norm);
}
// members rows of the account's verified emails get its account_id (roles keep working through either key).
async function fillAccountIds(db, accountId) {
  const emails = await emailsOf(db, accountId);
  if (!emails.length) return;
  for (const t of ['members', 'person_managers', 'user_prefs']) await db.query(`update ${t} set account_id = $1 where account_id is null and email = any($2)`, [accountId, emails]);
  await db.query('update suggestions set account_id = $1 where account_id is null and account_email = any($2)', [accountId, emails]);
}
// The account of a verified email (or null).
async function byEmail(db, email) {
  const { rows } = await db.query("select account_id from identities where type = 'email' and value_norm = $1 and verified_at is not null", [normEmail(email)]);
  return rows[0]?.account_id || null;
}
// A new account with one verified, primary email.
async function createWithEmail(db, email, name) {
  const { rows } = await db.query('insert into accounts (name) values ($1) returning id', [String(name || '').slice(0, 120)]);
  const id = rows[0].id;
  await db.query("insert into identities (account_id, type, value_norm, verified_at, is_primary) values ($1, 'email', $2, now(), true)", [id, normEmail(email)]);
  return id;
}
// Google sign-in: the stable 'sub' finds the account. First time for this sub: the account whose VERIFIED email equals
// Google's verified email gets the Google identity (same person proven twice); else a new account. Never by an
// unverified email. Returns { accountId, created, linked }.
async function resolveGoogle(pool, { sub, email, name }) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const em = normEmail(email);
    const { rows } = await c.query("select account_id from identities where type = 'google' and provider_sub = $1 for update", [String(sub)]);
    let accountId = rows[0]?.account_id; let created = false; let linked = false;
    if (accountId) await c.query("update identities set value_norm = $2, last_used_at = now() where type = 'google' and provider_sub = $1", [String(sub), em]);
    else {
      accountId = await byEmail(c, em);
      if (!accountId) { accountId = await createWithEmail(c, em, name); created = true; }
      await c.query("insert into identities (account_id, type, value_norm, provider_sub, verified_at, last_used_at) values ($1, 'google', $2, $3, now(), now())", [accountId, em, String(sub)]);
      linked = true;
    }
    await fillAccountIds(c, accountId);
    await c.query('commit');
    return { accountId, created, linked };
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}
// Link a Google identity to a signed-in account (Account page, after a fresh sign-in). Errors: already on another account.
async function linkGoogle(pool, accountId, { sub, email }) {
  const { rows } = await pool.query("select account_id from identities where type = 'google' and provider_sub = $1", [String(sub)]);
  if (rows[0] && rows[0].account_id !== accountId) return { ok: false, error: 'Tài khoản Google này đang thuộc một tài khoản khác. Gộp tài khoản sẽ có sau.' };
  if (rows[0]) return { ok: true, already: true };
  await pool.query("insert into identities (account_id, type, value_norm, provider_sub, verified_at, last_used_at) values ($1, 'google', $2, $3, now(), now())", [accountId, normEmail(email), String(sub)]);
  return { ok: true };
}
// Old cookies (before accounts) name only an email that came from a verified Google sign-in: find or make its account.
async function ensureByEmail(pool, email, name) {
  const found = await byEmail(pool, email);
  if (found) return found;
  try { const id = await createWithEmail(pool, email, name); await fillAccountIds(pool, id); return id; } catch (e) {
    if (e.code === '23505') return byEmail(pool, email); // another request made it at the same moment
    throw e;
  }
}
async function createSession(pool, accountId, req) {
  const id = newId();
  await pool.query('insert into sessions (id, account_id, label, ip_prefix) values ($1,$2,$3,$4)', [id, accountId, deviceLabel(req.get('user-agent')), ipPrefix(req.ip)]);
  return id;
}
// Revoked session ids among these (one query; cached per id for 30 s so a revoke applies within half a minute).
const revCache = new Map();
async function revokedOf(pool, sids, now = Date.now()) {
  const need = sids.filter((s) => SID_RE.test(s) && !(revCache.get(s)?.until > now));
  if (need.length) {
    const { rows } = await pool.query('select id, revoked_at is not null as gone from sessions where id = any($1)', [need]);
    const seen = new Set(rows.map((r) => r.id));
    for (const r of rows) revCache.set(r.id, { gone: r.gone, until: now + 30e3 });
    for (const s of need) if (!seen.has(s)) revCache.set(s, { gone: true, until: now + 30e3 }); // unknown id = not valid
    if (revCache.size > 20000) revCache.clear();
    // last seen: at most one write per session per 10 minutes
    pool.query("update sessions set last_seen_at = now() where id = any($1) and revoked_at is null and last_seen_at < now() - interval '10 minutes'", [need]).catch(() => {});
  }
  return new Set(sids.filter((s) => revCache.get(s)?.gone));
}
const forget = (sid) => revCache.delete(sid);
async function revoke(pool, sids) {
  const list = sids.filter((s) => SID_RE.test(s));
  if (!list.length) return;
  await pool.query('update sessions set revoked_at = now() where id = any($1) and revoked_at is null', [list]);
  for (const s of list) revCache.set(s, { gone: true, until: Date.now() + 30e3 });
}
async function newToken(db, accountId, purpose, target, ttlMs) {
  const tok = crypto.randomBytes(24).toString('base64url');
  await db.query('insert into account_tokens (hash, account_id, purpose, target, expires_at) values ($1,$2,$3,$4,$5)', [sha(tok), accountId, purpose, target, new Date(Date.now() + ttlMs)]);
  return tok;
}
// Uses a token once. Returns the row or null (unknown, used or expired).
async function useToken(db, tok, purpose) {
  const { rows } = await db.query('update account_tokens set used_at = now() where hash = $1 and purpose = $2 and used_at is null and expires_at > now() returning account_id, target', [sha(tok), purpose]);
  return rows[0] || null;
}

module.exports = {
  EMAIL_RE, UUID_RE, SID_RE, REAUTH_MS, VERIFY_MS, SIGNIN_TYPES, normEmail, isEmail, newId, sha, ipPrefix, deviceLabel, fresh,
  signInCount, verifiedEmails, removeBlock, canBePrimary, hit,
  event, identitiesOf, emailsOf, fillAccountIds, byEmail, createWithEmail, resolveGoogle, linkGoogle, ensureByEmail,
  createSession, revokedOf, revoke, forget, newToken, useToken,
};
