// E2E: a person with no birth/death years still gets history rows on Dòng đời, inside an estimated life window,
// labelled "ước tính" with its basis; ages read "~N tuổi" (the spoken label says khoảng). A person with nothing to go on gets a one-line hint.
// Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch> NODE_PATH=<dir with playwright>.
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

const TAG = crypto.randomBytes(3).toString('hex');
const SLUG = `evest-${TAG}`;
const SOLDIER = `N${TAG}s1`; const SON = `N${TAG}s2`; const GRAND = `N${TAG}s3`; const NOBODY = `N${TAG}s4`;
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ ước tính e2e','public')", [SLUG]);
  const ins = 'insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,\'e2e\')';
  await pool.query(ins, [SOLDIER, SLUG, { name: 'Thử Văn Lính', sex: 'm', gen: 1, living: 'dead', note: 'Lính; được cấp đất sau 1802; mất lúc 42 tuổi' }]);
  await pool.query(ins, [SON, SLUG, { name: 'Thử Văn Con', sex: 'm', gen: 2, parent: SOLDIER }]);
  await pool.query(ins, [GRAND, SLUG, { name: 'Thử Văn Cháu', sex: 'm', gen: 3, parent: SON, born: '1850', died: '1910' }]);
  await pool.query(ins, [NOBODY, SLUG, { name: 'Thử Văn Không', sex: 'm', died: 'không rõ' }]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip || !pool) return;
  await browser?.close(); srv?.close();
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function lifeOf(scheme, id) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/#/${SLUG}/person/${id}`);
  await page.waitForSelector('nav.ptabs', { timeout: 20000 });
  await page.click('button[data-ptab="life"]');
  await page.waitForSelector('#tl-body', { timeout: 20000 });
  return { ctx, page, errs };
}

test('an undated soldier: history rows inside the estimated window, labelled, ages approximate', { skip }, async () => {
  for (const scheme of ['light', 'dark']) {
    const { ctx, page, errs } = await lifeOf(scheme, SOLDIER);
    try {
      const count = await page.textContent('.tl-count');
      assert.match(count, /mốc lịch sử · theo năm ước tính ~\d{4}–\d{4}/, count);
      assert.match(await page.textContent('.tl-est'), /1802/, 'basis names the note year');
      assert.equal(await page.locator('.tl2 li.band', { hasText: 'Thời vua Gia Long' }).count(), 1, 'Gia Long reign inside the estimate');
      assert.equal(await page.locator('.tl2 li', { hasText: 'Tự Đức' }).count(), 0, 'nothing after the estimated death');
      assert.ok(await page.locator('.tl2 li.band').count() >= 2, 'several reign bands across the estimated life');
      if (SHOT) { fs.mkdirSync(SHOT, { recursive: true }); await page.screenshot({ path: path.join(SHOT, `estimate-390-${scheme}.png`), fullPage: true }); }
      assert.deepEqual(errs, []);
    } finally { await ctx.close(); }
  }
});

test('nothing to estimate from: a one-line hint, no history rows', { skip }, async () => {
  const { ctx, page, errs } = await lifeOf('light', NOBODY);
  try {
    assert.equal(await page.locator('.tl2 li.hist').count(), 0);
    assert.match(await page.textContent('#tl-body'), /Chưa có năm sinh\/mất — thêm để thấy mốc lịch sử/);
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});
