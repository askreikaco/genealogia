'use strict';
// Crest guard: the owner crest (a colored square with a Hán character) is drawn only by web/js/ui.js (surnameTileOf,
// familyCrest) and its emblem image by web/js/emblem.js (famCrest). Any other web/js file that writes a Hán-tile class
// (han, or a name with "tile"), a span holding one CJK character, or a quoted Hán literal fails here.
// Data files are allowed: surnames-*.js (surname -> Hán) and kin/packs/ (kinship words).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', '..', 'web');
const JS = path.join(WEB, 'js');
const OWNERS = new Set(['ui.js', 'emblem.js']);
const DATA = /^(surnames-[^/]+\.js|kin\/packs\/[^/]+\.js)$/;
const CJK = '\\u2E80-\\u2FFF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF';
const RULES = [
  ['tile class', (s) => [...s.matchAll(/class=\\?"([^"\\]*)/g)].some((m) => m[1].split(/\s+/).some((t) => t === 'han' || /tile/i.test(t.replace(/\$\{[^}]*\}/g, ''))))],
  ['span with one Hán character', (s) => new RegExp(`<span\\b[^>]*>\\s*[${CJK}]\\s*</span>`).test(s)],
  ['quoted Hán literal', (s) => new RegExp(`(['"\`])[${CJK}]{1,2}\\1`).test(s)],
];
const CSS_OLD = /\.(csw-tile|stile|fchip-t|mo-tile|lf-tile|ttile)\b/;

// Lines of src that break a rule: [{ line, rule }].
function violations(src) {
  const out = [];
  src.split('\n').forEach((text, i) => {
    for (const [rule, hit] of RULES) if (hit(text)) out.push({ line: i + 1, rule });
  });
  return out;
}
function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name), base)
    : d.name.endsWith('.js') ? [path.relative(base, path.join(dir, d.name)).split(path.sep).join('/')] : []));
}

test('no file outside ui.js and emblem.js draws the Hán crest (tile class, one-character span, quoted Hán)', () => {
  const bad = [];
  for (const rel of walk(JS)) {
    if (OWNERS.has(rel) || DATA.test(rel)) continue;
    for (const v of violations(fs.readFileSync(path.join(JS, rel), 'utf8'))) bad.push(`web/js/${rel}:${v.line} ${v.rule}`);
  }
  assert.deepStrictEqual(bad, [], `hand-drawn crest markup (use crestTile / familyCrest from js/ui.js):\n  ${bad.join('\n  ')}`);
});

test('the guard catches each pattern (so it cannot pass by accident)', () => {
  assert.deepStrictEqual(violations('<span class="han" lang="zh-Hant">x</span>').map((v) => v.rule), ['tile class']);
  assert.deepStrictEqual(violations('<span class="lf-tile" hidden></span>').map((v) => v.rule), ['tile class']);
  assert.deepStrictEqual(violations('<div class="seal"><span>楊</span></div>').map((v) => v.rule), ['span with one Hán character']);
  assert.deepStrictEqual(violations("const d = { han: '楊' };").map((v) => v.rule), ['quoted Hán literal']);
  assert.deepStrictEqual(violations('<span class="crest-sq crest-md">x</span>'), []);
});

test('the old hand-made tile CSS is gone from web/*.css', () => {
  for (const f of fs.readdirSync(WEB).filter((n) => n.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(WEB, f), 'utf8');
    assert.ok(!CSS_OLD.test(css), `${f} still styles a hand-made tile class`);
  }
});

test('the crest component lives in ui.js and the emblem image in emblem.js', () => {
  assert.match(fs.readFileSync(path.join(JS, 'ui.js'), 'utf8'), /export function familyCrest/);
  assert.match(fs.readFileSync(path.join(JS, 'emblem.js'), 'utf8'), /export const famCrest/);
});
