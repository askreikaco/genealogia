// E2E, match suggestions: the job stores "Có thể là cùng một người" pairs; the owner of both trees sees them on the
// review page with the reasons, links one (owner/admin of both: linked at once) and answers "Không phải" to the
// other; a plain member sees no such section. Invented names only.
// Needs a database (GP_TEST_DATABASE_URL, own schema e2e_match_review) + playwright + Chrome, like places-review.test.js.
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

const OWNER = 'owner-match-e2e@test.local'; const MEMBER = 'member-match-e2e@test.local';
let base, pool, srv, browser, iso, M;

test.before(async () => {
  if (skip) return;
  const { isolatedDb } = require('./_isolated-db');
  iso = isolatedDb(DB_URL, 'match_review');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  M = require('../../server/match-store');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ('bui-thu','bui-thu','Họ Bùi Thử','裴','public') on conflict (id) do nothing");
  const ins = (id, fam, data) => pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, fam, data, 'e2e']);
  await ins('P001', 'duong', { name: 'Dương Văn Tổ Khớp', sex: 'm', gen: 1, died: '1900' });
  await ins('P002', 'duong', { name: 'Bùi Thị Hiền', sex: 'f', born: '1931', died: '2001', spouse_of: 'P001' });
  await ins('P003', 'duong', { name: 'Bùi Văn Trẻ', sex: 'm', born: '1990', place: 'Xã Bến Thử' });
  await ins('N-bui-0001', 'bui-thu', { name: 'Bùi Thị Hiền', sex: 'f', born: '1931', died: '2001' });
  await ins('N-bui-0002', 'bui-thu', { name: 'Bùi Văn Trẻ', sex: 'm', born: '1990', place: 'Xã Bến Thử' });
  await pool.query(`insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e','duong','owner','active'),
    ($1,'Chủ họ e2e','bui-thu','owner','active'), ($2,'Thành viên e2e','duong','member','active') on conflict (family_id, email) do nothing`, [OWNER, MEMBER]);
  const r = await M.scoreAll(pool, {}); await M.store(pool, r.scored);
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
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: true }); };

test('owner of both trees: "Có thể là cùng một người" with reasons; link one, dismiss the other; a member sees none', { skip }, async () => {
  for (const scheme of ['dark', 'light']) { // dark first: the light pass then answers the suggestions
    const { ctx, page } = await newPage({ email: OWNER, scheme });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    try {
      await page.goto(base + '/#review');
      await page.waitForSelector('#mtpend .mt-pend', { timeout: 15000 });
      const sec = page.locator('#mtpend .mt-pend');
      assert.match(await sec.locator('h2').innerText(), /Có thể là cùng một người/);
      assert.equal(await sec.locator('.mt-row').count(), 2);
      const wife = sec.locator('.mt-row', { hasText: 'Bùi Thị Hiền' });
      assert.match(await wife.innerText(), /Họ Bùi Thử/); assert.match(await wife.innerText(), /cùng họ tên/); assert.match(await wife.innerText(), /khớp \d+%/);
      assert.match(await wife.locator('a').getAttribute('href'), /#\/duong\/person\/P002$/);
      await shot(page, `match-review-390-${scheme}.png`);
      if (scheme === 'dark') { assert.deepEqual(errs, []); continue; }
      await wife.locator('[data-mt=link]').click();
      await page.waitForFunction(() => !/Bùi Thị Hiền/.test(document.querySelector('#mtpend')?.innerText || ''), null, { timeout: 10000 });
      const pl = (await pool.query("select status from person_links where a_person='P002' and b_person='N-bui-0001'")).rows[0];
      assert.equal(pl.status, 'accepted', 'owner/admin of both trees: linked at once');
      await sec.locator('.mt-row', { hasText: 'Bùi Văn Trẻ' }).locator('[data-mt=dismiss]').click();
      await page.waitForFunction(() => !document.querySelector('#mtpend .mt-pend'), null, { timeout: 10000 });
      const st = (await pool.query("select status from match_suggestions where 'P003' in (a_person, b_person)")).rows[0];
      assert.equal(st.status, 'dismissed');
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
  const { ctx, page } = await newPage({ email: MEMBER });
  try {
    await page.goto(base + '/#review');
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('#mtpend .mt-pend').count(), 0, 'a member is no editor: no suggestions');
  } finally { await ctx.close(); }
});
