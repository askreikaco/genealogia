// Clan view API on a scratch database: public trees for everyone, a private tree only as a count for a guest and for
// a member of another family, named for its own member; links group trees; living founders hidden from non-members;
// 50 entries a page. Invented names only. Needs GP_TEST_DATABASE_URL (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const SUR = `Khê${TAG}`; const SLUG = `khe${TAG}`; // a surname no other test uses
const SUR2 = `Ngàn${TAG}`; const SLUG2 = `ngan${TAG}`;
const F = { a: `cla-${TAG}`, b: `clb-${TAG}`, c: `clc-${TAG}`, p: `clp-${TAG}`, x: `clx-${TAG}` };
const MEMBER_P = `mp.${TAG}@example.test`; const MEMBER_X = `mx.${TAG}@example.test`;
let base, pool, close; const ck = {}; const P = []; const pageFams = [];
const nid = () => 'N' + crypto.randomUUID().slice(0, 13);

async function get(p, cookie) {
  const r = await fetch(base + p, { headers: cookie ? { cookie } : {} });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const fam = (id, name, vis) => pool.query('insert into families (id, slug, name, visibility) values ($1,$1,$2,$3)', [id, name, vis]);
  await fam(F.a, `Họ ${SUR} Bến`, 'public'); await fam(F.b, `Họ ${SUR} Sông`, 'public'); await fam(F.c, `Họ ${SUR} Gò`, 'public');
  await fam(F.p, `Họ ${SUR} Kín`, 'private'); await fam(F.x, 'Họ Khác Thử', 'public');
  const ins = async (fam, data) => { const id = nid(); P.push(id); await pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3)", [id, data, fam]); return id; };
  const a1 = await ins(F.a, { name: `${SUR} Văn Cụ`, gen: 1, born: '1820', died: '1890' });
  const a2 = await ins(F.a, { name: `${SUR} Thị Chung`, gen: 3, born: '1900', died: '1970' });
  await ins(F.b, { name: `${SUR} Văn Tổ`, gen: 1, born: '1760', died: '1830' });
  const b2 = await ins(F.b, { name: `${SUR} Thị Chung`, gen: 4, born: '1900', died: '1970' });
  await ins(F.c, { name: `${SUR} Văn Sống`, gen: 1, born: '1950' }); // living founder
  const p1 = await ins(F.p, { name: `${SUR} Văn Kín`, gen: 1, born: '1700', died: '1760' });
  const p2 = await ins(F.p, { name: `${SUR} Thị Chung`, gen: 2, born: '1900', died: '1970' });
  void a1; void p1;
  await pool.query("insert into person_links (a_family, a_person, b_family, b_person, status) values ($1,$2,$3,$4,'accepted'), ($1,$2,$5,$6,'accepted')", [F.a, a2, F.b, b2, F.p, p2]);
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,'m','member','active',$2), ($3,'x','member','active',$4)", [MEMBER_P, F.p, MEMBER_X, F.x]);
  // paging: 52 unlinked public trees of a second surname
  for (let i = 0; i < 52; i++) { const id = `cln-${TAG}-${i}`; pageFams.push(id); await fam(id, `Họ ${SUR2} ${String(i).padStart(2, '0')}`, 'public'); }
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.p = await session(MEMBER_P); ck.x = await session(MEMBER_X);
});
test.after(async () => {
  if (skip) return;
  const fams = [...Object.values(F), ...pageFams];
  await pool.query('delete from person_links where a_family = any($1) or b_family = any($1)', [fams]);
  await pool.query('delete from members where family_id = any($1)', [fams]);
  await pool.query('delete from persons where id = any($1)', [P]);
  await pool.query('delete from families where id = any($1)', [fams]);
  await close(); await pool.end();
});

test('guest: public trees grouped by links, oldest founder first; private tree only counted; living founder hidden', { skip }, async () => {
  const r = await get(`/api/clans/${SLUG}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const j = r.json;
  assert.equal(j.surname, SUR);
  assert.equal(j.private_count, 1);
  assert.deepEqual(j.groups.map((g) => g.trees.map((t) => t.id)), [[F.b, F.a]], 'b (1760) before a (1820)');
  assert.equal(j.groups[0].trees[0].shared, 1); assert.equal(j.groups[0].trees[1].shared, 1, 'the link to the private tree is not counted');
  assert.deepEqual(j.unlinked.map((t) => t.id), [F.c]);
  assert.equal(j.unlinked[0].founder, null, 'living founder not shown to a guest'); assert.equal(j.unlinked[0].year, null);
  assert.equal(j.groups[0].trees[0].founder.name, `${SUR} Văn Tổ`); assert.equal(j.groups[0].trees[0].founder.born, 1760);
  assert.deepEqual(j.kpis, { groups: 1, trees: 3, people: 5 });
  assert.ok(!JSON.stringify(j).includes('Kín'), 'nothing of the private tree by name');
  assert.ok(!JSON.stringify(j).includes(F.x), 'other surnames are not listed');
});

test('member of another family = guest view; member of the private tree sees it and its link', { skip }, async () => {
  const x = (await get(`/api/clans/${SLUG}`, ck.x)).json;
  assert.equal(x.private_count, 1); assert.ok(!JSON.stringify(x).includes(F.p));
  const m = (await get(`/api/clans/${SLUG}`, ck.p)).json;
  assert.equal(m.private_count, 0);
  assert.deepEqual(m.groups.map((g) => g.trees.map((t) => t.id)), [[F.p, F.b, F.a]], 'private tree (1700) joins the group, oldest first');
  assert.equal(m.groups[0].trees.find((t) => t.id === F.a).shared, 2);
});

test('paging: 50 entries a page; bad slug 400; unknown surname 404', { skip }, async () => {
  const p1 = (await get(`/api/clans/${SLUG2}`)).json;
  assert.equal(p1.total, 52); assert.equal(p1.pages, 2); assert.equal(p1.unlinked.length, 50); assert.equal(p1.page, 1);
  const p2 = (await get(`/api/clans/${SLUG2}?page=2`)).json;
  assert.equal(p2.unlinked.length, 2); assert.equal(p2.page, 2);
  assert.ok(!p2.unlinked.some((t) => p1.unlinked.some((u) => u.id === t.id)), 'no tree on both pages');
  assert.equal((await get('/api/clans/BAD%20SLUG')).status, 400);
  assert.equal((await get(`/api/clans/khong-co-${TAG}`)).status, 404);
});
