'use strict';
// The person form against a mocked API: the people, the account and role, and the writes sent (log.ops, log.suggest,
// log.logout). Used by form-*.test.js; each file calls setBase() with the static server it started.

// Family: Ông Tổ (đời 5) -> Dương Văn Cha (đời 6, two children from the seed + one of 3 dated siblings)
const P = (id, data) => ({ id, deleted: false, v: 1, data: { gen: 1, ...data } });
const PERSONS = [
  P('PR', { name: 'Ông Tổ', sex: 'm', gen: 5, thu: '1', order: 0 }),
  P('PA', { name: 'Dương Văn Cha', sex: 'm', gen: 6, thu: '1', parent: 'PR', order: 1, born: '1925' }),
  P('SA', { name: 'Bà Vợ', sex: 'f', spouse_of: 'PA', spouse_n: 1, order: 9 }),
  P('K1', { name: 'Dương Văn Một', sex: 'm', gen: 7, thu: '1', parent: 'PA', order: 2, born: '1950' }),
  P('K2', { name: 'Dương Văn Hai', sex: 'm', gen: 7, thu: '2', parent: 'PA', order: 3, born: '1955', birth_place: 'Củ Chi' }),
  P('K3', { name: 'Dương Thị Ba', sex: 'f', gen: 7, thu: '3', parent: 'PA', order: 4, born: '1960' }),
];
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };

let base = '';
const setBase = (b) => { base = b; };

async function open(browser, opts) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: opts.viewport || { width: 390, height: 844 }, colorScheme: opts.scheme || 'light', deviceScaleFactor: 2 });
  if (opts.init) await ctx.addInitScript(opts.init);
  return { ...(await openIn(ctx, opts)), ctx };
}
async function openIn(ctx, { role, path: hash, persons = PERSONS, personsDelay = 0, rel, events, ready = '#fpform, .fp-form, main h1' }) {
  const page = await ctx.newPage();
  const log = { ops: [], suggest: [], errors: [], logout: 0, personsServed: 0 };
  page.on('pageerror', (e) => log.errors.push(e.message));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//, (r) => r.abort()); // no internet here: fonts fail fast
  await page.route('**/api/**', (route, req) => {
    if (log.offline) return route.abort('internetdisconnected');
    const p = new URL(req.url()).pathname; const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (p === '/api/me') return json({ editor: null, role, status: role === 'guest' ? null : 'active', person_id: null, email: role === 'guest' ? null : 'tester@test.local', name: 'Tester', google: false, roles: role === 'guest' ? {} : { duong: role }, acct: role === 'guest' ? null : 'g-test', accounts: role === 'guest' ? 0 : 1 });
    if (p === '/api/accounts') return json({ max: 5, active: role === 'guest' ? null : 'g-test', items: role === 'guest' ? [] : [{ key: 'g-test', kind: 'google', email: 'tester@test.local', name: 'Tester', initial: 'T', active: true, memberships: [{ role, family: { id: 'duong', slug: 'duong', name: 'Họ Dương', han: '楊' } }] }] });
    if (p.startsWith('/api/families/')) return json(FAM);
    // like the server: rows with a version above the cursor (every row is version 1 unless a test bumps it)
    if (p === '/api/persons') {
      const since = Number(new URL(req.url()).searchParams.get('since')) || 0; const rows = persons.filter((x) => (x.v || 1) > since);
      // rel (optional): the family's relation rows as the server gives them ({ source: 'table', parent_child, couple })
      const body = JSON.stringify({ items: rows, next_since: rows.length ? Math.max(...rows.map((x) => x.v || 1)) : since, ...(rel ? { rel } : {}) });
      // personsDelay: the answer waits (a slow network); the page must already show what it has on this device
      const answer = () => { log.personsServed++; route.fulfill({ status: 200, contentType: 'application/json', body }).catch(() => {}); };
      if (personsDelay) return setTimeout(answer, personsDelay);
      return answer();
    }
    if (p === '/api/ops') { const b = req.postDataJSON(); log.ops.push(...b.ops); return json({ applied: b.ops.map((o) => o.op_id), rejected: [] }); }
    if (p === '/api/suggest') { log.suggest.push(req.postDataJSON()); return json({ id: 'S' + log.suggest.length, receipt: 'R'.repeat(32) }); }
    if (p === '/api/events') return json(events || {}); // a person's events and stories (optional fixture)
    if (p === '/api/logout' || p === '/api/accounts/signout') { log.logout++; return json({ ok: true, active: null, accounts: 0 }); }
    if (p === '/api/me/prefs') return json({ prefs: {} });
    if (p === '/api/me/claim') return json({});
    if (p.startsWith('/api/suggestions')) return json([]);
    return json({});
  });
  await page.goto(base + '/' + hash);
  await page.waitForSelector(ready, { timeout: 8000 }).catch(() => {});
  return { page, log };
}
const names = (page) => page.$$eval('#fpform [name]', (els) => [...new Set(els.map((e) => e.name))].sort());

// The person form has one accordion left (the events section, "su"). The other sections are gone: the essentials are always
// on the page and the rare fields sit in "Thêm chi tiết" (a closed details, its fields in the DOM). So a helper that used to
// open a section now opens the fold when the section has no button, and does nothing else.
const openFold = (page) => page.evaluate(async () => {
  for (let i = 0; i < 20; i++) {
    const d = document.querySelector('#fpform [data-fp-fold] > details');
    if (!d || d.open) return;
    document.querySelector('#fpform [data-fp-fold] > details > summary').click();
    await new Promise((r) => setTimeout(r, 150));
  }
});
const expand = async (page, id) => {
  if (await page.$(`[data-acc-btn="${id}"]`)) { if ((await page.getAttribute(`[data-acc-btn="${id}"]`, 'aria-expanded')) !== 'true') await page.click(`[data-acc-btn="${id}"]`); return; }
  await openFold(page);
};
// Closed panels draw no inputs: open the rare fields (Thêm chi tiết) before the field set is read.
// (a programmatic click: the fixed save bar covers the lower headers on a phone)
const expandAll = async (page) => {
  await page.waitForSelector('#fpform', { timeout: 8000 });
  await openFold(page);
};

const wait = (page, ms) => page.waitForTimeout(ms);
async function editName(browser, text, ctxOpts = {}) {
  const s = await open(browser, { role: 'editor', path: '#sua/K2', ...ctxOpts });
  await expand(s.page, 'ten');
  await s.page.fill('input[name=name]', text);
  await s.page.waitForFunction(() => /Đã lưu nháp/.test(document.getElementById('fpstat')?.textContent || ''), null, { timeout: 5000 });
  return s;
}

module.exports = { PERSONS, FAM, setBase, open, openIn, names, expand, expandAll, editName, wait, P };
