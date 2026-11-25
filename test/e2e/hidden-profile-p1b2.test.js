// E2E (P1b-2): a guest opening the profile of a living person sees the shared label (booktext living2) and no data,
// and the label is still there after the network is idle. Mocked API, no database.
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] node --test test/e2e/hidden-profile-p1b2.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { skip, launch, startWeb } = require('./_e2e-harness');

const HID = 'PH1';
const PERSONS = [
  { id: HID, deleted: false, v: 1, data: { gen: 2, sex: 'f', name: '', hidden_living: true, parent: 'PA' } },
  { id: 'PH2', deleted: false, v: 1, data: { name: '', hidden_living: true } },
  { id: 'PA', deleted: false, v: 1, data: { gen: 1, sex: 'm', name: 'Tổ Thử Một', born: '1900', died: '1970' } },
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };
let srv, base, label;

test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; base = w.base;
  const { tx } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'booktext.js')).href);
  label = tx('living2', 'vi');
});
test.after(() => { srv?.close(); });

test('a guest opening a hidden living profile sees the label and no data, still after network idle', { skip }, async () => {
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
    await page.route('**/api/**', (route, req) => {
      const p = new URL(req.url()).pathname;
      const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (p === '/api/me') return json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
      if (p.startsWith('/api/families/')) return json(FAM);
      if (p === '/api/persons') {
        const since = new URL(req.url()).searchParams.get('since');
        return json(since === '0' ? { items: PERSONS, next_since: 2 } : { items: PERSONS.filter((x) => x.id === HID), next_since: 2 });
      }
      if (p.startsWith('/api/suggestions')) return json([]);
      return json({});
    });
    await page.goto(base + '/#/duong/person/' + HID, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const read = async () => page.evaluate(() => {
      const main = document.querySelector('#main');
      return { h1: main?.querySelector('h1')?.textContent.trim() || '', text: (main?.innerText || '').trim() };
    });
    let got = await read();
    assert.equal(got.h1, label, 'the label is the heading');
    assert.equal(got.text, label, 'no other data on the page');
    await page.waitForTimeout(1500);
    got = await read();
    assert.equal(got.h1, label, 'still there after the network is idle');
    assert.equal(got.text, label, 'still no data after the network is idle');
    assert.deepEqual(errors, [], 'no page errors');
    await ctx.close();
  } finally { await browser.close(); }
});

test('guest list: every hidden row shows the label as its name, and no row shows a question mark for a generation', { skip }, async () => {
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
    await page.route('**/api/**', (route, req) => {
      const p = new URL(req.url()).pathname;
      const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (p === '/api/me') return json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
      if (p.startsWith('/api/families/')) return json(FAM);
      if (p === '/api/persons') return json({ items: PERSONS, next_since: 2 });
      if (p.startsWith('/api/suggestions')) return json([]);
      return json({});
    });
    const readRows = () => page.evaluate(() => [...document.querySelectorAll('#main a[href*="person/"]')].map((a) => (a.querySelector('b')?.innerText || '').trim()));
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(base + '/#/duong/list', { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const rows = await readRows();
      const hidden = rows.filter((t) => t === label);
      assert.equal(hidden.length, 2, width + 'px: the two hidden rows show the label as the whole name: ' + JSON.stringify(rows));
      assert.ok(rows.every((t) => t === label || !t.includes(label)), width + 'px: no honorific on a hidden row: ' + JSON.stringify(rows));
      for (const t of rows) assert.ok(t.length > 0, 'no row with an empty name');
      for (const t of rows) assert.ok(!/\?\s*$/.test(t), 'no question mark for a generation: ' + t);
    }
    assert.deepEqual(errors, [], 'no page errors');
    await ctx.close();
  } finally { await browser.close(); }
});
