// "Cần bổ sung thông tin" and the editor review (consistency-routes.js) on a scratch database: the needs list is for
// members (guest and outsider get 403), the review rules reach editors only, an editor ignores a review item, and the
// GEDCOM export carries no estimate. Needs GP_TEST_DATABASE_URL (scratch DB). Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FN = `cnd-${TAG}`;
const OWNER = `owner.${TAG}@example.test`; const ED = `ed.${TAG}@example.test`; const MEM = `mem.${TAG}@example.test`; const OUT = `out.${TAG}@example.test`;
const REVIEW = ['year_conflict', 'possible_duplicate', 'missing_sex', 'verify_note'];
const id = (s) => `N${s}${TAG}`; // person ids: letters and digits only
const ID = { G1: id('G1'), K1: id('K1'), W1: id('W1'), D1: id('D1'), MO: id('MO'), CH: id('CH'), DU1: id('DU1'), DU2: id('DU2') };
let base, pool, close; const ck = {};

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Ho thu can bo sung','public')", [FN]);
  const ins = (key, data) => pool.query('insert into persons (id, data, updated_by, family_id) values ($1,$2,$3,$4)', [ID[key], data, 'test', FN]);
  await ins('G1', { name: 'Test Gốc', sex: 'm', born: '1850', gen: 1 });
  await ins('K1', { name: 'Test Kế', sex: 'm', parent: ID.G1, gen: 2, verify: 'Cần ghi năm sinh' });
  await ins('W1', { name: 'Test Lạc', sex: '' });
  await ins('D1', { name: 'Test Mất', sex: 'm', parent: ID.G1, gen: 2, died: '1930' });
  await ins('MO', { name: 'Test Mẹ', sex: 'f', born: '1950', gen: 1 });
  await ins('CH', { name: 'Test Con', sex: 'm', born: '1900', parent: ID.MO, gen: 2 });
  await ins('DU1', { name: 'Trần Du', sex: 'm', parent: ID.G1, gen: 2 });
  await ins('DU2', { name: 'TRAN  du', sex: 'm', parent: ID.G1, gen: 2 });
  await pool.query(`insert into members (email, name, role, status, family_id) values ($1,'o','owner','active',$4), ($2,'e','editor','active',$4), ($3,'m','member','active',$4)`, [OWNER, ED, MEM, FN]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.ed = await session(ED); ck.mem = await session(MEM); ck.out = await session(OUT);
});
test.after(async () => { if (skip) return; await close?.(); await pool?.end().catch(() => {}); });

test('needs: a guest and an outsider get 403; a member gets the list with the estimates, not the people with a birth year', { skip }, async () => {
  assert.strictEqual((await call('GET', `/api/trees/${FN}/needs`)).status, 403);
  assert.strictEqual((await call('GET', `/api/trees/${FN}/needs`, undefined, ck.out)).status, 403);
  const r = await call('GET', `/api/trees/${FN}/needs`, undefined, ck.mem);
  assert.strictEqual(r.status, 200);
  const byId = new Map(r.json.rows.map((x) => [x.id, x]));
  assert.ok(!byId.has(ID.G1) && !byId.has(ID.MO) && !byId.has(ID.CH), 'people with a birth year are not listed');
  assert.deepStrictEqual(byId.get(ID.K1).need, ['born']);
  assert.strictEqual(byId.get(ID.K1).est.kind, 'born');
  assert.ok(byId.get(ID.K1).est.hi - byId.get(ID.K1).est.lo <= 60);
  assert.strictEqual(byId.get(ID.W1).est, null, 'no estimate for an open range');
  assert.deepStrictEqual(byId.get(ID.D1).need, ['born'], 'a death year is known, so only the birth is missing');
});

test('review rules: a member does not get them; an editor gets the year conflict with its basis, the duplicate, the missing sex and the verify note', { skip }, async () => {
  const m = await call('GET', `/api/trees/${FN}/consistency`, undefined, ck.mem);
  assert.strictEqual(m.status, 200);
  assert.ok(!m.json.issues.some((i) => REVIEW.includes(i.rule)), 'no review item for a member');
  const e = await call('GET', `/api/trees/${FN}/consistency`, undefined, ck.ed);
  const has = (rule) => e.json.issues.find((i) => i.rule === rule);
  const conflict = has('year_conflict');
  assert.ok(conflict && conflict.personIds[0] === ID.MO, 'the mother with the conflicting birth year');
  assert.ok(conflict.detail && conflict.detail.length, 'the basis is sent with the conflict');
  const dup = has('possible_duplicate');
  assert.ok(dup && dup.personIds.includes(ID.DU1) && dup.personIds.includes(ID.DU2), 'same name (accent and case free) under one parent');
  assert.ok(e.json.issues.some((i) => i.rule === 'missing_sex' && i.personIds[0] === ID.W1));
  const v = has('verify_note');
  assert.ok(v && v.personIds[0] === ID.K1 && v.detail[0] === 'Cần ghi năm sinh');
  assert.ok(!e.json.issues.some((i) => i.rule === 'missing_sex' && i.personIds[0] === ID.K1));
});

test('ignore: a member cannot hide a review item, an editor can, and it moves to ignored', { skip }, async () => {
  const body = { rule: 'possible_duplicate', person_ids: [ID.DU1, ID.DU2] };
  assert.strictEqual((await call('POST', `/api/trees/${FN}/consistency/ignore`, body, ck.mem)).status, 403);
  assert.strictEqual((await call('POST', `/api/trees/${FN}/consistency/ignore`, body, ck.ed)).status, 200);
  const a = await call('GET', `/api/trees/${FN}/consistency`, undefined, ck.ed);
  assert.ok(!a.json.issues.some((i) => i.rule === 'possible_duplicate'));
  assert.ok(a.json.ignored.some((i) => i.rule === 'possible_duplicate'));
  assert.strictEqual((await call('DELETE', `/api/trees/${FN}/consistency/ignore`, body, ck.ed)).status, 200);
});

test('GEDCOM export carries no estimate: no approximate sign, no "ước tính", and the unknown birth has no BIRT', { skip }, async () => {
  const r = await call('GET', `/api/gedcom?family=${FN}`, undefined, ck.mem);
  assert.strictEqual(r.status, 200);
  assert.ok(!/≈|ước tính/.test(r.text), 'no estimate text in the export');
  const block = r.text.split(/\n(?=0 @)/).find((b) => b.includes('Kế'));
  assert.ok(block && !/\n1 BIRT/.test(block), 'the person without a birth year has no BIRT');
});
