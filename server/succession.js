// The succession engine: trusted contacts, inactivity reminders, handover notice and offers, death reports, member
// claims, and the 90-day reclaim. Every step is written to handover_steps (history). Mail goes out after the change
// is saved; a notice or offer that could not be sent is retried by the daily run (sendOnce skips what was sent).
// Pure rules: succession-rules.js. Clock: every function takes `now` (epoch ms), so tests can run the timers.
'use strict';
const R = require('./succession-rules');
const { isSystemAccount, SYSTEM_MEMBER_SQL } = require('./system-accounts');
const { Refuse } = R;
const mail = require('./mail');
const T = require('./mail-templates');

// Hash links: a family page is '#/<slug>/<page>'; a token page (offer, trusted invite) is '#<page>/<token>' with no
// slash, so the app does not read the page name as a family.
const link = (hashPath) => `${mail.publicUrl()}/#${hashPath}`;
const famPath = (slug, page = 'cai-dat-dong-ho') => link(`/${slug}/${page}`);
const ts = (ms) => (ms == null ? null : new Date(ms));
const ms = (d) => (d == null ? null : new Date(d).getTime());

// Runs fn in one transaction on a pooled client.
async function tx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}

// ---- reads ----
async function famRow(db, famId) {
  return (await db.query('select id, slug, name, owner_inactive_months from families where id=$1', [famId])).rows[0] || null;
}
async function ownerOf(db, famId) {
  return (await db.query("select id, email, name, role, last_seen_at, approved_at, created_at from members where family_id=$1 and role='owner' and status='active' order by id limit 1", [famId])).rows[0] || null;
}
// Owner baseline for the inactivity clock: last sign-in, else the moment the owner became one.
const baselineOf = (o) => ms(o.last_seen_at) ?? ms(o.approved_at) ?? ms(o.created_at);
// Open handover (one at a time per family) with its current stage.
async function openHandover(db, famId) {
  return (await db.query(`select r.*, (select s.stage from handover_steps s where s.request_id = r.id order by s.at desc, s.id desc limit 1) as stage
    from handover_requests r where r.family_id=$1 and r.status='open' order by r.id desc limit 1`, [famId])).rows[0] || null;
}
async function lastHandover(db, famId) {
  return (await db.query(`select r.*, (select s.stage from handover_steps s where s.request_id = r.id order by s.at desc, s.id desc limit 1) as stage
    from handover_requests r where r.family_id=$1 order by r.id desc limit 1`, [famId])).rows[0] || null;
}
async function loadOpen(db) {
  return (await db.query(`select r.*, (select s.stage from handover_steps s where s.request_id = r.id order by s.at desc, s.id desc limit 1) as stage
    from handover_requests r where r.status='open' order by r.id`)).rows;
}
async function chainFor(db, famId, ownerEmail) {
  const contacts = (await db.query("select email, name, priority from trusted_contacts where family_id=$1 and status='accepted'", [famId])).rows;
  const members = (await db.query(`select email, name, role, extract(epoch from coalesce(approved_at, created_at)) * 1000 as tenure
    from members where family_id=$1 and status='active' and role in ('admin','editor') and email is not null and not ${SYSTEM_MEMBER_SQL}`, [famId])).rows
    .map((m) => ({ email: m.email, name: m.name, role: m.role, tenureMs: Number(m.tenure) }));
  return R.buildChain({ contacts, members, ownerEmail });
}
async function addStep(db, reqId, stage, { actor = null, note = null, data = {}, now }) {
  await db.query('insert into handover_steps (request_id, at, stage, actor, note, data) values ($1,$2,$3,$4,$5,$6)',
    [reqId, ts(now), stage, actor, note, JSON.stringify(data)]);
}
async function stageOf(db, reqId) {
  return (await db.query('select stage from handover_steps where request_id=$1 order by at desc, id desc limit 1', [reqId])).rows[0]?.stage || null;
}

// ---- starting and moving a handover ----
async function startHandover(db, fam, { kind, actor = null, evidence = null, claimant = null, now }) {
  const stage = kind === 'deceased' ? 'reported' : kind === 'claim' ? 'backing' : 'notice';
  const deadline = kind === 'deceased' ? null : kind === 'claim' ? R.claimEnd(now) : R.noticeEnd(now);
  const { rows } = await db.query(`insert into handover_requests (family_id, kind, started_at, deadline_at, status, claimant_email, evidence, backers)
    values ($1,$2,$3,$4,'open',$5,$6,'[]') returning id`, [fam.id, kind, ts(now), ts(deadline), claimant, evidence]);
  await addStep(db, rows[0].id, stage, { actor, now, note: kind, data: { kind } });
  return { id: rows[0].id, stage, deadline };
}
// Stops every open handover because the owner signed in (or a sign-in refused it). Idempotent.
async function cancelOpen(db, famId, actor, now) {
  const { rows } = await db.query(`update handover_requests set status='cancelled', resolved_at=$2, resolved_by=$3
    where family_id=$1 and status='open' returning id`, [famId, ts(now), actor]);
  for (const r of rows) {
    await addStep(db, r.id, 'cancelled', { actor, now, note: 'owner-signed-in' });
    await db.query("update handover_offers set status='cancelled', resolved_at=$2 where request_id=$1 and status in ('waiting','offered')", [r.id, ts(now)]);
  }
  return rows.length;
}

// Notice to the owner (inactive or deceased confirmed). Sent once per request.
async function noticeMail(db, fam, req, reason) {
  const owner = await ownerOf(db, fam.id);
  if (!owner?.email) return { status: 'no-owner' };
  return mail.sendOnce(db, `notice:${req.id}`, async () => ({
    familyId: fam.id, kind: 'handover_notice', to: owner.email,
    ...T.handoverNotice({ family: fam.name, deadline: req.deadline_at, url: famPath(fam.slug), reason }),
  }));
}
async function startInactive(db, fam, now) {
  const h = await startHandover(db, fam, { kind: 'inactive', actor: 'system', now });
  await noticeMail(db, fam, { id: h.id, deadline_at: h.deadline }, 'inactive');
  return h.id;
}
async function reportDeceased(db, fam, { email, evidence, photo, now }) {
  if (await openHandover(db, fam.id)) throw new Refuse(409, 'Dòng họ đang có một việc chuyển quyền. Chờ việc đó xong trước.');
  const note = [evidence, photo].filter(Boolean).join('\n').slice(0, 1500) || null;
  const h = await startHandover(db, fam, { kind: 'deceased', actor: email, evidence: note, now });
  const confirmers = await confirmersOf(db, fam.id);
  for (const c of confirmers) {
    await mail.sendOnce(db, `confirm:${h.id}:${c.email}`, async () => ({
      familyId: fam.id, kind: 'handover_confirm', to: c.email, ...T.confirmRequest({ family: fam.name, url: famPath(fam.slug) }),
    }));
  }
  return h.id;
}
// Who may confirm a death report: one accepted trusted contact; with none, an active admin (not the owner).
async function confirmersOf(db, famId) {
  const contacts = (await db.query("select email, name from trusted_contacts where family_id=$1 and status='accepted'", [famId])).rows;
  const real = contacts.filter((c) => !isSystemAccount({ emails: [c.email] }));
  if (real.length) return real;
  const admins = (await db.query(`select email, name from members where family_id=$1 and status='active' and role='admin' and email is not null and not ${SYSTEM_MEMBER_SQL}`, [famId])).rows;
  return admins.filter((a) => !isSystemAccount({ emails: [a.email] }));
}
async function canConfirm(db, famId, email) {
  if (!email) return false;
  return (await confirmersOf(db, famId)).some((c) => c.email === R.norm(email));
}
async function confirmDeceased(db, req, email, now) {
  const fam = await famRow(db, req.family_id);
  if (req.status !== 'open' || req.stage !== 'reported') throw new Refuse(409, 'Báo cáo này không còn chờ xác nhận.');
  if (!(await canConfirm(db, req.family_id, email))) throw new Refuse(403, 'Chỉ Người được ủy thác đã chấp nhận (hoặc Quản trị, nếu chưa có) mới xác nhận được.');
  const deadline = R.noticeEnd(now);
  await tx(db, async (c) => {
    await c.query('update handover_requests set deadline_at=$2 where id=$1', [req.id, ts(deadline)]);
    await addStep(c, req.id, 'notice', { actor: R.norm(email), now, note: 'confirmed', data: {} });
  });
  await noticeMail(db, fam, { id: req.id, deadline_at: ts(deadline) }, 'deceased');
  return { deadline };
}

// Offers: the chain is written once, when the notice ends. Each offer is open for 14 days; then the next one.
async function beginOffers(db, fam, req, now) {
  const owner = await ownerOf(db, fam.id);
  const chain = await chainFor(db, fam.id, owner?.email);
  await tx(db, async (c) => {
    for (const [i, x] of chain.entries()) {
      await c.query("insert into handover_offers (request_id, position, email, source) values ($1,$2,$3,$4)", [req.id, i + 1, x.email, x.source]);
    }
    if (!chain.length) {
      await c.query("update handover_requests set status='blocked', resolved_at=$2, resolved_by='system' where id=$1", [req.id, ts(now)]);
      await addStep(c, req.id, 'exhausted', { actor: 'system', now, note: 'no-candidates' });
    } else {
      await addStep(c, req.id, 'offer', { actor: 'system', now, note: `${chain.length} candidates` });
    }
  });
  if (chain.length) await offerNext(db, fam, req.id, now);
  return chain.length;
}
// The next waiting candidate gets an offer. None left: the handover is blocked (members may then start a claim).
async function offerNext(db, fam, reqId, now) {
  const { rows } = await db.query("select id from handover_offers where request_id=$1 and status='waiting' order by position limit 1", [reqId]);
  if (!rows.length) {
    await tx(db, async (c) => {
      await c.query("update handover_requests set status='blocked', resolved_at=$2, resolved_by='system' where id=$1 and status='open'", [reqId, ts(now)]);
      await addStep(c, reqId, 'exhausted', { actor: 'system', now, note: 'chain-ended' });
    });
    return null;
  }
  await db.query("update handover_offers set status='offered', offered_at=$2, expires_at=$3 where id=$1", [rows[0].id, ts(now), ts(R.offerEnd(now))]);
  await offerMail(db, fam, rows[0].id);
  return rows[0].id;
}
// Sends the offer link. The token is made fresh for each attempt that is actually sent (only the hash is stored).
async function offerMail(db, fam, offerId) {
  const o = (await db.query('select id, email, expires_at from handover_offers where id=$1', [offerId])).rows[0];
  if (!o || !o.expires_at) return;
  await mail.sendOnce(db, `offer:${offerId}`, async () => {
    const token = R.makeToken();
    await db.query('update handover_offers set token_hash=$2 where id=$1', [offerId, R.hashToken(token)]);
    return { familyId: fam.id, kind: 'handover_offer', to: o.email, ...T.handoverOffer({ family: fam.name, expiresAt: o.expires_at, url: link('offer/' + token) }) };
  });
}
// Expires offers past their 14 days and moves on to the next candidate.
async function expireOffers(db, fam, reqId, now) {
  const { rows } = await db.query("select id from handover_offers where request_id=$1 and status='offered' and expires_at <= $2", [reqId, ts(now)]);
  let n = 0;
  for (const r of rows) {
    await db.query("update handover_offers set status='expired', resolved_at=$2 where id=$1", [r.id, ts(now)]);
    n++;
  }
  if (n) await offerNext(db, fam, reqId, now);
  return n;
}

// The offer behind a link token: open, not expired. An expired one moves on (and the caller learns it).
async function offerByToken(db, token, now) {
  const { rows } = await db.query(`select o.*, r.family_id, r.status as req_status, r.id as req_id from handover_offers o
    join handover_requests r on r.id = o.request_id where o.token_hash=$1`, [R.hashToken(token)]);
  const o = rows[0];
  if (!o || o.status !== 'offered') return null;
  if (ms(o.expires_at) <= now) return { ...o, expired: true };
  return o;
}
// Email code for an offer: one per minute; the code is stored bound to the token hash, valid 15 minutes.
async function sendOfferCode(db, token, now) {
  const o = await offerByToken(db, token, now);
  if (!o || o.expired || o.req_status !== 'open') throw new Refuse(410, 'Lời mời này không còn hiệu lực.');
  const lastSent = o.code_expires_at ? ms(o.code_expires_at) - 15 * 60e3 : null;
  if (!R.canSendCode(now, lastSent)) throw new Refuse(429, 'Vừa gửi mã. Đợi một phút rồi thử lại.');
  const code = R.makeCode();
  // code_attempts is not reset: wrong codes count for the whole offer, so a new code does not give new tries.
  await db.query('update handover_offers set code_hash=$2, code_expires_at=$3 where id=$1', [o.id, R.hashCode(code, o.token_hash), ts(R.codeExpiry(now))]);
  const fam = await famRow(db, o.family_id);
  const sent = await mail.send(db, { familyId: fam.id, kind: 'handover_code', to: o.email, ...T.handoverCode({ family: fam.name, code }) });
  return { email: maskEmail(o.email), sent: sent.status };
}
const maskEmail = (e) => { const [a, d] = String(e).split('@'); return `${a.slice(0, 1)}${'•'.repeat(Math.max(2, a.length - 2))}${a.slice(-1)}@${d}`; };

// Accepts an offer: the candidate becomes the owner, the previous owner becomes an admin. Needs the code.
async function acceptOffer(db, token, code, now) {
  const o = await offerByToken(db, token, now);
  if (!o || o.req_status !== 'open') throw new Refuse(410, 'Lời mời này không còn hiệu lực.');
  if (o.expired) { await expireOffers(db, await famRow(db, o.family_id), o.req_id, now); throw new Refuse(410, 'Lời mời này đã hết hạn.'); }
  const closed = 'Nhập sai quá nhiều lần. Lời mời này đã đóng và chuyển sang người tiếp theo.';
  if (o.code_attempts >= R.RULES.CODE_TRIES) throw new Refuse(429, closed);
  if (!o.code_expires_at || ms(o.code_expires_at) <= now) throw new Refuse(400, 'Chưa có mã hoặc mã đã hết hạn. Hãy xin mã mới.');
  if (!R.codeMatches(code, o.token_hash, o.code_hash)) {
    const tries = o.code_attempts + 1;
    await db.query('update handover_offers set code_attempts = $2 where id=$1', [o.id, tries]);
    if (tries >= R.RULES.CODE_TRIES) {
      // The last wrong code closes the offer: the next candidate gets it (so guessing cannot go on for 14 days).
      await db.query("update handover_offers set status='expired', resolved_at=$2 where id=$1", [o.id, ts(now)]);
      await offerNext(db, await famRow(db, o.family_id), o.request_id, now);
      throw new Refuse(429, closed);
    }
    throw new Refuse(400, 'Mã không đúng.');
  }
  return transfer(db, o.request_id, { email: o.email, offerId: o.id }, now);
}
async function declineOffer(db, token, now) {
  const o = await offerByToken(db, token, now);
  if (!o || o.req_status !== 'open') throw new Refuse(410, 'Lời mời này không còn hiệu lực.');
  await db.query("update handover_offers set status='declined', resolved_at=$2 where id=$1", [o.id, ts(now)]);
  const fam = await famRow(db, o.family_id);
  await offerNext(db, fam, o.request_id, now);
  return { ok: true };
}

// Moves the owner role to `newEmail` (an accepted offer or a claim that reached its backers). Writes history, then mails.
async function transfer(db, reqId, { email, offerId = null, claimant = false }, now) {
  const info = await tx(db, async (c) => {
    const req = (await c.query("select * from handover_requests where id=$1 for update", [reqId])).rows[0];
    if (!req || req.status !== 'open') throw new Refuse(409, 'Việc chuyển quyền này đã kết thúc.');
    const fam = await famRow(c, req.family_id);
    const prev = await ownerOf(c, fam.id);
    const newEmail = R.norm(email);
    const cand = (await c.query('select name from members where family_id=$1 and email=$2', [fam.id, newEmail])).rows[0]
      || (await c.query("select name from trusted_contacts where family_id=$1 and email=$2 and status='accepted'", [fam.id, newEmail])).rows[0];
    await c.query(`insert into members (email, name, role, status, approved_by, approved_at, family_id)
      values ($1, $2, 'owner', 'active', 'chuyển quyền', $3, $4)
      on conflict (family_id, email) do update set role='owner', status='active', approved_by='chuyển quyền', approved_at=$3`,
    [newEmail, cand?.name || newEmail, ts(now), fam.id]);
    if (prev && R.norm(prev.email) !== newEmail) await c.query("update members set role='admin' where id=$1", [prev.id]);
    if (offerId) await c.query("update handover_offers set status='accepted', resolved_at=$2 where id=$1", [offerId, ts(now)]);
    await c.query("update handover_offers set status='cancelled', resolved_at=$2 where request_id=$1 and status in ('waiting','offered')", [reqId, ts(now)]);
    await c.query("update handover_requests set status='completed', resolved_at=$2, resolved_by=$3 where id=$1", [reqId, ts(now), newEmail]);
    await addStep(c, reqId, 'completed', { actor: newEmail, now, note: claimant ? 'claim' : 'offer', data: { from: prev?.email || null, to: newEmail, reclaimUntil: R.reclaimUntil(now) } });
    return { fam, from: prev, to: { email: newEmail, name: cand?.name || newEmail }, reclaimUntil: R.reclaimUntil(now) };
  });
  await mail.sendOnce(db, `done:${reqId}:new`, async () => ({ familyId: info.fam.id, kind: 'owner_changed', to: info.to.email,
    ...T.ownerChanged({ family: info.fam.name, role: 'new', url: famPath(info.fam.slug) }) }));
  if (info.from && R.norm(info.from.email) !== info.to.email) {
    await mail.sendOnce(db, `done:${reqId}:prev`, async () => ({ familyId: info.fam.id, kind: 'owner_changed', to: info.from.email,
      ...T.ownerChanged({ family: info.fam.name, role: 'prev', name: info.to.name, reclaimUntil: info.reclaimUntil, url: famPath(info.fam.slug) }) }));
  }
  return { ok: true, owner: info.to.email, reclaimUntil: info.reclaimUntil };
}

// ---- member claim (no contacts, admins or editors to hand over to) ----
async function startClaim(db, fam, email, now) {
  if (await openHandover(db, fam.id)) throw new Refuse(409, 'Dòng họ đang có một việc chuyển quyền.');
  const owner = await ownerOf(db, fam.id);
  const chain = await chainFor(db, fam.id, owner?.email);
  const last = await lastHandover(db, fam.id);
  if (!R.claimAllowed({ openHandover: null, chainCount: chain.length, lastBlocked: last?.status === 'blocked' })) {
    throw new Refuse(409, 'Dòng họ vẫn còn người được trao quyền. Việc nhận quyền chỉ mở khi không còn ai trong danh sách.');
  }
  const h = await startHandover(db, fam, { kind: 'claim', actor: R.norm(email), claimant: R.norm(email), now });
  if (owner?.email) await mail.sendOnce(db, `claim:${h.id}`, async () => ({ familyId: fam.id, kind: 'claim_started', to: owner.email,
    ...T.claimStarted({ family: fam.name, claimant: email, deadline: h.deadline, url: famPath(fam.slug) }) }));
  return h.id;
}
// A member backs the claim. When enough other active members have backed it, the claimant becomes the owner.
async function backClaim(db, req, email, now) {
  const who = R.norm(email);
  const r = await tx(db, async (c) => {
    const row = (await c.query("select * from handover_requests where id=$1 for update", [req.id])).rows[0];
    if (!row || row.status !== 'open' || row.kind !== 'claim') throw new Refuse(409, 'Việc nhận quyền này đã kết thúc.');
    if ((await stageOf(c, row.id)) !== 'backing') throw new Refuse(409, 'Việc nhận quyền này không còn nhận thêm người ủng hộ.');
    const member = (await c.query("select role from members where family_id=$1 and email=$2 and status='active'", [row.family_id, who])).rows[0];
    if (!member || member.role === 'owner') throw new Refuse(403, 'Chỉ thành viên đang hoạt động (không phải Chủ họ) mới ủng hộ được.');
    if (who === row.claimant_email) throw new Refuse(409, 'Bạn là người xin nhận quyền.');
    const backers = Array.isArray(row.backers) ? row.backers : [];
    if (backers.some((b) => b.email === who)) return { already: true, count: backers.length, reached: false };
    // Others = active members who are not the owner and not the claimant.
    const others = Number((await c.query(`select count(*)::int n from members where family_id=$1 and status='active' and role <> 'owner' and email <> $2 and not ${SYSTEM_MEMBER_SQL}`,
      [row.family_id, row.claimant_email])).rows[0].n);
    const next = [...backers, { email: who, at: new Date(now).toISOString() }];
    await c.query('update handover_requests set backers=$2 where id=$1', [row.id, JSON.stringify(next)]);
    await addStep(c, row.id, 'backing', { actor: who, now, note: `${next.length} ủng hộ`, data: { of: others } });
    return { already: false, count: next.length, reached: R.backingReached(next, others), others };
  });
  if (r.reached && !r.already) await openObjection(db, req, now);
  return { ok: true, backers: r.count, objection: !!r.reached, needed: R.requiredBackers(r.others ?? 0) };
}

// Enough backers: the claim waits 30 days. The owner can refuse by signing in (cancels), any member can object
// (blocks; admins are told). Nothing objected and nobody refused: the transfer happens when the window ends.
async function openObjection(db, req, now) {
  const fam = await famRow(db, req.family_id);
  const until = R.claimEnd(now);
  await tx(db, async (c) => {
    await c.query('update handover_requests set deadline_at=$2 where id=$1', [req.id, ts(until)]);
    await addStep(c, req.id, 'objection', { actor: 'system', now, note: 'backers-reached', data: { until } });
  });
  const owner = await ownerOf(db, fam.id);
  const recipients = (await db.query("select email from members where family_id=$1 and status='active' and email is not null and role <> 'owner' and email <> $2",
    [fam.id, req.claimant_email])).rows.map((m) => m.email);
  if (owner?.email) recipients.push(owner.email);
  for (const to of [...new Set(recipients)]) {
    await mail.sendOnce(db, `claimwin:${req.id}:${to}`, async () => ({ familyId: fam.id, kind: 'claim_window', to,
      ...T.claimWindow({ family: fam.name, claimant: req.claimant_email, deadline: until, url: famPath(fam.slug) }) }));
  }
}
// A member objects during the window: the claim stops (blocked), and the admins are told.
async function objectClaim(db, req, email, now) {
  const who = R.norm(email);
  await tx(db, async (c) => {
    const row = (await c.query('select * from handover_requests where id=$1 for update', [req.id])).rows[0];
    if (!row || row.status !== 'open' || row.kind !== 'claim') throw new Refuse(409, 'Việc nhận quyền này đã kết thúc.');
    if ((await stageOf(c, row.id)) !== 'objection') throw new Refuse(409, 'Việc nhận quyền này không ở giai đoạn phản đối.');
    const member = (await c.query("select role from members where family_id=$1 and email=$2 and status='active'", [row.family_id, who])).rows[0];
    if (!member || member.role === 'owner') throw new Refuse(403, 'Chỉ thành viên đang hoạt động (không phải Chủ họ) mới phản đối được.');
    if (who === row.claimant_email) throw new Refuse(409, 'Bạn là người xin nhận quyền.');
    await c.query("update handover_requests set status='blocked', resolved_at=$2, resolved_by=$3 where id=$1", [row.id, ts(now), who]);
    await addStep(c, row.id, 'objected', { actor: who, now, note: 'member-objection', data: {} });
  });
  const fam = await famRow(db, req.family_id);
  const admins = (await db.query(`select email from members where family_id=$1 and status='active' and role='admin' and email is not null and not ${SYSTEM_MEMBER_SQL}`, [fam.id])).rows;
  for (const a of admins) {
    await mail.sendOnce(db, `objected:${req.id}:${a.email}`, async () => ({ familyId: fam.id, kind: 'claim_objected', to: a.email,
      ...T.claimObjected({ family: fam.name, url: famPath(fam.slug) }) }));
  }
  return { ok: true };
}

// ---- reclaim: the previous owner takes the role back within 90 days ----
// The last completed handover of the family, and whether `email` may reclaim it now: { ok, until, reason, last, owner }.
async function reclaimState(db, fam, email, now) {
  const last = (await db.query("select * from handover_requests where family_id=$1 and status='completed' order by resolved_at desc limit 1", [fam.id])).rows[0];
  const owner = await ownerOf(db, fam.id);
  if (!last) return { ok: false, reason: 'no-handover', owner };
  const done = (await db.query("select data from handover_steps where request_id=$1 and stage='completed' order by id desc limit 1", [last.id])).rows[0];
  const reclaimed = (await db.query("select 1 from handover_steps where request_id=$1 and stage='reclaimed' limit 1", [last.id])).rowCount > 0;
  const check = R.reclaimCheck({ now, resolvedAt: ms(last.resolved_at), from: done?.data?.from, requester: email, currentOwner: owner?.email, alreadyReclaimed: reclaimed });
  return { ...check, last, owner };
}
async function reclaim(db, fam, email, now) {
  const st = await reclaimState(db, fam, email, now);
  if (!st.ok) {
    if (st.reason === 'no-handover') throw new Refuse(403, 'Không có quyền Chủ họ nào để lấy lại.');
    throw new Refuse(st.reason === 'expired' ? 410 : 403, st.reason === 'expired' ? 'Đã quá 90 ngày để lấy lại quyền.' : 'Bạn không được lấy lại quyền Chủ họ.');
  }
  const { last, owner, until } = st;
  const who = R.norm(email);
  await tx(db, async (c) => {
    if (owner) await c.query("update members set role='admin' where id=$1", [owner.id]);
    await c.query(`insert into members (email, name, role, status, approved_by, approved_at, family_id)
      values ($1, $1, 'owner', 'active', 'lấy lại quyền', $2, $3)
      on conflict (family_id, email) do update set role='owner', status='active', approved_by='lấy lại quyền', approved_at=$2`, [who, ts(now), fam.id]);
    await addStep(c, last.id, 'reclaimed', { actor: who, now, note: 'reclaim', data: { from: owner?.email || null, to: who } });
  });
  if (owner?.email && R.norm(owner.email) !== who) await mail.sendOnce(db, `reclaim:${last.id}:${R.norm(owner.email)}`, async () => ({
    familyId: fam.id, kind: 'owner_changed', to: owner.email, ...T.ownerChanged({ family: fam.name, role: 'prev', name: who, reclaimUntil: until, url: famPath(fam.slug) }) }));
  return { ok: true };
}

// ---- trusted contacts (owner invites up to 3; the contact accepts with a Google account of that email) ----
async function listContacts(db, famId) {
  return (await db.query("select id, email, name, status, priority, created_at, accepted_at from trusted_contacts where family_id=$1 and status <> 'removed' order by priority nulls last, id", [famId])).rows;
}
async function inviteContact(db, fam, { email, name, inviter, now }) {
  const e = R.norm(email);
  if (!mail.EMAIL_RE.test(e || '')) throw new Refuse(400, 'Email không hợp lệ.');
  const owner = await ownerOf(db, fam.id);
  if (owner && R.norm(owner.email) === e) throw new Refuse(409, 'Chủ họ không thể tự làm Người được ủy thác.');
  const all = await listContacts(db, fam.id);
  if (all.some((c) => c.email === e)) throw new Refuse(409, 'Email này đã có trong danh sách.');
  if (all.length >= R.RULES.MAX_CONTACTS) throw new Refuse(409, `Tối đa ${R.RULES.MAX_CONTACTS} người được ủy thác.`);
  const token = R.makeToken();
  const prio = all.reduce((m, c) => Math.max(m, c.priority || 0), 0) + 1;
  const { rows } = await db.query(`insert into trusted_contacts (family_id, email, name, status, token_hash, created_at, priority)
    values ($1,$2,$3,'invited',$4,$5,$6) returning id`, [fam.id, e, String(name || '').trim().slice(0, 80) || null, R.hashToken(token), ts(now), prio]);
  await sendInvite(db, fam, { id: rows[0].id, email: e, name, inviter, token });
  return rows[0].id;
}
async function sendInvite(db, fam, { email, name, inviter, token }) {
  return mail.send(db, { familyId: fam.id, kind: 'trusted_invite', to: email,
    ...T.trustedInvite({ family: fam.name, inviter, name, url: link('trusted/' + token), days: R.RULES.INVITE_DAYS }) });
}
// A new invite link for a contact who has not accepted yet (the old link stops working).
async function resendInvite(db, fam, { id, inviter, now }) {
  const c = (await db.query("select * from trusted_contacts where id=$1 and family_id=$2 and status='invited'", [id, fam.id])).rows[0];
  if (!c) throw new Refuse(404, 'Không tìm thấy người này, hoặc người này đã chấp nhận.');
  const token = R.makeToken();
  await db.query('update trusted_contacts set token_hash=$2, created_at=$3 where id=$1', [id, R.hashToken(token), ts(now)]);
  return sendInvite(db, fam, { email: c.email, name: c.name, inviter, token });
}
async function removeContact(db, fam, id) {
  const { rowCount } = await db.query("update trusted_contacts set status='removed', token_hash=null, priority=null where id=$1 and family_id=$2 and status <> 'removed'", [id, fam.id]);
  if (!rowCount) throw new Refuse(404, 'Không tìm thấy người này.');
}
// ids: every listed contact, in the new order.
async function reorderContacts(db, fam, ids) {
  const cur = (await listContacts(db, fam.id)).map((c) => c.id);
  const want = (ids || []).map(Number);
  if (want.length !== cur.length || !cur.every((x) => want.includes(x))) throw new Refuse(400, 'Danh sách sắp xếp không khớp.');
  await tx(db, async (c) => { for (const [i, id] of want.entries()) await c.query('update trusted_contacts set priority=$2 where id=$1 and family_id=$3', [id, i + 1, fam.id]); });
}
// The invite as the accept page shows it (no email, no token).
async function contactInvite(db, token, now) {
  const { rows } = await db.query(`select c.id, c.email, c.name, c.status, c.created_at, f.name as family, f.slug from trusted_contacts c join families f on f.id = c.family_id
    where c.token_hash=$1`, [R.hashToken(token)]);
  const c = rows[0];
  if (!c) return null;
  return { family: c.family, slug: c.slug, name: c.name, status: c.status, expired: c.status === 'invited' && R.inviteEnd(ms(c.created_at)) < now, email: maskEmail(c.email) };
}
async function acceptContact(db, token, email, now) {
  const c = (await db.query('select * from trusted_contacts where token_hash=$1', [R.hashToken(token)])).rows[0];
  if (!c) throw new Refuse(404, 'Lời mời không còn hiệu lực.');
  if (R.norm(email) !== c.email) throw new Refuse(403, 'Đăng nhập bằng Google với đúng địa chỉ email đã được mời.');
  if (c.status === 'accepted') return { ok: true, already: true };
  if (c.status !== 'invited') throw new Refuse(410, 'Lời mời này không còn hiệu lực.');
  if (R.inviteEnd(ms(c.created_at)) < now) throw new Refuse(410, 'Lời mời đã hết hạn. Nhờ Chủ họ gửi lại.');
  await db.query("update trusted_contacts set status='accepted', accepted_at=$2 where id=$1", [c.id, ts(now)]);
  return { ok: true };
}

// ---- owner settings ----
async function setInactiveMonths(db, fam, months) {
  if (!R.RULES.INACTIVE_MONTHS.includes(Number(months))) throw new Refuse(400, 'Chọn 3, 6, 12 hoặc 18 tháng.');
  await db.query('update families set owner_inactive_months=$2, updated_at=now() where id=$1', [fam.id, Number(months)]);
}

// A request by id, with its current stage (null when it does not exist).
async function requestById(db, id) {
  return (await db.query(`select r.*, (select s.stage from handover_steps s where s.request_id = r.id order by s.at desc, s.id desc limit 1) as stage
    from handover_requests r where r.id=$1`, [id])).rows[0] || null;
}

// ---- the daily run ----
// The daily run at most once a day: the last run is kept in job_runs, so a restart does not run it twice. Returns the stats, or null.
async function runDailyIfDue(pool, now = Date.now(), job = 'succession') {
  await pool.query("insert into job_runs (name, last_run_at) values ($1, 'epoch') on conflict (name) do nothing", [job]);
  const claimed = await pool.query('update job_runs set last_run_at=$2 where name=$1 and last_run_at < $3 returning name',
    [job, ts(now), ts(now - 20 * 3600e3)]);
  if (!claimed.rowCount) return null;
  const stats = await runEngine(pool, now);
  await pool.query('update job_runs set last_result=$2 where name=$1', [job, JSON.stringify(stats)]);
  return stats;
}

// Reminders (1 month, 1 week, 1 day before the notice), notice -> offers, offer expiry, claim expiry, and a retry of
// every notice or offer mail that is not sent yet. Safe to run again: each step checks the state first.
// only: optional list of family ids (tests use it to leave other families alone).
async function runEngine(pool, now = Date.now(), { only = null } = {}) {
  const stats = { reminders: 0, notices: 0, offers: 0, expired: 0, claims: 0, retried: 0 };
  const fams = (await pool.query('select id, slug, name, owner_inactive_months from families where $1::text[] is null or id = any($1)', [only])).rows;
  for (const fam of fams) {
    const owner = await ownerOf(pool, fam.id);
    if (!owner?.email) continue;
    const open = await openHandover(pool, fam.id);
    if (open) continue;
    const baseline = baselineOf(owner);
    if (baseline == null) continue;
    const months = fam.owner_inactive_months;
    const stage = R.dueStages(now, baseline, months).pop();
    if (stage && !R.isInactive(now, baseline, months)) {
      const r = await mail.sendOnce(pool, `rem:${fam.id}:${baseline}:${stage}`, async () => ({
        familyId: fam.id, kind: 'owner_reminder', to: owner.email,
        ...T.ownerReminder({ family: fam.name, stage, months, url: famPath(fam.slug, 'cai-dat-dong-ho') }) }));
      if (r.status === 'sent') stats.reminders++;
    }
    if (R.isInactive(now, baseline, months)) {
      const started = (await pool.query('select 1 from handover_requests where family_id=$1 and started_at > $2 limit 1', [fam.id, ts(baseline)])).rowCount;
      if (!started) { await startInactive(pool, fam, now); stats.notices++; }
    }
  }
  for (const req of await loadOpen(pool)) {
    if (only && !only.includes(req.family_id)) continue;
    const fam = await famRow(pool, req.family_id);
    if (!fam) continue;
    if (req.stage === 'notice' && req.deadline_at && ms(req.deadline_at) <= now) { await beginOffers(pool, fam, req, now); stats.offers++; continue; }
    if (req.stage === 'offer') stats.expired += await expireOffers(pool, fam, req.id, now);
    if (req.stage === 'objection' && req.deadline_at && ms(req.deadline_at) <= now) {
      await transfer(pool, req.id, { email: req.claimant_email, claimant: true }, now);
      stats.claims++;
      continue;
    }
    if (req.stage === 'backing' && req.deadline_at && ms(req.deadline_at) <= now) {
      await tx(pool, async (c) => {
        await c.query("update handover_requests set status='blocked', resolved_at=$2, resolved_by='system' where id=$1 and status='open'", [req.id, ts(now)]);
        await addStep(c, req.id, 'expired', { actor: 'system', now, note: 'claim-window' });
      });
      stats.claims++;
      continue;
    }
    // Retry: a notice or offer that was not sent yet (no key, or a failed send) goes out on this run.
    if (req.stage === 'notice') {
      const r = await noticeMail(pool, fam, req, req.kind === 'deceased' ? 'deceased' : 'inactive');
      if (r.status === 'sent') stats.retried++;
    }
    if (req.stage === 'offer') {
      const offered = (await pool.query("select id from handover_offers where request_id=$1 and status='offered'", [req.id])).rows;
      for (const o of offered) await offerMail(pool, fam, o.id);
    }
  }
  return stats;
}

module.exports = {
  tx, famRow, ownerOf, openHandover, lastHandover, loadOpen, requestById, reclaimState, chainFor, baselineOf, stageOf, listContacts,
  startInactive, reportDeceased, confirmDeceased, canConfirm, confirmersOf, beginOffers, offerNext, expireOffers, offerByToken,
  sendOfferCode, acceptOffer, declineOffer, transfer, startClaim, backClaim, objectClaim, reclaim, cancelOpen,
  inviteContact, resendInvite, removeContact, reorderContacts, contactInvite, acceptContact, setInactiveMonths, runEngine, runDailyIfDue, maskEmail,
};
