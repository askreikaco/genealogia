// E2E: a member downloads one branch from the person's ⋯ menu on the profile. The file is named <ten>-nhanh.ged in ASCII
// and holds the person and the blood descendants. Needs a SCRATCH database and a Chrome/Chromium:
//   GP_TEST_DATABASE_URL=postgres://... [GP_E2E_CHROME=/usr/bin/google-chrome] NODE_PATH=<dir with playwright> npm run test:e2e (from giapha/server)
// Skipped when either is missing.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `gx-branch-e2e-${TAG}`;
const MEMBER = `member-branch-${TAG}@test.local`;
const ROOT = `PBR${TAG.toUpperCase()}1`;
const CHILD = `PBR${TAG.toUpperCase()}2`;
let base; let pool; let srv;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  await pool.query("insert into families (id, slug, name, visibility) values ($1, $1, 'Họ e2e nhánh', 'public')", [FAM]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1, $3, $4, $5), ($2, $3, $6, $5)', [
    ROOT, CHILD, FAM, { name: 'Nguyễn Văn Ất', sex: 'm', born: '1920', died: '1990' }, 'test',
    { name: 'Nguyễn Thị Đào', sex: 'f', born: '1950', died: '2010' }]);
  await pool.query("insert into relation_migrations (family_id, counts) values ($1, '{}')", [FAM]);
  await pool.query("insert into parent_child (family_id, parent_id, child_id, kind) values ($1, $2, $3, 'ruot')", [FAM, ROOT, CHILD]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1, 'Thành viên e2e nhánh', $2, 'member', 'active')", [MEMBER, FAM]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(async () => {
  if (skip) return;
  srv?.close();
  if (pool) {
    await pool.query('delete from history where person_id in (select id from persons where family_id = $1)', [FAM]).catch(() => {});
    await pool.query('delete from parent_child where family_id = $1', [FAM]).catch(() => {});
    await pool.query('delete from relation_migrations where family_id = $1', [FAM]).catch(() => {});
    await pool.query('delete from members where family_id = $1', [FAM]).catch(() => {});
    await pool.query('delete from persons where family_id = $1', [FAM]).catch(() => {});
    await pool.query('delete from families where id = $1', [FAM]).catch(() => {});
    await pool.end().catch(() => {});
  }
});

test('member downloads a branch from the profile ⋯ menu', { skip }, async () => {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: MEMBER, name: 'Thành viên e2e nhánh' }) });
  assert.equal(r.status, 200);
  const [pair] = r.headers.get('set-cookie').split(';');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
    const page = await ctx.newPage();
    await page.goto(`${base}/#/${FAM}/person/${ROOT}`);
    await page.click(`[data-menu="${ROOT}"][data-menu-ctx="prof"]`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="gedcom"]')]);
    assert.equal(dl.suggestedFilename(), 'nguyen-van-at-nhanh.ged');
    const text = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(text.includes(`0 @${ROOT}@ INDI`) && text.includes(`0 @${CHILD}@ INDI`), 'the person and the blood child');
    await ctx.close();
  } finally { await browser.close(); }
});
