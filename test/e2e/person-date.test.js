// E2E: a person's Ngày sinh / Ngày mất on the shared date field (web/js/date-field.js), against a mocked API (no database).
// Covers: Ngày sinh with Âm lịch VN "15/8/1890" shows "≈ 28/9/1890 dương lịch" and the auto lunar chip "15/8"; the save
// sends birth_cal vn-lunar, birth_text "15/8/1890", born 1890, birth_date 28/09/1890 and birth_lunar 15/8. Ngày mất on
// Lịch cũ with "năm Giáp Tý, tháng Chạp" and an estimated year: the save sends death_cal text, died 1960, no death_date.
// Dương lịch (the default) saves no calendar key. Switching back to Dương lịch clears birth_cal and birth_text. The profile
// shows "15/8/1890 ÂL (≈ 28/9/1890)". GP_SHOT_DIR=<dir> also writes: the form at 390 light (Âm lịch VN, Lịch cũ with the
// year), the profile at 390 light, and the form at 1280 dark.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');
const { PERSONS, setBase, open } = require('./_form-mock');

let srv;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; setBase(w.base);
});
test.after(() => { srv?.close(); });

const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name), fullPage: true }) : null);
const sel = (page, name, v) => page.selectOption(`#fpform select[name="${name}"]`, v);
const fill = (page, name, v) => page.fill(`#fpform input[name="${name}"]`, v);
// Saves the edit of K2 and returns the fields it sent for K2 (merged over the writes).
async function saveK2(s) {
  await s.page.click('.fp-bar button[type=submit]');
  await s.page.waitForFunction(() => location.hash.includes('person/'), null, { timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 50 && !s.log.ops.some((o) => o.id === 'K2'); i++) await s.page.waitForTimeout(100);
  return Object.assign({}, ...s.log.ops.filter((o) => o.id === 'K2').map((o) => o.fields));
}
// K2 with a date already typed in Âm lịch VN (for the switch back and the profile).
const withVn = () => PERSONS.map((p) => (p.id === 'K2' ? { ...p, data: { ...p.data, born: '1890', birth_date: '28/09/1890', birth_lunar: '15/8', birth_cal: 'vn-lunar', birth_text: '15/8/1890' } } : p));

test('Ngày sinh in Âm lịch VN: the hint shows the solar date, the chip the typed lunar, and the save sends the calendar and the text', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#sua/K2', viewport: { width: 390, height: 844 }, scheme: 'light' });
    await sel(s.page, 'birth_cal', 'vn-lunar');
    await fill(s.page, 'birth_smart', '15/8/1890');
    assert.equal((await s.page.locator('#fpform [data-pdate="birth"] [data-lunar-hint]').innerText()).trim(), '≈ 28/9/1890 dương lịch');
    assert.match(await s.page.textContent('[data-au="birth_lunar"] .fp-ro'), /15\/8/, 'the auto chip is the typed lunar day');
    await shot(s.page, 'form-birth-vn-390-light.png');
    const data = await saveK2(s);
    assert.deepEqual(
      { birth_cal: data.birth_cal, birth_text: data.birth_text, born: data.born, birth_date: data.birth_date, birth_lunar: data.birth_lunar },
      { birth_cal: 'vn-lunar', birth_text: '15/8/1890', born: '1890', birth_date: '28/09/1890', birth_lunar: '15/8' });
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('Dương lịch (the default) saves the same shape as before: no calendar keys', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#sua/K2' });
    await fill(s.page, 'birth_smart', '5/3/1963');
    const data = await saveK2(s);
    assert.equal(data.birth_date, '05/03/1963');
    assert.equal(data.born, '1963');
    assert.ok(!('birth_cal' in data) && !('birth_text' in data), 'no calendar key for Dương lịch');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('Ngày mất on Lịch cũ: the text and the estimated year are saved; no solar date', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#sua/K2', viewport: { width: 390, height: 844 }, scheme: 'light' });
    await s.page.locator('input[name=dead]').check({ force: true });
    await sel(s.page, 'death_cal', 'text');
    await fill(s.page, 'death_smart', 'năm Giáp Tý, tháng Chạp');
    await s.page.click('[data-pdate="death"] [data-df-year-btn]');
    await s.page.fill('#fpform input[name="death_year"]', '1960'); // K2 was born in 1955
    await s.page.waitForTimeout(150);
    await shot(s.page, 'form-death-text-390-light.png');
    const data = await saveK2(s);
    assert.deepEqual(
      { death_cal: data.death_cal, death_text: data.death_text, died: data.died, death_date: data.death_date ?? '' }, // (unchanged fields are not sent)
      { death_cal: 'text', death_text: 'năm Giáp Tý, tháng Chạp', died: '1960', death_date: '' });
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('switching back to Dương lịch clears birth_cal and birth_text', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#sua/K2', persons: withVn() });
    assert.equal(await s.page.locator('#fpform select[name="birth_cal"]').inputValue(), 'vn-lunar', 'the record calendar is shown');
    await sel(s.page, 'birth_cal', '');
    const data = await saveK2(s);
    assert.equal(data.birth_cal, '', 'cleared');
    assert.equal(data.birth_text, '', 'cleared');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('the profile shows a date typed in another calendar: the text, then the solar date', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#person/K2', persons: withVn(), viewport: { width: 390, height: 844 }, scheme: 'light' });
    await s.page.waitForSelector('text=15/8/1890 ÂL', { timeout: 15000 });
    assert.match(await s.page.textContent('main'), /15\/8\/1890 ÂL \(≈ 28\/9\/1890\)/);
    await shot(s.page, 'profile-vn-390-light.png');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('GP_SHOT_DIR: the form at 1280 dark', { skip: skip || !SHOTS }, async () => {
  const browser = await launch();
  try {
    const s = await open(browser, { role: 'editor', path: '#sua/K2', viewport: { width: 1280, height: 900 }, scheme: 'dark' });
    await sel(s.page, 'birth_cal', 'vn-lunar');
    await fill(s.page, 'birth_smart', '15/8/1890');
    await s.page.waitForTimeout(150);
    await shot(s.page, 'form-birth-vn-1280-dark.png');
    await s.ctx.close();
  } finally { await browser.close(); }
});
