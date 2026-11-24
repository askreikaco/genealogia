'use strict';
// conv §36: no new raw CSS values. Counts per file and kind (scripts/raw-values.mjs) may only go down against
// scripts/raw-values-baseline.json. After removing raw values, lower the baseline: node scripts/raw-values.mjs --write-baseline
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const lib = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'raw-values.mjs')).href);

test('raw values never rise above the baseline (use tokens from web/tokens.css)', async () => {
  const { scanRepo, rises, BASELINE } = await lib();
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const up = rises(scanRepo(), base);
  assert.deepStrictEqual(up, [], `raw values went up (use a token, or a variable from web/tokens.css):\n${up.map((r) => `  ${r.file} ${r.kind}: ${r.base} -> ${r.now}`).join('\n')}`);
});

test('the scanner counts raw values and ignores tokens, hairlines and custom properties', async () => {
  const { scanCss, scanJs } = await lib();
  assert.deepStrictEqual(scanCss('.a{color:var(--c-text);border:1px solid var(--c-border);outline:2px solid var(--c-accent);--x:12px}'), {});
  assert.deepStrictEqual(scanCss('.a{font-size:14px;line-height:20px;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.3);z-index:10;padding:6px 10px}'),
    { type: 2, colour: 2, shadow: 1, z: 1, space: 2 });
  assert.deepStrictEqual(scanCss('@media (max-width:671px){.a{margin:0}}'), { media: 1 });
  assert.deepStrictEqual(scanCss('.a{transition:opacity .2s var(--ease)}'), { motion: 1 });
  assert.deepStrictEqual(scanJs("const a = '#6929c4'; x = `<i style=\"width:12px;background:var(--c-tile-1)\">`;"), { 'js-colour': 1, 'js-style': 1 });
});

test('a new file with raw values fails, a lower count passes', async () => {
  const { rises } = await lib();
  assert.deepStrictEqual(rises({ 'web/x.css': { type: 1 } }, {}), [{ file: 'web/x.css', kind: 'type', now: 1, base: 0 }]);
  assert.deepStrictEqual(rises({ 'web/a.css': { type: 3 } }, { 'web/a.css': { type: 5 } }), []);
});
