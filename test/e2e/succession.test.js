// E2E: succession in the browser, against the real server and a scratch database.
//   GP_TEST_DATABASE_URL=postgres://... NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] npm run test:e2e (from giapha/server)
// Flows: the owner invites a trusted contact and the contact accepts; the owner is inactive (time injected through the
// test-only tick endpoint): a member sees the notice banner, the contact opens the offer, gets the email code and accepts;
// the previous owner reclaims the role; a signed-in member creates a new family. Brevo is a fake transport (nothing sent).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `e2e-${TAG}`;
const FAM_NAME = `Họ E2E ${TAG}`;
const EM = { owner: `owner-${TAG}@test.local`, contact: `contact-${TAG}@test.local`, member: `member-${TAG}@test.local`, creator: `creator-${TAG}@test.local` };
const sent = [];
const DAY = 864e5;
let base, pool, srv, browser, mail, R, created = [];

const addMonths = (ms, n) => R.addMonths(ms, n);
async function api(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
async function sessionCookie(email, name) {
  const r = await api('POST', '/api/test/session', { email, name });
  assert.strictEqual(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}
async function signedContext(email, name) {
  const cookie = await sessionCookie(email, name);
  const [pair] = cookie.split(';');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  return ctx;
}
const lastTo = (to, re) => [...sent].reverse().find((m) => m.to === to && re.test(m.subject + '\n' + m.text));
const tokenOf = (m) => /#(?:offer|trusted)\/([A-Za-z0-9_-]{20,})/.exec(m.text)?.[1];
const codeOf = (m) => /Mã của bạn là: (\d{6})/.exec(m.text)?.[1];
// Waits until a selector shows text (up to 8 s).
async function waitText(page, sel, re) {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const txt = await page.locator(sel).first().innerText().catch(() => '');
    if (re.test(txt)) return txt;
    await page.waitForTimeout(150);
  }
  assert.fail(`no ${re} in ${sel}: ${(await page.locator(sel).first().innerText().catch(() => '')).slice(0, 200)}`);
}

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = DB_URL; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  Object.assign(process.env, { BREVO_API_KEY: 'xkeys-FAKE-e2e-' + TAG, MAIL_FROM: 'noreply@example.test', PUBLIC_URL: 'https://giapha.test' });
  const { app, pool: p } = require('../../server/server');
  pool = p;
  mail = require('../../server/mail'); R = require('../../server/succession-rules');
  mail.setTransport(async ({ body }) => { sent.push({ to: body.to[0].email, subject: body.subject, text: body.textContent }); return { messageId: 'e2e-' + sent.length }; });
  await pool.query('insert into families (id, slug, name, visibility, owner_inactive_months) values ($1,$1,$2,\'public\',12)', [FAM, FAM_NAME]);
  created.push(FAM);
  await pool.query("insert into members (email, name, role, status, family_id, approved_at) values ($1,'Chủ e2e','owner','active',$2, now() - interval '2 years')", [EM.owner, FAM]);
  await pool.query("insert into members (email, name, role, status, family_id, approved_at) values ($1,'Thành viên e2e','member','active',$2, now())", [EM.member, FAM]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close().catch(() => {});
  mail?.setTransport(null);
  if (pool) {
    const ids = created;
    await pool.query('delete from mail_log where family_id = any($1)', [ids]).catch(() => {});
    await pool.query('delete from handover_steps where request_id in (select id from handover_requests where family_id = any($1))', [ids]).catch(() => {});
    await pool.query('delete from handover_offers where request_id in (select id from handover_requests where family_id = any($1))', [ids]).catch(() => {});
    await pool.query('delete from handover_requests where family_id = any($1)', [ids]).catch(() => {});
    await pool.query('delete from trusted_contacts where family_id = any($1)', [ids]).catch(() => {});
    await pool.query('delete from history where person_id in (select id from persons where family_id = any($1))', [ids]).catch(() => {});
    await pool.query('delete from persons where family_id = any($1)', [ids]).catch(() => {});
    await pool.query('delete from members where family_id = any($1) or email like $2', [ids, `%-${TAG}@test.local`]).catch(() => {});
    await pool.query('delete from families where id = any($1)', [ids]).catch(() => {});
    await pool.end().catch(() => {});
  }
  srv?.close();
});

test('the owner invites a trusted contact; the contact accepts from the invite link', { skip }, async () => {
  const owner = await signedContext(EM.owner, 'Chủ e2e');
  const page = await owner.newPage();
  await page.goto(`${base}/#/${FAM}/nguoi-ke-nhiem`);
  await page.locator('#succ-add').waitFor({ timeout: 8000 });
  await page.locator('#succ-add input[name=email]').fill(EM.contact);
  await page.locator('#succ-add input[name=name]').fill('Cô e2e');
  await page.locator('#succ-add button').click();
  await waitText(page, '#succ-settings', /Chờ chấp nhận/);
  const invite = lastTo(EM.contact, /Người được ủy thác/);
  assert.ok(invite, 'invite mail sent');
  const token = tokenOf(invite);
  const contact = await signedContext(EM.contact, 'Cô e2e');
  const cp = await contact.newPage();
  await cp.goto(`${base}/#trusted/${token}`);
  await cp.getByRole('button', { name: 'Chấp nhận' }).click();
  // the page shows "Cảm ơn bạn" right after the click, and renders the accepted state again when it re-reads the invite:
  // both say the same thing, so either is the accepted page; the owner's page below checks the stored state
  await waitText(cp, '.succ-page', /Cảm ơn bạn|Bạn đã nhận lời mời/);
  await page.reload();
  await waitText(page, '#succ-settings', /Đã chấp nhận/);
  // the owner's requests write last_seen_at on the server (after the response): let them land before the next test sets it
  await page.waitForLoadState('networkidle');
  await owner.close(); await contact.close();
});

test('an inactive owner: a member sees the notice, the contact takes the offer with the email code; the previous owner reclaims', { skip }, async () => {
  const t = Date.now();
  await pool.query("update members set last_seen_at = $2 where family_id=$1 and role='owner' and status='active'", [FAM, new Date(addMonths(t, -13))]);
  const tick = (now) => api('POST', '/api/test/succession/tick', { now: new Date(now).toISOString(), family: FAM });
  const n1 = await tick(t);
  assert.strictEqual(n1.json.stats.notices, 1, JSON.stringify(n1.json));
  const member = await signedContext(EM.member, 'Thành viên e2e');
  const mp = await member.newPage();
  await mp.goto(`${base}/#/${FAM}/tree`);
  await waitText(mp, '#main', /Dòng họ sẽ chuyển quyền|chuyển quyền/);
  assert.ok(await mp.locator('.succ-bar').count(), 'the banner shows to members');
  const o2 = await tick(t + 14 * DAY + 60e3);
  assert.strictEqual(o2.json.stats.offers, 1);
  const offerMail = lastTo(EM.contact, /Bạn được mời nhận quyền/);
  assert.ok(offerMail, 'the contact is offered the role first');
  const token = tokenOf(offerMail);
  const contact = await signedContext(EM.contact, 'Cô e2e');
  const cp = await contact.newPage();
  await cp.goto(`${base}/#offer/${token}`);
  await cp.getByRole('button', { name: /Gửi mã đến/ }).click();
  const t1 = Date.now(); while (!lastTo(EM.contact, /Mã xác nhận/) && Date.now() - t1 < 8000) await cp.waitForTimeout(100);
  const code = codeOf(lastTo(EM.contact, /Mã xác nhận/));
  assert.match(code, /^\d{6}$/);
  await cp.locator('#off-form input[name=code]').fill('000000');
  await cp.getByRole('button', { name: 'Nhận quyền Chủ họ' }).click();
  await waitText(cp, '#off-err', /Mã không đúng/);
  await cp.locator('#off-form input[name=code]').fill(code);
  await cp.getByRole('button', { name: 'Nhận quyền Chủ họ' }).click();
  await waitText(cp, '#off-done', /Bạn là Chủ họ/);
  // the previous owner signs in: owner rights moved, so they can reclaim within 90 days
  const owner = await signedContext(EM.owner, 'Chủ e2e');
  const op = await owner.newPage();
  await op.goto(`${base}/#/${FAM}/nguoi-ke-nhiem`);
  await waitText(op, '#succ-settings', /Lấy lại quyền Chủ họ/);
  await op.getByRole('button', { name: /Lấy lại quyền Chủ họ/ }).click();
  await op.getByRole('button', { name: 'Lấy lại', exact: true }).click();
  // the change is saved by the server: wait for the owner row, not for the page text
  let owners = [];
  for (let i = 0; i < 80; i++) {
    owners = (await pool.query("select email from members where family_id=$1 and role='owner' and status='active'", [FAM])).rows.map((r) => r.email);
    if (owners[0] === EM.owner) break;
    await op.waitForTimeout(100);
  }
  assert.deepStrictEqual(owners, [EM.owner], 'the previous owner is owner again');
  await member.close(); await contact.close(); await owner.close();
});

test('a signed-in account creates a new family: find page, Thêm, the form, then the new tree', { skip }, async () => {
  const ctx = await signedContext(EM.creator, 'Người Lập');
  const page = await ctx.newPage();
  await page.goto(`${base}/#tim-dong-ho`);
  await waitText(page, '#main', /Lập gia phả mới/);
  await page.locator('a.cay-new[href="#lap-gia-pha"]').click();
  await page.locator('#lf-form').waitFor({ timeout: 8000 });
  await page.locator('#lf-form input[name=name]').fill(FAM_NAME + ' mới');
  await page.locator('#lf-han').fill('潘');
  await page.locator('#lf-tile .crest-ch').waitFor({ timeout: 4000 });
  await page.locator('#lf-form input[name=place]').fill('Củ Chi');
  await page.locator('#lf-form select[name=visibility]').selectOption('link');
  await page.locator('#lf-form input[name=fp_name]').fill('Cụ Tổ e2e');
  await page.locator('#lf-form select[name=fp_sex]').selectOption('m');
  await page.getByRole('button', { name: 'Lập gia phả' }).click();
  await page.waitForFunction(() => /\/tree/.test(location.hash), null, { timeout: 8000 });
  const slug = /#\/([a-z0-9-]+)\/tree/.exec(await page.evaluate(() => location.hash))?.[1];
  assert.ok(slug, 'landed on the new family tree');
  created.push(slug);
  const row = await pool.query("select role from members where family_id=$1 and email=$2", [slug, EM.creator]);
  assert.strictEqual(row.rows[0].role, 'owner', 'the creator is the owner');
  const persons = await pool.query('select count(*)::int n from persons where family_id=$1', [slug]);
  assert.strictEqual(persons.rows[0].n, 1, 'the first person was added');
  await ctx.close();
});
