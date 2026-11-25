// E2E: the side nav and top bar at every width, with touch taps (iPad emulation). The top bar and the nav are both
// position:fixed under the same offset, so an iOS overscroll (pull to refresh) moves neither: their tops stay aligned.
// Tablet (672-1055 px): starts as a rail; the toggle (#sntoggle) expands and collapses it (persisted). On the rail, focus
// in the nav opens it over the page: Esc or a nav item tap gives the focus back and the rail closes again.
// Phones keep the bottom tab bar. Mocked /api (no database). Needs playwright and Chrome: see _e2e-harness.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { skip, launch, startWeb } = require('./_e2e-harness');
const { PERSONS, FAM, setBase } = require('./_hidden-mock');

// [width, height, class]: phones (portrait), tablets (portrait and landscape), desktops (landscape).
const WIDTHS = [
  [360, 740, 'phone'], [390, 844, 'phone'], [430, 932, 'phone'],
  [768, 1024, 'tablet'], [820, 1180, 'tablet'], [1024, 768, 'tablet'], [1180, 820, 'tablet'],
  [1280, 800, 'desktop'], [1440, 900, 'desktop'], [1920, 1080, 'desktop'],
];
let srv; let base;
test.before(async () => { if (skip) return; const w = await startWeb(); srv = w.srv; base = w.base; setBase(base); });
test.after(() => { srv?.close(); });

async function newPage(browser, width, height) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height }, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ editor: null, role: 'guest', status: null, roles: {}, items: PERSONS, next_since: 1, ...FAM }) }));
  await page.goto(base + '/#/duong/tree');
  await page.waitForSelector('#nav a', { timeout: 10000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}
// Layout facts for the nav, top bar and page; each assertion reads one field.
const facts = (page) => page.evaluate(() => {
  const r = (el) => el?.getBoundingClientRect();
  const t = document.querySelector('#sntoggle'); const tr = r(t); const cb = r(document.querySelector('.cbar')); const side = document.querySelector('#nav.side');
  const sr = r(side);
  return {
    navClass: document.querySelector('#nav')?.className, rail: document.body.classList.contains('rail'),
    toggle: t ? { exists: true, visible: tr.width > 0 && getComputedStyle(t).display !== 'none', expanded: t.getAttribute('aria-expanded'), controls: t.getAttribute('aria-controls') } : { exists: false },
    sideW: sr ? Math.round(sr.width) : null, sideTop: sr ? sr.top : null, barTop: cb.top, barBottom: cb.bottom, barPos: getComputedStyle(document.querySelector('.cbar')).position,
    sidePos: side ? getComputedStyle(side).position : null,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    activeInNav: !!document.activeElement?.closest?.('#nav'), activeId: document.activeElement?.id || document.activeElement?.tagName,
    // the topmost element at the toggle's centre is the toggle (or inside it): nothing covers it
    toggleTopmost: t ? t.contains(document.elementFromPoint(tr.x + tr.width / 2, tr.y + tr.height / 2)) : false,
  };
});

for (const [width, height, cls] of WIDTHS) {
  test(`${width}x${height} (${cls}): top bar and nav have no horizontal scroll, overlap or misalignment`, { skip }, async () => {
    const browser = await launch();
    try {
      const { ctx, page } = await newPage(browser, width, height);
      const f = await facts(page);
      assert.equal(f.overflowX, false, 'no horizontal page scroll');
      assert.equal(f.barPos, 'fixed', 'top bar is fixed');
      assert.equal(f.barTop, 0, 'top bar at the top');
      if (width >= 672) {
        assert.equal(f.sidePos, 'fixed', 'side nav is fixed (same positioning context as the top bar)');
        assert.equal(f.sideTop, f.barBottom, 'side nav starts under the top bar at scroll 0');
        // scrolled: both stay aligned, so an overscroll cannot leave the rail behind the top bar
        await page.evaluate(() => window.scrollTo(0, 120));
        await page.waitForTimeout(100);
        const g = await facts(page);
        assert.equal(g.barTop, 0, 'top bar still at the top after scrolling');
        assert.equal(g.sideTop, g.barBottom, 'side nav still under the top bar after scrolling');
      }
      await ctx.close();
    } finally { await browser.close(); }
  });
}

for (const [width, height] of WIDTHS.filter(([w]) => w >= 672 && w < 1056)) {
  test(`${width}x${height} (tablet): rail toggle expands and collapses; focus overlay closes on Esc and item tap`, { skip }, async () => {
    const browser = await launch();
    try {
      const { ctx, page } = await newPage(browser, width, height);
      let o = await facts(page);
      assert.equal(o.toggle.exists, true, 'toggle is in the DOM');
      assert.equal(o.toggle.visible, true, 'toggle is visible at tablet width');
      assert.equal(o.toggle.controls, 'nav');
      assert.equal(o.rail, true, 'starts as rail');
      assert.equal(o.sideW, 48);
      assert.equal(o.toggleTopmost, true, 'toggle is not covered');

      // 1. tap the toggle: expands (persistent), tap again: collapses
      await page.tap('#sntoggle');
      await page.waitForTimeout(250); // the rail animates its width (110 ms)
      o = await facts(page);
      assert.equal(o.rail, false, 'tap expands');
      assert.equal(o.toggle.expanded, 'true'); assert.equal(o.sideW, 256);
      await page.tap('#sntoggle');
      await page.waitForTimeout(250);
      o = await facts(page);
      assert.equal(o.rail, true, 'second tap collapses');
      assert.equal(o.toggle.expanded, 'false'); assert.equal(o.sideW, 48);

      // 2. focus in the rail opens it over the page; Esc gives the focus back and the rail closes
      await page.focus('#nav a.sn-link >> nth=0');
      await page.waitForTimeout(250);
      o = await facts(page);
      assert.equal(o.sideW, 256, 'focus opens the rail over the page');
      assert.equal(o.activeInNav, true);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      o = await facts(page);
      assert.equal(o.activeInNav, false, 'Esc takes the focus out of the nav');
      assert.equal(o.sideW, 48, 'Esc closes the overlay');

      // 3. a nav item tap navigates and the rail closes again
      await page.tap('#nav a.sn-link[href*="stats"]');
      await page.waitForTimeout(300);
      o = await facts(page);
      assert.match(page.url(), /#(\/duong\/)?stats$/, 'the item navigates: ' + page.url());
      assert.equal(o.activeInNav, false, 'the item tap leaves the nav');
      assert.equal(o.sideW, 48, 'choosing an item closes the overlay');
      await ctx.close();
    } finally { await browser.close(); }
  });
}

test('1180x820 (1056+): the toggle collapses and expands the rail (persistent)', { skip }, async () => {
  const browser = await launch();
  try {
    const { ctx, page } = await newPage(browser, 1180, 820);
    let o = await facts(page);
    assert.equal(o.rail, false, 'desktop-ish width starts expanded');
    assert.equal(o.toggle.expanded, 'true'); assert.equal(o.sideW, 256);
    await page.tap('#sntoggle');
    await page.waitForTimeout(250);
    o = await facts(page);
    assert.equal(o.rail, true, 'toggle collapses to the rail');
    assert.equal(o.toggle.expanded, 'false');
    await page.tap('#sntoggle');
    await page.waitForTimeout(250);
    o = await facts(page);
    assert.equal(o.rail, false, 'toggle expands again');
    assert.equal(o.toggle.expanded, 'true');
    await ctx.close();
  } finally { await browser.close(); }
});

for (const [width, height] of WIDTHS.filter(([w]) => w < 672)) {
  test(`${width}x${height}: phone keeps the bottom tab bar, no side nav`, { skip }, async () => {
    const browser = await launch();
    try {
      const { ctx, page } = await newPage(browser, width, height);
      const o = await facts(page);
      assert.equal(o.navClass, 'tabs');
      assert.equal(o.toggle.exists, false, 'no side-nav toggle on a phone');
      assert.equal(await page.locator('#nav a').first().isVisible(), true, 'the tab bar links are visible');
      await ctx.close();
    } finally { await browser.close(); }
  });
}
