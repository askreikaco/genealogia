// E2E, duplicates inside one tree: the review page lists "Có thể trùng trong cây này" with the reasons; the editor
// compares the two records side by side, chooses a value per field and proposes a merge (a family vote: nothing moves
// yet, the pair shows as "Đang biểu quyết"); a plain member sees no such section. Invented names only.
// Needs a database (GP_TEST_DATABASE_URL, own schema e2e_dupes_review) + playwright + Chrome, like match-review.test.js.
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

const OWNER = 'owner-dupes-e2e@test.local'; const MEMBER = 'member-dupes-e2e@test.local';
let base, pool, srv, browser, iso;

test.before(async () => {
  if (skip) return;
  const { isolatedDb } = require('./_isolated-db');
  iso = isolatedDb(DB_URL, 'dupes_review');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  await pool.query("insert into relation_migrations (family_id, counts) values ('duong', '{}') on conflict do nothing"); // table mode
  const ins = (id, data) => pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, 'duong', data, 'e2e']);
  await ins('P101', { name: 'Dương Văn Hợp', sex: 'm', born: '1900', died: '1950', place: 'Xã Thử A', note: 'Ghi chú cũ' });
  await ins('P102', { name: 'Dương Văn Hợp', sex: 'm', born: '1900', died: '1950', note: 'Ghi chú mới' });
  // P102 is the older profile (its first history entry is 30 days back): it must be the one kept, though P101 comes first
  await pool.query("insert into history (person_id, field, at) values ('P101','born', now()), ('P102','born', now() - interval '30 days')");
  await ins('P103', { name: 'Dương Thị Con', sex: 'f', born: '1925' });
  await pool.query("insert into parent_child (family_id, parent_id, child_id) values ('duong','P101','P103')");
  await pool.query(`insert into members (email, name, family_id, role, status) values ($1,'Chủ họ e2e','duong','owner','active'),
    ($2,'Thành viên e2e','duong','member','active') on conflict (family_id, email) do nothing`, [OWNER, MEMBER]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((res) => srv.on('listening', res));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close(); srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function newPage({ email, width = 390, scheme = 'light' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  if (email) {
    const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: email }) });
    const [pair] = r.headers.get('set-cookie').split(';');
    await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  }
  return { ctx, page: await ctx.newPage() };
}
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: false }); };

test('editor: candidate list with reasons, compare sheet, a merge proposal that waits for the vote; a member sees none', { skip }, async () => {
  const { ctx, page } = await newPage({ email: OWNER });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  try {
    await page.goto(base + '/#review');
    await page.waitForSelector('#dpend .dp-pend', { timeout: 15000 });
    const sec = page.locator('#dpend .dp-pend');
    assert.match(await sec.locator('h2').innerText(), /Có thể trùng trong cây này/);
    assert.equal(await sec.locator('.dp-row').count(), 1, 'the two Dương Văn Hợp are one pair');
    const row = sec.locator('.dp-row');
    assert.match(await row.innerText(), /khớp \d+%/);
    assert.match(await row.innerText(), /cùng họ tên/);
    await shot(page, 'dupes-list-390.png');
    await row.locator('[data-dp=compare]').click();
    const dlg = page.locator('dialog.dp-cmp');
    await dlg.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForSelector('.dp-cmp .dp-field', { timeout: 10000 });
    assert.equal(await dlg.locator('input[name=keepwho]').count(), 0, 'no choice of the kept record: the older one is kept');
    assert.match(await dlg.innerText(), /Hồ sơ giữ lại \(cũ hơn\): Dương Văn Hợp/);
    assert.equal(await dlg.locator('.dp-field').count(), 1, 'only the note differs: one choice');
    assert.match(await dlg.innerText(), /Bổ sung: Nơi ở Xã Thử A/, 'a value on one side only is filled in, shown as text');
    assert.equal(await dlg.locator('.dp-field [name^=c-place]').count(), 0, 'no radio for a filled field');
    assert.match(await dlg.innerText(), /4 trường giống nhau/, 'equal fields (name, sex, born, died) are counted in one line');
    assert.equal(await dlg.locator('input[name=c-note][value=keep]').isChecked(), true, 'conflict: default is the kept (older) value');
    await dlg.locator('input[name=c-note][value=drop]').check();
    await shot(page, 'dupes-compare-390.png');
    await dlg.locator('textarea#dpwhy').fill('Cùng một người, đã đối chiếu');
    await dlg.locator('#dpgo').click();
    await page.waitForFunction(() => !document.querySelector('dialog.dp-cmp')?.open, null, { timeout: 10000 });
    const dec = (await pool.query("select kind, subject_ref, payload, state from decisions where kind='merge_person'")).rows[0];
    assert.ok(dec, 'a merge vote is open');
    assert.equal(dec.state, 'open'); assert.equal(dec.subject_ref, 'P101', 'the newer profile is merged away'); assert.equal(dec.payload.keep, 'P102', 'the older one is kept');
    assert.equal(dec.payload.choices.note, 'drop', 'the conflict choice the owner made is recorded');
    assert.equal(dec.payload.choices.place, 'drop', 'a filled field is taken from the other record');
    assert.equal((await pool.query("select deleted from persons where id='P101'")).rows[0].deleted, false, 'nothing moved yet');
    await page.waitForFunction(() => /Đang biểu quyết/.test(document.querySelector('#dpend')?.innerText || ''), null, { timeout: 10000 });
    assert.equal(await page.locator('#dpend [data-dp=compare]').count(), 0, 'a pair with an open vote is not offered again');
    if (SHOT) await shot(page, 'dupes-pending-390.png');
    assert.deepEqual(errs, []);
  } finally { await ctx.close(); }
  const m = await newPage({ email: MEMBER });
  try {
    await m.page.goto(base + '/#review');
    await m.page.waitForTimeout(1500);
    assert.equal(await m.page.locator('#dpend .dp-pend').count(), 0, 'a member is no editor: no candidates');
  } finally { await m.ctx.close(); }
});
