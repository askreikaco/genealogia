'use strict';
// Person form drafts and offline: autosaved drafts offered on reopen, expiry, conflicts with the server, the offline queue, and a warm start of the list from this device. Mocked API (no database).
const test = require('node:test');
const assert = require('node:assert');
const { skip, launch, startWeb } = require('./_e2e-harness');
const { PERSONS, setBase, open, openIn, expand, editName, wait } = require('./_form-mock');

let srv;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; setBase(w.base);
});
test.after(() => { srv?.close(); });


test('draft: autosaved, offered on reopen, restored on Tiếp tục, dropped on Bỏ nháp', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await editName(browser, 'Tên nháp một');
    const ctx = s.ctx; await s.page.close();
    const p2 = await openIn(ctx, { role: 'editor', path: '#sua/K2' });
    await p2.page.waitForSelector('.fp-draft', { timeout: 5000 });
    assert.match(await p2.page.textContent('.fp-draft'), /Có bản nháp chưa gửi lúc \d\d:\d\d \d\d\/\d\d\/\d{4}/);
    await p2.page.click('[data-dr-go]');
    await expand(p2.page, 'ten');
    assert.equal(await p2.page.inputValue('input[name=name]'), 'Tên nháp một');
    await p2.page.close();
    // discard
    const p3 = await openIn(ctx, { role: 'editor', path: '#sua/K2' });
    await p3.page.waitForSelector('.fp-draft');
    await p3.page.click('[data-dr-drop]');
    await p3.page.click('dialog#dcf [data-rds-confirm]');
    assert.equal(await p3.page.locator('.fp-draft').count(), 0);
    await wait(p3.page, 400); // let the delete commit before the page goes
    await p3.page.close();
    const p4 = await openIn(ctx, { role: 'editor', path: '#sua/K2' });
    await wait(p4.page, 1200);
    assert.equal(await p4.page.locator('.fp-draft').count(), 0, 'no draft after Bỏ nháp');
    assert.deepEqual(p4.log.ops, [], 'a draft is never sent by itself');
    await ctx.close();
  } finally { await browser.close(); }
});

test('draft: expires after 30 days', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await editName(browser, 'Tên sẽ hết hạn');
    const ctx = s.ctx; await s.page.close();
    await ctx.addInitScript(() => { const real = Date.now; Date.now = () => real() + 31 * 24 * 3600 * 1000; });
    const p2 = await openIn(ctx, { role: 'editor', path: '#sua/K2' });
    await wait(p2.page, 1500);
    assert.equal(await p2.page.locator('.fp-draft').count(), 0, 'expired draft is not offered');
    await ctx.close();
  } finally { await browser.close(); }
});

test('draft: a record changed on the server since the draft marks the field as a conflict', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await editName(browser, 'Tên của tôi');
    const ctx = s.ctx; await s.page.close();
    const changed = PERSONS.map((x) => (x.id === 'K2' ? { ...x, v: 2, data: { ...x.data, name: 'Tên trên máy chủ' } } : x));
    const p2 = await openIn(ctx, { role: 'editor', path: '#sua/K2', persons: changed });
    await p2.page.waitForSelector('.fp-draft');
    await p2.page.click('[data-dr-go]');
    await expand(p2.page, 'ten');
    await p2.page.waitForSelector('.fld-conf');
    assert.equal(await p2.page.textContent('.fld-conf'), 'Đã có người sửa');
    assert.equal(await p2.page.inputValue('input[name=name]'), 'Tên của tôi', 'the draft value is kept, marked');
    await ctx.close();
  } finally { await browser.close(); }
});

test('offline: a suggestion is queued, shown under Đang chờ gửi, and sent on reconnect', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'guest', path: '#sua/K2' });
    await expand(s.page, 'ten');
    s.log.offline = true;
    await s.page.fill('input[name=name]', 'Tên khi mất mạng');
    await s.page.click('.fp-bar button[type=submit]');
    await s.page.waitForFunction(() => location.hash.includes('mine'));
    await s.page.waitForSelector('text=Đang chờ gửi');
    assert.equal(s.log.suggest.length, 0, 'nothing sent while offline');
    s.log.offline = false;
    await s.page.evaluate(() => window.dispatchEvent(new Event('online')));
    for (let i = 0; i < 60 && s.log.suggest.length < 1; i++) await wait(s.page, 100);
    assert.equal(s.log.suggest.length, 1, 'sent on reconnect');
    assert.deepEqual(Object.keys(s.log.suggest[0].changes), ['name']);
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('warm start renders the list from this device before the network answers', { skip }, async () => {
  const browser = await launch();
  try {
    const first = await open(browser, { role: 'member', path: '#/duong/list' });
    await first.page.waitForFunction(() => /^[1-9]\d* \/ /.test(document.querySelector('.lcount')?.textContent || ''), null, { timeout: 8000 });
    await first.page.waitForTimeout(600); // the first full pull is saved on this device
    const ctx = first.ctx; await first.page.close();
    const warm = await openIn(ctx, { role: 'member', path: '#/duong/list', personsDelay: 4000, ready: 'main' });
    await warm.page.waitForFunction(() => /^[1-9]\d* \/ /.test(document.querySelector('.lcount')?.textContent || ''), null, { timeout: 2500 });
    assert.equal(warm.log.personsServed, 0, 'the people request has not been answered yet');
    await ctx.close();
  } finally { await browser.close(); }
});
