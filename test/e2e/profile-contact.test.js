// E2E: the Liên hệ group card on the person profile.
// Guest: a living person with hidden contacts (has_contact) shows the card with a sign-in prompt and no values.
// Signed in without a role in the family: the card says to ask to be added, no sign-in button.
// Member: the values (phone as a tel: link, email as a mailto: link). A dead person, or one without contacts: no card.
// Mocked API, no database:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/profile-contact.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !chromium ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;
const WEB = path.join(__dirname, '..', '..', 'web');
const SHOT_DIR = process.env.GP_SHOT_DIR || '';

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const FULL = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0, died: '1900' }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1960', phone: '0900000001', email: 'cha@example.test', zalo: '0900000001', address: 'Số 1, Phường Một' }),
  P('PD', { name: 'Dương Văn Đã', sex: 'm', gen: 6, thu: '2', parent: 'PR', order: 2, born: '1930', died: '2001', phone: '0900000002' }),
  P('PN', { name: 'Dương Văn Không', sex: 'm', gen: 6, thu: '3', parent: 'PR', order: 3, born: '1965' }),
];
// what the server sends a non-member: contacts stripped, a boolean for the living person who has some
const PUBLIC = FULL.map((p) => {
  const d = { ...p.data }; const had = ['phone', 'email', 'zalo', 'address'].some((k) => d[k]);
  for (const k of ['phone', 'email', 'zalo', 'facebook', 'social', 'address']) delete d[k];
  if (had && !d.died) d.has_contact = true;
  return { ...p, data: d };
});
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };

let base; let srv; let browser;
test.before(async () => {
  if (skip) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const pn = u.pathname === '/' ? '/index.html' : u.pathname; const f = path.join(WEB, pn);
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME });
});
test.after(async () => { await browser?.close(); srv?.close(); });

// who: 'guest' | 'outsider' (signed in, no role here) | 'member'
async function openProfile(who, id) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  const member = who === 'member';
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') {
      if (who === 'guest') return json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
      return json({ editor: null, role: member ? 'member' : 'guest', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: member ? { duong: 'member' } : {} });
    }
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: member ? FULL : PUBLIC, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(`${base}/#/duong/person/${id}`);
  await page.waitForSelector('.ptabs', { timeout: 8000 });
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}
const card = (page) => page.locator('section.consec[aria-label="Liên hệ"]');

test('guest: Liên hệ card with a sign-in prompt and no values', { skip }, async () => {
  const { page, ctx, errors } = await openProfile('guest', 'PA');
  try {
    assert.equal(await card(page).count(), 1, 'one Liên hệ card');
    const t = await card(page).innerText();
    assert.match(t, /chỉ hiện cho người trong họ đã đăng nhập/);
    assert.doesNotMatch(t, /0900000001|cha@example/);
    assert.equal(await card(page).locator('button[data-acct="in"]').count(), 1, 'sign-in button');
    assert.doesNotMatch(await page.locator('.factcard').innerText(), /Liên hệ/, 'no Liên hệ line in Thông tin');
    if (SHOT_DIR) await card(page).screenshot({ path: path.join(SHOT_DIR, 'lienhe-guest-390.png') });
    await card(page).locator('button[data-acct="in"]').click();
    await page.waitForSelector('dialog[open], .dlg, [role="dialog"]', { timeout: 4000 });
    assert.deepStrictEqual(errors, []);
  } finally { await ctx.close(); }
});

test('signed in without a role: asks to be added, no sign-in button', { skip }, async () => {
  const { page, ctx, errors } = await openProfile('outsider', 'PA');
  try {
    assert.match(await card(page).innerText(), /cần được thêm vào dòng họ/);
    assert.equal(await card(page).locator('button[data-acct="in"]').count(), 0);
    assert.deepStrictEqual(errors, []);
  } finally { await ctx.close(); }
});

test('member: the values, phone and email as links', { skip }, async () => {
  const { page, ctx, errors } = await openProfile('member', 'PA');
  try {
    const t = await card(page).innerText();
    for (const s of ['Điện thoại', '0900000001', 'Email', 'cha@example.test', 'Zalo', 'Địa chỉ', 'Số 1, Phường Một']) assert.ok(t.includes(s), s);
    assert.equal(await card(page).locator('a[href="tel:0900000001"]').count(), 1);
    assert.equal(await card(page).locator('a[href="mailto:cha@example.test"]').count(), 1);
    assert.equal(await card(page).locator('button[data-acct="in"]').count(), 0);
    if (SHOT_DIR) await card(page).screenshot({ path: path.join(SHOT_DIR, 'lienhe-member-390.png') });
    assert.deepStrictEqual(errors, []);
  } finally { await ctx.close(); }
});

test('no card: a dead person (guest), a person without contacts', { skip }, async () => {
  for (const [who, id] of [['guest', 'PD'], ['guest', 'PN'], ['member', 'PN']]) {
    const { page, ctx, errors } = await openProfile(who, id);
    try {
      assert.equal(await card(page).count(), 0, `${who} ${id}: no Liên hệ card`);
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); }
  }
});
