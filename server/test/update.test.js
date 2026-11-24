// App update notice (web/js/update.js): version compare, the updater's rules, and that BUILD matches the sw.js cache name.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', '..', 'web');
// update.js has no imports: strip the export keywords and run it in a sandbox.
function loadUpdate() {
  const src = fs.readFileSync(path.join(WEB, 'js', 'update.js'), 'utf8').replace(/^export /gm, '');
  const ctx = { console, Number, String, RegExp, Error };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.M = { isNewer, buildLabel, createUpdater, BUILD };', ctx);
  return ctx.M;
}
const M = loadUpdate();
const NEXT = 'gp-9.9.9'; // a release newer than the one in use (BUILD is the gp-dev placeholder on master)

test('isNewer: numeric build suffix compares as a number', () => {
  assert.strictEqual(M.isNewer('gp-v37', 'gp-v38'), true);
  assert.strictEqual(M.isNewer('gp-v37', 'gp-v37'), false);
  assert.strictEqual(M.isNewer('gp-v38', 'gp-v37'), false, 'an older build is not an update');
  assert.strictEqual(M.isNewer('gp-v9', 'gp-v10'), true, 'not a string compare');
  assert.strictEqual(M.isNewer('gp-v37', null), false);
  assert.strictEqual(M.isNewer(undefined, 'gp-v37'), false);
});

test('isNewer: strings without a number count as newer when they differ', () => {
  assert.strictEqual(M.isNewer('abc', 'def'), true);
  assert.strictEqual(M.isNewer('abc', 'abc'), false);
});

test('isNewer: releases compare by X.Y.Z; a release beats an old numbered build', () => {
  assert.strictEqual(M.isNewer('gp-1.80.3', 'gp-1.80.4'), true);
  assert.strictEqual(M.isNewer('gp-1.80.9', 'gp-1.81.0'), true, 'minor beats patch');
  assert.strictEqual(M.isNewer('gp-1.81.0', 'gp-1.9.0'), false, 'not a string compare');
  assert.strictEqual(M.isNewer('gp-2.0.0', 'gp-1.99.9'), false);
  assert.strictEqual(M.isNewer('gp-1.80.0', 'gp-1.80.0'), false);
  assert.strictEqual(M.isNewer('gp-v79', 'gp-1.80.0'), true, 'users still on the numbered scheme get the first release');
  assert.strictEqual(M.isNewer('gp-1.80.0', 'gp-v79'), false, 'an old numbered build is never an update');
  assert.strictEqual(M.isNewer('gp-dev', 'gp-1.80.0'), true, 'dev build: any release is newer');
});

test('buildLabel: "Phiên bản 1.80.3" (the BUILD without "gp-"); "Phiên bản dev" on master', () => {
  assert.strictEqual(M.buildLabel('gp-1.80.3'), 'Phiên bản 1.80.3');
  assert.strictEqual(M.buildLabel('gp-dev'), 'Phiên bản dev');
  assert.strictEqual(M.buildLabel(''), '—');
});

test('BUILD and the cache name: placeholder on master, the same value in both files', () => {
  assert.strictEqual(M.BUILD, 'gp-dev', 'master carries the placeholder; the deploy stamps gp-X.Y.Z');
  const sw = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
  assert.strictEqual(/const V = '([^']+)'/.exec(sw)[1], 'gp-dev');
});


// A fake browser for the updater: the server's version, idle state, the notice and the apply calls.
function harness({ serverV = M.BUILD, idle = true, t0 = 1_000_000, store = {} } = {}) {
  const h = { serverV, idle, t: t0, store, shown: [], applied: 0, fetchFail: false };
  h.u = M.createUpdater({
    build: M.BUILD,
    fetchVersion: async () => { if (h.fetchFail) throw new Error('offline'); return { v: h.serverV }; },
    isIdle: () => h.idle,
    applyNow: () => { h.applied++; },
    showNotice: (on) => h.shown.push(on),
    store: { get: (k) => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } },
    now: () => h.t,
  });
  return h;
}

test('updater: the same build is no update', async () => {
  const h = harness();
  const r = await h.u.check('open');
  assert.strictEqual(r.newer, false);
  assert.strictEqual(h.applied, 0);
  assert.deepStrictEqual(h.shown, []);
});

test('updater: a newer build found while the app is open shows the notice (no reload by itself)', async () => {
  const h = harness({ serverV: NEXT, idle: true });
  await h.u.check('detect');
  assert.deepStrictEqual(h.shown, [true]);
  assert.strictEqual(h.applied, 0, 'found while open: notice only');
});

test('updater: coming back to an idle app applies the update', async () => {
  const h = harness({ serverV: NEXT, idle: true });
  await h.u.check('visible');
  assert.strictEqual(h.applied, 1);
  assert.strictEqual(h.store['gp-upd-since'], '', 'the pending mark is cleared');
});

test('updater: a manual check applies when idle, and only shows the notice when not idle', async () => {
  const idle = harness({ serverV: NEXT, idle: true });
  await idle.u.check('manual');
  assert.strictEqual(idle.applied, 1);
  const busy = harness({ serverV: NEXT, idle: false });
  await busy.u.check('manual');
  assert.strictEqual(busy.applied, 0, 'unsaved changes or a dialog: never auto-reload');
  assert.deepStrictEqual(busy.shown, [true]);
});

test('updater: a pending update is applied on the first idle moment a day after it was found', async () => {
  const h = harness({ serverV: NEXT, idle: false });
  await h.u.check('detect'); // found while busy: notice
  assert.strictEqual(h.applied, 0);
  h.idle = true; h.t += 23 * 60 * 60 * 1000;
  await h.u.decide('detect');
  assert.strictEqual(h.applied, 0, 'under a day: still waits for a quiet moment that is not a periodic check');
  h.t += 2 * 60 * 60 * 1000; // now 25 h after it was found
  await h.u.decide('detect');
  assert.strictEqual(h.applied, 1, 'at least once a day');
});

test('updater: a failed version check changes nothing', async () => {
  const h = harness({ serverV: NEXT });
  h.fetchFail = true;
  const r = await h.u.check('manual');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(h.applied, 0);
  assert.deepStrictEqual(h.shown, []);
});

test('updater: a store that throws (private window) still works', async () => {
  const h = M.createUpdater({
    build: M.BUILD, fetchVersion: async () => ({ v: NEXT }), isIdle: () => true,
    applyNow: () => { h.applied = (h.applied || 0) + 1; }, showNotice: () => {},
    store: { get: () => { throw new Error('denied'); }, set: () => { throw new Error('denied'); } }, now: () => 0,
  });
  await h.check('visible');
  assert.strictEqual(h.applied, 1);
});
