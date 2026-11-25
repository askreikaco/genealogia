// Tin họ (family news) and gatherings on the Lịch tab. Tables: migration NNN_news.sql (posts, rsvps, post_reminders,
// post_reports; families.news_posters). Thông báo (notice) and Họp mặt (gathering).
// Privacy: every route needs a signed-in member of the family (403 otherwise, anonymous too); responses carry
// X-Robots-Tag noindex; mails carry the title and a sign-in link only.
// Posting: owners and admins (families.news_posters = 'admin'), or editors as well ('editor'). Others suggest through Góp ý.
// Posts pass light text checks (content-rules.js): a held post waits for an owner or admin; two member reports hide a post.
// Every step writes to family_history (field 'tin').
'use strict';
const R = require('./news-rules');
const TRASH = require('./trash');
const CR = require('./content-rules');
const { SYSTEM_MEMBER_SQL } = require('./system-accounts');

let D = null; // { pool, publicUrl, mail, T }
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const RATE_PER_DAY = 5;
const REPORTS_TO_HIDE = 2;
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const COLS = `id, kind, title, body, pinned, to_char(starts_at, 'YYYY-MM-DD') as starts_at, lunar, time, place, map_url,
  organiser, created_by, author_key, status, hold, created_at, updated_at`;

function clean(b, HttpError) {
  const kind = b.kind === 'gathering' ? 'gathering' : b.kind === 'notice' ? 'notice' : null;
  if (!kind) throw new HttpError(400, 'Loại tin không hợp lệ.');
  const title = clip(b.title, 200);
  if (!title) throw new HttpError(400, 'Cần có tiêu đề.');
  const x = { kind, title, body: clip(b.body, 5000), pinned: !!b.pinned, starts_at: null, lunar: null, time: null, place: null, map_url: null, organiser: null };
  if (kind === 'gathering') {
    if (!ISO.test(String(b.starts_at || '')) || Number.isNaN(Date.parse(b.starts_at))) throw new HttpError(400, 'Cần chọn ngày họp mặt.');
    x.starts_at = b.starts_at;
    x.lunar = clip(b.lunar, 60) || null; x.time = clip(b.time, 20) || null;
    x.place = clip(b.place, 200) || null; x.organiser = clip(b.organiser, 100) || null;
    const map = clip(b.map_url, 500);
    if (map && !/^https?:\/\//i.test(map)) throw new HttpError(400, 'Liên kết bản đồ phải bắt đầu bằng https://');
    x.map_url = map || null;
  }
  return x;
}
// The text the checks read (every field a member can type).
const textOf = (x) => [x.title, x.body, x.place, x.organiser, x.lunar, x.time, x.map_url].filter(Boolean).join('\n');

// Active members of the family with an email (lower case), except one address.
async function memberEmails(famId, except = '') {
  const { rows } = await D.pool.query(`select distinct lower(email) as email from members where family_id=$1 and status='active' and email is not null and not ${SYSTEM_MEMBER_SQL}`, [famId]); // system accounts (.invalid) get no notice
  return rows.map((r) => r.email).filter((e) => e !== String(except).toLowerCase());
}
async function adminEmails(famId) {
  const { rows } = await D.pool.query(`select distinct lower(email) as email from members where family_id=$1 and status='active' and role in ('owner','admin') and email is not null and not ${SYSTEM_MEMBER_SQL}`, [famId]);
  return rows.map((r) => r.email);
}
// In-app notice and mail to members. The mail carries the title and a sign-in link only, never the body.
async function notify(fam, { title, path, except = '', emails = null, mail = true }) {
  const url = `${D.publicUrl()}/#/${fam.slug}/${path}`;
  const to = emails || await memberEmails(fam.id, except);
  for (const email of to) {
    if (email === String(except).toLowerCase()) continue;
    await D.pool.query('insert into notices (email, family_id, kind, body) values ($1,$2,$3,$4)', [email, fam.id, 'news', title]);
    if (!mail) continue;
    const m = D.T.newsNotice({ family: fam.name, title, paras: ['Đăng nhập để xem tin.'], url });
    await D.mail.send(D.pool, { familyId: fam.id, kind: 'news', to: email, subject: m.subject, html: m.html, text: m.text }).catch(() => {});
  }
}
// Family history: one row per step (field 'tin').
async function hist(q, famId, action, detail, by) {
  await q.query('insert into family_history (family_id, field, old_value, new_value, by_user) values ($1,$2,$3,$4,$5)',
    [famId, 'tin', null, JSON.stringify({ action, ...detail }), by]);
}

// Post as the API returns it. `sum` = RSVP totals, `mine` = this account's answer, `ctx` = { isAdmin, me, reports }.
function view(r, sum = { yes: 0, maybe: 0, no: 0 }, mine = null, ctx = {}) {
  return { id: Number(r.id), kind: r.kind, title: r.title, body: r.body, pinned: !!r.pinned, starts_at: r.starts_at || null,
    lunar: r.lunar, time: r.time, place: r.place, map_url: r.map_url, organiser: r.organiser, created_by: r.created_by,
    created_at: r.created_at, updated_at: r.updated_at, status: r.status, mine_author: r.author_key === ctx.me,
    hold: ctx.isAdmin || r.author_key === ctx.me ? (r.hold || []) : [],
    reports: ctx.isAdmin ? (ctx.reports || 0) : undefined,
    rsvp: r.kind === 'gathering' ? { yes: sum.yes, maybe: sum.maybe, no: sum.no, mine: mine ? mine.answer : null } : null };
}

// Reminders for live gatherings 0-3 days away. The smallest due stage is sent (once); the others are recorded so nothing is sent late.
async function sweep(nowMs = Date.now()) {
  const today = R.vnDate(nowMs);
  const { rows } = await D.pool.query(`select p.id, p.title, to_char(p.starts_at, 'YYYY-MM-DD') as starts_at, f.id as fam_id, f.slug, f.name
    from posts p join families f on f.id = p.family_id
    where p.kind='gathering' and p.status='live' and p.deleted_at is null and p.starts_at >= $1::date and p.starts_at <= $1::date + 3`, [today]);
  const out = [];
  for (const p of rows) {
    const left = R.daysBetween(today, p.starts_at);
    const due = R.dueStages(left);
    const chosen = due[due.length - 1];
    for (const stage of due) {
      const ins = await D.pool.query('insert into post_reminders (post_id, stage) values ($1,$2) on conflict do nothing returning stage', [p.id, stage]);
      if (!ins.rowCount || stage !== chosen) continue;
      const when = left === 0 ? 'hôm nay' : left === 1 ? 'ngày mai' : `còn ${left} ngày`;
      await notify({ id: p.fam_id, slug: p.slug, name: p.name }, { title: `Họp mặt ${when}: ${p.title}`, path: `tin/${p.id}` });
      out.push({ id: Number(p.id), stage });
    }
  }
  return out;
}

function mount(app, d) {
  D = d;
  const { pool, who, famOf, H, HttpError, ROLE_RANK } = d;
  // Members only. Anonymous visitors and members of other families get 403.
  const member = async (req) => {
    const f = await famOf(req); const w = await who(req, f.id);
    if (ROLE_RANK[w.role] >= ROLE_RANK.member && (w.email || w.code)) return { f, w, me: TRASH.actorKey(w), isAdmin: ROLE_RANK[w.role] >= ROLE_RANK.admin, admin: ROLE_RANK[w.role] >= ROLE_RANK.admin, editor: ROLE_RANK[w.role] >= ROLE_RANK.editor };
    throw new HttpError(403, 'Tin họ chỉ dành cho thành viên trong dòng họ.');
  };
  const posters = async (famId) => (await pool.query('select news_posters from families where id=$1', [famId])).rows[0]?.news_posters || 'admin';
  const canPost = (m, pos) => m.admin || (pos === 'editor' && m.editor);
  const visible = (m) => `(status='live' or $3::boolean or (status='held' and author_key=$2))`; // admins also see held and hidden
  const postRow = async (f, m, id) => {
    const p = (await pool.query(`select ${COLS} from posts where id=$1 and family_id=$4 and deleted_at is null and ${visible(m)}`, [Number(id) || 0, m.me, m.isAdmin, f.id])).rows[0];
    if (!p) throw new HttpError(404, 'Không tìm thấy tin này.');
    return p;
  };
  const sums = async (ids) => {
    const out = new Map();
    if (!ids.length) return out;
    const { rows } = await pool.query('select post_id, answer, count(*)::int as n from rsvps where post_id = any($1::bigint[]) group by 1, 2', [ids]);
    for (const id of ids) out.set(Number(id), R.summarize(rows.filter((r) => Number(r.post_id) === Number(id))));
    return out;
  };
  const mineOf = async (ids, key) => {
    const out = new Map();
    if (!ids.length) return out;
    const { rows } = await pool.query('select post_id, answer from rsvps where account_key=$1 and post_id = any($2::bigint[])', [key, ids]);
    for (const r of rows) out.set(Number(r.post_id), { answer: r.answer });
    return out;
  };
  const reportCounts = async (ids) => {
    const out = new Map();
    if (!ids.length) return out;
    const { rows } = await pool.query('select post_id, count(*)::int as n from post_reports where post_id = any($1::bigint[]) group by 1', [ids]);
    for (const r of rows) out.set(Number(r.post_id), r.n);
    return out;
  };
  // Who answered Đi, Chưa biết and Không đi (members only; names, no answers to anyone else)
  const attendees = async (id) => {
    const { rows } = await pool.query("select answer, name from rsvps where post_id=$1 and answer in ('yes','maybe','no') order by at", [id]);
    const pick = (a) => rows.filter((r) => r.answer === a).map((r) => ({ name: r.name || 'Thành viên' }));
    return { yes: pick('yes'), maybe: pick('maybe'), no: pick('no') };
  };
  const famRow = async (f) => (await pool.query('select id, slug, name from families where id=$1', [f.id])).rows[0];

  // Robots: nothing about the news is indexed or cached as public.
  app.use(['/api/posts', '/api/news-setting'], (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });

  app.get('/api/posts', H(async (req, res) => {
    const m = await member(req);
    const pos = await posters(m.f.id);
    const { rows } = await pool.query(`select ${COLS} from posts where family_id=$1 and deleted_at is null and ${visible(m)}
      order by pinned desc, created_at desc limit 300`, [m.f.id, m.me, m.isAdmin]);
    const ids = rows.map((r) => Number(r.id));
    const [s, mi, rc] = await Promise.all([sums(ids), mineOf(ids, m.me), m.isAdmin ? reportCounts(ids) : new Map()]);
    res.json({ posts: rows.map((r) => view(r, s.get(Number(r.id)), mi.get(Number(r.id)) || null, { isAdmin: m.isAdmin, me: m.me, reports: rc.get(Number(r.id)) || 0 })),
      can_post: canPost(m, pos), is_admin: m.isAdmin, posters: pos });
  }));

  app.get('/api/posts/:id', H(async (req, res) => {
    const m = await member(req);
    const p = await postRow(m.f, m, req.params.id);
    const [s, mi, rc] = await Promise.all([sums([Number(p.id)]), mineOf([Number(p.id)], m.me), reportCounts([Number(p.id)])]);
    const att = p.kind === 'gathering' ? await attendees(Number(p.id)) : { yes: [], maybe: [], no: [] };
    res.json({ post: view(p, s.get(Number(p.id)), mi.get(Number(p.id)) || null, { isAdmin: m.isAdmin, me: m.me, reports: rc.get(Number(p.id)) || 0 }),
      attendees: att, can_post: canPost(m, await posters(m.f.id)), is_admin: m.isAdmin });
  }));

  // Create. Held posts wait for an owner or admin and send no mail until approved. Owners may post links (not phone or account numbers).
  app.post('/api/posts', H(async (req, res) => {
    const m = await member(req);
    if (!canPost(m, await posters(m.f.id))) throw new HttpError(403, 'Chỉ chủ họ và quản trị được đăng tin. Có thể góp ý để được đăng.');
    const used = (await pool.query("select count(*)::int as n from posts where family_id=$1 and author_key=$2 and created_at > now() - interval '1 day'", [m.f.id, m.me])).rows[0].n;
    if (used >= RATE_PER_DAY) throw new HttpError(429, `Bạn đã đăng ${RATE_PER_DAY} tin trong 24 giờ qua. Xin đăng lại sau.`);
    const x = clean(req.body || {}, HttpError);
    const hold = CR.holdReasons(textOf(x), { allowLink: m.w.role === 'owner' });
    const status = hold.length ? 'held' : 'live';
    const name = m.w.name || m.w.email || 'thành viên';
    const { rows } = await pool.query(`insert into posts (family_id, kind, title, body, pinned, starts_at, lunar, time, place, map_url, organiser, created_by, author_key, status, hold)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [m.f.id, x.kind, x.title, x.body, x.pinned, x.starts_at, x.lunar, x.time, x.place, x.map_url, x.organiser, name, m.me, status, hold]);
    const id = Number(rows[0].id);
    // The poster is going by default (one answer, changeable like any other).
    if (x.kind === 'gathering') await pool.query("insert into rsvps (post_id, account_key, answer, at, name) values ($1,$2,'yes',now(),$3) on conflict (post_id, account_key) do nothing", [id, m.me, name]);
    const fam = await famRow(m.f);
    await hist(pool, m.f.id, status === 'held' ? 'held' : 'post', { post_id: id, kind: x.kind, title: x.title, hold }, name);
    if (status === 'held') {
      await notify(fam, { title: `Tin chờ duyệt: ${x.title}`, path: 'tin', emails: await adminEmails(m.f.id), except: m.w.email || '', mail: false }).catch(() => {});
    } else {
      await notify(fam, { title: `${x.kind === 'gathering' ? 'Họp mặt mới' : 'Thông báo mới'}: ${x.title}`,
        path: x.kind === 'gathering' ? `tin/${id}` : 'tin', except: m.w.email || '' });
    }
    res.json({ id, status, held: status === 'held', hold });
  }));

  // Edit: the author or an admin. A post with a check hit becomes held again; a held post stays held until approved.
  app.post('/api/posts/:id/update', H(async (req, res) => {
    const m = await member(req);
    const p = await postRow(m.f, m, req.params.id);
    if (p.author_key !== m.me && !m.isAdmin) throw new HttpError(403, 'Chỉ người đăng hoặc quản trị được sửa tin này.');
    const x = clean(req.body || {}, HttpError);
    const hold = CR.holdReasons(textOf(x), { allowLink: p.author_key === m.me && m.w.role === 'owner' });
    const status = p.status === 'hidden' ? 'hidden' : (hold.length || p.status === 'held' ? 'held' : 'live');
    await pool.query(`update posts set kind=$3, title=$4, body=$5, pinned=$6, starts_at=$7, lunar=$8, time=$9, place=$10,
      map_url=$11, organiser=$12, status=$13, hold=$14, updated_at=now() where id=$1 and family_id=$2`,
      [Number(p.id), m.f.id, x.kind, x.title, x.body, x.pinned, x.starts_at, x.lunar, x.time, x.place, x.map_url, x.organiser, status, hold]);
    await hist(pool, m.f.id, 'edit', { post_id: Number(p.id), status }, m.w.name || m.w.email);
    res.json({ ok: true, id: Number(p.id), status });
  }));

  // Admins only: approve a held post (it goes live and the members are told, by mail too).
  app.post('/api/posts/:id/approve', H(async (req, res) => {
    const m = await member(req);
    if (!m.isAdmin) throw new HttpError(403, 'Chỉ chủ họ hoặc quản trị được duyệt tin.');
    const p = await postRow(m.f, m, req.params.id);
    if (p.status !== 'held') throw new HttpError(409, 'Tin này không chờ duyệt.');
    await pool.query("update posts set status='live', hold='{}', updated_at=now() where id=$1", [Number(p.id)]);
    await hist(pool, m.f.id, 'approve', { post_id: Number(p.id) }, m.w.name || m.w.email);
    const fam = await famRow(m.f);
    await notify(fam, { title: `${p.kind === 'gathering' ? 'Họp mặt mới' : 'Thông báo mới'}: ${p.title}`,
      path: p.kind === 'gathering' ? `tin/${p.id}` : 'tin', except: m.w.email || '' });
    res.json({ ok: true });
  }));

  // Admins only: reject a held post (soft delete).
  app.post('/api/posts/:id/reject', H(async (req, res) => {
    const m = await member(req);
    if (!m.isAdmin) throw new HttpError(403, 'Chỉ chủ họ hoặc quản trị được từ chối tin.');
    const p = await postRow(m.f, m, req.params.id);
    if (p.status !== 'held') throw new HttpError(409, 'Tin này không chờ duyệt.');
    await pool.query('update posts set deleted_at=now() where id=$1', [Number(p.id)]);
    await hist(pool, m.f.id, 'reject', { post_id: Number(p.id) }, m.w.name || m.w.email);
    res.json({ ok: true });
  }));

  // Any member except the author: report a live post with a reason. Two reports hide it for owners and admins to review.
  app.post('/api/posts/:id/report', H(async (req, res) => {
    const m = await member(req);
    const p = await postRow(m.f, m, req.params.id);
    if (p.status !== 'live') throw new HttpError(409, 'Tin này không thể báo cáo lúc này.');
    if (p.author_key === m.me) throw new HttpError(400, 'Bạn không thể báo cáo tin của chính mình.');
    const reason = clip((req.body || {}).reason, 300);
    if (reason.length < 3) throw new HttpError(400, 'Cần ghi lý do báo cáo.');
    await pool.query('insert into post_reports (post_id, reporter_key, reason) values ($1,$2,$3) on conflict do nothing', [Number(p.id), m.me, reason]);
    const n = (await pool.query('select count(*)::int as n from post_reports where post_id=$1', [Number(p.id)])).rows[0].n;
    let hidden = false;
    if (n >= REPORTS_TO_HIDE) {
      await pool.query("update posts set status='hidden', updated_at=now() where id=$1 and status='live'", [Number(p.id)]);
      hidden = true;
      await hist(pool, m.f.id, 'hide', { post_id: Number(p.id), reports: n }, 'Báo cáo');
      await notify(await famRow(m.f), { title: `Tin bị ẩn sau báo cáo: ${p.title}`, path: 'tin', emails: await adminEmails(m.f.id), except: '', mail: false }).catch(() => {});
    } else {
      await hist(pool, m.f.id, 'report', { post_id: Number(p.id), reports: n }, 'Báo cáo');
    }
    res.json({ ok: true, hidden });
  }));

  // Admins only: restore a hidden post (its reports are cleared).
  app.post('/api/posts/:id/restore', H(async (req, res) => {
    const m = await member(req);
    if (!m.isAdmin) throw new HttpError(403, 'Chỉ chủ họ hoặc quản trị được khôi phục tin.');
    const p = await postRow(m.f, m, req.params.id);
    if (p.status !== 'hidden') throw new HttpError(409, 'Tin này không bị ẩn.');
    await pool.query("update posts set status='live', updated_at=now() where id=$1", [Number(p.id)]);
    await pool.query('delete from post_reports where post_id=$1', [Number(p.id)]);
    await hist(pool, m.f.id, 'restore', { post_id: Number(p.id) }, m.w.name || m.w.email);
    res.json({ ok: true });
  }));

  app.post('/api/posts/:id/pin', H(async (req, res) => {
    const m = await member(req);
    const p = await postRow(m.f, m, req.params.id);
    if (!m.isAdmin && p.author_key !== m.me) throw new HttpError(403, 'Chỉ người đăng hoặc quản trị được ghim tin.');
    await pool.query('update posts set pinned=$3, updated_at=now() where id=$1 and family_id=$2', [Number(p.id), m.f.id, !!(req.body || {}).pinned]);
    await hist(pool, m.f.id, 'pin', { post_id: Number(p.id), pinned: !!(req.body || {}).pinned }, m.w.name || m.w.email);
    res.json({ ok: true });
  }));

  // Soft delete: the author or an admin (a hidden post: admins only).
  app.post('/api/posts/:id/delete', H(async (req, res) => {
    const m = await member(req);
    const p = await postRow(m.f, m, req.params.id);
    if (!m.isAdmin && (p.author_key !== m.me || p.status === 'hidden')) throw new HttpError(403, 'Chỉ người đăng hoặc quản trị được xóa tin này.');
    await pool.query('update posts set deleted_at=now() where id=$1 and family_id=$2', [Number(p.id), m.f.id]);
    await hist(pool, m.f.id, 'delete', { post_id: Number(p.id), status: p.status }, m.w.name || m.w.email);
    res.json({ ok: true });
  }));

  // Owners only: who may post.
  app.post('/api/news-setting', H(async (req, res) => {
    const m = await member(req);
    if (ROLE_RANK[m.w.role] < ROLE_RANK.owner) throw new HttpError(403, 'Chỉ chủ họ đổi được cài đặt này.');
    const v = (req.body || {}).posters;
    if (!['admin', 'editor'].includes(v)) throw new HttpError(400, 'Lựa chọn không hợp lệ.');
    const old = await posters(m.f.id);
    if (old === v) return res.json({ ok: true, posters: v, changed: false });
    await pool.query('update families set news_posters=$2 where id=$1', [m.f.id, v]);
    await hist(pool, m.f.id, 'setting', { posters: v, was: old }, m.w.name || m.w.email);
    res.json({ ok: true, posters: v, changed: true });
  }));

  // RSVP: one answer per account (a second answer replaces the first). Members only; live gatherings only.
  app.post('/api/posts/:id/rsvp', H(async (req, res) => {
    const m = await member(req);
    const p = await postRow(m.f, m, req.params.id);
    if (p.kind !== 'gathering') throw new HttpError(400, 'Tin này không cần trả lời.');
    if (p.status !== 'live') throw new HttpError(409, 'Họp mặt này chưa được duyệt.');
    const answer = (req.body || {}).answer;
    if (!['yes', 'no', 'maybe'].includes(answer)) throw new HttpError(400, 'Chọn Đi, Không đi hoặc Chưa biết.');
    await pool.query(`insert into rsvps (post_id, account_key, answer, at, name) values ($1,$2,$3,now(),$4)
      on conflict (post_id, account_key) do update set answer=excluded.answer, at=now(), name=excluded.name`,
      [Number(p.id), m.me, answer, m.w.name || m.w.email || '']);
    const s = (await sums([Number(p.id)])).get(Number(p.id));
    res.json({ ok: true, rsvp: { yes: s.yes, maybe: s.maybe, no: s.no, mine: answer } });
  }));

  // Personal calendar feed and its link (news-cal.js).
  require('./news-cal').mount(app, { pool, H, HttpError, member, publicUrl: () => D.publicUrl() });
}

module.exports = { mount, sweep, clean };
