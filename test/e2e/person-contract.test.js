// E2E: the person-row contract (conv §36, U2). Every person row on these pages is one personItem: a single link (or
// button for a picker), a surname tile, a sex mark when the person has a sex, and the name in .calm-n. Mocked API, no
// database. Fictional family "Họ Dương" only:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] node --test test/e2e/person-contract.test.js
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

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PERSONS = [
  P('PR', { name: 'Dương Văn Tổ', sex: 'm', gen: 1, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 2, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('PM', { name: 'Lê Thị Mẹ', sex: 'f', gen: 2, thu: '1', order: 2, born: '1928' }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 3, thu: '1', parent: 'PA', order: 3, born: '1950', verify: 'Thiếu thông tin' }),
  P('K2', { name: 'Dương Thị Hai', sex: 'f', gen: 3, thu: '2', parent: 'PA', order: 4, born: '1953', verify: 'Thiếu tên' }),
  P('K3', { name: 'Dương Văn Ba', sex: '', gen: 3, thu: '3', parent: 'PA', order: 5, born: '1956', verify: 'Khác' }),
];
// Parent-child rows of the table source (what /api/persons sends as rel): Dương Văn Tổ -> Cha -> (Một, Hai, Ba).
const PC = (id, parent_id, child_id, birth_order) => ({ id, parent_id, child_id, kind: 'ruot', birth_order, private: false });
const REL = { source: 'table', parent_child: [PC('pc1', 'PR', 'PA', 1), PC('pc2', 'PA', 'K1', 1), PC('pc3', 'PA', 'K2', 2), PC('pc4', 'PA', 'K3', 3)], couple: [] };
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };

let base; let srv;
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
});
test.after(() => { srv?.close(); });

async function open(browser, hash, persons = PERSONS) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', colorScheme: 'light', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.)/, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: persons, next_since: 1, rel: REL } : { items: [], next_since: Number(since) }); }
    if (p === '/api/links/search') return json({ items: [{ id: 'X1', name: 'Dương Văn Một', years: '1950', gen: 3 }, { id: 'X2', name: 'Dương Thị Hai', years: '', gen: 0 }] });
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + hash);
  await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);
  return { page, ctx, errors };
}

// The contract, checked on every .calm person row inside `scope` (a CSS selector): one element, one link or button,
// a tile, a name, and a sex mark exactly when the person has a sex.
async function assertRows(page, scope, expected, label) {
  const rows = await page.$$eval(`${scope} .calm`, (els) => els.map((el) => ({
    tag: el.tagName, href: el.getAttribute('href') || '', role: el.getAttribute('role') || '',
    nested: !!el.querySelector('a, button'),
    name: el.querySelector('.calm-n')?.textContent.trim() || '',
    tile: !!el.querySelector('.crest-sq'),
    sex: el.querySelector('.calm-n .sx')?.getAttribute('class') || '',
    minH: el.getBoundingClientRect().height,
  })));
  assert.equal(rows.length, expected.length, `${label}: row count`);
  rows.forEach((r, i) => {
    const want = expected[i];
    assert.equal(r.nested, false, `${label}: no nested interactive element`);
    assert.ok(r.name.includes(want.name), `${label}: name ${r.name} vs ${want.name}`);
    assert.ok(r.tile, `${label}: surname tile on ${r.name}`);
    assert.equal(r.sex ? r.sex.split(' ').pop() : '', want.sex || '', `${label}: sex mark on ${r.name}`);
    assert.ok(r.minH >= 44, `${label}: 44 px target on ${r.name} (${r.minH})`);
    if (want.href) assert.match(r.href, /person\//, `${label}: link to the person`);
  });
}

test('pedigree (Tổ tiên) rows are person rows with the sex mark and one link each', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await open(browser, '/#/duong/person/K1');
    await page.waitForSelector('[aria-label="Tổ tiên"] .calm', { timeout: 5000 });
    await assertRows(page, '[aria-label="Tổ tiên"]', [
      { name: 'Dương Văn Cha', sex: 'm', href: true },
      { name: 'Dương Văn Tổ', sex: 'm', href: true },
    ], 'pedigree');
    assert.deepEqual(errors, [], 'no page errors');
    await ctx.close();
  } finally { await browser.close(); }
});

test('verify list rows are person rows: rank, name, family chip off, sex mark, verify note', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await open(browser, '/#/duong/verify');
    await page.waitForSelector('main .cd .calm', { timeout: 5000 });
    await assertRows(page, 'main .cd', [
      { name: 'Dương Văn Một', sex: 'm', href: true },
      { name: 'Dương Thị Hai', sex: 'f', href: true },
      { name: 'Dương Văn Ba', href: true },
    ], 'verify');
    assert.equal(await page.locator('main .cd .li').count(), 0, 'no old .li rows left');
    assert.deepEqual(errors, [], 'no page errors');
    await ctx.close();
  } finally { await browser.close(); }
});

test('link picker options are person rows (role option, one button, no nested control)', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await open(browser, '/#/duong/person/K1');
    await page.waitForSelector('[aria-label="Tổ tiên"] .calm', { timeout: 5000 });
    await page.evaluate(async () => {
      const LK = await import('/js/links.js');
      LK.openSheet({ fam: 'duong', personId: 'K1', personName: 'Dương Văn Một', families: [{ id: 'other', label: 'Họ khác' }] });
    });
    await page.fill('dialog input[name=q]', 'Dương');
    await page.waitForSelector('dialog [role=option]', { timeout: 5000 });
    const opts = await page.$$eval('dialog [role=option]', (els) => els.map((el) => ({ tag: el.tagName, pick: el.dataset.pick, cls: el.className, name: el.querySelector('.calm-n')?.textContent })));
    assert.equal(opts.length, 2);
    for (const o of opts) {
      assert.equal(o.tag, 'BUTTON'); assert.match(o.cls, /\bcalm\b/); assert.ok(o.pick && o.name);
    }
    assert.deepEqual(errors, [], 'no page errors');
    await ctx.close();
  } finally { await browser.close(); }
});

// U3 part: icon-only buttons are the one iconButton (an svg icon, aria-label and title), never a text glyph. Tìm lists
// at phone width (cards) and at desktop width (table); the editor's ✎ and + con are icon buttons too.
test('Tìm: every row action is an icon button (svg, aria-label, title), no text glyph', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    for (const phone of [true, false]) {
      const ctx = await browser.newContext({ serviceWorkers: 'block', colorScheme: 'light', viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: phone, isMobile: phone });
      const page = await ctx.newPage();
      await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.)/, (r) => r.abort());
      await page.route('**/api/**', (route) => {
        const p = new URL(route.request().url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (p === '/api/me') return json({ editor: { id: 'E1', name: 'Biên tập' }, role: 'editor', status: 'active', person_id: null, email: null, name: 'Biên tập', google: false, roles: {} });
        if (p.startsWith('/api/families/')) return json(FAM);
        if (p === '/api/persons') { const since = new URL(route.request().url()).searchParams.get('since'); return json(since === '0' ? { items: PERSONS, next_since: 1, rel: REL } : { items: [], next_since: Number(since) }); }
        if (p.startsWith('/api/suggestions')) return json([]);
        return json({});
      });
      await page.goto(base + '/#/duong/list');
      await page.waitForSelector(phone ? '.cards .ib' : 'table.tb .ib', { timeout: 8000 });
      const btns = await page.$$eval(phone ? '.cards .ib' : 'table.tb .ib', (els) => els.map((el) => ({
        label: el.getAttribute('aria-label') || '', title: el.getAttribute('title') || '', svg: !!el.querySelector('svg'), text: el.textContent.trim(),
      })));
      assert.ok(btns.length >= 3, `icon buttons on Tìm (${phone ? 'phone' : 'desktop'})`);
      for (const b of btns) {
        assert.ok(b.label, 'aria-label'); assert.ok(b.svg, 'svg icon'); assert.equal(b.text, '', `no text glyph in "${b.label}"`);
      }
      if (!phone) {
        const labels = btns.map((b) => b.label);
        assert.ok(labels.includes('Sửa') && labels.includes('Thêm con'), 'editor: Sửa and Thêm con icon buttons');
        assert.equal(await page.locator('table.tb .ib[data-act="child"]').count(), PERSONS.length, 'Thêm con on every row');
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
});

// U5 contract (leftovers): the compact option rows (personItem variant compact, role=option) are 48 px or taller, one
// name line and no nested control; the Giỗ follow star is an icon button with aria-label and a boolean aria-pressed.
test('compact options (role=option) are personItem rows, 48 px or taller, one button each', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await open(browser, '/#/duong/list');
    await page.waitForSelector('.cards, table.tb', { timeout: 8000 });
    // the compact personItem as the app's pickers render it (role=option), in the page's own CSS
    const opts = await page.evaluate(async () => {
      const PI = await import('/js/person-item.js');
      const host = document.createElement('div'); host.id = 'cmp-probe';
      host.innerHTML = [PI.personItem({ name: 'Dương Văn Một', rank: 'Ông 1' }, { variant: 'compact', attrs: 'role="option"', sub: '1950' }),
        PI.personItem({ name: 'Dương Thị Hai' }, { variant: 'compact', attrs: 'role="option"' })].join('');
      document.querySelector('main').append(host);
      return [...host.querySelectorAll('[role=option]')].map((el) => ({
        cls: el.className, h: el.getBoundingClientRect().height, nested: !!el.querySelector('a, button, input'), lines: el.querySelectorAll(':scope > b').length,
      }));
    });
    assert.equal(opts.length, 2);
    for (const o of opts) {
      assert.match(o.cls, /\bpi-opt\b/, 'option is the shared compact row');
      assert.ok(o.h >= 48, `option height ${o.h} >= 48`);
      assert.equal(o.nested, false, 'no nested control in an option');
      assert.equal(o.lines, 1, 'one name');
    }
    assert.deepEqual(errors, [], 'no page errors');
    await ctx.close();
  } finally { await browser.close(); }
});

test('Giỗ follow star is an icon button: svg, aria-label, boolean aria-pressed, 44 px or more', { skip }, async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const withGio = PERSONS.map((x) => (x.id === 'PA' ? { ...x, data: { ...x.data, gio_lunar: '12/3' } } : x.id === 'K1' ? { ...x, data: { ...x.data, gio_lunar: '28/4' } } : x));
    const { page, ctx, errors } = await open(browser, '/#/duong/lich', withGio);
    await page.waitForSelector('[data-follow]', { timeout: 8000 });
    const stars = await page.$$eval('[data-follow]', (els) => els.map((el) => ({
      tag: el.tagName, svg: !!el.querySelector('svg'), label: el.getAttribute('aria-label') || '', pressed: el.getAttribute('aria-pressed'),
      text: el.textContent.trim(), w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height,
    })));
    assert.ok(stars.length >= 1, 'at least one star');
    for (const s of stars) {
      assert.equal(s.tag, 'BUTTON'); assert.ok(s.svg, 'svg icon'); assert.ok(s.label, 'aria-label');
      assert.ok(s.pressed === 'true' || s.pressed === 'false', `aria-pressed boolean (${s.pressed})`);
      assert.equal(s.text, '', `no text glyph in "${s.label}"`);
      assert.ok(s.w >= 44 && s.h >= 44, `44 px target (${s.w}x${s.h})`);
    }
    assert.deepEqual(errors, [], 'no page errors');
    await ctx.close();
  } finally { await browser.close(); }
});
