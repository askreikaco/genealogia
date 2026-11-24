// E2E: the book page and the app shell have no hidden interactive element, and only the active nav layout is in the DOM.
// Mocked /api responses (no database). Needs playwright and Chrome: see _e2e-harness.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { skip, launch, startWeb } = require('./_e2e-harness');
const { PERSONS, FAM, setBase, AUDIT } = require('./_hidden-mock');

let srv; let base;
test.before(async () => { if (skip) return; const w = await startWeb(); srv = w.srv; base = w.base; setBase(base); });
test.after(() => { srv?.close(); });

test('book.html has no hidden interactive element (inline and standalone)', { skip }, async () => {
  const browser = await launch();
  try {
    for (const url of ['/book?inapp=1', '/book?embed=1']) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
      await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: PERSONS, next_since: 1, family: FAM }) }));
      await page.goto(base + url);
      await page.waitForTimeout(500);
      const found = await page.evaluate(AUDIT);
      assert.deepEqual(found, [], url + ': hidden interactive elements');
      await ctx.close();
    }
  } finally { await browser.close(); }
});

// One shell nav container, rendered for the active layout only: phone = bottom tab bar, >= 672 px = side nav. The inactive
// layout is absent from the DOM (not hidden with CSS).
for (const [width, cls, other] of [[390, 'tabs', 'side'], [1280, 'side', 'tabs']]) {
  test(`only the ${cls} nav is in the DOM at ${width} px`, { skip }, async () => {
    const browser = await launch();
    try {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
      await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ editor: null, role: 'guest', status: null, roles: {}, items: PERSONS, next_since: 1, ...FAM }) }));
      await page.goto(base + '/#/duong/list');
      await page.waitForTimeout(500);
      const info = await page.evaluate(() => ({ navs: [...document.querySelectorAll('nav#nav, nav.side, nav.tabs')].map((n) => n.className), items: document.querySelectorAll('#nav a').length }));
      await ctx.close();
      assert.deepEqual(info.navs, [cls], `shell nav containers at ${width} px`);
      assert.ok(info.items > 0, 'the active nav has links');
      assert.ok(other !== cls);
    } finally { await browser.close(); }
  });
}
