// E2E: Nhập từ danh bạ. Family import (Thêm > Nhập danh bạ): upload a .vcf, review the matches (exact pre-checked,
// a candidate and an unmatched contact not), save only the checked ones (only the missing phone or email is added).
// Person import (the person form's Liên hệ list, editors): one contact picked, its numbers and emails become rows. Members see no import entry.
// Contact Picker path: when navigator.contacts.select exists, the picker button is the one primary action.
// Parsing and matching run in the browser (web/js/contacts-parse.js); the test asserts that no contact data is sent to any
// /api/contacts route. Only the confirmed contacts are saved, through /api/ops.
// Screenshots (390x844) when GP_SHOT_DIR is set: contacts-entry.png (picker entry), contacts-review.png (family review).
//   NODE_PATH=/opt/node-tools/node_modules [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/contacts-import.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PEOPLE = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0, died: '1900' }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1960', phone: '0900000001', email: 'cha@example.test' }),
  P('PD', { name: 'Dương Thị Đã', sex: 'f', gen: 6, thu: '2', parent: 'PR', order: 2, born: '1963' }),
  P('PN', { name: 'Dương Văn Không', sex: 'm', gen: 6, thu: '3', parent: 'PR', order: 3, born: '1965' }),
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };
const VCF = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Dương Văn Không\r\nTEL:0912345678\r\nEMAIL:khong@example.test\r\nEND:VCARD\r\n'
  + 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Dương Văn Cha\r\nTEL:0900000001\r\nEMAIL:cha@example.test\r\nEND:VCARD\r\n'
  + 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Dương Thị Đạt\r\nTEL:0977000111\r\nEND:VCARD\r\n'
  + 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Người Lạ\r\nTEL:0966000222\r\nEND:VCARD\r\n';
// role: 'editor' | 'member'. Records the match requests and the ops the app sends.
async function openApp(browser, base, { role = 'editor', picker = false, route = '#more' } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  if (picker) {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'contacts', { configurable: true, value: { select: async () => [{ name: ['Dương Văn Không'], tel: ['0912345678'], email: ['khong@example.test'] }] } });
    });
  }
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const contactRequests = []; const ops = [];
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname;
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') {
      return json({ editor: null, role, status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: role } });
    }
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') { const since = u.searchParams.get('since'); return json(since === '0' ? { items: PEOPLE, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/contacts')) { contactRequests.push(p); return json({ error: 'not expected' }, 404); }
    if (p === '/api/ops') {
      const body = req.postDataJSON(); ops.push(...(body.ops || []));
      return json({ applied: (body.ops || []).map((o) => o.op_id), rejected: [] });
    }
    if (p.startsWith('/api/suggestions')) return json([]);
    if (p.startsWith('/api/events')) return json({ items: [], stories: [] });
    return json({});
  });
  await page.goto(base + '/' + route);
  return { ctx, page, errors, contactRequests, ops };
}

const VCF_FILE = { name: 'contacts.vcf', mimeType: 'text/vcard', buffer: Buffer.from(VCF, 'utf8') };
const shot = (page, name) => { if (SHOTS) return page.screenshot({ path: path.join(SHOTS, name) }); };

let srv; let base; let browser;
test.before(async () => {
  if (skip) return;
  ({ srv, base } = await startWeb());
  browser = await launch();
});
test.after(async () => { await browser?.close(); srv?.close(); });

test('family import: picker entry, then file review: exact pre-checked, candidate and unmatched not, saves only the checks', { skip }, async () => {
  const { ctx, page, errors } = await openApp(browser, base, { picker: true });
  try {
    await page.waitForSelector('[data-contact-import-fam]', { timeout: 8000 });
    await page.click('[data-contact-import-fam]');
    const dlg = page.locator('dialog.contact-import');
    await dlg.waitFor({ state: 'visible' });
    assert.equal(await dlg.locator('[data-pick]').count(), 1, 'the picker is the one primary action');
    assert.equal(await dlg.locator('[data-file]').count(), 1, 'the file is the secondary path, always there');
    await shot(page, 'contacts-entry.png');
    await ctx.close();

    // the file path (no picker in this browser context)
    const again = await openApp(browser, base, { picker: false });
    const p2 = again.page;
    try {
      await p2.waitForSelector('[data-contact-import-fam]', { timeout: 8000 });
      await p2.click('[data-contact-import-fam]');
      await p2.locator('dialog.contact-import [data-file]').setInputFiles(VCF_FILE);
      const list = p2.locator('dialog.contact-import .ci-list');
      await list.waitFor({ state: 'visible' });
      const boxes = list.locator('input[name=pick]');
      assert.equal(await boxes.count(), 4);
      assert.equal(await boxes.nth(0).isChecked(), true, 'exact unique match is checked');
      assert.equal(await boxes.nth(1).isChecked(), true, 'exact match is checked (its fields are already filled: skipped on save)');
      assert.equal(await boxes.nth(2).isChecked(), false, 'a candidate is not checked by default');
      assert.equal(await boxes.nth(2).isEnabled(), true, 'a candidate can still be confirmed');
      assert.equal(await boxes.nth(3).isEnabled(), false, 'no match: nothing to confirm');
      assert.equal(await p2.locator('dialog.contact-import [data-save]').textContent(), 'Lưu 2 liên hệ');
      assert.deepEqual(again.contactRequests, [], 'no contact data is sent: parsing and matching are in the browser');
      await shot(p2, 'contacts-review.png');

      await p2.click('dialog.contact-import [data-save]');
      await p2.waitForFunction(() => !document.querySelector('dialog.contact-import'), null, { timeout: 8000 });
      await p2.waitForTimeout(400);
      // only PN gets fields: phone and email were empty. PA is already filled, so nothing is sent for it.
      const pn = again.ops.filter((o) => o.id === 'PN');
      assert.equal(pn.length, 1, 'one op for PN');
      assert.deepEqual(pn[0].fields, { contacts: [{ type: 'phone', value: '0912345678' }, { type: 'email', value: 'khong@example.test' }] });
      assert.equal(again.ops.some((o) => o.id === 'PD' || o.id === 'PA'), false, 'no op for the candidate or the filled person');
      assert.deepEqual(again.errors, []);
      assert.deepEqual(errors, []);
    } finally { await p2.context().close(); }
  } finally { await ctx.close().catch(() => {}); }
});

test('person import: from the person form (Liên hệ list) the chosen contact fills rows; nothing is saved until Lưu', { skip }, async () => {
  const { ctx, page, errors, ops } = await openApp(browser, base, { route: '#/duong/person/PN' });
  try {
    await page.waitForSelector('[data-ct-edit="PN"]', { timeout: 8000 });
    await page.click('[data-ct-edit="PN"]');
    await page.waitForSelector('[data-ct-import]', { timeout: 8000 });
    await page.click('[data-ct-import]');
    const dlg = page.locator('dialog.contact-import');
    await dlg.waitFor({ state: 'visible' });
    assert.match(await dlg.locator('h2').textContent(), /Nhập từ danh bạ/);
    await dlg.locator('[data-file]').setInputFiles(VCF_FILE);
    await dlg.locator('.ci-list').waitFor({ state: 'visible' });
    await dlg.getByRole('button', { name: 'Thêm vào danh sách' }).click();
    await page.waitForFunction(() => !document.querySelector('dialog.contact-import'), null, { timeout: 8000 });
    assert.equal(ops.filter((o) => o.id === 'PN').length, 0, 'the import does not save by itself');
    assert.equal(await page.locator('[data-ct-row]').count(), 2, 'the first contact fills two rows: phone and email');
    await page.click('#fpsave');
    await page.waitForTimeout(400);
    const pn = ops.filter((o) => o.id === 'PN');
    assert.equal(pn.length, 1);
    assert.deepEqual(pn[0].fields.contacts, [{ type: 'phone', value: '0912345678' }, { type: 'email', value: 'khong@example.test' }]);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('members do not see the import entries (Thêm row and Liên hệ button)', { skip }, async () => {
  const { ctx, page } = await openApp(browser, base, { role: 'member' });
  try {
    await page.waitForSelector('text=Thêm', { timeout: 8000 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-contact-import-fam]').count(), 0);
  } finally { await ctx.close(); }
  const second = await openApp(browser, base, { role: 'member', route: '#/duong/person/PA' });
  try {
    await second.page.waitForSelector('section[aria-label="Hồ sơ"], .ptabs, h1', { timeout: 8000 });
    await second.page.waitForTimeout(300);
    assert.equal(await second.page.locator('[data-ct-edit]').count(), 0, 'no edit link on the Liên hệ card for a member');
  } finally { await second.ctx.close(); }
});
