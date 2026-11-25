// API tests for contact import against a SCRATCH database (GP_TEST_DATABASE_URL, skipped otherwise).
// Parsing and matching run in the browser (web/js/contacts-parse.js, unit tests in contacts-import.test.js), so the server
// has no import endpoint. The save path the client uses (POST /api/ops, editors) leaves a history entry per field.
// Google sign-in is simulated with POST /api/test/session (NODE_ENV=test).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `contacts-${TAG}`;
const FAM_OTHER = `contacts-o-${TAG}`;
const mail = (w) => `${w}.${TAG}@example.test`;
const EM = { editor: mail('editor'), member: mail('member'), other: mail('other') };
const PID_BASE = 100000 + (parseInt(TAG, 16) % 800000); // person ids are P + digits (core.js validateOp)
const PID = { cha: 'P' + PID_BASE, khong: 'P' + (PID_BASE + 1) };
const SECRET = crypto.randomBytes(24).toString('hex');
let base, pool, close, cookieEditor, cookieMember, cookieOther;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const cookieFrom = (r) => {
  const all = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const gp = all.find((c) => c && c.startsWith('gp_s=') && !/Max-Age=0/.test(c));
  return gp ? gp.split(';')[0] : null;
};
async function signIn(email, name) {
  const r = await call('POST', '/api/test/session', { email, name });
  assert.equal(r.status, 200, r.text);
  return cookieFrom(r);
}
const VCF = 'BEGIN:VCARD\nVERSION:3.0\nFN:Dương Văn Không\nTEL:0912 345 678\nEMAIL:Khong@Example.test\nEND:VCARD\n'
  + 'BEGIN:VCARD\nVERSION:3.0\nFN:Dương Văn Cha\nTEL:0900000001\nEND:VCARD\n';

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = SECRET;
  process.env.EDITORS = ''; delete process.env.BREVO_API_KEY;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,$2,'楊','private'), ($3,$3,$4,'楊','private')", [FAM, 'Họ thử ' + TAG, FAM_OTHER, 'Họ khác ' + TAG]);
  const addM = (email, role, fam = FAM) => pool.query(
    "insert into members (email, name, role, status, family_id) values ($1,$2,$3,'active',$4)", [email, email.split('.')[0], role, fam]);
  await addM(EM.editor, 'editor');
  await addM(EM.member, 'member');
  await addM(EM.other, 'editor', FAM_OTHER);
  await pool.query('insert into persons (id, data, family_id) values ($1, $2, $3), ($4, $5, $3)', [
    PID.cha, JSON.stringify({ name: 'Dương Văn Cha', gen: 6, born: '1960' }), FAM,
    PID.khong, JSON.stringify({ name: 'Dương Văn Không', gen: 6, born: '1965' }),
  ]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  cookieEditor = await signIn(EM.editor, 'Biên tập');
  cookieMember = await signIn(EM.member, 'Thành viên');
  cookieOther = await signIn(EM.other, 'Họ khác');
});

test.after(async () => {
  if (skip) return;
  await pool.query('delete from history where person_id = any($1)', [[PID.cha, PID.khong]]);
  await pool.query('delete from ops where person_id = any($1)', [[PID.cha, PID.khong]]);
  await pool.query('delete from persons where family_id = any($1)', [[FAM, FAM_OTHER]]);
  await pool.query('delete from members where family_id = any($1)', [[FAM, FAM_OTHER]]);
  await pool.query('delete from families where id = any($1)', [[FAM, FAM_OTHER]]);
  await close?.(); await pool?.end().catch(() => {});
});

test('no server-side import: POST /api/contacts/match is gone (the phone book stays on the device)', { skip }, async () => {
  const r = await call('POST', `/api/contacts/match?family=${FAM}`, { text: VCF, filename: 'contacts.vcf' }, cookieEditor);
  assert.equal(r.status, 404, r.text);
});

test('save path: the confirmed field goes through /api/ops and leaves a history entry (who, what)', { skip }, async () => {
  const op = { op_id: 'contacts-' + TAG, id: PID.khong, fields: { phone: '0912345678', email: 'khong@example.test' }, ts: Date.now() };
  const r = await call('POST', `/api/ops?family=${FAM}`, { ops: [op] }, cookieEditor);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.applied, [op.op_id]);
  const h = await pool.query('select field, new_value, by_user from history where person_id = $1 order by field', [PID.khong]);
  assert.deepEqual(h.rows.map((x) => x.field), ['email', 'phone']);
  assert.equal(h.rows[1].new_value, '0912345678');
  const { rows } = await pool.query('select data->>\'contact_public\' as cp from persons where id = $1', [PID.khong]);
  assert.equal(rows[0].cp, null, 'contact visibility is not changed by an import (private by default)');
});

test('list save: a valid list goes through /api/ops as one field; a bad item is rejected; members see the list, guests the teaser', { skip }, async () => {
  const list = [{ type: 'phone', value: '0977 000 111' }, { type: 'email', value: 'cha@example.test' }];
  const op = { op_id: 'contacts-list-' + TAG, id: PID.cha, fields: { contacts: list }, ts: Date.now() };
  const r = await call('POST', `/api/ops?family=${FAM}`, { ops: [op] }, cookieEditor);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.applied, [op.op_id]);
  const bad = { op_id: 'contacts-bad-' + TAG, id: PID.cha, fields: { contacts: [{ type: 'phone', value: 'abc' }] }, ts: Date.now() };
  const rb = await call('POST', `/api/ops?family=${FAM}`, { ops: [bad] }, cookieEditor);
  assert.equal(rb.status, 200, rb.text);
  assert.deepEqual(rb.json.applied, []);
  assert.match(rb.json.rejected[0].reason, /Số điện thoại/);
  const h = await pool.query('select new_value from history where person_id = $1 and field = $2 order by at desc limit 1', [PID.cha, 'contacts']);
  assert.deepEqual(h.rows[0].new_value, list, 'the history keeps the list');
  const m = await call('GET', `/api/persons?family=${FAM}&since=0`, undefined, cookieMember);
  const asMember = m.json.items.find((x) => x.id === PID.cha).data;
  assert.deepEqual(asMember.contacts, list, 'a member gets the list');
  // a guest reads a public family only: the family is public for this check, then private again
  await pool.query("update families set visibility = 'public' where id = $1", [FAM]);
  let g;
  try { g = await call('GET', `/api/persons?family=${FAM}&since=0`); }
  finally { await pool.query("update families set visibility = 'private' where id = $1", [FAM]); }
  assert.ok(g.json && g.json.items, g.status + ' ' + g.text.slice(0, 200));
  const asGuest = g.json.items.find((x) => x.id === PID.cha).data;
  assert.equal(asGuest.contacts, undefined, 'a guest gets no contact values');
  assert.equal(asGuest.hidden_living, true, 'a living person is a placeholder for a guest (no teaser)');
  assert.equal(asGuest.has_contact, undefined);
  assert.equal(JSON.stringify(g.json).includes('0977 000 111'), false);
});
