// Service worker: sw.js runs in a stub worker global. The install step must cache the shell without throwing: every
// listed path has to exist (the real cache.addAll rejects on a 404, which stops the worker from installing).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', '..', 'web');
const SW = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');

// Runs sw.js with stubs; returns the captured install handler's promise, the cache calls and the shell.
function loadWorker() {
  const listeners = {};
  const calls = { opened: [], added: null, skipWaiting: 0 };
  const exists = (urlPath) => {
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    return fs.existsSync(path.join(WEB, rel)) && fs.statSync(path.join(WEB, rel)).isFile();
  };
  const cache = {
    addAll: async (list) => {
      calls.added = list.slice();
      const missing = list.filter((p) => !exists(p));
      if (missing.length) throw new TypeError('Request failed: ' + missing.join(', ')); // as the real addAll
    },
  };
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { calls.skipWaiting++; return Promise.resolve(); },
    clients: { claim: () => Promise.resolve() },
  };
  const caches = { open: async (name) => { calls.opened.push(name); return cache; }, keys: async () => [], delete: async () => true, match: async () => undefined };
  const ctx = { self, caches, location: { origin: 'https://giapha.test' }, URL, Promise, console };
  vm.createContext(ctx);
  vm.runInContext(SW + '\n;globalThis.__SHELL = SHELL;', ctx);
  return { listeners, calls, shell: ctx.__SHELL, self };
}

test('sw.js: the shell is a list of paths, and install caches it without throwing', async () => {
  const w = loadWorker();
  assert.ok(Array.isArray(w.shell) && w.shell.length > 10);
  assert.ok(w.shell.every((p) => typeof p === 'string' && p.startsWith('/')));
  let pending = null;
  w.listeners.install({ waitUntil: (p) => { pending = p; } });
  await pending; // rejects if any path is missing
  assert.deepStrictEqual(w.calls.opened, [/const V = '([^']+)'/.exec(SW)[1]], 'cache name is the version');
  assert.deepStrictEqual(w.calls.added, w.shell, 'addAll gets the whole shell');
  assert.strictEqual(w.calls.skipWaiting, 1, 'the new worker takes over');
});

test('sw.js: the shell lists every app module, stylesheet and page the app loads', () => {
  const { shell } = loadWorker();
  const jsFiles = fs.readdirSync(path.join(WEB, 'js')).filter((f) => f.endsWith('.js')).map((f) => '/js/' + f);
  for (const f of jsFiles) assert.ok(shell.includes(f), `missing from SHELL: ${f}`);
  const kinFiles = ['engine.js', 'index.js', ...fs.readdirSync(path.join(WEB, 'js', 'kin', 'packs')).map((f) => 'packs/' + f)].map((f) => '/js/kin/' + f);
  for (const f of kinFiles) assert.ok(shell.includes(f), `missing from SHELL: ${f}`);
  for (const f of ['/app.css', '/book.css', '/fields.css', '/index.html', '/book.html', '/manifest.webmanifest', '/icon.svg']) {
    assert.ok(shell.includes(f), `missing from SHELL: ${f}`);
  }
});

test('sw.js: every shell path exists on disk (a missing file would fail install)', () => {
  const { shell } = loadWorker();
  for (const p of shell) {
    const rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
    assert.ok(fs.existsSync(path.join(WEB, rel)), `no such file: web/${rel}`);
  }
});

test('sw.js: skip-waiting message activates a waiting worker; a first install does not wait', async () => {
  const w = loadWorker();
  w.listeners.message({ data: { type: 'skip-waiting' } });
  assert.strictEqual(w.calls.skipWaiting, 1, 'the message calls skipWaiting');
  w.listeners.message({ data: 'other' });
  assert.strictEqual(w.calls.skipWaiting, 1, 'other messages are ignored');
});
