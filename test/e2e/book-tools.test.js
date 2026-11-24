// E2E: book toolbar. One ListToolbar row (search, Filters, Share); the old print/embed buttons are gone; search is
// accent-insensitive and jumps to the person's page; the Filters and Share sheets open and close; the iframe code is shown.
//   NODE_PATH=<dir with playwright> node --test test/e2e/book-tools.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { FONTS, seedPersons, seedPlan, staticServer, mockApi } = require('./_book-mock');

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

async function open(width, height) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(FONTS, (r) => r.abort());
  await mockApi(page, []);
  return { ctx, page };
}
const fold = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd');

test('toolbar: one row with search, Filters and Share; the old print and embed buttons are gone', { skip }, async () => {
  const { ctx, page } = await open(390, 844);
  try {
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    assert.ok(await page.$('#tbar input#bq[type=search]'), 'search box');
    assert.ok(await page.$('#tbar .lbar [data-fp]'), 'Filters button');
    assert.ok(await page.$('#tbar #bshare'), 'Share button');
    for (const sel of ['#print', '#embed', '#embedbox', '.embedb']) assert.equal(await page.$(sel), null, sel + ' should be removed');
    const chiOutsideSheet = await page.$$eval('#chi', (els) => els.filter((e) => !e.closest('dialog')).length);
    assert.equal(chiOutsideSheet, 0, 'the chi select lives in the Filters sheet only');
  } finally { await ctx.close(); }
});

test('in the app iframe the toolbar sticks at the top with no see-through gap, also while scrolled', { skip }, async () => {
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 640 }, colorScheme: scheme });
    const page = await ctx.newPage(); await mockApi(page);
    try {
      await page.goto(base + '/book?inapp=1'); await page.waitForSelector('.pg');
      await page.evaluate(() => window.scrollTo(0, 300)); await page.waitForTimeout(200);
      const r = await page.evaluate(() => {
        const at = (y) => { const e = document.elementFromPoint(195, y); return e && e.closest('#tbar') ? 'tbar' : e && e.closest('.pages') ? 'pages' : e ? e.tagName : null; };
        const bar = document.getElementById('tbar').getBoundingClientRect();
        return { top: Math.round(bar.top), at2: at(2), at40: at(40), bg: getComputedStyle(document.getElementById('tbar')).backgroundColor };
      });
      assert.strictEqual(r.top, 0, `${scheme}: toolbar sticks at the iframe top`);
      assert.strictEqual(r.at2, 'tbar', `${scheme}: the top edge is the toolbar, not the book`);
      assert.strictEqual(r.at40, 'tbar', `${scheme}: no band where the pages show above the toolbar`);
      assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(r.bg), `${scheme}: the toolbar is opaque (${r.bg})`);
    } finally { await ctx.close(); }
  }
});

test('search is accent-insensitive and jumps to the person on their page', { skip }, async () => {
  const { ctx, page } = await open(390, 844);
  try {
    const plan = await seedPlan('');
    const onPage = new Set(plan.pages.flatMap((pg) => pg.ids || []));
    // an accented name printed as an entry on a flow page
    const entryIds = new Set(plan.pages.flatMap((pg) => (pg.cols || []).flat().filter((it) => it[0] === 1).map((it) => it[1])));
    const target = seedPersons().find((p) => entryIds.has(p.id) && onPage.has(p.id) && /[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđ]/i.test(p.data.name));
    assert.ok(target, 'seed has an accented name on a page');
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    await page.fill('#bq', fold(target.data.name)); // typed without accents
    await page.waitForSelector(`#bhits [data-goto="${target.id}"]`);
    await page.click(`#bhits [data-goto="${target.id}"]`);
    const entry = page.locator(`.entry[data-id="${target.id}"]`);
    await entry.first().waitFor({ state: 'attached' });
    assert.ok(await entry.first().evaluate((el) => el.classList.contains('hit')), 'the found entry is highlighted');
    assert.equal(await page.$eval('#bhits', (el) => el.hidden), true, 'results close after a jump');
  } finally { await ctx.close(); }
});

test('Share sheet offers print and the iframe code; Filters sheet opens and closes', { skip }, async () => {
  const { ctx, page } = await open(390, 844);
  try {
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    await page.click('#bshare');
    await page.waitForSelector('#shdlg[open]');
    assert.ok(await page.isVisible('#bprint'), 'print/PDF action visible');
    await page.click('#bembed');
    const code = await page.textContent('#embedcode');
    assert.ok(code.includes('<iframe') && code.includes('embed=1'), 'iframe code: ' + code);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('shdlg').open);
    await page.click('#tbar [data-fp]');
    await page.waitForSelector('dialog.fpanel[open] #bapply');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog.fpanel').open);
  } finally { await ctx.close(); }
});

test('Filters: a status filter changes the count line and its tag; the tag clears it', { skip }, async () => {
  const { ctx, page } = await open(390, 844);
  try {
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    // unfiltered: "328 người"; filtered: "120 / 328 người"
    const count = async () => { const m = (await page.textContent('#tbar .lcount')).match(/(\d+)(?: \/ (\d+))? người/); return m[2] ? [Number(m[1]), Number(m[2])] : [Number(m[1]), Number(m[1])]; };
    const [all0, total] = await count();
    assert.equal(all0, total, 'the whole family first');
    await page.click('#tbar [data-fp]');
    await page.waitForSelector('dialog.fpanel[open] #bapply');
    await page.check('input[name="bst"][value="dead"]');
    await Promise.all([page.waitForURL(/status=dead/), page.click('#bapply')]);
    await page.waitForSelector('#tbar .lcount');
    const [dead, total2] = await count();
    assert.equal(total2, total, 'the total is the same');
    assert.ok(dead < total, 'the count shrinks with the filter: ' + dead + ' of ' + total);
    assert.ok(await page.$('#tbar .tagx[data-untag="status"]'), 'the status tag shows');
    await Promise.all([page.waitForURL((u) => !u.searchParams.has('status')), page.click('#tbar .tagx[data-untag="status"]')]);
    const [back] = await count();
    assert.equal(back, total, 'clearing the tag restores the family');
  } finally { await ctx.close(); }
});

test('Settings: colour, font, size and layout persist after a reload; hide-living prints a placeholder', { skip }, async () => {
  const { ctx, page } = await open(390, 844);
  try {
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    await page.click('#bset');
    await page.waitForSelector('#setdlg[open] #pt');
    await page.selectOption('#pt', 'calm');
    await page.selectOption('#pf', 'sans');
    await page.selectOption('#ps', 'l');
    assert.equal(await page.getAttribute('html', 'data-bk-theme'), 'calm', 'colour applies at once');
    await page.reload();
    await page.waitForSelector('.pg .cover');
    assert.equal(await page.getAttribute('html', 'data-bk-theme'), 'calm', 'colour persists');
    assert.equal(await page.getAttribute('html', 'data-bk-font'), 'sans', 'font persists');
    assert.equal(await page.getAttribute('html', 'data-bk-size'), 'l', 'size persists');
    await page.click('#bset');
    await page.selectOption('#pl', 'summary');
    await page.waitForSelector('.pg .cover');
    assert.equal(await page.$eval('#pl', (el) => el.value), 'summary', 'layout persists');
    assert.equal(await page.$$eval('.entry', (els) => els.length), 0, 'summary prints no entries');
    await page.click('#bset');
    await page.check('#phide');
    await page.waitForSelector('.pg .cover');
    await page.click('#bset');
    assert.equal(await page.$eval('#phide', (el) => el.checked), true, 'hide-living persists');
    assert.ok((await page.textContent('body')).includes('Người còn sống'), 'living people print as a placeholder');
  } finally { await ctx.close(); }
});

test('Share: the platform sheet when Web Share exists; otherwise a menu with copy link, print and embed', { skip }, async () => {
  const withShare = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const p1 = await withShare.newPage();
  await p1.route(FONTS, (r) => r.abort()); await mockApi(p1, []);
  await p1.addInitScript(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d; }; });
  try {
    await p1.goto(base + '/book?inapp=1&family=duong');
    await p1.waitForSelector('.pg .cover');
    await p1.click('#bshare');
    const shared = await p1.waitForFunction(() => window.__shared, null, { timeout: 5000 });
    const d = await shared.jsonValue();
    assert.ok(d.url.includes('/book') && !d.url.includes('inapp'), 'the shared link is the book, without the app flag: ' + d.url);
    assert.equal(await p1.$eval('#shdlg', (el) => el.open), false, 'no menu when the platform sheet opens');
  } finally { await withShare.close(); }

  const { ctx, page } = await open(390, 844);
  try {
    await page.addInitScript(() => { delete navigator.share; });
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    await page.click('#bshare');
    await page.waitForSelector('#shdlg[open]');
    for (const sel of ['#bcopy', '#bprint', '#bembed']) assert.ok(await page.isVisible(sel), sel + ' in the fallback menu');
  } finally { await ctx.close(); }
});

test('family emblem: the cover shows the crest instead of the Hán seal when the family has one', { skip }, async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(FONTS, (r) => r.abort()); await mockApi(page, [], { emblem: true });
  try {
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    await page.waitForFunction(() => document.querySelector('.seal img.crest')?.complete && document.querySelector('.seal img.crest').naturalWidth > 0);
    assert.equal(await page.$('.seal .crest-ch'), null, 'no Hán glyph in the seal when the emblem shows');
  } finally { await ctx.close(); }
});

test('filter sheet: the footer (Xóa tất cả, Áp dụng) stays at the bottom of the sheet while the body scrolls', { skip }, async () => {
  const { ctx, page } = await open(390, 700);
  try {
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    await page.click('#tbar [data-fp]');
    await page.waitForSelector('dialog.fpanel[open] #bapply');
    const geo = await page.$eval('dialog.fpanel[open]', (d) => {
      const r = d.getBoundingClientRect(); const f = d.querySelector('.fp-foot').getBoundingClientRect();
      const b = d.querySelector('.fp-body');
      return { dialogBottom: r.bottom, footBottom: f.bottom, footIsLast: d.lastElementChild.classList.contains('fp-foot'), bodyScrolls: b.scrollHeight > b.clientHeight };
    });
    assert.ok(geo.footIsLast, 'the footer is the last part of the sheet');
    assert.ok(Math.abs(geo.dialogBottom - geo.footBottom) <= 2, 'the footer sits at the bottom edge of the sheet');
    assert.ok(geo.bodyScrolls, 'the body is the part that scrolls on a short phone');
    assert.ok(await page.isVisible('dialog.fpanel[open] #bapply'), 'Áp dụng is visible');
  } finally { await ctx.close(); }
});

test('language and Cách gọi: English wording on the page, the choice persists; Cách gọi uses the app setting key', { skip }, async () => {
  const { ctx, page } = await open(390, 844);
  try {
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    await page.click('#bset');
    await page.selectOption('#plang', 'en');
    await page.waitForSelector('.pg .cover');
    assert.equal(await page.getAttribute('html', 'lang'), 'en', 'the page language follows the setting');
    assert.equal(await page.getAttribute('#bq', 'placeholder'), 'Find a person in the book');
    assert.ok((await page.textContent('.cover .kick')).includes('Family genealogy'), 'cover kicker in English');
    await page.click('#bset');
    await page.selectOption('#preg', 'nam');
    await page.waitForSelector('.pg .cover');
    await page.click('#bset');
    assert.equal(await page.$eval('#plang', (el) => el.value), 'en', 'language persists');
    assert.equal(await page.$eval('#preg', (el) => el.value), 'nam', 'Cách gọi shows the saved choice');
    assert.equal(await page.evaluate(() => localStorage.getItem('kinRegion')), 'nam', 'stored under the app setting key');
    // the print path fills every page (the lazy pages hold the child-of lines)
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.print = () => {}; });
    await page.click('#bshare'); await page.click('#bprint');
    await page.waitForFunction(() => document.querySelectorAll('.pg .opener .cs').length > 0);
    assert.ok(/(son|daughter) of (father|mother)/.test(await page.textContent('.pg .opener .cs')), 'child-of line on a branch opener reads in English');
  } finally { await ctx.close(); }
});

test('Khổ dọc: the portrait book has portrait pages on the screen and in the print size, and it persists', { skip }, async () => {
  const { ctx, page } = await open(390, 844);
  try {
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    const outlines = []; page.on('request', (r) => { if (r.url().includes('/api/book/outline')) outlines.push(new URL(r.url()).searchParams.get('orient')); });
    const box = async () => page.$eval('.pg', (el) => { const r = el.getBoundingClientRect(); return { w: el.offsetWidth, h: el.offsetHeight }; });
    const before = await box();
    assert.ok(before.w > before.h, 'landscape by default');
    await page.click('#bset');
    await page.selectOption('#ppap', 'port');
    await page.waitForSelector('.pg .cover');
    await page.click('#bset');
    assert.equal(await page.$eval('#ppap', (el) => el.value), 'port', 'Khổ persists');
    assert.equal(await page.getAttribute('html', 'data-bk-orient'), 'port');
    const after = await box();
    assert.ok(after.h > after.w, 'portrait pages on the screen');
    assert.equal(await page.evaluate(() => !!document.getElementById('bkpage') && document.getElementById('bkpage').textContent.includes('portrait')), true, 'print size is portrait');
    assert.ok(outlines.includes('port'), 'portrait is planned on its own page size (outline asked with orient=port)');
    assert.ok(await page.$$eval('.pg', (els) => els.length) > 0, 'the portrait plan is laid out');
  } finally { await ctx.close(); }
});
