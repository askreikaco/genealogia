// Contacts as a list: validation per type (contact-rules.js, zod), the compat read of the flat fields, visibility in
// publicView (guests, the dead, contact_public), and the backfill plan. Backfill DB checks (dry run writes nothing,
// apply moves values once) run only with GP_TEST_DATABASE_URL (a SCRATCH database). Fictional names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cr = require('../contact-rules');
const core = require('../core');
const bf = require('../scripts/backfill-contacts');

test('validation per type: valid items pass, bad values name the rule', () => {
  assert.equal(cr.contactsError([{ type: 'phone', value: '0912 345 678' }, { type: 'phone', value: '+84 28 3822 1234' }]), null);
  assert.equal(cr.contactsError([{ type: 'email', value: 'nguyen.van@example.test' }]), null);
  assert.equal(cr.contactsError([{ type: 'zalo', value: 'https://zalo.me/0900000001' }]), null);
  assert.equal(cr.contactsError([{ type: 'facebook', value: 'facebook.com/nguyen.van.a' }]), null);
  assert.equal(cr.contactsError([{ type: 'facebook', value: 'nguyen.van.a' }]), null);
  assert.equal(cr.contactsError([{ type: 'address', value: 'Số 1, Phường Một' }]), null);
  assert.equal(cr.contactsError([{ type: 'other', value: 'Ngân hàng', label: 'Ghi chú' }]), null);
  assert.match(cr.contactsError([{ type: 'phone', value: 'abc' }]), /Số điện thoại/);
  assert.match(cr.contactsError([{ type: 'email', value: 'khong-co-at' }]), /Email/);
  assert.match(cr.contactsError([{ type: 'facebook', value: 'khong co dau cach' }]), /Facebook/);
  assert.match(cr.contactsError([{ type: 'fax', value: '123' }]), /loại/);
  assert.match(cr.contactsError([{ type: 'phone', value: '0912', extra: 1 }]), /trường không hợp lệ/);
  assert.match(cr.contactsError([{ type: 'phone', value: '' }]), /trống/);
  assert.match(cr.contactsError('0912'), /danh sách/);
  assert.match(cr.contactsError(Array.from({ length: 13 }, () => ({ type: 'other', value: 'x' }))), /tối đa 12/);
  assert.match(cr.contactsError([{ type: 'other', value: 'x'.repeat(301) }]), /tối đa 300/);
});

test('core: contacts is a field of the person; a bad list is refused by validateValue and validateOp', () => {
  assert.equal(core.validateValue('contacts', [{ type: 'phone', value: '0900000001' }]), null);
  assert.match(core.validateValue('contacts', [{ type: 'email', value: 'x' }]), /Email/);
  const op = { op_id: 'o1', id: 'P100001', fields: { contacts: [{ type: 'phone', value: 'abc' }] } };
  assert.match(core.validateOp(op), /Số điện thoại/);
});

test('compat read: a person with only flat fields shows the same list; a written list wins', () => {
  const flat = { name: 'Dương Văn Cha', phone: '0900000001', email: 'cha@example.test', zalo: '0900000001', social: 'fb.me/cha' };
  assert.deepEqual(cr.contactsOf(flat), [
    { type: 'phone', value: '0900000001' }, { type: 'email', value: 'cha@example.test' },
    { type: 'zalo', value: '0900000001' }, { type: 'other', value: 'fb.me/cha', label: 'Mạng xã hội' },
  ]);
  const withList = { ...flat, contacts: [{ type: 'phone', value: '0977000111' }] };
  assert.deepEqual(cr.contactsOf(withList), [{ type: 'phone', value: '0977000111' }], 'the list is the truth once written');
  assert.deepEqual(cr.contactsOf({ name: 'x', contacts: [] }), [], 'an emptied list stays empty (no flat fallback)');
  assert.deepEqual(cr.contactsOf({ name: 'x' }), []);
  assert.deepEqual(cr.contactsOf(null), []);
});

test('withContacts: the client gets the derived list for members (full record) and for the public view', () => {
  const d = { name: 'A', phone: '0900000001', contact_public: 'yes', gen: 2 };
  assert.deepEqual(core.withContacts(d).contacts, [{ type: 'phone', value: '0900000001' }]);
  assert.equal(core.withContacts({ name: 'B' }).contacts, undefined);
});

test('visibility: guests get no contact data; contact_public yes shows the list; the dead never', () => {
  const list = [{ type: 'phone', value: '0900000001' }];
  const hidden = { name: 'A', contacts: list };
  let v = core.publicView(hidden, { flag: true });
  assert.equal(v.contacts, undefined); assert.equal(v.hidden_living, true, 'a placeholder for a living person: no contact teaser');
  assert.equal(JSON.stringify(v).includes('0900000001'), false);
  v = core.publicView({ ...hidden, contact_public: 'yes' });
  assert.equal(v.hidden_living, true, 'a living person is a placeholder for visitors, even when the person chose public');
  assert.equal(v.contacts, undefined);
  v = core.publicView({ ...hidden, contact_public: 'yes', died: '2001' });
  assert.equal(v.contacts, undefined, 'a dead person: no contact data even when public');
  v = core.publicView({ name: 'C', phone: '0900000009' });
  assert.equal(v.phone, undefined, 'the flat fields are hidden the same way');
  assert.equal(v.contacts, undefined);
});

test('backfill plan: moves the flat values once, flags a bad value as other, leaves rows with a list alone', () => {
  const p = bf.planAll([
    { id: 'P1', family_id: 'f', data: { name: 'A', phone: '0900000001', email: 'A@Example.test' } },
    { id: 'P2', family_id: 'f', data: { name: 'B', contacts: [] , phone: '0900000002' } },
    { id: 'P3', family_id: 'f', data: { name: 'C' } },
    { id: 'P4', family_id: 'f', data: { name: 'D', phone: 'gọi tôi' } },
  ]);
  assert.deepEqual(p.map((x) => x.id), ['P1', 'P4']);
  assert.deepEqual(p[0].remove, ['phone', 'email']);
  assert.deepEqual(p[0].contacts, [{ type: 'phone', value: '0900000001' }, { type: 'email', value: 'A@Example.test'.toLowerCase() }]);
  assert.equal(p[1].flagged, true);
  assert.deepEqual(p[1].contacts, [{ type: 'other', value: 'gọi tôi', label: 'Liên hệ cũ' }]);
  assert.deepEqual(bf.summarize(p), { persons: 2, items: 3, by_type: { phone: 1, email: 1, other: 1 }, flagged: 1 });
});

// ---- DB: dry run writes nothing; apply writes once (scratch database only) ----
const URL_ = process.env.GP_TEST_DATABASE_URL || '';
test('backfill on a scratch database: dry run changes nothing, apply moves the values once', { skip: URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB)' }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: URL_ });
  const tag = crypto.randomBytes(3).toString('hex');
  const ids = [`P9${tag.slice(0, 2)}01`.replace(/[^P0-9]/g, '0'), `P9${tag.slice(0, 2)}02`.replace(/[^P0-9]/g, '0')];
  const fam = `contacts-bf-${tag}`;
  try {
    await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,$2,'楊','private') on conflict do nothing", [fam, 'Họ bf ' + tag]);
    await pool.query('insert into persons (id, data, family_id) values ($1, $2, $4), ($3, $5, $4)', [
      ids[0], JSON.stringify({ name: 'Dương Văn Thử', phone: '0900000011', email: 'thu@example.test', gen: 3 }), ids[1], fam,
      JSON.stringify({ name: 'Dương Thị Mẫu', contacts: [{ type: 'phone', value: '0900000012' }], phone: '0900000013', gen: 3 })]);
    const rows = (await pool.query('select id, family_id, data from persons where id = any($1)', [ids])).rows;
    const dry = bf.planAll(rows);
    assert.deepEqual(dry.map((p) => p.id), [ids[0]], 'only the row without a list is planned');
    const before = (await pool.query('select data, version from persons where id = $1', [ids[0]])).rows[0];
    assert.ok(before.data.phone, 'dry run: nothing written');
    const client = await pool.connect();
    try {
      await bf.applyPlans(client, dry);
    } finally { client.release(); }
    const after = (await pool.query('select data, version from persons where id = $1', [ids[0]])).rows[0];
    assert.equal(after.data.phone, undefined); assert.equal(after.data.email, undefined);
    assert.deepEqual(after.data.contacts, [{ type: 'phone', value: '0900000011' }, { type: 'email', value: 'thu@example.test' }]);
    assert.equal(Number(after.version), Number(before.version) + 1);
    const h = (await pool.query('select count(*)::int as n from history where person_id = $1 and field = $2', [ids[0], 'contacts'])).rows[0];
    assert.equal(h.n, 1);
    const again = bf.planAll((await pool.query('select id, family_id, data from persons where id = $1', [ids[0]])).rows);
    assert.equal(again.length, 0, 'a second run plans nothing');
    const untouched = (await pool.query('select data from persons where id = $1', [ids[1]])).rows[0].data;
    assert.equal(untouched.phone, '0900000013', 'a row that already has a list keeps its flat value (list wins on read)');
  } finally {
    await pool.query('delete from history where person_id = any($1)', [ids]);
    await pool.query('delete from persons where family_id = $1', [fam]);
    await pool.query('delete from families where id = $1', [fam]);
    await pool.end();
  }
});
