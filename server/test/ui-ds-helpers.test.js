// The REIKA DS helpers in web/js/ui.js (U8): iconButton renders an rds-ibtn with a DS svg when the key is mapped
// (DS_ICON), and keeps the local svg in an rds-ibtn when it is not; emptyState renders the DS .rds-empty block.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const JS = path.join(__dirname, '..', '..', 'web', 'js');
// ui.js registers a document click handler at load: a stub document is enough (no DOM is drawn here).
globalThis.document ??= { addEventListener() {}, querySelector() { return null; } };
const load = () => import(pathToFileURL(path.join(JS, 'ui.js')).href);

test('iconButton("pencil") renders rds-ibtn with the DS svg (rds-icon) and its accessible name', async () => {
  const { iconButton } = await load();
  const html = iconButton({ icon: 'pencil', label: 'Sửa', attrs: 'data-act="edit"' });
  assert.match(html, /^<button type="button" class="rds-ibtn" aria-label="Sửa" title="Sửa" data-act="edit">/, 'rds-ibtn button');
  assert.match(html, /<svg class="rds-icon"/, 'svg.rds-icon from the DS icon set');
  assert.doesNotMatch(html, /class="ib"/, 'no legacy .ib class');
});

test('iconButton with an unmapped key keeps the local svg inside an rds-ibtn button', async () => {
  const { iconButton } = await load();
  const html = iconButton({ icon: 'noSuchKey', label: 'Cài đặt' });
  assert.match(html, /^<button type="button" class="rds-ibtn" aria-label="Cài đặt"/, 'rds-ibtn button');
  assert.match(html, /<svg class="cic"/, 'local svg kept for an unmapped key');
  const star = iconButton({ icon: 'noSuchKey', label: 'Theo dõi', attrs: 'data-follow="PA" aria-pressed="false"' });
  assert.match(star, /data-follow="PA" aria-pressed="false"/, 'caller attrs kept on the unmapped-key button');
  assert.doesNotMatch(html, /class="rds-icon"/, 'no DS svg for an unmapped key');
});

test('every CI icon key has a DS mapping and renders svg.rds-icon', async () => {
  const { iconButton, CI } = await load();
  const keys = Object.keys(CI);
  assert.ok(keys.length >= 25, `CI keys: ${keys.length}`);
  const unmapped = [];
  for (const k of keys) {
    const html = iconButton({ icon: k, label: k });
    if (!/<svg class="rds-icon"/.test(html)) unmapped.push(k);
  }
  assert.deepStrictEqual(unmapped, [], 'CI keys without a DS icon (add them to DS_ICON in web/js/ui.js)');
});

test('iconButton decodes escaped attrs once (DS helper escapes them again)', async () => {
  const { iconButton } = await load();
  const html = iconButton({ icon: 'more', label: 'Tùy chọn', attrs: 'data-mmenu="a&quot;b"' });
  assert.match(html, /data-mmenu="a&quot;b"/, 'attribute value escaped exactly once');
});

test('emptyState("x") renders a .rds-empty block containing x', async () => {
  const { emptyState } = await load();
  const html = emptyState('x');
  assert.match(html, /<div class="rds-empty rds-empty--block" role="status">/, 'rds-empty block');
  assert.match(html, /<p class="rds-empty__text">x<\/p>/, 'the message is the text');
  assert.doesNotMatch(html, /class="sub pad"/, 'no legacy p.sub.pad');
});
