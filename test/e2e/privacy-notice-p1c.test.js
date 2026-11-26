// E2E (P1c): the members-only notice under the top bar. A guest sees it on list, tree chart and a hidden profile, and the
// CTA goes to the join flow (or to login first). A member, a device that redeemed a card (role member), and a view with
// no hidden people do not see it. Mocked API, no database.
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] node --test test/e2e/privacy-notice-p1c.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { skip, launch, startWeb } = require('./_e2e-harness');

// A member's (or a redeemed device's) response carries the full record: no hidden_living, the name is there.
const FULL_LIVE = { id: 'PH1', deleted: false, v: 1, data: { gen: 2, sex: 'f', name: 'Dương Thị Ba', born: '1955', parent: 'PA' } };
const LIVE = { id: 'PH1', deleted: false, v: 1, data: { gen: 2, sex: 'f', name: '', hidden_living: true, parent: 'PA' } };
const HIDDEN_ROW = { id: 'PH2', deleted: false, v: 1, data: { name: '', hidden_living: true } };
const PA = { id: 'PA', deleted: false, v: 1, data: { gen: 1, sex: 'm', name: 'Tổ Thử Một', born: '1900', died: '1970' } };
const WITH_HIDDEN = [PA, LIVE, HIDDEN_ROW];
const NO_HIDDEN = [PA, { id: 'PB', deleted: false, v: 1, data: { gen: 2, sex: 'f', name: 'Bà Thử Hai', born: '1930', parent: 'PA' } }];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };
const GUEST = { editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: true, roles: {} };
const SIGNED_OUT_NON_MEMBER = { ...GUEST, email: 'x@test.local', name: 'Khách' };
const MEMBER = { ...GUEST, role: 'member', status: 'active', email: 'm@test.local', name: 'Thành viên', roles: { duong: 'member' } };
// A device that redeemed a card: the server resolves it as role member (server.js whoFor, device branch).
const DEVICE = { ...GUEST, role: 'member', status: 'active', email: null, name: 'Bà Thử Hai', roles: { duong: 'member' } };
const DEVICE_PERSONS = [PA, FULL_LIVE];
let srv, base;
const label = 'Người còn sống';

test.before(async () => { if (skip) return; const w = await startWeb(); srv = w.srv; base = w.base; });
test.after(() => { srv?.close(); });

async function open({ width = 390, me, persons, hash, dark = false }) {
  const browser = await launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname;
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json(me);
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') return json({ items: persons, next_since: 3 });
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + '/' + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  return { browser, ctx, page, errors };
}
const note = (page) => page.evaluate(() => {
  const el = document.querySelector('#pnote');
  if (!el || el.hidden) return null;
  const cta = el.querySelector('a.pnote-cta');
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
  const txt = el.querySelector('.pnote-txt');
  return { text: txt?.textContent.trim() || '', href: cta?.getAttribute('href') || '', buttons: el.querySelectorAll('button').length,
    lines: Math.round(txt.getBoundingClientRect().height / lh), pad: el.getBoundingClientRect().top, bodyHas: document.body.classList.contains('has-pnote') };
});


test('a guest (logged out) sees the notice on the list, the chart and a hidden profile; CTA goes to login then join', { skip }, async () => {
  for (const [hash, width] of [['#/duong/list', 390], ['#tree', 1280], ['#/duong/person/PH1', 390]]) {
    const s = await open({ width, me: GUEST, persons: WITH_HIDDEN, hash });
    try {
      const n = await note(s.page);
      assert.ok(n, hash + ' at ' + width + ': notice shown');
      assert.match(n.text, /chỉ hiện cho người trong họ/);
      assert.match(n.text, /Bạn là người nhà\? Xin tham gia/, 'the join CTA shows its text when logged out');
      assert.match(n.text, /Có thẻ đăng nhập\? Quét mã QR trên thẻ\./, 'the card hint is shown after the CTA');
      assert.equal(n.href, '/api/auth/google?next=join', 'logged out: CTA logs in and returns to join');
      assert.equal(n.buttons, 0, 'not dismissible: no button in the stripe');
      assert.ok(n.lines <= 2, hash + ' at ' + width + ': at most 2 lines, got ' + n.lines);
      assert.equal(n.bodyHas, true, 'the shell is padded below the stripe');
      assert.deepEqual(s.errors, [], 'no page errors');
    } finally { await s.browser.close(); }
  }
});

test('a signed-in non-member sees the notice, and its CTA opens the join request for the family', { skip }, async () => {
  const s = await open({ width: 390, me: SIGNED_OUT_NON_MEMBER, persons: WITH_HIDDEN, hash: '#/duong/list' });
  try {
    const n = await s.page.evaluate(() => document.querySelector('#pnote a.pnote-cta')?.textContent.trim());
    assert.equal(n, 'Bạn là người nhà? Xin tham gia');
    const href = await s.page.evaluate(() => document.querySelector('#pnote a.pnote-cta').getAttribute('href'));
    assert.equal(href, '#join', 'signed in: the join request for this family');
    await s.page.click('#pnote a.pnote-cta');
    await s.page.waitForTimeout(400);
    assert.match(await s.page.evaluate(() => location.hash), /join$/);
  } finally { await s.browser.close(); }
});

test('a member does not see the notice, and sees the living data', { skip }, async () => {
  const s = await open({ width: 390, me: MEMBER, persons: WITH_HIDDEN, hash: '#/duong/list' });
  try {
    assert.equal(await note(s.page), null, 'no notice for a member');
    assert.equal(await s.page.evaluate(() => document.body.classList.contains('has-pnote')), false);
  } finally { await s.browser.close(); }
});

test('a device that redeemed a card (role member) does not see the notice, and sees the living person by name', { skip }, async () => {
  const s = await open({ width: 390, me: DEVICE, persons: DEVICE_PERSONS, hash: '#/duong/person/PH1' });
  try {
    assert.equal(await note(s.page), null, 'no notice for a device member');
    const h1 = await s.page.evaluate(() => document.querySelector('#main h1')?.textContent.trim() || '');
    assert.ok(h1.includes('Dương Thị Ba') && h1 !== label, 'the living person shows the name, not the label: ' + h1);
  } finally { await s.browser.close(); }
});

test('a guest on a view with no hidden people does not see the notice', { skip }, async () => {
  const s = await open({ width: 390, me: GUEST, persons: NO_HIDDEN, hash: '#/duong/list' });
  try {
    assert.equal(await note(s.page), null, 'no hidden person in the view: no notice');
  } finally { await s.browser.close(); }
});
