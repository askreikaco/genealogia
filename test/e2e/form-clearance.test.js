// E2E: the person form scrolls its last field above the bottom Huỷ/Lưu bar. Needs a SCRATCH database (CI uses giapha_ci):
//   GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright> npm run test:e2e (from giapha/server)
// Covers: at 390 px and 1280 px, #them with Liên hệ expanded, scrolled to the bottom: the last visible field's bottom
// is above the bar's top; a focused field is centred in the viewport.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !/scratch|e2e|giapha_ci/.test(DB_URL) ? 'GP_TEST_DATABASE_URL must name a scratch database (contains "scratch", "e2e" or giapha_ci)'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const OWNER = 'owner-form-clear-e2e@test.local';
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', '..', 'server', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'migrations', f), 'utf8'));
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e','duong','owner','active') on conflict (family_id, email) do nothing", [OWNER]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close();
  srv?.close();
  await pool?.query('delete from members where email = $1', [OWNER]).catch(() => {});
  await pool?.end().catch(() => {});
});

async function ownerPage(width, height) {
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'light' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  return { ctx, page: await ctx.newPage() };
}

for (const [w, h] of [[390, 844], [1280, 800]]) {
  test(`form at ${w}x${h}: last field above the bar with Liên hệ expanded; focus centres the field`, { skip }, async () => {
    const { ctx, page } = await ownerPage(w, h);
    try {
      await page.goto(base + '/#them');
      await page.waitForSelector('#fpform', { timeout: 15000 });
      await page.click('button[data-acc-btn="lien"]');
      await page.waitForSelector('#fpform input[name="email"]', { state: 'visible', timeout: 5000 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const bar = document.querySelector('.fp-bar').getBoundingClientRect();
        const shown = [...document.querySelectorAll('#fpform input:not([type=hidden]), #fpform select, #fpform textarea')]
          .filter((el) => el.getClientRects().length && !el.closest('[hidden]'));
        const last = shown[shown.length - 1];
        return { barTop: bar.top, barH: bar.height, lastBottom: last.getBoundingClientRect().bottom, last: last.name || last.id };
      });
      assert.ok(r.lastBottom < r.barTop, `${w}px: last field (${r.last}) bottom ${Math.round(r.lastBottom)} is above the bar top ${Math.round(r.barTop)}`);
      assert.equal(Math.round(r.barH), 64, 'the bar is --fp-bar-h tall');
      // a field that is under the bar is brought to the middle of the viewport when it takes focus
      await page.evaluate(() => { document.querySelector('#fpform input[name="email"]').focus(); });
      await page.waitForTimeout(400);
      const mid = await page.evaluate(() => {
        const el = document.querySelector('#fpform input[name="email"]').getBoundingClientRect();
        return Math.abs((el.top + el.bottom) / 2 - innerHeight / 2);
      });
      assert.ok(mid < 80, `focused field centred (off by ${Math.round(mid)} px)`);
    } finally { await ctx.close(); }
  });
}
