// E2E: "+" for everyone. A guest (not signed in) sees the "+" on the people list, Dòng đời, Câu chuyện, Quan hệ (table
// relations) and Tư liệu; a guest's story goes to the suggestion queue as text only (no photo field, the note and the join
// link); Tư liệu search and the Nguồn / Ảnh filter work and its "+" sheet opens the event editor with the sources part open
// or the story editor. A member keeps the direct story editor with the photo field. Mocked API, no database.
// GP_SHOT_DIR=<dir> also writes the screenshots (guest 390 light: Câu chuyện, the story form, Quan hệ, Tư liệu and its
// "+" sheet; Tư liệu at 1280 dark).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');
const { setBase, open, P } = require('./_form-mock');

let srv;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; setBase(w.base);
});
test.after(() => { srv?.close(); });

const PERSONS = [
  P('S1', { name: 'Dương Văn Đích', sex: 'm', gen: 5, born: '1950', died: '2000' }),
  P('F1', { name: 'Dương Văn Cha', sex: 'm', gen: 4, born: '1920', died: '1980' }),
  P('M1', { name: 'Trần Thị Mẹ', sex: 'f', gen: 4, born: '1922', died: '1990' }),
];
const pc = (id, parent, child) => ({ id, parent_id: parent, child_id: child, kind: 'ruot', birth_order: 1, private: false });
const cp = (id, a, b) => ({ id, a_id: a, b_id: b, kind: 'cuoi', order_a: 1, order_b: 1, start_year: null, end_year: null, private: false });
const REL = { source: 'table', parent_child: [pc(1, 'F1', 'S1'), pc(2, 'M1', 'S1')], couple: [cp(101, 'F1', 'M1')] };
// S1 has one sourced event and one story with a photo (the Tư liệu rows); the photo's story is "Chuyến đi Huế".
const EVENTS = {
  items: [{ id: 'E1a2b3c4d5e6f', type: 'hoc', date_kind: 'exact', date_from: '1970', date_text: '1970', place: 'Sài Gòn', description: 'Khoa Toán', people: [], photos: [], is_preferred: true, alt_of: null,
    sources: [{ title: 'Sổ hộ tịch Sài Gòn', url: '', quality: '' }] }],
  stories: [{ id: 'S1a2b3c4d5e6f', person_id: 'S1', kind: 'chuyen', title: 'Chuyến đi Huế', body: 'Cả nhà cùng đi Huế.', photos: ['https://example.test/hue.jpg'], people: [], created_by: '', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }],
};
const openP = (browser, o) => open(browser, { persons: PERSONS, rel: REL, events: EVENTS, ...o });
const sel = (page, s) => page.$$eval(s, (els) => els.length);

test('guest sees "+" on the people list, Dòng đời, Câu chuyện, Quan hệ and Tư liệu', { skip }, async () => {
  const browser = await launch();
  try {
    const list = await openP(browser, { role: 'guest', path: '#list', ready: '[data-add="list"]' });
    assert.equal(await sel(list.page, '[data-add="list"]'), 1, 'people list "+"');
    assert.equal(list.log.errors.length, 0, list.log.errors.join(' | '));
    await list.ctx.close();

    const life = await openP(browser, { role: 'guest', path: '#person/S1?tab=life', ready: '[data-ev-add]' });
    assert.equal(await sel(life.page, '[data-ev-add]'), 1, 'Dòng đời "+"');
    await life.ctx.close();

    const story = await openP(browser, { role: 'guest', path: '#person/S1?tab=story', ready: '[data-st-add]' });
    assert.equal(await sel(story.page, '[data-st-add]'), 1, 'Câu chuyện "+" for a guest');
    await story.ctx.close();

    const rel = await openP(browser, { role: 'guest', path: '#person/S1', ready: 'section.relsec' });
    await rel.page.waitForSelector('[data-rel-add]', { timeout: 15000 });
    assert.equal(await sel(rel.page, '[data-rel-add]'), 1, 'Quan hệ "+" for a guest (table relations)');
    await rel.ctx.close();

    const src = await openP(browser, { role: 'guest', path: '#person/S1?tab=src', ready: '[data-src-add]' });
    assert.equal(await sel(src.page, '[data-src-add]'), 1, 'Tư liệu "+"');
    assert.equal(await sel(src.page, '#srq'), 1, 'Tư liệu search');
    await src.ctx.close();
  } finally { await browser.close(); }
});

test('guest story: text only, sent as a suggestion (kind story, no photos), with the note and the join link', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await openP(browser, { role: 'guest', path: '#person/S1?tab=story', ready: '[data-st-add]' });
    await s.page.click('[data-st-add]');
    await s.page.waitForSelector('dialog.evdlg', { timeout: 8000 });
    const dlg = s.page.locator('dialog.evdlg');
    assert.equal(await dlg.locator('[data-s="photos"]').count(), 0, 'no photo field for a guest');
    assert.match(await dlg.innerText(), /Thành viên dòng họ sẽ xem và duyệt góp ý này\./);
    const join = dlg.locator('a', { hasText: 'Xin tham gia dòng họ' });
    assert.equal(await join.count(), 1, 'join link');
    assert.match(await join.getAttribute('href'), /#join$/);
    await dlg.locator('[data-s="title"]').fill('Gửi từ khách');
    await dlg.locator('[data-s="body"]').fill('Một câu chuyện do khách gửi.');
    await dlg.locator('[data-stx-save]').click();
    await s.page.waitForFunction(() => !document.querySelector('dialog.evdlg'), null, { timeout: 8000 });
    assert.equal(s.log.suggest.length, 1, 'one suggestion POSTed');
    const body = s.log.suggest[0];
    assert.equal(body.person_id, 'S1');
    assert.equal(body.changes._ev.kind, 'story');
    assert.equal(body.changes._ev.action, 'add');
    assert.deepEqual(body.changes._ev.item.photos, [], 'no photos from a guest');
    assert.equal(body.changes._ev.item.title, 'Gửi từ khách');
    assert.equal(s.log.errors.length, 0, s.log.errors.join(' | '));
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('Tư liệu: search and the Nguồn / Ảnh filter narrow the list; "+" offers an event with sources or a story', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await openP(browser, { role: 'guest', path: '#person/S1?tab=src', ready: '[data-src-add]' });
    const page = s.page;
    await page.waitForSelector('#src-body .srcl', { timeout: 8000 });
    assert.equal(await sel(page, '#src-body .srcl li'), 1, 'the source is listed');
    assert.equal(await sel(page, '#src-body img'), 1, 'the photo is listed');
    await page.fill('#srq', 'Huế');
    await page.waitForTimeout(100);
    assert.equal(await sel(page, '#src-body .srcl li'), 0, 'search "Huế" hides the source');
    assert.equal(await sel(page, '#src-body img'), 1, 'search "Huế" keeps the photo of "Chuyến đi Huế"');
    await page.fill('#srq', 'Sổ');
    await page.waitForTimeout(100);
    assert.equal(await sel(page, '#src-body img'), 0, 'search "Sổ" hides the photo');
    await page.fill('#srq', '');
    await page.waitForTimeout(100);
    await page.click('[data-fp]');
    await page.waitForSelector('dialog.fpanel[open]', { timeout: 5000 });
    assert.equal(await page.locator('[data-src-f="src"]').isChecked(), true, 'Nguồn on by default');
    assert.equal(await page.locator('[data-src-f="photo"]').isChecked(), true, 'Ảnh on by default');
    await page.locator('[data-src-f="photo"]').uncheck();
    await page.click('dialog.fpanel[open] [data-fpx]');
    await page.waitForTimeout(150);
    assert.equal(await sel(page, '#src-body img'), 0, 'Ảnh off hides the photos');
    assert.equal(await sel(page, '#src-body .srcl li'), 1, 'Nguồn still listed');
    // "+" opens the two actions
    await page.click('[data-src-add]');
    await page.waitForSelector('dialog [data-src-story]', { timeout: 5000 });
    assert.equal(await sel(page, 'dialog [data-src-ev]'), 1, '"Thêm sự kiện có nguồn"');
    await page.click('dialog [data-src-story]');
    await page.waitForSelector('dialog.evdlg', { timeout: 8000 });
    assert.equal(await page.locator('dialog.evdlg [data-s="photos"]').count(), 0, 'guest: story editor without the photo field');
    await page.click('dialog.evdlg [data-evx-cancel]');
    await page.waitForTimeout(100);
    await page.click('[data-src-add]');
    await page.waitForSelector('dialog [data-src-ev]', { timeout: 5000 });
    await page.click('dialog [data-src-ev]');
    await page.waitForURL(/su-kien\/S1\?src=1/, { timeout: 8000 });
    await page.waitForSelector('[data-srcarea]', { timeout: 8000 });
    assert.equal(await page.evaluate(() => !!document.querySelector('[data-srcarea]')?.closest('details')?.open), true, 'the sources part is open');
    assert.equal(s.log.errors.length, 0, s.log.errors.join(' | '));
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('member keeps the direct story editor with the photo field; no join link', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await openP(browser, { role: 'member', path: '#person/S1?tab=story', ready: '[data-st-add]' });
    await s.page.click('[data-st-add]');
    await s.page.waitForSelector('dialog.evdlg', { timeout: 8000 });
    assert.equal(await s.page.locator('dialog.evdlg [data-s="photos"]').count(), 1, 'member sees the photo field');
    assert.equal(await s.page.locator('dialog.evdlg a', { hasText: 'Xin tham gia dòng họ' }).count(), 0, 'no join link for a member');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('screenshots (only with GP_SHOT_DIR)', { skip: skip || !SHOTS }, async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launch();
  try {
    const shot = async (name, o, fn) => {
      const s = await openP(browser, { role: 'guest', ...o });
      await s.page.waitForTimeout(400);
      if (fn) await fn(s.page);
      await s.page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
      await s.ctx.close();
    };
    await shot('guest-390-story.png', { path: '#person/S1?tab=story', ready: '[data-st-add]' });
    await shot('guest-390-story-form.png', { path: '#person/S1?tab=story', ready: '[data-st-add]' }, async (p) => { await p.click('[data-st-add]'); await p.waitForSelector('dialog.evdlg'); });
    await shot('guest-390-relations.png', { path: '#person/S1', ready: 'section.relsec' });
    await shot('guest-390-src.png', { path: '#person/S1?tab=src', ready: '[data-src-add]' });
    await shot('guest-390-src-plus.png', { path: '#person/S1?tab=src', ready: '[data-src-add]' }, async (p) => { await p.click('[data-src-add]'); await p.waitForSelector('dialog [data-src-story]'); });
    const d = await openP(browser, { role: 'guest', scheme: 'dark', viewport: { width: 1280, height: 860 }, path: '#person/S1?tab=src', ready: '[data-src-add]' });
    await d.page.waitForTimeout(400);
    await d.page.screenshot({ path: path.join(SHOTS, 'guest-1280-dark-src.png') });
    await d.ctx.close();
  } finally { await browser.close(); }
});
