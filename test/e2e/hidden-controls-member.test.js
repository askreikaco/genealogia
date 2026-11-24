// E2E: no interactive element may sit in the DOM invisible, outside a closed <dialog>, on any route as member. Walks the
// routes against mocked /api responses (no database). Split by role so each file stays well inside its time budget.
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] node --test test/e2e/hidden-controls-member.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { skip, launch, startWeb } = require('./_e2e-harness');
const { ROUTES, FREE_ROUTES, setBase, openPage, AUDIT } = require('./_hidden-mock');

let srv;
test.before(async () => { if (skip) return; const w = await startWeb(); srv = w.srv; setBase(w.base); });
test.after(() => { srv?.close(); });

test('no hidden interactive element on any route (member)', { skip }, async () => {
  const browser = await launch();
  try {
    const problems = {};
    for (const r of [...ROUTES, ...FREE_ROUTES]) {
      const { page, ctx, errors } = await openPage(browser, 'member', r);
      const found = await page.evaluate(AUDIT);
      if (found.length) problems[r || 'tree'] = found;
      assert.deepEqual(errors, [], `page errors on #/duong/${r}`);
      await ctx.close();
    }
    assert.deepEqual(problems, {}, 'hidden interactive elements (remove the markup or never render it)');
  } finally { await browser.close(); }
});
