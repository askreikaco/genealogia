// E2E: the book on a phone (iPhone 13 emulation). Every page is an 842x595 px box laid out at the reference size and scaled
// with transform (no zoom): all content stays inside its page box, the cover shows its stats row, the 楊 tile keeps its
// reference size, the scale follows the width (resize, orientation), the page count equals the plan, and print keeps the
// print layout (no transform, zoom 1.33; 54-page PDF for the seed). Chromium always; WebKit when it can launch on this host.
//   NODE_PATH=<dir with playwright> node --test test/e2e/book-ios.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { FONTS, seedPlan, staticServer, mockApi } = require('./_book-mock');

let pw = null;
try { pw = require('playwright'); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !pw ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;

let base; let srv; const browsers = {};
const engines = [];
test.before(async () => {
  if (skip) return;
  srv = staticServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browsers.chromium = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  engines.push({ name: 'chromium', browser: browsers.chromium, skip: false });
  // WebKit is the engine iPhone Safari uses. It needs its own browser build and host libraries: skipped when it cannot launch.
  try { browsers.webkit = await pw.webkit.launch({ headless: true }); engines.push({ name: 'webkit', browser: browsers.webkit, skip: false }); }
  catch (e) { engines.push({ name: 'webkit', browser: null, skip: 'WebKit cannot launch on this host: ' + String(e.message).split('\n')[0] }); }
});
test.after(async () => {
  for (const b of Object.values(browsers)) await b.close().catch(() => {});
  srv?.close();
});

async function openPhone(browser, vp = { width: 390, height: 664 }) {
  const ctx = await browser.newContext({ ...pw.devices['iPhone 13'], serviceWorkers: 'block', viewport: vp });
  const page = await ctx.newPage();
  await page.route(FONTS, (r) => r.abort());
  await mockApi(page);
  await page.goto(base + '/book?inapp=1');
  await page.waitForSelector('.pg .cover', { state: 'visible' });
  return { ctx, page };
}

// Every page filled (a tall viewport puts the whole book in range; the scale depends on the width only).
async function fillAll(page) {
  await page.setViewportSize({ width: (await page.evaluate(() => innerWidth)), height: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.pg')].every((p) => p.children.length > (p.querySelector('.foot') ? 1 : 0)), null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

// Layout facts of every page, read in the page: sizes in layout px, content rectangles against the page rectangle.
const measure = () => {
  const pages = [...document.querySelectorAll('.pg')];
  const out = { s: getComputedStyle(document.getElementById('pages')).getPropertyValue('--s').trim(), vw: innerWidth, docW: document.documentElement.scrollWidth, sizes: [], pgw: [], outside: [], filled: 0, cover: null };
  for (const pg of pages) {
    out.sizes.push(pg.offsetWidth + 'x' + pg.offsetHeight);
    out.pgw.push(Math.round(pg.parentElement.getBoundingClientRect().width * 100) / 100);
    if (pg.children.length > (pg.querySelector('.foot') ? 1 : 0)) out.filled++;
    const pr = pg.getBoundingClientRect();
    for (const el of pg.querySelectorAll('*')) {
      const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
      if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1 || r.left < pr.left - 1 || r.top < pr.top - 1) {
        out.outside.push([+pg.dataset.n, el.className || el.tagName, Math.round(r.bottom - pr.bottom), Math.round(r.right - pr.right)]);
        break;
      }
    }
  }
  const cv = document.querySelector('.pg.cv'); const st = cv && cv.querySelector('.stats');
  if (st) {
    const pr = cv.getBoundingClientRect(); const sr = st.getBoundingClientRect();
    out.cover = { statsBottomInPage: sr.bottom <= pr.bottom - 4, stats: [...st.querySelectorAll('b')].map((b) => b.textContent), sealW: cv.querySelector('.seal').offsetWidth };
  }
  return out;
};

for (const engine of ['chromium', 'webkit']) {
  const eng = () => engines.find((e) => e.name === engine) || { name: engine, browser: null, skip: 'engine not started' };

  test(`${engine} iPhone: every page box holds its content, the cover shows its stats`, { skip }, async (t) => {
    if (eng().skip) return t.skip(eng().skip);
    const plan = await seedPlan('');
    for (const vp of [{ width: 390, height: 664 }, { width: 320, height: 568 }]) {
      const { ctx, page } = await openPhone(eng().browser, vp);
      try {
        await fillAll(page);
        const m = await page.evaluate(measure);
        const label = `${engine} ${vp.width}px`;
        const expectS = Math.min(1, (vp.width - 32) / 842);
        assert.ok(Math.abs(parseFloat(m.s) - expectS) < 0.001, `${label}: scale ${m.s}, expected ${expectS.toFixed(4)}`);
        assert.ok(m.docW <= vp.width, `${label}: horizontal scroll (${m.docW} px)`);
        assert.equal(m.filled, plan.pages.length, `${label}: pages with content differ from the plan`);
        assert.equal(new Set(m.sizes).size, 1, `${label}: page boxes differ in layout size: ${[...new Set(m.sizes)]}`);
        assert.equal(m.sizes[0], '842x595', `${label}: the page is not the 842x595 reference box`);
        for (const w of m.pgw) assert.ok(Math.abs(w - 842 * expectS) < 1.5, `${label}: page box ${w} px wide`);
        assert.deepStrictEqual(m.outside, [], `${label}: content outside its page box`);
        assert.ok(m.cover && m.cover.statsBottomInPage, `${label}: the cover stats row is cut off`);
        assert.ok(m.cover.stats.length === 2 && m.cover.stats.every((x) => x && x !== '0'), `${label}: cover stats ${m.cover?.stats}`);
        assert.ok(Math.abs(m.cover.sealW - 220) <= 1, `${label}: seal tile ${m.cover.sealW} px, reference is 220`);
      } finally { await ctx.close(); }
    }
  });
}

test('chromium iPhone: the scale follows a resize and an orientation change', { skip }, async () => {
  const { ctx, page } = await openPhone(browsers.chromium);
  try {
    await fillAll(page);
    await page.setViewportSize({ width: 844, height: 390 }); // landscape
    await page.waitForTimeout(300);
    const land = await page.evaluate(measure);
    assert.ok(Math.abs(parseFloat(land.s) - (812 / 842)) < 0.001, `landscape scale ${land.s}, expected ${(812 / 842).toFixed(4)} (844 px wide)`);
    assert.deepStrictEqual(land.outside, [], 'landscape: content outside its page box');
    await page.setViewportSize({ width: 390, height: 664 });
    await page.waitForTimeout(300);
    const back = await page.evaluate(measure);
    assert.ok(Math.abs(parseFloat(back.s) - (358 / 842)) < 0.001, `portrait scale ${back.s}`);
    assert.deepStrictEqual(back.outside, [], 'portrait after rotate: content outside its page box');
  } finally { await ctx.close(); }
});

test('chromium: print keeps the print layout (no transform, zoom 1.33) and a 54-page PDF', { skip }, async () => {
  const plan = await seedPlan('');
  const { ctx, page } = await openPhone(browsers.chromium);
  try {
    await fillAll(page);
    await page.emulateMedia({ media: 'print' });
    const p = await page.evaluate(() => { const pg = document.querySelector('.pg'); const cs = getComputedStyle(pg); return { transform: cs.transform, zoom: cs.zoom}; });
    assert.equal(p.transform, 'none', 'print: a page is still transformed');
    assert.equal(p.zoom, '1.33', 'print: zoom is not the print zoom');
    const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
    const count = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.equal(count, plan.pages.length, `PDF pages ${count}, plan ${plan.pages.length}`);
  } finally { await ctx.close(); }
});
