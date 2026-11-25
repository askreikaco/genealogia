// E2E: person codes (mã người) in the book. A code shows in small grey text under the name in each entry and inline in
// the name index; a person without a code shows none; Settings "Hiện mã người" (default on) hides them at once and the
// choice persists after a reload. Mocked API (persons carry data.sid as the server sends it).
//   NODE_PATH=<dir with playwright> node --test test/e2e/book-codes.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { FONTS, seedPersons, seedPlan, staticServer, mockApi, WEB } = require('./_book-mock');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const skip = !chromium ? 'playwright not installed (NODE_PATH)' : !fs.existsSync(CHROME) ? 'no Chrome at GP_E2E_CHROME' : false;

let base; let srv; let browser; let S;
// a well-formed code: 6 body characters + the check character (web/js/shortid.js)
const mk = (body) => body + S.sidCheck(body);
const DEFAULT_OPTS = { root: '', dir: 'down', maxGen: 0, spouses: true, daughters: 'full', status: 'all', layout: 'branch', orient: 'land' };

test.before(async () => {
  if (skip) return;
  S = await import(pathToFileURL(path.join(WEB, 'js', 'shortid.js')).href);
  srv = staticServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
});
test.after(async () => { await browser?.close(); srv?.close(); });

// Two persons in the printed entries: A gets a code, B has none.
async function setup(width = 390, height = 844) {
  const persons = seedPersons();
  const inBook = [];
  const plan = await seedPlan(DEFAULT_OPTS);
  for (const pg of plan.pages) for (const col of pg.cols || []) for (const it of col) if (it[0] === 1) inBook.push(it[1]);
  const [A, B] = inBook.filter((id) => persons.some((p) => p.id === id)).slice(0, 2);
  const codeA = mk('K7Q29M');
  const texts = { [A]: { data: { sid: codeA } } };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(FONTS, (r) => r.abort());
  await mockApi(page, [], { texts });
  return { ctx, page, A, B, codeA, plan, persons };
}

test('entry: the code sits in small grey text under the name; a person without one shows none', { skip }, async () => {
  const { ctx, page, A, B, codeA } = await setup();
  try {
    await page.goto(base + '/book?inapp=1#p-' + A);
    await page.waitForSelector(`.entry[data-id="${A}"] .eh .sid`);
    const r = await page.evaluate((a) => {
      const sid = document.querySelector(`.entry[data-id="${a}"] .eh .sid`);
      const nm = document.querySelector(`.entry[data-id="${a}"] .eh .nm`);
      return {
        text: sid.textContent.trim(),
        below: sid.getBoundingClientRect().top >= nm.getBoundingClientRect().bottom - 1,
        smaller: parseFloat(getComputedStyle(sid).fontSize) < parseFloat(getComputedStyle(nm).fontSize),
      };
    }, A);
    assert.equal(r.text, `Mã ${codeA.slice(0, 4)}-${codeA.slice(4)}`, 'label and formatted code');
    assert.ok(r.below, 'the code is on its own line below the name');
    assert.ok(r.smaller, 'smaller than the name');
    // a person without a code: her entry loads and prints no code line
    await page.evaluate((h) => { location.hash = h; }, '#p-' + B);
    await page.waitForSelector(`.entry[data-id="${B}"] .nm`);
    assert.equal(await page.$(`.entry[data-id="${B}"] .sid`), null, 'no code line for a person without one');
  } finally { await ctx.close(); }
});

test('index: the code follows the name in the name index', { skip }, async () => {
  const { ctx, page, codeA, plan, A, persons } = await setup();
  try {
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    const idx = plan.pages.findIndex((pg) => pg.head && pg.head.type === 'index') + 1;
    assert.ok(idx > 0, 'the plan has a name index');
    const name = persons.find((p) => p.id === A).data.name;
    // the index runs over several pages (sorted by surname letter): walk them until A's row shows its code
    const row = { text: null };
    for (let n = idx; n <= plan.pages.length && !row.text; n++) {
      await page.evaluate((k) => document.getElementById('p' + k).scrollIntoView(), n);
      await page.waitForTimeout(150);
      const found = await page.$$eval(`#p${n} .ie`, (els, nm) => els.map((e) => e.querySelector('.sid')).filter(Boolean).map((s) => ({ name: s.parentElement.childNodes[0].textContent.trim(), code: s.textContent.trim() })).find((r) => r.name === nm) || null, name);
      if (found) row.text = found;
    }
    assert.ok(row.text, 'A has a row in the name index with its code');
    assert.equal(row.text.code, `${codeA.slice(0, 4)}-${codeA.slice(4)}`, 'the index shows the same formatted code');
  } finally { await ctx.close(); }
});

test('Settings: codes are shown by default, "Hiện mã người" hides them at once and the choice persists', { skip }, async () => {
  const { ctx, page, A } = await setup();
  try {
    await page.goto(base + '/book?inapp=1#p-' + A);
    await page.waitForSelector(`.entry[data-id="${A}"] .sid`);
    const shown = () => page.$eval(`.entry[data-id="${A}"] .sid`, (el) => getComputedStyle(el).display !== 'none');
    assert.equal(await page.getAttribute('html', 'data-bk-codes'), '1', 'on by default');
    assert.equal(await shown(), true, 'code visible by default');

    await page.click('#bset');
    await page.waitForSelector('#setdlg[open] #psid');
    assert.equal(await page.$eval('#psid', (el) => el.checked), true, 'the toggle is on by default');
    await page.uncheck('#psid');
    assert.equal(await page.getAttribute('html', 'data-bk-codes'), '0', 'hidden at once, no reload');
    await page.keyboard.press('Escape');
    assert.equal(await shown(), false, 'code hidden');

    await page.reload();
    await page.waitForSelector(`.entry[data-id="${A}"]`);
    await page.waitForSelector(`.entry[data-id="${A}"] .sid`, { state: 'attached' });
    assert.equal(await page.getAttribute('html', 'data-bk-codes'), '0', 'still hidden after reload');
    assert.equal(await shown(), false, 'still hidden after reload');
    await page.click('#bset');
    assert.equal(await page.$eval('#psid', (el) => el.checked), false, 'toggle persists as off');
    await page.check('#psid');
    await page.keyboard.press('Escape');
    assert.equal(await shown(), true, 'shown again');
  } finally { await ctx.close(); }
});

test('every person has a code: no flow page runs into its footer (the plan sizes the code line)', { skip }, async () => {
  const texts = {};
  seedPersons().forEach((p, i) => {
    let n = (i + 1) * 2654435761 % 887504239 + 31 * i * 7919; let body = '';
    for (let k = 0; k < 6; k++) { body = S.SID_ALPHABET[n % 31] + body; n = Math.floor(n / 31); }
    texts[p.id] = { data: { sid: mk(body) } };
  });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.route(FONTS, (r) => r.abort());
  await mockApi(page, [], { texts });
  try {
    await page.goto(base + '/book?inapp=1');
    await page.waitForSelector('.pg .cover');
    const total = await page.$$eval('.pg', (els) => els.length);
    const bad = [];
    for (let n = 1; n <= total; n++) {
      await page.evaluate((k) => document.getElementById('p' + k).scrollIntoView(), n);
      await page.waitForTimeout(60);
      bad.push(...await page.evaluate((k) => {
        const pg = document.getElementById('p' + k); const out = [];
        const foot = pg.querySelector(':scope > .foot'); const cols = pg.querySelector(':scope > .cols');
        if (!foot || !cols) return out;
        const fb = foot.getBoundingClientRect().top;
        for (const col of cols.querySelectorAll(':scope > .col')) for (const el of col.children) if (el.getBoundingClientRect().bottom > fb + 1) out.push(k + ':' + Math.round(el.getBoundingClientRect().bottom - fb));
        return out;
      }, n));
    }
    assert.deepEqual(bad.slice(0, 12), [], 'entries that run past the footer (page:px)');
  } finally { await ctx.close(); }
});
