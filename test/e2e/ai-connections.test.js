// E2E: an AI connection from consent to revoke, in the browser (phone, 390 px). The real server and a SCRATCH database:
//   GP_TEST_DATABASE_URL=postgres://... NODE_PATH=<dir with playwright> [GP_E2E_CHROME=...] npm run test:e2e (from giapha/server)
// Checks: /oauth/authorize opens one consent screen (family + scopes, one primary button); allowing sends the code back;
// Cài đặt lists the connection as a calm row; Gỡ kết nối asks to confirm, then the row is gone and the API no longer has it.
// Signed out: the card says what it is and its Đăng nhập button opens the sign-in. Signed in: Kết nối ứng dụng AI opens
// the sheet with this origin's /mcp address and steps for Claude and ChatGPT.
// Also: the sheet lists the recipes (title, prompt with a placeholder) and Chép copies the prompt.
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
    await row.getByRole('button', { name: 'Gỡ kết nối' }).click();
    await page.locator('dialog#dcf [data-rds-confirm]').click();
    await page.locator('.ai-row', { hasText: CLIENT }).waitFor({ state: 'detached' });
    const left = await (await fetch(base + '/api/ai/connections', { headers: { cookie } })).json();
    assert.ok(!left.items.some((x) => x.client_name === CLIENT), 'gone from the server too');
  } finally { await browser.close(); }
});

// Signed out: the card explains itself and its button starts the app's sign-in (the sign-in dialog opens on this page).
test('signed out: the card says what it is and Đăng nhập starts sign-in', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${base}/#settings`);
    const card = page.locator('.ai-sec');
    await card.getByText('Cho phép Claude, ChatGPT').waitFor();
    await card.getByRole('button', { name: 'Đăng nhập' }).click();
    await page.locator('dialog', { hasText: 'Đăng nhập để sửa' }).waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 1, 'one sign-in dialog opens');
  } finally { await browser.close(); }
});

// Signed in: the connect sheet shows this origin's /mcp address, a copy button, and steps for Claude and ChatGPT.
test('signed in: connect sheet shows the MCP address and steps', { skip }, async () => {
  const sess = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ AI e2e' }) });
  const cookie = sess.headers.get('set-cookie').split(';')[0];
  const i = cookie.indexOf('=');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
    await ctx.addCookies([{ name: cookie.slice(0, i), value: cookie.slice(i + 1), url: base }]);
    const page = await ctx.newPage();
    await page.goto(`${base}/#settings`);
    await page.locator('.ai-sec [data-connect]').click();
    const sheet = page.locator('dialog.ai-sheet');
    await sheet.waitFor();
    assert.equal((await sheet.locator('.ai-url code').textContent()).trim(), `${base}/mcp`);
    assert.equal(await sheet.locator('[data-copy]').count(), 1, 'copy button');
    const lists = sheet.locator('.ai-steps');
    assert.equal(await lists.count(), 2, 'steps for Claude and ChatGPT');
    assert.equal(await lists.nth(0).locator('li').count(), 3, 'three steps for Claude');
    await sheet.locator('[data-close]').click();
    await page.locator('dialog.ai-sheet').waitFor({ state: 'detached' });
  } finally { await browser.close(); }
});

// Signed in: the sheet has the recipe section (a title and a prompt with a [placeholder] each), and Chép puts that
// prompt on the clipboard, exactly as shown.
test('connect sheet: recipes are shown and Chép copies the prompt', { skip }, async () => {
  const sess = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ AI e2e' }) });
  const cookie = sess.headers.get('set-cookie').split(';')[0];
  const i = cookie.indexOf('=');
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
    await ctx.addCookies([{ name: cookie.slice(0, i), value: cookie.slice(i + 1), url: base }]);
    const page = await ctx.newPage();
    await page.goto(`${base}/#settings`);
    await page.locator('.ai-sec [data-connect]').click();
    const sheet = page.locator('dialog.ai-sheet');
    await sheet.waitFor();
    const recs = sheet.locator('.ai-rec');
    assert.equal(await recs.count(), 2, 'two recipes');
    for (let n = 0; n < 2; n++) {
      const r = recs.nth(n);
      assert.ok((await r.locator('.ai-rec-t').textContent()).trim().length > 0, 'a title');
      const prompt = (await r.locator('.ai-rec-p').textContent()).trim();
      assert.match(prompt, /\[[^\]]+\]/, 'a placeholder the user edits');
      await r.locator('[data-recipe]').click();
      await page.getByText('Đã chép câu lệnh.').waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), prompt, 'the clipboard has the prompt as shown');
    }
    await sheet.locator('[data-close]').click();
    await page.locator('dialog.ai-sheet').waitFor({ state: 'detached' });
  } finally { await browser.close(); }
});
