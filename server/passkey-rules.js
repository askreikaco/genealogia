// Passkey rules (no database): the challenge lifetime, the sign-in counter check, the last-sign-in-method guard and the
// relying party id. Used by passkey-routes.js and account-routes.js; unit-tested in test/passkey-rules.test.js.
'use strict';
const A = require('./accounts');

const CH_TTL_MS = 5 * 60e3; // a challenge is good for five minutes, once (the row is deleted when it is used)
const MAX_PASSKEYS = 10; // per account (or elder device)

// A challenge answers only before its expiry.
const challengeLive = (expiresAt, now = Date.now()) => { const t = new Date(expiresAt).getTime(); return Number.isFinite(t) && t > now; };
// The signature counter must grow. A counter that stays at 0 means the authenticator does not count: allowed.
const counterOk = (stored, next) => { const s = Number(stored) || 0; return s <= 0 || (Number(next) || 0) > s; };
// Removing a passkey is refused when it is the last way to sign in (a linked provider or another passkey counts).
// Vietnamese, shown to the person; '' when it can be removed.
function passkeyRemoveBlock(ids, passkeys) {
  return A.signInCount(ids, passkeys) - 1 < 1 ? 'Đây là cách đăng nhập duy nhất. Thêm cách khác trước khi gỡ.' : '';
}
// The relying party id: GP_PASSKEY_RP_ID when set (tests, local runs), else the host the page is served from, no port.
function rpIdFor(host, env = process.env.GP_PASSKEY_RP_ID) {
  const fromEnv = String(env || '').trim();
  return fromEnv || String(host || '').replace(/:\d+$/, '');
}

module.exports = { CH_TTL_MS, MAX_PASSKEYS, challengeLive, counterOk, passkeyRemoveBlock, rpIdFor };
