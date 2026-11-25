// E2E: the one entry "Xin nhận quyền Chủ họ" in Cài đặt dòng họ, against a mocked API (no database). The server says
// which path applies (family_state, claim_path). Abandoned family: a one-line explanation, then the claim sheet
// (evidence, sent to /api/claims). Owned family: the succession confirm, no claim sheet. Screenshot of the abandoned
// entry at 390x844 into GP_SHOT_FILE when set.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { skip, launch, startWeb } = require('./_e2e-harness');

const STUB = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/listui.css"></head>
<body><main id="main" tabindex="-1"><div id="succ-settings"></div></main><script type="module">
import * as SUC from '/js/succession.js';
import * as CLM from '/js/claim.js';
window.SUC = SUC; window.CLM = CLM; window.confirmTitles = [];
const S = { familyName: () => 'Họ Thử', followedFams: () => ['duong'], roleIn: () => 'editor', signedIn: () => true, refreshMe: async () => {} };
window.dialog = (html, onSubmit) => {
  document.querySelectorAll('dialog.dlg').forEach((x) => { x.close(); x.remove(); });
  const d = document.createElement('dialog'); d.className = 'dlg';
  d.innerHTML = '<form method="dialog" class="form-stack">' + html + '<p class="err" data-err></p></form>';
  document.body.append(d); d.showModal();
  d.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    try { await onSubmit(new FormData(e.target), d); d.close(); d.remove(); }
    catch (err) { d.querySelector('[data-err]').textContent = err.message; }
  };
  d.querySelector('[data-cancel]')?.addEventListener('click', () => { d.close(); d.remove(); });
  return d;
};
window.confirmDlg = (title) => { window.confirmTitles.push(title); };
SUC.init({ render: () => {}, S, dialog: window.dialog, confirm: window.confirmDlg, hashNext: () => '', visOpts: [] });
CLM.init({ render: () => {}, S, dialog: window.dialog });
window.paint = (fam) => SUC.paintSettings(fam);
</script></body></html>`;

const base = { family: 'duong', my_role: 'editor', inactive_months: 12, months_choices: [3, 6, 12], max_contacts: 3, handover: null,
  can_report: false, can_confirm: false, can_cancel: false, can_object: false, can_back: false, can_claim: true, reclaim: null,
  owner_banner: false, is_owner: false, contacts: [], chain: [] };
const ABANDONED = { ...base, family_state: 'abandoned', claim_path: 'claim', claim_notice_days: 30 };
const OWNED = { ...base, family_state: 'owned', claim_path: 'succession' };

async function harness(t, succ) {
  const { base: url, srv } = await startWeb();
  t.after(() => srv.close());
  const browser = await launch();
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const page = await ctx.newPage();
  const calls = [];
  await page.route(`${url}/succ-stub.html`, (r) => r.fulfill({ contentType: 'text/html', body: STUB }));
  await page.route('**/api/**', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path: u.pathname, body });
    const out = u.pathname.endsWith('/succession') ? succ : { ok: true, id: 7, notice_until: Date.now() + 30 * 864e5, abandoned: true };
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.goto(`${url}/succ-stub.html`);
  await page.waitForFunction(() => window.SUC && window.CLM);
  await page.evaluate(() => window.paint('duong'));
  await page.waitForSelector('#succ-settings');
  return { page, calls };
}

test('abandoned family: one entry explains the path and opens the claim sheet (evidence, notice, approval)', { skip }, async (t) => {
  const h = await harness(t, ABANDONED);
  const claimBtn = h.page.locator('[data-succ="claim"]');
  await claimBtn.waitFor();
  const line = await h.page.locator('#succ-settings .sub', { hasText: 'quản trị ứng dụng duyệt' }).count();
  assert.equal(line, 1, 'the one-liner says which path applies');
  await claimBtn.click();
  await h.page.waitForSelector('dialog.dlg textarea[name="evidence"]');
  const title = await h.page.textContent('dialog.dlg h2');
  assert.match(title, /Nhận quản lý/);
  await h.page.fill('dialog.dlg textarea[name="evidence"]', 'Cháu nội đời thứ ba, có sổ gia phả cũ.');
  await h.page.click('dialog.dlg button:not([data-cancel])');
  await h.page.waitForSelector('dialog.dlg', { state: 'detached' }).catch(() => {});
  const post = h.calls.find((c) => c.method === 'POST' && c.path === '/api/claims');
  assert.ok(post, 'the sheet sends the claim');
  assert.match(post.body.evidence, /sổ gia phả/);
  assert.equal(h.calls.filter((c) => c.path === '/api/families/duong/claim').length, 0, 'no succession call for an abandoned family');
  if (process.env.GP_SHOT_FILE) {
    await h.page.goto(h.page.url()); // reload the stub, then the entry alone
    await h.page.evaluate(() => window.paint('duong'));
    await h.page.waitForSelector('[data-succ="claim"]');
    await h.page.screenshot({ path: process.env.GP_SHOT_FILE, fullPage: false });
  }
});

test('owned family: the same entry takes the succession path (confirm, no claim sheet)', { skip }, async (t) => {
  const h = await harness(t, OWNED);
  const claimBtn = h.page.locator('[data-succ="claim"]');
  await claimBtn.waitFor();
  const line = await h.page.locator('#succ-settings .sub', { hasText: 'quản trị ứng dụng duyệt' }).count();
  assert.equal(line, 0, 'no claim-path explanation on an owned family');
  await claimBtn.click();
  await h.page.waitForFunction(() => window.confirmTitles.length > 0);
  assert.deepEqual(await h.page.evaluate(() => window.confirmTitles), ['Xin nhận quyền Chủ họ?']);
  assert.equal(await h.page.locator('dialog.dlg textarea[name="evidence"]').count(), 0, 'no evidence sheet');
});
