// e2e: the chooser (Nhập nhầm, Đề nghị gỡ), the vote card (Đồng ý, Không đồng ý with a reason) and the banner on a person's
// page, run from web/js/council.js against a mocked API. Screenshots at 390 px, light and dark, into GP_SHOT_DIR when set.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');

const STUB = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/listui.css"></head><body><main id="main" tabindex="-1"></main><script type="module">import * as C from '/js/council.js'; window.C = C;</script></body></html>`;
const DEC = (over = {}) => ({ id: 7, kind: 'remove_person', label: 'Gỡ khỏi gia phả', state: 'open', subject_ref: 'P1', subject_name: 'Nguyễn Văn Lan',
  reason: 'Không thuộc dòng họ', opened_by: 'a@x.t', days_left: 5, voters: 3, voted: 1, solo: false, need: '2/3',
  result: null, mine: null, is_voter: true, is_requester: false, ballot: 'open',
  bar: { n: 3, voted: 1, pending: 2, voted_pct: 100 / 3, pending_pct: 200 / 3 },
  groups: { voted: [{ name: 'Quản trị e2e', role: 'admin', reason: null }], pending: [{ name: 'Chủ họ e2e', role: 'owner', reason: null }, { name: 'Quản trị thứ hai', role: 'admin', reason: null }] },
  ...over });

async function harness(t, { theme = 'light', api }) {
  const { base, srv } = await startWeb();
  t.after(() => srv.close());
  const browser = await launch();
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: theme });
  const page = await ctx.newPage();
  const calls = [];
  await page.route(`${base}/council-stub.html`, (r) => r.fulfill({ contentType: 'text/html', body: STUB }));
  await page.route('**/api/**', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path: u.pathname, body });
    const out = api(req.method(), u.pathname, body);
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.goto(`${base}/council-stub.html`);
  await page.waitForFunction(() => window.C);
  return { page, calls, shot: async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `stub-${name}-${theme}.png`) }); } };
}

test('chooser: two ways, each with its help; Nhập nhầm is off with its reason; Đề nghị gỡ asks for a reason', { skip }, async (t) => {
  for (const theme of ['light', 'dark']) {
    const h = await harness(t, { theme, api: (m, p) => (m === 'GET' ? { name: 'Nguyễn Văn Lan', quick: { ok: false, why: 'too-old' }, impact: {}, voters: 3, solo: false, decision: null } : { ok: true, decision: DEC() }) });
    await h.page.evaluate(() => C.openRemoval({ p: { id: 'P1' }, fam: 'duong', onDone() {} }));
    await h.page.waitForSelector('dialog.dcs[open]');
    const text = await h.page.textContent('dialog.dcs');
    for (const s of ['Đề nghị gỡ', 'Chủ họ và Quản trị biểu quyết trong 7 ngày']) assert.ok(text.includes(s), s);
    assert.strictEqual(await h.page.locator('[data-dcs-quick]').count(), 0, 'the fast path is hidden when not eligible');
    assert.ok(!text.includes('Không dùng được') && !text.includes('Nhập nhầm'), 'no disabled card, no reason text');
    await h.shot('council-chooser');
    // the vote: the reason is required
    await h.page.fill('[data-dcs-vote] textarea', 'Không thuộc dòng họ');
    await h.page.click('[data-dcs-vote] button[type=submit]');
    await h.page.waitForFunction(() => !document.querySelector('dialog.dcs[open]'));
    const vote = h.calls.find((c) => c.method === 'POST');
    assert.deepStrictEqual(vote.body, { kind: 'vote', reason: 'Không thuộc dòng họ' });
    assert.match(vote.path, /\/api\/persons\/P1\/removal$/);
  }
});

test('vote card: Đồng ý records a YES; Không đồng ý needs a reason before it is sent', { skip }, async (t) => {
  for (const theme of ['light', 'dark']) {
    const h = await harness(t, { theme, api: (m) => (m === 'GET' ? { decisions: [DEC()] } : { ok: true, decision: DEC({ mine: 'yes' }) }) });
    await h.page.evaluate(() => C.decisionsPage(document.getElementById('main'), { fam: 'duong' }));
    await h.page.waitForSelector('[data-dec-yes="7"]');
    await h.shot('vote-card');
    await h.page.click('[data-dec-nobox="7"]');
    assert.strictEqual(await h.page.isVisible('[data-dec-noform="7"]'), true);
    await h.page.click('[data-dec-noform="7"] button[type=submit]');
    assert.strictEqual(h.calls.filter((c) => c.method === 'POST').length, 0, 'no reason, nothing sent');
    await h.page.fill('[data-dec-noform="7"] textarea', 'Chưa đủ bằng chứng');
    await h.page.click('[data-dec-noform="7"] button[type=submit]');
    await h.page.waitForFunction(() => document.body.textContent.includes('Đã ghi phiếu'));
    const no = h.calls.find((c) => c.method === 'POST');
    assert.deepStrictEqual(no.body, { choice: 'no', reason: 'Chưa đủ bằng chứng' });
    await h.page.click('[data-dec-yes="7"]');
    await h.page.waitForFunction(() => document.body.textContent.includes('Đã ghi phiếu đồng ý'));
    assert.ok(h.calls.find((c) => c.body && c.body.choice === 'yes'), 'a yes ballot was sent');
    assert.match(h.calls.find((c) => c.body && c.body.choice === 'yes').path, /\/api\/decisions\/7\/ballot$/);
  }
});

test('banner on a person page while the removal is being voted on, with a link to Biểu quyết', { skip }, async (t) => {
  for (const theme of ['light', 'dark']) {
    const h = await harness(t, { theme, api: () => ({ decisions: [DEC({ id: 7, subject_ref: 'P1' })] }) });
    await h.page.evaluate(async () => {
      document.getElementById('main').innerHTML = '<h1>Nguyễn Văn Lan</h1><p>Thông tin</p>';
      await C.decorate('person', document.getElementById('main'), { fam: 'duong', hf: (k) => `#/duong/${k}`, personId: 'P1' });
    });
    await h.page.waitForSelector('.council-banner');
    assert.ok((await h.page.textContent('.council-banner')).includes('Đang biểu quyết · 1/3 đã bỏ phiếu · còn 5 ngày'));
    assert.strictEqual(await h.page.getAttribute('.council-banner a', 'href'), '#/duong/bieu-quyet');
    await h.shot('vote-banner-person');
  }
});
