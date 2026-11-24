// Every tag tone (--<tone>-b background + --<tone>-f text) must reach WCAG AA 4.5:1 in BOTH themes.
// Tokens are light-dark(light, dark) pairs in web/tokens.css; a single colour applies to both themes.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'tokens.css'), 'utf8');
const lum = (h) => {
  const c = [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const val = (name) => {
  const m = new RegExp(`--${name}:\\s*(?:light-dark\\((#[0-9a-fA-F]{6}),\\s*(#[0-9a-fA-F]{6})\\)|(#[0-9a-fA-F]{6}))`).exec(css);
  if (!m) return null;
  return m[3] ? [m[3], m[3]] : [m[1], m[2]];
};
test('every tag tone has readable text in light and dark (>= 4.5:1)', () => {
  const tones = [...new Set([...css.matchAll(/--([a-z]+)-b:/g)].map((m) => m[1]))];
  assert.ok(tones.includes('yellow') && tones.length >= 6, 'tones found: ' + tones.join(','));
  for (const t of tones) {
    const b = val(t + '-b'); const f = val(t + '-f');
    assert.ok(b && f, `--${t}-b / --${t}-f defined as hex or light-dark(hex, hex)`);
    ['light', 'dark'].forEach((theme, i) => {
      const r = ratio(b[i], f[i]);
      assert.ok(r >= 4.5, `${t} ${theme}: ${r.toFixed(2)}:1 (bg ${b[i]}, text ${f[i]})`);
    });
  }
});
