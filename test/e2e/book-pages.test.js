// E2E: the book has the same page count at 390 px, 1280 px and in print, and the same as a full render (every page loaded).
// Pages are A4 boxes laid out at the 842 px reference and scaled as a whole. Demo seed (server/seed/demo-persons.json), mocked API.
//   NODE_PATH=<dir with playwright> node --test test/e2e/book-pages.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { FONTS, seedPlan, staticServer, mockApi } = require('./_book-mock');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !chromium ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;

let base; let srv;
test.before(async () => {
  if (skip) return;
  srv = staticServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv?.close(); });

// Pages with content: every page the plan has, once each is filled.
async function loadedPages(browser, width, height, print) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height } });
  const page = await ctx.newPage();
  await page.route(FONTS, (r) => r.abort());
  await mockApi(page);
  await page.goto(base + '/book?embed=1');
  await page.waitForSelector('.pg .cover');
  // a tall viewport puts every page in range, so the whole book is filled
  await page.setViewportSize({ width, height: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.pg').length && document.querySelectorAll('.pg[data-n]').length === document.querySelectorAll('.pg').length && [...document.querySelectorAll('.pg')].every((p) => p.children.length > (p.querySelector('.foot') ? 1 : 0)), null, { timeout: 20000 });
  await page.waitForTimeout(300);
  if (print) await page.emulateMedia({ media: 'print' });
  const n = await page.evaluate(() => [...document.querySelectorAll('.pg')].filter((p) => p.querySelector('.cover, .ch, .opener, .chart, .entry, .genh, .ie, .il, .ve, .toc')).length);
  const total = await page.locator('.pg').count();
  await ctx.close();
  return { n, total };
}

test('book page count is the same at 390, 1280 and in print, and equals the plan', { skip }, async () => {
  const expected = (await seedPlan('')).pages.length;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const phone = await loadedPages(browser, 390, 844, false);
    const desk = await loadedPages(browser, 1280, 800, false);
    const printed = await loadedPages(browser, 1280, 800, true);
    assert.equal(phone.total, expected, '390 px: page boxes differ from the plan');
    assert.equal(phone.n, expected, '390 px: pages without content after a full load');
    assert.equal(desk.n, phone.n, '1280 px page count differs from 390 px');
    assert.equal(printed.n, phone.n, 'print page count differs from screen');
    assert.ok(phone.n > 20, `expected a full book, got ${phone.n} pages`);
  } finally { await browser.close(); }
});
