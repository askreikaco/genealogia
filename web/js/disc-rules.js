// "Thêm chi tiết" (progressive disclosure in forms): the pure rules, no DOM. ui.js (moreFold with { disc: true },
// discRefresh) reads the fields and uses these to build the closed summary and to decide when a fold opens by itself.

// The closed summary: the parts that hold a value, joined with " · " ("Âm lịch 15/8 · 2 ảnh · 1 nguồn"). Empty parts are left out.
export const discSummary = (parts) => parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(' · ');
// One field's part: "Âm lịch 15/8" (label + value), or the value alone without a label; '' when the value is empty.
export const discPart = (label, value) => {
  const v = String(value ?? '').trim();
  return v ? (label ? `${label} ${v}` : v) : '';
};
// A count of rows as a part: "2 ảnh"; '' for none.
export const discCount = (n, unit) => (n > 0 ? `${n} ${unit}` : '');
// Whether any hidden field holds a value (a string, or a list of rows): such a fold opens when the record is edited.
export const discHasValue = (values) => values.some((v) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== ''));
