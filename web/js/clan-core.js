// Clan view rules shared by the server (clan-routes.js loads this module) and the web page (clan.js): the surname of
// a family, its clan slug, and the grouping of trees into connected groups through accepted "same person" links.
// Pure functions, no DOM, no database.
import { SURNAME_HAN } from './surnames-vi.js';

export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
// "Dương" -> "duong", "Âu Dương" -> "au-duong".
export const clanSlug = (surname) => fold(surname).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const PREFIX = /^(gia\s+phả\s+)?(dòng\s+)?họ\s+/iu;
// The surname of a family from its name: "Họ Dương" -> "Dương", "Dương tộc Bến Thử" -> "Dương", "Họ Âu Dương" -> "Âu Dương".
export function familySurname(name) {
  const w = String(name || '').trim().replace(PREFIX, '').split(/\s+/).filter(Boolean);
  if (w.length >= 2 && SURNAME_HAN[w[0] + ' ' + w[1]]) return w[0] + ' ' + w[1];
  return w[0] || '';
}
// Clan membership: a family is in the clan of its surname if its name starts with "Họ " (a Vietnamese clan keeps its
// diaspora branches, whatever their country), or if its country is VN or unset. "Hoàng tộc Nhật Bản" (JP) is not in hoang.
export const inClan = (familyName, country) => /^họ\s/i.test(String(familyName || '').normalize('NFC').trim())
  || !country || String(country).trim().toUpperCase() === 'VN';
export const clanHref = (familyName, country) => { if (!inClan(familyName, country)) return ''; const s = familySurname(familyName); return s ? '#ho/' + clanSlug(s) : ''; };

// Oldest founder first: founder year (unknown last), then the tree's label.
const byFounder = (a, b) => ((a.year ?? Infinity) - (b.year ?? Infinity)) || String(a.label).localeCompare(String(b.label), 'vi');

// trees: [{ id, label, year, people, ... }], edges: [{ a, b, n }] (accepted links between two trees, n = people shared).
// Returns { groups: [{ trees, year, people }], unlinked: [tree] }: a group is a connected set of 2+ trees; each tree gets
// `shared` (people it shares with the other trees of its group). Groups: oldest founder first.
export function groupTrees(trees, edges) {
  const ids = new Set(trees.map((t) => t.id));
  const up = new Map(trees.map((t) => [t.id, t.id]));
  const root = (x) => { while (up.get(x) !== x) { up.set(x, up.get(up.get(x))); x = up.get(x); } return x; };
  const shared = new Map();
  for (const e of edges) {
    if (!ids.has(e.a) || !ids.has(e.b) || e.a === e.b) continue;
    up.set(root(e.a), root(e.b));
    shared.set(e.a, (shared.get(e.a) || 0) + e.n); shared.set(e.b, (shared.get(e.b) || 0) + e.n);
  }
  const sets = new Map();
  for (const t of trees) { const r = root(t.id); if (!sets.has(r)) sets.set(r, []); sets.get(r).push({ ...t, shared: shared.get(t.id) || 0 }); }
  const groups = []; const unlinked = [];
  for (const list of sets.values()) {
    list.sort(byFounder);
    if (list.length === 1) unlinked.push(list[0]);
    else groups.push({ trees: list, year: list[0].year ?? null, label: list[0].label, people: list.reduce((s, t) => s + (t.people || 0), 0) });
  }
  groups.sort(byFounder); unlinked.sort(byFounder);
  return { groups, unlinked };
}

// One page of entries: each linked group is one entry, then each unlinked tree is one entry.
export function pageOf({ groups, unlinked }, page = 1, size = 50) {
  const total = groups.length + unlinked.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pages);
  const from = (p - 1) * size; const to = from + size;
  return {
    groups: groups.slice(from, to),
    unlinked: unlinked.slice(Math.max(0, from - groups.length), Math.max(0, to - groups.length)),
    page: p, pages, total,
  };
}
