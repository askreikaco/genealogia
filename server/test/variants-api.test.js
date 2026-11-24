// Conflicting data API on a scratch database: an editor adds a second value (the profile value is kept as the first,
// shown one); the list; choosing writes the person field with history; the shown value cannot be removed; guests see
// a deceased person's list without recorders and nothing for a living person; guests cannot write. Invented names.
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
const FAM = `var-${TAG}`;
const ED = `ed.${TAG}@example.test`; const MEM = `mem.${TAG}@example.test`;
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
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ Thử Nguồn','試','public')", [FAM]);
  Object.assign(P, { old: nid(), young: nid() });
  const ins = (id, data) => pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3)", [id, data, FAM]);
  await ins(P.old, { name: 'Thử Văn Cụ', sex: 'm', born: '1931', died: '1988', burial: 'Làng Bến Xưa' });
  await ins(P.young, { name: 'Thử Thị Nhỏ', sex: 'f', born: '1990' });
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,'e','editor','active',$3), ($2,'m','member','active',$3)", [ED, MEM, FAM]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.ed = await session(ED); ck.mem = await session(MEM);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from field_variants where family_id=$1', [FAM]);
  await pool.query('delete from members where family_id=$1', [FAM]);
  await pool.query('delete from history where person_id = any($1)', [Object.values(P)]);
  await pool.query('delete from ops where person_id = any($1)', [Object.values(P)]);
  await pool.query('delete from persons where id = any($1)', [Object.values(P)]);
  await pool.query('delete from families where id=$1', [FAM]);
  await close(); await pool.end();
});

test('editor adds a second birth year: the profile value is kept as the shown one; count 2; duplicate refused', { skip }, async () => {
  const r = await call('POST', `/api/persons/${P.old}/variants?family=${FAM}`, { family: FAM, field: 'born', value: '1932', source: 'Gia phả chữ Hán, trang 14', quality: 'binh_thuong' }, ck.ed);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const l = await call('GET', `/api/persons/${P.old}/variants?family=${FAM}`, undefined, ck.ed);
  const b = l.json.fields.born;
  assert.equal(b.count, 2); assert.equal(l.json.can_edit, true);
  assert.deepEqual(b.items.map((x) => [x.value, x.chosen]), [['1931', true], ['1932', false]]);
  assert.equal(b.items[0].source, 'Dữ liệu đang có trong hồ sơ');
  assert.ok(b.items[1].by);
  const dup = await call('POST', `/api/persons/${P.old}/variants?family=${FAM}`, { family: FAM, field: 'born', value: ' 1932 ', source: 'x' }, ck.ed);
  assert.equal(dup.status, 409);
  const bad = await call('POST', `/api/persons/${P.old}/variants?family=${FAM}`, { family: FAM, field: 'born', value: '1933', source: '' }, ck.ed);
  assert.equal(bad.status, 400);
});

test('choose writes the person field through the op (history row); the shown value cannot be removed; another can', { skip }, async () => {
  const l = await call('GET', `/api/persons/${P.old}/variants?family=${FAM}`, undefined, ck.ed);
  const v1932 = l.json.fields.born.items.find((x) => x.value === '1932');
  const c = await call('POST', `/api/variants/${v1932.id}/choose?family=${FAM}`, { family: FAM }, ck.ed);
  assert.equal(c.status, 200, JSON.stringify(c.json)); assert.equal(c.json.changed, true);
  const p = await pool.query('select data from persons where id=$1', [P.old]);
  assert.equal(p.rows[0].data.born, '1932');
  const h = await pool.query("select count(*)::int n from history where person_id=$1 and field='born'", [P.old]);
  assert.equal(h.rows[0].n, 1);
  const chosen = await pool.query('select value from field_variants where person_id=$1 and chosen', [P.old]);
  assert.deepEqual(chosen.rows.map((r) => r.value), ['1932']);
  const shownDel = await call('DELETE', `/api/variants/${v1932.id}?family=${FAM}`, undefined, ck.ed);
  assert.equal(shownDel.status, 409);
  const other = l.json.fields.born.items.find((x) => x.value === '1931');
  assert.equal((await call('DELETE', `/api/variants/${other.id}?family=${FAM}`, undefined, ck.ed)).status, 200);
});

test('guests: a deceased person list without recorders; a living person nothing; writes refused (401/403)', { skip }, async () => {
  await call('POST', `/api/persons/${P.old}/variants?family=${FAM}`, { family: FAM, field: 'burial', value: 'Nghĩa trang Đồi Thử', source: 'Lời kể' }, ck.ed);
  await call('POST', `/api/persons/${P.young}/variants?family=${FAM}`, { family: FAM, field: 'born', value: '1991', source: 'Giấy khai sinh' }, ck.ed);
  const g = await call('GET', `/api/persons/${P.old}/variants?family=${FAM}`);
  assert.equal(g.status, 200); assert.equal(g.json.can_edit, false);
  assert.equal(g.json.fields.burial.count, 2);
  assert.ok(Object.values(g.json.fields).every((f) => f.items.every((x) => x.by === '')), 'no recorder for guests');
  const gy = await call('GET', `/api/persons/${P.young}/variants?family=${FAM}`);
  assert.deepEqual(gy.json.fields, {}); assert.equal(gy.json.hidden, true);
  const my = await call('GET', `/api/persons/${P.young}/variants?family=${FAM}`, undefined, ck.mem);
  assert.equal(my.json.fields.born.count, 2, 'members see a living person');
  assert.equal((await call('POST', `/api/persons/${P.old}/variants?family=${FAM}`, { family: FAM, field: 'born', value: '1930', source: 'x' })).status, 401);
  assert.equal((await call('POST', `/api/persons/${P.old}/variants?family=${FAM}`, { family: FAM, field: 'born', value: '1930', source: 'x' }, ck.mem)).status, 403);
  const hist = await call('GET', `/api/history/${P.old}`);
  assert.ok(!hist.json.some((r) => r.field === 'nguon_khac'), 'variant history is members-only');
});
