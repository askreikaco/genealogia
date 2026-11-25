'use strict';
// Navigation and account chrome in the person form and the app: sign-out confirmation, the Thêm groups, the back bar and its scroll restore. Mocked API (no database).
const test = require('node:test');
const assert = require('node:assert');
const { skip, launch, startWeb } = require('./_e2e-harness');
const { PERSONS, P, setBase, open, wait } = require('./_form-mock');

let srv;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; setBase(w.base);
});
test.after(() => { srv?.close(); });


test('sign-out: Huỷ keeps the session, Đăng xuất logs out (confirm on Thêm)', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#more' });
    await s.page.click('main #logout');
    await s.page.waitForSelector('dialog#cfm');
    assert.equal(await s.page.textContent('dialog#cfm h2'), 'Đăng xuất khỏi tài khoản này?');
    assert.match(await s.page.textContent('dialog#cfm'), /Bạn sẽ cần đăng nhập lại/);
    await s.page.click('.rds-btn--ghost');
    assert.equal(s.log.logout, 0, 'cancel keeps the session');
    await s.page.click('main #logout');
    await s.page.click('[data-rds-confirm]');
    for (let i = 0; i < 40 && s.log.logout < 1; i++) await wait(s.page, 100);
    assert.equal(s.log.logout, 1, 'confirm logs out');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('Thêm: groups, account card at the bottom, Đăng xuất is its own row with the logout icon', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#more' });
    const heads = await s.page.$$eval('.mg-h', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(heads, ['Xem', 'Dòng họ', 'Ứng dụng'], 'editor: Xem, Dòng họ, Ứng dụng');
    assert.equal(await s.page.locator('main .calm', { hasText: 'Thành viên & quyền' }).count(), 0, 'editor sees no Thành viên');
    assert.ok(await s.page.locator('main #logout svg path').count() > 0);
    const adm = await open(browser, { role: 'admin', path: '#more' });
    assert.deepEqual(await adm.page.$$eval('.mg-h', (els) => els.map((e) => e.textContent.trim())), ['Xem', 'Dòng họ', 'Ứng dụng'], 'admin: same groups');
    assert.equal(await adm.page.locator('main .calm', { hasText: 'Thành viên & quyền' }).count(), 1, 'admin sees Thành viên in Dòng họ');
    await adm.ctx.close();
    await s.ctx.close();
    const g = await open(browser, { role: 'guest', path: '#more' });
    assert.equal(await g.page.locator('main #logout').count(), 0, 'guest has no sign-out');
    assert.equal(await g.page.locator('main #login').count(), 1, 'guest sees Đăng nhập');
    await g.ctx.close();
  } finally { await browser.close(); }
});

test('back: deep link goes to the parent; inner pages show the chevron, root pages the switcher', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#/duong/sua/K2' });
    assert.equal(await s.page.isVisible('#cbback'), true, 'chevron on the form page');
    assert.equal(await s.page.isVisible('#swbtn'), false, 'switcher replaced on phones');
    await s.page.click('#cbback');
    await s.page.waitForFunction(() => location.hash === '#person/K2');
    await s.page.evaluate(() => { location.hash = '#tree'; });
    await s.page.waitForFunction(() => location.hash === '#tree');
    assert.equal(await s.page.isVisible('#cbback'), false, 'root page: no chevron');
    assert.equal(await s.page.isVisible('#swbtn'), true, 'root page: switcher');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('back: list, open a person, Back returns to the list with its scroll kept', { skip }, async () => {
  const browser = await launch();
  try {
    const many = PERSONS.concat(Array.from({ length: 80 }, (_, i) => P('X' + i, { name: 'Người ' + i, gen: 7, parent: 'PA', order: 10 + i, born: '1990' })));
    const s = await open(browser, { role: 'editor', path: '#list', persons: many });
    await s.page.waitForTimeout(300);
    await s.page.evaluate(() => window.scrollTo(0, 400));
    await s.page.waitForTimeout(100);
    await s.page.evaluate(() => { location.hash = '#person/X3'; });
    await s.page.waitForFunction(() => location.hash === '#person/X3');
    await s.page.waitForTimeout(300);
    await s.page.click('#cbback');
    await s.page.waitForFunction(() => location.hash === '#list');
    await s.page.waitForTimeout(300);
    assert.ok(await s.page.evaluate(() => window.scrollY) > 200, 'list scroll kept');
    await s.ctx.close();
  } finally { await browser.close(); }
});
