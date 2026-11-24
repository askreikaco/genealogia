// A family created from the app ("Lập gia phả", POST /api/families) uses the relation tables from day 1:
// it gets a relation_migrations row, so adding a relation works at once. Needs GP_TEST_DATABASE_URL (scratch DB).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const EMAIL = `maker.${TAG}@example.test`;
let base, pool, close; let fam = null;

const call = async (method, p, body, cookie) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {} return { status: r.status, json };
};

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
});
test.after(async () => {
  if (skip) return;
  if (fam) {
    await pool.query('delete from parent_child where family_id=$1', [fam]);
    await pool.query("delete from history where person_id in (select id from persons where family_id=$1)", [fam]);
    await pool.query('delete from persons where family_id=$1', [fam]);
    await pool.query('delete from relation_migrations where family_id=$1', [fam]);
    await pool.query('delete from members where family_id=$1', [fam]);
    await pool.query('delete from families where id=$1', [fam]);
  }
  await close(); await pool.end();
});

test('new family: relation_migrations row, and a parent-child relation can be added at once', { skip }, async () => {
  const r0 = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, name: EMAIL, google: true }) });
  const cookie = r0.headers.get('set-cookie').split(';')[0];
  const r = await call('POST', '/api/families', { name: `Họ Thử ${TAG}`, han: '試', first_person: { name: `Ông Tổ ${TAG}`, sex: 'm' } }, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  fam = r.json.family.id;
  const m = await pool.query('select count(*)::int n from relation_migrations where family_id=$1', [fam]);
  assert.equal(m.rows[0].n, 1, 'table mode from day 1');
  const root = (await pool.query('select id from persons where family_id=$1', [fam])).rows[0].id;
  const kid = 'N' + crypto.randomUUID().slice(0, 13);
  await pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3)", [kid, { name: `Con ${TAG}`, sex: 'm' }, fam]);
  const rel = await call('POST', `/api/relations?family=${fam}`, { op_id: 'op-' + TAG, action: 'add', kind: 'parent_child', parent_id: root, child_id: kid }, cookie);
  assert.equal(rel.status, 200, JSON.stringify(rel.json));
});
