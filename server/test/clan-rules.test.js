// Clan view rules (web/js/clan-core.js): surname of a family, clan slug, grouping by links, oldest founder first,
// paging. Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'clan-core.js')).href);

test('surname from the family name; slug without accents; compound surnames', async () => {
  const C = await load();
  assert.equal(C.familySurname('Họ Dương'), 'Dương');
  assert.equal(C.familySurname('họ Lâm Thử'), 'Lâm');
  assert.equal(C.familySurname('Dòng họ Trần'), 'Trần');
  assert.equal(C.familySurname('Gia phả họ Võ'), 'Võ');
  assert.equal(C.familySurname('Dương tộc Bến Thử'), 'Dương');
  assert.equal(C.familySurname('Họ Âu Dương'), 'Âu Dương');
  assert.equal(C.familySurname(''), '');
  assert.equal(C.clanSlug('Dương'), 'duong');
  assert.equal(C.clanSlug('Âu Dương'), 'au-duong');
  assert.equal(C.clanSlug('Đỗ'), 'do');
  assert.equal(C.clanHref('Họ Đặng'), '#ho/dang');
  assert.equal(C.clanHref(''), '');
});

test('groups: connected trees together, oldest founder first; shared counts; unlinked trees apart', async () => {
  const C = await load();
  const trees = [
    { id: 'a', label: 'Cây A', year: 1820, people: 10 }, { id: 'b', label: 'Cây B', year: 1760, people: 20 },
    { id: 'c', label: 'Cây C', year: null, people: 5 }, { id: 'd', label: 'Cây D', year: 1900, people: 1 },
    { id: 'e', label: 'Cây E', year: 1700, people: 2 }, { id: 'f', label: 'Cây F', year: 1950, people: 3 },
  ];
  const edges = [{ a: 'a', b: 'b', n: 2 }, { a: 'b', b: 'c', n: 1 }, { a: 'd', b: 'f', n: 4 }, { a: 'a', b: 'zz', n: 9 }];
  const g = C.groupTrees(trees, edges);
  assert.deepEqual(g.groups.map((x) => x.trees.map((t) => t.id)), [['b', 'a', 'c'], ['d', 'f']], 'groups by oldest founder; unknown year last');
  assert.deepEqual(g.unlinked.map((t) => t.id), ['e']);
  assert.equal(g.groups[0].trees.find((t) => t.id === 'b').shared, 3);
  assert.equal(g.groups[0].trees.find((t) => t.id === 'a').shared, 2, 'an edge to a tree not in the list is ignored');
  assert.equal(g.groups[0].people, 35);
});

test('pages: groups first, then unlinked trees; page clamped', async () => {
  const C = await load();
  const groups = Array.from({ length: 3 }, (_, i) => ({ trees: [], label: 'g' + i }));
  const unlinked = Array.from({ length: 4 }, (_, i) => ({ id: 'u' + i }));
  const p1 = C.pageOf({ groups, unlinked }, 1, 5);
  assert.equal(p1.groups.length, 3); assert.deepEqual(p1.unlinked.map((t) => t.id), ['u0', 'u1']);
  assert.equal(p1.pages, 2); assert.equal(p1.total, 7);
  const p2 = C.pageOf({ groups, unlinked }, 2, 5);
  assert.equal(p2.groups.length, 0); assert.deepEqual(p2.unlinked.map((t) => t.id), ['u2', 'u3']);
  assert.equal(C.pageOf({ groups, unlinked }, 99, 5).page, 2);
  assert.equal(C.pageOf({ groups, unlinked }, 'x', 5).page, 1);
});

test('clan membership: "Họ X" stays in clan X whatever its country (diaspora); VN or unset stays in; a non-"Họ" family of another country does not', async () => {
  const C = await load();
  // a diaspora branch named "Họ Dương" with country US is in clan duong, and its clan link is shown
  assert.equal(C.inClan('Họ Dương', 'US'), true);
  assert.equal(C.clanHref('Họ Dương', 'US'), '#ho/duong');
  assert.equal(C.clanHref('Họ Dương', 'us'), '#ho/duong');
  assert.equal(C.clanHref('Họ Dương', 'JP'), '#ho/duong');
  // a reference tree of Japan named after an imperial house is not in clan hoang
  assert.equal(C.clanSlug(C.familySurname('Hoàng tộc Nhật Bản (tham khảo)')), 'hoang');
  assert.equal(C.inClan('Hoàng tộc Nhật Bản (tham khảo)', 'JP'), false);
  assert.equal(C.clanHref('Hoàng tộc Nhật Bản (tham khảo)', 'JP'), '');
  assert.equal(C.clanHref('Hoàng tộc Nhật Bản (tham khảo)', 'jp'), '');
  // a Vietnamese family is in its clan
  assert.equal(C.inClan('Hoàng tộc Nhật Bản', 'VN'), true);
  assert.equal(C.inClan('Họ Hoàng', 'vn'), true);
  assert.equal(C.clanHref('Họ Hoàng', 'VN'), '#ho/hoang');
  // a family with no country set stays in (null, empty, undefined)
  assert.equal(C.inClan('Hoàng tộc Nhật Bản', null), true);
  assert.equal(C.inClan('Hoàng tộc Nhật Bản', ''), true);
  assert.equal(C.inClan('Hoàng tộc Nhật Bản'), true);
  assert.equal(C.clanHref('Họ Hoàng', null), '#ho/hoang');
  assert.equal(C.clanHref('Họ Hoàng'), '#ho/hoang');
});
