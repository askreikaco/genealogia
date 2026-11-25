// Gỡ người by family vote (COUNCIL.md, trimmed): the rules (pure) and the routes (DB, needs GP_TEST_DATABASE_URL, a SCRATCH
// database). Covers: voters (active owners and admins, not deceased); 2/3 YES with 2 YES besides the requester; the solo
// case (one owner or admin: passes unless an editor votes no); decided only at the window end; no needs a reason; the
// "nhập nhầm" fast path rules; restore by owner or admin only; notices to members on open and close.
'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const R = require('../decision-rules');

const DAY = R.DAY; const NOW = Date.UTC(2026, 10, 24, 6, 0, 0);
const ago = (d) => NOW - d * DAY;

// System accounts (.invalid QA / reference accounts) never vote: the electorate query excludes them (SQL in system-accounts.js).
test('electorate query excludes system accounts (SYSTEM_MEMBER_SQL)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'decisions.js'), 'utf8');
  assert.match(src, /require\('\.\/system-accounts'\)/);
  assert.match(src, /from members where family_id=\$1 and not \$\{SYSTEM_MEMBER_SQL\}/);
});

// ---- pure rules ----
test('voters: active owners and admins only; inactive (over 180 days) and deceased are out; editors are not voters', () => {
  const members = [
    { email: 'o@x.t', role: 'owner', status: 'active', lastSeenMs: ago(3) },
    { email: 'a@x.t', role: 'admin', status: 'active', lastSeenMs: ago(10) },
    { email: 'old@x.t', role: 'admin', status: 'active', lastSeenMs: ago(200) },
    { email: 'dead@x.t', role: 'admin', status: 'active', lastSeenMs: ago(2) },
    { email: 'e1@x.t', role: 'editor', status: 'active', lastSeenMs: ago(2) },
    { email: 'gone@x.t', role: 'admin', status: 'removed', lastSeenMs: ago(1) },
    { email: 'never@x.t', role: 'admin', status: 'active', lastSeenMs: null, baselineMs: ago(5) },
  ];
  const el = R.voterSet({ members, deceased: new Set(['dead@x.t']), nowMs: NOW, days: 180 });
  assert.deepStrictEqual(el.voters.sort(), ['a@x.t', 'never@x.t', 'o@x.t']);
});

test('2/3 of the voters YES and 2 YES besides the requester; the requester cannot approve alone', () => {
  const five = ['a', 'b', 'c', 'd', 'e'];
  const yes = (...es) => es.map((email) => ({ email, choice: 'yes' }));
  assert.strictEqual(R.passes(R.tally({ voters: five, ballots: yes('a'), requester: 'a' })), false);
  assert.strictEqual(R.passes(R.tally({ voters: five, ballots: yes('a', 'b', 'c'), requester: 'a' })), false); // 3/5 < 2/3
  assert.strictEqual(R.passes(R.tally({ voters: five, ballots: yes('a', 'b', 'c', 'd'), requester: 'a' })), true); // 4/5
  const three = ['a', 'b', 'c'];
  assert.strictEqual(R.passes(R.tally({ voters: three, ballots: yes('a', 'b'), requester: 'a' })), false); // one other only
  assert.strictEqual(R.passes(R.tally({ voters: three, ballots: yes('a', 'b', 'c'), requester: 'a' })), true);
  assert.strictEqual(R.passes(R.tally({ voters: ['a', 'b', 'c', 'd', 'e', 'f'], ballots: yes('a', 'b', 'c', 'd'), requester: 'a' })), true); // 4/6 exactly
  const outsider = R.tally({ voters: three, ballots: [{ email: 'z', choice: 'yes' }, { email: 'b', choice: 'yes' }], requester: 'a' });
  assert.strictEqual(outsider.yes, 1); // a non-voter's YES is not counted
});

test('two council members: the other one\'s YES passes it (min(2, voters - 1) besides the requester)', () => {
  const two = ['a', 'b'];
  const yes = (...es) => es.map((email) => ({ email, choice: 'yes' }));
  assert.strictEqual(R.passes(R.tally({ voters: two, ballots: yes('a', 'b'), requester: 'a' })), true);
  assert.strictEqual(R.passes(R.tally({ voters: two, ballots: yes('a'), requester: 'a' })), false);
  assert.strictEqual(R.passes(R.tally({ voters: two, ballots: [{ email: 'b', choice: 'no', reason: 'x' }], requester: 'a' })), false);
});

test('decided only at the window end: open before it, passed or failed at it', () => {
  const opened = ago(0); const closes = opened + 7 * DAY;
  assert.strictEqual(R.decisionStatus({ closesMs: closes, nowMs: closes - 1, passed: true }), 'open');
  assert.strictEqual(R.decisionStatus({ closesMs: closes, nowMs: closes, passed: true }), 'passed');
  assert.strictEqual(R.decisionStatus({ closesMs: closes, nowMs: closes, passed: false }), 'failed');
  assert.strictEqual(R.RULE.windowDays, 7);
});

test('solo case (one owner or admin): passes unless an editor-or-above votes NO', () => {
  assert.strictEqual(R.passesSolo(R.tally({ voters: ['e1', 'a'], ballots: [], requester: 'a' })), true);
  assert.strictEqual(R.passesSolo(R.tally({ voters: ['e1', 'a'], ballots: [{ email: 'e1', choice: 'no' }], requester: 'a' })), false);
});

test('nhập nhầm: only the creator, under 24 h old, with nothing attached', () => {
  const base = { creator: 'me@x.t', me: 'me@x.t', createdMs: NOW - 3600e3, nowMs: NOW };
  assert.strictEqual(R.quickDeleteOk(base).ok, true);
  assert.strictEqual(R.quickDeleteOk({ ...base, me: 'other@x.t' }).why, 'not-mine');
  assert.strictEqual(R.quickDeleteOk({ ...base, createdMs: NOW - 25 * 3600e3 }).why, 'too-old');
  assert.strictEqual(R.quickDeleteOk({ ...base, relations: 1 }).why, 'has-links');
});

test('the bar: shares of the voters, the threshold marker; 0 voters, everyone voted, and a 2-voter family', () => {
  const z = R.barParts({ n: 0, yes: 0, no: 0 });
  assert.deepStrictEqual([z.yes_pct, z.no_pct, z.pending_pct, z.need, z.need_pct], [0, 0, 0, 0, 0]);
  const all = R.barParts({ n: 5, yes: 3, no: 2 });
  assert.strictEqual(all.pending, 0); assert.strictEqual(all.pending_pct, 0);
  assert.strictEqual(all.yes_pct + all.no_pct, 100);
  const four = R.barParts({ n: 5, yes: 4, no: 1 });
  assert.strictEqual(four.pending, 0); assert.strictEqual(four.need, 4); assert.strictEqual(four.need_pct, 80);
  const two = R.barParts({ n: 2, yes: 1, no: 0 });
  assert.strictEqual(two.need, 2); assert.strictEqual(two.yes_pct, 50); assert.strictEqual(two.pending_pct, 50); assert.strictEqual(two.need_pct, 100);
  const mid = R.barParts({ n: 6, yes: 2, no: 1 });
  assert.strictEqual(mid.pending, 3); assert.strictEqual(mid.need, 4);
  assert.strictEqual(mid.yes_pct + mid.pending_pct + mid.no_pct, 100);
});

// ---- routes (scratch DB) ----
const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `dec-${TAG}`; const SOLO = `decs-${TAG}`;
const E = (n) => `${n}.${TAG}@example.test`;
const O = E('owner'); const A = E('admin'); const I = E('inactive'); const X = E('deceased'); const E1 = E('ed1'); const M = E('member');
const K = E('third'); const SO = E('solo'); const SE = E('soloed');
const P = (x) => `D${TAG}${x}`;
const PEOPLE = ['1', '2', '3', '4', '5', '6'];
let base; let pool; let close; let decisions; const ck = {};

async function call(method, p, body, who) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(who ? { cookie: ck[who] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
const q = (p, fam = FAM) => `${p}${p.includes('?') ? '&' : '?'}family=${fam}`;
const closeNow = (id) => pool.query("update decisions set closes_at = now() - interval '1 hour' where id=$1", [id]);
const trashOf = async (pid) => (await pool.query("select * from trash where item_id=$1 and kind='person' order by id desc limit 1", [pid])).rows[0];
const isDeleted = async (pid) => (await pool.query('select deleted from persons where id=$1', [pid])).rows[0].deleted;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server');
  pool = p; decisions = require('../decisions');
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  for (const f of [FAM, SOLO]) await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,$2,'public')", [f, 'Thử ' + f]);
  for (const n of PEOPLE) await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [P(n), FAM, { name: `Người ${n}`, gen: 2 }, 'test']);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [P('7'), SOLO, { name: 'Người Một Mình', gen: 2 }, 'test']);
  await pool.query("insert into parent_child (family_id, parent_id, child_id) values ($1,$2,$3)", [FAM, P('3'), P('5')]);
  await pool.query("insert into history (person_id, field, new_value, by_user, source) values ($1,'name','\"x\"',$2,'app')", [P('4'), O]);
  await pool.query("insert into history (person_id, field, new_value, by_user, source) values ($1,'name','\"x\"',$2,'app')", [P('6'), E1]);
  await pool.query("insert into history (person_id, field, new_value, by_user, source) values ($1,'name','\"x\"',$2,'app')", [P('2'), E1]);
  const mem = [[O, FAM, 'owner'], [A, FAM, 'admin'], [I, FAM, 'admin'], [X, FAM, 'admin'], [K, FAM, 'admin'], [E1, FAM, 'editor'], [M, FAM, 'member'], [SO, SOLO, 'owner'], [SE, SOLO, 'editor']];
  for (const [e, f, r] of mem) await pool.query("insert into members (email, name, family_id, role, status) values ($1,$2,$3,$4,'active')", [e, e.split('@')[0], f, r]);
  await pool.query("update members set last_seen_at = now() - interval '200 days' where email=$1 and family_id=$2", [I, FAM]);
  await pool.query('insert into council_deceased (family_id, email) values ($1,$2)', [FAM, X]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  for (const e of [O, A, I, X, K, E1, M, SO, SE]) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, name: e.split('@')[0] }) });
    ck[e] = r.headers.get('set-cookie').split(';')[0];
  }
});
test.after(async () => {
  if (skip || !pool) return;
  for (const f of [FAM, SOLO]) for (const t of ['trash', 'trash_audit', 'notices', 'decisions', 'council_deceased', 'parent_child', 'members']) await pool.query(`delete from ${t} where family_id=$1`, [f]).catch(() => {});
  await pool.query('delete from history where person_id = any($1)', [PEOPLE.map(P).concat([P('7'), P('8'), P('9')])]).catch(() => {});
  await pool.query('delete from persons where id = any($1)', [PEOPLE.map(P).concat([P('7'), P('8'), P('9')])]).catch(() => {});
  await pool.query('delete from families where id = any($1)', [[FAM, SOLO]]).catch(() => {});
  await close?.(); await pool.end().catch(() => {});
});

async function openVote(pid, who = A, fam = FAM) {
  const r = await call('POST', q(`/api/persons/${pid}/removal`, fam), { kind: 'vote', reason: 'Không thuộc dòng họ' }, who);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  return r.json.decision.id;
}

test('vote: decided at the window end; 2 YES besides the requester passes it; the person goes to the trash; members are told', { skip }, async () => {
  const id = await openVote(P('1'));
  const pending = (await call('GET', q(`/api/decisions/${id}`), undefined, M)).json.decision;
  assert.strictEqual(pending.state, 'open'); assert.strictEqual(pending.voters, 3);
  assert.strictEqual((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'yes' }, O)).status, 200);
  assert.strictEqual((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'yes' }, E1)).status, 403, 'an editor is not a voter');
  await decisions.sweep();
  assert.strictEqual((await call('GET', q(`/api/decisions/${id}`), undefined, M)).json.decision.state, 'open', 'not before the window ends');
  await closeNow(id); await decisions.sweep();
  assert.strictEqual((await call('GET', q(`/api/decisions/${id}`), undefined, M)).json.decision.state, 'failed', 'the requester and one other: not 2 YES besides the requester');
  const id2 = await openVote(P('2'));
  await call('POST', q(`/api/decisions/${id2}/ballot`), { choice: 'yes' }, O);
  await call('POST', q(`/api/decisions/${id2}/ballot`), { choice: 'yes' }, K);
  await closeNow(id2); await decisions.sweep();
  assert.strictEqual((await call('GET', q(`/api/decisions/${id2}`), undefined, M)).json.decision.state, 'passed');
  assert.strictEqual(await isDeleted(P('2')), true);
  assert.ok(await trashOf(P('2')));
  const n = (await pool.query("select count(*)::int n from notices where family_id=$1 and kind='decision'", [FAM])).rows[0].n;
  assert.ok(n >= 6, `notices ${n}`); // open + close, to each of 4 members at least once
});

test('no needs a reason; a non-voter cannot ballot; the chooser shows the options', { skip }, async () => {
  const id = await openVote(P('3'));
  assert.strictEqual((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'no', reason: '' }, O)).status, 400);
  assert.strictEqual((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'yes' }, M)).status, 403);
  assert.strictEqual((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'no', reason: 'Chưa rõ' }, O)).status, 200);
  const opt = await call('GET', q(`/api/persons/${P('5')}/removal`), undefined, A);
  assert.strictEqual(opt.status, 200);
  assert.strictEqual(opt.json.quick.ok, false);
  assert.strictEqual(opt.json.voters, 3);
  await pool.query("update decisions set closes_at = now() - interval '1 hour' where id=$1", [id]);
  await decisions.sweep();
});

test('solo: one owner or admin, no editor votes NO: passes at the window end', { skip }, async () => {
  const r = await call('POST', q(`/api/persons/${P('7')}/removal`, SOLO), { kind: 'vote', reason: 'Trùng dữ liệu' }, SO);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.decision.solo, true);
  assert.strictEqual((await call('POST', q(`/api/decisions/${r.json.decision.id}/ballot`, SOLO), { choice: 'no', reason: 'Không đúng' }, SE)).status, 200);
  await closeNow(r.json.decision.id); await decisions.sweep();
  assert.strictEqual((await call('GET', q(`/api/decisions/${r.json.decision.id}`, SOLO), undefined, SO)).json.decision.state, 'failed', 'an editor voted no');
  const r2 = await call('POST', q(`/api/persons/${P('7')}/removal`, SOLO), { kind: 'vote', reason: 'Trùng dữ liệu' }, SO);
  await closeNow(r2.json.decision.id); await decisions.sweep();
  assert.strictEqual((await call('GET', q(`/api/decisions/${r2.json.decision.id}`, SOLO), undefined, SO)).json.decision.state, 'passed');
  assert.strictEqual(await isDeleted(P('7')), true);
});

test('nhập nhầm: allowed for my own fresh record with nothing attached; refused for another creator or a linked record', { skip }, async () => {
  const opt = await call('GET', q(`/api/persons/${P('4')}/removal`), undefined, O);
  assert.strictEqual(opt.json.quick.ok, true);
  assert.strictEqual((await call('POST', q(`/api/persons/${P('4')}/removal`), { kind: 'quick' }, O)).status, 200);
  assert.strictEqual(await isDeleted(P('4')), true);
  assert.strictEqual((await call('POST', q(`/api/persons/${P('6')}/removal`), { kind: 'quick' }, O)).status, 409, 'not my record');
  assert.strictEqual((await call('POST', q(`/api/persons/${P('5')}/removal`), { kind: 'quick' }, A)).status, 409, 'no history by me');
  assert.strictEqual((await call('GET', q(`/api/persons/${P('6')}/removal`), undefined, E1)).json.quick.ok, true, 'my own fresh record');
});

test('restore: an owner or admin restores a removed person from the trash; an editor cannot; the old one-person delete is refused', { skip }, async () => {
  const t2 = await trashOf(P('2'));
  assert.strictEqual((await call('POST', q(`/api/trash/${t2.id}/restore`), {}, E1)).status, 403);
  assert.strictEqual((await call('POST', q(`/api/trash/${t2.id}/restore`), {}, A)).status, 200);
  assert.strictEqual(await isDeleted(P('2')), false);
  assert.strictEqual((await call('POST', q(`/api/persons/${P('6')}/delete`), { reason: 'thử' }, A)).status, 409);
  assert.strictEqual(await isDeleted(P('6')), false);
});

test('a plain member is never a voter in the normal case; only owners and admins are, and the solo electorate is editor-or-above', () => {
  const members = [
    { email: 'o@x.t', role: 'owner', status: 'active', lastSeenMs: ago(1) },
    { email: 'a@x.t', role: 'admin', status: 'active', lastSeenMs: ago(1) },
    { email: 'k@x.t', role: 'admin', status: 'active', lastSeenMs: ago(1) },
    { email: 'e@x.t', role: 'editor', status: 'active', lastSeenMs: ago(1) },
    { email: 'mem@x.t', role: 'member', status: 'active', lastSeenMs: ago(1) },
  ];
  const el = R.voterSet({ members, nowMs: NOW, days: 180 });
  assert.ok(!el.voters.includes('mem@x.t'), 'a member is not a voter');
  assert.ok(!el.voters.includes('e@x.t'), 'an editor is not a voter in the normal case');
  assert.deepStrictEqual(el.voters.sort(), ['a@x.t', 'k@x.t', 'o@x.t']);
  const solo = R.soloElectorate(members.slice(0, 1).concat(members.slice(3)), new Set(), NOW);
  assert.ok(!solo.includes('mem@x.t'), 'members never vote, not even solo');
  assert.ok(solo.includes('e@x.t') && solo.includes('o@x.t'));
});

test('voter sets per option: council, council + editors, members with 90+ days; active and deceased are out under each', () => {
  const members = [
    { email: 'o@x.t', role: 'owner', status: 'active', lastSeenMs: ago(1), tenureMs: ago(900) },
    { email: 'a@x.t', role: 'admin', status: 'active', lastSeenMs: ago(1), tenureMs: ago(400) },
    { email: 'e100@x.t', role: 'editor', status: 'active', lastSeenMs: ago(1), tenureMs: ago(100) },
    { email: 'e10@x.t', role: 'editor', status: 'active', lastSeenMs: ago(1), tenureMs: ago(10) },
    { email: 'm100@x.t', role: 'member', status: 'active', lastSeenMs: ago(1), tenureMs: ago(100) },
    { email: 'm10@x.t', role: 'member', status: 'active', lastSeenMs: ago(1), tenureMs: ago(10) },
    { email: 'old@x.t', role: 'admin', status: 'active', lastSeenMs: ago(200), tenureMs: ago(800) },
    { email: 'dead@x.t', role: 'owner', status: 'active', lastSeenMs: ago(1), tenureMs: ago(900) },
  ];
  const dead = new Set(['dead@x.t']);
  const set = (rule) => R.voterSet({ members, rule, deceased: dead, nowMs: NOW, days: 180 }).voters.sort();
  assert.deepStrictEqual(set('council'), ['a@x.t', 'o@x.t']);
  assert.deepStrictEqual(set('council_editors'), ['a@x.t', 'e100@x.t', 'e10@x.t', 'o@x.t']);
  assert.deepStrictEqual(set('members'), ['a@x.t', 'e100@x.t', 'm100@x.t', 'o@x.t']);
  assert.strictEqual(R.voterSet({ members, nowMs: NOW, days: 180 }).rule, 'council', 'no rule means the default');
});

test('abstain counts as voted, never as yes; it does not help a removal pass (all eligible voters stay in the 2/3)', () => {
  const v = ['a', 'b', 'c', 'd', 'e'];
  const ballots = [{ email: 'a', choice: 'yes' }, { email: 'b', choice: 'yes' }, { email: 'c', choice: 'yes' }, { email: 'd', choice: 'abstain' }, { email: 'e', choice: 'abstain' }];
  const t = R.tally({ voters: v, ballots, requester: 'a' });
  assert.strictEqual(t.yes, 3); assert.strictEqual(t.abstain, 2); assert.strictEqual(t.no, 0);
  assert.strictEqual(R.passes(t), false, '3 of 5 is below 2/3; the two abstentions do not help');
  const t2 = R.tally({ voters: v, ballots: [...ballots.slice(0, 3), { email: 'd', choice: 'yes' }, { email: 'e', choice: 'abstain' }], requester: 'a' });
  assert.strictEqual(R.passes(t2), true, '4 of 5 YES passes; one abstention is no obstacle');
  assert.ok(R.CHOICES.includes('abstain'));
  const bar = R.barParts({ n: 5, yes: 3, no: 0, abstain: 2 });
  assert.strictEqual(bar.pending, 0); assert.strictEqual(bar.abstain_pct, 40);
  const bar2 = R.barParts({ n: 5, yes: 1, no: 1, abstain: 1 });
  assert.strictEqual(bar2.pending, 2);
  assert.strictEqual(bar2.yes_pct + bar2.no_pct + bar2.abstain_pct + bar2.pending_pct, 100);
});

test('vote rule: only the owner changes it (history and a notice); an open vote keeps the rule it opened with', { skip }, async () => {
  assert.equal((await call('POST', q('/api/council-setting'), { rule: 'members' }, A)).status, 403, 'an admin cannot change it');
  assert.equal((await call('POST', q('/api/council-setting'), { rule: 'nonsense' }, O)).status, 400);
  await pool.query("update members set approved_at = now() - interval '120 days' where email=$1 and family_id=$2", [M, FAM]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [P('9'), FAM, { name: 'Người Chín', gen: 2 }, 'test']);
  const first = await openVote(P('9'));
  const v0 = (await pool.query('select voters, vote_rule from decisions where id=$1', [first])).rows[0];
  assert.ok(!v0.voters.includes(R.norm(M)), 'under the default rule a plain member is not a voter');
  assert.equal(v0.vote_rule, 'council');
  const notices0 = (await pool.query("select count(*)::int n from notices where family_id=$1 and kind='decision'", [FAM])).rows[0].n;
  const ch = await call('POST', q('/api/council-setting'), { rule: 'members' }, O);
  assert.equal(ch.status, 200); assert.equal(ch.json.changed, true);
  assert.ok((await pool.query("select count(*)::int n from family_history where family_id=$1 and field='vote_rule'", [FAM])).rows[0].n >= 1, 'history row');
  assert.ok((await pool.query("select count(*)::int n from notices where family_id=$1 and kind='decision'", [FAM])).rows[0].n > notices0, 'members are told');
  const still = (await pool.query('select voters, vote_rule from decisions where id=$1', [first])).rows[0];
  assert.deepStrictEqual(still.voters, v0.voters, 'the open vote keeps its voters');
  assert.equal(still.vote_rule, 'council', 'and its rule');
  await closeNow(first); await decisions.sweep();
  await pool.query("update members set approved_at = now() - interval '120 days' where family_id=$1 and status='active'", [FAM]); // everyone has 90+ days
  const second = await openVote(P('9'), A);
  const v2 = (await pool.query('select voters, vote_rule from decisions where id=$1', [second])).rows[0];
  assert.ok(v2.voters.includes(R.norm(M)), 'a new vote under members includes the member');
  assert.equal(v2.vote_rule, 'members');
  assert.equal((await call('GET', q('/api/council-setting'), undefined, M)).json.vote_rule, 'members');
  await closeNow(second); await decisions.sweep();
  assert.equal((await call('POST', q('/api/council-setting'), { rule: 'council' }, O)).status, 200);
});

test('while a vote is open no role sees who chose what, the reasons or the counts; after close the full result is shown', { skip }, async () => {
  const id = await openVote(P('5'));
  assert.equal((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'no', reason: 'Chưa rõ' }, O)).status, 200);
  assert.equal((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'abstain' }, K)).status, 200);
  const nameOf = (e) => e.split('@')[0];
  for (const who of [A, O, K, M]) {
    const d = (await call('GET', q(`/api/decisions/${id}`), undefined, who)).json.decision;
    const raw = JSON.stringify(d);
    assert.ok(!raw.includes('Chưa rõ'), `no reason for ${who}`);
    for (const k of ['yes', 'no', 'abstain', 'yes_others']) assert.ok(!(k in d), `no ${k} for ${who}`);
    assert.ok(!('yes' in d.groups) && !('no' in d.groups) && !('abstain' in d.groups), 'no choice groups while open');
    assert.deepStrictEqual(d.groups.voted.map((x) => x.name).sort(), [nameOf(A), nameOf(K), nameOf(O)].sort(), 'who has voted');
    assert.deepStrictEqual(d.groups.pending, []);
    assert.deepStrictEqual([d.bar.n, d.bar.voted, d.bar.pending], [3, 3, 0]);
    assert.ok(!('yes' in d.bar) && !('need' in d.bar), 'no counts or threshold in the bar while open');
  }
  // each viewer gets their own choice back, and nothing else
  assert.equal((await call('GET', q(`/api/decisions/${id}`), undefined, O)).json.decision.mine, 'no');
  assert.equal((await call('GET', q(`/api/decisions/${id}`), undefined, K)).json.decision.mine, 'abstain');
  assert.equal((await call('GET', q(`/api/decisions/${id}`), undefined, A)).json.decision.mine, 'yes');
  assert.equal((await call('GET', q(`/api/decisions/${id}`), undefined, M)).json.decision.mine, null);
  const list = (await call('GET', q('/api/decisions'), undefined, O)).json.decisions.find((x) => x.id === id);
  assert.ok(!JSON.stringify(list).includes('Chưa rõ'), 'the list hides it too');
  await closeNow(id); await decisions.sweep();
  const c = (await call('GET', q(`/api/decisions/${id}`), undefined, M)).json.decision;
  assert.equal(c.state, 'failed');
  assert.deepStrictEqual(c.groups.yes.map((x) => x.name), [nameOf(A)]);
  assert.equal(c.groups.no[0].name, nameOf(O));
  assert.equal(c.groups.no[0].reason, 'Chưa rõ');
  assert.deepStrictEqual(c.groups.abstain.map((x) => x.name), [nameOf(K)]);
  assert.deepStrictEqual([c.bar.yes, c.bar.no, c.bar.abstain, c.bar.pending], [1, 1, 1, 0]);
});

test('abstain: counts as voted, not as yes, in its own group once the vote is closed; the API takes it and rejects other words', { skip }, async () => {
  const id = await openVote(P('6'));
  assert.equal((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'maybe' }, O)).status, 400);
  assert.equal((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'abstain' }, K)).status, 200);
  const open = (await call('GET', q(`/api/decisions/${id}`), undefined, M)).json.decision;
  assert.deepStrictEqual([open.bar.voted, open.bar.pending], [2, 1], 'abstain is a vote: it is no longer pending');
  await closeNow(id); await decisions.sweep();
  const d = (await call('GET', q(`/api/decisions/${id}`), undefined, M)).json.decision;
  assert.deepStrictEqual(d.groups.abstain.map((x) => x.name), [K.split('@')[0]]);
  assert.ok(!d.groups.yes.some((x) => x.name === K.split('@')[0]), 'abstain is not yes');
  assert.deepStrictEqual([d.bar.yes, d.bar.abstain, d.bar.pending], [1, 1, 1]);
});

test('all eligible voters voted: the vote closes after a 10-minute grace from the last vote; a changed vote inside the grace counts', { skip }, async () => {
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [P('8'), FAM, { name: 'Người Tám', gen: 2 }, 'test']);
  const id = await openVote(P('8'));                  // voters O, A, K; the requester's YES is there
  assert.equal((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'yes' }, O)).status, 200);
  assert.equal((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'no', reason: 'Chưa rõ' }, K)).status, 200);
  const all = (await pool.query('select all_voted_at from decisions where id=$1', [id])).rows[0];
  assert.ok(all.all_voted_at, 'everyone has voted: the grace starts');
  await decisions.sweep();
  assert.equal((await call('GET', q(`/api/decisions/${id}`), undefined, M)).json.decision.state, 'open', 'inside the grace it stays open');
  // a change of mind inside the grace counts, and restarts the grace from that vote
  assert.equal((await call('POST', q(`/api/decisions/${id}/ballot`), { choice: 'yes' }, K)).status, 200);
  await pool.query("update decisions set all_voted_at = now() - interval '5 minutes' where id=$1", [id]);
  await decisions.sweep();
  assert.equal((await call('GET', q(`/api/decisions/${id}`), undefined, M)).json.decision.state, 'open', 'the change restarted the grace');
  // ten minutes after the last vote: the sweep closes it with the latest choices (all three YES: passed)
  await pool.query("update decisions set all_voted_at = now() - interval '11 minutes' where id=$1", [id]);
  await decisions.sweep();
  const d = (await call('GET', q(`/api/decisions/${id}`), undefined, M)).json.decision;
  assert.equal(d.state, 'passed');
  assert.deepStrictEqual(d.groups.yes.map((x) => x.name).sort(), [A, K, O].map((e) => e.split('@')[0]).sort(), 'K changed to yes and counts');
  assert.ok((await pool.query('select closes_at > now() as f from decisions where id=$1', [id])).rows[0].f, 'it closed before the 7-day window ended');
});
