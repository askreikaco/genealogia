// GEDCOM API tests: export (members and above, living=hide), import (admins only): dry run writes nothing; apply
// writes new people and empty fields with history, sends a different value to the review queue, adds missing events and
// relations, and a second apply adds nothing. Needs a SCRATCH database (GP_TEST_DATABASE_URL); skipped otherwise.
'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `gedcom-${TAG}`;
const CODE = 'gx-code-' + crypto.randomBytes(4).toString('hex');
const MEMBER = `gx.member.${TAG}@example.test`;
const OUTSIDER = `gx.outsider.${TAG}@example.test`;
const A = `P${TAG}a`.replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase().replace(/^P?/, 'P');
const B = 'P' + TAG.toUpperCase().slice(0, 4) + '2';
const C = 'P' + TAG.toUpperCase().slice(0, 4) + '3';
let base, pool, close, editorCookie, memberCookie, outsiderCookie;

async function call(method, p, body, cookie, raw) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const GEDCOM_IN = (name, born) => ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
  `0 @${A}@ INDI`, '1 NAME /Nguyễn/ Văn Ất', '1 SEX M', '1 BIRT', `2 DATE ${born}`, '2 PLAC Hà Tĩnh',
  `0 @NEW1@ INDI`, `1 NAME ${name}`, '1 SEX F', '1 BIRT', '2 DATE 1985', '2 PLAC Huế', '1 EDUC Trường Đại học Huế', '2 DATE 2003',
  `0 @${A}@ FAM`.replace(/.*/, '0 @F1@ FAM'), `1 HUSB @${A}@`, '1 WIFE @NEW1@', '1 _KIND cuoi', '1 MARR', '2 DATE 2005', '0 TRLR'].join('\n');

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `Tester:${crypto.createHash('sha256').update(CODE).digest('hex')}`;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Họ thử gedcom','public')", [FAM]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4), ($5,$2,$6,$4), ($7,$2,$8,$4)', [
    A, FAM, { name: 'Nguyễn Văn Ất', sex: 'm', born: '1950', birth_place: 'Hà Tĩnh' }, 'test',
    B, { name: 'Trần Thị Bảy', sex: 'f', born: '1952', living: 'living', contact_public: 'no', phone: '0988000111' },
    C, { name: 'Lê Thị Chín', sex: 'f', born: '1900', died: '1970' }]);
  await pool.query("insert into relation_migrations (family_id, counts) values ($1, '{}')", [FAM]);
  await pool.query("insert into parent_child (family_id, parent_id, child_id, kind) values ($1, $2, $3, 'ruot')", [FAM, C, A]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  const login = await call('POST', '/api/login', { code: CODE });
  editorCookie = login.headers.get('set-cookie').split(';')[0];
  memberCookie = (await call('POST', '/api/test/session', { email: MEMBER, name: 'Thành viên gx' })).headers.get('set-cookie').split(';')[0];
  outsiderCookie = (await call('POST', '/api/test/session', { email: OUTSIDER, name: 'Người ngoài' })).headers.get('set-cookie').split(';')[0];
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thành viên gx',$2,'member','active')", [MEMBER, FAM]);
});
test.after(async () => {
  if (skip || !pool) return;
  if (close) await close();
  await pool.query('delete from suggestions where family_id=$1', [FAM]);
  await pool.query('delete from events where family_id=$1', [FAM]);
  await pool.query('delete from parent_child where family_id=$1', [FAM]);
  await pool.query('delete from stories where family_id=$1', [FAM]);
  await pool.query('delete from couple where family_id=$1', [FAM]);
  await pool.query('delete from relation_migrations where family_id=$1', [FAM]);
  await pool.query('delete from history where person_id in (select id from persons where family_id=$1)', [FAM]);
  await pool.query('delete from ops where person_id in (select id from persons where family_id=$1)', [FAM]);
  await pool.query('delete from members where family_id=$1', [FAM]);
  await pool.query('delete from persons where family_id=$1', [FAM]);
  await pool.query('delete from families where id=$1', [FAM]);
  await pool.end().catch(() => {});
});

test('export: guests are asked to sign in, signed-in non-members are refused, members get the file', { skip }, async () => {
  const guest = await call('GET', `/api/gedcom?family=${FAM}`);
  assert.strictEqual(guest.status, 401);
  const out = await call('GET', `/api/gedcom?family=${FAM}`, undefined, outsiderCookie);
  assert.strictEqual(out.status, 403);
  const m = await call('GET', `/api/gedcom?family=${FAM}`, undefined, memberCookie);
  assert.strictEqual(m.status, 200);
  assert.ok(m.headers.get('content-type').startsWith('text/plain; charset=utf-8'));
  assert.ok(m.headers.get('content-disposition').includes(`${FAM}.ged`));
  assert.ok(m.text.includes('1 CHAR UTF-8') && m.text.includes(`0 @${A}@ INDI`) && m.text.includes('0 @F1@ FAM'));
  assert.ok(m.text.includes('1 FAMC @F1@') || m.text.includes('1 FAMS @F1@'), 'the parent-child row is exported');
  assert.ok(!m.text.includes('0988000111'), 'a living person with contact_public no: no phone');
});

test('export: living=hide leaves out living people and their relations', { skip }, async () => {
  const r = await call('GET', `/api/gedcom?family=${FAM}&living=hide`, undefined, editorCookie);
  assert.strictEqual(r.status, 200);
  assert.ok(!r.text.includes(`0 @${B}@ INDI`));
  assert.ok(r.text.includes(`0 @${C}@ INDI`));
});

test('import: only owners and admins; guests sign in, members and outsiders are refused', { skip }, async () => {
  const body = { family: FAM, content: GEDCOM_IN('Phạm Thị Mười', '1951'), dry_run: true };
  assert.strictEqual((await call('POST', '/api/gedcom/import', body)).status, 401);
  assert.strictEqual((await call('POST', '/api/gedcom/import', body, memberCookie)).status, 403);
  assert.strictEqual((await call('POST', '/api/gedcom/import', body, outsiderCookie)).status, 403);
});

test('import: dry run returns the plan and writes nothing', { skip }, async () => {
  const before = (await pool.query('select count(*)::int n from persons where family_id=$1', [FAM])).rows[0].n;
  const r = await call('POST', '/api/gedcom/import', { family: FAM, content: GEDCOM_IN('Phạm Thị Mười', '1951'), dry_run: true }, editorCookie);
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.json.dry_run, true);
  assert.strictEqual(r.json.relation_mode, 'table');
  assert.strictEqual(r.json.counts.new, 1);
  assert.strictEqual(r.json.counts.conflicts, 1, 'the born year 1951 differs from 1950 for the existing person');
  assert.strictEqual(r.json.counts.matched, 0);
  assert.ok(r.json.items.some((i) => i.action === 'conflict' && i.name === 'Nguyễn Văn Ất'));
  const after = (await pool.query('select count(*)::int n from persons where family_id=$1', [FAM])).rows[0].n;
  assert.strictEqual(after, before);
  assert.strictEqual((await pool.query("select count(*)::int n from suggestions where family_id=$1", [FAM])).rows[0].n, 0);
});

test('import: apply writes the new person with history, queues the conflict, adds the event and the couple', { skip }, async () => {
  const body = { family: FAM, content: GEDCOM_IN('Phạm Thị Mười', '1951'), dry_run: false };
  const r = await call('POST', '/api/gedcom/import', body, editorCookie);
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.json.applied.persons_created, 1);
  assert.strictEqual(r.json.applied.suggestions_queued, 1);
  assert.ok(r.json.applied.events_added >= 1);
  assert.strictEqual(r.json.applied.relations_added, 1, 'the couple Nguyễn Văn Ất and the new person');
  const created = (await pool.query("select id, data from persons where family_id=$1 and data->>'name' = 'Phạm Thị Mười'", [FAM])).rows[0];
  assert.ok(created && /^N[0-9a-f]{12}$/.test(created.id), 'a new N id');
  assert.strictEqual(created.data.born, '1985', 'the BIRT year is the born field of the new person');
  const hist = (await pool.query("select by_user from history where person_id=$1 and field='su_kien'", [created.id])).rows;
  assert.ok(hist.length >= 1 && hist.every((h) => h.by_user.startsWith('nhập GEDCOM')));
  const sg = (await pool.query("select changes, base, by_name, status from suggestions where family_id=$1", [FAM])).rows;
  assert.strictEqual(sg.length, 1);
  assert.deepStrictEqual(sg[0].changes, { born: '1951' });
  assert.deepStrictEqual(sg[0].base, { born: '1950' });
  assert.strictEqual(sg[0].status, 'pending');
  const existing = (await pool.query('select data from persons where id=$1', [A])).rows[0].data;
  assert.strictEqual(existing.born, '1950', 'the existing value is never overwritten');
  assert.strictEqual(existing.birth_place, 'Hà Tĩnh', 'an existing value stays');
  const couple = (await pool.query('select count(*)::int n from couple where family_id=$1 and kind=$2', [FAM, 'cuoi'])).rows[0].n;
  assert.strictEqual(couple, 1);
});

test('import: a second apply of the same file adds nothing (idempotent)', { skip }, async () => {
  const first = await pool.query('select (select count(*) from persons where family_id=$1) p, (select count(*) from events where family_id=$1) e, (select count(*) from suggestions where family_id=$1) s, (select count(*) from couple where family_id=$1) c', [FAM]);
  const r = await call('POST', '/api/gedcom/import', { family: FAM, content: GEDCOM_IN('Phạm Thị Mười', '1951'), dry_run: false }, editorCookie);
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.json.applied.persons_created, 0);
  assert.strictEqual(r.json.applied.events_added, 0);
  assert.strictEqual(r.json.applied.suggestions_queued, 0, 'the same suggestion is not queued twice');
  assert.strictEqual(r.json.applied.relations_added, 0);
  const second = await pool.query('select (select count(*) from persons where family_id=$1) p, (select count(*) from events where family_id=$1) e, (select count(*) from suggestions where family_id=$1) s, (select count(*) from couple where family_id=$1) c', [FAM]);
  assert.deepStrictEqual(second.rows[0], first.rows[0]);
});

test('import: bad input is refused with a message', { skip }, async () => {
  assert.strictEqual((await call('POST', '/api/gedcom/import', { family: FAM, content: '   ', dry_run: true }, editorCookie)).status, 400);
  const notGed = await call('POST', '/api/gedcom/import', { family: FAM, content: 'đây không phải GEDCOM\nchỉ là chữ', dry_run: true }, editorCookie);
  assert.strictEqual(notGed.status, 400);
  assert.ok(notGed.json.error.includes('Không tìm thấy người'));
});

test('stories: an export read back by import adds no story (dry run and apply), and the story is not written twice', { skip }, async () => {
  await pool.query("insert into stories (id, family_id, person_id, kind, title, body, created_by) values ($1, $2, $3, 'chuyen', 'Chuyện thử', $4, 'test')",
    ['S' + crypto.randomBytes(6).toString('hex'), FAM, A, 'Dòng 1\nDòng 2']);
  const ex = await call('GET', `/api/gedcom?family=${FAM}`, undefined, memberCookie);
  assert.strictEqual(ex.status, 200);
  assert.ok(ex.text.includes('1 NOTE Câu chuyện: Chuyện thử\n2 CONT Dòng 1\n2 CONT Dòng 2'));
  const dry = await call('POST', '/api/gedcom/import', { family: FAM, content: ex.text, dry_run: true }, editorCookie);
  assert.strictEqual(dry.status, 200, dry.text);
  assert.strictEqual(dry.json.counts.stories_new, 0);
  assert.strictEqual(dry.json.counts.stories_same, 1);
  const applied = await call('POST', '/api/gedcom/import', { family: FAM, content: ex.text, dry_run: false }, editorCookie);
  assert.strictEqual(applied.status, 200, applied.text);
  assert.strictEqual(applied.json.applied.stories_added, 0);
  const n = (await pool.query('select count(*)::int n from stories where family_id=$1 and person_id=$2', [FAM, A])).rows[0].n;
  assert.strictEqual(n, 1, 'still one story');
});

test('stories: a MyHeritage-style file (CONC, pointer NOTE) writes its stories once, with history', { skip }, async () => {
  const content = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    `0 @${B}@ INDI`, '1 NAME /Trần/ Thị Bảy', '1 SEX F',
    '1 NOTE Câu chuyện: Ngày di cư', '2 CONC  đầu tiên', '2 CONT Đoạn một',
    '1 NOTE @N9@',
    '0 @N9@ NOTE Câu chuyện đời: Tóm tắt', '1 CONC  đời bà', '0 TRLR'].join('\n');
  const r = await call('POST', '/api/gedcom/import', { family: FAM, content, dry_run: false }, editorCookie);
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.json.applied.stories_added, 2);
  const rows = (await pool.query('select kind, title, body from stories where family_id=$1 and person_id=$2 order by kind', [FAM, B])).rows;
  assert.deepStrictEqual(rows, [{ kind: 'chuyen', title: 'Ngày di cư đầu tiên', body: 'Đoạn một' }, { kind: 'tom_tat', title: 'Tóm tắt đời bà', body: '' }]);
  const hist = (await pool.query("select by_user from history where person_id=$1 and field='cau_chuyen'", [B])).rows;
  assert.ok(hist.length === 2 && hist.every((h) => h.by_user.startsWith('nhập GEDCOM')));
  const again = await call('POST', '/api/gedcom/import', { family: FAM, content, dry_run: false }, editorCookie);
  assert.strictEqual(again.json.applied.stories_added, 0, 'the second apply adds nothing');
  assert.strictEqual((await pool.query('select count(*)::int n from stories where family_id=$1 and person_id=$2', [FAM, B])).rows[0].n, 2);
});
