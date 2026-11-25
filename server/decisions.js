// Family decisions (biểu quyết, COUNCIL.md): remove_person only. Rules in decision-rules.js. A passed vote moves the person
// to the trash through trash.js deletePerson (relations kept); restore is by any owner or admin from Thùng rác (trash.js).
// Migration 026. Mounted from server.js after the trash.
'use strict';
const R = require('./decision-rules');
const MR = require('./merge-rules');
const MERGE = require('./merge');
const TRASH = require('./trash');
const { SYSTEM_MEMBER_SQL } = require('./system-accounts');

let D = null; // { pool, publicUrl, mail, T, onWrite }
const ts = (x) => (x == null ? null : Number(x));
const msOf = (d) => (d ? new Date(d).getTime() : null);
const QUICK_WHY = { 'not-mine': 'Chỉ người tạo hồ sơ mới dùng được cách này.', 'too-old': 'Chỉ dùng được trong 24 giờ sau khi tạo hồ sơ.', 'has-links': 'Hồ sơ đã có quan hệ, sự kiện hoặc câu chuyện: hãy đề nghị gỡ.' };

async function hist(q, personId, action, detail, by) {
  await q.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'hoi_dong',$2,$3,$4)",
    [personId, action === 'restore' ? null : JSON.stringify({ action, ...detail }), action === 'restore' ? JSON.stringify({ action, ...detail }) : null, by]);
}

// In-app notice and mail to every active member (followers are covered by the trash notices).
async function notifyMembers(fam, { exceptEmail = null, title, paras = [] }) {
  const { rows } = await D.pool.query(`select email from members where family_id=$1 and status='active' and email is not null and not ${SYSTEM_MEMBER_SQL}`, [fam.id]); // system accounts (.invalid) are not people: no notice, no mail
  const url = `${D.publicUrl()}/#/${fam.slug}/bieu-quyet`;
  const to = [...new Set(rows.map((r) => String(r.email).toLowerCase()))].filter((e) => e && e !== String(exceptEmail || '').toLowerCase());
  for (const email of to) {
    await D.pool.query('insert into notices (email, family_id, kind, body) values ($1,$2,$3,$4)', [email, fam.id, 'decision', title]);
    const m = D.T.trashNotice({ family: fam.name, title, paras, url });
    await D.mail.send(D.pool, { familyId: fam.id, kind: 'decision', to: email, subject: m.subject, html: m.html, text: m.text }).catch(() => {});
  }
  return to.length;
}

// Owners whose "đã mất" handover is open are recorded (a completed handover demotes them to admin).
async function deceasedSet(q, famId) {
  if ((await q.query("select 1 from handover_requests where family_id=$1 and kind='deceased' and status='open' limit 1", [famId])).rowCount) {
    const o = (await q.query("select email from members where family_id=$1 and role='owner' and status='active' order by id limit 1", [famId])).rows[0];
    if (o?.email) await q.query('insert into council_deceased (family_id, email) values ($1,$2) on conflict do nothing', [famId, o.email]);
  }
  return new Set((await q.query('select email from council_deceased where family_id=$1', [famId])).rows.map((r) => r.email));
}
// The electorate now: owners and admins, or (solo) every editor-or-above.
// The electorate for a family under its vote rule (a family setting; a new decision copies it, see openDecision).
// Fewer than two voters under the rule: the solo case (editors and above; a NO from one of them stops it).
async function electorate(q, famId, nowMs, rule = null) {
  const key = rule || (await q.query('select vote_rule from families where id=$1', [famId])).rows[0]?.vote_rule || R.DEFAULT_VOTE_RULE;
  const rows = (await q.query(`select email, role, status, extract(epoch from last_seen_at) * 1000 as ls,
      extract(epoch from coalesce(approved_at, created_at)) * 1000 as base, extract(epoch from coalesce(approved_at, created_at)) * 1000 as tn
    from members where family_id=$1 and not ${SYSTEM_MEMBER_SQL}`, [famId])).rows; // system accounts (.invalid) never vote
  const members = rows.map((m) => ({ email: m.email, role: m.role, status: m.status, lastSeenMs: ts(m.ls), baselineMs: ts(m.base), tenureMs: ts(m.tn) }));
  const dead = await deceasedSet(q, famId);
  const set = R.voterSet({ members, rule: key, deceased: dead, nowMs });
  if (set.voters.length > 1) return { voters: set.voters, solo: false, rule: set.rule };
  return { voters: R.soloElectorate(members, dead, nowMs), solo: true, rule: set.rule };
}
const ballotsOf = async (q, id) => (await q.query(`select b.voter_key as email, b.choice, b.reason, m.name from decision_votes b
  left join members m on m.email = b.voter_key where b.decision_id=$1 order by b.at`, [id])).rows;

// The view of one decision for a viewer. While it is OPEN, nobody sees who chose what, the reasons or the counts: only
// participation (who has voted, who has not) and the viewer's own choice. When it is CLOSED the full result is shown:
// the four-part bar with the threshold, the choices with their reasons (open ballot after close).
async function viewOf(q, d, me, nowMs = Date.now()) {
  const bs = await ballotsOf(q, d.id);
  const voters = d.voters || [];
  const t = R.tally({ voters, ballots: bs, requester: d.opened_by });
  const name = (await q.query("select data->>'name' as name from persons where id=$1", [d.subject_ref])).rows[0]?.name || d.subject_ref;
  const mine = bs.find((b) => R.norm(b.email) === R.norm(me));
  const mem = new Map((await q.query('select email, name, role from members where family_id=$1 and email is not null', [d.family_id])).rows
    .map((m) => [R.norm(m.email), m]));
  const who = (email) => { const m = mem.get(R.norm(email)); return { name: m?.name || email, role: m?.role || 'member' }; };
  const byChoice = new Map(bs.map((b) => [R.norm(b.email), b]));
  const voted = voters.filter((e) => byChoice.has(R.norm(e)));
  const base = {
    id: Number(d.id), kind: d.kind, label: d.kind === 'merge_person' ? MR.MERGE_LABEL : R.RULE.label, state: d.state, subject_ref: d.subject_ref, subject_name: name,
    keep: d.kind === 'merge_person' ? { id: d.payload?.keep || null, name: (await q.query("select data->>'name' as name from persons where id=$1", [d.payload?.keep || ''])).rows[0]?.name || d.payload?.keep || null, choices: d.payload?.choices || {} } : null,
    reason: d.body, opened_by: d.opened_by, opened_at: d.opened_at, closes_at: d.closes_at, decided_at: d.decided_at,
    days_left: d.state === 'open' ? Math.ceil(Math.max(0, msOf(d.closes_at) - nowMs) / R.DAY) : 0,
    voters: voters.length, voted: voted.length, solo: !!d.solo, need: '2/3',
    mine: mine ? mine.choice : null, is_voter: voters.includes(R.norm(me)), ballot: R.BALLOT[d.kind] || 'open',
  };
  if (d.state === 'open') {
    const row = (email) => who(email);
    return {
      ...base, state_visible: 'open', result: null,
      bar: R.participationParts({ n: voters.length, voted: voted.length }),
      groups: { voted: voted.map(row), pending: voters.filter((e) => !byChoice.has(R.norm(e))).map(row) },
    };
  }
  const row = (email) => ({ ...who(email), reason: byChoice.get(R.norm(email))?.reason || null });
  return {
    ...base, state_visible: 'closed', yes: t.yes, yes_others: t.yesOthers, no: t.no, abstain: t.abstain,
    bar: R.barParts({ n: voters.length, yes: t.yes, no: t.no, abstain: t.abstain }),
    groups: {
      yes: voters.filter((e) => byChoice.get(R.norm(e))?.choice === 'yes').map(row),
      no: voters.filter((e) => byChoice.get(R.norm(e))?.choice === 'no').map(row),
      abstain: voters.filter((e) => byChoice.get(R.norm(e))?.choice === 'abstain').map(row),
      pending: voters.filter((e) => !byChoice.has(R.norm(e))).map(row),
    },
    result: d.result || null,
  };
}

// Closes every open vote that is due. A pass moves the person to the trash.
async function settle(famId = null, nowMs = Date.now()) {
  const { rows } = await D.pool.query(`select id from decisions where state='open' and ($1::text is null or family_id=$1)
    and (closes_at <= to_timestamp($2 / 1000.0) or (all_voted_at is not null and all_voted_at + interval '${R.GRACE_MS / 1000} seconds' <= to_timestamp($2 / 1000.0)))
    order by id`, [famId, nowMs]);
  const out = [];
  for (const r of rows) {
    const c = await D.pool.connect();
    try {
      await c.query('begin');
      const d = (await c.query('select * from decisions where id=$1 for update', [r.id])).rows[0];
      if (d.state !== 'open') { await c.query('commit'); continue; }
      const t = R.tally({ voters: d.voters || [], ballots: await ballotsOf(c, d.id), requester: d.opened_by });
      const passed = d.solo ? R.passesSolo(t) : R.passes(t);
      // closes at the window end, or the grace after everyone has voted, whichever is first
      const closesMs = d.all_voted_at ? Math.min(msOf(d.closes_at), msOf(d.all_voted_at) + R.GRACE_MS) : msOf(d.closes_at);
      let st = R.decisionStatus({ state: d.state, closesMs, nowMs, passed });
      const fam = (await c.query('select id, slug, name from families where id=$1', [d.family_id])).rows[0];
      const pr = (await c.query('select id, data, deleted from persons where id=$1 and family_id=$2 for update', [d.subject_ref, d.family_id])).rows[0];
      const result = { yes: t.yes, no: t.no, n: t.n, note: null };
      if (st === 'passed' && d.kind === 'merge_person') {
        await c.query('savepoint vote');
        try {
          const m = await MERGE.apply(c, fam, { keepId: d.payload?.keep, dropId: d.subject_ref, choices: d.payload?.choices || {}, by: 'Biểu quyết', w: { email: d.opened_by }, reason: d.body, decisionId: d.id });
          await c.query('release savepoint vote');
          result.trash_id = m.trash_id; result.note = 'Hai hồ sơ đã được gộp. Hồ sơ bị gộp nằm trong Thùng rác, có thể khôi phục.';
        } catch (e) {
          await c.query('rollback to savepoint vote');
          if (e.name !== 'MergeError') throw e;
          st = 'failed'; result.note = `Không gộp được: ${e.message}`;
        }
      } else if (st === 'passed' && d.kind === 'remove_person' && pr && !pr.deleted) {
        const trashId = await TRASH.deletePerson(c, fam, pr.id, { w: { email: d.opened_by }, by: 'Biểu quyết', reason: d.body });
        await c.query("update trash set payload = coalesce(payload, '{}'::jsonb) || $2::jsonb where id=$1", [trashId, JSON.stringify({ council: Number(d.id) })]);
        result.trash_id = Number(trashId); result.note = 'Người này đã được chuyển vào Thùng rác.';
      }
      await c.query('update decisions set state=$2, decided_at=now(), result=$3 where id=$1', [d.id, st, JSON.stringify(result)]);
      await hist(c, d.subject_ref, st, { kind: d.kind, decision_id: Number(d.id) }, 'Biểu quyết');
      await c.query('commit');
      const name = pr?.data?.name || d.subject_ref;
      await notifyMembers(fam, { title: `${d.kind === 'merge_person' ? 'Gộp' : 'Gỡ'} ${name}: ${st === 'passed' ? 'đã được thông qua' : 'không đạt'}`,
        paras: [`Biểu quyết: ${t.yes} đồng ý, ${t.no} không đồng ý.`, result.note || 'Không đủ số phiếu khi hết thời hạn.'] });
      out.push({ id: Number(d.id), state: st });
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  }
  return out;
}
async function sweep(nowMs = Date.now()) { return settle(null, nowMs); }

function mount(app, d) {
  D = d;
  const { pool, who, famOf, H, HttpError, ROLE_RANK, actorName } = d;
  const role = async (req, min) => {
    const f = await famOf(req); const w = await who(req, f.id);
    if (ROLE_RANK[w.role] >= ROLE_RANK[min]) return { f, w };
    throw new HttpError(w.email || w.code ? 403 : 401, w.email || w.code ? 'Tài khoản này chưa có quyền cho việc này.' : 'Cần đăng nhập.');
  };
  const personRow = async (q, f, id, lock = false) => {
    const p = (await q.query(`select id, data, deleted from persons where id=$1 and family_id=$2${lock ? ' for update' : ''}`, [id, f.id])).rows[0];
    if (!p || p.deleted) throw new HttpError(404, 'Không tìm thấy người này.');
    return p;
  };
  const decisionRow = async (q, f, id, lock = false) => {
    const x = (await q.query(`select * from decisions where id=$1 and family_id=$2${lock ? ' for update' : ''}`, [Number(id) || 0, f.id])).rows[0];
    if (!x) throw new HttpError(404, 'Không tìm thấy biểu quyết này.');
    return x;
  };
  const famRow = async (f) => (await d.pool.query('select id, slug, name from families where id=$1', [f.id])).rows[0];
  // The person's creation: their first app history row.
  const createdOf = async (pid) => (await pool.query("select extract(epoch from min(at)) * 1000 as ms, (array_agg(by_user order by at))[1] as first_by from history where person_id=$1 and source='app'", [pid])).rows[0] || null;

  // The family's vote rule (Cài đặt dòng họ › Biểu quyết). Members read it; only the owner changes it (family_history + notice).
  app.get('/api/council-setting', H(async (req, res) => {
    const { f } = await role(req, 'member');
    res.json({ vote_rule: (await pool.query('select vote_rule from families where id=$1', [f.id])).rows[0]?.vote_rule || R.DEFAULT_VOTE_RULE });
  }));
  app.post('/api/council-setting', H(async (req, res) => {
    const { f, w } = await role(req, 'owner');
    const rule = String(req.body?.rule || '');
    if (!R.VOTE_RULES[rule]) throw new HttpError(400, 'Lựa chọn không hợp lệ.');
    const old = (await pool.query('select vote_rule from families where id=$1', [f.id])).rows[0]?.vote_rule || R.DEFAULT_VOTE_RULE;
    if (old === rule) return res.json({ ok: true, vote_rule: rule, changed: false });
    const actor = actorName(w);
    await pool.query('update families set vote_rule=$2 where id=$1', [f.id, rule]);
    await pool.query('insert into family_history (family_id, field, old_value, new_value, by_user) values ($1,$2,$3,$4,$5)',
      [f.id, 'vote_rule', old, rule, actor]);
    await notifyMembers(await famRow(f), { exceptEmail: w.email, title: `Đổi người được biểu quyết: ${R.VOTE_RULES[rule].label}`,
      paras: [`${actor} đã đổi. Đề nghị đang mở giữ nguyên người được biểu quyết lúc mở.`] });
    res.json({ ok: true, vote_rule: rule, changed: true });
  }));

  app.get('/api/decisions', H(async (req, res) => {
    const { f, w } = await role(req, 'member');
    await settle(f.id).catch(() => {});
    const { rows } = await pool.query('select * from decisions where family_id=$1 order by (state=\'open\') desc, opened_at desc limit 200', [f.id]);
    const now = Date.now();
    res.json({ decisions: await Promise.all(rows.map((x) => viewOf(pool, x, w.email, now))), can_open: ROLE_RANK[w.role] >= ROLE_RANK.editor });
  }));
  app.get('/api/decisions/:id', H(async (req, res) => {
    const { f, w } = await role(req, 'member');
    await settle(f.id).catch(() => {});
    res.json({ decision: await viewOf(pool, await decisionRow(pool, f, req.params.id), w.email) });
  }));

  // The chooser: the two options and why each is on or off.
  app.get('/api/persons/:id/removal', H(async (req, res) => {
    const { f, w } = await role(req, 'editor');
    const p = await personRow(pool, f, req.params.id);
    const im = await TRASH.impact(pool, f.id, p.id);
    const c = await createdOf(p.id);
    const quick = R.quickDeleteOk({ creator: c?.first_by, me: w.email || w.name, createdMs: ts(c?.ms), nowMs: Date.now(), relations: im.relations, events: im.events, stories: im.stories, descendants: im.descendants });
    const open = (await pool.query("select * from decisions where kind='remove_person' and subject_ref=$1 and state='open'", [p.id])).rows[0];
    const el = await electorate(pool, f.id, Date.now());
    res.json({ name: p.data?.name || p.id, quick, impact: im, voters: el.voters.length, solo: el.solo,
      decision: open ? await viewOf(pool, open, w.email) : null });
  }));

  // POST /api/persons/:id/removal { kind: 'quick' | 'vote', reason }
  app.post('/api/persons/:id/removal', H(async (req, res) => {
    const kind = String(req.body?.kind || '');
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    const actor = (w) => actorName(w);
    if (kind === 'quick') {
      const { f, w } = await role(req, 'editor');
      const r = await (async () => {
        const c = await pool.connect();
        try {
          await c.query('begin');
          const p = await personRow(c, f, req.params.id, true);
          const im = await TRASH.impact(c, f.id, p.id);
          const cr = await createdOf(p.id);
          const q = R.quickDeleteOk({ creator: cr?.first_by, me: w.email || w.name, createdMs: ts(cr?.ms), nowMs: Date.now(), relations: im.relations, events: im.events, stories: im.stories, descendants: im.descendants });
          if (!q.ok) throw new HttpError(409, QUICK_WHY[q.why]);
          const id = await TRASH.deletePerson(c, await famRow(f), p.id, { w, by: actor(w), reason: 'Nhập nhầm' });
          await c.query('commit');
          return { id, name: p.data?.name || p.id };
        } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
      })();
      d.onWrite?.();
      return res.json({ ok: true, trash_id: Number(r.id), name: r.name });
    }
    if (kind === 'vote') {
      const { f, w } = await role(req, 'editor');
      if (reason.length < 3) throw new HttpError(400, 'Cần ghi lý do đề nghị gỡ.');
      const p = await personRow(pool, f, req.params.id);
      if ((await pool.query("select 1 from decisions where kind='remove_person' and subject_ref=$1 and state='open'", [p.id])).rowCount) throw new HttpError(409, 'Đã có đề nghị gỡ người này đang biểu quyết.');
      const im = await TRASH.impact(pool, f.id, p.id);
      const c = await pool.connect();
      let x;
      try {
        await c.query('begin');
        const el = await electorate(c, f.id, Date.now());
        if (!el.voters.length) throw new HttpError(409, 'Chưa có Chủ họ hoặc Quản trị đang hoạt động để biểu quyết.');
        const { rows } = await c.query(`insert into decisions (family_id, kind, subject_ref, title, body, voters, solo, vote_rule, opened_by, closes_at)
          values ($1,'remove_person',$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' days')::interval) returning *`,
        [f.id, p.id, p.data?.name || p.id, reason, JSON.stringify(el.voters), el.solo, el.rule, w.email || w.name, String(R.RULE.windowDays)]);
        x = rows[0];
        if (!el.solo && el.voters.includes(R.norm(w.email))) await c.query("insert into decision_votes (decision_id, voter_key, choice) values ($1,$2,'yes')", [x.id, R.norm(w.email)]);
        await hist(c, p.id, 'request', { kind: 'remove_person', decision_id: Number(x.id), reason, impact: im }, actor(w));
        await c.query('commit');
      } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
      await notifyMembers(await famRow(f), { exceptEmail: w.email, title: `${actor(w)} đề nghị gỡ ${p.data?.name || p.id} khỏi gia phả`,
        paras: [`Lý do: ${reason}`, `Biểu quyết trong ${R.RULE.windowDays} ngày. Cần 2/3 Chủ họ và Quản trị đồng ý, ít nhất 2 phiếu khác ngoài người đề nghị.`] });
      return res.json({ ok: true, decision: await viewOf(pool, x, w.email) });
    }
    throw new HttpError(400, 'Lựa chọn không hợp lệ.');
  }));

  // Merge of two duplicates in this tree (merge.js). preview: both people, the default field choices, the guard result.
  app.get('/api/merge/preview', H(async (req, res) => {
    const { f, w } = await role(req, 'editor');
    try {
      const pv = await MERGE.preview(pool, f.id, String(req.query.keep || ''), String(req.query.drop || ''), {});
      const el = await electorate(pool, f.id, Date.now());
      const side = (p) => ({ id: p.id, name: p.data?.name || p.id, data: p.data || {} });
      res.json({ keep: side(pv.keep), drop: side(pv.drop), defaults: MR.defaultChoices(pv.keep.data, pv.drop.data), voters: el.voters.length, solo: el.solo,
        days: R.RULE.windowDays, can_propose: !!el.voters.length, who: w.role });
    } catch (e) { if (e.name === 'MergeError') throw new HttpError(e.status, e.message); throw e; }
  }));

  // POST /api/merge/propose { keep, drop, choices, reason }: opens a family vote (kind merge_person). Nothing moves until it passes.
  app.post('/api/merge/propose', H(async (req, res) => {
    const { f, w } = await role(req, 'editor');
    const keep = String(req.body?.keep || ''); const drop = String(req.body?.drop || '');
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    const choices = req.body?.choices && typeof req.body.choices === 'object' ? req.body.choices : {};
    if (reason.length < 3) throw new HttpError(400, 'Cần ghi lý do gộp.');
    const c = await pool.connect();
    let x;
    try {
      await c.query('begin');
      let pv;
      try { pv = await MERGE.preview(c, f.id, keep, drop, choices); } catch (e) { if (e.name === 'MergeError') throw new HttpError(e.status, e.message); throw e; }
      if ((await c.query(`select 1 from decisions where state='open' and ((kind='remove_person' and subject_ref = any($1::text[]))
          or (kind='merge_person' and (subject_ref = any($1::text[]) or payload->>'keep' = any($1::text[]))))`, [[keep, drop]])).rowCount) {
        throw new HttpError(409, 'Đã có biểu quyết đang mở cho một trong hai người.');
      }
      const el = await electorate(c, f.id, Date.now());
      if (!el.voters.length) throw new HttpError(409, 'Chưa có Chủ họ hoặc Quản trị đang hoạt động để biểu quyết.');
      const resolved = { ...MR.defaultChoices(pv.keep.data, pv.drop.data), ...choices };
      const actor = actorName(w);
      const { rows } = await c.query(`insert into decisions (family_id, kind, subject_ref, title, body, voters, solo, vote_rule, opened_by, closes_at, payload)
        values ($1,'merge_person',$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' days')::interval, $10) returning *`,
      [f.id, drop, pv.drop.data?.name || drop, reason, JSON.stringify(el.voters), el.solo, el.rule, w.email || w.name, String(R.RULE.windowDays),
        JSON.stringify({ keep, keep_name: pv.keep.data?.name || keep, choices: resolved })]);
      x = rows[0];
      if (!el.solo && el.voters.includes(R.norm(w.email))) await c.query("insert into decision_votes (decision_id, voter_key, choice) values ($1,$2,'yes')", [x.id, R.norm(w.email)]);
      await hist(c, drop, 'request', { kind: 'merge_person', decision_id: Number(x.id), into: keep, reason }, actor);
      await c.query('commit');
      await notifyMembers(await famRow(f), { exceptEmail: w.email, title: `${actor} đề nghị gộp ${pv.drop.data?.name || drop} vào ${pv.keep.data?.name || keep}`,
        paras: [`Lý do: ${reason}`, `Biểu quyết trong ${R.RULE.windowDays} ngày. Cần 2/3 người có quyền biểu quyết đồng ý, ít nhất 2 phiếu khác ngoài người đề nghị.`] });
      res.json({ ok: true, decision: await viewOf(pool, x, w.email) });
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  }));

  // POST /api/decisions/:id/ballot { choice: 'yes' | 'no', reason }: voters only, while open. A no needs a reason.
  app.post('/api/decisions/:id/ballot', H(async (req, res) => {
    const { f, w } = await role(req, 'member');
    const choice = String(req.body?.choice || '');
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!R.CHOICES.includes(choice)) throw new HttpError(400, 'Chọn Đồng ý, Không đồng ý hoặc Không ý kiến.');
    if (choice === 'no' && reason.length < 3) throw new HttpError(400, 'Không đồng ý cần ghi lý do.');
    const c = await pool.connect();
    let x;
    try {
      await c.query('begin');
      x = (await c.query('select * from decisions where id=$1 and family_id=$2 for update', [Number(req.params.id) || 0, f.id])).rows[0];
      if (!x) throw new HttpError(404, 'Không tìm thấy biểu quyết này.');
      if (x.state !== 'open') throw new HttpError(409, 'Biểu quyết này đã kết thúc.');
      if (!(x.voters || []).includes(R.norm(w.email))) throw new HttpError(403, 'Chỉ thành viên được biểu quyết mới bỏ phiếu được.');
      await c.query('insert into decision_votes (decision_id, voter_key, choice, reason) values ($1,$2,$3,$4) on conflict (decision_id, voter_key) do update set choice=$3, reason=$4, at=now()',
        [x.id, R.norm(w.email), choice, choice === 'no' ? reason : null]);
      // everyone has voted: the grace starts (or restarts) at this last vote
      const left = await c.query('select count(*)::int n from unnest($2::text[]) v where not exists (select 1 from decision_votes b where b.decision_id=$1 and b.voter_key=v)', [x.id, x.voters || []]);
      if (left.rows[0].n === 0) await c.query('update decisions set all_voted_at=now() where id=$1', [x.id]);
      await c.query('commit');
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
    res.json({ ok: true, decision: await viewOf(pool, x, w.email) });
  }));
}

// For the trash page and the banner: open votes (the trash card links to the Biểu quyết page).
module.exports = { mount, sweep, settle, electorate, viewOf };
