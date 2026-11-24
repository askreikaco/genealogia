// E2E: a same-route re-render (a sync, or any store change) keeps the heavy embedded views mounted:
//   #book  the book iframe is the same element and the same document, and its scroll stays;
//   #map   the MapLibre instance is not rebuilt (zoom stays, one instance for the whole route);
//   #tree  the desktop tree chart keeps the scroll position of its canvas.
// The sync is triggered by the app's own `online` handler (store.sync). Mocked /api, no database. Needs playwright
// and Chrome (see test/e2e/README.md):
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] node --test test/e2e/keep-mounted.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { WEB, FAM, seedPersons, seedPlan, FONTS } = require('./_book-mock.js');
const http = require('http');
const path = require('path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !chromium ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;

// A stand-in for MapLibre (the CDN is blocked here): one instance per map view, zoom kept on the object, 'load' fires once.
const MAPLIBRE_STUB = `
window.__maps = [];
window.maplibregl = {
  Map: class {
    constructor(o) { this.zoom = o.zoom; this.src = {}; window.__maps.push(this); }
    addControl() {} resize() {} remove() { this.removed = true; } fitBounds() {} flyTo() {}
    getZoom() { return this.zoom; } setZoom(z) { this.zoom = z; }
    getSource(id) { return (this.src[id] = this.src[id] || { setData(d) { this.data = d; } }); }
    addSource(id, o) { this.src[id] = { setData(d) { this.data = d; }, o }; } addLayer() {}
    on(ev, a, b) { if (ev === 'load') setTimeout(a, 0); }
    getCanvas() { return { style: {} }; }
  },
  NavigationControl: class {}, Popup: class { setLngLat() { return this; } setHTML() { return this; } addTo() { return this; } remove() {} },
};`;

let base; let srv; let pulls = 0;
test.before(async () => {
  if (skip) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const pn = u.pathname === '/' ? '/index.html' : u.pathname === '/book' ? '/book.html' : u.pathname; const f = path.join(WEB, pn);
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv?.close(); });

// Shell API (family, me, sync pulls) and the book API (outline, persons by id), from the seed data.
async function route(page) {
  const persons = seedPersons();
  await page.route(FONTS, (r) => r.abort());
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url()); const p = u.pathname;
    const json = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/book/outline') return json({ family: FAM.id, role: 'guest', v: persons.length, plan: await seedPlan(u.searchParams.get('chi') || '') });
    if (p === '/api/persons' && u.searchParams.has('ids')) {
      const ids = new Set(u.searchParams.get('ids').split(','));
      return json({ items: persons.filter((x) => ids.has(x.id)), next_since: 1, role: 'guest', family: FAM.id });
    }
    if (p === '/api/persons') { pulls++; const since = Number(u.searchParams.get('since')); return json(since === 0 ? { items: persons, next_since: persons.length } : { items: [], next_since: since }); }
    if (p === '/api/me') return json({ editor: null, role: 'member', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: 'member' } });
    if (p === '/api/families') return json({ items: [{ ...FAM, my_role: 'member' }] });
    if (p.startsWith('/api/families/')) return json({ ...FAM, my_role: 'member' });
    if (p.startsWith('/api/suggestions')) return json({ items: [], counts: { pending: 0 } });
    if (p === '/api/me/prefs') return json({ prefs: {} });
    return json({});
  });
}

async function open(browser, hash, viewport) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(MAPLIBRE_STUB);
  await route(page);
  await page.goto(base + '/#' + hash);
  await page.waitForSelector('#main', { state: 'attached' });
  await page.waitForFunction(() => document.querySelector('#sync')?.textContent.includes('Đã đồng bộ'));
  return { ctx, page, errors };
}
// One sync through the app's own path (the `online` handler), then wait until it has finished and pulled.
async function syncOnce(page) {
  const before = pulls;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  for (let i = 0; i < 400 && pulls <= before; i++) await page.waitForTimeout(25);
  assert.ok(pulls > before, 'the sync pulled from the server');
  await page.waitForFunction(() => document.querySelector('#sync')?.textContent.includes('Đã đồng bộ'));
}
const launch = () => chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

test('book: the iframe is the same element and document after a sync re-render; scroll kept', { skip }, async (t) => {
  const browser = await launch(); t.after(() => browser.close());
  const { ctx, page, errors } = await open(browser, '/duong/book', { width: 1280, height: 900 });
  t.after(() => ctx.close());
  const fh = await page.waitForSelector('iframe.bookfr');
  const frame = await fh.contentFrame();
  await frame.waitForSelector('#pages section.pg');
  await frame.waitForFunction(() => document.scrollingElement.scrollHeight > innerHeight * 3);
  await frame.evaluate(() => { window.scrollTo(0, 1400); window.__probe = 'kept'; });
  const y0 = await frame.evaluate(() => window.scrollY);
  assert.ok(y0 > 1000, `book scrolled inside the iframe (${y0})`);
  await page.evaluate(() => { window.__bf = document.querySelector('iframe.bookfr'); });

  await syncOnce(page);

  assert.strictEqual(await page.evaluate(() => window.__bf === document.querySelector('iframe.bookfr')), true, 'same iframe element');
  assert.strictEqual(await frame.evaluate(() => window.__probe), 'kept', 'the book document was not reloaded');
  const y1 = await frame.evaluate(() => window.scrollY);
  assert.ok(Math.abs(y1 - y0) <= 2, `scroll kept (${y0} -> ${y1})`);
  assert.deepStrictEqual(errors, []);
});

test('map: one MapLibre instance across a sync re-render; zoom kept', { skip }, async (t) => {
  const browser = await launch(); t.after(() => browser.close());
  const { ctx, page, errors } = await open(browser, '/duong/map', { width: 1280, height: 900 });
  t.after(() => ctx.close());
  await page.waitForFunction(() => window.__maps.length === 1 && document.querySelector('#mapc'));
  await page.evaluate(() => { window.__maps[0].setZoom(11); window.__mapc = document.querySelector('#mapc'); });

  await syncOnce(page);

  assert.strictEqual(await page.evaluate(() => window.__maps.length), 1, 'no second map instance was created');
  assert.strictEqual(await page.evaluate(() => window.__maps[0].removed === true), false, 'the map was not removed');
  assert.strictEqual(await page.evaluate(() => window.__mapc === document.querySelector('#mapc')), true, 'same map container');
  assert.strictEqual(await page.evaluate(() => window.__maps[0].zoom), 11, 'zoom kept');
  assert.deepStrictEqual(errors, []);
});

test('tree: the desktop chart keeps its canvas scroll after a sync re-render', { skip }, async (t) => {
  const browser = await launch(); t.after(() => browser.close());
  const { ctx, page, errors } = await open(browser, '/duong/tree', { width: 1280, height: 900 });
  t.after(() => ctx.close());
  await page.waitForSelector('#cv');
  for (let i = 0; i < 3; i++) await page.click('#zin'); // zoom in with the app's own control so the canvas can scroll
  await page.waitForSelector('#cv');
  const scrollable = await page.evaluate(() => { const cv = document.querySelector('#cv'); return cv.scrollWidth > cv.clientWidth + 50 || cv.scrollHeight > cv.clientHeight + 50; });
  assert.ok(scrollable, 'the tree canvas can scroll in this data');
  await page.evaluate(() => { const cv = document.querySelector('#cv'); cv.scrollLeft = 150; cv.scrollTop = 90; });
  const read = () => page.evaluate(() => { const cv = document.querySelector('#cv'); const svg = cv.querySelector('svg'); return { pos: [cv.scrollLeft, cv.scrollTop], w: svg.getAttribute('width'), h: svg.getAttribute('height') }; });
  const before = await read();

  await syncOnce(page);

  const after = await read();
  assert.deepStrictEqual(after.pos, before.pos, 'canvas scroll kept');
  assert.deepStrictEqual([after.w, after.h], [before.w, before.h], 'zoom kept');
  assert.deepStrictEqual(errors, []);
});

// A background render (a sync, a store change) must not discard a sheet the user has open; it renders once it closes.
test('sheet: an open filter sheet survives a background sync; the page renders after it closes', { skip }, async (t) => {
  const browser = await launch(); t.after(() => browser.close());
  const { ctx, page, errors } = await open(browser, '/duong/list', { width: 390, height: 844 });
  t.after(() => ctx.close());
  await page.waitForSelector('[data-fp]');
  await page.click('[data-fp]');
  await page.waitForSelector('dialog.fpanel[open]');
  await page.evaluate(() => { window.__fb = document.querySelector('[data-fp]'); });

  await syncOnce(page);

  assert.strictEqual(await page.locator('dialog.fpanel[open]').count(), 1, 'the open sheet is still open after the sync');
  await page.click('dialog.fpanel [data-fpx]');
  await page.waitForFunction(() => document.querySelector('[data-fp]') !== window.__fb, null, { timeout: 5000 });
  assert.deepStrictEqual(errors, []);
});
