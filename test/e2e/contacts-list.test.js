// E2E: contacts as a list in the person form and on the profile.
// Editor: Liên hệ rows of [type][value][×], "+ Thêm liên hệ" adds a row (phone by default). Two phones and an email are
// added, one row is removed, Lưu saves the list (one op with the whole list), a reload shows the items with tap links
// (tel:, mailto:). An invalid phone is refused on the page and nothing is saved. Input types and autocomplete per type.
// Guest: a living person with hidden contacts shows the Liên hệ teaser and no values. Dark theme, 390 px.
// Screenshots (when GP_SHOT_DIR is set): contacts-edit.png (edit, 3 rows), contacts-view.png (the card).
// Mocked API (in-memory persons; ops are applied to them so a reload shows what was saved), no database:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/contacts-list.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const SEED = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0, died: '1900' }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1960', contacts: [{ type: 'phone', value: '0900000001' }], contact_public: '' }),
  P('PN', { name: 'Dương Văn Không', sex: 'm', gen: 6, thu: '3', parent: 'PR', order: 3, born: '1965' }),
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };
const shot = (page, name) => { if (SHOTS) return page.screenshot({ path: path.join(SHOTS, name) }); };

let srv; let base; let browser;
test.before(async () => {
  if (skip) return;
  ({ srv, base } = await startWeb());
  browser = await launch();
});
test.after(async () => { await browser?.close(); srv?.close(); });

// who: 'editor' | 'guest'. store: the persons the mock serves; ops are applied to it.
async function openApp(who, store, route) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const ops = [];
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (req0, req) => {
    const u = new URL(req.url()); const p = u.pathname;
    const json = (b, status = 200) => req0.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') {
      if (who === 'guest') return json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
      return json({ editor: null, role: 'editor', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: 'editor' } });
    }
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') {
      const since = Number(u.searchParams.get('since'));
      if (since !== 0) return json({ items: [], next_since: since });
      const items = [...store.values()].map((x) => {
        if (who !== 'guest') return x;
        const d = { ...x.data }; const had = Array.isArray(d.contacts) && d.contacts.length > 0;
        delete d.contacts; delete d.phone; delete d.email;
        if (had && !d.died) d.has_contact = true; // the server's boolean, never a value
        return { ...x, data: d };
      });
      return json({ items, next_since: 1 });
    }
    if (p === '/api/ops') {
      const body = req.postDataJSON();
      for (const o of body.ops || []) {
        ops.push(o);
        const cur = store.get(o.id); if (cur) cur.data = { ...cur.data, ...o.fields };
      }
      return json({ applied: (body.ops || []).map((o) => o.op_id), rejected: [] });
    }
    if (p.startsWith('/api/suggestions')) return json([]);
    if (p.startsWith('/api/events')) return json({ items: [], stories: [] });
    return json({});
  });
  await page.goto(base + '/' + route);
  return { ctx, page, errors, ops };
}
const freshStore = () => new Map(SEED.map((p) => [p.id, JSON.parse(JSON.stringify(p))]));
const rows = (page) => page.locator('[data-ct-row]');

test('editor: add two phones and an email, remove one, save; the reload shows them with tap links', { skip }, async () => {
  const store = freshStore();
  const { ctx, page, errors, ops } = await openApp('editor', store, '#/duong/person/PN');
  try {
    await page.waitForSelector('[data-ct-edit="PN"]', { timeout: 8000 });
    await page.click('[data-ct-edit="PN"]');
    await page.waitForSelector('[data-ct-add]', { timeout: 8000 });
    assert.equal(await rows(page).count(), 0, 'no contacts yet: no rows');
    assert.match(await page.locator('.ct-empty').innerText(), /Chưa có liên hệ/);

    await page.click('[data-ct-add]');
    await page.locator('[data-ct-row="0"] [data-ct-val]').fill('0912 345 678');
    await page.click('[data-ct-add]');
    await page.locator('[data-ct-row="1"] [data-ct-val]').fill('0977000111');
    await page.click('[data-ct-add]');
    await page.locator('[data-ct-row="2"] [data-ct-type]').selectOption('email');
    await page.locator('[data-ct-row="2"] [data-ct-val]').fill('Khong@Example.test');
    assert.equal(await rows(page).count(), 3);
    assert.equal(await page.locator('[data-ct-row="0"] [data-ct-val]').getAttribute('type'), 'tel');
    assert.equal(await page.locator('[data-ct-row="0"] [data-ct-val]').getAttribute('inputmode'), 'tel');
    assert.equal(await page.locator('[data-ct-row="0"] [data-ct-val]').getAttribute('autocomplete'), 'tel');
    assert.equal(await page.locator('[data-ct-row="2"] [data-ct-val]').getAttribute('type'), 'email', 'the input follows the type');
    assert.equal(await page.locator('[data-ct-row="2"] [data-ct-val]').getAttribute('autocomplete'), 'email');
    await shot(page, 'contacts-edit.png'); // three rows, before the removal
    await page.locator('[data-ct-row="1"] [data-ct-del]').click();
    assert.equal(await rows(page).count(), 2, 'one row removed');

    await page.click('#fpsave');
    await page.waitForSelector('section[aria-label="Liên hệ"] dt', { timeout: 8000 });
    await page.waitForTimeout(300);
    const saved = ops.filter((o) => o.id === 'PN');
    assert.equal(saved.length, 1, 'one save, one op');
    assert.deepEqual(saved[0].fields.contacts, [{ type: 'phone', value: '0912 345 678' }, { type: 'email', value: 'khong@example.test' }]);

    await page.reload();
    await page.waitForSelector('section[aria-label="Liên hệ"]', { timeout: 8000 });
    const card = page.locator('section[aria-label="Liên hệ"]');
    const t = await card.innerText();
    assert.ok(t.includes('0912 345 678') && t.includes('khong@example.test'), t);
    assert.equal(await card.locator('a[href="tel:0912345678"]').count(), 1, 'phone is a tel: link');
    assert.equal(await card.locator('a[href="mailto:khong@example.test"]').count(), 1, 'email is a mailto: link');
    await shot(page, 'contacts-view.png');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('editor: an invalid phone is refused on the page; nothing is saved', { skip }, async () => {
  const store = freshStore();
  const { ctx, page, errors, ops } = await openApp('editor', store, '#/duong/person/PA');
  try {
    await page.waitForSelector('[data-ct-edit="PA"]', { timeout: 8000 });
    await page.click('[data-ct-edit="PA"]');
    await page.waitForSelector('[data-ct-row="0"]', { timeout: 8000 });
    assert.equal(await page.locator('[data-ct-row="0"] [data-ct-val]').inputValue(), '0900000001', 'the saved phone is in the list');
    await page.locator('[data-ct-row="0"] [data-ct-val]').fill('gọi tôi');
    await page.click('#fpsave');
    await page.waitForTimeout(300);
    assert.match(await page.locator('[data-err="contacts"]').innerText(), /Dòng 1: Số điện thoại/);
    assert.equal(ops.length, 0, 'no op for an invalid list');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('the import is a dialog on a scrim (a backdrop behind it), not an inline block', { skip }, async () => {
  const store = freshStore();
  const { ctx, page, errors } = await openApp('editor', store, '#/duong/person/PA');
  try {
    await page.waitForSelector('[data-ct-edit="PA"]', { timeout: 8000 });
    await page.click('[data-ct-edit="PA"]');
    await page.click('[data-ct-import]');
    const dlg = page.locator('dialog.contact-import');
    await dlg.waitFor({ state: 'visible' });
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('dialog.contact-import'), '::backdrop').backgroundColor);
    assert.notEqual(bg, 'rgba(0, 0, 0, 0)', 'a backdrop (scrim) is drawn');
    assert.equal(await dlg.locator('[data-file]').count(), 1, 'the file path is the secondary link');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('guest: the Liên hệ teaser with a sign-in prompt and no values', { skip }, async () => {
  const store = freshStore();
  const { ctx, page, errors } = await openApp('guest', store, '#/duong/person/PA');
  try {
    await page.waitForSelector('section[aria-label="Liên hệ"]', { timeout: 8000 });
    const card = page.locator('section[aria-label="Liên hệ"]');
    const t = await card.innerText();
    assert.match(t, /chỉ hiện cho người trong họ đã đăng nhập/);
    assert.doesNotMatch(t, /0900000001/);
    assert.equal(await card.locator('a[href^="tel:"]').count(), 0);
    assert.equal(await card.locator('[data-ct-edit]').count(), 0, 'no edit link for a guest');
    assert.equal(await card.locator('[data-acct="in"]').count(), 1);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
