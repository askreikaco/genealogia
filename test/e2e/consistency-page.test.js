// E2E, the consistency page with mocked API answers: issues grouped by severity; an editor hides one and it moves under the ignored toggle; a member sees the list without the ignore button.
// Strings come from web/js/consistency-vi.js (read here, never typed). Needs GP_TEST_DATABASE_URL (scratch DB)
// + playwright + Chrome, like dupes-review.test.js. Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const SHOT = process.env.GP_SHOT_DIR || '';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !/scratch|e2e|giapha_ci/.test(DB_URL) ? 'GP_TEST_DATABASE_URL must name a scratch database (contains "scratch", "e2e" or giapha_ci)'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const VI = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'js', 'consistency-vi.js'), 'utf8').match(/^export const VI = ([\s\S]*);\n$/)[1]);
const OWNER = 'owner-consistency-e2e@test.local'; const MEMBER = 'member-consistency-e2e@test.local';
const ISSUES = [
  { rule: 'death_before_birth', severity: 'error', personIds: ['P901'], key: 'P901' },
  { rule: 'spouse_age_gap', severity: 'warn', personIds: ['P902', 'P903'], key: 'P902,P903' },
];
let base, pool, srv, browser, iso;

test.before(async () => {
  if (skip) return;
  const { isolatedDb } = require('./_isolated-db');
  iso = isolatedDb(DB_URL, 'consistency_page');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  const ins = (id, data) => pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, 'duong', data, 'e2e']);
  await ins('P901', { name: 'Test Person Alpha', sex: 'm', born: '1950', died: '1940' });
  await ins('P902', { name: 'Test Person Beta', sex: 'f', born: '1940' });
  await ins('P903', { name: 'Test Person Gamma', sex: 'm', born: '1990' });
  await pool.query(`insert into members (email, name, family_id, role, status) values ($1,'Chu ho e2e','duong','owner','active'),
    ($2,'Thanh vien e2e','duong','member','active') on conflict (family_id, email) do nothing`, [OWNER, MEMBER]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((res) => srv.on('listening', res));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close(); srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function newPage({ email, width = 390, scheme = 'light' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  if (email) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  return { ctx, page: await ctx.newPage() };
}
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: false }); };

// Mocked consistency API: the open list and the ignored list; POST moves one issue to ignored, DELETE brings it back.
async function mockApi(page, state) {
  const posts = [];
  await page.route(/\/api\/trees\/[^/]+\/consistency\/ignore$/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') { posts.push(req.postDataJSON()); state.ignored.push(state.open.shift()); }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.route(/\/api\/trees\/[^/]+\/consistency$/, (route) => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'cache-control': 'no-store' }, body: JSON.stringify({ issues: state.open, counts: { error: 1, warn: 1 }, ignored: state.ignored, family: 'duong' }) }));
  return posts;
}

test('editor: issues grouped by severity, ignore moves one under the toggle; a member sees no ignore button', { skip }, async () => {
  const state = { open: ISSUES.map((i) => ({ ...i })), ignored: [] };
  const { ctx, page } = await newPage({ email: OWNER });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    const posts = await mockApi(page, state);
    await page.goto(base + '/#/duong/consistency');
    await page.waitForSelector('#csbox .cs-issue', { timeout: 15000 });
    assert.ok((await page.locator('body').innerText()).includes(VI.page_title), 'page title shown');
    await page.waitForFunction(() => document.querySelectorAll('#csbox .cs-issue').length === 2, null, { timeout: 15000 });
    await page.waitForFunction((t) => (document.querySelector('#csbox')?.innerText || '').includes(t), VI.rule_death_before_birth, { timeout: 15000 });
    await shot(page, 'consistency-390-light.png');
    await page.locator('#csbox [data-cs=ignore][data-rule=death_before_birth]').click();
    await page.waitForFunction(() => document.querySelectorAll('#csbox .cs-issue').length === 1, null, { timeout: 10000 });
    assert.deepStrictEqual(posts, [{ rule: 'death_before_birth', person_ids: ['P901'] }]);
    assert.equal(await page.locator(`#csbox [data-cs=toggle]`).count(), 1, 'the ignored toggle appears');
    await page.locator('#csbox [data-cs=toggle]').click();
    await page.waitForSelector('#csbox [data-cs=restore]', { timeout: 10000 });
    assert.equal(await page.locator('#csbox [data-cs=restore]').count(), 1);
    assert.deepStrictEqual(errs, [], 'no page errors');
  } finally { await ctx.close(); }
});

test('member: the list shows, with no ignore button', { skip }, async () => {
  const state = { open: ISSUES.map((i) => ({ ...i })), ignored: [] };
  const { ctx, page } = await newPage({ email: MEMBER, width: 1280, scheme: 'dark' });
  try {
    await mockApi(page, state);
    await page.goto(base + '/#/duong/consistency');
    await page.waitForSelector('#csbox .cs-issue', { timeout: 15000 });
    assert.equal(await page.locator('#csbox [data-cs=ignore]').count(), 0);
    await shot(page, 'consistency-1280-dark.png');
  } finally { await ctx.close(); }
});

// Screenshots for the review (GP_SHOT_DIR): the page at 390 dark and 1280 light, with the mocked issues.
test('screenshots: 390 dark and 1280 light', { skip: skip || !SHOT }, async () => {
  for (const [width, scheme, name] of [[390, 'dark', 'consistency-390-dark.png'], [1280, 'light', 'consistency-1280-light.png']]) {
    const state = { open: ISSUES.map((i) => ({ ...i })), ignored: [] };
    const { ctx, page } = await newPage({ email: OWNER, width, scheme });
    try {
      await mockApi(page, state);
      await page.goto(base + '/#/duong/consistency');
      await page.waitForFunction(() => document.querySelectorAll('#csbox .cs-issue').length === 2, null, { timeout: 15000 });
      await shot(page, name);
    } finally { await ctx.close(); }
  }
});
