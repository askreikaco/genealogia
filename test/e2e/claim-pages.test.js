// e2e: Nhận quản lý in web/js/claim.js against a mocked API (no database): the banner on an unowned tree (Nhận quản lý),
// the claim sheet (evidence, sent with the file-less body), the notice banner with Rút đơn, the join sheet (Kết nối cây
// của tôi: two pickers, one link sent), and the app-admin review screen (approve only after the notice, reject needs a
// reason). Screenshots at 390 px, light and dark, into GP_SHOT_DIR when set.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');

const STUB = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/listui.css"></head>
<body><main id="main" tabindex="-1"></main><script type="module">
import * as CLM from '/js/claim.js';
window.CLM = CLM;
const S = { familyName: (f) => (f === 'duong' ? 'Họ Dương' : 'Họ Thử'), followedFams: () => ['duong', 'mine-tree'], roleIn: (f) => (f === 'mine-tree' ? 'owner' : 'guest'), signedIn: () => true };
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
CLM.init({ render: () => {}, S, dialog: window.dialog }); CLM.wire();
</script></body></html>`;

const UNOWNED = { state: 'unowned', owners: 0, can_claim: true, block: null, notice: null, my_claim: null, days: 30 };
const NOTICE = { state: 'unowned', owners: 0, can_claim: false, block: null, notice: { until: Date.now() + 12 * 86400e3, days_left: 12, abandoned: false, count: 1 },
  my_claim: { id: 5, notice_until: Date.now() + 12 * 86400e3 }, days: 30 };

async function harness(t, { theme = 'light', api }) {
  const { base, srv } = await startWeb();
  t.after(() => srv.close());
  const browser = await launch();
  t.after(() => browser.close());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme });
  const page = await ctx.newPage();
  const calls = [];
  await page.route(`${base}/claim-stub.html`, (r) => r.fulfill({ contentType: 'text/html', body: STUB }));
  await page.route('**/api/**', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), path: u.pathname, search: u.search, body });
    const out = api(req.method(), u.pathname + u.search, body);
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.goto(`${base}/claim-stub.html`);
  await page.waitForFunction(() => window.CLM);
  return { page, calls, shot: async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${theme}.png`), fullPage: true }); } };
}

test('unowned tree: the banner offers Nhận quản lý; the sheet asks for evidence and sends it; the notice shows Rút đơn', { skip }, async (t) => {
  for (const theme of ['light', 'dark']) {
    const h = await harness(t, { theme, api: (m, p, b) => {
      if (m === 'GET' && p.startsWith('/api/claims')) return UNOWNED;
      if (m === 'POST' && p.startsWith('/api/claims?')) return { ok: true, id: 9, notice_until: Date.now() + 30 * 86400e3, abandoned: false };
      return {};
    } });
    await h.page.evaluate(() => CLM.decorate(document.getElementById('main'), { fam: 'duong' }));
    await h.page.waitForSelector('.claim-banner [data-claim-open]');
    const banner = await h.page.textContent('.claim-banner');
    assert.ok(banner.includes('Chưa có Chủ họ quản lý') && banner.includes('Cây này chỉ để xem'), 'read-only reference wording');
    assert.ok(banner.includes('Kết nối cây của tôi'), 'join action shows for a signed-in person');
    await h.shot('claim-banner-unowned');
    await h.page.click('[data-claim-open]');
    await h.page.waitForSelector('dialog.dlg[open]');
    assert.ok((await h.page.textContent('dialog.dlg')).includes('30 ngày'), 'the sheet says the notice is 30 days');
    await h.shot('claim-sheet');
    await h.page.click('dialog.dlg button:has-text("Nộp đơn")');
    assert.strictEqual(h.calls.filter((c) => c.method === 'POST').length, 0, 'no evidence and no file: nothing sent, the sheet stays');
    assert.match(await h.page.textContent('[data-err]'), /bằng chứng/, 'the sheet says what is missing');
    await h.page.fill('dialog.dlg textarea[name=evidence]', 'Sổ gia phả bản chép tay, trang 3');
    await h.page.click('dialog.dlg button:has-text("Nộp đơn")');
    await h.page.waitForFunction(() => !document.querySelector('dialog.dlg[open]'));
    const post = h.calls.find((c) => c.method === 'POST');
    assert.ok(post, 'a claim was sent');
    assert.match(post.search, /family=duong/);
    assert.deepStrictEqual(post.body, { evidence: 'Sổ gia phả bản chép tay, trang 3', file: null });
  }
});

test('notice banner: days left, the public notice, Rút đơn for the claimant (no claim button while open)', { skip }, async (t) => {
  for (const theme of ['light', 'dark']) {
    const h = await harness(t, { theme, api: (m, p) => {
      if (m === 'GET' && p.startsWith('/api/claims')) return NOTICE;
      if (m === 'POST' && p.endsWith('/withdraw')) return { ok: true };
      return {};
    } });
    await h.page.evaluate(() => CLM.decorate(document.getElementById('main'), { fam: 'duong' }));
    await h.page.waitForSelector('.claim-banner [data-claim-withdraw]');
    const text = await h.page.textContent('.claim-banner');
    assert.ok(text.includes('Đang góp ý công khai') && text.includes('còn 12 ngày'), 'public notice with days left');
    assert.strictEqual(await h.page.locator('[data-claim-open]').count(), 0, 'no second claim while one is open');
    await h.shot('claim-notice-banner');
    await h.page.click('[data-claim-withdraw]');
    await h.page.waitForFunction(() => document.body.textContent.includes('Đã rút đơn'));
    assert.ok(h.calls.some((c) => c.method === 'POST' && c.path === '/api/claims/5/withdraw'), 'withdraw posts to the claim');
  }
});

test('join sheet: pick a person of my tree and one of this tree, the link is sent with both', { skip }, async (t) => {
  const h = await harness(t, { theme: 'light', api: (m, p) => {
    if (m === 'GET' && p.startsWith('/api/claims')) return UNOWNED;
    if (m === 'GET' && p.startsWith('/api/links/search')) return p.includes('family=mine-tree') ? { items: [{ id: 'P10', name: 'Hồ Thị Mai', years: '1950' }] } : { items: [{ id: 'P20', name: 'Hồ Thị Mai', years: '' }] };
    if (m === 'POST' && p === '/api/links') return { ok: true, id: 3, status: 'pending' };
    return {};
  } });
  await h.page.evaluate(() => CLM.decorate(document.getElementById('main'), { fam: 'duong' }));
  await h.page.waitForSelector('[data-join-open]');
  await h.page.click('[data-join-open]');
  await h.page.waitForSelector('dialog.dlg[open]');
  await h.page.fill('[data-pick="person"] [data-pick-q]', 'Mai');
  await h.page.click('[data-pick-id="P10"]');
  await h.page.fill('[data-pick="other_person"] [data-pick-q]', 'Mai');
  await h.page.click('[data-pick-id="P20"]');
  await h.shot('claim-join-sheet');
  await h.page.click('dialog.dlg button:has-text("Gửi đề nghị")');
  await h.page.waitForFunction(() => !document.querySelector('dialog.dlg[open]'));
  const post = h.calls.find((c) => c.method === 'POST' && c.path === '/api/links');
  assert.deepStrictEqual({ family: post.body.family, person: post.body.person, other_family: post.body.other_family, other_person: post.body.other_person },
    { family: 'mine-tree', person: 'P10', other_family: 'duong', other_person: 'P20' });
});

test('app-admin review: approve is off until the notice ends, approve posts; reject needs a reason', { skip }, async (t) => {
  for (const theme of ['light', 'dark']) {
    const until = Date.now() + 5 * 86400e3;
    const data = { now: Date.now(), links: [{ id: 3, from_family: 'Họ Hồ', from_person: 'Hồ Thị Mai', to_family: 'Họ Dương', to_person: 'Dương Thị Mai', proposed_by: 'a@x.t', created_at: new Date().toISOString(), reason: 'cùng tên' }],
      claims: [
        { id: 1, family_id: 'duong', family_name: 'Họ Dương', claimant_name: 'Dương Văn An', claimant_email: 'an@x.t', evidence: 'Sổ gia phả bản chép tay', abandoned: false, status: 'notice', tree_state: 'unowned', created_ms: Date.now() - 25 * 86400e3, until, ready: false, file: { name: 'so.pdf', mime: 'application/pdf', size: 1000 } },
        { id: 2, family_id: 'vuong', family_name: 'Họ Vương', claimant_name: 'Vương Thị Bình', claimant_email: 'binh@x.t', evidence: 'Giấy báo tử của chủ họ cũ', abandoned: true, status: 'notice', tree_state: 'abandoned', created_ms: Date.now() - 40 * 86400e3, until: Date.now() - 86400e3, ready: true, file: null },
      ] };
    const h = await harness(t, { theme, api: (m, p, b) => {
      if (m === 'GET' && p === '/api/app/claims') return data;
      if (m === 'POST' && p.endsWith('/approve')) return { ok: true, role: 'owner' };
      if (m === 'POST' && p.endsWith('/reject')) return { ok: true };
      return {};
    } });
    await h.page.evaluate(() => CLM.reviewPage(document.getElementById('main')));
    await h.page.waitForSelector('[data-admin-approve="2"]');
    assert.strictEqual(await h.page.isDisabled('[data-admin-approve="1"]'), true, 'before the notice ends: approve is off');
    assert.strictEqual(await h.page.isDisabled('[data-admin-approve="2"]'), false, 'after the notice: approve is on');
    await h.shot('admin-review');
    await h.page.click('[data-admin-approve="2"]');
    await h.page.waitForSelector('dialog.dlg[open]');
    await h.page.click('dialog.dlg button:has-text("Duyệt")');
    await h.page.waitForFunction(() => !document.querySelector('dialog.dlg[open]'));
    assert.ok(h.calls.some((c) => c.method === 'POST' && c.path === '/api/app/claims/2/approve'), 'approve posted');
    await h.page.click('[data-admin-reject="1"]');
    await h.page.waitForSelector('dialog.dlg[open]');
    await h.page.click('dialog.dlg button:has-text("Từ chối đơn")');
    assert.strictEqual(h.calls.filter((c) => c.path === '/api/app/claims/1/reject').length, 0, 'no reason: nothing sent');
    await h.page.fill('dialog.dlg textarea[name=reason]', 'Bằng chứng chưa đủ');
    await h.page.click('dialog.dlg button:has-text("Từ chối đơn")');
    await h.page.waitForFunction(() => !document.querySelector('dialog.dlg[open]'));
    const rej = h.calls.find((c) => c.path === '/api/app/claims/1/reject');
    assert.deepStrictEqual(rej.body, { reason: 'Bằng chứng chưa đủ' });
    assert.strictEqual(h.calls.filter((c) => c.path === '/api/links/3/accept').length, 0, 'the link is not decided by this step');
  }
});
