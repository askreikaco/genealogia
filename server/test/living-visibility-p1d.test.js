// P1d living-person visibility to non-members: the family setting (living_visibility) and the person's own setting
// (self_visibility), the name-only view, and who may change each. Pure rules always run; the API part needs a SCRATCH
// database (GP_TEST_DATABASE_URL, see scripts/ci-db.sh). Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const core = require('../core');
const R = require('../elder-rules');

test('effective visibility for all six combinations: the person\'s setting wins unless inherit', () => {
  const cases = [
    ['private', 'inherit', 'private'], ['names', 'inherit', 'names'],
    ['private', 'private', 'private'], ['names', 'private', 'private'],
    ['private', 'names', 'names'], ['names', 'names', 'names'],
  ];
  for (const [fam, self, want] of cases) assert.equal(core.effectiveLiving(fam, self), want, `family ${fam}, self ${self}`);
  assert.deepEqual(core.LIVING_VIS, ['private', 'names']);
  assert.deepEqual(core.SELF_VIS, ['inherit', 'private', 'names']);
});

test('publicView: placeholder by default; names keeps name, sex, generation and links only', () => {
  const d = { name: 'Người Sống Thử', sex: 'f', gen: 4, born: '1980', birth_date: '1980-05-01', photo: 'p.jpg', place: 'Hà Nội',
    phone: '0900000000', contact_public: 'yes', alias: 'Bí danh', name_han: '測試', names: [{ surname: 'A' }], parent: 'P001', spouse_of: 'P002', spouse_n: 1, living: 'living', born_place: 'x' };
  const hidden = core.publicView(d);
  assert.equal(hidden.name, ''); assert.equal(hidden.hidden_living, true); assert.equal(hidden.parent, 'P001');
  assert.equal(hidden.sex, 'f'); assert.equal(hidden.gen, 4);
  const named = core.publicView(d, { living: 'names' });
  assert.equal(named.name, 'Người Sống Thử'); assert.equal(named.hidden_living, true, 'still a hidden-detail person (members-only notice)');
  assert.equal(named.sex, 'f'); assert.equal(named.gen, 4); assert.equal(named.parent, 'P001'); assert.equal(named.spouse_of, 'P002'); assert.equal(named.spouse_n, 1);
  for (const k of ['born', 'birth_date', 'photo', 'place', 'phone', 'alias', 'name_han', 'names', 'living', 'born_place', 'contacts', 'death_date']) {
    assert.equal(named[k], undefined, `${k} must not leak in names mode`);
  }
  assert.equal(Object.keys(named).some((k) => /phone|email|address|facebook|zalo|social|photo|place/.test(k)), false);
});

test('publicView: dead people are unaffected by the living setting', () => {
  const dead = { name: 'Cụ Mất', sex: 'm', gen: 2, born: '1900', died: '1950', photo: 'x.jpg' };
  assert.equal(core.publicView(dead, { living: 'private' }).name, 'Cụ Mất');
  assert.equal(core.publicView(dead, { living: 'names' }).name, 'Cụ Mất', 'dead: the usual public view, names unaffected');
});

test('canSetSelfVisibility: the linked account, its manager or the person\'s device only; admins and owners cannot', () => {
  const linked = { email: 'a@x.test', familyRole: 'member', managedIds: new Set(), selfIds: new Set(['P1']) };
  const manager = { email: 'm@x.test', familyRole: 'member', managedIds: new Set(['P1']), selfIds: new Set() };
  const admin = { email: 'ad@x.test', familyRole: 'admin', managedIds: new Set(), selfIds: new Set() };
  const owner = { email: 'ow@x.test', familyRole: 'owner', managedIds: new Set(), selfIds: new Set() };
  const device = { device: true, personId: 'P1', email: null, familyRole: null, managedIds: new Set(), selfIds: new Set() };
  const code = { email: null, familyRole: 'admin', code: true, managedIds: new Set(), selfIds: new Set() };
  assert.equal(R.canSetSelfVisibility(linked, 'P1'), true, 'linked account');
  assert.equal(R.canSetSelfVisibility(manager, 'P1'), true, 'managing relative');
  assert.equal(R.canSetSelfVisibility(device, 'P1'), true, 'device of that person');
  assert.equal(R.canSetSelfVisibility(linked, 'P2'), false, 'another person');
  assert.equal(R.canSetSelfVisibility(device, 'P2'), false, 'device of another person');
  assert.equal(R.canSetSelfVisibility(admin, 'P1'), false, 'family admin cannot');
  assert.equal(R.canSetSelfVisibility(owner, 'P1'), false, 'family owner cannot');
  assert.equal(R.canSetSelfVisibility(code, 'P1'), false, 'shared editor code cannot');
  assert.equal(R.canSetSelfVisibility(null, 'P1'), false);
});

// ---- API (scratch database) ----
const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `lvd-${TAG}`;
const mail = (k) => `${k}.${TAG}@example.test`;
const EM = { owner: mail('owner'), admin: mail('admin'), linked: mail('linked'), manager: mail('manager'), member: mail('member') };
const L = 'N' + TAG + 'l1x'; // a living person, linked to EM.linked, managed by EM.manager
const LX = 'N' + TAG + 'l2x'; // a living person with no link (family setting only)
let base, pool, close;
const ck = {};

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];
const byId = (items, id) => (items || []).find((x) => x.id === id)?.data;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Living Vis Test','','public')", [FAM]);
  const ins = (id, data) => pool.query('insert into persons (id, data, updated_by, family_id) values ($1,$2,$3,$4)', [id, data, 'test', FAM]);
  await ins(L, { name: 'Lê Thị Sống', sex: 'f', gen: 3, born: '1980', birth_date: '1980-05-01', phone: '0900000009', place: 'Thử Nơi' });
  await ins(LX, { name: 'Phạm Văn Kín', sex: 'm', gen: 3, born: '1975', phone: '0900000008' });
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,'o','owner','active',$4), ($2,'a','admin','active',$4), ($3,'m','member','active',$4)", [EM.owner, EM.admin, EM.member, FAM]);
  await pool.query("insert into members (email, name, role, status, family_id, person_id) values ($1,'l','member','active',$2,$3)", [EM.linked, FAM, L]);
  await pool.query('insert into person_managers (family_id, person_id, email) values ($1,$2,$3)', [FAM, L, EM.manager]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  for (const k of Object.keys(EM)) ck[k] = await session(EM[k]);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from history where person_id = any($1)', [[L, LX]]);
  await pool.query('delete from family_history where family_id = $1', [FAM]);
  await pool.query('delete from person_managers where family_id = $1', [FAM]);
  await pool.query('delete from members where family_id = $1', [FAM]);
  await pool.query('delete from persons where family_id = $1', [FAM]);
  await pool.query('delete from families where id = $1', [FAM]);
  await close(); await pool.end();
});

test('guest: a private living person is the placeholder (no name, no dates, no contacts)', { skip }, async () => {
  const r = await call('GET', `/api/persons?family=${FAM}`);
  assert.equal(r.status, 200);
  const d = byId(r.json.items, L);
  assert.equal(d.name, ''); assert.equal(d.hidden_living, true); assert.equal(d.born, undefined); assert.equal(d.phone, undefined);
});

test('admins cannot set self_visibility (403); owner can set the family setting; non-admins cannot (403)', { skip }, async () => {
  const adminSelf = await call('PUT', `/api/persons/${L}/self-visibility`, { value: 'names' }, ck.admin);
  assert.equal(adminSelf.status, 403, 'family admin');
  const ownerSelf = await call('PUT', `/api/persons/${L}/self-visibility`, { value: 'names' }, ck.owner);
  assert.equal(ownerSelf.status, 403, 'family owner');
  const memberFam = await call('PATCH', `/api/families/${FAM}`, { living_visibility: 'names' }, ck.member);
  assert.equal(memberFam.status, 403, 'plain member cannot change the family setting');
  const ok = await call('PATCH', `/api/families/${FAM}`, { living_visibility: 'names' }, ck.owner);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.family.living_visibility, 'names');
  const bad = await call('PATCH', `/api/families/${FAM}`, { living_visibility: 'everyone' }, ck.owner);
  assert.equal(bad.status, 400);
});

test('family setting names: a guest sees the name, sex and generation only; no dates, phone or place', { skip }, async () => {
  const r = await call('GET', `/api/persons?family=${FAM}`);
  const d = byId(r.json.items, L);
  assert.equal(d.name, 'Lê Thị Sống'); assert.equal(d.sex, 'f'); assert.equal(d.gen, 3);
  for (const k of ['born', 'birth_date', 'phone', 'place']) assert.equal(d[k], undefined, `${k} must not leak`);
  const s = await call('GET', `/api/links/search?family=${FAM}&q=Sống`);
  const hit = (s.json.items || []).find((x) => x.id === L);
  assert.ok(hit, 'name-only person is listed in link search');
  assert.equal(hit.years, '', 'no years'); assert.equal(hit.name, 'Lê Thị Sống');
  assert.equal((s.json.items || []).some((x) => x.id === LX), false, 'a placeholder is not listed');
});

test('self setting: the linked account and its manager may set it; a guest then sees the placeholder again', { skip }, async () => {
  const none = await call('PUT', `/api/persons/${L}/self-visibility`, { value: 'private' }, ck.member);
  assert.equal(none.status, 403, 'a plain member cannot');
  const linked = await call('PUT', `/api/persons/${L}/self-visibility`, { value: 'private' }, ck.linked);
  assert.equal(linked.status, 200, 'linked account');
  assert.equal(linked.json.value, 'private');
  const r = await call('GET', `/api/persons?family=${FAM}`);
  assert.equal(byId(r.json.items, L).name, '', 'private overrides the family names setting');
  const mgr = await call('PUT', `/api/persons/${L}/self-visibility`, { value: 'names' }, ck.manager);
  assert.equal(mgr.status, 200, 'managing relative');
  const r2 = await call('GET', `/api/persons?family=${FAM}`);
  assert.equal(byId(r2.json.items, L).name, 'Lê Thị Sống');
  const got = await call('GET', `/api/persons/${L}/self-visibility`, undefined, ck.linked);
  assert.equal(got.json.value, 'names'); assert.equal(got.json.can_set, true);
  const adm = await call('GET', `/api/persons/${L}/self-visibility`, undefined, ck.admin);
  assert.equal(adm.json.can_set, false);
});

test('every change writes history: person (old -> new, who) and family (old -> new, who)', { skip }, async () => {
  const h = await pool.query("select old_value, new_value, by_user from history where person_id=$1 and field='self_visibility' order by at", [L]);
  assert.ok(h.rows.length >= 2);
  assert.equal(h.rows[0].by_user, EM.linked);
  assert.equal(h.rows[0].old_value, 'inherit');
  assert.equal(h.rows[0].new_value, 'private');
  const f = await pool.query("select old_value, new_value, by_user from family_history where family_id=$1 and field='living_visibility'", [FAM]);
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].old_value, 'private'); assert.equal(f.rows[0].new_value, 'names'); assert.equal(f.rows[0].by_user, EM.owner);
});
