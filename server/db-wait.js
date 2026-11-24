// Wait for Postgres at boot. After a reboot the app can start a few seconds before the database container; the
// first queries then fail with ECONNREFUSED. waitForDb retries a trivial query with backoff (0.5 s, doubling, at most
// 5 s apart) for up to totalMs, and only rethrows when the error is not a "not ready yet" one or time is up.
'use strict';
const NOT_READY_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', '57P03']); // 57P03: cannot_connect_now
const notReady = (e) => NOT_READY_CODES.has(e?.code) || /Connection terminated|the database system is (starting up|shutting down)/i.test(e?.message || '');

async function waitForDb(pool, { totalMs = 60e3, firstMs = 500, maxMs = 5e3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const t0 = now(); let wait = firstMs; let tries = 0;
  for (;;) {
    tries++;
    try { await pool.query('select 1'); return tries; } catch (e) {
      if (!notReady(e) || now() - t0 + wait > totalMs) throw e;
      await sleep(wait); wait = Math.min(wait * 2, maxMs);
    }
  }
}
module.exports = { waitForDb, notReady };
