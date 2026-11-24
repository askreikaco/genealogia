// The name a family shows on chips, filter tags and family rows (clan step 1, plans/261124-match-link.md).
// The owner's short name (Tên ngắn) when set; else, when another family in view has the same name, the name with its
// quê gốc (or place): "Dương · An Lạc"; else the name without "Họ". Plain ES module, no imports (unit-tested in Node).
export const bareName = (name) => String(name || '').replace(/^họ\s+/iu, '').trim();
export function familyLabelOf(meta, peers = []) {
  const m = meta || {};
  const short = String(m.short_name || '').trim();
  if (short) return short;
  const base = bareName(m.name);
  const where = String(m.origin_place || m.place || '').trim();
  const dup = peers.some((o) => o && o.id !== m.id && bareName(o.name).toLowerCase() === base.toLowerCase());
  return dup && where ? `${base} · ${where}` : base;
}
