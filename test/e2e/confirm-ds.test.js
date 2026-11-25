// E2E (U5a): the confirm dialogs run on the DS openConfirm (vendor confirm.js).
//   confirmDialog (app.js, wait: true): OK shows the pending state (aria-busy, OK and cancel disabled) and the dialog
//   closes when the request succeeds; a failed request shows its error in the dialog, which stays open.
//   confirmDanger (danger.js): typeName gates OK (trimmed, case-insensitive); reason is required (3+ characters) and
//   reaches onConfirm trimmed; focus starts on the heading; Esc cancels once and returns focus to the opener.
//   confirmModal (ui.js): warn is shown as a note (role=note) and OK runs after the dialog closed.
// Own family (slug cf-<tag>) and own pending member. Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://.../<scratch>
// and NODE_PATH=<dir with playwright>. The harness page only imports web/js/ui.js and web/js/danger.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !/scratch|e2e|giapha_ci/.test(DB_URL) ? 'GP_TEST_DATABASE_URL must name a scratch database (contains "scratch", "e2e" or giapha_ci)'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const TAG = crypto.randomBytes(3).toString('hex');
const SLUG = `cf-${TAG}`;
const OWNER = `owner.${TAG}@test.local`;
const MOD = (f) => path.join(__dirname, '..', '..', 'server', f);
const HARNESS = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  + '<link rel="stylesheet" href="/vendor/reika-ds/tokens.css"><link rel="stylesheet" href="/vendor/reika-ds/web.css">'
  + '<link rel="stylesheet" href="/app.css"></head><body><button id="opener" type="button">Open</button>'
  + '<script type="module">import * as U from "/js/ui.js"; import * as D from "/js/danger.js"; window.U = U; window.D = D; window.ready = true;</script>'
  + '</body></html>';
let base, pool, srv, browser, pendingId;

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require(MOD('server'));
  pool = p;
  for (const f of fs.readdirSync(MOD('migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(MOD('migrations') + '/' + f, 'utf8'));
  await pool.query('insert into families (id, slug, name, visibility) values ($1,$1,$2,\'public\')', [SLUG, `Confirm ${TAG}`]);
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Owner cf',$2,'owner','active')", [OWNER, SLUG]);
  const pm = await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Pending cf',$2,'member','pending') returning id",
    [`pending.${TAG}@test.local`, SLUG]);
  pendingId = pm.rows[0].id;
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip || !pool) return;
  await browser?.close();
  srv?.close();
  await pool.query('delete from members where family_id=$1', [SLUG]).catch(() => {});
  await pool.query('delete from families where id=$1', [SLUG]).catch(() => {});
  await pool.end().catch(() => {});
});

async function ownerPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: 'Owner cf' }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, errs };
}

// The harness page: the real ui.js and danger.js modules, no app boot.
async function harness() {
  const s = await ownerPage();
  await s.page.route(`${base}/__confirm-harness.html`, (r) => r.fulfill({ contentType: 'text/html', body: HARNESS }));
  await s.page.goto(`${base}/__confirm-harness.html`);
  await s.page.waitForFunction(() => window.ready === true, null, { timeout: 15000 });
  return s;
}

test('confirmDialog (wait: true): pending state while the request runs, then closes', { skip }, async () => {
  const { ctx, page, errs } = await ownerPage();
  try {
    let hits = 0;
    await page.route(new RegExp(`/api/members/${pendingId}/reject`), async (route) => {
      hits++;
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto(`${base}/#/${SLUG}/members`);
    await page.waitForSelector('[data-mact="reject"]', { timeout: 20000 });
    await page.click('[data-mact="reject"]');
    await page.waitForSelector('dialog#cfm[open]');
    await page.click('dialog#cfm [data-rds-confirm]');
    await page.waitForFunction(() => document.querySelector('dialog#cfm [data-rds-confirm]')?.getAttribute('aria-busy') === 'true', null, { timeout: 5000 });
    const pending = await page.evaluate(() => ({
      ok: document.querySelector('dialog#cfm [data-rds-confirm]').disabled,
      cancel: document.querySelector('dialog#cfm .rds-btn--ghost').disabled,
    }));
    assert.deepStrictEqual(pending, { ok: true, cancel: true }, 'OK and cancel are disabled while the request runs');
    await page.waitForFunction(() => !document.querySelector('dialog#cfm'), null, { timeout: 10000 });
    assert.equal(hits, 1, 'one request');
    const row = await pool.query('select status from members where id=$1', [pendingId]);
    assert.notEqual(row.rows[0].status, 'pending', 'the request was saved before the dialog closed');
    assert.deepStrictEqual(errs, []);
  } finally { await ctx.close(); }
});

test('confirmDialog (wait: true): a failed request shows the error and the dialog stays open', { skip }, async () => {
  const { ctx, page, errs } = await ownerPage();
  try {
    const pid = (await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Pending cf 2',$2,'member','pending') returning id", [`pending2.${TAG}@test.local`, SLUG])).rows[0].id;
    await page.route(new RegExp(`/api/members/${pid}/reject`), (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Try again later' }),
    }));
    await page.goto(`${base}/#/${SLUG}/members`);
    await page.waitForSelector('[data-mact="reject"]', { timeout: 20000 });
    await page.click('[data-mact="reject"]');
    await page.waitForSelector('dialog#cfm[open]');
    await page.click('dialog#cfm [data-rds-confirm]');
    await page.waitForSelector('dialog#cfm .rds-confirm__error:not([hidden])', { timeout: 10000 });
    const after = await page.evaluate(() => ({
      open: document.querySelector('dialog#cfm')?.open === true,
      text: document.querySelector('dialog#cfm .rds-confirm__error').textContent,
      ok: document.querySelector('dialog#cfm [data-rds-confirm]').disabled,
      busy: document.querySelector('dialog#cfm [data-rds-confirm]').hasAttribute('aria-busy'),
    }));
    assert.equal(after.open, true, 'stays open');
    assert.ok(after.text.trim().length > 0, 'error text is shown');
    assert.deepStrictEqual({ ok: after.ok, busy: after.busy }, { ok: false, busy: false }, 'OK is enabled again');
    assert.deepStrictEqual(errs, []);
  } finally { await ctx.close(); }
});

test('confirmDanger: typeName gates OK (trimmed, case-insensitive); focus starts on the heading', { skip }, async () => {
  const { ctx, page, errs } = await harness();
  try {
    await page.evaluate(() => { window.res = {}; window.D.confirmDanger({ title: 'Delete person?', lose: 'The person is hidden.', typeName: 'Ana Lee', confirm: 'Delete', onConfirm: () => { window.res.ok = true; } }); });
    const ok = page.locator('dialog#dcf [data-rds-confirm]');
    const typed = page.locator('dialog#dcf [data-rds-type]');
    assert.equal(await ok.isDisabled(), true, 'OK starts disabled');
    assert.equal(await ok.getAttribute('data-danger'), '', 'the confirm button carries data-danger');
    assert.equal(await page.getAttribute('dialog#dcf', 'role'), 'alertdialog');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'dcf-title', 'focus on the heading');
    await typed.fill('Ana Le');
    assert.equal(await ok.isDisabled(), true, 'a partial name keeps OK disabled');
    await typed.fill(' ana lee ');
    assert.equal(await ok.isDisabled(), false, 'the name in another case with spaces enables OK');
    await ok.click();
    await page.waitForFunction(() => !document.querySelector('dialog#dcf'), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.res.ok), true, 'onConfirm ran');
    assert.deepStrictEqual(errs, []);
  } finally { await ctx.close(); }
});

test('confirmDanger: a reason is required (3+ characters) and reaches onConfirm trimmed', { skip }, async () => {
  const { ctx, page, errs } = await harness();
  try {
    await page.evaluate(() => { window.res = {}; window.D.confirmDanger({ title: 'Remove link?', lose: 'The link stops.', reason: 'Why', confirm: 'Remove', onConfirm: (r) => { window.res.reason = r.reason; } }); });
    const ok = page.locator('dialog#dcf [data-rds-confirm]');
    const box = page.locator('dialog#dcf textarea');
    assert.equal(await ok.isDisabled(), true, 'OK starts disabled');
    await box.fill('  ab ');
    assert.equal(await ok.isDisabled(), true, 'two characters after trimming are not enough');
    await box.fill('  abc  ');
    assert.equal(await ok.isDisabled(), false, 'three characters enable OK');
    await ok.click();
    await page.waitForFunction(() => !document.querySelector('dialog#dcf'), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.res.reason), 'abc');
    assert.deepStrictEqual(errs, []);
  } finally { await ctx.close(); }
});

test('confirmModal: warn is shown as a note; OK runs after the dialog closed', { skip }, async () => {
  const { ctx, page, errs } = await harness();
  try {
    await page.evaluate(() => {
      window.res = {};
      window.U.confirmModal({ title: 'Sign out here?', body: 'This device signs out.', warn: 'Two unsent items wait here.', ok: 'Sign out', danger: true,
        onOk: () => { window.res.closedFirst = !document.querySelector('dialog#cfm'); window.res.ok = true; } });
    });
    const note = page.locator('dialog#cfm .rds-confirm__note[role="note"]');
    assert.match(await note.textContent(), /Two unsent items wait here/);
    await page.click('dialog#cfm [data-rds-confirm]');
    await page.waitForFunction(() => window.res.ok === true, null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.res.closedFirst), true, 'the dialog had closed before onOk ran');
    assert.deepStrictEqual(errs, []);
  } finally { await ctx.close(); }
});

test('Esc cancels a confirmDanger once and returns focus to the opener', { skip }, async () => {
  const { ctx, page, errs } = await harness();
  try {
    await page.evaluate(() => {
      window.res = { cancel: 0, ok: 0 };
      document.getElementById('opener').focus();
      window.D.confirmDanger({ title: 'Delete note?', lose: 'The note goes.', confirm: 'Delete', onConfirm: () => { window.res.ok++; }, onCancel: () => { window.res.cancel++; } });
    });
    await page.waitForSelector('dialog#dcf[open]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog#dcf'), null, { timeout: 5000 });
    const r = await page.evaluate(() => ({ ...window.res, focus: document.activeElement?.id }));
    assert.deepStrictEqual(r, { cancel: 1, ok: 0, focus: 'opener' }, 'cancel fired once, no delete, focus back on the opener');
    assert.deepStrictEqual(errs, []);
  } finally { await ctx.close(); }
});
