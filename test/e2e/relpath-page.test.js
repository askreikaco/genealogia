// E2E, the relationship path page (#relpath/A?b=B): opened from a profile's Quan he section with A preset, B picked by
// name; the chain, the common ancestor mark, the couple step (VI.via_marriage) and the kin terms (from the kin engine,
// the same module the page uses). Strings come from web/js/relpath-vi.js (read here, never typed). Fictional names only.
// Needs GP_TEST_DATABASE_URL (scratch DB) + playwright + Chrome, like consistency-page.test.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DB_URL = process.env.GP_TEST_DATABASE_URL || '';
const CHROME = process.env.GP_E2E_CHROME || '/usr/bin/google-chrome';
const SHOT = process.env.GP_SHOT_DIR || '';
let chromium = null;
try { ({ chromium } = require('playwright')); } catch {}
const skip = !DB_URL ? 'set GP_TEST_DATABASE_URL (scratch DB) to run'
  : !/scratch|e2e|giapha_ci/.test(DB_URL) ? 'GP_TEST_DATABASE_URL must name a scratch database (contains "scratch", "e2e" or giapha_ci)'
  : !chromium ? 'playwright not installed (NODE_PATH)' : false;

const WEB = path.join(__dirname, '..', '..', 'web', 'js');
const VI = JSON.parse(fs.readFileSync(path.join(WEB, 'relpath-vi.js'), 'utf8').match(/^export const VI = ([\s\S]*);\n$/)[1]);
const OWNER = 'owner-relpath-e2e@test.local';
// Invented family: grandparents GF+GM, father FA, mother MO, F (the viewer's person A), uncle UN and his wife UW,
// cousin C (B for the cousin case), F's wife W and W's father WF (B for the in-law case).
const PERSONS = {
  GF: ['Test Grand Alpha', 'm', '1900'], GM: ['Test Grand Beta', 'f', '1905'], FA: ['Test Father Gamma', 'm', '1930'],
  MO: ['Test Mother Delta', 'f', '1932'], F: ['Test Person Foxtrot', 'm', '1960'], UN: ['Test Uncle Echo', 'm', '1935'],
  UW: ['Test Aunt Hotel', 'f', '1937'], C: ['Test Cousin India', 'm', '1965'], W: ['Test Spouse Juliet', 'f', '1962'],
  WF: ['Test Inlaw Kilo', 'm', '1930'],
};
const PC = [['GF', 'FA'], ['GM', 'FA'], ['GF', 'UN'], ['GM', 'UN'], ['FA', 'F'], ['MO', 'F'], ['UN', 'C'], ['UW', 'C'], ['WF', 'W']];
const CP = [['GF', 'GM'], ['UN', 'UW'], ['F', 'W']];
let base, pool, srv, browser, iso;

test.before(async () => {
  if (skip) return;
  const { isolatedDb } = require('./_isolated-db');
  iso = isolatedDb(DB_URL, 'relpath_page');
  await iso.create();
  process.env.DATABASE_URL = iso.url; process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET ||= crypto.randomBytes(32).toString('hex');
  const { app, pool: p } = require('../../server/server');
  pool = p;
  const dir = path.join(__dirname, '..', '..', 'server', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const [id, [name, sex, born]] of Object.entries(PERSONS)) {
    await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4)', [id, 'duong', { name, sex, born }, 'e2e']);
  }
  await pool.query("insert into relation_migrations (family_id, counts) values ('duong', '{}') on conflict do nothing");
  for (const [p1, c1] of PC) await pool.query("insert into parent_child (family_id, parent_id, child_id, kind) values ('duong', $1, $2, 'ruot')", [p1, c1]);
  for (const [a, b] of CP) await pool.query("insert into couple (family_id, a_id, b_id, kind) values ('duong', $1, $2, 'cuoi')", [a, b]);
  await pool.query(`insert into members (email, name, family_id, role, status) values ($1,'Chu ho e2e','duong','owner','active')
    on conflict (family_id, email) do nothing`, [OWNER]);
  srv = app.listen(0, '127.0.0.1');
  await new Promise((res) => srv.on('listening', res));
  base = `http://127.0.0.1:${srv.address().port}`;
  browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
});
test.after(async () => {
  if (skip) return;
  await browser?.close(); srv?.close();
  await pool?.end().catch(() => {});
  await iso?.drop().catch(() => {});
});

async function newPage({ width = 390, scheme = 'light' }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (route) => route.abort());
  const r = await fetch(base + '/api/test/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: OWNER, name: OWNER }) });
  const [pair] = r.headers.get('set-cookie').split(';');
  await ctx.addCookies([{ name: pair.slice(0, pair.indexOf('=')), value: pair.slice(pair.indexOf('=') + 1), url: base }]);
  return { ctx, page: await ctx.newPage() };
}
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, name), fullPage: false }); };

// The kin terms the page must show: the same engine and graph (the rows above), region = standard.
async function expectedTerms(a, b) {
  const R = await import(pathToFileURL(path.join(WEB, 'relgraph.js')).href);
  const K = await import(pathToFileURL(path.join(WEB, 'kin', 'index.js')).href);
  const ix = R.index(PC.map(([p, c]) => ({ parent_id: p, child_id: c, kind: 'ruot', birth_order: null })), CP.map(([x, y]) => ({ a_id: x, b_id: y, kind: 'cuoi', order_a: null, order_b: null })));
  const opts = { sex: (x) => PERSONS[x]?.[1] || '', year: (x) => Number(PERSONS[x]?.[2]) || null };
  return { ab: K.term(K.kinPath(ix, a, b, opts), { locale: 'vi', region: 'bac' }), ba: K.term(K.kinPath(ix, b, a, opts), { locale: 'vi', region: 'bac' }) };
}

// Open from the profile of F, pick B by name; returns the page once the path is drawn.
async function openAndPick(page, b) {
  await page.goto(`${base}/#person/F`);
  const link = page.locator('a', { hasText: VI.button });
  await link.waitFor({ timeout: 20000 });
  await link.click();
  await page.waitForFunction(() => location.hash.startsWith('#relpath/F'), null, { timeout: 20000 });
  await page.locator('#rpq').fill(PERSONS[b][0]);
  await page.locator(`[data-pick="${b}"]`).click();
  await page.waitForFunction((x) => location.hash.includes('?b=' + x), b, { timeout: 20000 });
  // wait for the drawn chain (its person links), not the picker's list, which is also a ul.ped
  await page.locator('#main a.calm', { hasText: PERSONS[b][0] }).first().waitFor({ timeout: 20000 });
}

test('from a profile: the page opens with F, B is picked; the cousin chain, the common ancestor and both kin terms show', { skip }, async () => {
  const { ctx, page } = await newPage({ width: 1280 });
  try {
    await openAndPick(page, 'C');
    const h1 = (await page.locator('#cbtitle').textContent()).trim();
    assert.strictEqual(h1, VI.page_title);
    const rows = await page.locator('#main ul.ped').first().locator(':scope > li').allInnerTexts();
    const names = rows;
    for (const id of ['F', 'FA', 'GF', 'UN', 'C']) assert.ok(names.some((n) => n.includes(PERSONS[id][0])), `row for ${id}`);
    const grand = page.locator('#main ul.ped').first().locator(':scope > li', { hasText: PERSONS.GF[0] });
    assert.ok((await grand.innerText()).includes(VI.common_ancestor), 'common ancestor mark on the grandparent row');
    const body = await page.locator('#main').innerText();
    assert.ok(body.includes(`4 ${VI.steps}`), 'step count');
    const t = await expectedTerms('F', 'C');
    assert.ok(t.ab && t.ba, 'kin engine gives both terms');
    assert.ok(body.includes(t.ab), 'the term F calls C');
    assert.ok(body.includes(t.ba), 'the term C calls F');
    await shot(page, 'relpath-cousin-1280-light.png');
  } finally { await ctx.close(); }
});

test('in-law: the couple step says via marriage; the chain goes F, spouse, father-in-law', { skip }, async () => {
  const { ctx, page } = await newPage({ width: 390, scheme: 'dark' });
  try {
    await openAndPick(page, 'WF');
    const body = await page.locator('#main').innerText();
    assert.ok(body.includes(VI.via_marriage), 'couple step label');
    const rows = await page.locator('#main ul.ped').first().locator(':scope > li').allInnerTexts();
    assert.ok(rows.some((t) => t.includes(PERSONS.W[0])), 'spouse row');
    const t = await expectedTerms('F', 'WF');
    assert.ok(body.includes(t.ab), 'the term F calls WF');
    // the summary line is built from VI.call_line: speaker first, the person addressed second
    const speakerLine = VI.call_line.replace('{a}', PERSONS.F[0]).replace('{b}', PERSONS.WF[0]).replace('{term}', t.ab);
    const addressedLine = VI.call_line.replace('{a}', PERSONS.WF[0]).replace('{b}', PERSONS.F[0]).replace('{term}', t.ba);
    assert.ok(body.includes(speakerLine), 'speaker F line');
    assert.ok(body.includes(addressedLine), 'speaker WF line');
    assert.ok(speakerLine.indexOf(PERSONS.F[0]) < speakerLine.indexOf(PERSONS.WF[0]), 'speaker first');
    await shot(page, 'relpath-inlaw-390-dark.png');
    const width = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(width, 'no horizontal page scroll at 390');
  } finally { await ctx.close(); }
});

test('no path and same person show their messages; swap reverses the pair', { skip }, async () => {
  const { ctx, page } = await newPage({ width: 1280 });
  try {
    await page.goto(`${base}/#relpath/F?b=F`);
    await page.locator('#rpswap, #main section').first().waitFor({ timeout: 20000 });
    assert.ok((await page.locator('#main').innerText()).includes(VI.same_person));
    await page.goto(`${base}/#relpath/F?b=C`);
    await page.locator('#rpswap').waitFor({ timeout: 20000 });
    await page.locator('#rpswap').click();
    await page.waitForFunction(() => location.hash.includes('relpath/C?b=F'), null, { timeout: 20000 });
  } finally { await ctx.close(); }
});

// Review screenshots (GP_SHOT_DIR only): the cousin and the in-law path at 390 and 1280, light and dark.
test('screenshots for review: cousin and in-law, 390 and 1280, light and dark', { skip: skip || !SHOT }, async () => {
  for (const [kind, b] of [['cousin', 'C'], ['inlaw', 'WF']]) {
    for (const width of [390, 1280]) {
      for (const scheme of ['light', 'dark']) {
        const { ctx, page } = await newPage({ width, scheme });
        try {
          await openAndPick(page, b);
          await page.evaluate(() => document.fonts.ready);
          await page.mouse.move(0, 0); // the pointer left over from the pick would hover (underline) the first row
          await shot(page, `relpath-${kind}-${width}-${scheme}.png`);
        } finally { await ctx.close(); }
      }
    }
  }
});
