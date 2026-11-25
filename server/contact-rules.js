// Contacts of a person as a list (plan: contacts as a list of fields). Each item: { type, value, label? }.
// type: phone | email | zalo | facebook | address | other. One list per person, written whole (newest write wins,
// see core.js mergeOp). Before the list, a person had flat fields (phone, email, zalo, facebook, address, social);
// contactsOf() reads both, so no data has to be moved for the read to work. Pure functions, no DB, no express.
'use strict';
const { z } = require('zod');

const CONTACT_TYPES = ['phone', 'email', 'zalo', 'facebook', 'address', 'other'];
const MAX_ITEMS = 12;
const MAX_VALUE = 300;
const MAX_LABEL = 40;
// Flat fields before the list, and the type each one becomes.
const LEGACY = [['phone', 'phone'], ['email', 'email'], ['zalo', 'zalo'], ['facebook', 'facebook'], ['address', 'address'], ['social', 'other']];
const LEGACY_KEYS = LEGACY.map(([k]) => k);

const PHONE_RE = /^\+?[0-9][0-9 .()\-]{4,22}[0-9]$/;
const FB_RE = /^(https?:\/\/)?((www|m|web)\.)?(facebook|fb)\.(com|me)\/[^\s]+$|^[A-Za-z0-9.\-_]{3,80}$/i;

// Per-type rules. Each returns an error message (Vietnamese, shown to the user) or null.
const RULES = {
  phone: (v) => (PHONE_RE.test(v) ? null : 'Số điện thoại chỉ gồm chữ số, dấu cách, +, ( ) hoặc -'),
  zalo: (v) => (PHONE_RE.test(v) || /^https?:\/\/(zalo\.me|id\.zalo\.me)\//i.test(v) ? null : 'Zalo: số điện thoại hoặc link zalo.me'),
  email: (v) => (z.email().safeParse(v).success ? null : 'Email không đúng dạng, ví dụ ten@example.com'),
  facebook: (v) => (FB_RE.test(v) ? null : 'Facebook: link facebook.com/... hoặc tên tài khoản'),
  address: (v) => (v.length <= 200 ? null : 'Địa chỉ tối đa 200 ký tự'),
  other: (v) => (v.length <= 200 ? null : 'Tối đa 200 ký tự'),
};

// One item. Returns { item } (trimmed and normalised) or { error }.
function checkItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'liên hệ: mỗi mục là một đối tượng' };
  const bad = Object.keys(raw).find((k) => !['type', 'value', 'label'].includes(k));
  if (bad) return { error: `liên hệ: trường không hợp lệ ${bad}` };
  if (!CONTACT_TYPES.includes(raw.type)) return { error: 'liên hệ: loại không hợp lệ' };
  if (typeof raw.value !== 'string') return { error: 'liên hệ: cần giá trị' };
  let value = raw.value.trim();
  if (!value) return { error: 'liên hệ: giá trị trống' };
  if (value.length > MAX_VALUE) return { error: `liên hệ: tối đa ${MAX_VALUE} ký tự` };
  if (raw.type === 'phone' || raw.type === 'zalo') value = value.replace(/\s+/g, ' ');
  if (raw.type === 'email') value = value.toLowerCase();
  const err = RULES[raw.type](value);
  if (err) return { error: err };
  const item = { type: raw.type, value };
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string' || raw.label.trim().length > MAX_LABEL) return { error: `liên hệ: nhãn tối đa ${MAX_LABEL} ký tự` };
    if (raw.label.trim()) item.label = raw.label.trim();
  }
  return { item };
}

// Validation of the whole list (the value written to persons.data.contacts). null when valid.
function contactsError(v) {
  if (!Array.isArray(v)) return 'contacts phải là danh sách';
  if (v.length > MAX_ITEMS) return `liên hệ: tối đa ${MAX_ITEMS} mục`;
  for (const e of v) { const r = checkItem(e); if (r.error) return r.error; }
  return null;
}

// The list as the person has it now: the list when written, else built from the flat fields (compat read).
// Empty items are dropped. Never throws on odd data.
function contactsOf(data) {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.contacts)) return data.contacts.filter((e) => e && typeof e === 'object' && CONTACT_TYPES.includes(e.type) && typeof e.value === 'string' && e.value.trim());
  const out = [];
  for (const [key, type] of LEGACY) {
    const v = typeof data[key] === 'string' ? data[key].trim() : '';
    if (!v) continue;
    out.push(type === 'other' ? { type, value: v, label: 'Mạng xã hội' } : { type, value: v });
  }
  return out;
}

// Backfill plan for one person row: null when there is nothing to move, else the new list and the flat keys to drop.
// Rows that already hold a list are left alone (the list wins on read; the flat keys are only moved once).
function backfillPlan(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data.contacts)) return null;
  const flat = LEGACY_KEYS.filter((k) => data[k] !== undefined && data[k] !== null && data[k] !== '');
  if (!flat.length) return null;
  let flagged = false;
  const list = contactsOf(data).slice(0, MAX_ITEMS).map((c) => {
    const r = checkItem(c);
    if (r.item) return r.item;
    flagged = true; // a flat value that fails the new rule is kept as an "other" item: nothing is lost by the move
    return { type: 'other', value: String(c.value).slice(0, MAX_VALUE), label: 'Liên hệ cũ' };
  });
  return { contacts: list, remove: flat, flagged };
}

module.exports = { CONTACT_TYPES, MAX_ITEMS, LEGACY_KEYS, checkItem, contactsError, contactsOf, backfillPlan };
