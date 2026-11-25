'use strict';
// E2E: tên chữ Hán (name_han). Shown under the name in the profile header and beside the name in the tree card and
// the book; the person form takes it with a check (Han characters and spaces, at most 40); nothing shows when empty.
// Mocked API (no database). Needs playwright and Chrome: see test/e2e/README.md. Screenshots: GP_SHOT_DIR=<dir>.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');
const { PERSONS, setBase, open, expand } = require('./_form-mock');

let srv;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; setBase(w.base);
});
test.after(() => { srv?.close(); });

// The same family, with a Hán name on K2 (a child of the tree) and none on the others.
const withHan = PERSONS.map((p) => (p.id === 'K2' ? { ...p, data: { ...p.data, name_han: '阮文甲' } } : p));
const shot = (page, file) => { if (SHOTS) return page.screenshot({ path: path.join(SHOTS, file) }); };

test('profile header: the Hán name sits under the name, smaller; none when the person has none', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'guest', path: '#/duong/person/K2', persons: withHan });
    await s.page.waitForSelector('.prof h1', { timeout: 8000 });
    const han = s.page.locator('.prof .nhan-h');
    assert.equal(await han.count(), 1);
    assert.equal((await han.innerText()).trim(), '阮文甲');
    const h1 = await s.page.locator('.prof h1').boundingBox();
    const hb = await han.boundingBox();
    assert.ok(hb.y >= h1.y + h1.height - 1, 'under the name');
    const sizes = await s.page.evaluate(() => [getComputedStyle(document.querySelector('.prof h1')).fontSize, getComputedStyle(document.querySelector('.prof .nhan-h')).fontSize]);
    assert.ok(parseFloat(sizes[1]) < parseFloat(sizes[0]), `smaller: ${sizes}`);
    await shot(s.page, 'han-profile.png');
    assert.deepEqual(s.log.errors, []);
    await s.ctx.close();

    const t = await open(browser, { role: 'guest', path: '#/duong/person/K1', persons: withHan });
    await t.page.waitForSelector('.prof h1', { timeout: 8000 });
    assert.equal(await t.page.locator('.prof .nhan-h').count(), 0, 'no Hán line without a Hán name');
    await t.ctx.close();
  } finally { await browser.close(); }
});

test('tree card: the Hán name is smaller beside the name; the book shows it too', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'guest', path: '#/duong/tree', persons: withHan });
    await s.page.waitForSelector('#tr .tn', { timeout: 8000 });
    const card = s.page.locator('#tr .tn', { has: s.page.locator('.nhan') });
    assert.equal(await card.count(), 1, 'only the card of the person with a Hán name');
    assert.equal((await card.locator('.nhan').innerText()).trim(), '阮文甲');
    assert.ok((await card.locator('.nhan').evaluate((el) => getComputedStyle(el).fontSize)) !== (await card.locator('b').evaluate((el) => getComputedStyle(el).fontSize)));
    await shot(s.page, 'han-tree.png');
    assert.deepEqual(s.log.errors, []);
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('person form: Tên chữ Hán takes Han characters and spaces up to 40; a bad value shows an inline error and a good one saves', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#sua/K2', persons: withHan });
    await expand(s.page, 'ten');
    assert.equal(await s.page.inputValue('input[name=name_han]'), '阮文甲', 'the form starts with the stored value');
    await s.page.fill('input[name=name_han]', 'Nguyễn');
    assert.equal(await s.page.locator('[data-err=name_han]').isVisible(), true, 'a Latin name is refused inline');
    await s.page.fill('input[name=name_han]', '阮 文甲');
    assert.equal(await s.page.locator('[data-err=name_han]').isVisible(), false, 'Han with a space is fine');
    await s.page.fill('input[name=name_han]', '阮'.repeat(41));
    assert.equal(await s.page.locator('[data-err=name_han]').isVisible(), true, 'more than 40 is refused');
    await s.page.fill('input[name=name_han]', '阮文乙');
    await s.page.click('.fp-bar button[type=submit]');
    await s.page.waitForFunction(() => location.hash.includes('person/'), null, { timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 50 && !s.log.ops.some((o) => o.id === 'K2'); i++) await s.page.waitForTimeout(100);
    const data = Object.assign({}, ...s.log.ops.filter((o) => o.id === 'K2').map((o) => o.fields));
    assert.equal(data.name_han, '阮文乙');
    assert.deepEqual(s.log.errors, []);
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('desk tree chart: the Hán name sits in the card and stays inside it', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'guest', path: '#/duong/tree', persons: withHan, viewport: { width: 1200, height: 900 } });
    await s.page.waitForSelector('svg.tchart .cbx[data-sel="K2"]', { timeout: 8000 });
    const t = s.page.locator('svg.tchart .cbx[data-sel="K2"] .cn .ch');
    assert.equal((await t.textContent()).trim(), '阮文甲');
    const box = await s.page.locator('svg.tchart .cbx[data-sel="K2"] .cn').evaluate((el) => { const r = el.getBBox(); return [r.x, r.width]; });
    const card = await s.page.locator('svg.tchart .cbx[data-sel="K2"] rect.b').evaluate((el) => el.width.baseVal.value);
    assert.ok(box[0] + box[1] <= card - 4, `name and Hán fit the card: ${box[0] + box[1]} <= ${card - 4}`);
    assert.deepEqual(s.log.errors, []);
    await s.ctx.close();
  } finally { await browser.close(); }
});
