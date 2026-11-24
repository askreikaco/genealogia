// Pure logic (no DB, no express): field rules, privacy filter, op merge. Tested in test/core.test.js.
'use strict';

// Editable fields. type: text | int | enum. Anything else in an op is rejected.
const FIELDS = {
  name: 'text', surname: 'text', given: 'text', name_order: { enum: ['', 'family_first', 'given_first'] }, thu: 'text', sex: { enum: ['m', 'f', ''] }, gen: 'int', parent: 'text', order: 'num',
  birth_date: 'text', birth_lunar: 'text', birth_place: 'text', death_date: 'text',
  spouse: 'text', spouse_of: 'text', spouse_n: 'int', other_parent: 'text', born: 'text', died: 'text', death_lunar: 'text', gio_lunar: 'text',
  place: 'text', alias: 'text', title_name: 'text', job: 'text', religion: 'text', married: 'text',
  burial: 'text', photo: 'text', phone: 'text', email: 'text', address: 'text', facebook: 'text',
  zalo: 'text', social: 'text', contact_public: { enum: ['', 'yes', 'no'] },
  living: { enum: ['', 'living', 'dead', 'unknown'] }, note: 'text', verify: 'text', source: 'text',
  lat: 'text', lon: 'text', geo_precision: { enum: ['', 'exact', 'approx', 'province'] },
};
const DELETE = '_deleted';
const CONTACT = ['phone', 'email', 'address', 'facebook', 'zalo', 'social'];
const MAX_TEXT = 5000;
const MAX_SKEW = 5 * 60 * 1000;

function isDead(d) {
  return d.living === 'dead' || !!(d.died || d.death_lunar || d.gio_lunar);
}

// What an anonymous visitor sees. Contacts of living people stay private unless marked public.
// opts.flag: when a living person's contacts are hidden, say so with has_contact: true (a boolean, never a value),
// so the profile can show the Liên hệ card with a sign-in prompt. Only the persons API asks for it.
function publicView(d, opts = {}) {
  const out = { ...d };
  delete out.has_contact;
  const showContact = d.contact_public === 'yes' && !isDead(d);
  if (!showContact) {
    if (opts.flag && !isDead(d) && CONTACT.some((k) => d[k])) out.has_contact = true;
    for (const k of CONTACT) delete out[k];
  }
  delete out.birth_date; delete out.birth_lunar; delete out.death_date; // public sees the YEARS only; full dates for signed-in family members
  if (isDead(d)) for (const k of CONTACT) delete out[k];
  return out;
}

function validateValue(field, v) {
  const t = FIELDS[field];
  if (!t) return `unknown field ${field}`;
  if (v === null || v === '') return null;
  if (t === 'int') return Number.isInteger(v) ? null : `${field} must be an integer`;
  if (t === 'num') return Number.isFinite(v) ? null : `${field} must be a number`;
  if (t === 'text') return typeof v === 'string' && v.length <= MAX_TEXT ? null : `${field} must be text <= ${MAX_TEXT}`;
  if (t.enum) return t.enum.includes(v) ? null : `${field} must be one of ${t.enum.join(', ')}`;
  return null;
}

function validateOp(op) {
  if (!op || typeof op !== 'object') return 'op must be an object';
  if (typeof op.op_id !== 'string' || !op.op_id || op.op_id.length > 80) return 'op_id required';
  if (typeof op.id !== 'string' || !/^P\d{3,6}$|^N[0-9a-z-]{6,40}$/.test(op.id)) return 'bad person id';
  if (!op.fields || typeof op.fields !== 'object') return 'fields required';
  const keys = Object.keys(op.fields);
  if (!keys.length || keys.length > 40) return 'fields: 1..40 keys';
  for (const k of keys) {
    if (k === DELETE) { if (typeof op.fields[k] !== 'boolean') return '_deleted must be boolean'; continue; }
    const err = validateValue(k, op.fields[k]);
    if (err) return err;
  }
  return null;
}

// Newest-wins per field. Returns the changes to apply and the new clocks.
function mergeOp(row, op, now = Date.now()) {
  const ts = Math.min(Number(op.ts) || now, now + MAX_SKEW);
  const data = { ...(row?.data || {}) };
  const fieldTs = { ...(row?.field_ts || {}) };
  let deleted = row?.deleted || false;
  const changes = [];
  for (const [k, v] of Object.entries(op.fields)) {
    if ((fieldTs[k] || 0) > ts) continue; // a newer write already won
    if (k === DELETE) {
      if (deleted !== v) changes.push({ field: k, old: deleted, new: v });
      deleted = v; fieldTs[k] = ts; continue;
    }
    const old = data[k] ?? null;
    const val = v === '' ? null : v;
    if (JSON.stringify(old) !== JSON.stringify(val)) changes.push({ field: k, old, new: val });
    if (val === null) delete data[k]; else data[k] = val;
    fieldTs[k] = ts;
  }
  return { data, fieldTs, deleted, changes };
}

module.exports = { FIELDS, CONTACT, DELETE, isDead, publicView, validateValue, validateOp, mergeOp };
