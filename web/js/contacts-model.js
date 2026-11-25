// Contacts of a person as a list: { type, value, label? }. Types, input attributes, tap targets and the list shape for the
// client. The server validates (server/contact-rules.js) and sends the list in every read (server/core.js withContacts);
// listOf() reads the flat fields too, for a record that was cached before the list. Pure, no DOM: tested in node.
export const CONTACT_TYPES = [
  { id: 'phone', label: 'Điện thoại', input: 'tel', mode: 'tel', ac: 'tel', ph: '0912 345 678' },
  { id: 'email', label: 'Email', input: 'email', mode: 'email', ac: 'email', ph: 'ten@example.com' },
  { id: 'zalo', label: 'Zalo', input: 'tel', mode: 'tel', ac: 'off', ph: 'Số điện thoại hoặc link zalo.me' },
  { id: 'facebook', label: 'Facebook', input: 'url', mode: 'url', ac: 'url', ph: 'facebook.com/...' },
  { id: 'address', label: 'Địa chỉ', input: 'text', mode: 'text', ac: 'street-address', ph: 'Số nhà, phường, tỉnh' },
  { id: 'other', label: 'Khác', input: 'text', mode: 'text', ac: 'off', ph: 'Ghi chú liên hệ' },
];
export const TYPE = Object.fromEntries(CONTACT_TYPES.map((t) => [t.id, t]));

// The flat fields the list replaces, as the server reads them (social becomes an "other" item).
const LEGACY = [['phone', 'phone'], ['email', 'email'], ['zalo', 'zalo'], ['facebook', 'facebook'], ['address', 'address'], ['social', 'other']];
export function listOf(d) {
  if (!d || typeof d !== 'object') return [];
  if (Array.isArray(d.contacts)) return d.contacts.filter((c) => c && TYPE[c.type] && typeof c.value === 'string' && c.value.trim());
  return LEGACY.filter(([k]) => typeof d[k] === 'string' && d[k].trim())
    .map(([k, type]) => (type === 'other' ? { type, value: d[k].trim(), label: 'Mạng xã hội' } : { type, value: d[k].trim() }));
}

const digits = (s) => String(s).replace(/\D/g, '');
// Where a tap on the value goes: tel:, mailto:, zalo.me, facebook. null for plain text (address, other).
export function contactHref(c) {
  const v = String(c.value || '').trim();
  if (c.type === 'phone') return `tel:${digits(v)}`;
  if (c.type === 'email') return `mailto:${v}`;
  if (c.type === 'zalo') return /^https?:\/\//i.test(v) ? v : (digits(v) ? `https://zalo.me/${digits(v)}` : null);
  if (c.type === 'facebook') return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return null;
}

// The rule the form shows under a row (mirrors server/contact-rules.js; the server decides on save). null when fine.
const PHONE_RE = /^\+?[0-9][0-9 .()\-]{4,22}[0-9]$/;
export function itemError(c) {
  const v = String(c.value || '').trim();
  if (!v) return 'Còn trống. Điền hoặc xoá dòng này.';
  if (v.length > 300) return 'Tối đa 300 ký tự.';
  if (c.type === 'phone') return PHONE_RE.test(v) ? null : 'Số điện thoại chỉ gồm chữ số, dấu cách, +, ( ) hoặc -';
  if (c.type === 'zalo') return PHONE_RE.test(v) || /^https?:\/\/(id\.)?zalo\.me\//i.test(v) ? null : 'Zalo: số điện thoại hoặc link zalo.me';
  if (c.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Email không đúng dạng, ví dụ ten@example.com';
  if (c.type === 'facebook') return /^(https?:\/\/)?((www|m|web)\.)?(facebook|fb)\.(com|me)\/\S+$|^[A-Za-z0-9.\-_]{3,80}$/i.test(v) ? null : 'Facebook: link facebook.com/... hoặc tên tài khoản';
  return null;
}
// Items as they are saved: trimmed, empty rows dropped, email lower-cased (the server does the same).
export function cleanList(items) {
  return items.filter((c) => c && TYPE[c.type] && String(c.value || '').trim())
    .map((c) => ({ type: c.type, value: c.type === 'email' ? String(c.value).trim().toLowerCase() : String(c.value).trim().replace(/\s+/g, ' ') }));
}
// Same list (for "is anything changed"): order and values.
export const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
