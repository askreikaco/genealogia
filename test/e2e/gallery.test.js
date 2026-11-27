// E2E: the gallery per person (G1) on the profile. The Ảnh section shows thumbnails; a tap opens the viewer (large photo,
// prev/next); an editor sets another photo as the profile and the header photo changes; a guest does not see a living
// person's gallery; an editor's remove asks for confirmation and offers Hoàn tác. Mocked API, no database:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/gallery.test.js
// GP_SHOT_DIR: screenshots at 390 px, light: gallery-section.png (4 photos), gallery-viewer.png, gallery-editor.png.
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
const SHOT = process.env.GP_SHOT_DIR || '';

// Generated sample photos (SVG tiles with a number): the bytes the mock serves for /api/photos/<id>.
const tile = (n, hue) => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="hsl(${hue} 45% 60%)"/><text x="320" y="270" font-size="160" text-anchor="middle" font-family="sans-serif" fill="#fff">${n}</text></svg>`;
const ID = (n) => `${String(n).padStart(2, '0')}${'a'.repeat(22)}`; // 24 hex chars
const PH = [1, 2, 3, 4].map((n) => ({ id: ID(n), url: `/api/photos/${ID(n)}`, caption: ['Ảnh cưới', 'Ngày giỗ', 'Thăm quê', 'Chụp ở Huế'][n - 1], year: [1985, 1990, null, 1999][n - 1], is_profile: n === 1 }));
const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PERSONS = [
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', born: '1950', photo: PH[0].url }),
  P('LV', { name: 'Dương Thị Sống', sex: 'f', gen: 8, thu: '2', born: '1990' }), // living: members only
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };
const PHOTOS = { K1: PH.map((x) => ({ ...x })) };

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

// One page on the K1 (or LV) profile. role: 'editor' | 'guest'. calls: the API requests the page made (method path).
async function open(browser, { role, hash = 'person/K1', width = 390, wait = '.prof h1, h1.big' }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 844 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const log = { errors: [], calls: [] };
  page.on('pageerror', (e) => log.errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname; const m = req.method();
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    log.calls.push(`${m} ${p}`);
    if (p.startsWith('/api/photos/')) {
      const n = Number(p.slice(-24, -22)) || 1;
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: tile(n, n * 70) });
    }
    if (p === '/api/me') {
      return role === 'editor'
        ? json({ editor: 'Tester', role: 'editor', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: 'editor' } })
        : json({ editor: null, role: 'guest', status: null, person_id: null, email: null, name: null, google: false, roles: {} });
    }
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') {
      const since = u.searchParams.get('since');
      const ps = PERSONS; // a guest gets the living person's row too (the server strips contacts, not the row)
      return json(since === '0' || since === null ? { items: ps, next_since: 1, rel: { source: 'table', parent_child: [], couple: [] } } : { items: [], next_since: Number(since), rel: { source: 'table', parent_child: [], couple: [] } });
    }
    if (p === '/api/persons/candidates') return json({ items: [] });
    if (p === '/api/ops') { const b = req.postDataJSON(); return json({ applied: b.ops.map((o) => o.op_id), rejected: [] }); }
    if (p === '/api/events') return json({ items: [], stories: [] });
    if (p.startsWith('/api/suggestions')) return json([]);
    const g = /^\/api\/persons\/([^/]+)\/photos(?:\/([^/]+))?(?:\/([a-z]+))?$/.exec(p);
    if (g) {
      const [, pid, photoId, act] = g;
      if (pid === 'LV') return json({ error: 'Không tìm thấy người này.' }, 404);
      const list = PHOTOS[pid] || (PHOTOS[pid] = []);
      if (m === 'GET') return json({ max: 20, items: list.map(({ id, url, caption, year, is_profile }) => ({ id, url, caption, year, is_profile })) });
      if (role !== 'editor') return json({ error: 'Cần đăng nhập để sửa.' }, 401);
      const x = list.find((y) => y.id === photoId);
      if (m === 'POST' && !photoId) { const n = { id: ID(9), url: `/api/photos/${ID(9)}`, caption: '', year: null, is_profile: list.length === 0 }; list.push(n); return json({ ok: true, photo: n }); }
      if (m === 'PUT' && x) { const b = req.postDataJSON(); x.caption = b.caption; x.year = b.year === '' ? null : Number(b.year); return json({ ok: true, photo: x }); }
      if (m === 'POST' && act === 'profile' && x) {
        list.forEach((y) => { y.is_profile = y.id === x.id; });
        PERSONS.find((y) => y.id === pid).data.photo = x.url;
        return json({ ok: true, profile: x.url });
      }
      if (m === 'POST' && act === 'delete' && x) {
        const i = list.indexOf(x); list.splice(i, 1); let profile;
        if (x.is_profile && list.length) { list[0].is_profile = true; profile = list[0].url; PERSONS.find((y) => y.id === pid).data.photo = profile; }
        if (x.is_profile && !list.length) { profile = null; delete PERSONS.find((y) => y.id === pid).data.photo; }
        return json({ ok: true, deleted: { id: x.id }, trash_id: 7, ...(x.is_profile ? { profile } : {}) });
      }
    }
    if (p === '/api/trash/7/restore') return json({ ok: true });
    return json({});
  });
  await page.goto(base + '/#/duong/' + hash);
  if (wait) await page.waitForSelector(wait, { timeout: 10000 });
  return { page, ctx, log };
}

test('guest: the Ảnh section shows the four photos; a tap opens the viewer; prev and next move through them', { skip }, async () => {
  for (const k of Object.keys(PHOTOS)) PHOTOS[k] = PH.map((x) => ({ ...x, is_profile: x.id === PH[0].id }));
  PERSONS[0].data.photo = PH[0].url;
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, log } = await open(b, { role: 'guest' });
    await page.waitForSelector('.gal .gal-th', { timeout: 10000 });
    assert.equal(await page.locator('.gal .gal-th').count(), 4, 'four thumbnails');
    assert.equal(await page.locator('.gal h3').first().textContent(), 'Ảnh');
    assert.equal(await page.locator('[data-gal-file]').count(), 0, 'a guest has no add control');
    await page.click('.gal .gal-th[data-gal-open="0"]');
    await page.waitForSelector('dialog.galdlg[open] .gal-big');
    assert.equal(await page.locator('dialog.galdlg .gal-big').getAttribute('src'), PH[0].url);
    assert.match(await page.locator('dialog.galdlg figcaption').textContent(), /Ảnh cưới · 1985/);
    await page.click('dialog.galdlg [data-gal-next]');
    assert.equal(await page.locator('dialog.galdlg .gal-big').getAttribute('src'), PH[1].url, 'next shows the second photo');
    assert.match(await page.locator('dialog.galdlg .gal-nav .sub').textContent(), /2 \/ 4/);
    await page.click('dialog.galdlg [data-gal-prev]');
    assert.equal(await page.locator('dialog.galdlg [data-gal-prev]').isDisabled(), true, 'prev stops at the first photo');
    assert.equal(log.errors.length, 0, 'no page errors: ' + log.errors.join('; '));
    await ctx.close();
  } finally { await b.close(); }
});

test('editor: sets the second photo as the profile; the header photo changes, the viewer closes', { skip }, async () => {
  for (const k of Object.keys(PHOTOS)) PHOTOS[k] = PH.map((x) => ({ ...x, is_profile: x.id === PH[0].id }));
  PERSONS[0].data.photo = PH[0].url;
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, log } = await open(b, { role: 'editor' });
    await page.waitForSelector('.gal .gal-th', { timeout: 10000 });
    assert.equal(await page.locator('.prof img.photo').getAttribute('src'), PH[0].url);
    await page.click('.gal .gal-th[data-gal-open="1"]');
    await page.waitForSelector('dialog.galdlg[open] [data-gal-profile]');
    await page.click('dialog.galdlg [data-gal-profile]');
    await page.waitForSelector('dialog.galdlg[open]', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForFunction((u) => document.querySelector('.prof img.photo')?.getAttribute('src') === u, PH[1].url, { timeout: 5000 });
    assert.equal(await page.locator('.prof img.photo').getAttribute('src'), PH[1].url, 'the header shows the new profile photo');
    assert.ok(log.calls.includes(`POST /api/persons/K1/photos/${ID(2)}/profile`), 'the profile call was sent: ' + log.calls.filter((c) => c.includes('profile')).join(', '));
    assert.equal(log.errors.length, 0, 'no page errors: ' + log.errors.join('; '));
    await ctx.close();
  } finally { await b.close(); }
});

test('editor: caption and year are saved from the viewer; remove asks first and offers Hoàn tác', { skip }, async () => {
  for (const k of Object.keys(PHOTOS)) PHOTOS[k] = PH.map((x) => ({ ...x, is_profile: x.id === PH[0].id }));
  PERSONS[0].data.photo = PH[0].url;
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, log } = await open(b, { role: 'editor' });
    await page.waitForSelector('.gal .gal-th', { timeout: 10000 });
    await page.click('.gal .gal-th[data-gal-open="2"]');
    await page.waitForSelector('dialog.galdlg[open] input[name=caption]');
    await page.fill('dialog.galdlg input[name=caption]', 'Thăm quê nội');
    await page.fill('dialog.galdlg input[name=year]', '1994');
    await page.click('dialog.galdlg button[type=submit]');
    await page.waitForFunction(() => !document.querySelector('dialog.galdlg[open]'), null, { timeout: 5000 });
    assert.equal(PHOTOS.K1[2].caption, 'Thăm quê nội');
    assert.equal(PHOTOS.K1[2].year, 1994);
    await page.click('.gal .gal-th[data-gal-open="2"]');
    await page.waitForSelector('dialog.galdlg[open] [data-gal-del]');
    await page.click('dialog.galdlg [data-gal-del]');
    await page.waitForSelector('dialog#dcf[open]');
    assert.match(await page.locator('dialog#dcf').textContent(), /Đưa ảnh này vào thùng rác\?/, 'the remove confirm names the photo');
    assert.equal(PHOTOS.K1.length, 4, 'nothing is removed before the confirm');
    await page.click('dialog#dcf [data-rds-confirm]');
    await page.waitForSelector('.toast.undo [data-undo]', { timeout: 5000 });
    assert.equal(PHOTOS.K1.length, 3, 'the photo left the gallery (to the trash)');
    assert.ok(log.calls.includes('POST /api/persons/K1/photos/' + ID(3) + '/delete'), 'the delete call was sent');
    assert.equal(log.errors.length, 0, 'no page errors: ' + log.errors.join('; '));
    await ctx.close();
  } finally { await b.close(); }
});

test('a living person: a guest sees no gallery (the section is absent, the gallery is refused)', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, log } = await open(b, { role: 'guest', hash: 'person/LV', wait: null });
    await page.waitForFunction(() => document.body.textContent.length > 0);
    await page.waitForTimeout(1500); // the page asks for the gallery and is refused
    assert.equal(await page.locator('.gal').count(), 0, 'no Ảnh section for a guest of a living person');
    assert.ok(log.calls.some((c) => c.startsWith('GET /api/persons/LV/photos')), 'the gallery was asked for and refused (404)');
    assert.equal(log.errors.length, 0, 'no page errors: ' + log.errors.join('; '));
    await ctx.close();
  } finally { await b.close(); }
});

test('screenshots at 390 px, light: the section with four photos, the viewer, the editor controls', { skip: skip || !SHOT }, async () => {
  for (const k of Object.keys(PHOTOS)) PHOTOS[k] = PH.map((x) => ({ ...x, is_profile: x.id === PH[0].id }));
  PERSONS[0].data.photo = PH[0].url;
  fs.mkdirSync(SHOT, { recursive: true });
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx } = await open(b, { role: 'editor' });
    await page.waitForSelector('.gal .gal-th', { timeout: 10000 });
    await page.locator('.gal').first().scrollIntoViewIfNeeded();
    await page.locator('.gal').first().screenshot({ path: path.join(SHOT, 'gallery-section.png') });
    await page.click('.gal .gal-th[data-gal-open="1"]');
    await page.waitForSelector('dialog.galdlg[open] .gal-big');
    await page.locator('dialog.galdlg').screenshot({ path: path.join(SHOT, 'gallery-viewer.png') });
    await page.locator('dialog.galdlg .gal-ed').screenshot({ path: path.join(SHOT, 'gallery-editor.png') });
    await ctx.close();
  } finally { await b.close(); }
});
