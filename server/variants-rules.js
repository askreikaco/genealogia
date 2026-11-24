// Conflicting data (field variants), pure rules: which fields, quality levels, value checks, and what a viewer who is
// not a member may see. No DB. Tested in test/variants-rules.test.js.
'use strict';

// Fields that can hold several sourced values, with their labels.
const VARIANT_FIELDS = { name: 'Họ tên', born: 'Năm sinh', died: 'Năm mất', birth_place: 'Nơi sinh', place: 'Nơi sống', burial: 'An táng' };
// Confidence, as the person who records it judges it (Gramps' five levels).
const QUALITY = { rat_thap: 'rất thấp', thap: 'thấp', binh_thuong: 'bình thường', cao: 'cao', rat_cao: 'rất cao' };
const MAX = 200;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
// Same value written differently (spaces, case) counts as one value.
const sameValue = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

// A new variant: returns an error text or null.
function validateVariant(b) {
  if (!b || typeof b !== 'object') return 'Thiếu nội dung.';
  if (!Object.hasOwn(VARIANT_FIELDS, b.field)) return 'Mục này chưa nhận nhiều nguồn.';
  const v = clean(b.value);
  if (!v) return 'Nhập giá trị.';
  if (v.length > MAX) return `Giá trị dài quá ${MAX} ký tự.`;
  if (!clean(b.source)) return 'Ghi nguồn (bia mộ, gia phả, lời kể của ai…).';
  if (clean(b.source).length > 300) return 'Nguồn dài quá 300 ký tự.';
  if (b.quality != null && !Object.hasOwn(QUALITY, b.quality)) return 'Độ tin cậy không hợp lệ.';
  return null;
}

// Years only for dates when the viewer is not a member (the profile shows years only to them too).
const yearOnly = (v) => { const m = /(\d{4})/.exec(String(v || '')); return m ? m[1] : clean(v); };
function viewValue(field, value, member) {
  if (member) return value;
  return field === 'born' || field === 'died' ? yearOnly(value) : value;
}

// The list one viewer gets. Each item: { id, value, source, quality, by, at, chosen }. Non-members do not see who
// recorded a value (names / emails of family members) and get years only for dates; equal values after that are
// shown once. chosen = the value the profile shows now (so a later plain edit of the field stays consistent).
function viewList(rows, current, { member }) {
  const out = []; const seen = new Set();
  for (const r of rows) {
    const value = viewValue(r.field, r.value, member);
    const key = clean(value).toLowerCase();
    if (!member && seen.has(key)) continue;
    seen.add(key);
    out.push({ id: r.id, value, source: r.source || '', quality: r.quality, by: member ? (r.by_user || '') : '', at: r.created_at, chosen: current != null && sameValue(r.value, current) });
  }
  return out;
}
// How many different values a field has, counting the profile's own value.
function distinctCount(rows, current) {
  const s = new Set(rows.map((r) => clean(r.value).toLowerCase()));
  if (clean(current)) s.add(clean(current).toLowerCase());
  return s.size;
}

module.exports = { VARIANT_FIELDS, QUALITY, clean, sameValue, validateVariant, viewValue, viewList, distinctCount, yearOnly };
