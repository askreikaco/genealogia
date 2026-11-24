'use strict';
// Shared helpers for the book browser tests: a static server for web/ and a mock API that serves the real page plan
// (web/js/bookplan.js over server/seed/demo-persons.json) and the persons of any requested ids. No database needed.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, '..', '..', 'web');
const SEED = path.join(__dirname, '..', '..', 'server', 'seed', 'demo-persons.json');
const FAM = { id: 'duong', slug: 'duong', name: 'Họ Dương', visibility: 'public' };

let lib = null;
const bookLib = async () => lib || (lib = await import(pathToFileURL(path.join(WEB, 'js', 'bookplan.js')).href));
const seedPersons = (extra = []) => [...JSON.parse(fs.readFileSync(SEED, 'utf8')), ...extra].map((p) => ({ id: p.id, v: 1, deleted: false, data: p.data }));

// The plan the server would send for this seed (same functions as server.js /api/book/outline).
// texts: { [personId]: { ev: [...], st: [...], data: {patch} } } adds life text (as the outline carries it) to seed persons.
async function seedPlan(chi = '', texts = {}, extra = []) {
  const L = await bookLib();
  return L.planBook(L.bookModel(seedPersons(extra).map((p) => ({ id: p.id, data: { ...p.data, ...(texts[p.id]?.data || {}) }, ev: texts[p.id]?.ev || [], st: texts[p.id]?.st || [] }))), chi);
}

function staticServer() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const pn = u.pathname === '/book' ? '/book.html' : u.pathname; const f = path.join(WEB, pn);
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res);
  });
}

// Routes /api/* on a page: the outline from the plan, /api/persons for ids (or 404 for anything else).
// log receives every API request as {path, ids}.
// 1x1 PNG for the family emblem in tests
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function mockApi(page, log = [], extra = {}) {
  const persons = seedPersons(extra.persons || []).map((p) => ({ ...p, data: { ...p.data, ...(extra.texts?.[p.id]?.data || {}) } })); const byId = new Map(persons.map((p) => [p.id, p]));
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/api/book/outline') {
      log.push({ path: u.pathname, ids: [] });
      const q = u.searchParams;
      const opts = { root: q.get('root') || q.get('chi') || '', dir: q.get('dir') || 'down', maxGen: Number(q.get('gen')) || 0,
        spouses: q.get('spouses') !== '0', daughters: q.get('daughters') || 'full', status: q.get('status') || 'all', layout: q.get('layout') || 'branch', orient: q.get('orient') || 'land' };
      return json(200, { family: FAM.id, name: FAM.name, han: '', role: 'guest', v: persons.length, plan: await seedPlan(opts, extra.texts || {}, extra.persons || []), emblem: !!extra.emblem });
    }
    if (u.pathname === '/api/persons') {
      const ids = (u.searchParams.get('ids') || '').split(',').filter(Boolean);
      log.push({ path: u.pathname, ids });
      const items = ids.map((id) => byId.get(id)).filter(Boolean);
      return json(200, { items, next_since: 1, role: 'guest', family: FAM.id });
    }
    if (u.pathname === '/api/families/duong/emblem' && extra.emblem) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG1 });
    log.push({ path: u.pathname, ids: [] });
    return json(404, { error: 'not mocked' });
  });
}

const FONTS = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com)\//;

module.exports = { WEB, FAM, seedPersons, seedPlan, staticServer, mockApi, FONTS };
