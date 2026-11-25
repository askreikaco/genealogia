// The Thông tin facts card (web/js/facts.js): life basics under "Tóm tắt", single-row groups that repeat their label
// merged into it, and the "(ngày sinh chỉ hiện khi đăng nhập)" hint only for the living born within 110 years.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'facts.js')).href);

test('life basics go under Tóm tắt, first, with their row labels kept', async () => {
  const { factGroups, SUMMARY } = await load();
  const out = factGroups([
    { title: 'Sinh', basic: true, rows: [['Sinh', '874'], ['Nơi sinh', 'Huế']] },
    { title: 'Mất', basic: true, rows: [['Mất', '937'], null] },
    { title: 'Nơi sống & nghề', rows: [['Nơi sống', 'Củ Chi'], ['Nghề', 'Nông']] },
    { title: 'Ghi chú & nguồn', rows: [] },
  ]);
  assert.deepStrictEqual(out.map((g) => g.title), [SUMMARY, 'Nơi sống & nghề']);
  assert.deepStrictEqual(out[0].rows, [['Sinh', '874'], ['Nơi sinh', 'Huế'], ['Mất', '937']]);
});

test('a single-row group whose header repeats its label is merged into Tóm tắt', async () => {
  const { factGroups } = await load();
  const out = factGroups([
    { title: 'Sinh', rows: [['Sinh', '874']] },
    { title: 'Nơi sống & nghề', rows: [['Nơi sống', 'Củ Chi']] },
    { title: 'Ghi chú & nguồn', rows: [['Ghi chú', 'a'], ['Nguồn', 'b']] },
  ]);
  assert.deepStrictEqual(out.map((g) => g.title), ['Tóm tắt', 'Ghi chú & nguồn']);
  assert.deepStrictEqual(out[0].rows, [['Sinh', '874'], ['Nơi sống', 'Củ Chi']]);
});

test('a single row under a distinct header keeps its group; no facts gives no groups', async () => {
  const { factGroups, factCardHtml } = await load();
  const out = factGroups([{ title: 'Nơi sống & nghề', rows: [['Nghề', 'Nông']] }]);
  assert.deepStrictEqual(out.map((g) => g.title), ['Nơi sống & nghề']);
  assert.deepStrictEqual(factGroups([{ title: 'Sinh', basic: true, rows: [null] }]), []);
  assert.equal(factCardHtml([]), '');
});

test('the card renders one group per title, each with its header and dl', async () => {
  const { factGroups, factCardHtml } = await load();
  const html = factCardHtml(factGroups([{ title: 'Sinh', basic: true, rows: [['Sinh', '874']] }]));
  assert.match(html, /^<div class="cd factcard"><div class="fgrp"><div class="relhead"><h2>Tóm tắt<\/h2><\/div><dl class="facts"><dt>Sinh<\/dt><dd>874<\/dd><\/dl><\/div><\/div>$/, 'Tóm tắt is the card title (the Quan hệ title markup)');
  assert.doesNotMatch(html, /tgen[^>]*>Tóm tắt/, 'no uppercase eyebrow for Tóm tắt');
  assert.doesNotMatch(html, />Sinh<\/div>/, 'no SINH header');
  const sub = factCardHtml(factGroups([{ title: 'Nơi sống & nghề', rows: [['Nơi sống', 'Củ Chi'], ['Nghề', 'Nông']] }]));
  assert.match(sub, /<div class="tgen" style="--d:0">Nơi sống &amp; nghề<\/div>|<div class="tgen" style="--d:0">Nơi sống & nghề<\/div>/, 'other groups keep the small label');
});

test('the born-date hint: living and born within 110 years only', async () => {
  const { bornHintShown } = await load();
  const Y = 2026;
  assert.equal(bornHintShown({ born: '1960', dead: false, member: false }, Y), true, 'living, recent');
  assert.equal(bornHintShown({ born: '1916', dead: false, member: false }, Y), true, 'exactly 110 years');
  assert.equal(bornHintShown({ born: '1915', dead: false, member: false }, Y), false, 'more than 110 years');
  assert.equal(bornHintShown({ born: '874', dead: false, member: false }, Y), false, 'a very old birth');
  assert.equal(bornHintShown({ born: '1960', dead: true, member: false }, Y), false, 'deceased');
  assert.equal(bornHintShown({ born: '1960', dead: false, member: true }, Y), false, 'signed in');
  assert.equal(bornHintShown({ born: '', dead: false, member: false }, Y), false, 'no birth year');
});
