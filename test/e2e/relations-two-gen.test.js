// E2E: Quan hệ shows two generations each way (Ông bà to Cháu) in the browser, against a mocked API (no database).
// Covers: the "Ông bà" group first, with the four grandparents labelled Ông nội, Bà nội, Ông ngoại, Bà ngoại and each row
// opening the person; no Chắt or deeper row and no fold in Quan hệ; "Xem con cháu trên cây · N đời" only when deeper
// descendants exist; "Xem tổ tiên trên cây · N đời" only when ancestors beyond grandparents exist; no Tổ tiên card; the
// level filter picks Ông bà. GP_SHOT_DIR=<dir> also writes the Quan hệ card at 390 light and 1280 dark.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');
const { setBase, open, P } = require('./_form-mock');

let srv;
test.before(async () => {
  if (skip) return;
  const w = await startWeb(); srv = w.srv; setBase(w.base);
});
test.after(() => { srv?.close(); });

// Family duong. S1 (the subject) has parents F1 and M1; their parents G1-G4; G1's parent GG1 (a great-grandparent of S1).
// S1 -> C1 -> D1 -> E1 (E1 is a Chắt of S1, on the tree only). M1 has no parent with a parent on record.
const PERSONS = [
  P('S1', { name: 'Dương Văn Đích', sex: 'm', gen: 5, born: '1980' }),
  P('F1', { name: 'Dương Văn Cha', sex: 'm', gen: 4, born: '1950' }),
  P('M1', { name: 'Trần Thị Mẹ', sex: 'f', gen: 4, born: '1952' }),
  P('G1', { name: 'Dương Văn Nội', sex: 'm', gen: 3, born: '1920' }),
  P('G2', { name: 'Lê Thị Nội', sex: 'f', gen: 3, born: '1922' }),
  P('G3', { name: 'Trần Văn Ngoại', sex: 'm', gen: 3, born: '1921' }),
  P('G4', { name: 'Phạm Thị Ngoại', sex: 'f', gen: 3, born: '1923' }),
  P('GG1', { name: 'Dương Văn Cố', sex: 'm', gen: 2, born: '1890' }),
  P('C1', { name: 'Dương Văn Con', sex: 'm', gen: 6, born: '2005' }),
  P('D1', { name: 'Dương Văn Cháu', sex: 'm', gen: 7, born: '2030' }),
  P('E1', { name: 'Dương Văn Chắt', sex: 'm', gen: 8, born: '2055' }),
  // X has parents PA and PB, both children of GZ: GZ is a grandparent on both sides (one row, both labels)
  P('X', { name: 'Dương Văn Hậu', sex: 'm', gen: 6, born: '2000' }),
  P('PA', { name: 'Dương Văn Bố', sex: 'm', gen: 5, born: '1972' }),
  P('PB', { name: 'Trần Thị Dì', sex: 'f', gen: 5, born: '1975' }),
  P('GZ', { name: 'Dương Văn Gốc', sex: 'm', gen: 4, born: '1945' }),
];
const pc = (id, parent, child) => ({ id, parent_id: parent, child_id: child, kind: 'ruot', birth_order: 1, private: false });
const cp = (id, a, b) => ({ id, a_id: a, b_id: b, kind: 'cuoi', order_a: 1, order_b: 1, start_year: null, end_year: null, private: false });
const REL = {
  source: 'table',
  parent_child: [pc(1, 'F1', 'S1'), pc(2, 'M1', 'S1'), pc(3, 'G1', 'F1'), pc(4, 'G2', 'F1'), pc(5, 'G3', 'M1'), pc(6, 'G4', 'M1'),
    pc(7, 'GG1', 'G1'), pc(8, 'S1', 'C1'), pc(9, 'C1', 'D1'), pc(10, 'D1', 'E1'),
    pc(11, 'GZ', 'PA'), pc(12, 'GZ', 'PB'), pc(13, 'PA', 'X'), pc(14, 'PB', 'X')],
  couple: [cp(101, 'F1', 'M1'), cp(102, 'G1', 'G2'), cp(103, 'G3', 'G4')],
};

const open1 = (browser, id, opts = {}) => open(browser, { role: 'guest', path: '#person/' + id, persons: PERSONS, rel: REL, ready: 'section.relsec', ...opts });
// The Quan hệ groups (title and rows) and the tree links (rows whose title starts "Xem ").
const groupsOf = (page) => page.evaluate(() => [...document.querySelectorAll('section.relsec h3.relgrp')].map((h) => ({
  title: h.textContent.trim(),
  rows: [...(h.nextElementSibling ? h.nextElementSibling.querySelectorAll('a.calm, button.calm') : [])].map((r) => ({
    name: r.querySelector('.calm-n')?.textContent.trim(), sub: r.querySelector('.calm-s')?.textContent.trim() || '', href: r.getAttribute('href') || '',
  })),
})));
const treeLinks = (page) => page.evaluate(() => [...document.querySelectorAll('section.relsec a.calm')]
  .map((a) => ({ text: a.querySelector('.calm-n')?.textContent.trim(), href: a.getAttribute('href') || '' }))
  .filter((x) => /^Xem /.test(x.text)));
async function ready(page) {
  await page.waitForSelector('section.relsec .calm', { timeout: 15000 });
}

test('Ông bà is the first group: four grandparents, labelled Ông nội, Bà nội, Ông ngoại, Bà ngoại; each row opens the person', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open1(browser, 'S1');
    await ready(s.page);
    const g = await groupsOf(s.page);
    assert.deepEqual(g.slice(0, 2).map((x) => x.title), ['Ông bà', 'Cha mẹ'], 'Ông bà above Cha mẹ');
    const ob = g.find((x) => x.title === 'Ông bà');
    assert.deepEqual(ob.rows.map((r) => [r.name, r.sub]), [
      ['Dương Văn Nội', 'Ông nội'], ['Lê Thị Nội', 'Bà nội'], ['Trần Văn Ngoại', 'Ông ngoại'], ['Phạm Thị Ngoại', 'Bà ngoại'],
    ], 'grandparents, father line first');
    assert.ok(ob.rows.every((r) => /#person\/G\d$/.test(r.href)), 'each grandparent row opens the person');
    assert.equal(s.log.errors.length, 0, 'no page errors: ' + s.log.errors.join(' | '));
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('a grandparent on both sides is one Ông bà row, with both labels joined', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open1(browser, 'X');
    await ready(s.page);
    const ob = (await groupsOf(s.page)).find((x) => x.title === 'Ông bà');
    assert.deepEqual(ob.rows.map((r) => r.name), ['Dương Văn Gốc'], 'one row for the shared grandparent');
    assert.deepEqual(ob.rows[0].sub.split(' · ').sort(), ['Ông ngoại', 'Ông nội'], 'both sides in the label');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('no Chắt or deeper in Quan hệ: no group, no row, no fold; Cháu is the last group', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open1(browser, 'S1');
    await ready(s.page);
    const g = await groupsOf(s.page);
    assert.ok(!g.some((x) => /Chắt|Chút|Chít/.test(x.title)), 'no Chắt group: ' + g.map((x) => x.title).join(' | '));
    assert.ok(!g.some((x) => x.rows.some((r) => /Chắt|Chút|Chít/.test(r.sub) || r.name === 'Dương Văn Chắt')), 'no Chắt row');
    assert.equal(await s.page.locator('section.relsec details.more-fold').count(), 0, 'no fold in Quan hệ');
    assert.equal(g[g.length - 1].title.startsWith('Cháu'), true, 'Cháu is the last group');
    assert.equal(await s.page.locator('section[aria-label="Tổ tiên"]').count(), 0, 'no Tổ tiên card on the profile');
    assert.equal(await s.page.locator('section.relsec .ped').count(), 0, 'no ancestor list');
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('"Xem con cháu trên cây" appears only when deeper descendants exist', { skip }, async () => {
  const browser = await launch();
  try {
    // S1: Chắt (E1) is a great-grandchild: the link reads 1 đời and opens the person's tree
    const s = await open1(browser, 'S1');
    await ready(s.page);
    const down = (await treeLinks(s.page)).filter((x) => x.text.startsWith('Xem con cháu'));
    assert.deepEqual(down.map((x) => x.text), ['Xem con cháu trên cây · 1 đời'], 'one link after Cháu');
    assert.match(down[0].href, /tree\/@S1$/, 'the link opens the tree at the person');
    // C1: the grandchild E1 is two generations down: no great-grandchild, so no link
    const c = await open1(browser, 'C1');
    await ready(c.page);
    assert.deepEqual((await treeLinks(c.page)).filter((x) => x.text.startsWith('Xem con cháu')), [], 'C1: no deeper descendants, no link');
    // M1: the descendants run four generations (S1, C1, D1, E1): the link counts them, past the two shown
    const m = await open1(browser, 'M1');
    await ready(m.page);
    assert.deepEqual((await treeLinks(m.page)).filter((x) => x.text.startsWith('Xem con cháu')).map((x) => x.text), ['Xem con cháu trên cây · 2 đời'], 'M1: two generations past Cháu');
    await s.ctx.close(); await c.ctx.close(); await m.ctx.close();
  } finally { await browser.close(); }
});

test('"Xem tổ tiên trên cây" appears only when ancestors beyond grandparents exist', { skip }, async () => {
  const browser = await launch();
  try {
    // S1: G1's parent GG1 is a great-grandparent: 1 đời
    const s = await open1(browser, 'S1');
    await ready(s.page);
    const up = (await treeLinks(s.page)).filter((x) => x.text.startsWith('Xem tổ tiên'));
    assert.deepEqual(up.map((x) => x.text), ['Xem tổ tiên trên cây · 1 đời'], 'one link at the end of Quan hệ');
    assert.match(up[0].href, /tree\/@S1$/);
    // M1: her parents G3 and G4 have no parents on record: no grandparent group, no link
    const m = await open1(browser, 'M1');
    await ready(m.page);
    assert.deepEqual((await treeLinks(m.page)).filter((x) => x.text.startsWith('Xem tổ tiên')), [], 'M1: no ancestors beyond grandparents');
    assert.ok(!(await groupsOf(m.page)).some((x) => x.title === 'Ông bà'), 'M1: no Ông bà group when no grandparent is on record');
    await s.ctx.close(); await m.ctx.close();
  } finally { await browser.close(); }
});

test('the level filter picks Ông bà: only the grandparents stay', { skip }, async () => {
  const browser = await launch();
  try {
    const s = await open1(browser, 'S1');
    await ready(s.page);
    await s.page.evaluate(() => { const sel = document.querySelector('section.relsec [data-relf="lv"]'); sel.value = 'ob'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await s.page.waitForFunction(() => !document.querySelector('section.relsec')?.innerText.includes('Cha mẹ'), null, { timeout: 5000 });
    const titles = (await groupsOf(s.page)).map((x) => x.title);
    assert.deepEqual(titles, ['Ông bà'], 'Ông bà only: ' + titles.join(' | '));
    await s.ctx.close();
  } finally { await browser.close(); }
});

test('screenshots (only with GP_SHOT_DIR): the Quan hệ card at 390 light and 1280 dark', { skip: skip || !SHOTS }, async () => {
  const browser = await launch();
  try {
    for (const [width, scheme] of [[390, 'light'], [1280, 'dark']]) {
      const s = await open1(browser, 'S1', { viewport: { width, height: 844 }, scheme });
      await ready(s.page);
      await s.page.locator('section.relsec').screenshot({ path: path.join(SHOTS, `rel2-${width}-${scheme}.png`) });
      const sw = await s.page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= width, `no horizontal scroll at ${width} (${sw})`);
      await s.ctx.close();
    }
  } finally { await browser.close(); }
});
