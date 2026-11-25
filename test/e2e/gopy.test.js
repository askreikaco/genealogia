// E2E: one "Góp ý" page. Reviewers (admin/owner) get two tabs, Cần duyệt (N) and Của tôi; #gop-y opens Cần duyệt when
// something waits, else Của tôi. Cần duyệt is a compact list: one shared person row per suggestion with ✓ / ✕ beside it,
// identical duplicates collapse into "×N", a person with several rows gets a header, tap a row to expand its fields,
// "Chọn nhiều" for bulk. Members see only their own, without tabs; #review sends them to #mine. Thêm groups: Xem ·
// Dòng họ · Ứng dụng. Mocked API, no database.
//   NODE_PATH=<dir with playwright> [GP_E2E_CHROME=/usr/bin/google-chrome] [GP_SHOT_DIR=dir] node --test test/e2e/gopy.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { skip, launch, startWeb, SHOTS } = require('./_e2e-harness');

const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PERSONS = [P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }), P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('PB', { name: 'Dương Thị Hai', sex: 'f', gen: 6, thu: '2', parent: 'PR', order: 2, born: '1928' })];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };
const mineSug = (id, status, extra = {}) => ({ id, status, person_id: 'PA', is_new: false, person_name: 'Dương Văn Cha', changes: { job: 'Thợ may' },
  note: 'Góp ý thử', by_name: 'Khách', by_contact: '', created_at: '2026-11-20T08:00:00.000Z', reviewed_by: null, reviewed_at: null, reason: null, ...extra });
const rv = (id, person, name, changes, by = 'Khách') => ({ id, status: 'pending', person_id: person, is_new: false, person_name: name,
  changes: changes.map(([field, current, proposed]) => ({ field, status: 'clean', current, proposed })), note: 'Góp ý thử', by_name: by, by_contact: '',
  created_at: '2026-11-20T08:00:00.000Z', reviewed_by: null, reviewed_at: null, reason: null });
// PA: two identical suggestions (collapse ×2) + one other; PB: one suggestion with two fields
const LONG_NOTE = 'Ông Cha đi lính năm 1945, về quê năm 1954, sau đó dời nhà lên Hóc Môn rồi xuống Củ Chi làm ruộng. Gia đình còn giữ giấy khai sinh cũ và tờ gia phả chép tay năm 1960 do bác cả giữ, có ghi tên các con và ngày giỗ. Tôi xin gửi ảnh chụp sau để đối chiếu.';
const ITEMS = [rv(100, 'PA', 'Dương Văn Cha', [['job', '', 'Thợ may']]), rv(101, 'PA', 'Dương Văn Cha', [['job', '', 'Thợ may']]),
  rv(102, 'PA', 'Dương Văn Cha', [['place', 'Củ Chi', 'Huế']], 'Cô Ba'), { ...rv(103, 'PB', 'Dương Thị Hai', [['job', '', 'Giáo viên'], ['place', '', 'Hóc Môn']], 'Chú Tư'), note: LONG_NOTE }];

let base; let srv;
test.before(async () => { if (skip) return; const w = await startWeb(); srv = w.srv; base = w.base; });
test.after(() => { srv?.close(); });

async function open(b, { role, hash, items = ITEMS, scheme = 'light' }) {
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, colorScheme: scheme });
  const page = await ctx.newPage(); const errors = []; const calls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const u = new URL(req.url()); const p = u.pathname;
    if (req.method() === 'POST' && /^\/api\/suggestions\/\d+\/(approve|reject)$/.test(p)) calls.push([p, req.postDataJSON?.() || null]);
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/me') return json({ editor: null, role, status: 'active', person_id: null, email: 't@test.local', name: 'Tester', google: false, roles: { duong: role } });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') { const since = u.searchParams.get('since'); return json(since === '0' ? { items: PERSONS, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p === '/api/suggestions/mine') return json({ items: [mineSug(9, 'pending'), mineSug(8, 'rejected', { reason: 'Thiếu nguồn' }), mineSug(7, 'pending', { note: LONG_NOTE })] });
    if (p === '/api/suggestions') return json({ items: u.searchParams.get('status') === 'pending' ? items : [], counts: { pending: items.length } });
    return json({});
  });
  await page.goto(base + '/#/duong/' + hash);
  await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  return { ctx, page, errors, calls };
}
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name), fullPage: true }) : null);
const famRows = (page) => page.locator('section.mg', { has: page.locator('.mg-h', { hasText: 'Dòng họ' }) }).locator('.calm').allTextContents();

test('reviewer: #gop-y opens Cần duyệt (N); compact rows, ×2 duplicates, person header, expand; Của tôi; Thêm groups', { skip }, async () => {
  const b = await launch();
  try {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page, errors } = await open(b, { role: 'admin', hash: 'gop-y', scheme });
      await page.waitForURL(/#(\/duong\/)?review$/);
      // a sync may redraw the page once after the first paint: wait until the list is drawn and stays drawn
      await page.waitForFunction(() => document.querySelectorAll('#rlist .rv').length === 3 && document.querySelector('#rlist .rv-ph'));
      await page.waitForTimeout(400);
      await page.waitForFunction(() => document.querySelectorAll('#rlist .rv').length === 3 && document.querySelector('#rlist .rv-ph'));
      // the list is redrawn on every store sync: wait for the sync to settle before the counts below
      await page.waitForFunction(() => document.querySelector('#sync')?.textContent.includes('Đã đồng bộ'), null, { timeout: 15000 });
      const tabs = page.locator('.gopy-tabs [role=tab]');
      assert.equal((await tabs.nth(0).textContent()).trim(), 'Cần duyệt (4)');
      assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true');
      assert.equal((await page.textContent('#cbtitle')).trim(), 'Góp ý');
      assert.equal((await page.textContent('#rcount')).trim(), '', 'no count line without a filter');
      assert.equal(await page.locator('#rlist .rv-ph').count(), 1, 'one person header (Dương Văn Cha has 2 rows)');
      assert.match(await page.locator('#rlist .rv[data-ids="100,101"]').innerText(), /×2/, 'identical duplicates collapse');
      assert.match(await page.locator('#rlist .rv[data-ids="102"]').innerText(), /Nơi sống: Củ Chi → Huế/);
      assert.match(await page.locator('#rlist .rv[data-ids="103"]').innerText(), /Nghề, Nơi sống/);
      // notes: a normal note is its own line in full; a long one is clamped to 3 lines with "Xem thêm"
      const n102 = page.locator('#rlist .rv[data-ids="102"] .rv-nt');
      assert.equal((await n102.textContent()).trim(), '“Góp ý thử”');
      assert.equal(await n102.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== 'ellipsis' && getComputedStyle(el).whiteSpace !== 'nowrap'), true, 'normal note not cut');
      assert.equal(await page.locator('#rlist .rv[data-ids="102"] .rv-xm').count(), 0);
      assert.equal(await page.locator('#rlist .rv[data-ids="103"] .rv-nt.rv-clamp').evaluate((el) => getComputedStyle(el).webkitLineClamp), '3');
      assert.equal((await page.locator('#rlist .rv[data-ids="103"] .rv-xm').textContent()).trim(), 'Xem thêm');
      // every row: the row button and ✓ / ✕ are siblings (no nested interactive elements)
      assert.equal(await page.locator('#rlist .calm-row button.calm button').count(), 0);
      assert.equal(await page.locator('#rlist [data-rv="approve"]').count(), 3);
      // expand: single field = no checkbox; two fields = checkboxes
      await page.click('#rlist .rv[data-ids="102"] [data-rvx]');
      assert.equal(await page.locator('#rvm-102').isVisible(), true);
      assert.equal(await page.locator('#rvm-102 input[data-clean]').count(), 0, 'one field: no checkbox');
      await page.click('#rlist .rv[data-ids="103"] [data-rvx]');
      assert.equal(await page.locator('#rvm-103 input[data-clean]').count(), 2, 'two fields: checkboxes');
      await page.click('#rlist .rv[data-ids="103"] [data-rvx]');
      await page.click('#rlist .rv[data-ids="102"] [data-rvx]');
      await shot(page, `gopy-review-390-${scheme}.png`);
      await tabs.nth(1).click();
      await page.waitForURL(/#(\/duong\/)?mine$/);
      await page.waitForFunction(() => /Thiếu nguồn/.test(document.getElementById('mlist2')?.innerText || ''));
      const longCard = page.locator('.mcard[data-mid="7"]');
      assert.equal(await longCard.locator('.rv-note.rv-clamp').count(), 1, 'Của tôi: long note clamped');
      await longCard.locator('[data-note-more]').click();
      assert.equal(await longCard.locator('.rv-clamp').count(), 0, 'Xem thêm shows the whole note');
      assert.equal(await page.locator('.mcard[data-mid="9"] [data-note-more]').count(), 0, 'short note: no Xem thêm');
      await shot(page, `gopy-mine-390-${scheme}.png`);
      await page.goto(base + '/#/duong/more');
      await page.waitForSelector('.mg-g');
      assert.deepStrictEqual(await page.$$eval('.mg-h', (els) => els.map((e) => e.textContent.trim())), ['Xem', 'Dòng họ', 'Ứng dụng'], 'groups by intent');
      const fr = await famRows(page);
      // Dòng họ order for an admin (editor): Tìm / lập, Nhập danh bạ (contacts import, editors only), Góp ý with count, Thành viên, ...
      assert.ok(/Tìm \/ lập dòng họ/.test(fr[0]) && /Nhập danh bạ/.test(fr[1]) && /Góp ý/.test(fr[2]) && /4/.test(fr[2]) && fr.some((t) => /Thành viên & quyền/.test(t)), 'Dòng họ: Tìm / lập dòng họ first, Nhập danh bạ for editors, then Góp ý with count, Thành viên for admins');
      assert.ok(!(await page.locator('main .calm').allTextContents()).some((t) => /Duyệt đóng góp|Góp ý của tôi/.test(t)), 'old rows gone');
      await shot(page, `gopy-more-390-${scheme}.png`);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally { await b.close(); }
});

test('reviewer: ✓ approves (duplicates closed as Trùng); ✕ rejects with an optional reason; Chọn nhiều bulk-approves', { skip }, async () => {
  const b = await launch();
  try {
    const { ctx, page, errors, calls } = await open(b, { role: 'owner', hash: 'review' });
    await page.waitForFunction(() => document.querySelectorAll('#rlist .rv').length === 3);
    await page.click('#rlist .rv[data-ids="100,101"] [data-rv="approve"]');
    await page.waitForFunction(() => true);
    for (let i = 0; i < 40 && calls.length < 2; i++) await page.waitForTimeout(100);
    assert.deepStrictEqual(calls.map((c) => c[0]), ['/api/suggestions/100/approve', '/api/suggestions/101/reject']);
    assert.match(calls[1][1].reason, /Trùng/);
    calls.length = 0;
    await page.waitForFunction(() => document.querySelectorAll('#rlist .rv').length === 3);
    await page.click('#rlist .rv[data-ids="102"] [data-rv="reject"]');
    await page.fill('dialog input[name=reason]', 'Chưa có nguồn');
    await page.click('dialog .btn.dng');
    for (let i = 0; i < 40 && !calls.length; i++) await page.waitForTimeout(100);
    assert.deepStrictEqual(calls, [['/api/suggestions/102/reject', { reason: 'Chưa có nguồn' }]]);
    calls.length = 0;
    await page.waitForFunction(() => document.querySelector('[data-rvbulk="on"]'));
    await page.click('[data-rvbulk="on"]');
    await page.check('#rlist .rv[data-ids="102"] [data-rvsel]');
    await page.check('#rlist .rv[data-ids="103"] [data-rvsel]');
    assert.equal((await page.textContent('[data-rvbulk="approve"]')).trim(), 'Duyệt (2)');
    await shot(page, 'gopy-review-bulk-390-light.png');
    await page.click('[data-rvbulk="approve"]');
    for (let i = 0; i < 40 && calls.length < 2; i++) await page.waitForTimeout(100);
    assert.deepStrictEqual(calls.map((c) => c[0]).sort(), ['/api/suggestions/102/approve', '/api/suggestions/103/approve']);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('reviewer with nothing waiting: #gop-y opens Của tôi', { skip }, async () => {
  const b = await launch();
  try {
    const { ctx, page, errors } = await open(b, { role: 'owner', hash: 'gop-y', items: [] });
    await page.waitForURL(/#(\/duong\/)?mine$/);
    assert.equal((await page.locator('.gopy-tabs [role=tab]').nth(0).textContent()).trim(), 'Cần duyệt');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  } finally { await b.close(); }
});

test('member: only Của tôi, no tabs; old #review link goes to #mine; Thêm Dòng họ has Góp ý, no Thành viên', { skip }, async () => {
  const b = await launch();
  try {
    for (const hash of ['review', 'gop-y', 'mine']) {
      const { ctx, page, errors } = await open(b, { role: 'member', hash });
      await page.waitForURL(/#(\/duong\/)?mine$/);
      await page.waitForFunction(() => /Thiếu nguồn/.test(document.getElementById('mlist2')?.innerText || ''));
      assert.equal(await page.locator('.gopy-tabs').count(), 0, 'no tabs for a member');
      assert.equal((await page.textContent('#cbtitle')).trim(), 'Góp ý');
      if (hash === 'mine') {
        await page.goto(base + '/#/duong/more'); await page.waitForSelector('.mg-g');
        const fr = await famRows(page);
        assert.ok(/Tìm \/ lập dòng họ/.test(fr[0]) && /Góp ý/.test(fr[1]) && !fr.some((t) => /Thành viên & quyền/.test(t)), 'member: Tìm / lập dòng họ, then Góp ý, no Thành viên');
        await shot(page, 'gopy-more-member-390-light.png');
      }
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  } finally { await b.close(); }
});
