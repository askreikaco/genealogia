// Personal calendar feed (Lịch on the phone): one private feed per account and family, GET /cal/<token>.ics.
// The token is the secret: random 32 bytes (base64url), stored only as a SHA-256 hash, revocable ("Tạo link mới").
// Calendar apps cannot sign in, so the feed takes no login. Contents: the gatherings this account answered Đi (CONFIRMED)
// or Chưa biết (TENTATIVE), and the giỗ dates of the persons it follows (next two years). No body text, no member names.
// Stable UIDs (post-<id>@host, gio-<person>-<year>@host) so an update replaces the old event. Migration 027 (cal_tokens).
'use strict';
const crypto = require('crypto');
const path = require('path');

let lunarMod = null;
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const ICS = (s) => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
const ID_RE = /^(P\d{3,6}|N[0-9a-z-]{6,40})$/;
const HOUR = 3600e3;
const RATE = { max: 60, windowMs: 10 * 60e3 };
const hits = new Map(); // ip -> [ms], feed requests only

function rateLimited(ip, now = Date.now()) {
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  list.push(now); hits.set(ip, list);
  return list.length > RATE.max;
}
const ymd = (t) => `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
const stamp = (t) => `${ymd(t)}T${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}00`;

// Gatherings the account answered Đi or Chưa biết; a Không đi or no answer is not in the feed.
function gatheringEvents(rows, { host, base, now }) {
  const out = [];
  for (const r of rows) {
    const status = r.answer === 'yes' ? 'CONFIRMED' : 'TENTATIVE';
    const link = `${base}/#/${r.slug}/tin/${r.id}`;
    const head = ['BEGIN:VEVENT', `UID:post-${r.id}@${host}`, `DTSTAMP:${ymd(now)}T000000Z`, `STATUS:${status}`, `SUMMARY:${ICS(`Họp mặt: ${r.title}`)}`];
    if (r.place) head.push(`LOCATION:${ICS(r.place)}`);
    const m = /^(\d{1,2}):(\d{2})/.exec(r.time || '');
    const [y, mo, d] = String(r.starts_at).split('-').map(Number);
    if (m) {
      const h = Number(m[1]); const end = h + 2 < 24 ? `${ymd(new Date(y, mo - 1, d))}T${String(h + 2).padStart(2, '0')}${m[2]}00` : null;
      head.push(`DTSTART;TZID=Asia/Ho_Chi_Minh:${ymd(new Date(y, mo - 1, d))}T${String(h).padStart(2, '0')}${m[2]}00`);
      if (end) head.push(`DTEND;TZID=Asia/Ho_Chi_Minh:${end}`);
    } else {
      head.push(`DTSTART;VALUE=DATE:${ymd(new Date(y, mo - 1, d))}`);
    }
    head.push(`DESCRIPTION:${ICS(link)}`, `URL:${link}`, 'END:VEVENT');
    out.push(head.join('\r\n'));
  }
  return out;
}

// Giỗ dates of the followed persons (same lunar rule as /lich.ics), two years from this year. No name in the event.
async function gioEvents(persons, { host, base, slug, now }) {
  lunarMod = lunarMod || await import(require('url').pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'lunar.js')).href);
  const out = []; const y0 = now.getFullYear(); const today = new Date(y0, now.getMonth(), now.getDate());
  for (const p of persons) {
    const s = p.data.gio_lunar || p.data.death_lunar; if (!s) continue;
    const [dd, mm] = String(s).split('/').map((x) => parseInt(x, 10)); if (!dd || !mm) continue;
    for (let ly = y0; ly <= y0 + 2; ly++) {
      const at = lunarMod.lunarToSolar(dd, mm, ly); if (!at || at < today) continue;
      const link = `${base}/#/${slug}/person/${p.id}`;
      out.push(['BEGIN:VEVENT', `UID:gio-${p.id}-${ly}@${host}`, `DTSTAMP:${ymd(now)}T000000Z`, 'STATUS:CONFIRMED', 'TRANSP:TRANSPARENT',
        `DTSTART;VALUE=DATE:${ymd(at)}`, `SUMMARY:${ICS(`Ngày giỗ (${dd}/${mm} ÂL)`)}`, `DESCRIPTION:${ICS(link)}`, `URL:${link}`, 'END:VEVENT'].join('\r\n'));
    }
  }
  return out;
}

function mount(app, d) {
  const { pool, H, HttpError, member, publicUrl } = d;
  const base = () => publicUrl().replace(/\/+$/, '');
  const host = () => new URL(base()).host;
  const cleanFollows = (v) => [...new Set((Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter((s) => ID_RE.test(s)))].slice(0, 200);
  const active = async (m) => (await pool.query('select id, follows, last_fetch_at from cal_tokens where account_key=$1 and family_id=$2 and revoked_at is null order by id desc limit 1', [m.me, m.f.id])).rows[0] || null;

  // Create a new link; the previous one stops working at once.
  app.post('/api/cal-token', H(async (req, res) => {
    const m = await member(req);
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query("update cal_tokens set revoked_at=now() where account_key=$1 and family_id=$2 and revoked_at is null", [m.me, m.f.id]);
    await pool.query('insert into cal_tokens (account_key, family_id, token_hash, follows) values ($1,$2,$3,$4)', [m.me, m.f.id, sha(token), cleanFollows((req.body || {}).follows)]);
    res.json({ url: `${base()}/cal/${token}.ics` });
  }));

  // The followed giỗ persons, kept in step with the app's ☆ list.
  app.put('/api/cal-token/follows', H(async (req, res) => {
    const m = await member(req); const t = await active(m);
    if (t) await pool.query('update cal_tokens set follows=$2 where id=$1', [t.id, cleanFollows((req.body || {}).follows)]);
    res.json({ ok: true, exists: !!t });
  }));

  // Whether this account has a link, and whether a calendar app has fetched it (the Lịch prompt depends on it).
  app.get('/api/cal-token', H(async (req, res) => {
    const m = await member(req); const t = await active(m);
    res.json({ exists: !!t, subscribed: !!(t && t.last_fetch_at), last_fetch_at: t && t.last_fetch_at ? new Date(t.last_fetch_at).toISOString() : null });
  }));

  app.get('/cal/:file', async (req, res, next) => {
    try {
      res.set('X-Robots-Tag', 'noindex, nofollow, noarchive').set('Cache-Control', 'private');
      if (rateLimited(req.ip)) return res.status(429).type('text/plain').send('Quá nhiều yêu cầu. Thử lại sau.');
      const file = String(req.params.file || '');
      if (!file.endsWith('.ics') || file.length < 46 || file.length > 60) return res.status(404).type('text/plain').send('Không tìm thấy.');
      const { rows } = await pool.query('select id, account_key, family_id, follows from cal_tokens where token_hash=$1 and revoked_at is null', [sha(file.slice(0, -4))]);
      const t = rows[0];
      if (!t) return res.status(404).type('text/plain').send('Không tìm thấy.');
      await pool.query('update cal_tokens set last_fetch_at=now() where id=$1', [t.id]);
      const fam = (await pool.query('select id, slug, name from families where id=$1', [t.family_id])).rows[0];
      const now = new Date();
      const gat = await pool.query(`select p.id, p.title, p.place, p.time, to_char(p.starts_at, 'YYYY-MM-DD') as starts_at, f.slug, n.answer
        from posts p join families f on f.id = p.family_id join rsvps n on n.post_id = p.id and n.account_key = $2
        where p.family_id = $1 and p.kind = 'gathering' and p.status = 'live' and p.deleted_at is null
          and p.starts_at >= (now() - interval '1 day')::date and n.answer in ('yes', 'maybe')
        order by p.starts_at, p.id`, [t.family_id, t.account_key]);
      const persons = t.follows && t.follows.length
        ? (await pool.query("select id, data from persons where family_id=$1 and not deleted and id = any($2)", [t.family_id, t.follows])).rows : [];
      const ev = [...gatheringEvents(gat.rows, { host: host(), base: base(), now }),
        ...(await gioEvents(persons, { host: host(), base: base(), slug: fam.slug, now }))];
      res.set('Content-Type', 'text/calendar; charset=utf-8');
      res.send(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//genealogia//VI', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:Lịch ${ICS(fam.name)}`,
        'X-WR-TIMEZONE:Asia/Ho_Chi_Minh', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', ...ev, 'END:VCALENDAR', ''].join('\r\n'));
    } catch (e) { next(e); }
  });
}

module.exports = { mount, gatheringEvents, rateLimited, RATE, sha };
