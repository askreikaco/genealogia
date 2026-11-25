// Giỗ reminder e-mail (N1). One digest a week per opted-in account (user_prefs.gio_digest), Monday 07:00 Vietnam time,
// listing the giỗ dates of the next 14 days for the people the account follows. Pure parts first (digestItems,
// signUnsub, openUnsub); the sender and the routes take the pool and the mail module.
// Members-only data: a followed person is listed only when the account can read that family (an active member, or a
// public or link family it follows); a living person is never listed. Mail goes through mail.send (logged in mail_log).
// The unsubscribe link carries a payload signed with HMAC-SHA256 (GP_DIGEST_SECRET). No secret, no digest and no link.
'use strict';
const crypto = require('crypto');
const path = require('path');
const mail = require('./mail');
const T = require('./mail-templates');

const VN_MS = 7 * 3600e3;
const WINDOW_DAYS = 14;
const WEEK_GUARD_MS = 6 * 864e5; // one digest per account per week: a stored last send inside this span blocks a new one
const SLOT_HOUR = 7;

let lunarMod = null;
// The lunar module is shared with the browser (web/js/lunar.js); loaded once, as news-cal.js does.
async function loadLunar() {
  lunarMod = lunarMod || await import(require('url').pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'lunar.js')).href);
  return lunarMod;
}
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// The Vietnam calendar day of an instant, as YYYY-MM-DD.
const vnDay = (now) => new Date(now.getTime() + VN_MS).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Giỗ items in the window [today, today + 13] (14 days, Vietnam time). A lunar date is tried in the lunar years
// before, of and after the solar year, so a window across New Year (lunar 11-12 of last year) is complete.
// persons: [{ id, slug, data: { name, gio_lunar?, death_lunar?, living? } }]. Returns sorted [{ id, slug, name, day, lunar }].
function digestItems(persons, lunar, now = new Date()) {
  const today = vnDay(now); const end = addDays(today, WINDOW_DAYS - 1);
  const y = Number(today.slice(0, 4)); const out = [];
  for (const p of persons) {
    const d0 = p.data || {};
    if (d0.living === 'living') continue; // privacy: a living person is never in a mail
    const s = d0.gio_lunar || d0.death_lunar; if (!s) continue;
    const [dd, mm] = String(s).split('/').map((x) => parseInt(x, 10)); if (!dd || !mm) continue;
    const seen = new Set();
    for (const ly of [y - 1, y, y + 1]) {
      const at = lunar.lunarToSolar(dd, mm, ly); if (!at) continue;
      const day = isoOf(at);
      if (day < today || day > end || seen.has(day)) continue;
      seen.add(day);
      out.push({ id: p.id, slug: p.slug, name: d0.name || '', day, lunar: `${dd}/${mm}` });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// The latest Monday 07:00 (Vietnam time) at or before now: the slot a weekly run belongs to.
function weekSlot(now = new Date()) {
  const v = new Date(now.getTime() + VN_MS);
  const back = (v.getUTCDay() + 6) % 7; // days since Monday
  const monday = new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate() - back, SLOT_HOUR, 0, 0));
  let slot = new Date(monday.getTime() - VN_MS);
  if (slot.getTime() > now.getTime()) slot = new Date(slot.getTime() - 7 * 864e5);
  return slot;
}

const b64u = (s) => Buffer.from(s).toString('base64url');
const hmac = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('base64url');
// Signed unsubscribe token for one account: base64url(JSON { e, v }) + '.' + HMAC. Null without a secret.
function signUnsub(email, secret = process.env.GP_DIGEST_SECRET || '') {
  if (!secret) return null;
  const body = b64u(JSON.stringify({ e: String(email).toLowerCase(), v: 1 }));
  return `${body}.${hmac(body, secret)}`;
}
// The email a token was signed for, or null (bad shape, wrong signature, no secret).
function openUnsub(token, secret = process.env.GP_DIGEST_SECRET || '') {
  if (!secret || typeof token !== 'string' || token.length > 600) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(hmac(body, secret)); const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try { const j = JSON.parse(Buffer.from(body, 'base64url').toString()); return j.v === 1 && typeof j.e === 'string' ? j.e : null; } catch { return null; }
}

// The persons an account may get a digest for: followed (user_prefs.prefs.follows), in a family it can read.
async function followedPersons(pool, email, prefs) {
  const follows = Array.isArray(prefs?.follows) ? prefs.follows.filter((x) => typeof x === 'string') : [];
  if (!follows.length) return [];
  const fams = Array.isArray(prefs?.follows_families) ? prefs.follows_families.filter((x) => typeof x === 'string') : [];
  const { rows } = await pool.query(`select p.id, p.data, f.slug from persons p join families f on f.id = p.family_id
    where not p.deleted and p.id = any($1)
      and (p.family_id in (select family_id from members where email = $2 and status = 'active')
        or (f.slug = any($3) and f.visibility <> 'private'))`, [follows, email, fams]);
  return rows;
}

// One account's digest (or null when nothing falls in the window).
async function digestFor(pool, email, now, lunar) {
  const { rows } = await pool.query('select prefs from user_prefs where email = $1', [email]);
  const items = digestItems(await followedPersons(pool, email, rows[0]?.prefs || {}), lunar, now);
  return items.length ? items : null;
}

// Sends the weekly digest once per slot. Returns { slot, sent, skipped } or null when this slot already ran.
// Each account is claimed (gio_digest_sent_at) before its mail; a mail that is not sent gives the claim back.
async function runDigestIfDue(pool, now = new Date(), { mailer = mail, lunar = null } = {}) {
  const secret = process.env.GP_DIGEST_SECRET || '';
  const slot = weekSlot(now);
  await pool.query("insert into job_runs (name, last_run_at) values ('gio-digest', 'epoch') on conflict (name) do nothing");
  const claimed = await pool.query("update job_runs set last_run_at = $1 where name = 'gio-digest' and last_run_at < $1 returning name", [slot]);
  if (!claimed.rowCount) return null;
  const lm = lunar || await loadLunar();
  const copy = require('./digest-vi');
  const stats = { slot: slot.toISOString(), sent: 0, skipped: 0 };
  const { rows: accts } = await pool.query('select email from user_prefs where gio_digest and (gio_digest_sent_at is null or gio_digest_sent_at < $1)', [new Date(now.getTime() - WEEK_GUARD_MS)]);
  for (const { email } of accts) {
    const items = await digestFor(pool, email, now, lm);
    const token = signUnsub(email, secret);
    if (!items || !token) { stats.skipped++; continue; }
    const got = await pool.query('update user_prefs set gio_digest_sent_at = $2 where email = $1 and gio_digest and (gio_digest_sent_at is null or gio_digest_sent_at < $3) returning email',
      [email, now, new Date(now.getTime() - WEEK_GUARD_MS)]);
    if (!got.rowCount) { stats.skipped++; continue; }
    const msg = T.gioDigest({ items, copy, unsubUrl: `${mail.publicUrl()}/api/digest/unsubscribe?t=${token}` });
    const r = await mailer.send(pool, { kind: 'gio_digest', to: email, dedupeKey: `gio-digest:${email}:${slot.toISOString().slice(0, 10)}`, ...msg });
    if (r.status === 'sent') stats.sent++;
    else { stats.skipped++; await pool.query('update user_prefs set gio_digest_sent_at = null where email = $1', [email]); }
  }
  return stats;
}

const UNSUB_PAGE = (title, text) => `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#161616;background:#f4f4f4"><main style="max-width:560px;margin:0 auto;background:#fff;padding:24px;border-radius:6px"><h1 style="font-size:22px">${title}</h1><p style="font-size:16px;line-height:1.6">${text}</p><p><a href="/">Mở Gia phả</a></p></main></body></html>`;

// Routes: the toggle (signed in with Google) and the unsubscribe link (signed token, no sign-in).
function mount(app, d) {
  const { pool, H, HttpError, requireGoogle } = d;
  app.get('/api/me/digest', H(async (req, res) => {
    const email = await requireGoogle(req);
    const { rows } = await pool.query('select gio_digest, gio_digest_sent_at from user_prefs where email = $1', [email]);
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: !!rows[0]?.gio_digest, last_sent_at: rows[0]?.gio_digest_sent_at ? new Date(rows[0].gio_digest_sent_at).toISOString() : null });
  }));
  app.put('/api/me/digest', H(async (req, res) => {
    const email = await requireGoogle(req);
    const on = (req.body || {}).enabled;
    if (typeof on !== 'boolean') throw new HttpError(400, 'Cài đặt không hợp lệ.');
    await pool.query("insert into user_prefs (email, gio_digest) values ($1, $2) on conflict (email) do update set gio_digest = $2, updated_at = now()", [email, on]);
    res.json({ ok: true, enabled: on });
  }));
  // The mail link: turns the toggle off for the signed account. A bad or unsigned token gets a page, not a 500.
  app.get('/api/digest/unsubscribe', H(async (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow').set('Cache-Control', 'no-store');
    const copy = require('./digest-vi');
    const email = openUnsub(String(req.query.t || ''));
    if (!email) return res.status(400).type('html').send(UNSUB_PAGE(copy.unsub_bad_title, copy.unsub_bad_text));
    await pool.query('update user_prefs set gio_digest = false, updated_at = now() where email = $1', [email]);
    res.type('html').send(UNSUB_PAGE(copy.unsub_done_title, copy.unsub_done_text));
  }));
}

module.exports = { mount, digestItems, weekSlot, signUnsub, openUnsub, runDigestIfDue, digestFor, loadLunar, WINDOW_DAYS };
