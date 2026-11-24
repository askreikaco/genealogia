// E2E: a mother's own line in Tổ tiên. Bà kỵ (the mother of Ông cụ) has a father and a grandfather on record: under her a
// ghost row "Họ Võ · 2 đời" (collapsed by default) opens her father line in place, which ends with "Thủy tổ họ Võ". The
// main line keeps its own fold ("2 đời ẩn · 4 người", before the Thủy tổ). Own schema (e2e_tmother). Needs
// GP_TEST_DATABASE_URL (scratch DB) and playwright. GP_SHOT_DIR=<dir> also writes the 390 px dark screenshots (DPR 1).
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

const OWNER = 'owner-tmother-e2e@test.local';
const SUBJECT = 'TT801';
// Father line of seven generations: F1 (father of the subject) ... F7 = Thủy tổ (data gen 1). W_k is the wife of F_(k+1)
// and the mother of F_k; W0 is the subject's mother. The walk puts F5 (gen 5), F6 (gen 6) and W5, W4 behind the fold.
// Legacy fields (as descendants.test.js): a child has its father in `parent`; a wife is `spouse_of` her husband.
const P = (id, name, sex, gen, extra = {}) => ({ id, data: { name, sex, gen, fam: 'duong', ...extra } });
const FATHERS = ['Dương Văn Nhất', 'Dương Văn Nhì', 'Dương Văn Tam', 'Dương Văn Tứ', 'Dương Văn Ngũ', 'Dương Văn Lục', 'Dương Văn Thất'];
const WIVES = ['Võ Thị Một', 'Võ Thị Nhì', 'Võ Thị Ba', 'Võ Thị Tư', 'Võ Thị Năm', 'Võ Thị Sáu'];
// the father line of Bà kỵ (TW3): her father TV1 (legacy parent field) and his father TV2, the root of her line
const MOTHER_LINE = [P('TV1', 'Võ Văn Chín', 'm', null, { parent: 'TV2', order: 1 }), P('TV2', 'Võ Văn Mười', 'm', null)];
const FIX = [P(SUBJECT, 'Dương Thị Hậu', 'f', 8, { parent: 'TF1', order: 1 })];
FATHERS.forEach((n, i) => FIX.push(P('TF' + (i + 1), n, 'm', 7 - i, i < 6 ? { parent: 'TF' + (i + 2), order: 1 } : {})));
WIVES.forEach((n, k) => FIX.push(P('TW' + k, n, 'f', null, { spouse_of: 'TF' + (k + 1), spouse_n: 1 })));
FIX.find((r) => r.id === SUBJECT).data.order = 1;

const FIX_ALL = [...FIX, ...MOTHER_LINE];
let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'tmother');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  for (const r of FIX_ALL) await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [r.id, 'duong', r.data, 'e2e']);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e','duong','owner','active') on conflict (family_id, email) do nothing", [OWNER]);
  // the tables (parent_child, couple) from the legacy fields, as the backfill does after the migration
  const B = require(MOD('scripts/rel-backfill'));
  const plan = await B.plan(pool, await B.loadFamily(pool, 'duong'));
  await B.apply(pool, plan, { backupDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tothien-e2e-')), by: 'e2e' });
  // each child's mother (legacy data has one parent per child): W_k is the mother of the subject (k = 0) and of F_k
  for (let k = 0; k <= 5; k++) await pool.query("insert into parent_child (family_id, parent_id, child_id, kind, birth_order) values ('duong', $1, $2, 'ruot', 2)", ['TW' + k, k === 0 ? SUBJECT : 'TF' + k]);
  // Bà kỵ (TW3) has a father, Võ Văn Chín, whose father is Võ Văn Mười (the root of her line)
  await pool.query("insert into parent_child (family_id, parent_id, child_id, kind, birth_order) values ('duong', 'TV1', 'TW3', 'ruot', 1)");
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

async function newPage(scheme = 'light', dpr = 2) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Chủ họ e2e' }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage();
  return { ctx, page };
}

const openSubject = async (page) => {
  await page.goto(base + '/#person/' + SUBJECT);
  await page.waitForSelector('section[aria-label="Tổ tiên"] .ped li', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('section[aria-label="Tổ tiên"]')?.innerText.includes('Thủy tổ'), null, { timeout: 15000 });
};

// The chain as the top-level rows of the Tổ tiên list: fold rows report their own state and the rows inside them.
const chain = (page) => page.evaluate(() => {
  const ul = document.querySelector('section[aria-label="Tổ tiên"] > ul.ped');
  // a row inside the fold is shown when the fold is open (a closed details keeps its boxes, so layout is no test)
  const vis = (el) => { const d = el.closest('details'); return !!d && d.open; };
  return [...ul.children].map((li) => {
    if (li.classList.contains('ped-fold')) {
      const d = li.querySelector(':scope > details');
      return { fold: true, label: d.querySelector('summary .gh-closed').textContent.trim(), open: d.open,
        inner: [...d.querySelectorAll('li')].map((x) => ({ d: +x.style.getPropertyValue('--d'), name: x.querySelector('.calm-n').textContent.trim(), label: x.querySelector('.calm-s').textContent.trim(), shown: vis(x), x: Math.round(x.querySelector('.calm').getBoundingClientRect().left), top: Math.round(x.getBoundingClientRect().top) })) };
    }
    return { name: li.querySelector('.calm-n').textContent.trim(), label: li.querySelector('.calm-s').textContent.trim(), d: +li.style.getPropertyValue('--d'), x: Math.round(li.querySelector('.calm').getBoundingClientRect().left), top: Math.round(li.getBoundingClientRect().top) };
  });
});

// Names of the rows that are on screen (every fold around them open), in DOM order.
const shownNames = (page) => page.evaluate(() => [...document.querySelectorAll('section[aria-label="Tổ tiên"] .calm-n:not(.ghost-n)')]
  .filter((n) => { let d = n.closest('details'); while (d) { if (!d.open) return false; d = d.parentElement?.closest('details'); } return true; })
  .map((n) => n.textContent.trim()));
// The top-level chain, one entry per row or ghost row: "fold:<label>" for a ghost, the name for a row.
const top = (page) => page.evaluate(() => [...document.querySelector('section[aria-label="Tổ tiên"] > ul.ped').children].map((li) => (li.classList.contains('ped-fold')
  ? { ghost: li.querySelector(':scope > details > summary .gh-closed').textContent.trim(), open: li.querySelector(':scope > details').open, tiles: li.querySelectorAll(':scope > details > summary .ghost-tile .crest-sq').length }
  : { name: li.querySelector('.calm-n').textContent.trim(), label: li.querySelector('.calm-s').textContent.trim(), d: +li.style.getPropertyValue('--d') })));

test('Tổ tiên: a mother line folds under her in place; the main fold is unaffected', { skip }, async () => {
  const { ctx, page } = await newPage('light', 2);
  try {
    await openSubject(page);
    const t = await top(page);
    // collapsed: the main fold and Bà kỵ's ghost "Họ Võ · 2 đời" right under her; nothing of her line is shown
    const brief = t.map((x) => (x.ghost ? `ghost:${x.ghost}` : x.name));
    assert.deepEqual(brief, ['Dương Văn Nhất', 'Dương Văn Nhì', 'Dương Văn Tam', 'Dương Văn Tứ', 'ghost:2 đời ẩn · 4 người', 'Dương Văn Thất',
      'Võ Thị Tư', 'ghost:Họ Võ · 2 đời', 'Võ Thị Ba', 'Võ Thị Nhì', 'Võ Thị Một'], 'collapsed: the main fold as before, the mother line behind a ghost under Bà kỵ');
    assert.equal(t.find((x) => x.ghost === '2 đời ẩn · 4 người').open, false, 'main fold closed');
    assert.equal(t.find((x) => x.ghost === '2 đời ẩn · 4 người').tiles, 3, 'main ghost: three overlapping mini crests');
    const her = t.find((x) => x.ghost === 'Họ Võ · 2 đời');
    assert.equal(her.open, false, 'her ghost is closed by default');
    assert.deepEqual(await shownNames(page).then((n) => n.filter((x) => /Chín|Mười/.test(x))), [], 'her line is not on screen while closed');
    // the ghost row and a person row have the same height; the ghost sits one indent under Bà kỵ
    const geo = await page.evaluate(() => {
      const row = [...document.querySelectorAll('section[aria-label="Tổ tiên"] a.calm, section[aria-label="Tổ tiên"] button.calm')].find((a) => a.querySelector('.calm-n')?.textContent.trim() === 'Võ Thị Tư');
      const ghost = document.querySelectorAll('section[aria-label="Tổ tiên"] .ghost-row')[1];
      const cha = document.querySelector('section[aria-label="Tổ tiên"] a.calm');
      return { rowH: Math.round(row.getBoundingClientRect().height), ghostH: Math.round(ghost.getBoundingClientRect().height), rowX: Math.round(row.getBoundingClientRect().left), ghostX: Math.round(ghost.getBoundingClientRect().left), step: Math.round(document.querySelectorAll('section[aria-label="Tổ tiên"] a.calm')[1].getBoundingClientRect().left - cha.getBoundingClientRect().left) };
    });
    assert.equal(geo.ghostH, geo.rowH, 'the ghost row is as tall as a person row');
    assert.ok(Math.abs(geo.ghostX - (geo.rowX + geo.step)) <= 1, `the ghost sits one indent under Bà kỵ (${geo.ghostX} vs ${geo.rowX}+${geo.step})`);

    // expand her ghost: her father and the Thủy tổ họ Võ, in place, under her and before Bà cụ
    const ghostSummary = page.locator('section[aria-label="Tổ tiên"] > ul.ped > li.ped-fold').nth(1).locator('> details > summary');
    await ghostSummary.click();
    const t2 = await top(page);
    assert.equal(t2.find((x) => x.ghost === 'Họ Võ · 2 đời').open, true, 'her ghost opens');
    const names = await shownNames(page);
    assert.deepEqual(names, ['Dương Văn Nhất', 'Dương Văn Nhì', 'Dương Văn Tam', 'Dương Văn Tứ', 'Dương Văn Thất', 'Võ Thị Tư', 'Võ Văn Chín', 'Võ Văn Mười', 'Võ Thị Ba', 'Võ Thị Nhì', 'Võ Thị Một'],
      'expanded: her father and grandfather between her and Bà cụ; the main fold still closed');
    const inner = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Tổ tiên"] > ul.ped > li.ped-fold')[1].querySelectorAll('li')].map((x) => ({ d: +x.style.getPropertyValue('--d'), name: x.querySelector('.calm-n').textContent.trim(), label: x.querySelector('.calm-s').textContent.trim() })));
    assert.deepEqual(inner.map((x) => x.d), [5, 6], 'her father one indent under her, the Thủy tổ one deeper');
    assert.equal(inner[1].label, 'Thủy tổ họ Võ', 'her line ends with the Thủy tổ họ Võ');
    assert.equal(inner[0].name, 'Võ Văn Chín');
    assert.equal(t2.find((x) => x.ghost === '2 đời ẩn · 4 người').open, false, 'the main fold is unaffected');
    // fold her line back
    await ghostSummary.click();
    assert.deepEqual(await shownNames(page).then((n) => n.filter((x) => /Chín|Mười/.test(x))), [], 'folded back: her line hidden again');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, `no horizontal scroll (${sw})`);
  } finally { await ctx.close(); }
});

test('Tổ tiên: both folds open, the rows in place (main fold, then the mother line, then the wives)', { skip }, async () => {
  const { ctx, page } = await newPage('light', 2);
  try {
    await openSubject(page);
    await page.locator('section[aria-label="Tổ tiên"] > ul.ped > li.ped-fold').nth(0).locator('> details > summary').click();
    await page.locator('section[aria-label="Tổ tiên"] > ul.ped > li.ped-fold').nth(1).locator('> details > summary').click();
    assert.deepEqual(await shownNames(page), ['Dương Văn Nhất', 'Dương Văn Nhì', 'Dương Văn Tam', 'Dương Văn Tứ',
      'Dương Văn Ngũ', 'Dương Văn Lục', 'Võ Thị Sáu', 'Võ Thị Năm', 'Dương Văn Thất',
      'Võ Thị Tư', 'Võ Văn Chín', 'Võ Văn Mười', 'Võ Thị Ba', 'Võ Thị Nhì', 'Võ Thị Một'], 'DOM order with both open');
    const hidden = await page.evaluate(() => document.querySelectorAll('section[aria-label="Tổ tiên"] .ghost-row')[0].querySelector('.gh-open').textContent.trim());
    assert.equal(hidden, 'Thu gọn', 'the open main fold reads Thu gọn');
  } finally { await ctx.close(); }
});

test('Tổ tiên: 390 px dark screenshots, folded and both open (DPR 1)', { skip: skip || !SHOT }, async () => {
  const { ctx, page } = await newPage('dark', 1);
  try {
    await openSubject(page);
    const shot = async (file) => {
      await page.evaluate(() => { for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); if (cs.position === 'fixed' && el.getBoundingClientRect().bottom >= window.innerHeight - 2 && el.getBoundingClientRect().height < 120) el.style.visibility = 'hidden'; } window.scrollTo(0, 0); });
      const box = await page.evaluate(() => { const r = document.querySelector('section[aria-label="Tổ tiên"]').getBoundingClientRect(); return { x: 0, y: r.top + window.scrollY - 8, width: 390, height: r.height + 16 }; });
      await page.screenshot({ path: path.join(SHOT, file), fullPage: true, clip: box });
    };
    await shot('mother-390-dark-folded.png');
    await page.locator('section[aria-label="Tổ tiên"] > ul.ped > li.ped-fold').nth(0).locator('> details > summary').click();
    await page.locator('section[aria-label="Tổ tiên"] > ul.ped > li.ped-fold').nth(1).locator('> details > summary').click();
    await shot('mother-390-dark-both-open.png');
  } finally { await ctx.close(); }
});
