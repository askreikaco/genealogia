// Stable person ID (web/js/shortid.js + the persons.short_id trigger): format, forgiving input, check character,
// the trigger on insert, the API (data.sid), and the backfill (dry run, apply, re-run). Invented names.
// The DB part needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'shortid.js')).href);
const make = (S, body) => body + S.sidCheck(body);

test('shortid: check character, canonical form, forgiving input, formatting', async () => {
  const S = await load();
  const sid = make(S, 'D7K2QX');
  assert.equal(sid.length, 7);
  assert.equal(S.normalizeSid(sid), sid);
  assert.equal(S.normalizeSid(S.formatSid(sid)), sid, 'with the dash');
  assert.equal(S.normalizeSid(' d7k2-qx' + sid[6].toLowerCase() + ' '), sid, 'lower case and spaces');
  assert.equal(S.formatSid(sid), `D7K2-QX${sid[6]}`);
  const z = make(S, '0011AB'); // O reads as 0, I/L as 1
  assert.equal(S.normalizeSid('OOIL-AB' + z[6]), z);
  assert.equal(S.normalizeSid('D7K2QX'), '', 'too short');
  assert.equal(S.normalizeSid('Dương Văn'), '', 'a name is not an ID');
  assert.equal(S.normalizeSid('D-3.2.1'), '', 'a tree position is not an ID');
  assert.equal(S.SID_ALPHABET.length, 31);
});

test('shortid: every single wrong character and every neighbour swap is caught', async () => {
  const S = await load();
  const A = S.SID_ALPHABET;
  for (const body of ['D7K2QX', '000000', 'YYYYYY', 'A1B2C3', '9Y8X7W']) {
    const sid = make(S, body);
    for (let i = 0; i < 7; i++) for (const c of A) {
      if (c === sid[i]) continue;
      const bad = sid.slice(0, i) + c + sid.slice(i + 1);
      assert.equal(S.normalizeSid(bad), '', `${sid} -> ${bad} must fail`);
    }
    for (let i = 0; i < 5; i++) {
      if (sid[i] === sid[i + 1]) continue;
      const sw = sid.slice(0, i) + sid[i + 1] + sid[i] + sid.slice(i + 2);
      assert.equal(S.normalizeSid(sw), '', `${sid} -> ${sw} (swap) must fail`);
    }
  }
});

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';

test('shortid DB: trigger on insert, API data.sid, backfill dry run / apply / re-run', { skip }, async () => {
  const S = await load();
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex');
  const { app, pool } = require('../server');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const TAG = crypto.randomBytes(3).toString('hex'); const FAM = `sid-${TAG}`;
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Họ Thử Mã','public')", [FAM]);
  const a = 'N' + crypto.randomUUID().slice(0, 13); const b = 'N' + crypto.randomUUID().slice(0, 13);
  await pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'t',$3)", [a, { name: 'Thử Văn Một', died: '1950' }, FAM]);
  const r1 = await pool.query('select short_id from persons where id=$1', [a]);
  assert.equal(S.normalizeSid(r1.rows[0].short_id), r1.rows[0].short_id, 'the trigger sets a valid ID');
  // an old row without an ID (as before the migration), then the backfill
  await pool.query('alter table persons disable trigger persons_short_id');
  await pool.query("insert into persons (id, data, updated_by, family_id) values ($1,$2,'t',$3)", [b, { name: 'Thử Văn Hai', died: '1960' }, FAM]);
  await pool.query('alter table persons enable trigger persons_short_id');
  assert.equal((await pool.query('select short_id from persons where id=$1', [b])).rows[0].short_id, null);
  const script = path.join(__dirname, '..', 'scripts', 'person-ids-backfill.js');
  const env = { ...process.env, DATABASE_URL: URL_ };
  const dry = execFileSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.match(dry, /DRY RUN/); assert.match(dry, /missing: [1-9]/);
  assert.equal((await pool.query('select short_id from persons where id=$1', [b])).rows[0].short_id, null, 'dry run writes nothing');
  const v0 = Number((await pool.query('select version from persons where id=$1', [b])).rows[0].version);
  const ap = execFileSync(process.execPath, [script, '--apply'], { env, encoding: 'utf8' });
  assert.match(ap, /APPLIED/);
  const rb = (await pool.query('select short_id, version from persons where id=$1', [b])).rows[0];
  assert.equal(S.normalizeSid(rb.short_id), rb.short_id); assert.ok(Number(rb.version) > v0, 'version bumped so clients sync it');
  assert.equal((await pool.query('select short_id from persons where id=$1', [a])).rows[0].short_id, r1.rows[0].short_id, 'existing IDs never change');
  const again = execFileSync(process.execPath, [script, '--apply'], { env, encoding: 'utf8' });
  assert.match(again, /updated: 0/);
  // API: data.sid for guests and members
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  try {
    const res = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/persons?family=${FAM}&since=0`)).json();
    const got = new Map(res.items.map((i) => [i.id, i.data?.sid]));
    assert.equal(got.get(a), r1.rows[0].short_id); assert.equal(got.get(b), rb.short_id);
  } finally { await new Promise((r) => srv.close(r)); }
  await pool.query('delete from persons where family_id=$1', [FAM]); await pool.query('delete from families where id=$1', [FAM]);
  await pool.end();
});
