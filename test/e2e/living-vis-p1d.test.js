// E2E (P1d): how living people show to non-members. A guest sees a name-only person next to a placeholder; the owner
// sets the family choice (names asks for consent first; cancel keeps the setting); a linked member changes their own
// setting. Mocked API, no database. Screenshots when GP_SHOT_DIR is set.
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/living-vis-p1d.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');

const PA = { id: 'PA', deleted: false, v: 1, data: { gen: 1, sex: 'm', name: 'Tổ Thử Một', born: '1900', died: '1970' } };
// A living person the family shows by name only (self_visibility names or the family setting names): name, sex, generation.
const NAMED = { id: 'PN', deleted: false, v: 1, data: { gen: 2, sex: 'f', name: 'Trần Thị Bốn', hidden_living: true, parent: 'PA' } };
// A living person kept private: the placeholder (no name, no dates).
const LIVE = { id: 'PH1', deleted: false, v: 1, data: { gen: 2, sex: 'm', name: '', hidden_living: true, parent: 'PA' } };
const FULL_LIVE = { id: 'PH1', deleted: false, v: 1, data: { gen: 2, sex: 'm', name: 'Trần Văn Năm', born: '1955', parent: 'PA' } };
const FAM = (living) => ({ id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public', living_visibility: living });
const GUEST = { editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: true, roles: {} };
const OWNER = { ...GUEST, role: 'owner', status: 'active', email: 'o@test.local', name: 'Chủ họ', roles: { duong: 'owner' } };
const MEMBER = { ...GUEST, role: 'member', status: 'active', email: 'm@test.local', name: 'Thành viên', roles: { duong: 'member' } };
let srv, base;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }); };

test.before(async () => { if (skip) return; const w = await startWeb(); srv = w.srv; base = w.base; });
test.after(() => { srv?.close(); });

// calls: every API request the page makes (method, path, body), for asserting what was sent.
async function open({ width = 390, me, persons, hash, family = FAM('private'), self = null }) {
  const browser = await launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors = []; const calls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname;
    calls.push({ method: req.method(), path: p, body: req.postData() ? JSON.parse(req.postData()) : null });
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json(me);
    if (/^\/api\/persons\/[^/]+\/self-visibility$/.test(p)) {
      if (req.method() === 'PUT') return json({ value: req.postDataJSON().value, can_set: true });
      return json(self || { value: 'inherit', family_value: family.living_visibility, can_set: false });
    }
    if (p.startsWith('/api/families/')) return req.method() === 'PATCH' ? json({ ok: true, family: { ...family, ...req.postDataJSON() } }) : json(family);
    if (p === '/api/persons') return json({ items: persons, next_since: 3 });
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + '/' + hash, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  return { browser, ctx, page, errors, calls };
}

test('a guest sees the name of a name-only person and a placeholder for a private one', { skip }, async () => {
  const s = await open({ me: GUEST, persons: [PA, NAMED, LIVE], hash: '#/duong/list', family: FAM('names') });
  try {
    const text = await s.page.locator('main').innerText();
    assert.match(text, /Trần Thị Bốn/, 'name-only person shows the name');
    assert.doesNotMatch(text, /Trần Văn Năm|1955/, 'no dates of the living');
    assert.deepEqual(s.errors, []);
    await shot(s.page, 'guest-list-names-and-private.png');
  } finally { await s.browser.close(); }
});

test('the owner: choosing names opens the consent confirm; cancel keeps private; confirm saves the family choice', { skip }, async () => {
  const s = await open({ me: OWNER, persons: [PA, NAMED, LIVE], hash: '#/duong/cai-dat-dong-ho', family: FAM('private') });
  try {
    const radio = s.page.locator('input[name=lvfam][value=names]');
    await radio.waitFor({ state: 'attached' });
    await shot(s.page, 'family-setting.png');
    await radio.check({ force: true });
    const dlg = s.page.locator('dialog#lvcfm');
    await dlg.waitFor({ state: 'visible' });
    assert.match(await dlg.innerText(), /Hãy hỏi ý kiến người còn sống trước khi hiện tên\. Mỗi người vẫn có thể tự ẩn hồ sơ của mình\./);
    await shot(s.page, 'family-consent-confirm.png');
    assert.equal(s.calls.filter((c) => c.method === 'PATCH').length, 0, 'nothing saved before consent');
    await dlg.locator('button', { hasText: 'Huỷ' }).click();
    await dlg.waitFor({ state: 'hidden' });
    await s.page.waitForFunction(() => document.querySelector('input[name=lvfam][value=private]')?.checked === true, null, { timeout: 5000 });
    assert.equal(await s.page.locator('input[name=lvfam][value=names]').isChecked(), false, 'cancel keeps private');
    assert.equal(s.calls.filter((c) => c.method === 'PATCH').length, 0);
    await s.page.locator('input[name=lvfam][value=names]').check({ force: true });
    await dlg.waitFor({ state: 'visible' });
    await dlg.locator('button', { hasText: 'Hiện tên' }).click();
    await s.page.waitForTimeout(400);
    const patch = s.calls.find((c) => c.method === 'PATCH' && c.path === '/api/families/duong');
    assert.ok(patch, 'family patched');
    assert.equal(patch.body.living_visibility, 'names');
    assert.deepEqual(s.errors, []);
  } finally { await s.browser.close(); }
});

test('a linked member sees the own-profile setting (3 options) and saves it', { skip }, async () => {
  const self = { value: 'inherit', family_value: 'private', can_set: true };
  const s = await open({ me: MEMBER, persons: [PA, FULL_LIVE], hash: '#/duong/person/PH1', family: FAM('private'), self });
  try {
    const card = s.page.locator('#lvself');
    await card.waitFor({ state: 'attached' });
    assert.equal(await card.locator('input[name=lvself]').count(), 3, 'three options');
    const atEnd = await s.page.evaluate(() => { const c = document.querySelector('#lvself'); return !!(c && c.parentElement?.tagName === 'MAIN' && c.parentElement.lastElementChild === c && c.previousElementSibling?.classList.contains('cd')); });
    assert.ok(atEnd, 'the own-profile card is the last block of the Thông tin tab (after the relations)');
    await card.locator('input[name=lvself][value=names]').check({ force: true });
    await s.page.waitForTimeout(400);
    const put = s.calls.find((c) => c.method === 'PUT' && c.path === '/api/persons/PH1/self-visibility');
    assert.ok(put, 'PUT sent');
    assert.equal(put.body.value, 'names');
    await card.scrollIntoViewIfNeeded();
    await shot(s.page, 'own-profile-self-setting.png');
    assert.deepEqual(s.errors, []);
  } finally { await s.browser.close(); }
});

test('a member who may not change the setting sees no own-profile card', { skip }, async () => {
  const s = await open({ me: MEMBER, persons: [PA, FULL_LIVE], hash: '#/duong/person/PH1', family: FAM('private') });
  try {
    await s.page.waitForTimeout(300);
    assert.equal(await s.page.locator('#lvself').count(), 0);
  } finally { await s.browser.close(); }
});
