'use strict';
// Screenshots of the person form, drafts, the back bar and the book (only with GP_SHOT_DIR; the tests skip without it).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');
const { setBase, open, openIn, expand, editName } = require('./_form-mock');

let srv;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; setBase(w.base);
});
test.after(() => { srv?.close(); });


test('screenshots (only with GP_SHOT_DIR)', { skip: skip || !SHOTS }, async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launch();
  try {
    const a = await open(browser, { role: 'editor', path: '#person/PA' });
    await a.page.locator('[data-menu="PA"]').first().click();
    await a.page.locator('.menu [data-act="child"][data-id="PA"]').click();
    await a.page.waitForSelector('#fpform');
    await expand(a.page, 'sinh');
    await a.page.fill('input[name=birth_smart]', '1958');
    await a.page.waitForTimeout(200);
    await a.page.screenshot({ path: path.join(SHOTS, 'them-390.png'), fullPage: true });
    await a.ctx.close();
    const d = await editName(browser, 'Tên nháp để chụp');
    const dctx = d.ctx; await d.page.close();
    const rb = await openIn(dctx, { role: 'editor', path: '#sua/K2' });
    await rb.page.waitForSelector('.fp-draft');
    await rb.page.screenshot({ path: path.join(SHOTS, 'restore-390.png'), fullPage: true });
    await rb.page.goto(base + '/#mine');
    await rb.page.waitForSelector('text=Bản nháp');
    await rb.page.screenshot({ path: path.join(SHOTS, 'mine-drafts-390.png'), fullPage: true });
    await dctx.close();
    const q = await open(browser, { role: 'guest', path: '#sua/K2' });
    await expand(q.page, 'ten');
    q.log.offline = true;
    await q.page.fill('input[name=name]', 'Tên đang chờ');
    await q.page.click('.fp-bar button[type=submit]');
    await q.page.waitForSelector('text=Đang chờ gửi');
    await q.page.screenshot({ path: path.join(SHOTS, 'mine-queued-390.png'), fullPage: true });
    q.log.offline = false;
    await q.ctx.close();
    for (const [role, scheme, file] of [['editor', 'light', 'more-owner-390-light.png'], ['editor', 'dark', 'more-owner-390-dark.png'], ['guest', 'light', 'more-guest-390-light.png'], ['guest', 'dark', 'more-guest-390-dark.png']]) {
      const m = await open(browser, { role, path: '#more', scheme });
      await m.page.screenshot({ path: path.join(SHOTS, file), fullPage: true });
      await m.ctx.close();
    }
    for (const [scheme, file, vp] of [['light', 'sua-390-light.png', { width: 390, height: 844 }], ['dark', 'sua-390-dark.png', { width: 390, height: 844 }], ['light', 'sua-1280.png', { width: 1280, height: 900 }]]) {
      const s = await open(browser, { role: 'editor', path: '#sua/K2', viewport: vp, scheme });
      await s.page.waitForTimeout(200);
      await s.page.screenshot({ path: path.join(SHOTS, file), fullPage: true });
      await s.ctx.close();
    }
  } finally { await browser.close(); }
});

test('screenshots of the back bar and the pages (GP_SHOT_DIR)', { skip: skip || !SHOTS }, async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launch();
  try {
    for (const [file, hash, vp] of [['person-390.png', '#person/K2', { width: 390, height: 844 }], ['form-390.png', '#sua/K2', { width: 390, height: 844 }],
      ['settings-390.png', '#settings', { width: 390, height: 844 }], ['person-1280.png', '#person/K2', { width: 1280, height: 900 }]]) {
      const s = await open(browser, { role: 'editor', path: hash, viewport: vp });
      await s.page.waitForTimeout(250);
      await s.page.screenshot({ path: path.join(SHOTS, file), fullPage: true });
      await s.ctx.close();
    }
  } finally { await browser.close(); }
});

test('book screenshots and print PDF (GP_SHOT_DIR)', { skip: skip || !SHOTS }, async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launch();
  try {
    for (const [file, vp] of [['book-390.png', { width: 390, height: 844 }], ['book-1280.png', { width: 1280, height: 900 }]]) {
      const s = await open(browser, { role: 'editor', path: '#sua/K2', viewport: vp });
      await s.page.goto(base + '/book');
      await s.page.waitForSelector('.pg', { timeout: 8000 });
      await s.page.waitForTimeout(300);
      await s.page.screenshot({ path: path.join(SHOTS, file), fullPage: true });
      if (file === 'book-390.png') {
        const counts = await s.page.$$eval('.stats', (els) => els.map((e) => e.textContent));
        assert.ok(counts.some((t) => /3\d\d|4\d\d/.test(t)), 'cover count present');
        await s.page.pdf({ path: path.join(SHOTS, 'book-print.pdf'), format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
      }
      await s.ctx.close();
    }
  } finally { await browser.close(); }
});
