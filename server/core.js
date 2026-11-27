// Pure logic (no DB, no express): field rules, privacy filter, op merge. Tested in test/core.test.js.
'use strict';

// Editable fields. type: text | int | enum. Anything else in an op is rejected.
const FIELDS = {
  name: 'text', surname: 'text', given: 'text', name_order: { enum: ['', 'family_first', 'given_first'] }, thu: 'text', sex: { enum: ['m', 'f', ''] }, gen: 'int', parent: 'text', order: 'num',
  birth_date: 'text', birth_lunar: 'text', birth_place: 'text', death_date: 'text',
  spouse: 'text', spouse_of: 'text', spouse_n: 'int', other_parent: 'text', born: 'text', died: 'text', death_lunar: 'text', gio_lunar: 'text',
  place: 'text', alias: 'text', name_han: 'text', title_name: 'text', job: 'text', religion: 'text', married: 'text',
  burial: 'text', photo: 'text', phone: 'text', email: 'text', address: 'text', facebook: 'text',
  zalo: 'text', social: 'text', contacts: 'contacts', contact_public: { enum: ['', 'yes', 'no'] }, // contacts: a list (contact-rules.js); the flat fields are read as before

  living: { enum: ['', 'living', 'dead', 'unknown'] }, note: 'text', verify: 'text', source: 'text',
  lat: 'text', lon: 'text', geo_precision: { enum: ['', 'exact', 'approx', 'province'] },
  names: 'names', // surname over time (surname-rules.js): a list, written whole
};
const { namesError, publicNames } = require('./surname-rules');
const { contactsError, contactsOf } = require('./contact-rules');
const DELETE = '_deleted';
// Contact data: the list and the flat fields it replaces (read compat). Hidden from guests and from the dead.
const CONTACT = ['contacts', 'phone', 'email', 'address', 'facebook', 'zalo', 'social'];
const MAX_TEXT = 5000;
const MAX_SKEW = 5 * 60 * 1000;

function isDead(d) {
  return d.living === 'dead' || !!(d.died || d.death_lunar || d.gio_lunar);
}

// What an anonymous visitor sees. Contacts of living people stay private unless marked public.
// opts.flag: when a living person's contacts are hidden, say so with has_contact: true (a boolean, never a value),
// so the profile can show the Liên hệ card with a sign-in prompt. Only the persons API asks for it.
// P1d: how a living person shows to non-members. 'private' = the placeholder (no name); 'names' = the name, sex and
// generation only (dates, photo, places, events, stories, contacts and the relations' details stay hidden).
// The person's own setting (self_visibility) wins unless it is 'inherit', then the family's (living_visibility).
const LIVING_VIS = ['private', 'names'];
const SELF_VIS = ['inherit', 'private', 'names'];
function effectiveLiving(familyVis, selfVis) {
  if (selfVis === 'private' || selfVis === 'names') return selfVis;
  return familyVis === 'names' ? 'names' : 'private';
}

// opts.living: the effective visibility from effectiveLiving(); default 'private'. Dead people ignore it.
function publicView(d, opts = {}) {
  // A living person (not isDead) is a placeholder for non-members: the tree shape stays (sex, generation and the links,
  // which come from the relation rows), but no name, years, photo, places, events, stories or contacts.
  if (!isDead(d)) { // name '' (not null): the book and labels read it as text; the client shows the label from hidden_living
    const named = opts.living === 'names';
    const out = { name: named ? (d.name || '') : '', hidden_living: true, sex: d.sex || '', gen: d.gen ?? null };
    for (const k of ['parent', 'other_parent', 'spouse_of', 'spouse_n']) if (d[k] !== undefined) out[k] = d[k]; // the links stay (tree shape)
    return out;
  }
  const out = withContacts(d);
  delete out.has_contact;
  const showContact = d.contact_public === 'yes' && !isDead(d);
  if (!showContact) {
    if (opts.flag && !isDead(d) && contactsOf(d).length) out.has_contact = true;
    for (const k of CONTACT) delete out[k];
  }
  delete out.birth_date; delete out.birth_lunar; delete out.death_date; // public sees the YEARS only; full dates for signed-in family members
  if (Array.isArray(d.names)) out.names = publicNames(d.names); // the reason and source of a change: members only
  if (isDead(d)) for (const k of CONTACT) delete out[k];
  return out;
}

// The person as the client reads it: the list (built from the flat fields when no list is written yet). Full records
// (members) and the public view both go through here, so the client sees one shape.
function withContacts(d) {
  const out = { ...d };
  const list = contactsOf(d);
  if (list.length || Array.isArray(d.contacts)) out.contacts = list; else delete out.contacts;
  return out;
}

// Tên chữ Hán (name_han): Han characters and spaces only, at most 40 characters. Same rule as web/js/formrules.js.
const MAX_HAN = 40;
const HAN_RE = /^[\p{Script=Han}\s]+$/u;
function hanNameError(v) {
  if (typeof v !== 'string') return 'name_han must be text';
  const t = v.trim();
  if (!t) return null;
  if (Array.from(t).length > MAX_HAN) return `name_han: tối đa ${MAX_HAN} ký tự`;
  if (!HAN_RE.test(t)) return 'name_han: chỉ nhập chữ Hán và dấu cách';
  return null;
}

function validateValue(field, v) {
  const t = FIELDS[field];
  if (!t) return `unknown field ${field}`;
  if (v === null || v === '') return null;
  if (t === 'int') return Number.isInteger(v) ? null : `${field} must be an integer`;
  if (t === 'num') return Number.isFinite(v) ? null : `${field} must be a number`;
  if (field === 'name_han') return hanNameError(v);
  if (t === 'names') return namesError(v);
  if (t === 'contacts') return contactsError(v);
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

module.exports = { FIELDS, CONTACT, DELETE, MAX_HAN, HAN_RE, hanNameError, isDead, publicView, effectiveLiving, LIVING_VIS, SELF_VIS, withContacts, validateValue, validateOp, mergeOp };
