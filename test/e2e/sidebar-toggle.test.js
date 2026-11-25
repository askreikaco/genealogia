// E2E: the side nav toggle (#sntoggle, footer of the side nav) collapses and expands the nav, and the choice persists.
// Same rules as the REIKA shell: no stored choice means desktop (>= 66rem) starts expanded and tablet
// (42-65.98rem) starts as rail; a stored choice ('gp_rail' = '1' rail, '0' expanded) wins.
// Tablet (672-1055 px, e.g. iPad landscape) used to hide .sn-foot, so the toggle was 0x0 and could not be tapped.
// Mocked /api responses (no database). Needs playwright and Chrome: see _e2e-harness.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');

let srv; let base;
test.before(async () => { if (skip) return; const w = await startWeb(); srv = w.srv; base = w.base; });
test.after(() => { srv?.close(); });

// Settles the 110 ms width transition, then reads the toggle and the nav.
const side = async (page) => {
  await page.mouse.move(0, 0); await page.waitForTimeout(300);
  return page.evaluate(() => {
    const t = document.querySelector('#sntoggle'); const s = document.querySelector('.side');
    return { expanded: t.getAttribute('aria-expanded'), railClass: document.body.classList.contains('rail'),
      sideW: Math.round(s.getBoundingClientRect().width), shellPad: parseFloat(getComputedStyle(document.querySelector('.shell')).paddingLeft),
      toggle: t.getBoundingClientRect().toJSON() };
  });
};

async function open(browser, width, height) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height } });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(base + '/#/duong/list');
  await page.waitForSelector('#sntoggle');
  return { ctx, page };
}

test('tablet 1024x768: starts as rail, the toggle expands and collapses it, and the choice persists', { skip }, async () => {
  const browser = await launch();
  try {
    const { ctx, page } = await open(browser, 1024, 768);
    const start = await side(page);
    assert.equal(start.expanded, 'false', 'tablet with no stored choice starts as rail');
    assert.equal(start.sideW, 48, 'rail is 3rem');
    assert.ok(start.toggle.height >= 44 && start.toggle.width >= 44, 'toggle is a 44 px tap target');

    await page.click('#sntoggle'); // rail -> expanded
    const expanded = await side(page);
    assert.equal(expanded.expanded, 'true', 'expanded after the tap');
    assert.equal(expanded.railClass, false);
    assert.equal(expanded.sideW, 256, 'expanded nav is 16rem');
    assert.equal(expanded.shellPad, expanded.sideW, 'expanded nav does not overlap the page');

    await page.reload(); await page.waitForSelector('#sntoggle');
    assert.equal((await side(page)).expanded, 'true', 'the expanded choice persists across reload');

    await page.click('#sntoggle'); // expanded -> rail
    const collapsed = await side(page);
    assert.equal(collapsed.expanded, 'false', 'collapsed after the second tap');
    assert.equal(collapsed.sideW, 48);
    assert.equal(collapsed.shellPad, 48, 'page follows the rail');
    assert.deepEqual(page.errors, [], 'no page errors');

    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/sidebar-collapsed.png` });
      await page.click('#sntoggle'); await page.mouse.move(0, 0); await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/sidebar-expanded.png` });
    }
    await ctx.close();
  } finally { await browser.close(); }
});

test('desktop 1280x800: starts expanded and the toggle collapses and expands the nav', { skip }, async () => {
  const browser = await launch();
  try {
    const { ctx, page } = await open(browser, 1280, 800);
    assert.equal((await side(page)).expanded, 'true', 'desktop with no stored choice starts expanded');
    await page.click('#sntoggle');
    assert.equal((await side(page)).sideW, 48);
    await page.click('#sntoggle');
    assert.equal((await side(page)).sideW, 256);
    await ctx.close();
  } finally { await browser.close(); }
});
