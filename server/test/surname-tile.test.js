// The person tile (web/js/ui.js surnameTile): a name with no Vietnamese surname key takes the family crest (the family's
// emblem or its han, e.g. 菊 for the Japan imperial line) instead of the first letter; normal surnames are unchanged.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const JS = path.join(__dirname, '..', '..', 'web', 'js');
// ui.js registers a document click handler at load: a stub document is enough (no DOM is drawn here).
globalThis.document ??= { addEventListener() {}, querySelector() { return null; } };
const load = () => import(pathToFileURL(path.join(JS, 'ui.js')).href);

test('noSurnameKey: only when neither the name nor the family name is a known Vietnamese surname', async () => {
  const { noSurnameKey } = await load();
  assert.equal(noSurnameKey('Thiên', 'Hoàng tộc Nhật Bản (tham khảo)'), true, 'Thiên hoàng: no key, family has none');
  assert.equal(noSurnameKey('', 'Hoàng tộc Nhật Bản'), false, 'no name, no fallback');
  assert.equal(noSurnameKey('Dương', 'Họ Dương'), false, 'a known surname keeps its own tile');
  assert.equal(noSurnameKey('Lý', 'Họ Dương'), false, 'the family has a surname key: normal tiles unchanged');
  assert.equal(noSurnameKey('Hồ', 'Họ Hồ'), false, 'a family with a surname key (Hồ is in the table) is unchanged');
});

test('surnameTile falls back to the family crest in the source (familyCrest with the family han)', () => {
  const ui = fs.readFileSync(path.join(JS, 'ui.js'), 'utf8');
  const body = ui.slice(ui.indexOf('export function surnameTile(name)'), ui.indexOf('export function surnameTile(name)') + 330);
  assert.match(body, /noSurnameKey\(s, fam\.name\) && \(fam\.han \|\| fam\.has_emblem\)\) return familyCrest\(fam, 'md'\);/, 'fallback to the family crest');
  assert.match(body, /return surnameTileOf\(s\);/, 'otherwise the surname tile, unchanged');
});

test('a surnameless family renders the family han as its crest glyph (the Japan imperial case)', async () => {
  const { familyCrest } = await load();
  const html = familyCrest({ id: 'ref-jp-imperial', name: 'Hoàng tộc Nhật Bản (tham khảo)', han: '菊' }, 'md');
  assert.match(html, /crest-md[^>]*>.*?<span class="crest-ch" lang="zh-Hant">菊<\/span>/);
});
