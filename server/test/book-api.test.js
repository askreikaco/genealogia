// Integration tests for the book endpoints: GET /api/book/outline and GET /api/persons?ids=.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const PRIV = 'test-book-' + TAG; // a private family for this run only
const PUB = 'test-bookpub-' + TAG; // a public family for this run only: its people are the ones this file inserts
const PUB_N = 60;
const MEMBER = `member.${TAG}@example.test`;
let base; let pool; let close; let cookie = '';
const created = { persons: [], families: [PRIV, PUB], members: [MEMBER] };

async function call(p, cookieHdr) {
  const r = await fetch(base + p, { headers: cookieHdr ? { cookie: cookieHdr } : {} });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, headers: r.headers };
}

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1, $1, 'Dòng họ thử', 'private')", [PRIV]);
  for (const [i, name] of ['Tổ Thử', 'Con Thử', 'Cháu Thử'].entries()) {
    const id = 'N' + crypto.randomUUID().slice(0, 13);
    created.persons.push(id);
    await pool.query("insert into persons (id, data, updated_by, family_id) values ($1, $2, 'test', $3)",
      [id, { name: name + ' ' + TAG, gen: i + 1, sex: 'm', parent: i ? created.persons[i - 1] : undefined, born: '1900', phone: '0900000000' }, PRIV]);
  }
  await pool.query("insert into members (family_id, email, name, role, status) values ($1, $2, 'Thành Viên Thử', 'member', 'active')", [PRIV, MEMBER]);
  // The public family is this file's own: the shared 'duong' family is changed by other files (the e2e files write into
  // it on the same database), so its size is not a fixed fact here.
  await pool.query("insert into families (id, slug, name, visibility) values ($1, $1, 'Dòng họ thử công khai', 'public')", [PUB]);
  for (let i = 0; i < PUB_N; i++) {
    const id = 'N' + crypto.randomUUID().slice(0, 13);
    created.persons.push(id);
    const gen = (i % 6) + 1;
    await pool.query("insert into persons (id, data, updated_by, family_id) values ($1, $2, 'test', $3)",
      [id, { name: 'Người ' + i + ' ' + TAG, gen, sex: i % 2 ? 'f' : 'm', parent: i >= 6 ? created.persons[i - 6] : undefined, born: String(1900 + i) }, PUB]);
  }
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const s = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: MEMBER, name: 'Thành Viên Thử' }) });
  cookie = (s.headers.get('set-cookie') || '').split(';')[0];
});

test.after(async () => {
  if (skip) return;
  await pool.query('delete from members where email = $1', [MEMBER]);
  await pool.query('delete from persons where id = any($1)', [created.persons]);
  await pool.query('delete from families where id = any($1)', [created.families]);
  await close(); await pool.end();
});

test('the outline of a public family is a plan with one total per person of the family', { skip }, async () => {
  const r = await call('/api/book/outline?family=' + PUB);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.plan.pages) && r.json.plan.pages.length >= 1);
  const { rows } = await pool.query('select count(*)::int n from persons where family_id = $1 and not deleted', [PUB]);
  assert.equal(rows[0].n, PUB_N, 'the family has the people this file inserted');
  assert.equal(r.json.plan.totals.people, PUB_N, 'counts must include everyone in the family');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('the outline of a private family is refused to guests and given to members', { skip }, async () => {
  const guest = await call(`/api/book/outline?family=${PRIV}`);
  assert.equal(guest.status, 403);
  const member = await call(`/api/book/outline?family=${PRIV}`, cookie);
  assert.equal(member.status, 200);
  assert.equal(member.json.plan.totals.people, 3);
});

test('a write changes the data version, so the next outline is rebuilt', { skip }, async () => {
  const before = await call(`/api/book/outline?family=${PRIV}`, cookie);
  await pool.query("update persons set data = jsonb_set(data, '{note}', '\"đã sửa\"'), version = nextval('persons_version') where id = $1", [created.persons[0]]);
  const after = await call(`/api/book/outline?family=${PRIV}`, cookie);
  assert.ok(after.json.v > before.json.v);
  assert.ok(after.json.v >= before.json.v + 1);
});

test('persons by ids: only those people, the same privacy as the family, bad ids refused', { skip }, async () => {
  const ok = await call(`/api/persons?family=${PRIV}&ids=${created.persons[0]},${created.persons[1]}`, cookie);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.items.map((x) => x.id).sort(), [created.persons[0], created.persons[1]].sort());
  const guest = await call(`/api/persons?family=${PRIV}&ids=${created.persons[0]}`);
  assert.equal(guest.status, 403);
  const bad = await call('/api/persons?family=duong&ids=P001,not-an-id!');
  assert.equal(bad.status, 400);
  const many = await call('/api/persons?family=duong&ids=' + Array.from({ length: 501 }, (_, i) => 'P' + String(i + 1).padStart(3, '0')).join(','));
  assert.equal(many.status, 400);
});

test('living people keep their contact details from guests on a public family', { skip }, async () => {
  const id = 'N' + crypto.randomUUID().slice(0, 13);
  created.persons.push(id);
  await pool.query("insert into persons (id, data, updated_by, family_id) values ($1, $2, 'test', 'duong')", [id, { name: 'Liên Hệ Thử ' + TAG, gen: 9, sex: 'f', phone: '0911222333', email: 'lienhe.' + TAG + '@example.test' }]);
  const guest = await call(`/api/persons?family=duong&ids=${id}`);
  assert.equal(guest.status, 200);
  assert.equal(guest.json.items[0].data.phone, undefined);
  assert.equal(guest.json.items[0].data.email, undefined);
  const outline = await call('/api/book/outline?family=duong');
  assert.ok(!JSON.stringify(outline.json).includes('0911222333'), 'a contact number leaked into the outline');
});

test('the outline takes scope params: root and dir narrow the plan; a bad root falls back to the whole family', { skip }, async () => {
  // this file's own family: the shared 'duong' family is empty on a fresh database (other files fill it)
  const { rows } = await pool.query("select id from persons where family_id = $1 and not deleted order by (data->>'gen')::int desc nulls last limit 1", [PUB]);
  const id = rows[0].id;
  const all = await call('/api/book/outline?family=' + PUB);
  assert.equal(all.json.plan.totals.scopePeople, PUB_N, 'the whole family');
  const up = await call(`/api/book/outline?family=${PUB}&root=${id}&dir=up`);
  assert.equal(up.status, 200);
  assert.equal(up.json.plan.scope, id);
  assert.ok(up.json.plan.totals.scopePeople < all.json.plan.totals.scopePeople, 'the ancestors are fewer than the family');
  const bad = await call(`/api/book/outline?family=${PUB}&root=not-an-id&dir=sideways`);
  assert.equal(bad.status, 200);
  assert.equal(bad.json.plan.scope, null);
  assert.equal(bad.json.plan.totals.scopePeople, all.json.plan.totals.scopePeople);
});

test('family emblem: no image is 404; a guest cannot change it (401); the outline says whether there is one', { skip }, async () => {
  const none = await call('/api/families/duong/emblem');
  assert.equal(none.status, 404);
  const anon = await fetch(base + '/api/families/duong/emblem', { method: 'PUT', headers: { 'content-type': 'image/png' }, body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  assert.equal(anon.status, 401);
  const out = await call('/api/book/outline?family=duong');
  assert.equal(out.json.emblem, false);
});

test('family emblem: an owner uploads and removes it; a member and a guest cannot; the wrong type is refused', { skip }, async () => {
  const EMB = 'test-emb-' + TAG; const OWNER = `owner.${TAG}@example.test`; const MEMB = `memb.${TAG}@example.test`;
  created.families.push(EMB);
  await pool.query("insert into families (id, slug, name, visibility) values ($1, $1, 'Dòng họ biểu tượng', 'private')", [EMB]);
  await pool.query("insert into members (family_id, email, name, role, status) values ($1, $2, 'Chủ Thử', 'owner', 'active'), ($1, $3, 'Thành Viên Thử', 'member', 'active')", [EMB, OWNER, MEMB]);
  const sess = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];
  const ownerCk = await sess(OWNER); const memberCk = await sess(MEMB);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('0000000d49484452', 'hex'), Buffer.alloc(40, 7)]);
  const put = (body, type, ck) => fetch(`${base}/api/families/${EMB}/emblem`, { method: 'PUT', headers: { 'content-type': type, ...(ck ? { cookie: ck } : {}) }, body });
  assert.equal((await put(PNG, 'image/png', memberCk)).status, 403, 'a member cannot change it');
  assert.equal((await put(PNG, 'image/png', '')).status, 401, 'a guest cannot change it');
  assert.equal((await put(PNG, 'text/plain', ownerCk)).status, 415, 'a text type is refused');
  assert.equal((await put(Buffer.from('not an image at all'), 'image/png', ownerCk)).status, 415, 'bytes that are not a PNG are refused');
  const ok = await put(PNG, 'image/png', ownerCk);
  assert.equal(ok.status, 200);
  const got = await fetch(`${base}/api/families/${EMB}/emblem`, { headers: { cookie: ownerCk } });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(PNG), 'the image comes back byte for byte');
  const fam = await fetch(`${base}/api/families/${EMB}`, { headers: { cookie: ownerCk } }).then((r) => r.json());
  assert.equal(fam.has_emblem, true, 'the family says it has an emblem');
  const del = await fetch(`${base}/api/families/${EMB}/emblem`, { method: 'DELETE', headers: { cookie: ownerCk } });
  assert.equal(del.status, 200);
  assert.equal((await fetch(`${base}/api/families/${EMB}/emblem`, { headers: { cookie: ownerCk } })).status, 404, 'removed');
  await pool.query('delete from members where family_id = $1', [EMB]);
});
