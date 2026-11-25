// Thùng rác API (server/trash.js): restore round-trips (event, relation, person with the relations it had), person delete
// rules (reason, impact, no cascade, second owner/admin, 24 h delay in a one-admin family, cancel / reject), roles, the
// sweep (dry run by default, then archive and purge), "Xóa vĩnh viễn ngay" (owner + typed name), the hourly brake
// (refused, audited, owner told), notices to followers, history rows. Needs a SCRATCH database (GP_TEST_DATABASE_URL).
'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `trash-${TAG}`; const SOLO = `trsolo-${TAG}`;
const OWNER = `owner.${TAG}@example.test`; const ADMIN = `admin.${TAG}@example.test`; const EDITOR = `editor.${TAG}@example.test`;
const MEMBER = `member.${TAG}@example.test`; const BRAKER = `braker.${TAG}@example.test`; const FOLLOW = `follow.${TAG}@example.test`;
const SOLO_OWNER = `solo.${TAG}@example.test`;
const P = (x) => `T${TAG}${x}`;
let base, pool, close, TRASH; const ck = {};
const op = () => `op-${TAG}-${crypto.randomBytes(4).toString('hex')}`;

async function call(method, p, body, who) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(who ? { cookie: ck[who] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; for (;;) { if (await fn()) return true; if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 50)); } };
const deleted = async (id) => (await pool.query('select deleted from persons where id=$1', [id])).rows[0].deleted;
const trashRow = async (id) => (await pool.query('select * from trash where id=$1', [id])).rows[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server');
  pool = p; TRASH = require('../trash');
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  for (const f of [FAM, SOLO]) await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,$2,'public')", [f, 'Thử ' + f]);
  const people = [[P('a'), FAM, 'Ông Tổ'], [P('b'), FAM, 'Con Trưởng'], [P('c'), FAM, 'Vợ Con Trưởng'], [P('d'), FAM, 'Người Lẻ'], [P('e'), FAM, 'Người Có Sự Kiện'],
    [P('f'), FAM, 'Người Thứ Sáu'], [P('x'), SOLO, 'Cha Một Mình'], [P('y'), SOLO, 'Con Một Mình']];
  for (const [id, fam, name] of people) await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, fam, { name, gen: 2 }, 'test']);
  await pool.query(`update persons set data = data || '{"living":"living"}'::jsonb where id = any($1)`, [[P('e'), P('f')]]); // living people; P('d') stays undated, living unknown
  for (const f of [FAM, SOLO]) await pool.query("insert into relation_migrations (family_id, migrated_by) values ($1,'test')", [f]);
  await pool.query("insert into parent_child (family_id, parent_id, child_id) values ($1,$2,$3)", [FAM, P('a'), P('b')]);
  await pool.query("insert into couple (family_id, a_id, b_id) values ($1,$2,$3)", [FAM, P('b'), P('c')]);
  await pool.query("insert into parent_child (family_id, parent_id, child_id) values ($1,$2,$3)", [SOLO, P('x'), P('y')]);
  const mem = [[OWNER, FAM, 'owner'], [ADMIN, FAM, 'admin'], [EDITOR, FAM, 'editor'], [MEMBER, FAM, 'member'], [BRAKER, FAM, 'editor'], [SOLO_OWNER, SOLO, 'owner']];
  for (const [e, f, r] of mem) await pool.query("insert into members (email, name, family_id, role, status) values ($1,$2,$3,$4,'active')", [e, e.split('@')[0], f, r]);
  await pool.query("insert into user_prefs (email, prefs) values ($1, $2)", [FOLLOW, { follows: [P('d')] }]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  for (const e of [OWNER, ADMIN, EDITOR, MEMBER, BRAKER, SOLO_OWNER]) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, name: e.split('@')[0] }) });
    ck[e] = r.headers.get('set-cookie').split(';')[0];
  }
});
test.after(async () => {
  if (skip || !pool) return;
  const ids = [...'abcdefxy'].map(P);
  for (const f of [FAM, SOLO]) {
    for (const t of ['trash', 'trash_audit', 'notices', 'events', 'stories', 'parent_child', 'couple', 'members', 'relation_migrations', 'mail_log']) await pool.query(`delete from ${t} where family_id=$1`, [f]).catch(() => {});
  }
  await pool.query('delete from notices where email=$1', [FOLLOW]).catch(() => {});
  await pool.query('delete from user_prefs where email=$1', [FOLLOW]).catch(() => {});
  await pool.query('delete from history where person_id = any($1)', [ids]).catch(() => {});
  await pool.query('delete from ops where person_id = any($1)', [ids]).catch(() => {});
  await pool.query('delete from persons where id = any($1)', [ids]).catch(() => {});
  await pool.query('delete from families where id = any($1)', [[FAM, SOLO]]).catch(() => {});
  await close?.(); await pool.end().catch(() => {});
});

test('event: delete goes to the trash, a member cannot restore, an editor can; history records both', { skip }, async () => {
  const add = await call('POST', `/api/events?family=${FAM}`, { op_id: op(), person_id: P('e'), event: { type: 'hoc', date_kind: 'exact', date_from: '1950', date_text: '1950', place: 'Quy Nhơn', sources: [], people: [] } }, OWNER);
  assert.equal(add.status, 200, JSON.stringify(add.json));
  const id = add.json.event.id;
  const del = await call('POST', `/api/events/${id}/delete?family=${FAM}`, { op_id: op() }, OWNER);
  assert.equal(del.status, 200); assert.ok(del.json.trash_id);
  assert.equal((await pool.query('select count(*)::int n from events where id=$1', [id])).rows[0].n, 0);
  const list = await call('GET', `/api/trash?family=${FAM}`, undefined, EDITOR);
  assert.ok(list.json.items.some((t) => t.id === del.json.trash_id && t.kind === 'event' && t.days_left === TRASH.TRASH_DAYS));
  assert.equal((await call('POST', `/api/trash/${del.json.trash_id}/restore?family=${FAM}`, {}, MEMBER)).status, 403);
  assert.equal((await call('POST', `/api/trash/${del.json.trash_id}/restore?family=${FAM}`, {}, EDITOR)).status, 200);
  assert.equal((await pool.query('select count(*)::int n from events where id=$1', [id])).rows[0].n, 1, 'the same event is back');
  assert.equal((await trashRow(del.json.trash_id)).state, 'restored');
  assert.equal((await call('POST', `/api/trash/${del.json.trash_id}/restore?family=${FAM}`, {}, EDITOR)).status, 409, 'not twice');
  const h = (await pool.query("select new_value, old_value from history where person_id=$1 and field='thung_rac' order by at", [P('e')])).rows;
  assert.deepEqual(h.map((r) => (r.old_value || r.new_value).action), ['delete', 'restore']);
});

test('relation: a removed couple comes back with its id', { skip }, async () => {
  const c = (await pool.query('select id from couple where family_id=$1', [FAM])).rows[0];
  const rm = await call('POST', '/api/relations', { family: FAM, op_id: op(), action: 'remove', kind: 'couple', id: c.id, person_id: P('b') }, EDITOR);
  assert.equal(rm.status, 200, JSON.stringify(rm.json)); assert.ok(rm.json.trash_id);
  assert.equal((await pool.query('select count(*)::int n from couple where id=$1', [c.id])).rows[0].n, 0);
  assert.equal((await call('POST', `/api/trash/${rm.json.trash_id}/restore?family=${FAM}`, {}, EDITOR)).status, 200);
  assert.equal((await pool.query('select count(*)::int n from couple where id=$1', [c.id])).rows[0].n, 1);
});

// Gỡ người by family vote (COUNCIL.md): the one-person delete endpoint is refused; the trash engine still removes a
// person with what it had, and restore brings the relations back. The vote itself is in council.test.js.
async function deleteDirect(pid, famId, by = EDITOR) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const id = await TRASH.deletePerson(c, { id: famId, slug: famId, name: famId }, pid, { w: { email: by }, by, reason: 'Thử' });
    await c.query('commit');
    return id;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}
test('person: the one-person delete endpoint is refused; the engine removes a person with relations; restore brings them back', { skip }, async () => {
  assert.equal((await call('POST', `/api/persons/${P('d')}/delete?family=${FAM}`, { reason: 'x' }, EDITOR)).status, 409, 'replaced by the family vote');
  assert.equal(await deleted(P('d')), false);
  const id = await deleteDirect(P('a'), FAM);
  assert.equal(await deleted(P('a')), true);
  const r = await call('POST', `/api/trash/${id}/restore?family=${FAM}`, {}, EDITOR);
  assert.equal(r.status, 200);
  assert.equal(await deleted(P('a')), false);
});

test('sweep: dry run by default, then archive after the trash window; a living person is purged from the archive after a year; purge now = owner + typed name', { skip }, async () => {
  const del = { json: { trash_id: await deleteDirect(P('f'), FAM) } };
  await pool.query(`update trash set deleted_at = now() - interval '${TRASH.TRASH_DAYS + 1} days' where id=$1`, [del.json.trash_id]);
  const lines = []; const dry = await TRASH.sweep({ log: (l) => lines.push(l) });
  assert.equal(dry.applied, false); assert.ok(dry.archive >= 1); assert.match(lines[0], /dry run/);
  assert.equal((await trashRow(del.json.trash_id)).state, 'trash', 'dry run changes nothing');
  await TRASH.sweep({ apply: true, log: () => {} });
  assert.equal((await trashRow(del.json.trash_id)).state, 'archive');
  assert.equal((await call('POST', `/api/trash/${del.json.trash_id}/restore?family=${FAM}`, {}, EDITOR)).status, 403, 'archive: owner/admin only');
  await pool.query(`update trash set archived_at = now() - interval '${TRASH.ARCHIVE_LIVING_DAYS + 1} days' where id=$1`, [del.json.trash_id]);
  await TRASH.sweep({ apply: true, log: () => {} });
  const t = await trashRow(del.json.trash_id); assert.equal(t.state, 'purged'); assert.equal(t.payload, null);
  // purge now
  const ev = await call('POST', `/api/events?family=${FAM}`, { op_id: op(), person_id: P('e'), event: { type: 'hoc', date_kind: 'exact', date_from: '1960', date_text: '1960', sources: [], people: [] } }, OWNER);
  const d2 = await call('POST', `/api/events/${ev.json.event.id}/delete?family=${FAM}`, { op_id: op() }, OWNER);
  const label = (await trashRow(d2.json.trash_id)).label;
  assert.equal((await call('POST', `/api/trash/${d2.json.trash_id}/purge?family=${FAM}`, { confirm: label }, ADMIN)).status, 403, 'owner only');
  assert.equal((await call('POST', `/api/trash/${d2.json.trash_id}/purge?family=${FAM}`, { confirm: 'sai' }, OWNER)).status, 400, 'typed name');
  assert.equal((await call('POST', `/api/trash/${d2.json.trash_id}/purge?family=${FAM}`, { confirm: label.toUpperCase() }, OWNER)).status, 200);
  assert.equal((await trashRow(d2.json.trash_id)).state, 'purged');
  assert.ok((await pool.query("select count(*)::int n from trash_audit where family_id=$1 and action='purge'", [FAM])).rows[0].n >= 1);
});

test('brake: over the hourly limit a delete is refused, audited and the owner told', { skip }, async () => {
  const prev = process.env.GP_DELETE_LIMIT_HOUR; process.env.GP_DELETE_LIMIT_HOUR = '3';
  try {
    for (let i = 0; i < 3; i++) {
      const ev = await call('POST', `/api/events?family=${FAM}`, { op_id: op(), person_id: P('e'), event: { type: 'hoc', date_kind: 'exact', date_from: String(1970 + i), date_text: String(1970 + i), sources: [], people: [] } }, BRAKER);
      assert.equal((await call('POST', `/api/events/${ev.json.event.id}/delete?family=${FAM}`, { op_id: op() }, BRAKER)).status, 200);
    }
    const ev = await call('POST', `/api/events?family=${FAM}`, { op_id: op(), person_id: P('e'), event: { type: 'hoc', date_kind: 'exact', date_from: '1980', date_text: '1980', sources: [], people: [] } }, BRAKER);
    const r = await call('POST', `/api/events/${ev.json.event.id}/delete?family=${FAM}`, { op_id: op() }, BRAKER);
    assert.equal(r.status, 429); assert.match(r.json.error, /tạm dừng/);
    assert.equal((await pool.query('select count(*)::int n from events where id=$1', [ev.json.event.id])).rows[0].n, 1, 'not deleted');
    assert.equal((await pool.query("select count(*)::int n from trash_audit where family_id=$1 and action='brake' and actor_key=$2", [FAM, BRAKER])).rows[0].n, 1);
    assert.equal((await pool.query("select count(*)::int n from notices where email=$1 and kind='brake'", [OWNER])).rows[0].n, 1);
    assert.equal((await pool.query("select count(*)::int n from mail_log where kind='trash_brake' and to_email=$1", [OWNER])).rows[0].n, 1);
    assert.equal((await call('POST', `/api/events/${ev.json.event.id}/delete?family=${FAM}`, { op_id: op() }, EDITOR)).status, 200, 'other accounts are not braked');
  } finally { if (prev === undefined) delete process.env.GP_DELETE_LIMIT_HOUR; else process.env.GP_DELETE_LIMIT_HOUR = prev; }
});

test('archive: a living person item is warned 30 and 7 days before its purge; the purge needs GP_TRASH_PURGE=1; historical data stays', { skip }, async () => {
  const L = TRASH.ARCHIVE_LIVING_DAYS;
  const mk = async (who, person, date) => {
    const add = await call('POST', `/api/events?family=${FAM}`, { op_id: op(), person_id: person, event: { type: 'hoc', date_kind: 'exact', date_from: date, date_text: date, sources: [], people: [] } }, OWNER);
    const del = await call('POST', `/api/events/${add.json.event.id}/delete?family=${FAM}`, { op_id: op() }, who);
    assert.equal(del.status, 200, JSON.stringify(del.json)); return del.json.trash_id;
  };
  const a = await mk(OWNER, P('e'), '2201');   // living, deleted by the owner: the owner and the admin are told
  const b = await mk(EDITOR, P('e'), '2202');  // living, deleted by an editor: the owner, the admin and the editor are told
  const c = await mk(OWNER, P('c'), '2203');   // deceased (below): never warned, never purged
  await pool.query(`update persons set data = data || '{"died":"1990"}'::jsonb where id=$1`, [P('c')]);
  const archive = (id, days) => pool.query(`update trash set state='archive', archived_by='test', archived_at = now() - interval '${days} days' where id=$1`, [id]);
  await archive(a, L - 30); await archive(b, L - 7); await archive(c, 400);
  const la = (await trashRow(a)).label; const lb = (await trashRow(b)).label; const lc = (await trashRow(c)).label;
  const t30 = (l) => `Mục '${l}' sẽ bị xóa vĩnh viễn khỏi lưu trữ sau 30 ngày.`; const t7 = (l) => `Mục '${l}' sẽ bị xóa vĩnh viễn khỏi lưu trữ sau 7 ngày.`;
  const n = async (kind, body) => (await pool.query('select count(*)::int n from notices where family_id=$1 and kind=$2 and body=$3', [FAM, kind, body])).rows[0].n;
  const allWarn = async () => (await pool.query("select count(*)::int n from notices where family_id=$1 and kind like 'warn\\_%'", [FAM])).rows[0].n;
  const mailN = async (kind) => (await pool.query('select count(*)::int n from mail_log where family_id=$1 and kind=$2', [FAM, kind])).rows[0].n;
  const mailOn = require('../mail').configured();
  const prevPurge = process.env.GP_TRASH_PURGE; delete process.env.GP_TRASH_PURGE;
  try {
    await TRASH.sweep({ log: () => {} });
    assert.equal(await n('warn_30', t30(la)), 2, 'a: the owner and the admin, once');
    assert.equal(await n('warn_7', t7(lb)), 3, 'b: the owner, the admin and the editor who deleted it, once');
    assert.equal(await n('warn_30', t30(lb)), 0, 'b is inside 7 days: no 30-day warning on top');
    assert.equal(await n('warn_7', t7(la)), 0, 'a is not yet inside 7 days');
    assert.equal(await n('warn_30', t30(lc)) + await n('warn_7', t7(lc)), 0, 'the deceased is never warned');
    assert.ok((await trashRow(a)).warned_30 && (await trashRow(a)).warned_7 == null, 'a: warned_30 stamped');
    assert.ok((await trashRow(b)).warned_7 && (await trashRow(b)).warned_30, 'b: both stamps, so the 30-day one never follows');
    assert.equal(await mailN('trash_warn_30'), mailOn ? 2 : 0, 'mail only when set up');
    assert.equal(await mailN('trash_warn_7'), mailOn ? 3 : 0, 'mail only when set up');
    const before = await allWarn();
    await TRASH.sweep({ log: () => {} }); await TRASH.sweep({ log: () => {} });
    assert.equal(await allWarn(), before, 're-runs send nothing');
    assert.equal((await trashRow(a)).state, 'archive');
    // a year after archiving: without GP_TRASH_PURGE the sweep only logs; with it, the living item is purged
    await archive(a, L + 1); await archive(b, L + 1); await archive(c, 400);
    const lines = []; await TRASH.sweep({ log: (l) => lines.push(l) });
    assert.match(lines[0], /dry run/); assert.equal((await trashRow(a)).state, 'archive', 'dry run keeps it');
    // an undated person with unknown living, archived 400 days ago: kept even with GP_TRASH_PURGE=1
    const u = await mk(OWNER, P('d'), '2204');
    await archive(u, 400);
    process.env.GP_TRASH_PURGE = '1';
    await TRASH.sweep({ log: () => {} });
    const ta = await trashRow(a); assert.equal(ta.state, 'purged'); assert.equal(ta.payload, null);
    assert.equal((await trashRow(b)).state, 'purged');
    assert.equal((await trashRow(c)).state, 'archive', 'historical data of a deceased person is kept');
    assert.equal((await trashRow(u)).state, 'archive', 'undated person, living unknown: kept forever');
  } finally { if (prevPurge === undefined) delete process.env.GP_TRASH_PURGE; else process.env.GP_TRASH_PURGE = prevPurge; }
});
