// E2E: "add a new person" starts with a search, then checks for duplicates before saving (web/js/addflow.js):
//   search-hit           a name found in the tree is used: the tap opens that person (no new person is made)
//   create-new-no-dup    "Không thấy — tạo người mới" -> basic form -> no match -> saved directly (one add op)
//   create-with-dup      a match is listed ("Có thể đã có người này"); "Dùng người này" fills only the EMPTY fields of
//                        that person (one edit op, no overwrite) and opens that person; "Vẫn tạo mới" creates anyway
// Invented names only. Mocked API, no database:
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=<dir>] node --test test/e2e/add-person-flow.test.js
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
const PERSONS = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 1, born: '1950' }), // no full birth date, no death
  P('K2', { name: 'Dương Thị Hai', sex: 'f', gen: 7, thu: '2', parent: 'PA', order: 2, born: '1952', died: '2001' }),
];
const PC = (id, parent, child, order) => ({ id, parent_id: parent, child_id: child, kind: 'ruot', birth_order: order, private: false });
const REL = { source: 'table', parent_child: [PC(1, 'PR', 'PA', 1), PC(2, 'PA', 'K1', 1), PC(3, 'PA', 'K2', 2)], couple: [] };
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

// An editor on the Dương family. log.ops: the ops sent; log.cands: the duplicate checks sent; cands: what the check answers.
async function open(browser, hash, cands = []) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const log = { ops: [], cands: [], errors: [] };
  page.on('pageerror', (e) => log.errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: 'Tester', role: 'editor', status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: 'editor' } });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') {
      const since = u.searchParams.get('since'); const ids = u.searchParams.get('ids');
      if (ids) return json({ items: PERSONS.filter((x) => ids.split(',').includes(x.id)), rel: REL });
      return json(since === '0' || since === null ? { items: PERSONS, next_since: 1, rel: REL } : { items: [], next_since: Number(since), rel: REL });
    }
    if (p === '/api/persons/candidates') { log.cands.push(req.postDataJSON()); return json({ items: cands }); }
    if (p === '/api/ops') { const b = req.postDataJSON(); log.ops.push(...b.ops); return json({ applied: b.ops.map((o) => o.op_id), rejected: [] }); }
    if (p === '/api/events') return json({ items: [], stories: [] });
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + '/#/duong/' + hash);
  await page.waitForTimeout(400);
  return { page, ctx, log };
}
// the ops are sent after the local save: wait for what the test checks (up to 5 s)
async function until(fn) { for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 100)); }
const shot = async (page, name) => { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true }); };
// the one operation for the person (edit or add): its fields
const fieldsOf = (log, id) => log.ops.filter((o) => (o.id || o.person_id) === id).map((o) => o.fields || {});

test('search-hit: a name found in the tree is used; the tap opens that person and makes no new one', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, log } = await open(b, 'list');
    await page.click('[data-add="list"]');
    await page.waitForSelector('#add-q', { timeout: 8000 });
    await page.fill('#add-q', 'dương văn một'); // accent-insensitive: the name is in the tree
    await page.waitForSelector('.add-res [data-pick="K1"]');
    await shot(page, 'add-1-search.png');
    await page.click('.add-res [data-pick="K1"]');
    await page.waitForFunction(() => location.hash.includes('person/K1'), null, { timeout: 8000 });
    assert.equal(log.ops.filter((o) => o.action === 'add' || (o.fields && o.fields.name)).length, 0, 'no new person was made');
    assert.equal(log.cands.length, 0, 'no duplicate check for a person that is not added');
    assert.deepStrictEqual(log.errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('create-new-no-dup: "Không thấy" -> the basic form -> no match -> saved as one new person', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  try {
    const { page, ctx, log } = await open(b, 'list', []);
    await page.click('[data-add="list"]');
    await page.waitForSelector('#add-q');
    await page.fill('#add-q', 'Dương Thị Mới Sinh');
    await page.waitForSelector('[data-new]');
    assert.equal(await page.locator('.add-res [data-pick]').count(), 0, 'no one matches');
    assert.equal((await page.textContent('[data-new]')).trim(), 'Không thấy — tạo người mới');
    await page.click('[data-new]');
    await page.waitForSelector('#add-f input[name="name"]');
    assert.equal(await page.inputValue('#add-f input[name="name"]'), 'Dương Thị Mới Sinh', 'the search text is the name');
    await page.selectOption('#add-f select[name="sex"]', 'f');
    await page.fill('#add-f input[name="birth"]', '1990');
    await shot(page, 'add-2-form.png');
    await page.click('#add-f button[type="submit"]');
    await page.waitForFunction(() => location.hash.includes('person/'), null, { timeout: 8000 });
    assert.equal(log.cands.length, 1, 'the duplicate check ran before saving');
    assert.equal(log.cands[0].data.name, 'Dương Thị Mới Sinh');
    assert.equal(log.cands[0].data.born, '1990');
    await until(() => log.ops.length > 0);
    const added = log.ops.find((o) => o.fields && o.fields.name === 'Dương Thị Mới Sinh');
    assert.ok(added, 'one add with the name');
    assert.equal(added.fields.born, '1990');
    assert.equal(added.fields.sex, 'f');
    assert.deepStrictEqual(log.errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('create-with-dup: a match is listed; "Dùng người này" fills only the empty fields of that person', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const cands = [{ id: 'K1', name: 'Dương Văn Một', years: '1950', score: 0.92, reasons: ['cùng họ tên', 'cùng năm sinh 1950'] }];
  try {
    const { page, ctx, log } = await open(b, 'list', cands);
    await page.click('[data-add="list"]');
    await page.waitForSelector('#add-q');
    await page.fill('#add-q', 'Dương Văn Lạ'); // a name not in the tree: the form opens
    await page.click('[data-new]');
    await page.waitForSelector('#add-f input[name="name"]');
    await page.fill('#add-f input[name="name"]', 'Dương Văn Một');
    await page.selectOption('#add-f select[name="sex"]', 'm');
    await page.fill('#add-f input[name="birth"]', '5/3/1950');
    await page.fill('#add-f input[name="death"]', '1999');
    await page.click('#add-f button[type="submit"]');
    await page.waitForSelector('.add-dup [data-use="K1"]', { timeout: 8000 });
    assert.equal(await page.locator('.add-dup').count(), 1);
    assert.match(await page.textContent('.add-dup'), /92%/);
    assert.equal(log.ops.length, 0, 'nothing is saved before the user decides');
    await shot(page, 'add-3-dup.png');
    await page.click('.add-dup [data-use="K1"]');
    await page.waitForFunction(() => location.hash.includes('person/K1'), null, { timeout: 8000 });
    await until(() => log.ops.length > 0);
    const fills = fieldsOf(log, 'K1');
    assert.equal(fills.length, 1, 'one edit of the existing person');
    assert.deepStrictEqual(fills[0], { birth_date: '05/03/1950', died: '1999' }, 'only the empty fields are filled');
    assert.ok(!('born' in fills[0]) && !('sex' in fills[0]) && !('name' in fills[0]), 'filled values are never overwritten');
    assert.equal(log.ops.filter((o) => o.fields && o.fields.name === 'Dương Văn Một').length, 0, 'no second person is made');
    assert.deepStrictEqual(log.errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('create-with-dup: "Vẫn tạo mới" saves a new person anyway', { skip }, async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const cands = [{ id: 'K1', name: 'Dương Văn Một', years: '1950', score: 0.85, reasons: ['cùng họ tên'] }];
  try {
    const { page, ctx, log } = await open(b, 'list', cands);
    await page.click('[data-add="list"]');
    await page.waitForSelector('#add-q');
    await page.fill('#add-q', 'Dương Văn Một Hai');
    await page.click('[data-new]');
    await page.waitForSelector('#add-f input[name="name"]');
    await page.fill('#add-f input[name="name"]', 'Dương Văn Một Hai');
    await page.click('#add-f button[type="submit"]');
    await page.waitForSelector('[data-create]', { timeout: 8000 });
    await page.click('[data-create]');
    await page.waitForFunction(() => location.hash.includes('person/'), null, { timeout: 8000 });
    await until(() => log.ops.some((o) => o.fields && o.fields.name === 'Dương Văn Một Hai'));
    assert.ok(log.ops.some((o) => o.fields && o.fields.name === 'Dương Văn Một Hai'), 'the new person is saved');
    assert.deepStrictEqual(log.errors, []);
    await ctx.close();
  } finally { await b.close(); }
});
