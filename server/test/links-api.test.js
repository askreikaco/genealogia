// "Same person" links API on a scratch database: owner of both trees links at once; an editor's proposal waits for
// the other tree; accept, list with privacy, duplicates refused, remove. Invented names only.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FA = `lka-${TAG}`; const FB = `lkb-${TAG}`;
const OWNER = `owner.${TAG}@example.test`; const ED = `ed.${TAG}@example.test`; const OUT = `out.${TAG}@example.test`;
let base, pool, close; const ck = {}; const P = {};
const nid = () => 'N' + crypto.randomUUID().slice(0, 13);

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ Lâm Thử','林','public'), ($2,$2,'Họ Mai Thử','梅','private')", [FA, FB]);
  Object.assign(P, { wifeA: nid(), daughterB: nid(), manA: nid(), oldA: nid(), oldB: nid() });
  const ins = (id, data, fam) => pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3)", [id, data, fam]);
  await ins(P.wifeA, { name: 'Mai Thị Hiền', sex: 'f', born: '1970' }, FA);
  await ins(P.daughterB, { name: 'Mai Thị Hiền', sex: 'f', born: '1970' }, FB);
  await ins(P.manA, { name: 'Lâm Văn Khôi', sex: 'm' }, FA);
  await ins(P.oldA, { name: 'Lâm Văn Cụ', sex: 'm', died: '1901' }, FA);
  await ins(P.oldB, { name: 'Mai Văn Cụ', sex: 'm', died: '1900' }, FB);
  await pool.query(`insert into members (email, name, role, status, family_id) values
    ($1,'o','owner','active',$3), ($1,'o','owner','active',$4), ($2,'e','editor','active',$3)`, [OWNER, ED, FA, FB]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.owner = await session(OWNER); ck.ed = await session(ED); ck.out = await session(OUT);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from person_links where a_family = any($1) or b_family = any($1)', [[FA, FB]]);
  await pool.query('delete from members where family_id = any($1)', [[FA, FB]]);
  await pool.query('delete from history where person_id = any($1)', [Object.values(P)]);
  await pool.query('delete from persons where id = any($1)', [Object.values(P)]);
  await pool.query('delete from families where id = any($1)', [[FA, FB]]);
  await close(); await pool.end();
});

test('owner of both trees: linked at once; both sides list it; history on both; duplicate refused', { skip }, async () => {
  const r = await call('POST', '/api/links', { family: FA, person: P.wifeA, other_family: FB, other_person: P.daughterB, reason: 'cùng tên, năm sinh' }, ck.owner);
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.status, 'accepted');
  const la = await call('GET', `/api/links?family=${FA}`, undefined, ck.owner);
  assert.equal(la.json.items.length, 1); assert.equal(la.json.items[0].other_person, P.daughterB); assert.equal(la.json.items[0].other_name, 'Mai Thị Hiền');
  const lb = await call('GET', `/api/links?family=${FB}`, undefined, ck.owner);
  assert.equal(lb.json.items[0].other_person, P.wifeA);
  const h = await pool.query("select count(*)::int n from history where field='lien_ket' and person_id = any($1)", [[P.wifeA, P.daughterB]]);
  assert.equal(h.rows[0].n, 2);
  const again = await call('POST', '/api/links', { family: FB, person: P.daughterB, other_family: FA, other_person: P.wifeA }, ck.owner);
  assert.equal(again.status, 409);
});

test('living person in a private tree is hidden from a guest of that tree', { skip }, async () => {
  const g = await call('GET', `/api/links?family=${FA}`, undefined, ck.out);
  assert.equal(g.status, 200); assert.equal(g.json.items.length, 0, 'other side living + private tree: not shown');
});

test('editor proposal waits; only the other tree owner/admin decides; accept then remove', { skip }, async () => {
  const sexBad = await call('POST', '/api/links', { family: FA, person: P.manA, other_family: FB, other_person: P.daughterB }, ck.ed);
  assert.equal(sexBad.status, 403, 'editor of A cannot read private tree B');
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,'e','member','active',$2)", [ED, FB]);
  const mism = await call('POST', '/api/links', { family: FA, person: P.manA, other_family: FB, other_person: P.daughterB }, ck.ed);
  assert.equal(mism.status, 400, 'sex mismatch'); assert.match(mism.json.error, /Giới tính/);
  const r = await call('POST', '/api/links', { family: FA, person: P.oldA, other_family: FB, other_person: P.oldB, reason: 'cùng giỗ' }, ck.ed);
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.status, 'pending');
  const notYou = await call('POST', `/api/links/${r.json.id}/accept`, undefined, ck.ed);
  assert.equal(notYou.status, 403);
  const pend = await call('GET', `/api/links?family=${FB}`, undefined, ck.owner);
  const row = pend.json.items.find((x) => x.id === r.json.id); assert.ok(row?.can_decide, 'owner of B sees it to decide');
  const ok = await call('POST', `/api/links/${r.json.id}/accept`, undefined, ck.owner);
  assert.equal(ok.status, 200); assert.equal(ok.json.status, 'accepted');
  const del = await call('DELETE', `/api/links/${r.json.id}`, undefined, ck.owner);
  assert.equal(del.status, 200);
  const left = await pool.query('select count(*)::int n from person_links where id=$1', [r.json.id]); assert.equal(left.rows[0].n, 0);
});

test('search in another tree: accent-insensitive, readable trees only', { skip }, async () => {
  const s = await call('GET', `/api/links/search?family=${FB}&q=mai thi hien`, undefined, ck.owner);
  assert.equal(s.status, 200); assert.ok(s.json.items.some((x) => x.id === P.daughterB));
  const no = await call('GET', `/api/links/search?family=${FB}&q=mai`, undefined, ck.out);
  assert.equal(no.status, 403, 'private tree, not a member');
});
