'use strict';
// The hidden-controls audit: the routes, the mocked people and account for each role, and the in-page check that finds
// an interactive element which is in the DOM but invisible. Used by hidden-controls-*.test.js.
const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PERSONS = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 2, born: '1950' }),
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };
const ROUTES = ['', 'tree', 'list', 'person/PA', 'gio', 'verify', 'map', 'stats', 'settings', 'export', 'more', 'review',
  'members', 'join', 'mine', 'tim-dong-ho', 'cai-dat-dong-ho', 'nguoi-ke-nhiem', 'vai-tro', 'doi-chi', 'sua/K1', 'them'];
// Succession and create-family pages are not about one family: they are opened without the /duong/ prefix below.
const FREE_ROUTES = ['#lap-gia-pha', '#offer/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '#trusted/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'];

let base = '';
const setBase = (b) => { base = b; };

async function openPage(browser, role, hash) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort());
  await page.route('**/api/**', (route, req) => {
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role, status: role === 'guest' ? null : 'active', person_id: null, email: role === 'guest' ? null : 't@test.local', name: 'Tester', google: false, roles: role === 'guest' ? {} : { duong: role } });
    if (p.startsWith('/api/families/')) return json(FAM);
    if (p === '/api/persons') { const since = new URL(req.url()).searchParams.get('since'); return json(since === '0' ? { items: PERSONS, next_since: 1 } : { items: [], next_since: Number(since) }); }
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + (hash.startsWith('#') ? '/' + hash : '/#/duong/' + hash));
  await page.waitForFunction(() => !/Đang tải/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}

// Interactive elements that are not rendered visibly, outside closed dialogs. Collapsed form sections draw no inputs
// until opened, so there is no disclosure allowlist.
const AUDIT = () => {
  const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab]';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('dialog:not([open])')) continue;
    // a file picker is a hidden input inside its visible label (the label is the control, a button): not an invisible control.
    // The person form draws its photo picker inside Thêm chi tiết (a closed details keeps its fields in the DOM).
    if (el.matches('input[type=file]') && el.closest('label') && getComputedStyle(el.closest('label')).display !== 'none') continue;
    let hidden = false;
    for (let a = el; a && !hidden; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden') hidden = true; }
    if (hidden) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}"`);
  }
  return out;
};

module.exports = { PERSONS, FAM, ROUTES, FREE_ROUTES, setBase, openPage, AUDIT };
