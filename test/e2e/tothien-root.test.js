// E2E: Tổ tiên ends with the Thủy tổ (the root of the direct father line), and the generations between the visible part
// and the root fold IN PLACE: "Xem thêm N đời · M người" sits right above the Thủy tổ, expanding inserts the hidden rows
// between them in DOM and visual order (with their indents and wives), and "Thu gọn" folds them back. Own schema
// (e2e_tothien). Needs GP_TEST_DATABASE_URL (scratch DB) and playwright. GP_SHOT_DIR=<dir> also writes the 390 px dark
// folded and expanded screenshots (DPR 1).
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

const OWNER = 'owner-tothien-e2e@test.local';
const SUBJECT = 'TT801';
// Father line of seven generations: F1 (father of the subject) ... F7 = Thủy tổ (data gen 1). W_k is the wife of F_(k+1)
// and the mother of F_k; W0 is the subject's mother. The walk puts F5 (gen 5), F6 (gen 6) and W5, W4 behind the fold.
// Legacy fields (as descendants.test.js): a child has its father in `parent`; a wife is `spouse_of` her husband.
const P = (id, name, sex, gen, extra = {}) => ({ id, data: { name, sex, gen, fam: 'duong', ...extra } });
const FATHERS = ['Dương Văn Nhất', 'Dương Văn Nhì', 'Dương Văn Tam', 'Dương Văn Tứ', 'Dương Văn Ngũ', 'Dương Văn Lục', 'Dương Văn Thất'];
const WIVES = ['Võ Thị Một', 'Võ Thị Nhì', 'Võ Thị Ba', 'Võ Thị Tư', 'Võ Thị Năm', 'Võ Thị Sáu'];
const FIX = [P(SUBJECT, 'Dương Thị Hậu', 'f', 8, { parent: 'TF1', order: 1 })];
FATHERS.forEach((n, i) => FIX.push(P('TF' + (i + 1), n, 'm', 7 - i, i < 6 ? { parent: 'TF' + (i + 2), order: 1 } : {})));
WIVES.forEach((n, k) => FIX.push(P('TW' + k, n, 'f', null, { spouse_of: 'TF' + (k + 1), spouse_n: 1 })));
FIX.find((r) => r.id === SUBJECT).data.order = 1;

let base, pool, srv, browser, iso;
const { isolatedDb } = require('./_isolated-db');
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);

test.before(async () => {
  if (skip) return;
  iso = isolatedDb(DB_URL, 'tothien');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  for (const r of FIX) await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [r.id, 'duong', r.data, 'e2e']);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e','duong','owner','active') on conflict (family_id, email) do nothing", [OWNER]);
  // the tables (parent_child, couple) from the legacy fields, as the backfill does after the migration
  const B = require(MOD('scripts/rel-backfill'));
  const plan = await B.plan(pool, await B.loadFamily(pool, 'duong'));
  await B.apply(pool, plan, { backupDir: fs.mkdtempSync(path.join(os.tmpdir(), 'tothien-e2e-')), by: 'e2e' });
  // each child's mother (legacy data has one parent per child): W_k is the mother of the subject (k = 0) and of F_k
  for (let k = 0; k <= 5; k++) await pool.query("insert into parent_child (family_id, parent_id, child_id, kind, birth_order) values ('duong', $1, $2, 'ruot', 2)", ['TW' + k, k === 0 ? SUBJECT : 'TF' + k]);
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

test('Tổ tiên: fold row and Thủy tổ in place after Ông kỵ, hidden rows between them, expand and fold back', { skip }, async () => {
  const { ctx, page } = await newPage('light', 2);
  try {
    await openSubject(page);
    const c = await chain(page);
    const fold = c.find((x) => x.fold);
    assert.equal(c.filter((x) => x.fold).length, 1, 'one fold row');
    const foldIdx = c.findIndex((x) => x.fold);
    // DOM order, collapsed: Cha, Ông nội, Ông cụ, Ông kỵ, the fold row, the Thủy tổ, then the wives (Bà kỵ ... Mẹ)
    assert.equal(foldIdx, 4, 'the fold row comes right after Ông kỵ (the fourth generation)');
    assert.deepEqual(c.slice(0, 4).map((r) => [r.d, r.name, r.label]), [
      [1, 'Dương Văn Nhất', 'Cha'], [2, 'Dương Văn Nhì', 'Ông nội'], [3, 'Dương Văn Tam', 'Ông cụ'], [4, 'Dương Văn Tứ', 'Ông kỵ'],
    ], 'Cha, Ông nội, Ông cụ, Ông kỵ');
    const root = c[foldIdx + 1];
    assert.deepEqual([root.name, root.label, root.d], ['Dương Văn Thất', 'Thủy tổ · Đời 1', 5], 'the Thủy tổ comes right after the fold row, one indent deeper than Ông kỵ');
    assert.deepEqual(c.slice(foldIdx + 2).map((r) => [r.d, r.name, r.label]), [
      [4, 'Võ Thị Tư', 'Bà kỵ'], [3, 'Võ Thị Ba', 'Bà cụ'], [2, 'Võ Thị Nhì', 'Bà nội'], [1, 'Võ Thị Một', 'Mẹ'],
    ], 'then the wives as before, Bà kỵ first');
    assert.equal(c.length, 10, 'ten top-level rows');
    assert.equal(fold.label, '2 đời ẩn · 4 người', 'the fold names generations 5 and 6 and counts four people');
    assert.equal(fold.open, false, 'folded by default');
    assert.deepEqual(fold.inner.map((x) => x.name), ['Dương Văn Ngũ', 'Dương Văn Lục', 'Võ Thị Sáu', 'Võ Thị Năm'], 'hidden rows in walk order');
    assert.deepEqual(fold.inner.map((x) => x.d), [5, 6, 6, 5], 'their generations: 5, 6, 6, 5');
    assert.ok(fold.inner.every((x) => !x.shown), 'hidden rows are not shown while folded');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, `no horizontal scroll (${sw})`);

    const summary = page.locator('section[aria-label="Tổ tiên"] .ped-fold > details > summary');
    await summary.click();
    const open = await chain(page);
    const f2 = open.find((x) => x.fold);
    assert.equal(f2.open, true, 'expanded in place');
    assert.ok(f2.inner.every((x) => x.shown), 'hidden rows are shown once expanded');
    // DOM order of every row, expanded: the hidden rows sit between the fold row and the Thủy tổ, before Bà kỵ
    const order = await page.evaluate(() => [...document.querySelectorAll('section[aria-label="Tổ tiên"] .calm-n:not(.ghost-n)')].map((x) => x.textContent.trim()));
    assert.deepEqual(order, ['Dương Văn Nhất', 'Dương Văn Nhì', 'Dương Văn Tam', 'Dương Văn Tứ',
      'Dương Văn Ngũ', 'Dương Văn Lục', 'Võ Thị Sáu', 'Võ Thị Năm', 'Dương Văn Thất',
      'Võ Thị Tư', 'Võ Thị Ba', 'Võ Thị Nhì', 'Võ Thị Một'], 'DOM order: fold block (hidden, then Thủy tổ) between Ông kỵ and Bà kỵ');
    const topNames = open.filter((x) => !x.fold).map((x) => x.name);
    assert.deepEqual(topNames, ['Dương Văn Nhất', 'Dương Văn Nhì', 'Dương Văn Tam', 'Dương Văn Tứ', 'Dương Văn Thất', 'Võ Thị Tư', 'Võ Thị Ba', 'Võ Thị Nhì', 'Võ Thị Một'],
      'top level: the hidden rows live inside the fold');
    // visual order: each row is below the one before it, all read in the same (expanded) state
    const visible = open.slice(0, open.findIndex((x) => x.fold));
    const rows = [...visible, ...f2.inner, open.find((x) => x.name === 'Dương Văn Thất'), ...open.slice(open.findIndex((x) => x.name === 'Dương Văn Thất') + 1)];
    assert.ok(rows.every((r, i) => i === 0 || r.top > rows[i - 1].top), 'visual order: rows go down the page in DOM order');
    // indents: one step per generation, from the visible rows; the Thủy tổ sits one step deeper than Ông kỵ
    const step = visible[1].x - visible[0].x;
    assert.ok(step > 0, 'indent steps grow with the generation');
    const ongKy = visible[3];
    const thuyTo = open.find((x) => x.name === 'Dương Văn Thất');
    assert.ok(Math.abs(thuyTo.x - (ongKy.x + step)) <= 1, 'Thủy tổ one indent deeper than Ông kỵ');
    for (const r of [...visible, ...f2.inner, thuyTo, ...open.slice(open.findIndex((x) => x.name === 'Dương Văn Thất') + 1)]) {
      assert.ok(Math.abs(r.x - (visible[0].x + (r.d - 1) * step)) <= 1, `${r.name}: indent of generation ${r.d} (${r.x} px)`);
    }
    assert.equal(f2.inner[0].x, f2.inner[3].x, 'Ngũ and his wife Năm sit at the same indent');
    assert.equal(f2.inner[1].x, f2.inner[2].x, 'Lục and his wife Sáu sit at the same indent');
    assert.equal(open.at(-1).name, 'Võ Thị Một', 'the last wife is the last row, as before');
    const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw2 <= 390, `no horizontal scroll expanded (${sw2})`);

    await summary.click();
    const back = await chain(page);
    const f3 = back.find((x) => x.fold);
    assert.equal(f3.open, false, 'folded back');
    assert.equal(f3.label, '2 đời ẩn · 4 người', 'the label is back');
    assert.ok(f3.inner.every((x) => !x.shown), 'hidden rows hidden again');
    assert.equal(back[back.findIndex((x) => x.fold) + 1].label, 'Thủy tổ · Đời 1', 'the Thủy tổ still right after the fold row');
  } finally { await ctx.close(); }
});

test('Tổ tiên: 390 px dark screenshots, folded and expanded (DPR 1)', { skip: skip || !SHOT }, async () => {
  const { ctx, page } = await newPage('dark', 1);
  try {
    await openSubject(page);
    const shot = async (file) => {
      // the fixed bottom tab bar would sit over the section in a tall capture: hidden for the shot only
      await page.evaluate(() => { for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); if (cs.position === 'fixed' && el.getBoundingClientRect().bottom >= window.innerHeight - 2 && el.getBoundingClientRect().height < 120) el.style.visibility = 'hidden'; } window.scrollTo(0, 0); });
      const box = await page.evaluate(() => { const r = document.querySelector('section[aria-label="Tổ tiên"]').getBoundingClientRect(); return { x: 0, y: r.top + window.scrollY - 8, width: 390, height: r.height + 16 }; });
      await page.screenshot({ path: path.join(SHOT, file), fullPage: true, clip: box });
    };
    await shot('tothien-390-dark-folded.png');
    await page.locator('section[aria-label="Tổ tiên"] .ped-fold > details > summary').click();
    await shot('tothien-390-dark-expanded.png');
  } finally { await ctx.close(); }
});
