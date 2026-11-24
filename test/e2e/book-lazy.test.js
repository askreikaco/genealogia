// E2E: the book is built lazily. First page fast on a phone, only the persons of pages near the viewport are requested,
// far pages are emptied again, chart pages and entry columns are not clipped, and print loads every page first (with progress).
//   NODE_PATH=<dir with playwright> node --test test/e2e/book-lazy.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { FONTS, seedPlan, staticServer, mockApi } = require('./_book-mock');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !chromium ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;

let base; let srv; let browser;
test.before(async () => {
  if (skip) return;
  srv = staticServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
});
test.after(async () => { await browser?.close(); srv?.close(); });

async function open(width, height, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(FONTS, (r) => r.abort());
  const log = [];
  await mockApi(page, log);
  if (opts.init) await page.addInitScript(opts.init);
  return { ctx, page, log };
}

// Not a wall-clock race: the claim is structural. The first page is painted before the page asks for persons of any
// page beyond the first screen, and the persons asked for before that paint are no more than the first page's own.
// The 6000 ms ceiling is only there to catch a real hang (the page never painting); it is far above any normal load,
// so a slow or loaded CI runner does not fail the test. The log is read the moment the cover is visible.
test('first page is on screen fast on a phone, and only near pages ask for persons', { skip }, async () => {
  const { ctx, page, log } = await open(390, 844);
  try {
    const plan = await seedPlan('');
    const t0 = Date.now();
    await page.goto(base + '/book?embed=1');
    await page.waitForSelector('.pg .cover', { state: 'visible' });
    const firstMs = Date.now() - t0;
    // the near pages: the pages within one viewport above or below the screen, the same zone the page loads for
    // (IntersectionObserver rootMargin 100%). Pages beyond that zone are the "far" ones of the assertions below.
    const near = await page.evaluate(() => [...document.querySelectorAll('.pg')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > -innerHeight && r.top < 2 * innerHeight; }).map((el) => Number(el.dataset.n)));
    const nearIds = new Set(plan.pages.filter((p) => near.includes(p.n)).flatMap((p) => p.ids || []));
    // persons asked for before the first paint
    const atPaint = log.filter((x) => x.path === '/api/persons').flatMap((x) => x.ids);
    const asked = new Set(atPaint);
    assert.ok(asked.size <= nearIds.size, `${asked.size} person ids requested before the first paint; the near pages (${near.join(', ')}) hold ${nearIds.size}`);
    assert.ok([...asked].every((id) => nearIds.has(id)), 'a person of a page beyond the near zone was requested before the first paint');
    const far = plan.pages.filter((p) => p.n >= 40).flatMap((p) => p.ids);
    const farOnly = far.filter((id) => !plan.pages.filter((p) => p.n < 40).some((p) => p.ids.includes(id)));
    assert.ok(!farOnly.some((id) => asked.has(id)), 'persons of far pages were requested before the first paint');
    await page.waitForTimeout(400);
    const persons = log.filter((x) => x.path === '/api/persons');
    assert.ok(persons.length <= 3, `${persons.length} persons requests for the first screen`);
    const settled = new Set(persons.flatMap((x) => x.ids));
    assert.ok(!farOnly.some((id) => settled.has(id)), 'persons of far pages were requested on the first screen');
    assert.ok(firstMs < 6000, `first page took ${firstMs} ms (ceiling 6000 ms: a hang, not a slow runner)`);
    console.log(`book first page visible in ${firstMs} ms; ids before paint ${asked.size} (near pages ${nearIds.size}); persons requests ${persons.length}`);
  } finally { await ctx.close(); }
});

test('far pages are emptied again and keep their box', { skip }, async () => {
  const { ctx, page } = await open(390, 844);
  try {
    await page.goto(base + '/book?embed=1');
    await page.waitForSelector('.pg .cover', { state: 'visible' });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => { const p1 = document.querySelector('#p1'); const last = document.querySelector('.pg[data-n="' + document.querySelectorAll('.pg').length + '"]'); return { p1Content: p1.querySelectorAll('.cover').length, p1Box: Math.round(p1.getBoundingClientRect().height), lastContent: last.querySelectorAll('.entry, .ie, .chart, .cols').length + last.querySelectorAll('.foot').length }; });
    assert.equal(r.p1Content, 0, 'page 1 still has content far away');
    assert.ok(r.p1Box > 200, 'page 1 lost its box');
    assert.ok(r.lastContent > 0, 'last page not filled at the bottom');
  } finally { await ctx.close(); }
});

test('chart pages and entry columns are not clipped', { skip }, async () => {
  const { ctx, page } = await open(1280, 30000);
  try {
    await page.goto(base + '/book?embed=1');
    await page.waitForSelector('.pg .chart, .pg .entry');
    await page.waitForFunction(() => document.querySelectorAll('.pg .entry').length > 150 && document.querySelectorAll('.pg .chart').length >= 20);
    await page.waitForTimeout(400);
    const bad = await page.evaluate(() => {
      const out = [];
      for (const pg of document.querySelectorAll('.pg')) {
        const pr = pg.getBoundingClientRect();
        const cb = pg.querySelector('.chartbox');
        if (cb) {
          const cr = cb.getBoundingClientRect();
          for (const el of cb.querySelectorAll('svg.chart, figure, .shelf')) {
            const r = el.getBoundingClientRect();
            if (r.bottom > cr.bottom + 1 || r.right > cr.right + 1 || r.top < cr.top - 1 || r.left < cr.left - 1) out.push(['chart', pg.dataset.n, Math.round(r.bottom - cr.bottom)]);
          }
        }
        for (const col of pg.querySelectorAll('.cols > .col')) {
          if (col.scrollHeight > col.clientHeight + 1) out.push(['col', pg.dataset.n, col.scrollHeight - col.clientHeight]);
        }
        for (const el of pg.querySelectorAll('.entry, .genh, .ie, .il')) {
          const r = el.getBoundingClientRect();
          if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1) out.push(['item', pg.dataset.n]);
        }
      }
      return out;
    });
    assert.deepEqual(bad, [], 'clipped content: ' + JSON.stringify(bad.slice(0, 5)));
  } finally { await ctx.close(); }
});

test('print loads every page first, shows progress, then prints', { skip }, async () => {
  const { ctx, page } = await open(390, 844, { init: 'window.__printed = 0; window.print = () => { window.__printed++; };' });
  try {
    // the toolbar (and its print button) shows with ?inapp=1; a plain /book would redirect to the app shell
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    // every value #progtxt takes is recorded in the page itself (a poll from outside can miss a fast batch)
    await page.evaluate(() => {
      window.__prog = [];
      const el = document.getElementById('progtxt');
      const rec = () => { const t = el.textContent; if (t && window.__prog.at(-1) !== t) window.__prog.push(t); };
      new MutationObserver(rec).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await page.click('#bshare');
    await page.click('#bprint');
    await page.waitForFunction(() => window.__printed === 1, null, { timeout: 20000 });
    const seen = await page.evaluate(() => window.__prog);
    const total = (await seedPlan('')).pages.length;
    assert.ok(seen.some((t) => t.startsWith('Đang chuẩn bị')), 'no progress text shown');
    assert.ok(seen.includes(`Đang chuẩn bị ${total}/${total} trang`), 'progress did not reach the total: ' + JSON.stringify(seen));
    const filled = await page.evaluate(() => [...document.querySelectorAll('.pg')].filter((p) => [...p.children].some((c) => !c.classList.contains('foot'))).length);
    assert.equal(filled, total, 'not every page is filled when printing');
  } finally { await ctx.close(); }
});
