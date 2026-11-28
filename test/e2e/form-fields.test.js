'use strict';
// Person form, field set and prefills: the fields per role, a child prefilled from its parent and siblings, dates, death fields, suggest mode, saves that keep sections never opened. Mocked API (no database). Needs playwright and Chrome: see _e2e-harness.js.
const test = require('node:test');
const assert = require('node:assert');
const { skip, launch, startWeb } = require('./_e2e-harness');
const { setBase, open, openIn, names, expand, expandAll } = require('./_form-mock');

let srv;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; setBase(w.base);
});
test.after(() => { srv?.close(); });

const CONTACT = ['phone', 'email', 'zalo', 'facebook', 'address', 'contact_public'];
const GUEST_ONLY = ['by_name', 'by_contact', 'suggest_note', 'website'];

test('guest, member and editor get the same field set (contact and guest-only fields aside)', { skip }, async () => {
  const browser = await launch();
  try {
    const sets = {};
    for (const role of ['guest', 'member', 'editor']) {
      const s = await open(browser, { role, path: '#sua/K2' });
      await s.page.waitForSelector('#fpform');
      await expandAll(s.page);
      sets[role] = await names(s.page);
      assert.deepEqual(s.log.errors, [], role + ' page errors');
      await s.ctx.close();
    }
    assert.deepEqual(sets.member, sets.editor, 'member and editor see the same fields');
    assert.deepEqual(sets.guest, sets.member.filter((k) => !CONTACT.includes(k)).concat(GUEST_ONLY).sort(), 'guest sees the same fields minus contact, plus the contributor fields');
    for (const k of CONTACT) assert.ok(!sets.guest.includes(k), 'guest must not get ' + k);
  } finally { await browser.close(); }
});

test('add a child under a parent with 3 dated siblings: Đời 7 and Thứ 3 are saved with the child', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#them' });
    // "Thêm con" of PA: the search first ("Không thấy" goes on to the basic form); the child is saved with Đời and Thứ
    await s.page.evaluate(() => { location.hash = '#list'; });
    await s.page.waitForSelector('main');
    await s.page.locator('[data-menu="PA"]').first().click();
    await s.page.locator('.rds-menu [data-act="child"][data-id="PA"]').click();
    await s.page.waitForSelector('#add-q');
    await s.page.click('[data-new]');
    await s.page.waitForSelector('#add-f input[name=name]');
    await s.page.fill('#add-f input[name=name]', 'Dương Văn Ba');
    await s.page.fill('#add-f input[name=birth]', '1958');
    await s.page.click('#add-f button[type=submit]');
    for (let i = 0; i < 50 && !s.log.ops.some((o) => o.fields && o.fields.name === 'Dương Văn Ba'); i++) await s.page.waitForTimeout(100);
    const added = s.log.ops.find((o) => o.fields && o.fields.name === 'Dương Văn Ba');
    assert.ok(added, 'the child is saved');
    assert.equal(added.fields.parent, 'PA');
    assert.equal(added.fields.gen, 7, 'Đời = parent 6 + 1');
    assert.equal(added.fields.thu, '3', 'after 1950 and 1955, before 1960');
    assert.deepEqual(s.log.errors, []);
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('5/3/1963 shows âm lịch and saves the full date', { skip }, async () => {
  const browser = await launch();
  try {
    // Ngày sinh is on the page from the start (no section to open since the form was minimised, see forms-minimal-b1)
    const s = await open(browser, { role: 'editor', path: '#sua/K2' });
    await s.page.fill('input[name=birth_smart]', '5/3/1963');
    const lunar = await s.page.textContent('[data-au="birth_lunar"] .fp-ro');
    assert.match(lunar, /10\/2 Quý Mão/);
    assert.match(lunar, /tự tính/);
    await s.page.click('.fp-bar button[type=submit]');
    await s.page.waitForFunction(() => location.hash.includes('person/'));
    for (let i = 0; i < 50 && !s.log.ops.some((o) => o.id === 'K2'); i++) await s.page.waitForTimeout(100);
    const data = Object.assign({}, ...s.log.ops.filter((o) => o.id === 'K2').map((o) => o.fields));
    assert.equal(data.birth_date, '05/03/1963');
    assert.equal(data.born, '1963');
    assert.equal(data.birth_lunar, '10/2');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('Đã khuất shows the death fields; death before birth is an inline error and opens Mất', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#sua/K2' });
    // Đã khuất and Ngày mất are on the page (no section to open); the error shows under Ngày mất
    assert.equal(await s.page.locator('.fp-death').isVisible(), false, 'hidden when alive');
    await s.page.locator('input[name=dead]').check({ force: true });
    assert.equal(await s.page.locator('.fp-death').isVisible(), true, 'shown when Đã khuất is on');
    await s.page.fill('input[name=birth_smart]', '1955');
    await s.page.fill('input[name=death_smart]', '1940');
    assert.match(await s.page.textContent('[data-err=death_smart]'), /trước năm sinh/);
    assert.equal(await s.page.locator('[data-err=death_smart]').isVisible(), true, 'the error is on the page');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('suggest mode sends only the changed fields', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'guest', path: '#sua/K2' });
    await s.page.fill('input[name=name]', 'Dương Văn Hai (đã sửa)');
    await s.page.click('.fp-bar button[type=submit]');
    await s.page.waitForFunction(() => location.hash.includes('mine'));
    assert.equal(s.log.suggest.length, 1);
    assert.deepEqual(Object.keys(s.log.suggest[0].changes).sort(), ['name']);
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('save with one section changed keeps the values of the sections never opened', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#sua/K2' });
    // K2 has a birth place, a rare field: Thêm chi tiết opens by itself with it
    assert.equal(await s.page.locator('#fpform [data-fp-fold] > details').evaluate((d) => d.open), true, 'the fold opens for the birth place');
    await expand(s.page, 'ten');
    await s.page.fill('input[name=name]', 'Dương Văn Hai (sửa)');
    await s.page.click('.fp-bar button[type=submit]');
    await s.page.waitForFunction(() => location.hash.includes('person/'), null, { timeout: 5000 });
    const fields = s.log.ops.map((o) => o.fields);
    assert.deepEqual(fields, [{ name: 'Dương Văn Hai (sửa)' }], 'only the changed field is sent');
    assert.deepEqual(s.log.errors, [], 'page errors');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('draft restore into a closed section: the value is kept, shown in the header and saved', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#sua/K2' });
    await expand(s.page, 'noi'); // the birth place sits in Thêm chi tiết (open for K2; Nơi sống, Nghề and Tôn giáo are event links now)
    await s.page.fill('input[name=birth_place]', 'Bến Tre');
    await s.page.waitForFunction(() => /Đã lưu nháp/.test(document.getElementById('fpstat')?.textContent || ''), null, { timeout: 5000 });
    const ctx = s.ctx; await s.page.close();
    const p2 = await openIn(ctx, { role: 'editor', path: '#sua/K2' });
    await p2.page.waitForSelector('.fp-draft', { timeout: 5000 });
    await p2.page.click('[data-dr-go]');
    await p2.page.waitForFunction(() => /Đã khôi phục/.test(document.getElementById('fpstat')?.textContent || ''), null, { timeout: 5000 });
    assert.match(await p2.page.locator('#fpform [data-fp-fold] [data-disc-sum]').textContent(), /Bến Tre/, 'the fold summary shows the restored value');
    await p2.page.click('.fp-bar button[type=submit]');
    await p2.page.waitForFunction(() => location.hash.includes('person/'), null, { timeout: 5000 });
    const bp = p2.log.ops.map((o) => o.fields).find((f) => 'birth_place' in f);
    assert.deepEqual(bp, { birth_place: 'Bến Tre' }, 'the save sends the restored value');
    assert.deepEqual(p2.log.errors, [], 'page errors');
    await ctx.close();
  } finally { await browser.close(); }
});
