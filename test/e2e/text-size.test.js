// E2E: Cỡ chữ (text size) in Cài đặt. Choosing "Lớn" sets html[data-text=large] and --text-scale 1.15 (tokens.css), the
// choice is kept in localStorage (gp_text) across a reload and applied before first paint, the default is normal (no
// attribute, scale 1), and at 390 px with the largest size (1.3) the person, tree and search pages do not scroll sideways.
// Mocked /api (no database):
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/text-size.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');
const { PERSONS, FAM, setBase } = require('./_hidden-mock');

let srv; let base;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; base = w.base; setBase(base);
});
test.after(() => { srv?.close(); });

async function open(browser, hash, { phone = true } = {}) {
  const ctx = await browser.newContext({
    serviceWorkers: 'block', colorScheme: 'light',
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    hasTouch: phone, isMobile: phone, deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: PERSONS, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + hash);
  await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(250);
  return { page, ctx, errors };
}

const scale = (page) => page.evaluate(() => ({
  attr: document.documentElement.dataset.text || null,
  v: getComputedStyle(document.documentElement).getPropertyValue('--text-scale').trim(),
  body: parseFloat(getComputedStyle(document.body).fontSize),
}));

// No sideways scroll on the page itself (the rule from the brief).
const overflow = (page) => page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }));

test('default is normal: no data-text attribute, scale 1, body text unscaled', { skip }, async () => {
  const browser = await launch();
  try {
    const { page, ctx, errors } = await open(browser, '/#/duong/settings');
    const s = await scale(page);
    assert.deepStrictEqual({ attr: s.attr, v: s.v }, { attr: null, v: '1' });
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); }
});

test('Cỡ chữ: "Lớn" sets the root scale, persists across reload and applies before first paint', { skip }, async () => {
  const browser = await launch();
  try {
    const { page, ctx, errors } = await open(browser, '/#/duong/settings');
    const before = await scale(page);
    const label = await page.locator('main').getByText('Cỡ chữ', { exact: true }).count();
    assert.equal(label, 1, 'the Cỡ chữ section title');
    await page.locator('input[name=txt][value=large]').check();
    const after = await scale(page);
    assert.equal(after.attr, 'large');
    assert.equal(after.v, '1.15');
    assert.ok(after.body > before.body * 1.14 && after.body < before.body * 1.16, `body ${before.body} -> ${after.body}`);
    assert.equal(await page.evaluate(() => localStorage.getItem('gp_text')), 'large');
    // persists: a reload sets the attribute from storage in index.html, and the radio shows the choice
    await page.reload();
    await page.waitForSelector('main', { timeout: 8000 });
    const reloaded = await page.evaluate(() => document.documentElement.dataset.text || null);
    assert.equal(reloaded, 'large', 'attribute kept across reload');
    await page.goto(base + '/#/duong/settings');
    await page.waitForFunction(() => document.querySelector('input[name=txt][value=large]')?.checked === true, null, { timeout: 5000 });
    // before first paint: the inline boot script in index.html sets the attribute even when app.js never loads
    const ctx2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const bare = await ctx2.newPage();
    await bare.addInitScript(() => { try { localStorage.setItem('gp_text', 'large'); } catch { /* none */ } });
    await bare.route('**/js/app.js', (r) => r.abort());
    await bare.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
    await bare.goto(base + '/');
    assert.equal(await bare.evaluate(() => document.documentElement.dataset.text || null), 'large', 'boot script applies the stored size');
    await ctx2.close();
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); }
});

test('Cỡ chữ: "Rất lớn" is 1.3 and "Vừa" returns to normal', { skip }, async () => {
  const browser = await launch();
  try {
    const { page, ctx } = await open(browser, '/#/duong/settings');
    await page.locator('input[name=txt][value=xlarge]').check();
    assert.deepStrictEqual(await scale(page).then((s) => ({ attr: s.attr, v: s.v })), { attr: 'xlarge', v: '1.3' });
    await page.locator('input[name=txt][value=normal]').check();
    assert.deepStrictEqual(await scale(page).then((s) => ({ attr: s.attr, v: s.v })), { attr: null, v: '1' });
    assert.equal(await page.evaluate(() => localStorage.getItem('gp_text')), 'normal');
    await ctx.close();
  } finally { await browser.close(); }
});

test('at 390 px with 130% the person, tree and search pages do not scroll sideways', { skip }, async () => {
  const browser = await launch();
  try {
    const pages = [['person', '/#/duong/person/PA'], ['tree', '/#/duong/tree'], ['search', '/#/duong/list']];
    for (const [name, hash] of pages) {
      const { page, ctx, errors } = await open(browser, hash);
      await page.evaluate(() => { try { localStorage.setItem('gp_text', 'xlarge'); } catch { /* none */ } });
      await page.reload();
      await page.waitForTimeout(300);
      const o = await overflow(page);
      assert.equal((await scale(page)).attr, 'xlarge', `${name}: scale applied`);
      assert.ok(o.sw <= o.cw, `${name}: scrollWidth ${o.sw} > clientWidth ${o.cw}`);
      assert.deepStrictEqual(errors, [], `${name}: page errors`);
      await ctx.close();
    }
  } finally { await browser.close(); }
});

test('screenshots for review (GP_SHOT_DIR): settings with the option, person at 100% and 130%, 390 light', { skip: skip || !SHOTS }, async () => {
  const browser = await launch();
  try {
    const { page, ctx } = await open(browser, '/#/duong/settings');
    await page.locator('main').getByText('Cỡ chữ', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'text-settings-390.png') });
    for (const [v, file] of [['normal', 'text-person-100-390.png'], ['xlarge', 'text-person-130-390.png']]) {
      await page.evaluate((x) => { try { localStorage.setItem('gp_text', x); } catch { /* none */ } }, v);
      // a new query string forces a real load: a hash-only change keeps the document, so the boot script would not run
      await page.goto(base + '/?shot=' + v + '#/duong/person/PA');
      await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, file), fullPage: false });
    }
    await ctx.close();
  } finally { await browser.close(); }
});

// Computed sizes: the h1, a .sub line and a body text node grow with the setting (real reload per size).
const sizes = (page) => page.evaluate(() => {
  const fs = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
  const body = [...document.querySelectorAll('main span, main p, main div')].find((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 3));
  return { attr: document.documentElement.dataset.text || null, h1: fs(document.querySelector('main h1')), sub: fs(document.querySelector('main .sub')), body: fs(body) };
});

test('computed font sizes grow: h1, .sub and body text are 1.15x (Lớn) and 1.3x (Rất lớn) of 100%, ±1px', { skip }, async () => {
  const browser = await launch();
  try {
    const { page, ctx, errors } = await open(browser, '/#/duong/person/PA');
    const at = {};
    for (const v of ['normal', 'large', 'xlarge']) {
      await page.evaluate((x) => { try { localStorage.setItem('gp_text', x); } catch { /* none */ } }, v);
      await page.goto(base + '/?size=' + v + '#/duong/person/PA');
      await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(250);
      at[v] = await sizes(page);
    }
    assert.equal(at.xlarge.attr, 'xlarge', 'data-text on html at 130%');
    assert.equal(at.large.attr, 'large', 'data-text on html at 115%');
    assert.equal(at.normal.attr, null, 'no data-text at 100%');
    for (const k of ['h1', 'sub', 'body']) {
      assert.ok(at.normal[k] > 0, `${k} measured at 100%`);
      assert.ok(Math.abs(at.large[k] - at.normal[k] * 1.15) <= 1, `${k} at 115%: ${at.normal[k]} -> ${at.large[k]}`);
      assert.ok(Math.abs(at.xlarge[k] - at.normal[k] * 1.3) <= 1, `${k} at 130%: ${at.normal[k]} -> ${at.xlarge[k]}`);
    }
    console.log('SIZES ' + JSON.stringify(at));
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); }
});
