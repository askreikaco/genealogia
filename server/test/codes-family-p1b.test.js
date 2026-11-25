// P1b editor codes: a code gives editor rights only in the family it was issued for (EDITORS entry "Name:familyId:hash";
// no family means DEFAULT_FAMILY), and guest-level everywhere else. Needs a SCRATCH database:
// GP_TEST_DATABASE_URL=postgres://... npm test (skipped otherwise). Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const DEF = 'duong'; // DEFAULT_FAMILY in server/server.js
const OTHER = `p1b-other-${TAG}`;
const OWNER = `owner.${TAG}@example.test`;
const CODE_D = 'p1b-default-' + crypto.randomBytes(4).toString('hex');
const CODE_O = 'p1b-other-' + crypto.randomBytes(4).toString('hex');
let base, pool, close;
const ck = {};

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, headers: r.headers };
}
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const codeCookie = async (code) => (await call('POST', '/api/login', { code })).headers.get('set-cookie').split(';')[0];
const session = async (email) => (await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) })).headers.get('set-cookie').split(';')[0];

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_; process.env.NODE_ENV = 'test'; process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `CodeDefault:${sha(CODE_D)},CodeOther:${OTHER}:${sha(CODE_O)}`;
  const { app, pool: p } = require('../server'); pool = p;
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query(`insert into families (id, slug, name, han, visibility) values ($1,$1,'Default test','','public'), ($2,$2,'Other test','','public') on conflict (id) do nothing`, [DEF, OTHER]);
  await pool.query(`insert into members (email, name, role, status, family_id) values ($1,'o','owner','active',$2)`, [OWNER, DEF]);
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`; close = () => new Promise((r) => srv.close(r));
  ck.owner = await session(OWNER);
  ck.codeD = await codeCookie(CODE_D);
  ck.codeO = await codeCookie(CODE_O);
});
test.after(async () => {
  if (skip) return;
  await pool.query('delete from members where email = $1', [OWNER]);
  await pool.query('delete from families where id = $1', [OTHER]);
  await close(); await pool.end();
});

// editor-level read: match suggestions need an editor (403/401 otherwise)
const SUG = (fam) => `/api/match-suggestions?family=${fam}`;

test('code on its own (default) family: editor there', { skip }, async () => {
  const r = await call('GET', SUG(DEF), undefined, ck.codeD);
  assert.equal(r.status, 200, 'default-family code is an editor of the default family');
});

test('code on another family: guest there (401 for an editor-only read)', { skip }, async () => {
  const r = await call('GET', SUG(OTHER), undefined, ck.codeD);
  assert.equal(r.status, 401, 'default-family code has no rights in the other family');
});

test('code with an explicit family: editor in that family only', { skip }, async () => {
  assert.equal((await call('GET', SUG(OTHER), undefined, ck.codeO)).status, 200, 'explicit-family code is editor in its family');
  assert.equal((await call('GET', SUG(DEF), undefined, ck.codeO)).status, 401, 'explicit-family code is guest in the default family');
});

test('member of the family keeps full rights (unchanged)', { skip }, async () => {
  const r = await call('GET', SUG(DEF), undefined, ck.owner);
  assert.equal(r.status, 200, 'owner of the default family is still an editor there');
});
