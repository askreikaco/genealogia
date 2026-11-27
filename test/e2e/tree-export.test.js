// Tree export (Tải về): PNG download, print/PDF view, and the guest privacy check. Mocked API, 390 px phone:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/tree-export.test.js
// GP_SHOT_DIR also gets the export menu (390 light), the print view as PDF and a PNG of the export (demo-like tree).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !chromium ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;
const WEB = path.join(__dirname, '..', '..', 'web');
const SHOT = process.env.GP_SHOT_DIR || '';
// The labels as the page ships them (web/js/export-vi.js, generated from vi.json).
const VI = Object.fromEntries([...fs.readFileSync(path.join(WEB, 'js', 'export-vi.js'), 'utf8').matchAll(/(\w+): "([^"]*)"/g)].map((m) => [m[1], m[2]]));

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PERSONS = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 2, born: '1950' }),
  // A living person: the server sends the label only (name null, hidden_living), never the name or the years.
  P('HL', { hidden_living: true, name: null, sex: 'f', gen: 8, thu: '1', parent: 'K1', order: 3, born: '1994' }),
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', han: '楊', visibility: 'public', has_emblem: false };

let base; let srv;
test.before(async () => {
  if (skip) return;
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const pn = u.pathname === '/' ? '/index.html' : u.pathname === '/book' ? '/book.html' : u.pathname; const f = path.join(WEB, pn);
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv?.close(); });

async function openPage(browser, role, hash, persons = PERSONS, init = '') {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role, status: role === 'guest' ? null : 'active', person_id: null, email: role === 'guest' ? null : 't@test.local', name: 'Tester', google: false, roles: role === 'guest' ? {} : { duong: role } });
    if (p.startsWith('/api/families/')) return json({ ...FAM, my_role: role === 'guest' ? null : role });
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: persons, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  if (init) await page.addInitScript(init);
  await page.goto(base + '/' + hash);
  await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}

// Replaces window.print with a recorder: it notes what the print view looks like at the moment the dialog would open.
const PRINT_RECORDER = `window.print = () => {
  const b = document.querySelector('.tree-print'); const cs = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'absent'; };
  window.__printed = { html: b ? b.outerHTML : '', text: b ? b.textContent : '', box: b ? { display: getComputedStyle(b).display, columns: getComputedStyle(b).columnCount, page: getComputedStyle(b).page } : null,
    nav: cs('#nav'), header: cs('.cbar'), main: cs('#main') };
};`;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

test('Tải về: PNG downloads as <family>-cay-gia-pha.png with PNG bytes, and the menu has PNG and PDF rows', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await openPage(b, 'member', '#/duong/export');
    assert.equal((await page.locator('#xpng').innerText()).trim(), VI.png, 'PNG row label from export-vi.js');
    assert.equal((await page.locator('#xpdf').innerText()).trim(), VI.pdf, 'PDF row label from export-vi.js');
    if (SHOT) await page.screenshot({ path: path.join(SHOT, 'export-menu-390-light.png'), fullPage: true });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#xpng').click()]);
    assert.equal(dl.suggestedFilename(), 'duong-cay-gia-pha.png');
    const file = await dl.path();
    const buf = fs.readFileSync(file);
    assert.ok(buf.length > 1000, 'non-empty PNG');
    assert.deepStrictEqual([...buf.subarray(0, 8)], PNG_MAGIC, 'PNG magic bytes');
    const { w, h } = pngSize(buf);
    assert.equal(w, 1800, '2x of the 900 px tree width');
    assert.equal(h, 2 * (PERSONS.length * 18 + 30), '2x of the tree height');
    if (SHOT) fs.copyFileSync(file, path.join(SHOT, 'sample-tree-export.png'));
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('Tải về: a tall tree is scaled down to 16000 px or less and the viewer is told', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const many = Array.from({ length: 600 }, (_, i) => P('B' + i, { name: 'Người ' + i, sex: 'm', gen: 1, thu: '1', order: i }));
    const { page, ctx } = await openPage(b, 'member', '#/duong/export', many);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#xpng').click()]);
    const buf = fs.readFileSync(await dl.path());
    const { w, h } = pngSize(buf);
    assert.ok(w <= 16000 && h <= 16000, `within the 16000 px cap, got ${w}x${h}`);
    assert.ok(w * h <= 16e6, 'within the 16 million pixel canvas limit');
    assert.ok(h < 2 * (600 * 18 + 30), 'scaled below 2x');
    assert.equal((await page.locator('.toast').textContent()).trim(), VI.too_big, 'the scaled-down notice');
    await ctx.close();
  } finally { await b.close(); }
});

test('print view: landscape A3, nav and header hidden, the tree in three columns (print media)', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await openPage(b, 'member', '#/duong/export', PERSONS, PRINT_RECORDER);
    // The button is hidden under print media, so the click runs from the DOM; the print block is then put back under print media.
    await page.evaluate(() => document.querySelector('#xpdf').click());
    const html = await page.evaluate(() => window.__printed.html);
    assert.ok(html.includes('Ông Tổ') && html.includes('Dương Văn Một'), 'the tree rows are in the print block');
    await page.evaluate((h) => document.body.insertAdjacentHTML('beforeend', h), html);
    await page.emulateMedia({ media: 'print' });
    const r = await page.evaluate(() => {
      // Nested elements keep their own computed display under a hidden ancestor, so "hidden" is no client rect.
      const gone = (sel) => { const e = document.querySelector(sel); return !e || e.getClientRects().length === 0; };
      const bx = document.querySelector('.tree-print'); const st = getComputedStyle(bx);
      return { nav: gone('#nav') ? 'none' : 'shown', header: gone('.cbar') ? 'none' : 'shown', main: gone('#main') ? 'none' : 'shown', box: st.display, columns: st.columnCount, page: st.page };
    });
    assert.equal(r.nav, 'none', 'side nav hidden in print');
    assert.equal(r.header, 'none', 'top bar hidden in print');
    assert.equal(r.main, 'none', 'app page hidden in print');
    assert.equal(r.box, 'block', 'print block shown');
    assert.equal(r.columns, '3', 'three columns');
    assert.equal(r.page, 'tree-a3', 'named A3 landscape page');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('PDF: the print view makes an A3 landscape PDF (page.pdf with the CSS page size)', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx } = await openPage(b, 'member', '#/duong/export', PERSONS, PRINT_RECORDER);
    await page.evaluate(() => document.querySelector('#xpdf').click());
    const html = await page.evaluate(() => window.__printed.html);
    await page.evaluate((h) => document.body.insertAdjacentHTML('beforeend', h), html);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    const box = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    assert.ok(box, 'MediaBox in the PDF');
    const w = Number(box[3]) - Number(box[1]), h = Number(box[4]) - Number(box[2]);
    assert.ok(Math.abs(w - 1190.55) < 1 && Math.abs(h - 841.89) < 1, `A3 landscape points, got ${w} x ${h}`);
    if (SHOT) {
      fs.writeFileSync(path.join(SHOT, 'print-preview.pdf'), pdf);
      try { execFileSync('pdftoppm', ['-png', '-r', '80', '-singlefile', path.join(SHOT, 'print-preview.pdf'), path.join(SHOT, 'print-preview')]); } catch {}
    }
    await ctx.close();
  } finally { await b.close(); }
});

test('guest export: a living person shows the label only, no name, rank or years in SVG or print', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const { page, ctx, errors } = await openPage(b, 'guest', '#/duong/export', PERSONS, PRINT_RECORDER);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#xsvg').click()]);
    const svg = fs.readFileSync(await dl.path(), 'utf8');
    assert.equal((svg.match(/<g transform=/g) || []).length, PERSONS.length, 'every row, the living one included');
    assert.ok(!svg.includes('1994'), 'no years of the living person in SVG');
    assert.ok(!svg.includes('null'), 'no null name in SVG');
    await page.evaluate(() => document.querySelector('#xpdf').click());
    const printed = await page.evaluate(() => window.__printed.text);
    assert.ok(!printed.includes('1994'), 'no years of the living person in print');
    assert.ok(!printed.includes('null'), 'no null name in print');
    assert.ok(printed.includes('Dương Văn Một'), 'public people are shown');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});
