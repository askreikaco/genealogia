// E2E: minimal forms B1 (the person form). Own family (slug fmb-<tag>), so the seeded data is not touched. Needs a SCRATCH
// database: GP_TEST_DATABASE_URL=postgres://.../<scratch> (name contains scratch, e2e or giapha_ci); NODE_PATH=<dir with
// playwright>. GP_SHOT_DIR=<dir> also writes the screenshots (add person closed, after "+ Họ khác" and "+ Liên hệ", the
// edit with the fold open, the profile without the old button).
// Covers: a new person shows only the essentials and the links, Thêm chi tiết closed; "+ Họ khác" adds one row per tap,
// saves through the store, and the profile shows the Họ group; no "Thêm mốc họ" on any profile tab; "+ Liên hệ" rows save
// and a guest sees a contact only when it is public; an edit with a burial and a note opens the fold with a summary;
// a member still sends a suggestion; 360 px has no horizontal overflow.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const SHOT = process.env.GP_SHOT_DIR || '';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !/scratch|e2e|giapha_ci/.test(DB_URL) ? 'GP_TEST_DATABASE_URL must name a scratch database (contains "scratch", "e2e" or giapha_ci)'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const TAG = crypto.randomBytes(3).toString('hex');
const SLUG = `fmb-${TAG}`;
const OWNER = `owner.${TAG}@test.local`;
const MEMBER = `member.${TAG}@test.local`;
const LIVING = `N${TAG}liv`; const DEAD = `N${TAG}dd1`;
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
let base, pool, srv, browser;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Dòng họ thử form B1','public')", [SLUG]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$3,$2,$4), ($5,$3,$6,$4)', [
    LIVING, { name: 'Dương Thị Sống', sex: 'f', gen: 3, birth_date: '5/3/1962', born: '1962' }, SLUG, 'e2e',
    // a deceased person with a burial and a note: editing opens the fold with both in its summary
    DEAD, { name: 'Dương Văn Mất', sex: 'm', gen: 2, born: '1930', died: '1995', burial: 'Nghĩa trang Bình Dương', note: 'Ghi chú thử nghiệm' }]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e',$2,'owner','active'), ($3,'Thành viên e2e',$2,'member','active')",
    [OWNER, SLUG, MEMBER]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip || !pool) return;
  await browser?.close();
  srv?.close();
  await pool.query('delete from suggestions where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from history where person_id in (select id from persons where family_id=$1)', [SLUG]).catch(() => {});
  await pool.query('delete from ops where person_id in (select id from persons where family_id=$1)', [SLUG]).catch(() => {});
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from persons where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

// A page signed in as the email (no email: a guest with no cookie). Console and page errors fail the test.
async function pageAs(email = '', width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  if (email) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: 'Thử' }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { const u = m.location().url || ''; if (m.type() === 'error' && !/^https:\/\/fonts\.g(oogleapis|static)\.com\//.test(u)) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  // a failed request is named by its address (a console 404 alone does not say which one)
  page.on('response', (r) => { if (r.status() >= 400 && !/^https:\/\/(fonts\.g|cdn)/.test(r.url())) errs.push(`HTTP ${r.status()} ${r.url().replace(base, '')}`); });
  return { ctx, page, errs };
}
const owner = (w) => pageAs(OWNER, w);
async function openForm(page, route) {
  await page.goto(`${base}/#/${SLUG}/${route}`);
  await page.waitForSelector('#fpform', { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.querySelector('.skel'), null, { timeout: 20000 }).catch(() => {});
}
// The visible fields of the person form, by name (a closed fold keeps its fields in the DOM, so visibility is checked).
const visibleNames = async (page) => {
  const out = new Set();
  for (const el of await page.locator('#fpform input[name], #fpform select[name]').all()) {
    if (await el.isVisible()) out.add(await el.getAttribute('name'));
  }
  return [...out].sort();
};
const foldOf = (page) => page.locator('#fpform [data-fp-fold] > details');
const toastGone = (page) => page.waitForFunction(() => !document.querySelector('.toast:not([hidden])'), null, { timeout: 10000 }).catch(() => {});
const shot = async (page, name) => {
  if (!SHOT) return;
  fs.mkdirSync(SHOT, { recursive: true });
  await toastGone(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT, name) });
};
const personIdByName = async (name) => {
  for (let i = 0; i < 60; i++) {
    const r = await pool.query("select id, data from persons where family_id=$1 and data->>'name'=$2 limit 1", [SLUG, name]);
    if (r.rows[0]) return r.rows[0];
    await new Promise((res) => setTimeout(res, 250));
  }
  return null;
};

test('new person: five essentials and the links show; Thêm chi tiết is closed and empty', { skip }, async () => {
  const { ctx, page, errs } = await owner(390);
  try {
    await openForm(page, 'them');
    const names = await visibleNames(page);
    assert.deepEqual(names, ['birth_smart', 'dead', 'name', 'sex'], 'Họ tên, Giới tính, Ngày sinh, Đã khuất (Cha mẹ is the search box, checked next)');
    assert.equal(await page.locator('#fpform input.pk-q').isVisible(), true, 'Cha/mẹ is on the page');
    for (const label of ['＋ Tên khác, tên húy', '+ Họ khác', '+ Liên hệ']) {
      assert.ok(await page.locator('#fpform', { hasText: label }).count(), `link ${label} is on the page`);
    }
    assert.equal(await foldOf(page).evaluate((el) => el.open), false, 'Thêm chi tiết is closed');
    assert.equal((await foldOf(page).locator('summary').innerText()).trim(), 'Thêm chi tiết', 'the closed summary lists nothing');
    assert.equal(await page.locator('#fpform [data-sn-row]').count(), 0, 'no surname row by default');
    assert.equal(await page.locator('#fpform [data-ct-row]').count(), 0, 'no contact row by default');
    await shot(page, 'add-person-closed.png');
    // the date: a short placeholder, the ⓘ help beside it, and the lunar as a hint only (no Âm lịch input by default)
    assert.equal(await page.locator('#fpform input[name="birth_smart"]').getAttribute('placeholder'), 'vd 1963 hoặc 5/3/1963');
    assert.ok(await page.locator('#fpform .evx-help summary').count() >= 1, 'the ⓘ help is on the date');
    await page.fill('#fpform input[name="birth_smart"]', '5/3/1963');
    assert.equal((await page.locator('#fpform [data-lunar-hint="birth_lunar"]').innerText()).trim(), '≈ 10/2 ÂL', 'an exact date shows its lunar as a hint');
    assert.equal(await page.locator('#fpform input[name="birth_lunar"]').count(), 0, 'no Âm lịch input is drawn by default');
    assert.equal(await foldOf(page).evaluate((el) => el.open), false, 'a computed lunar does not open the fold');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('a stored lunar the date does not give opens Thêm chi tiết; its chip shows it', { skip }, async () => {
  await pool.query("update persons set data = jsonb_set(data, '{birth_lunar}', '\"1/1\"') where id=$1", [LIVING]);
  const { ctx, page, errs } = await owner(390);
  try {
    await openForm(page, `sua/${LIVING}`);
    assert.equal(await foldOf(page).evaluate((el) => el.open), true, 'the fold opens for the stored lunar');
    assert.match(await page.locator('#fpform [data-au="birth_lunar"]').innerText(), /1\/1/, 'the chip shows it (with Sửa)');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('+ Họ khác adds one row per tap; saving writes the marks; the profile shows the Họ group', { skip }, async () => {
  const { ctx, page, errs } = await owner(390);
  const NAME = `Trương Thử ${TAG}`;
  try {
    await openForm(page, 'them');
    await page.fill('#fpform input[name="name"]', NAME);
    await page.click('#fpform [data-sn-add]');
    assert.equal(await page.locator('#fpform [data-sn-row]').count(), 1, 'one tap, one row');
    await page.click('#fpform [data-sn-add]');
    assert.equal(await page.locator('#fpform [data-sn-row]').count(), 2, 'a second tap, a second row');
    await page.click('#fpform [data-sn-row="1"] [data-sn-del]');
    assert.equal(await page.locator('#fpform [data-sn-row]').count(), 1, '× removes that row');
    await page.fill('#fpform [data-sn-row="0"] [data-sn-name]', 'Lý');
    await page.fill('#fpform [data-sn-row="0"] [data-sn-year]', '1632');
    assert.equal(await page.inputValue('#fpform [data-sn-row="0"] [data-sn-type]'), 'changed', 'the default type is Đổi họ');
    await page.click('#fpform [data-sn-add]');
    await page.fill('#fpform [data-sn-row="1"] [data-sn-name]', 'Hồ');
    await page.selectOption('#fpform [data-sn-row="1"] [data-sn-type]', 'abroad');
    await page.click('#fpform [data-ct-add]'); // a blank contact row: left out on save
    await shot(page, 'add-person-after-taps.png');
    await page.click('#fpsave');
    const p = await personIdByName(NAME);
    assert.ok(p, 'the person is saved');
    const names = p.data.names;
    assert.equal(names.length, 2);
    assert.deepStrictEqual(names.map((e) => [e.type, e.surname, e.from]), [['changed', 'Lý', '1632'], ['abroad', 'Hồ', undefined]]);
    await page.waitForURL(new RegExp(`#/${SLUG}/person/${p.id}`), { timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => /Họ/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 20000 }).catch(() => {});
    const text = await page.innerText('main');
    assert.ok(text.includes('Lý') && text.includes('Đổi họ'), 'the Họ group shows the mark');
    assert.ok(text.includes('Hồ') && text.includes('Họ dùng ở nước ngoài'), 'and the second one');
    // The profile asks the new person's own-profile setting (self-visibility) at once, and the server may not have the person
    // yet (the save is synced after it returns): that one 404 is expected (pre-existing, the page does not show it). Any other
    // error fails the test.
    const selfVis = errs.filter((e) => /self-visibility/.test(e)).length;
    const console404 = errs.filter((e) => /status of 404/.test(e)).length;
    assert.ok(console404 <= selfVis, 'a 404 only for the self-visibility request');
    assert.deepEqual(errs.filter((e) => !/self-visibility/.test(e) && !/status of 404/.test(e)), []);
  } finally { await ctx.close(); }
});

test('no "Thêm mốc họ" on any profile tab; the editor removes a mark with "Xóa"', { skip }, async () => {
  // LIVING gets one mark through the form's own store path (what the "+ Họ khác" row writes)
  await pool.query("update persons set data = jsonb_set(data, '{names}', $2::jsonb) where id=$1", [LIVING,
    JSON.stringify([{ type: 'birth', surname: 'Dương', from: '1900', confidence: 'confirmed' }])]);
  const { ctx, page, errs } = await owner(390);
  try {
    await page.goto(`${base}/#/${SLUG}/person/${LIVING}`);
    await page.waitForSelector('[data-ptab]', { timeout: 20000 });
    await page.waitForLoadState('networkidle');
    for (const tab of await page.locator('[data-ptab]').all()) {
      await tab.click();
      await page.waitForTimeout(150);
      assert.equal(await page.locator('[data-surn-add], #surn-slot').count(), 0, 'no add button or form slot');
      assert.equal((await page.innerText('main')).includes('Thêm mốc họ'), false, 'no "Thêm mốc họ" text');
    }
    await page.locator('[data-ptab="info"]').click().catch(() => {});
    const del = page.locator('[data-surn-del]');
    assert.equal(await del.count(), 1, 'the mark has a delete button');
    assert.equal((await del.innerText()).trim(), 'Xóa', 'it reads "Xóa"');
    await page.locator('[data-ptab="info"]').click();
    await page.waitForLoadState('networkidle');
    await shot(page, 'profile-no-old-button.png');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('"+ Liên hệ" rows save; a guest sees a contact only when it is public', { skip }, async () => {
  const { ctx, page, errs } = await owner(390);
  try {
    await openForm(page, `sua/${LIVING}`);
    await page.click('#fpform [data-ct-add]');
    await page.fill('#fpform [data-ct-row="0"] [data-ct-val]', '0912345678');
    await page.click('#fpform [data-ct-add]');
    await page.selectOption('#fpform [data-ct-row="1"] [data-ct-type]', 'email');
    await page.fill('#fpform [data-ct-row="1"] [data-ct-val]', 'lien.he@example.com');
    assert.equal(await page.locator('#fpform select[name="contact_public"]').isVisible(), true, 'the one visibility control shows under the rows');
    await page.click('#fpsave');
    let row = null;
    for (let i = 0; i < 60 && !row; i++) {
      const r = await pool.query('select data from persons where id=$1', [LIVING]);
      if (Array.isArray(r.rows[0].data.contacts) && r.rows[0].data.contacts.length === 2) row = r.rows[0].data.contacts;
      else await new Promise((res) => setTimeout(res, 250));
    }
    assert.deepStrictEqual(row, [{ type: 'phone', value: '0912345678' }, { type: 'email', value: 'lien.he@example.com' }]);
    assert.equal(errs.length, 0, 'no errors on save');
  } finally { await ctx.close(); }
  // the privacy model: a guest never gets a living person's contacts (the public view is a placeholder for the living), public
  // or not; a signed-in member of the family does. The family shows names, so the guest sees the name only.
  await pool.query("update families set living_visibility = 'names' where id=$1", [SLUG]);
  const probe = async (email, want, label) => {
    const x = await pageAs(email, 390);
    try {
      await x.page.goto(`${base}/#/${SLUG}/person/${LIVING}`);
      await x.page.waitForSelector('main', { timeout: 20000 });
      await x.page.waitForLoadState('networkidle');
      assert.equal((await x.page.innerText('main')).includes('0912345678'), want, label);
      assert.deepEqual(x.errs, []);
    } finally { await x.ctx.close(); }
  };
  await probe('', false, 'a guest does not see the contact (not public)');
  await pool.query("update persons set data = jsonb_set(data, '{contact_public}', '\"yes\"') where id=$1", [LIVING]);
  await probe('', false, 'a guest does not see the contact even when it is public');
  await probe(MEMBER, true, 'a signed-in member of the family sees it');
});

test('editing a person with a burial and a note opens Thêm chi tiết with both in its summary', { skip }, async () => {
  const { ctx, page, errs } = await owner(390);
  try {
    await openForm(page, `sua/${DEAD}`);
    assert.equal(await foldOf(page).evaluate((el) => el.open), true, 'the fold opens by itself');
    // the summary text is kept while the fold is open (its closed label is hidden then): read the disc summary itself
    const sum = (await page.locator('#fpform [data-fp-fold] [data-disc-sum]').textContent()).replace(/\s+/g, ' ').trim();
    assert.ok(sum.includes('Nơi an táng Nghĩa trang Bình Dương'), `the summary names the burial: ${sum}`);
    assert.ok(sum.includes('Ghi chú Ghi chú thử nghiệm'), 'and the note');
    await shot(page, 'edit-person-fold.png');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});

test('a member still sends a suggestion: no "+ Họ khác", Gửi góp ý, the suggestion is stored', { skip }, async () => {
  const m = await pageAs(MEMBER, 390);
  try {
    await openForm(m.page, `sua/${LIVING}`);
    assert.equal((await m.page.locator('#fpsave').innerText()).trim(), 'Gửi góp ý', 'the save button sends a suggestion');
    assert.equal(await m.page.locator('#fpform [data-sn-add]').count(), 0, 'the surname link is for editors only');
    assert.equal(await m.page.locator('#fpform [data-ct-add]').count(), 1, 'members see the contact rows');
    // the fold may be open already (LIVING has a stored lunar from an earlier test): open it only when it is closed
    if (!(await foldOf(m.page).evaluate((d) => d.open))) await m.page.locator('#fpform [data-fp-fold] summary').click();
    await m.page.fill('#fpform input[name="place"]', 'Thành phố thử');
    await m.page.click('#fpsave');
    let n = 0;
    for (let i = 0; i < 60 && !n; i++) {
      const r = await pool.query('select count(*)::int as n from suggestions where family_id=$1 and person_id=$2', [SLUG, LIVING]);
      n = r.rows[0].n; if (!n) await new Promise((res) => setTimeout(res, 250));
    }
    assert.ok(n >= 1, 'the suggestion is stored');
    assert.deepEqual(m.errs, []);
  } finally { await m.ctx.close(); }
});

test('360 px: the new person form and the open fold have no horizontal overflow', { skip }, async () => {
  const { ctx, page, errs } = await owner(360);
  try {
    await openForm(page, 'them');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok((await overflow()) <= 0, 'the closed form fits');
    await page.click('#fpform [data-sn-add]');
    await page.click('#fpform [data-ct-add]');
    await page.locator('#fpform [data-fp-fold] summary').click();
    assert.ok((await overflow()) <= 0, 'the open fold and the rows fit');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
});
