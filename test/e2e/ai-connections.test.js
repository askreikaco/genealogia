// E2E: an AI connection from consent to revoke, in the browser (phone, 390 px). The real server and a SCRATCH database:
//   GP_TEST_DATABASE_URL=postgres://... NODE_PATH=<dir with playwright> [GP_E2E_CHROME=...] npm run test:e2e (from giapha/server)
// Checks: /oauth/authorize opens one consent screen (family + scopes, one primary button); allowing sends the code back;
// Cài đặt lists the connection as a calm row; ⋯ > Thu hồi asks to confirm, then the row is gone and the API no longer has it.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const TAG = crypto.randomBytes(3).toString('hex');
const OWNER = `owner-ai-${TAG}@test.local`;
const CLIENT = `Trợ lý e2e ${TAG}`;
const REDIRECT = 'http://localhost:4567/cb';
let base; let pool; let srv;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  await pool.query("insert into members (email, name, role, status, family_id) values ($1, 'Chủ AI e2e', 'owner', 'active', 'duong')", [OWNER]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(async () => {
  if (skip) return;
  srv?.close();
  await pool?.query('delete from members where email = $1', [OWNER]).catch(() => {});
  await pool?.end().catch(() => {});
});

test('consent, then revoke from Cài đặt', { skip }, async () => {
  const sess = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ AI e2e' }) });
  assert.equal(sess.status, 200);
  const cookie = sess.headers.get('set-cookie').split(';')[0];
  const i = cookie.indexOf('=');
  const reg = await (await fetch(base + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: CLIENT, redirect_uris: [REDIRECT] }) })).json();
  const verifier = crypto.randomBytes(48).toString('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', scope: 'read suggest', state: 'e2e' });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
    await ctx.route(REDIRECT.replace('/cb', '/**'), (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>ok</p>' }));
    await ctx.addCookies([{ name: cookie.slice(0, i), value: cookie.slice(i + 1), url: base }]);
    const page = await ctx.newPage();
    await page.goto(`${base}/oauth/authorize?${q}`);
    await page.waitForURL(/\/oauth\/consent$/);
    await page.getByText(`${CLIENT} muốn truy cập`).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cho phép' }).count(), 1, 'one primary button');
    await page.getByRole('button', { name: 'Cho phép' }).click();
    await page.waitForURL(/localhost:4567\/cb\?code=/);
    // the client exchanges the code for a token (this is what creates the connection)
    const code = new URL(page.url()).searchParams.get('code');
    const tk = await fetch(base + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: verifier }) });
    assert.equal(tk.status, 200);

    await page.goto(`${base}/#settings`);
    const row = page.locator('.ai-row', { hasText: CLIENT });
    await row.waitFor();
    await row.locator('summary').click();
    await row.getByRole('button', { name: 'Thu hồi' }).click();
    await page.locator('dialog.cfm [data-cfm-ok]').click();
    await page.locator('.ai-row', { hasText: CLIENT }).waitFor({ state: 'detached' });
    const left = await (await fetch(base + '/api/ai/connections', { headers: { cookie } })).json();
    assert.ok(!left.items.some((x) => x.client_name === CLIENT), 'gone from the server too');
  } finally { await browser.close(); }
});
