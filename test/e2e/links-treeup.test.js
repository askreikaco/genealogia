// E2E: #tree tree-cards. Tree B's founder is the same person (accepted link) as a child in tree A, so tree B's list shows
// (folded) the "Cây trên" card for tree A with a solid connector "… là cha/mẹ của …" to our root; expanded it also
// shows "Toàn cầu" (dotted, grouping). Tree A shows a "Cây dưới" card under that child. A spouse linked to her birth
// tree gets "Dâu từ …"; an editor sees a dimmed "Có thể liên quan" card. A private tree is never named to a guest.
// Invented names only. Needs a database (GP_TEST_DATABASE_URL, own schema) + playwright + Chrome.
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

const OWNER = 'owner-treeup-e2e@test.local';
const FA = 'ho-thu-goc'; const FB = 'ho-thu-nhanh'; const FC = 'ho-thu-rieng'; const FV = 'ho-vo-thu'; const FX = 'ho-thu-dong';
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'treeup');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const [id, name, vis] of [[FA, 'Họ Thử Làng Gốc', 'public'], [FB, 'Họ Thử Chi Nhánh', 'public'], [FC, 'Họ Thử Riêng', 'private'], [FV, 'Họ Võ Thử', 'public'], [FX, 'Họ Thử Xóm Đông', 'public']]) {
    await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,$2,'試',$3) on conflict do nothing", [id, name, vis]);
  }
  const ins = (id, fam, data) => pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, fam, data, 'e2e']);
  await ins('TA1', FA, { name: 'Thử Văn Tổ', sex: 'm', gen: 1, died: '1880' });
  await ins('TA2', FA, { name: 'Thử Văn Một', sex: 'm', gen: 2, parent: 'TA1', died: '1950' });
  await ins('TB1', FB, { name: 'Thử Văn Một', sex: 'm', gen: 1, died: '1950' });
  await ins('TB2', FB, { name: 'Thử Văn Hai', sex: 'm', gen: 2, parent: 'TB1', died: '1999' });
  await ins('TC1', FC, { name: 'Thử Văn Kín', sex: 'm', gen: 1, died: '1960' });
  await ins('TBW', FB, { name: 'Võ Thị Hiền Thử', sex: 'f', spouse_of: 'TB1', died: '1960' });
  await ins('TV1', FV, { name: 'Võ Văn Cha Thử', sex: 'm', gen: 1, died: '1930' });
  await ins('TV2', FV, { name: 'Võ Thị Hiền Thử', sex: 'f', gen: 2, parent: 'TV1', died: '1960' });
  await ins('TX1', FX, { name: 'Thử Văn Hai', sex: 'm', gen: 1, died: '1999' });
  for (const fam of [FA, FB, FC, FV, FX]) await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$2,'owner','active') on conflict (family_id, email) do nothing", [OWNER, fam]);
  await pool.query(`insert into person_links (a_family, a_person, b_family, b_person, status, reason, proposed_by, accepted_by, decided_at)
    values ($1,'TA2',$2,'TB1','accepted','e2e','e2e','e2e',now()), ($2,'TB2',$3,'TC1','accepted','e2e','e2e','e2e',now()),
           ($2,'TBW',$4,'TV2','accepted','e2e','e2e','e2e',now())`, [FA, FB, FC, FV]);
  await pool.query("insert into match_suggestions (a_family, a_person, b_family, b_person, score) values ($1,'TB2',$2,'TX1',0.82)", [FB, FX]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close(); srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function newPage({ owner = false, width = 390, scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  if (owner) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  return { ctx, page, errs };
}
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: true }); };

test('tree B: Toàn cầu card, then Cây trên (dotted "nhóm theo họ"), then a solid reason to our root', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page, errs } = await newPage({ owner: true, scheme });
    try {
      await page.evaluate(() => { try { localStorage.removeItem('gp_tier'); } catch {} }).catch(() => {});
      await page.goto(`${base}/#/${FB}/tree`);
      await page.waitForSelector('#tr a.tcard', { timeout: 15000 });
      await page.waitForFunction(() => /Cây trên/i.test(document.querySelector('#tr')?.textContent || ''), null, { timeout: 15000 });
      const cards = await page.$$eval('#tr a.tcard', (els) => els.map((x) => x.textContent));
      assert.match(cards[0], /Họ Thử/, 'Toàn cầu card always first'); assert.match(cards[1], /Họ Thử Làng Gốc/, 'nearest upper card right above our root');
      assert.ok(await page.locator('#tr .tgen.tlk.tl-dot', { hasText: 'nhóm theo họ' }).count(), 'global -> upper = dotted grouping');
      assert.match(await page.locator('#tr .tgen.tlk.tl-solid').first().textContent(), /Thử Văn Tổ là cha\/mẹ của Ông Thử Văn Một/);
      assert.equal(await page.locator('#tr [data-tier-more]').count(), 0, 'no middle levels -> no toggle');
      assert.equal(await page.locator('#tr .tlg').count(), 0, 'no legend row on the tree page');
      await page.click('#tmore'); await page.click('.menu [role=menuitem]:has-text("Ý nghĩa các đường nối")');
      const sheet = page.locator('dialog.fpanel', { hasText: 'Ý nghĩa các đường nối' });
      await sheet.waitFor({ state: 'visible' });
      assert.match(await sheet.textContent(), /đã nối người.*chưa chứng minh.*nhóm theo họ/s);
      await shot(page, `legend-sheet-390-${scheme}.png`);
      await sheet.locator('[data-fpx]').click(); await sheet.waitFor({ state: 'detached' });
      assert.match(await page.textContent('#tr'), /Dâu từ Họ Võ Thử/, 'spouse linked to her birth tree');
      assert.ok(await page.locator('#tr a.tcard.maybe', { hasText: 'Xóm Đông' }).count(), 'editor sees the possible link');
      await shot(page, `cards-b-390-${scheme}.png`);
      if (scheme === 'light') {
        await page.locator('#tr a.tcard', { hasText: 'Làng Gốc' }).click();
        await page.waitForFunction((f) => location.hash.includes(`/${f}/tree/@TA2`), FA, { timeout: 10000 });
      }
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
});

test('tree A: no "Cây trên"; a "Cây dưới" card (solid) under the child who founded tree B', { skip }, async () => {
  const { ctx, page, errs } = await newPage({ owner: true });
  try {
    await page.goto(`${base}/#/${FA}/tree`);
    await page.waitForFunction(() => /Cây dưới/i.test(document.querySelector('#tr')?.textContent || ''), null, { timeout: 15000 });
    const text = await page.textContent('#tr');
    assert.ok(!/Cây trên/i.test(text)); assert.match(text, /cùng họ, chưa nối người/);
    assert.ok(await page.locator('#tr .tgen.tlk.tl-solid', { hasText: 'là thủy tổ' }).count());
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('guest: private tree never named; no possible-link cards', { skip }, async () => {
  const { ctx, page } = await newPage();
  try {
    await page.goto(`${base}/#/${FB}/tree`);
    await page.waitForSelector('.tn', { timeout: 15000 });
    await page.waitForTimeout(1500);
    if (await page.locator('#tr [data-tier-more]').count()) await page.click('#tr [data-tier-more]');
    await page.waitForTimeout(500);
    const body = await page.textContent('main');
    assert.ok(!/Thử Riêng|Thử Văn Kín/.test(body), 'private tree / its people not shown to a guest');
    assert.equal(await page.locator('#tr a.tcard.maybe').count(), 0, 'possible links are for editors only');
  } finally { await ctx.close(); }
});
