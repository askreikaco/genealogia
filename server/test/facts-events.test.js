// Profile facts -> Dòng đời events: no undated copies of profile fields, Nơi sống moves (A → B), note sentences with a year, what is left out (birth, death, marriage
// shown from the profile; events the person already has), and the backfill (dry run, apply with history, re-run adds
// nothing, a deleted backfilled event is not added again). Invented data only.
// The DB part needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { proposeFacts, sentences, dateTextOf } = require('../facts-events');

test('profile fields the profile already shows give no undated copy; Nơi sống is not a move', async () => {
  const { rows, skipped } = await proposeFacts({ burial: 'Nghĩa trang Đồi Thông', job: 'Làm ruộng', religion: 'Phật giáo', place: 'Xã Bến Thử', born: '1920', died: '1990', married: '1945' });
  assert.deepEqual(rows, []);
  assert.deepEqual(skipped.filter((s) => s.reason === 'profile').map((s) => s.field).sort(), ['burial', 'job', 'place', 'religion']);
  assert.deepEqual(skipped.filter((s) => s.reason === 'derived').map((s) => s.field).sort(), ['born', 'died', 'married'], 'birth, death, marriage come from the profile');
});

test('Nơi sống "A → B" is one move to B; dated when the text has a year; a chain reads first to last', async () => {
  const a = (await proposeFacts({ place: 'Làng Bến Xưa → Xóm Thử Mới' })).rows;
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].type, a[0].legacy_key, a[0].place, a[0].date_kind], ['chuyen_nha', 'place:move', 'Xóm Thử Mới', null]);
  assert.equal(a[0].description, 'Chuyển từ Làng Bến Xưa đến Xóm Thử Mới. Ghi trong hồ sơ: Làng Bến Xưa → Xóm Thử Mới');
  const b = (await proposeFacts({ place: 'Làng Một -> Làng Hai (khoảng 1955) → Làng Ba' })).rows[0];
  assert.deepEqual([b.place, b.date_text, b.date_kind, b.date_from], ['Làng Ba', 'khoảng 1955', 'about', '1955']);
  const e = (await proposeFacts({ place: 'Làng Một -> Làng Hai (khoảng 1955)' })).rows[0];
  assert.deepEqual([e.place, e.date_text], ['Làng Hai', 'khoảng 1955'], 'a date in brackets is not part of the place');
  assert.match(b.description, /^Chuyển từ Làng Một đến Làng Ba\. Ghi trong hồ sơ: Làng Một -> /);
  const c = await proposeFacts({ place: 'Làng Một → Làng Hai' }, { existing: [{ type: 'chuyen_nha', date_from: null }] });
  assert.deepEqual([c.rows.length, c.skipped.find((s) => s.field === 'place').reason], [0, 'has_event']);
});

test('note sentences with a year and a known kind of event become dated events', async () => {
  const note = 'Năm 1965 nhập ngũ, đóng quân ở miền Trung. Khoảng 1978 vào Nam lập nghiệp; được tặng huân chương năm 1985.\nTốt nghiệp 1990–1994.';
  const { rows } = await proposeFacts({ note });
  assert.deepEqual(rows.map((r) => [r.type, r.date_text, r.date_kind, r.date_from]), [
    ['quan_ngu', '1965', 'exact', '1965'],
    ['chuyen_nha', 'khoảng 1978', 'about', '1978'],
    ['thanh_tich', '1985', 'exact', '1985'],
    ['hoc', '1990–1994', 'between', '1990'],
  ]);
  assert.match(rows[0].description, /nhập ngũ/);
  assert.ok(rows.every((r) => r.legacy_key.startsWith('note:') && r.sources[0].title === 'Ghi chú trong hồ sơ'));
  assert.equal(new Set(rows.map((r) => r.legacy_key)).size, 4, 'one key per sentence');
});

test('notes: no year, no known kind, or a birth/death sentence -> nothing; --no-notes reads no note', async () => {
  const note = 'Đi lính thời trẻ. Năm 1950 làm thợ mộc giỏi. Hy sinh năm 1968 khi đi bộ đội. Sinh ra năm 1940 tại quê.';
  assert.deepEqual((await proposeFacts({ note })).rows, []);
  assert.deepEqual((await proposeFacts({ note: 'Nhập ngũ 1965.' }, { notes: false })).rows, []);
});

test('a person who already has the event: fields skip by type, notes by type and year', async () => {
  const existing = [{ type: 'nghe', date_from: null }, { type: 'quan_ngu', date_from: '1965' }];
  const r = await proposeFacts({ job: 'Thợ mộc', note: 'Nhập ngũ năm 1965. Xuất ngũ năm 1975.' }, { existing });
  assert.deepEqual(r.rows.map((x) => [x.type, x.date_from]), [['quan_ngu', '1975']]);
  assert.deepEqual(r.skipped.map((s) => [s.field, s.reason]), [['job', 'profile'], ['note', 'has_event']]);
});

test('sentence split and date text: dots inside dates do not split; prefixes kept', () => {
  assert.deepEqual(sentences('Ngày 5.3.1963 nhập học. Sau đó; về quê'), ['Ngày 5.3.1963 nhập học', 'Sau đó', 'về quê']);
  assert.equal(dateTextOf('trước 1975 di cư'), 'trước 1975');
  assert.equal(dateTextOf('sau năm 1990'), '1990');
  assert.equal(dateTextOf('từ 1980 đến 1985 đi học'), '1980–1985');
  assert.equal(dateTextOf('số nhà 12345'), '');
  assert.equal(dateTextOf('42 tuổi'), '');
});

test('empty person: no rows', async () => {
  assert.deepEqual(await proposeFacts({}), { rows: [], skipped: [], anomalies: [] });
});

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
test('backfill: dry run counts, apply adds with history, re-run adds nothing, a deleted one stays deleted', { skip }, async () => {
  const { Pool } = require('pg');
  const B = require('../scripts/facts-to-events');
  const pool = new Pool({ connectionString: URL_, max: 2 });
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const tag = crypto.randomBytes(3).toString('hex');
  const fam = 'fx-' + tag; const P1 = 'PFX1' + tag; const P2 = 'PFX2' + tag; const P3 = 'PFX3' + tag;
  const bk = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-bk-'));
  try {
    await pool.query("insert into families (id, name, slug) values ($1, 'Họ Thử Sự Kiện', $1)", [fam]);
    const ins = (id, data) => pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'test',$3)", [id, data, fam]);
    await ins(P1, { name: 'Ông Một', born: '1920', job: 'Thợ mộc', note: 'Nhập ngũ năm 1945.' });
    await ins(P2, { name: 'Bà Hai', died: '1990', burial: 'Đồi Thông', place: 'Làng Một → Làng Hai' });
    await ins(P3, { name: 'Ông Ba' });
    const f = { id: fam, name: 'Họ Thử Sự Kiện' };
    const p = await B.plan(pool, f);
    assert.deepEqual(p.perType, { quan_ngu: 1, chuyen_nha: 1 });
    assert.equal(p.skipped.derived, 2); assert.equal(p.skipped.profile, 2, 'Nghề and An táng stay on the profile only');
    assert.equal((await pool.query('select count(*)::int n from events where family_id=$1', [fam])).rows[0].n, 0, 'dry run writes nothing');
    const r1 = await B.apply(pool, p, { backupDir: bk, by: 'test' });
    assert.equal(r1.inserted, 2); assert.ok(fs.existsSync(r1.backup));
    const evs = (await pool.query('select id, person_id, type, legacy_key, description, date_from from events where family_id=$1 order by type', [fam])).rows;
    assert.deepEqual(evs.map((e) => [e.type, e.legacy_key.startsWith('note:') ? 'note' : e.legacy_key]), [['chuyen_nha', 'place:move'], ['quan_ngu', 'note']]);
    assert.equal(evs.find((e) => e.type === 'quan_ngu').date_from, '1945');
    const hist = (await pool.query("select count(*)::int n from history where person_id = any($1) and field='su_kien' and by_user='test'", [[P1, P2]])).rows[0].n;
    assert.equal(hist, 2, 'one history row per added event');
    const prof = (await pool.query('select data from persons where id=$1', [P1])).rows[0].data;
    assert.equal(prof.job, 'Thợ mộc', 'the profile field is unchanged');
    const p2 = await B.plan(pool, f);
    assert.equal(p2.inserts.length, 0); assert.equal(p2.already, 2);
    assert.equal((await B.apply(pool, p2, { backupDir: bk, by: 'test' })).inserted, 0);
    // someone deletes the backfilled move: a later run does not bring it back
    await pool.query("delete from events where family_id=$1 and type='chuyen_nha'", [fam]);
    const p3 = await B.plan(pool, f);
    assert.equal(p3.inserts.length, 0); assert.equal(p3.skipped.removed, 1);
    assert.equal((await B.apply(pool, { ...p3, inserts: [{ person_id: P2, ...(await require('../facts-events').proposeFacts({ place: 'Làng Một → Làng Hai' })).rows[0] }] }, { backupDir: bk, by: 'test' })).inserted, 0, 'the op id stays claimed');
  } finally {
    await pool.query('delete from history where person_id = any($1)', [[P1, P2, P3]]);
    await pool.query('delete from events where family_id = $1', [fam]);
    await pool.query('delete from ops where person_id = any($1)', [[P1, P2, P3]]);
    await pool.query('delete from persons where family_id = $1', [fam]);
    await pool.query('delete from families where id = $1', [fam]);
    await pool.end();
    fs.rmSync(bk, { recursive: true, force: true });
  }
});
