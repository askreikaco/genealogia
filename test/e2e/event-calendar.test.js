// E2E: the calendar of an event's Thời gian and the device's Lịch phụ, in the browser, against a mocked API (no database).
// Covers: Lịch phụ (localStorage gp_altcal) sets the hint of a Dương lịch date: default "≈ 1/1 ÂL", cn-lunar "≈ 1/1 ÂL TQ",
// japanese "≈ Reiwa 8/2/17", none = no hint. Loại lịch Âm lịch Việt Nam: "1/1/1985" shows "≈ 21/1/1985 dương lịch" and the
// save sends date_cal vn-lunar with date_from 1985-01-21. Lịch cũ: the text is kept (no date_from), an optional year makes
// it about that year. Cài đặt has the "Lịch phụ" radios, and choosing Âm lịch Trung Quốc stores gp_altcal = cn-lunar.
// GP_SHOT_DIR=<dir> also writes the screenshots (Thời gian at 390 light and 1280 dark, Lịch cũ with a year at 390 light,
// the timeline row at 390 light, the settings section at 390 light and dark).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');
const { setBase, open } = require('./_form-mock');

let srv;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; setBase(w.base);
});
test.after(() => { srv?.close(); });

// The editor for a new event of K2. pref: the device's gp_altcal (not set when undefined).
async function editor(browser, { pref, ...opts } = {}) {
  const init = pref === undefined ? undefined : `try { localStorage.setItem('gp_altcal', ${JSON.stringify(pref)}); } catch (e) {}`;
  const s = await open(browser, { role: 'editor', path: '#su-kien/K2', ready: '[data-evx]', init, ...opts });
  await s.page.waitForSelector('[data-evx]', { timeout: 20000 });
  return s;
}
const hint = (page) => page.locator('[data-evx] [data-lunar-hint]');
const hintText = async (page) => ((await hint(page).isVisible()) ? (await hint(page).innerText()).trim() : '');
const pick = (page, v) => page.selectOption('[data-evx] select[data-f="date_cal"]', v);
const typeDate = (page, v) => page.fill('[data-evx] input[data-f="date_text"]', v);
// Captures the bodies of the writes the editor sends, then saves.
async function saveAndCapture(page) {
  const sent = [];
  page.on('request', (r) => { if (['POST', 'PUT', 'PATCH'].includes(r.method()) && /\/api\//.test(r.url())) sent.push(r.postData() || ''); });
  await page.click('[data-evx-save]');
  await page.waitForTimeout(1200);
  return sent;
}

test('Lịch phụ sets the hint of a Dương lịch date: default ÂL, cn-lunar, japanese, none (no hint)', { skip }, async () => {
  const browser = await launch();
  try {
    const cases = [[undefined, '≈ 1/1 ÂL'], ['', '≈ 1/1 ÂL'], ['cn-lunar', '≈ 1/1 ÂL TQ'], ['japanese', '≈ Reiwa 8/2/17'], ['none', '']];
    for (const [pref, want] of cases) {
      const s = await editor(browser, { pref });
      await typeDate(s.page, '17/2/2026');
      assert.equal(await hintText(s.page), want, `pref ${pref === undefined ? '(unset)' : JSON.stringify(pref)}`);
      await s.ctx.close();
    }
  } finally { await browser.close(); }
});

test('Âm lịch Việt Nam: 1/1/1985 shows the solar date and the save sends vn-lunar with date_from 1985-01-21', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await editor(browser);
    await pick(s.page, 'vn-lunar');
    await typeDate(s.page, '1/1/1985');
    assert.equal(await hintText(s.page), '≈ 21/1/1985 dương lịch');
    const sent = await saveAndCapture(s.page);
    assert.ok(sent.some((b) => /"date_cal":"vn-lunar"/.test(b) && /"date_from":"1985-01-21"/.test(b)), 'vn-lunar with the solar day: ' + sent.map((b) => b.slice(0, 160)).join(' | '));
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('Lịch cũ: the text is kept (no date_from); with an estimated year it is about that year', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await editor(browser);
    await pick(s.page, 'text');
    await typeDate(s.page, 'năm Giáp Tý');
    assert.equal(await hintText(s.page), 'Giữ nguyên văn, không đổi sang dương lịch.');
    assert.equal(await s.page.locator('[data-df-year-lbl]').isVisible(), false, 'the year input is folded away');
    let sent = await saveAndCapture(s.page);
    assert.ok(sent.some((b) => /"date_cal":"text"/.test(b) && /"date_from":null/.test(b)), 'text, undated: ' + sent.map((b) => b.slice(0, 160)).join(' | '));
    await s.ctx.close();

    const t = await editor(browser);
    await pick(t.page, 'text');
    await typeDate(t.page, 'năm Giáp Tý');
    await t.page.click('[data-df-year-btn]');
    await t.page.fill('[data-f="date_year"]', '1864');
    sent = await saveAndCapture(t.page);
    assert.ok(sent.some((b) => /"date_cal":"text"/.test(b) && /"date_kind":"about"/.test(b) && /"date_from":"1864"/.test(b)), 'text with the year: ' + sent.map((b) => b.slice(0, 160)).join(' | '));
    await t.ctx.close();
  } finally { await browser.close(); }
});

test('Cài đặt: "Lịch phụ" radios; choosing Âm lịch Trung Quốc stores gp_altcal = cn-lunar', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#settings', ready: 'h1' });
    await s.page.waitForSelector('input[name=altcal]', { timeout: 20000 });
    assert.equal(await s.page.locator('input[name=altcal]').count(), 6, 'six choices');
    assert.equal(await s.page.locator('input[name=altcal][value=""]').isChecked(), true, 'Âm lịch Việt Nam by default');
    await s.page.check('input[name=altcal][value="cn-lunar"]');
    await s.page.waitForTimeout(300);
    assert.equal(await s.page.evaluate(() => localStorage.getItem('gp_altcal')), 'cn-lunar', 'stored on this device');
    assert.equal(await s.page.locator('input[name=altcal][value="cn-lunar"]').isChecked(), true, 'still checked after the re-render');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('screenshots (only with GP_SHOT_DIR)', { skip: skip || !SHOTS }, async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await launch();
  try {
    for (const [vw, vh, scheme] of [[390, 844, 'light'], [390, 844, 'dark'], [1280, 900, 'light']]) {
      const s = await open(browser, { role: 'editor', path: '#settings', ready: 'h1', viewport: { width: vw, height: vh }, scheme });
      await s.page.waitForSelector('input[name=altcal]', { timeout: 20000 });
      await s.page.locator('input[name=altcal]').first().evaluate((el) => el.closest('section, .card, div')?.scrollIntoView({ block: 'center' }));
      await s.page.waitForTimeout(200);
      await s.page.screenshot({ path: path.join(SHOTS, `settings-altcal-${vw}-${scheme}.png`), fullPage: true });
      await s.ctx.close();
    }
    const vn = await editor(browser, { viewport: { width: 390, height: 844 }, scheme: 'light' });
    await pick(vn.page, 'vn-lunar'); await typeDate(vn.page, '1/1/1985');
    await vn.page.waitForTimeout(200);
    await vn.page.screenshot({ path: path.join(SHOTS, 'form-vn-390-light.png'), fullPage: true });
    await vn.ctx.close();
    const vn2 = await editor(browser, { viewport: { width: 1280, height: 900 }, scheme: 'dark' });
    await pick(vn2.page, 'vn-lunar'); await typeDate(vn2.page, '1/1/1985');
    await vn2.page.waitForTimeout(200);
    await vn2.page.screenshot({ path: path.join(SHOTS, 'form-vn-1280-dark.png'), fullPage: true });
    await vn2.ctx.close();
    const tx = await editor(browser, { viewport: { width: 390, height: 844 }, scheme: 'light' });
    await pick(tx.page, 'text'); await typeDate(tx.page, 'năm Giáp Tý, tháng Chạp');
    await tx.page.click('[data-df-year-btn]'); await tx.page.fill('[data-f="date_year"]', '1864');
    await tx.page.waitForTimeout(200);
    await tx.page.screenshot({ path: path.join(SHOTS, 'form-text-390-light.png'), fullPage: true });
    await tx.ctx.close();
    // the timeline row: the mocked events list has one converted event
    const tl = await open(browser, { role: 'editor', path: '#person/K2?tab=life', viewport: { width: 390, height: 844 }, scheme: 'light' });
    const base = { person_id: 'K2', title: '', lunar: '', place: '', place_new: '', description: '', people: [], sources: [], photos: [], is_preferred: true, alt_of: null, created_by: 'e2e', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
    // birth (the person's data), an undated "Lịch cũ" event, a dated one, and the death: the undated one sits between birth and death
    const evs = [
      { ...base, id: 'E1', type: 'hoc', date_text: 'năm Giáp Tý', date_cal: 'text', date_kind: null, date_from: null, date_to: null },
      { ...base, id: 'E2', type: 'hoc', date_text: '1/1/1985', date_cal: 'vn-lunar', date_kind: 'exact', date_from: '1985-01-21', date_to: null },
      { ...base, id: 'E3', type: 'mat', date_text: '2/3/1999', date_cal: null, date_kind: 'exact', date_from: '1999-03-02', date_to: null },
    ];
    await tl.page.route('**/api/events?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: evs, stories: [] }) }));
    await tl.page.reload();
    await tl.page.waitForSelector('text=năm Giáp Tý', { timeout: 20000 }).catch(() => {});
    await tl.page.waitForTimeout(300);
    await tl.page.screenshot({ path: path.join(SHOTS, 'timeline-vn-390-light.png'), fullPage: true });
    await tl.ctx.close();
  } finally { await browser.close(); }
});
