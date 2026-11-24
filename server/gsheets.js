// Minimal Google Sheets REST client: service-account JWT (domain-wide delegation, impersonated user), no dependencies.
'use strict';
const fs = require('fs');
const crypto = require('crypto');

// drive scope: the service account's domain-wide delegation grants drive (Sheets API accepts it)
const SCOPE = 'https://www.googleapis.com/auth/drive';
let cached = null;

async function token({ keyFile, subject }) {
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, sub: subject, scope: SCOPE, aud: key.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(body).sign(key.private_key, 'base64url');
  const r = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${body}.${sig}` }),
  });
  if (!r.ok) throw new Error(`google token HTTP ${r.status}`);
  const j = await r.json(); cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 }; return cached.token;
}

function client(opts) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${opts.spreadsheetId}`;
  const call = async (path, init = {}) => {
    const r = await fetch(base + path, { ...init, headers: { authorization: `Bearer ${await token(opts)}`, 'content-type': 'application/json', ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`sheets HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  const q = (s) => encodeURIComponent(`'${opts.sheet}'!${s}`);
  return {
    read: () => call(`/values/${q('A1:AZ5000')}?valueRenderOption=FORMATTED_VALUE`).then((j) => j.values || []),
    // updates: [{range:'A2:AG2', values:[[...]]}]
    write: (updates) => updates.length ? call('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: updates.map((u) => ({ range: `'${opts.sheet}'!${u.range}`, values: u.values })) }) }) : null,
    append: (rows) => rows.length ? call(`/values/${q('A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: 'POST', body: JSON.stringify({ values: rows }) }) : null,
  };
}
const colName = (n) => { let s = ''; n += 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

module.exports = { client, colName };
