// E2E: the side nav in landscape. Landscape phones (844x390, 932x430) are tablet-width (>= 672 px), so they get the
// persistent rail too; iPads (Playwright 'iPad (gen 7) landscape', 'iPad Pro 11 landscape') use the same rail rules.
// Checks, with touch taps (hasTouch, isMobile): the toggle opens and closes the nav (aria-expanded matches the rail),
// an expanded nav does not cover the page, the top bar and the nav start at the same y (also after a scroll), the
// toggle and the nav items are reachable inside the viewport, and nothing locks the page scroll or overscroll.
// WebKit (iPad Safari) is run when Playwright's WebKit can launch; otherwise the iPad cases run under Chromium with the
// iPad device descriptor and the file reports WebKit as untested. Mocked /api (no database).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { devices } = require('playwright');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');
const { PERSONS, FAM, setBase } = require('./_hidden-mock');

let webkit = null; let webkitSkip = skip || 'playwright webkit not installed';

// [name, options, startsRail]: options are the context options, startsRail is the default with no stored choice.
const DEVICES = [
  ['phone 844x390 landscape', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, true],
  ['phone 932x430 landscape', { viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, true],
];
// iPad descriptors: the device's viewport, user agent and touch flags (its defaultBrowserType is ignored here).
const IPADS = ['iPad (gen 7) landscape', 'iPad Pro 11 landscape'].map((n) => {
  const d = devices[n]; const { defaultBrowserType, ...opts } = d; void defaultBrowserType;
  return [n, opts, d.viewport.width < 1056];
});

let srv; let base;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; base = w.base; setBase(base);
  // WebKit runs only when its browser launches here (host libraries and the browser build present)
  try { const wk = require('playwright').webkit; const b = await wk.launch(); await b.close(); webkit = wk; webkitSkip = false; }
  catch (e) { webkitSkip = 'WebKit cannot launch here: ' + String(e.message).split('\n')[0]; }
});
test.after(() => { srv?.close(); });

// Runs one check with a browser: Chromium for the landscape phones and the iPad fallback, WebKit for the iPad when it runs.
async function withBrowser(kind, fn) {
  const b = kind === 'webkit' ? await webkit.launch() : await launch();
  try { await fn(b); } finally { await b.close(); }
}

async function newPage(browser, opts) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', ...opts });
  const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ editor: null, role: 'guest', status: null, roles: {}, items: PERSONS, next_since: 1, ...FAM }) }));
  await page.goto(base + '/#/duong/tree');
  await page.waitForSelector('#nav a.sn-link', { timeout: 10000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}

// Layout facts after the 110 ms width transition has settled.
const facts = async (page) => {
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const t = document.querySelector('#sntoggle'); const side = document.querySelector('#nav.side');
    const bar = r(document.querySelector('.cbar')); const sr = r(side); const tr = r(t);
    const items = document.querySelector('.sn-items'); const links = [...document.querySelectorAll('#nav a.sn-link')];
    const last = links[links.length - 1];
    const hit = document.elementFromPoint(tr.x + tr.width / 2, tr.y + tr.height / 2);
    const shell = document.querySelector('.shell');
    return {
      rail: document.body.classList.contains('rail'), expanded: t.getAttribute('aria-expanded'),
      sideW: Math.round(sr.width), sideTop: sr.top, barBottom: bar.bottom, barTop: bar.top,
      shellPad: parseFloat(getComputedStyle(shell).paddingLeft),
      toggleInView: tr.top >= 0 && tr.bottom <= window.innerHeight && tr.height >= 44,
      toggleTopmost: t.contains(hit),
      itemsScrollable: items.scrollHeight > items.clientHeight,
      lastItemReachable: (() => { items.scrollTop = items.scrollHeight; const lr = r(last); const ir = r(items); return lr.bottom <= ir.bottom + 1 && lr.top >= ir.top - 1; })(),
      scrollLocked: (() => { const h = getComputedStyle(document.documentElement); const b = getComputedStyle(document.body);
        return [h.overflow, b.overflow, h.overscrollBehavior, b.overscrollBehavior, h.position].some((v) => v === 'hidden' || v === 'clip' || v === 'none' || v === 'fixed'); })(),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      active: document.activeElement?.closest?.('#nav') ? 'nav' : document.activeElement?.tagName,
    };
  });
};

// Scrolls the page down when it can, so the top bar / nav alignment is checked while the page has moved.
async function scrollPage(page) {
  await page.evaluate(() => window.scrollTo(0, 80));
  await page.waitForTimeout(100);
}

function checkCommon(o, label) {
  assert.equal(o.overflowX, false, label + ': no horizontal page scroll');
  assert.equal(o.sideTop, o.barBottom, label + ': nav starts under the top bar');
  assert.equal(o.barTop, 0, label + ': top bar at the top');
  assert.equal(o.scrollLocked, false, label + ': page scroll and overscroll are not locked');
  assert.equal(o.toggleInView, true, label + ': toggle is inside the viewport with a 44 px target');
  assert.equal(o.toggleTopmost, true, label + ': toggle is not covered');
  assert.equal(o.lastItemReachable, true, label + ': the last nav item can be scrolled into view');
}

for (const [name, opts, startsRail] of [...DEVICES, ...IPADS]) {
  const isIpad = name.startsWith('iPad');
  test(`${name} (chromium): toggle flips the rail both ways, top bar and nav align`, { skip }, async () => {
    await withBrowser('chromium', async (browser) => {
      const { ctx, page } = await newPage(browser, opts);
      let o = await facts(page);
      assert.equal(o.rail, startsRail, 'starting state with no stored choice');
      checkCommon(o, 'start');
      // first tap flips the state (phones and 1024-wide starts: expands; iPad landscape 1080/1194: collapses)
      await page.tap('#sntoggle');
      o = await facts(page);
      assert.equal(o.rail, !startsRail, 'tap flips the rail');
      assert.equal(o.expanded, String(startsRail), 'aria-expanded matches the new state');
      assert.equal(o.sideW, startsRail ? 256 : 48, 'nav width follows the state');
      assert.equal(o.shellPad, o.sideW, 'the page follows the nav, no overlap');
      checkCommon(o, 'toggled');
      await scrollPage(page);
      checkCommon(await facts(page), 'toggled, scrolled');
      // second tap flips back
      await page.tap('#sntoggle');
      o = await facts(page);
      assert.equal(o.rail, startsRail, 'second tap flips back');
      assert.equal(o.expanded, String(!startsRail), 'aria-expanded matches');
      checkCommon(o, 'flipped back');
      assert.deepEqual(page.errors, [], 'no page errors');
      await ctx.close();
    });
  });

  test(`${name} (chromium): on the rail, a nav item tap navigates and closes the overlay`, { skip }, async () => {
    await withBrowser('chromium', async (browser) => {
      const { ctx, page } = await newPage(browser, opts);
      if (!startsRail) { await page.tap('#sntoggle'); } // collapse to the rail first
      assert.equal((await facts(page)).rail, true, 'rail before the tap');
      await page.tap('#nav a.sn-link[href*="stats"]');
      await page.waitForTimeout(300);
      const o = await facts(page);
      assert.match(page.url(), /#(\/duong\/)?stats$/, 'the item navigates: ' + page.url());
      assert.notEqual(o.active, 'nav', 'the tap leaves the nav');
      assert.equal(o.sideW, 48, 'choosing an item closes the overlay');
      await ctx.close();
    });
  });

  if (isIpad) {
    test(`${name} (webkit): rail toggle and top bar alignment (iPad Safari)`, async (t) => {
      if (webkitSkip) return t.skip(webkitSkip);
      await withBrowser('webkit', async (browser) => {
        const { ctx, page } = await newPage(browser, opts);
        let o = await facts(page);
        assert.equal(o.rail, startsRail, 'starting state');
        checkCommon(o, 'webkit start');
        await page.tap('#sntoggle');
        o = await facts(page);
        assert.equal(o.rail, !startsRail, 'tap toggles on WebKit');
        assert.equal(o.expanded, String(startsRail));
        checkCommon(o, 'webkit toggled');
        await scrollPage(page);
        checkCommon(await facts(page), 'webkit toggled, scrolled');
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/nav-ipad-webkit.png` });
        await ctx.close();
      });
    });
  }
}

// Screenshots asked for by the task: 844x390 with the rail collapsed and expanded (only when GP_SHOT_DIR is set).
test('844x390 landscape: screenshots of the rail collapsed and expanded', { skip: skip || !SHOTS }, async () => {
  await withBrowser('chromium', async (browser) => {
    const { ctx, page } = await newPage(browser, DEVICES[0][1]);
    await page.mouse.move(0, 0); await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/nav-844-collapsed.png` });
    await page.tap('#sntoggle'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/nav-844-expanded.png` });
    await ctx.close();
  });
});
