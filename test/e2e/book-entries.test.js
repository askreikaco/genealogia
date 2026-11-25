// E2E: entry pages of the book. A child reference is a grey box that opens its entry; a person's story shows in the story
// panel; no flow page runs into its footer, also with long stories; the printed PDF keeps child references and the contents
// as internal links to the right pages (pdf-lib reads the link annotations).
//   NODE_PATH=<dir with playwright> node --test test/e2e/book-entries.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { FONTS, seedPersons, staticServer, mockApi } = require('./_book-mock');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !chromium ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;
let PDFLIB = null;
try { PDFLIB = require(require.resolve('pdf-lib', { paths: [path.join(__dirname, '..', '..', 'server')] })); } catch {}
const LONG = ('Đoạn văn dài để thử nghiệm bố cục trang sách gia phả. ').repeat(40);

let base; let srv; let browser;
// The print button fills every page, then calls window.print(). A real print in headless Chrome runs on and makes a
// later page.pdf() fail ("Page is already being printed"): count the calls instead, and wait for one in fillAll.
const STUB_PRINT = () => { window.__printed = 0; window.print = () => { window.__printed++; }; };
test.before(async () => {
  if (skip) return;
  srv = staticServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
});
test.after(async () => { await browser?.close(); srv?.close(); });

const STORY = { P001: { st: [{ kind: 'chuyen', title: 'Chuyện lập đất', body: 'Đoạn một của câu chuyện.\n\nĐoạn hai của câu chuyện.' }], ev: [] } };

async function open(width, height, texts = {}, hash = '') {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(STUB_PRINT);
  const page = await ctx.newPage();
  await page.route(FONTS, (r) => r.abort());
  await mockApi(page, [], { texts });
  await page.goto(`${base}/book?family=duong&inapp=1${hash}`, { waitUntil: 'load' });
  await page.waitForSelector('.pg', { timeout: 20000 });
  return { ctx, page };
}
// Every page filled, as the print button does it: done when the (stubbed) print was called.
async function fillAll(page) {
  const before = await page.evaluate(() => window.__printed || 0);
  await page.click('#bshare'); await page.click('#bprint');
  await page.waitForFunction((n) => (window.__printed || 0) > n && document.getElementById('prog')?.hidden !== false, before, { timeout: 60000 });
}

test('a child reference is a grey box and opens its entry on screen', { skip }, async () => {
  const { ctx, page } = await open(1280, 800);
  try {
    await fillAll(page);
    const xr = page.locator('a.xr').first();
    await xr.scrollIntoViewIfNeeded();
    const href = await xr.getAttribute('href');
    assert.match(href, /^#p-P\d+$/);
    const bg = await xr.evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    assert.ok(r === g && g === b && r < 160, 'a grey ID box, not red: ' + bg);
    await xr.click();
    const target = page.locator(`[id="${href.slice(1)}"]`);
    await target.waitFor({ timeout: 15000 });
    const box = await target.boundingBox();
    assert.ok(box && box.y > -1 && box.y < 800, 'the entry is on screen after the click');
  } finally { await ctx.close(); }
});

test('a person with a story shows it as prose in the entry, with no label or box', { skip }, async () => {
  const { ctx, page } = await open(1280, 800, STORY, '#p-P001');
  try {
    const entry = page.locator('[id="p-P001"]');
    await entry.waitFor({ timeout: 15000 });
    assert.equal(await entry.locator('.panel').count(), 0, 'no tinted story box');
    const text = await entry.innerText();
    assert.match(text, /Đoạn một của câu chuyện/);
    assert.match(text, /Đoạn hai của câu chuyện/);
    assert.ok(!/CÂU CHUYỆN|Câu chuyện/.test(text), 'no label before the stories');
  } finally { await ctx.close(); }
});

test('no flow page runs into its footer, also with long stories', { skip }, async () => {
  const texts = {};
  for (const p of seedPersons().slice(0, 40)) texts[p.id] = { st: [{ kind: 'chuyen', title: '', body: LONG + '\n\n' + LONG }], ev: [] };
  const { ctx, page } = await open(1280, 800, texts);
  try {
    await fillAll(page);
    const bad = await page.evaluate(() => {
      const out = [];
      for (const pg of document.querySelectorAll('.pg')) {
        const foot = pg.querySelector(':scope > .foot'); const cols = pg.querySelector(':scope > .cols');
        if (!foot || !cols) continue;
        const fb = foot.getBoundingClientRect().top;
        for (const col of cols.querySelectorAll(':scope > .col')) for (const el of col.children) if (el.getBoundingClientRect().bottom > fb + 1) out.push(pg.id + ':' + Math.round(el.getBoundingClientRect().bottom - fb));
      }
      return [...new Set(out)].slice(0, 12);
    });
    assert.deepEqual(bad, [], 'pages whose entries run into the footer: ' + JSON.stringify(bad));
  } finally { await ctx.close(); }
});

test('printed PDF: child references and the contents are internal links to the right pages', { skip: skip || (!PDFLIB ? 'pdf-lib not installed (server devDependency)' : false) }, async () => {
  const { ctx, page } = await open(1280, 800);
  try {
    await fillAll(page);
    // expected destinations from the page: a child reference or a contents line points at the section (page) of its target
    const want = await page.evaluate(() => {
      const sectionOf = (id) => { const el = document.querySelector(`[id="${id}"]`); return el ? +el.closest('.pg').dataset.n : 0; };
      const refs = [...document.querySelectorAll('a.xr[href^="#p-"]')].map((a) => sectionOf(a.getAttribute('href').slice(1)));
      const toc = [...document.querySelectorAll('.toc a[href^="#p"]')].map((a) => +a.getAttribute('href').slice(2));
      return { refs: [...new Set(refs)].filter(Boolean), toc: [...new Set(toc)] };
    });
    assert.ok(want.refs.length > 3 && want.toc.length > 3, JSON.stringify({ refs: want.refs.length, toc: want.toc.length }));
    const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
    const doc = await PDFLIB.PDFDocument.load(pdf, { ignoreEncryption: true });
    const pages = doc.getPages();
    // Chrome writes internal links as named destinations: /Dest /p12 -> the name tree (or the legacy /Dests dictionary)
    const named = new Map();
    const dictOf = (o) => (o && o.constructor && o.constructor.name === 'PDFDict' ? o : null);
    const walk = (node) => {
      const d = doc.context.lookup(node); if (!d) return;
      const names = d.get ? d.get(PDFLIB.PDFName.of('Names')) : null;
      if (names) {
        const arr = doc.context.lookup(names);
        for (let i = 0; i + 1 < arr.size(); i += 2) {
          const key = arr.get(i); const k = key.decodeText ? key.decodeText() : String(key);
          let v = doc.context.lookup(arr.get(i + 1));
          if (dictOf(v)) v = doc.context.lookup(v.get(PDFLIB.PDFName.of('D')));
          named.set(k, v);
        }
      }
      const kids = d.get ? d.get(PDFLIB.PDFName.of('Kids')) : null;
      if (kids) { const ka = doc.context.lookup(kids); for (let i = 0; i < ka.size(); i++) walk(ka.get(i)); }
    };
    const cat = doc.catalog;
    const namesRoot = cat.get(PDFLIB.PDFName.of('Names'));
    if (namesRoot) { const nr = doc.context.lookup(namesRoot); const dt = nr.get(PDFLIB.PDFName.of('Dests')); if (dt) walk(dt); }
    const legacy = cat.get(PDFLIB.PDFName.of('Dests')); if (legacy) { const ld = doc.context.lookup(legacy); for (const [k, v] of ld.entries()) named.set(String(k).replace(/^\//, ''), doc.context.lookup(v)); }
    const dests = new Set();
    for (const pg of pages) {
      const annots = pg.node.Annots(); if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        const a = doc.context.lookup(annots.get(i));
        if (!a.get || String(a.get(PDFLIB.PDFName.of('Subtype'))) !== '/Link') continue;
        let dest = a.get(PDFLIB.PDFName.of('Dest'));
        if (!dest) { const act = a.get(PDFLIB.PDFName.of('A')); if (act) dest = doc.context.lookup(act).get(PDFLIB.PDFName.of('D')); }
        if (!dest) continue;
        const target = dest.constructor && dest.constructor.name === 'PDFArray' ? doc.context.lookup(dest) : named.get(String(dest).replace(/^\//, ''));
        if (!target || !target.get) continue;
        const idx = pages.findIndex((p) => p.ref === target.get(0));
        if (idx >= 0) dests.add(idx + 1);
      }
    }
    const missingRefs = want.refs.filter((n) => !dests.has(n));
    const missingToc = want.toc.filter((n) => !dests.has(n));
    assert.deepEqual(missingRefs, [], 'child references with no internal link to their page');
    assert.deepEqual(missingToc, [], 'contents lines with no internal link to their page');
  } finally { await ctx.close(); }
});

test('a unique full name in a story gets a grey ID box after it, linked to that entry', { skip }, async () => {
  // a seed person whose full name is unique in the family (and registered: has an entry in the book)
  const all = seedPersons(); const count = new Map();
  for (const p of all) count.set(p.data.name, (count.get(p.data.name) || 0) + 1);
  const target = all.find((p) => p.data.name && p.data.name.split(' ').length >= 2 && count.get(p.data.name) === 1 && p.id !== 'P001' && (p.data.gen || 0) >= 2);
  assert.ok(target, 'a unique full name exists in the seed');
  const body = `Ông từng gặp ${target.data.name} ở chợ.`;
  const { ctx, page } = await open(1280, 800, { P001: { st: [{ kind: 'chuyen', title: '', body }], ev: [] } }, '#p-P001');
  try {
    const entry = page.locator('[id="p-P001"]');
    await entry.waitFor({ timeout: 15000 });
    const box = entry.locator(`.stp a.xr[href="#p-${target.id}"]`);
    assert.equal(await box.count(), 1, 'one linked ID box for the mentioned person');
    assert.match(await entry.locator('.stp').first().innerText(), new RegExp(target.data.name + '\\s*\\d'), 'the box comes right after the name');
  } finally { await ctx.close(); }
});

// Phone (iPhone 14 emulation): the book pages are scaled to the screen width, and nothing in them runs past the page edge,
// also with a long unbroken word (a URL or a long note).
test('phone: every page fits the screen width; a long unbroken word does not push a column past the page edge', { skip }, async () => {
  const dev = chromium.devices ? chromium.devices['iPhone 14'] : null;
  const ctx = await browser.newContext({ ...(dev || {}), serviceWorkers: 'block' });
  await ctx.addInitScript(STUB_PRINT);
  const page = await ctx.newPage();
  await page.route(FONTS, (r) => r.abort());
  const texts = { P001: { data: { note: 'https://example.test/' + 'a'.repeat(160) } } };
  await mockApi(page, [], { texts });
  try {
    await page.goto(`${base}/book?family=duong&inapp=1`, { waitUntil: 'load' });
    await page.waitForSelector('.pg', { timeout: 20000 });
    await page.waitForTimeout(500);
    await fillAll(page);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const bad = [];
      for (const pw of document.querySelectorAll('.pgw')) if (pw.getBoundingClientRect().right > vw + 1) bad.push('box ' + Math.round(pw.getBoundingClientRect().right));
      for (const pg of document.querySelectorAll('.pg')) {
        const pr = pg.getBoundingClientRect().right;
        for (const cols of pg.querySelectorAll(':scope > .cols')) {
          if (cols.getBoundingClientRect().right > pr + 1) bad.push(pg.id + ' cols');
          for (const col of cols.querySelectorAll(':scope > .col')) {
            const cr = col.getBoundingClientRect().right;
            // text that runs past its own box (a long unbroken word) shows as scroll width beyond the client width
            for (const el of col.querySelectorAll('.entry, .entry *')) {
              if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow === 'visible') { bad.push(pg.id + ' ' + el.className); break; }
              if (el.getBoundingClientRect().right > cr + 2) { bad.push(pg.id + ' ' + el.className + ' past column'); break; }
            }
          }
        }
      }
      return { vw, docW: document.documentElement.scrollWidth, bad: bad.slice(0, 8) };
    });
    assert.ok(r.docW <= r.vw + 1, `no horizontal page scroll (${r.docW} > ${r.vw})`);
    assert.deepEqual(r.bad, [], 'nothing past the page edge');
  } finally { await ctx.close(); }
});

// Toolbar: the book's bar is the list toolbar (same markup from ui.js lbar(), same shared listui.css controls, same gutter,
// gap, 48 px heights and widths, count line class). Compared on the same viewport, light and dark, phone and desktop.
test('toolbar: the book bar has the list toolbar metrics (phone and desktop, light and dark)', { skip }, async () => {
  for (const [w, scheme] of [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: w, height: 800 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.route(FONTS, (r) => r.abort());
    await mockApi(page, [], {});
    await page.goto(`${base}/book?family=duong&inapp=1`, { waitUntil: 'load' });
    await page.waitForSelector('#tbar .lbar', { timeout: 20000 });
    try {
      // the list's own markup and CSS (ui.js toolbar() inside the shared sticky wrapper .stk, listui.css): the reference
      const ref = await page.evaluate(() => {
        const host = document.createElement('div'); host.className = 'stk'; host.style.cssText = 'position:fixed;left:0;top:0;width:' + (document.documentElement.clientWidth) + 'px';
        host.innerHTML = '<div class="lbar"><div class="srch"><input type="search" aria-label="x"></div><button type="button" class="fbtn" aria-label="x"><svg class="cic" width="20" height="20"></svg></button></div><p class="sub lcount">1 người</p>';
        document.body.append(host);
        const bar = host.querySelector('.lbar'); const srch = host.querySelector('.srch'); const fb = host.querySelector('.fbtn'); const cnt = host.querySelector('.lcount');
        const out = { gap: Math.round(fb.getBoundingClientRect().left - srch.getBoundingClientRect().right), searchH: Math.round(srch.getBoundingClientRect().height), btnW: Math.round(fb.getBoundingClientRect().width), btnH: Math.round(fb.getBoundingClientRect().height), countFs: getComputedStyle(cnt).fontSize, countColor: getComputedStyle(cnt).color, countMargin: getComputedStyle(cnt).marginTop, barGap: getComputedStyle(bar).columnGap };
        host.remove(); return out;
      });
      const got = await page.evaluate(() => {
        const bar = document.querySelector('#tbar .lbar'); const srch = bar.querySelector('.srch'); const fb = bar.querySelector('.fbtn');
        const wrap = document.getElementById('tbar');
        const cnt = document.querySelector('#tbar .lcount');
        return { gap: Math.round(fb.getBoundingClientRect().left - srch.getBoundingClientRect().right), searchH: Math.round(srch.getBoundingClientRect().height), btnW: Math.round(fb.getBoundingClientRect().width), btnH: Math.round(fb.getBoundingClientRect().height), countFs: cnt ? getComputedStyle(cnt).fontSize : null, countColor: cnt ? getComputedStyle(cnt).color : null, countMargin: cnt ? getComputedStyle(cnt).marginTop : null, barGap: getComputedStyle(bar).columnGap,
          padLeft: getComputedStyle(wrap).paddingLeft, wrapW: Math.round(wrap.getBoundingClientRect().width), barX: Math.round(bar.getBoundingClientRect().left), wrapX: Math.round(wrap.getBoundingClientRect().left), bg: getComputedStyle(wrap).backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor };
      });
      const tag = `${w} ${scheme}`;
      for (const k of ['gap', 'searchH', 'btnW', 'btnH', 'countFs', 'countColor', 'countMargin', 'barGap']) assert.equal(got[k], ref[k], `${tag}: ${k} (book ${got[k]} vs list ${ref[k]})`);
      assert.equal(got.padLeft, '16px', `${tag}: gutter is the list gutter (16 px)`);
      assert.equal(got.barX - got.wrapX, 16, `${tag}: the bar starts at the gutter`);
      assert.ok(got.wrapW <= 1024 + 1, `${tag}: the column is the list column (max 1024 px)`);
      assert.equal(got.bg, got.bodyBg, `${tag}: the toolbar sits on the page background (no band)`);
    } finally { await ctx.close(); }
  }
});

// Spouse records: an accent-less search finds the spouse, the result opens the partner's entry with the spouse line
// highlighted; the index lists the spouse under the partner's number (a link to that entry).
test('a spouse is found by an accent-less name, opens the partner entry, and is in the index', { skip }, async () => {
  const SPOUSE = { id: 'N-hong-my', data: { name: 'Phan Thị Hồng Nhung', sex: 'f', spouse_of: 'P001', born: '1950', place: 'Hóc Môn' } };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(STUB_PRINT);
  const page = await ctx.newPage();
  await page.route(FONTS, (r) => r.abort());
  await mockApi(page, [], { persons: [SPOUSE] });
  try {
    await page.goto(`${base}/book?family=duong&inapp=1`, { waitUntil: 'load' });
    await page.waitForSelector('#bq', { timeout: 20000 });
    await page.fill('#bq', 'hong nhung');
    const hit = page.locator('.bhit', { hasText: 'Phan Thị Hồng Nhung' });
    await hit.waitFor({ timeout: 15000 });
    await hit.click();
    const line = page.locator('[id="p-P001"] .ln.sp[data-sp="N-hong-my"]');
    await line.waitFor({ timeout: 15000 });
    assert.match(await line.innerText(), /Phan Thị Hồng Nhung.*1950/, 'the spouse line shows the name and the year');
    const box = await page.locator('[id="p-P001"]').boundingBox();
    assert.ok(box && box.y > -1 && box.y < 800, 'the partner entry is on screen');
    await fillAll(page);
    const row = page.locator('.ie', { hasText: 'Phan Thị Hồng Nhung' });
    assert.equal(await row.count(), 1, 'one index row for the spouse');
    assert.equal(await row.locator('a').getAttribute('href'), '#p-P001', 'its number links to the partner\'s entry');
  } finally { await ctx.close(); }
});
