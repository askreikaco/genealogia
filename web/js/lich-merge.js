// Pure helpers for Lịch and Tin họ (no DOM, no imports): the merged list, the top news cards, the tab badge and the
// old #gio address. Used by web/js/app.js and web/js/news.js; tested in server/test/news.test.js.
export const VIEW_ALIAS = { gio: 'lich' }; // old #gio addresses go to Lịch
export const canonicalView = (v) => VIEW_ALIAS[v] || v;

// Local midnight of a YYYY-MM-DD day, as ms.
export const dayMs = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

// One list: giỗ rows (kind 'gio') and gatherings (kind 'gath'), sorted by date; on the same day the giỗ comes first.
// kind: 'all' | 'gio' | 'gath' (the chips). Each row needs { id, at } (ms).
export function mergeLich(gios, gatherings, kind = 'all') {
  const rank = { gio: 0, gath: 1 };
  return [...gios.map((x) => ({ ...x, k: 'gio' })), ...gatherings.map((x) => ({ ...x, k: 'gath' }))]
    .filter((x) => kind === 'all' || x.k === kind)
    .sort((a, b) => a.at - b.at || rank[a.k] - rank[b.k] || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
}

// The top of Lịch: pinned posts and unread ones (created after `seen`), pinned first, then newest. At most n.
export function topNews(posts, seen = 0, n = 2) {
  const t = (p) => Date.parse(p.created_at) || 0;
  return posts.filter((p) => p.pinned || t(p) > seen)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || t(b) - t(a)).slice(0, n);
}

// Tab badge: unread posts plus gatherings within 7 days (today included). todayMs = local midnight of today.
export function badgeCount(posts, seen, todayMs) {
  const unread = posts.filter((p) => (Date.parse(p.created_at) || 0) > seen).length;
  const soon = posts.filter((p) => p.kind === 'gathering' && p.starts_at)
    .filter((p) => { const d = dayMs(p.starts_at); return d >= todayMs && d <= todayMs + 7 * 864e5; }).length;
  return unread + soon;
}
