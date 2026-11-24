// E2E: Hồ sơ lineage rows and the ancestor list, in the browser. Needs a database (GP_TEST_DATABASE_URL): it runs in its own
// schema (e2e_descendants), so no other file's rows are touched. NODE_PATH=<dir with playwright>
//   npm run test:e2e (from giapha/server). GP_SHOT_DIR=<dir> also writes the 390 px light and dark screenshots.
// Covers: a 5-generation fixture on legacy fields (before backfill) and on the tables (after backfill): Cháu and Chắt
// rows with "con của" subtitles in parent then birth order, one row per person, "Xem thêm N" for deeper generations,
// married-in spouse's children not counted; the tổ tiên rows (label per path, tap height >= 44 px, no horizontal scroll);
// a guest's cold load of the app and of a profile makes no 4xx request and no console error.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const SHOT = process.env.GP_SHOT_DIR || '';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !/scratch|e2e|giapha_ci/.test(DB_URL) ? 'GP_TEST_DATABASE_URL must name a scratch database (contains "scratch", "e2e" or giapha_ci)'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const OWNER = 'owner-desc-e2e@test.local';
// A (P801) has two children; B1 has C1 and C2, B2 has C3; C1 has D1 (-> E1, a fifth generation), C3 has D2.
// P810 is a married-in spouse of C1 whose child P811 is not a descendant of A.
const P = (id, name, sex, gen, extra = {}) => ({ id, data: { name, sex, gen, ...extra } });
const FIX = [
  P('P801', 'Dương Văn Gốc', 'm', 1),
  P('P802', 'Dương Văn Hai', 'm', 2, { parent: 'P801', order: 1 }),
  P('P803', 'Dương Thị Ba', 'f', 2, { parent: 'P801', order: 2 }),
  P('P804', 'Dương Văn Bốn', 'm', 3, { parent: 'P802', order: 2 }),
  P('P805', 'Dương Văn Năm', 'm', 3, { parent: 'P802', order: 1, born: '1915' }),
  P('P806', 'Dương Thị Sáu', 'f', 3, { parent: 'P803', order: 1 }),
  P('P807', 'Dương Văn Bảy', 'm', 4, { parent: 'P805', order: 1 }),
  P('P808', 'Dương Thị Tám', 'f', 4, { parent: 'P806', order: 1 }),
  P('P809', 'Dương Văn Chín', 'm', 5, { parent: 'P807', order: 1 }),
  P('P810', 'Võ Thị Mai', 'f', 3, { spouse_of: 'P805', spouse_n: 1 }),
  P('P811', 'Dương Văn Mười Một', 'm', 4, { parent: 'P810', order: 1 }),
  P('P812', 'Dương Thị Mười Hai', 'f', 6, { parent: 'P809', order: 1 }), // a sixth generation: the ancestor line of P812 has 5 generations
];

let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);

test.before(async () => {
  if (skip) return;
  // own schema: this file's rows are the only ones it sees (see _isolated-db.js)
  iso = isolatedDb(DB_URL, 'descendants');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  for (const r of FIX) await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [r.id, 'duong', r.data, 'e2e']);
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
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function newPage(width = 390, scheme = 'light', owner = false) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  if (owner) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  const page = await ctx.newPage();
  const bad = []; const errs = [];
  page.on('response', (res) => { if (res.status() >= 400) bad.push(`${res.status()} ${new URL(res.url()).pathname}`); });
  // the font requests are aborted on purpose (no network here): their 'Failed to load resource' is not an app error
  page.on('console', (m) => { if (m.type() === 'error' && !/^https:\/\/fonts\.g(oogleapis|static)\.com\//.test(m.location().url || '')) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, bad, errs };
}

// Rows of each relation group: { title, rows: [{ name, sub }] } (the group header is h3.relgrp; its rows follow it).
async function groups(page) {
  return page.evaluate(() => [...document.querySelectorAll('section.relsec h3.relgrp')].map((h) => {
    const box = h.nextElementSibling;
    return { title: h.textContent.trim(), rows: [...(box ? box.querySelectorAll('.calm') : [])].map((r) => ({ name: r.querySelector('.calm-n')?.textContent.trim(), sub: r.querySelector('.calm-s')?.textContent.trim() || '' })), link: h.querySelector('a')?.getAttribute('href') || '' };
  }));
}
const openProfile = async (page, id) => {
  await page.goto(base + '/#person/' + id);
  await page.waitForSelector('nav.ptabs', { timeout: 15000 });
  // Quan hệ and Tổ tiên are on the Thông tin tab (no separate tab)
  await page.waitForSelector('section.relsec', { timeout: 15000 });
  // names of people outside the first load arrive with the full pull; the list is read after they are drawn
  await page.waitForFunction(() => !document.querySelector('section.relsec')?.innerText.includes('chưa rõ tên'), null, { timeout: 15000 });
};

async function checkLineage(label) {
  const { ctx, page } = await newPage(390, 'light', true);
  try {
    await openProfile(page, 'P801');
    await page.waitForFunction(() => document.querySelector('section.relsec')?.textContent.includes('Dương Văn Bảy'), null, { timeout: 15000 });
    const g = await groups(page);
    const by = (t) => g.find((x) => x.title.startsWith(t));
    assert.ok(by('Con'), `${label}: Con group`);
    assert.deepEqual(by('Con').rows.map((r) => r.name), ['Dương Văn Hai', 'Dương Thị Ba'], `${label}: children`);
    assert.equal(by('Con').title, 'Con · 2 người', `${label}: the Con heading counts the children`);
    assert.deepEqual(by('Con').rows.map((r) => /· (\d+) cháu$/.exec(r.sub)?.[1]), ['2', '1'], `${label}: each child row counts its grandchildren`);
    const cháu = by('Cháu');
    assert.ok(cháu, `${label}: Cháu group`);
    assert.equal(cháu.title, 'Cháu · 3 người', `${label}: the Cháu heading counts the grandchildren`);
    assert.deepEqual(cháu.rows, [
      { name: 'Dương Văn Năm', sub: 'Cháu · con của Dương Văn Hai' },
      { name: 'Dương Văn Bốn', sub: 'Cháu · con của Dương Văn Hai' },
      { name: 'Dương Thị Sáu', sub: 'Cháu · con của Dương Thị Ba' },
    ], `${label}: Cháu rows in parent then birth order`);
    assert.ok(!/Xem trên cây/.test(cháu.link || '') && !/Xem trên cây/.test(JSON.stringify(cháu)), `${label}: no Xem trên cây chip in the Cháu header`);
    const chắt = by('Chắt');
    assert.ok(chắt, `${label}: Chắt group`);
    assert.deepEqual(chắt.rows, [
      { name: 'Dương Văn Bảy', sub: 'Chắt · con của Dương Văn Năm' },
      { name: 'Dương Thị Tám', sub: 'Chắt · con của Dương Thị Sáu' },
    ], `${label}: Chắt rows`);
    // generations 4 and 5 have their own groups (Chút, Chít); only generation 6 and beyond sits behind the tree link
    const chút = by('Chút');
    assert.deepEqual(chút && chút.rows.map((r) => r.sub), ['Chút · con của Dương Văn Bảy'], `${label}: Chút group`);
    const chít = by('Chít');
    assert.deepEqual(chít && chít.rows.map((r) => r.sub), ['Chít · con của Dương Văn Chín'], `${label}: Chít group`);
    const all = g.flatMap((x) => x.rows.map((r) => r.name));
    assert.ok(!all.includes('Dương Văn Mười Một') && !all.includes('Võ Thị Mai'), `${label}: married-in spouse and her child are not descendants`);
    // Chắt and deeper: one closed fold under Cháu; the Quan hệ tab is gone
    const fold = await page.evaluate(() => { const d = document.querySelector('section.relsec details.more-fold'); return d && { open: d.open, label: d.querySelector('.more-closed')?.textContent.trim(), inside: [...d.querySelectorAll('h3.relgrp')].map((h) => h.textContent.trim()) }; });
    assert.ok(fold && !fold.open, `${label}: Chắt and deeper are folded by default`);
    assert.equal(fold.label, 'Xem thêm 3 đời · 4 người (Chắt, Chút, Chít)', `${label}: the fold names the levels and counts the people`);
    assert.deepEqual(fold.inside, ['Chắt', 'Chút', 'Chít'], `${label}: the fold holds Chắt, Chút and Chít`);
    assert.equal(await page.locator('button[data-ptab="rel"]').count(), 0, `${label}: no Quan hệ tab`);
    await page.locator('section.relsec details.more-fold > summary').first().click();
    assert.ok(await page.evaluate(() => document.querySelector('section.relsec details.more-fold').open), `${label}: the fold opens in place`);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, `${label}: no horizontal scroll (${sw})`);
    if (SHOT && label === 'after backfill') {
      const pic = async (scheme) => {
        const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
        await c2.addCookies(await ctx.cookies());
        const p2 = await c2.newPage();
        await p2.goto(base + '/#person/P812');
        await p2.waitForSelector('nav.ptabs', { timeout: 15000 });
        await p2.waitForSelector('section.relsec', { timeout: 15000 });
        await p2.waitForFunction(() => document.querySelector('section.relsec ul.ped')?.innerText.includes('Dương Văn Hai'), null, { timeout: 15000 });
        await p2.waitForTimeout(500);
        await p2.screenshot({ path: path.join(SHOT, `hoso-390-${scheme}.png`), fullPage: true });
        await c2.close();
      };
      await pic('light'); await pic('dark');
    }
  } finally { await ctx.close(); }
}

test('lineage rows before the backfill (legacy fields)', { skip }, async () => { await checkLineage('before backfill'); });

test('pedigree rows: label per path, 44 px tap height, the row opens the ancestor', { skip }, async () => {
  const { ctx, page } = await newPage(390, 'light', true);
  try {
    await openProfile(page, 'P812');
    await page.waitForFunction(() => document.querySelector('section.relsec ul.ped')?.innerText.includes('Dương Văn Hai'), null, { timeout: 15000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('section.relsec > ul.ped > li')].map((li) => ({
      depth: li.style.getPropertyValue('--d'), name: li.querySelector('.calm-n')?.textContent.trim(), label: li.querySelector('.calm-s')?.textContent.trim(),
      href: li.querySelector('a')?.getAttribute('href') || '', h: li.querySelector('a').getBoundingClientRect().height,
    })));
    // four generations, then the Thủy tổ (the father line's root, the last row); nothing is hidden, so no fold row
    assert.deepEqual(rows.map((r) => [r.depth, r.name, r.label]), [
      ['1', 'Dương Văn Chín', 'Cha'], ['2', 'Dương Văn Bảy', 'Ông nội'], ['3', 'Dương Văn Năm', 'Ông cụ'], ['4', 'Dương Văn Hai', 'Ông kỵ'],
      ['5', 'Dương Văn Gốc', 'Thủy tổ · Đời 1'],
    ], 'ancestor rows with labels per path, the Thủy tổ last');
    assert.ok(rows.every((r) => r.h >= 44), 'tap height at least 44 px');
    assert.ok(rows.every((r) => /#person\/P\d+$/.test(r.href)), 'each row opens the person');
    assert.equal(await page.locator('section[aria-label="Tổ tiên"] .ped-fold').count(), 0, 'no fold row when nothing is hidden');
    await page.locator('section.relsec ul.ped a').first().click();
    await page.waitForURL(/#person\/P809/, { timeout: 10000 });
  } finally { await ctx.close(); }
});

test('Cách gọi: Miền Nam changes the gen-4 ancestor label from "Ông kỵ" to the Southern form', { skip }, async () => {
  const { ctx, page } = await newPage(390, 'light', true);
  try {
    await openProfile(page, 'P812');
    const label = () => page.evaluate(() => [...document.querySelectorAll('section.relsec > ul.ped > li')]
      .find((li) => li.querySelector('.calm-n')?.textContent.trim() === 'Dương Văn Hai')?.querySelector('.calm-s')?.textContent.trim());
    // the Tổ tiên row can be drawn after the profile opens: wait for it, then read it
    const labelIs = (want) => page.waitForFunction((w) => [...document.querySelectorAll('section.relsec > ul.ped > li')]
      .find((li) => li.querySelector('.calm-n')?.textContent.trim() === 'Dương Văn Hai')?.querySelector('.calm-s')?.textContent.trim() === w, want, { timeout: 15000 }).catch(() => {});
    await labelIs('Ông kỵ');
    assert.equal(await label(), 'Ông kỵ', 'standard wording by default');
    // Cài đặt → Cách gọi → Miền Nam (the row and the sub-page are the only way to change it)
    await page.goto(base + '/#settings');
    await page.waitForSelector('a[href="#cach-goi"]', { timeout: 15000 });
    await page.click('a[href="#cach-goi"]');
    await page.waitForSelector('input[name=kreg][value=nam]');
    await page.check('input[name=kreg][value=nam]');
    assert.equal(await page.evaluate(() => localStorage.getItem('kinRegion')), 'nam');
    await openProfile(page, 'P812');
    await labelIs('Ông sơ');
    assert.equal(await label(), 'Ông sơ', 'Southern wording after the change');
  } finally { await ctx.close(); }
});

test('profile at 390: no empty facts card; the overflow button stays on the first action row', { skip }, async () => {
  const { ctx, page } = await newPage(390, 'light', true);
  try {
    await openProfile(page, 'P812'); // no facts at all
    const none = await page.evaluate(() => ({ dl: document.querySelectorAll('.factcard').length, ib: document.querySelector('.acts2 .ib')?.getBoundingClientRect().top, first: document.querySelector('.acts2-go > *')?.getBoundingClientRect().top, right: document.querySelector('.acts2 .ib')?.getBoundingClientRect().right, rowRight: document.querySelector('.acts2')?.getBoundingClientRect().right }));
    assert.equal(none.dl, 0, 'no facts card when the person has no facts');
    assert.ok(Math.abs(none.ib - none.first) < 3, `overflow button on the first row (${none.ib} vs ${none.first})`);
    assert.ok(none.rowRight - none.right < 24, 'overflow button at the right edge');
    await openProfile(page, 'P805'); // a birth year: the card shows
    await page.click('button[data-ptab="info"]'); // facts are on the Thông tin tab
    assert.equal(await page.evaluate(() => document.querySelectorAll('.factcard').length), 1, 'facts card when there are facts');
  } finally { await ctx.close(); }
});

test('guest cold load: no 4xx request and no console error on the app and on a profile', { skip }, async () => {
  const { ctx, page, bad, errs } = await newPage(390, 'light', false);
  try {
    await page.goto(base + '/');
    await page.waitForSelector('#main', { timeout: 15000 });
    await page.waitForTimeout(800);
    await openProfile(page, 'P801');
    await page.waitForTimeout(800);
    assert.deepEqual(bad, [], 'no 4xx responses for a guest');
    assert.deepEqual(errs, [], 'no console errors for a guest');
  } finally { await ctx.close(); }
});

test('lineage rows after the backfill (tables), same rows', { skip }, async () => {
  const B = require(MOD('scripts/rel-backfill'));
  const plan = await B.plan(pool, await B.loadFamily(pool, 'duong'));
  await B.apply(pool, plan, { backupDir: fs.mkdtempSync(path.join(os.tmpdir(), 'desc-e2e-')), by: 'e2e' });
  await checkLineage('after backfill');
});
