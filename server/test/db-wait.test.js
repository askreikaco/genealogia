// server/db-wait.js: boot waits for Postgres with backoff; a real error or a timeout still surfaces.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { waitForDb, notReady } = require('../db-wait');

// A fake pool whose first `fails` queries throw `err`; a fake clock that sleep() advances.
function fakes(fails, err) {
  let t = 0; const sleeps = []; let calls = 0;
  const pool = { query: async () => { calls++; if (calls <= fails) throw err; return { rows: [{ '?column?': 1 }] }; } };
  return { pool, sleeps, calls: () => calls, opts: { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } } };
}
const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5434'), { code: 'ECONNREFUSED' });

test('db not up yet: retries with backoff, then resolves (no error)', async () => {
  const f = fakes(4, refused);
  const tries = await waitForDb(f.pool, f.opts);
  assert.equal(tries, 5);
  assert.deepEqual(f.sleeps, [500, 1000, 2000, 4000]);
});

test('backoff is capped at 5 s between tries', async () => {
  const f = fakes(7, refused);
  await waitForDb(f.pool, f.opts);
  assert.deepEqual(f.sleeps, [500, 1000, 2000, 4000, 5000, 5000, 5000]);
});

test('db up at once: one query, no wait', async () => {
  const f = fakes(0, refused);
  assert.equal(await waitForDb(f.pool, f.opts), 1);
  assert.deepEqual(f.sleeps, []);
});

test('gives up after totalMs with the last error', async () => {
  const f = fakes(1000, refused);
  await assert.rejects(waitForDb(f.pool, { ...f.opts, totalMs: 10e3 }), /ECONNREFUSED/);
  assert.ok(f.sleeps.reduce((a, b) => a + b, 0) <= 10e3, 'never waits past totalMs');
});

test('a real error (not "not ready") is thrown at once, no retry', async () => {
  const bad = Object.assign(new Error('password authentication failed for user "x"'), { code: '28P01' });
  const f = fakes(5, bad);
  await assert.rejects(waitForDb(f.pool, f.opts), /password authentication failed/);
  assert.equal(f.calls(), 1);
});

test('notReady: refused/reset/starting up yes; auth or SQL errors no', () => {
  assert.equal(notReady(refused), true);
  assert.equal(notReady({ code: '57P03', message: 'the database system is starting up' }), true);
  assert.equal(notReady(new Error('Connection terminated unexpectedly')), true);
  assert.equal(notReady({ code: '28P01', message: 'password authentication failed' }), false);
  assert.equal(notReady({ code: '42P01', message: 'relation "x" does not exist' }), false);
  assert.equal(notReady(undefined), false);
});
