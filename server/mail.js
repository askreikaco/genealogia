// Transactional mail through Brevo (POST https://api.brevo.com/v3/smtp/email, header api-key).
// Env: BREVO_API_KEY (secret, never logged), MAIL_FROM (sender address), MAIL_FROM_NAME (default "Gia phả"),
// PUBLIC_URL (links in mail; required in production; default http://localhost:PORT for local runs).
// Without BREVO_API_KEY or MAIL_FROM nothing is sent: the attempt is logged as 'skipped' and can be sent later (sendOnce).
// Every attempt is a row in mail_log (no key, no body). Tests replace the transport with setTransport (no real sends).
'use strict';
const EMAIL_RE = /^[^\s@]{1,200}@[^\s@]{1,200}$/;
const API = 'https://api.brevo.com/v3/smtp/email';

async function brevoTransport({ apiKey, body }) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Brevo trả lỗi ${r.status}`); // the response body is not kept: it is never logged
  const j = await r.json().catch(() => ({}));
  return { messageId: j.messageId ? String(j.messageId) : null };
}
let transport = brevoTransport;
const setTransport = (fn) => { transport = fn || brevoTransport; };

const configured = () => !!(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3090}`).replace(/\/+$/, '');
// Error text without anything that could be the key (defensive: the key is not in the messages we build).
const scrub = (s) => String(s || '').split(process.env.BREVO_API_KEY || '\u0000').join('[khóa]').slice(0, 300);

// Sends one message and logs the attempt. Returns { status: 'sent' | 'skipped' | 'failed' | 'invalid' }.
async function send(pool, { familyId = null, kind, to, subject, html, text, dedupeKey = null }) {
  const addr = String(to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return { status: 'invalid' };
  const { rows } = await pool.query(
    "insert into mail_log (family_id, kind, to_email, subject, status, dedupe_key) values ($1,$2,$3,$4,'queued',$5) returning id",
    [familyId, kind, addr, subject, dedupeKey]);
  const id = rows[0].id;
  const set = (status, providerId = null, error = null) => pool.query('update mail_log set status=$2, provider_id=$3, error=$4 where id=$1', [id, status, providerId, error]);
  // .invalid is reserved (RFC 2606): no mailbox exists, so nothing is ever sent there (the QA test account uses it).
  if (addr.endsWith('.invalid')) {
    await set('skipped', null, 'miền .invalid: không gửi');
    return { status: 'skipped' };
  }
  if (!configured()) {
    const why = !process.env.BREVO_API_KEY ? 'BREVO_API_KEY chưa đặt' : 'MAIL_FROM chưa đặt';
    await set('skipped', null, why);
    return { status: 'skipped' };
  }
  const name = process.env.MAIL_FROM_NAME || 'Gia phả';
  try {
    const out = await transport({
      apiKey: process.env.BREVO_API_KEY,
      body: { sender: { email: process.env.MAIL_FROM, name }, to: [{ email: addr }], subject, htmlContent: html, textContent: text },
    });
    await set('sent', out?.messageId || null);
    return { status: 'sent' };
  } catch (e) {
    await set('failed', null, scrub(e.message));
    return { status: 'failed' };
  }
}

// Sends unless a message with this dedupe key was already sent. The message is built lazily so that a retry can
// rebuild it (for example with a fresh link token). Returns the send status, or 'duplicate'.
async function sendOnce(pool, dedupeKey, build) {
  const { rows } = await pool.query("select 1 from mail_log where dedupe_key=$1 and status='sent' limit 1", [dedupeKey]);
  if (rows.length) return { status: 'duplicate' };
  const msg = await build();
  return send(pool, { ...msg, dedupeKey });
}

module.exports = { send, sendOnce, setTransport, configured, publicUrl, EMAIL_RE };
