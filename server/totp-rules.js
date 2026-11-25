// Two-step sign-in rules (no database): TOTP per RFC 6238 (HMAC-SHA1, 6 digits, 30 s step, one step either side),
// the secret sealed at rest (AES-256-GCM), recovery codes (scrypt-hashed, single use) and the attempt window.
// Used by totp-routes.js; unit-tested in test/totp-rules.test.js.
'use strict';
const crypto = require('crypto');

const STEP_MS = 30e3; // RFC 6238 time step
const DIGITS = 6;
const WINDOW = 1; // the step before and the step after now are accepted too (clock drift)
const ATTEMPTS = 5; // failed code attempts per account in one window
const ATTEMPT_WIN_MS = 10 * 60e3;
const RECOVERY_N = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0, O, 1, I, L: easy to read aloud and type
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ---- base32 (RFC 4648, no padding in what we emit) ----
function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0; let value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[\s=]/g, '')) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('base32: bad character');
    value = ((value << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 255); }
  }
  return Buffer.from(out);
}

// ---- RFC 4226 HOTP and RFC 6238 TOTP ----
function hotp(key, counter) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(c).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}
const stepOf = (ms) => Math.floor(ms / STEP_MS);
// The step a code is valid for: the codes accepted at time ms are those of steps stepOf(ms) - WINDOW .. + WINDOW.
// lastStep: a step already used (signed in or confirmed) is refused, so one code signs in once. Returns the step or null.
function matchStep(key, code, nowMs = Date.now(), lastStep = 0) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = stepOf(nowMs);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const s = cur + d;
    if (s <= Number(lastStep) || s < 0) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(c))) return s;
  }
  return null;
}
const newSecret = () => crypto.randomBytes(20);
// What an authenticator app reads from the QR code (otpauth URI, RFC-style labels, SHA1 / 6 / 30 s are the defaults).
function otpauthUri({ secret, account, issuer }) {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${base32Encode(secret)}`
    + `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_MS / 1000}`;
}

// ---- sealing the secret at rest: AES-256-GCM, key = HKDF(SESSION_SECRET). null key when the secret is too short. ----
function deriveKey(sessionSecret) {
  const s = String(sessionSecret || '');
  if (s.length < 32) return null;
  return Buffer.from(crypto.hkdfSync('sha256', s, Buffer.alloc(0), 'giapha totp secret v1', 32));
}
function seal(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
// Throws when the key is wrong or the text was changed (GCM tag check).
function open(key, text) {
  const b = Buffer.from(String(text), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

// ---- recovery codes: 10 codes, XXXX-XXXX, single use. Stored as "salt:scrypt" (never the code). ----
const normRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function newRecoveryCodes(n = RECOVERY_N) {
  return Array.from({ length: n }, () => {
    let s = '';
    for (let i = 0; i < 8; i++) s += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}
const isRecoveryShape = (s) => /^[A-Z0-9]{8}$/.test(normRecovery(s));
function hashRecovery(code) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(normRecovery(code), salt, 32).toString('hex');
}
function checkRecovery(code, stored) {
  const [s, h] = String(stored || '').split(':');
  if (!s || !h) return false;
  const got = crypto.scryptSync(normRecovery(code), Buffer.from(s, 'hex'), 32);
  const want = Buffer.from(h, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

// ---- attempts: ATTEMPTS failed codes per account per window. The window starts at the first failure. ----
function attemptsState(failCount, failAt, now = Date.now()) {
  const t = failAt ? new Date(failAt).getTime() : 0;
  const live = t > 0 && now - t < ATTEMPT_WIN_MS;
  const n = live ? Number(failCount) || 0 : 0;
  return { blocked: n >= ATTEMPTS, count: n, until: live ? t + ATTEMPT_WIN_MS : 0 };
}

module.exports = {
  STEP_MS, DIGITS, WINDOW, ATTEMPTS, ATTEMPT_WIN_MS, RECOVERY_N, base32Encode, base32Decode, hotp, matchStep, newSecret, otpauthUri,
  deriveKey, seal, open, newRecoveryCodes, normRecovery, isRecoveryShape, hashRecovery, checkRecovery, attemptsState,
};
