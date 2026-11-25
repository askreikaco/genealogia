// Unit tests for the book page plan (web/js/bookplan.js): deterministic, consistent numbering, charts inside their boxes,
// nothing the viewer may not see. No database: uses server/seed/demo-persons.json.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let L = null;
const lib = async () => L || (L = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'bookplan.js')).href));
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'demo-persons.json'), 'utf8'));
const persons = () => SEED.map((p) => ({ id: p.id, data: JSON.parse(JSON.stringify(p.data)) }));

test('the plan is deterministic and numbered 1..N', async () => {
  const { bookModel, planBook } = await lib();
  const a = planBook(bookModel(persons()), ''); const b = planBook(bookModel(persons().reverse()), '');
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'same people in another order give another plan');
  assert.deepEqual(a.pages.map((p) => p.n), a.pages.map((_, i) => i + 1));
  assert.ok(a.pages.length >= 20 && a.pages.length <= SEED.length, `page count ${a.pages.length}`);
  assert.equal(a.pages[0].kind, 'cover');
  assert.equal(a.pages[1].kind, 'lead');
});

test('a person code takes its own line in the entry height; a person without one is unchanged', async () => {
  const { bookModel, entryHeight } = await lib();
  const id = SEED[0].id; const other = SEED[1].id;
  const base = bookModel(persons());
  const coded = bookModel(persons().map((p) => (p.id === id ? { ...p, data: { ...p.data, sid: 'K7Q29MV' } } : p)));
  const at = (M, pid) => entryHeight(M, M.all.find((p) => p.id === pid));
  const grow = at(coded, id) - at(base, id);
  assert.ok(grow > 0 && grow < 20, `one code line (${grow.toFixed(1)} px)`);
  assert.equal(at(coded, other), at(base, other), 'no code, no extra height');
});

test('table of contents points at pages of the right kind', async () => {
  const { bookModel, planBook } = await lib();
  const plan = planBook(bookModel(persons()), '');
  assert.equal(plan.toc[0][0], 'Lời đầu sách');
  assert.equal(plan.toc[0][1], 2);
  for (const [label, n] of plan.toc) assert.ok(plan.pages[n - 1], 'toc page missing for ' + label);
  const openers = plan.pages.filter((p) => p.kind === 'opener').length;
  assert.equal(openers, plan.branches.length, 'one opener page per branch');
});

test('charts fit their boxes and every cut box names a page that charts its branch', async () => {
  const { bookModel, planBook, chartBoxH } = await lib();
  const plan = planBook(bookModel(persons()), '');
  const charts = plan.pages.filter((p) => p.kind === 'chart');
  assert.ok(charts.length >= 20);
  for (const pg of charts) {
    const boxNote = !!pg.note;
    if (pg.shelf) {
      let rowsH = 0; let rowH = 0; let rowW = 0; let rows = [];
      let cur = [];
      for (const f of pg.figs) { if (f.br) { rows.push(cur); cur = []; } else cur.push(f); }
      rows.push(cur);
      for (const row of rows) {
        rowH = Math.max(0, ...row.map((f) => f.h * f.s + 18)); rowW = row.reduce((a, f) => a + Math.max(f.w * f.s, f.title.length * 6.4), 0) + 12 * Math.max(0, row.length - 1);
        assert.ok(rowW <= 750 + 0.5, `page ${pg.n}: row ${rowW}px wider than the page`);
        rowsH += rowH;
      }
      rowsH += 8 * Math.max(0, rows.length - 1);
      assert.ok(rowsH <= chartBoxH(boxNote) + 0.5, `page ${pg.n}: shelf ${rowsH}px taller than ${chartBoxH(boxNote)}`);
    } else {
      for (const f of pg.figs) assert.ok(f.h * f.s <= chartBoxH(boxNote) + 0.5, `page ${pg.n}: chart ${f.h * f.s}px taller than its box`);
    }
    for (const f of pg.figs) if (!f.br) for (const nd of f.nodes) if (nd[3]) assert.ok(nd[5], `page ${pg.n}: cut box without a page`);
  }
});

test('a branch plan holds only that branch and no other person ids', async () => {
  const { bookModel, planBook } = await lib();
  const M = bookModel(persons());
  const full = planBook(M, '');
  const branch = full.branches[0];
  const part = planBook(M, branch.id);
  assert.ok(part.pages.length < full.pages.length);
  assert.equal(part.scope, branch.id);
  const inBranch = new Set();
  const walk = (id) => { inBranch.add(id); for (const c of M.kids(id)) walk(c.id); };
  walk(branch.id);
  for (const pg of part.pages) for (const id of pg.ids || []) {
    const p = M.byId.get(id);
    let q = p; while (q && q.id !== branch.id && q.data.parent) q = M.byId.get(q.data.parent);
    const parent = M.byId.get(branch.data?.parent || M.byId.get(branch.id).data.parent);
    assert.ok(q && (q.id === branch.id || id === M.roots[0].id || id === parent?.id), `person ${id} is outside the branch`);
  }
});

test('contact details of living people are not in the plan', async () => {
  const { bookModel, planBook } = await lib();
  const data = persons();
  data[5].data.phone = '0901234567'; data[5].data.email = 'nguoi.that@example.test';
  const json = JSON.stringify(planBook(bookModel(data), ''));
  assert.ok(!json.includes('0901234567') && !json.includes('nguoi.that@example.test'));
});

test('an entry is taller with more children and a longer note', async () => {
  const { bookModel, entryHeight } = await lib();
  const data = persons();
  const M = bookModel(data);
  const p = data.find((x) => x.data.gen === 4) || data[0];
  const h0 = entryHeight(M, M.byId.get(p.id));
  p.data.note = 'Ghi chú dài '.repeat(30);
  const M2 = bookModel(data);
  assert.ok(entryHeight(M2, M2.byId.get(p.id)) > h0);
});

// entries printed in a plan (flow pages): [1, id, reg, kids]
const entryIds = (plan) => plan.pages.filter((pg) => pg.kind === 'flow').flatMap((pg) => pg.cols.flat()).filter((it) => it[0] === 1).map((it) => it[1]);
const isAncestorOrSelf = (M, a, p) => { let q = p; while (q) { if (q.id === a.id) return true; q = M.byId.get(q.data.parent); } return false; };

test('scope: up prints the ancestors of the root, down its descendants; gen N and status narrow the set', async () => {
  const { bookModel, planBook } = await lib();
  const M = bookModel(persons());
  const deep = M.generations.find((p) => (p.data.gen || 0) >= 4 && M.kids(p.id).length > 0);
  assert.ok(deep, 'seed has a generation 4 parent');
  const up = new Set(entryIds(planBook(M, { root: deep.id, dir: 'up' })));
  assert.ok(up.has(deep.id), 'the root is printed');
  for (const id of up) assert.ok(isAncestorOrSelf(M, M.byId.get(id), deep), id + ' is not an ancestor of the root');
  const down = entryIds(planBook(M, { root: deep.id }));
  assert.ok(down.length && down.every((id) => isAncestorOrSelf(M, deep, M.byId.get(id))), 'down prints only descendants of the root');
  const two = entryIds(planBook(M, { root: deep.id, maxGen: 2 }));
  assert.ok(two.every((id) => { const g = M.byId.get(id).data.gen || 0; return g >= (deep.data.gen || 0) && g < (deep.data.gen || 0) + 2; }), 'gen limit');
  const alive = entryIds(planBook(M, { status: 'living' }));
  assert.ok(alive.every((id) => { const d = M.byId.get(id).data; return !(d.died || d.death_lunar || d.gio_lunar || d.living === 'dead'); }), 'status living');
});

test('scope: daughters listed by name only; their descendants are not continued', async () => {
  const { bookModel, planBook } = await lib();
  const M = bookModel(persons());
  const f = M.generations.find((p) => p.data.sex === 'f' && M.kids(p.id).length > 0 && (p.data.gen || 0) >= 1);
  assert.ok(f, 'seed has a daughter with children');
  const kids = new Set(M.kids(f.id).map((c) => c.id));
  const ids = new Set(entryIds(planBook(M, { root: M.roots[0].id, daughters: 'name' })));
  for (const k of kids) assert.ok(!ids.has(k), 'a child of a daughter is printed');
  assert.ok(ids.has(f.id), 'the daughter herself is listed');
  assert.ok(entryIds(planBook(M, { root: M.roots[0].id })).some((id) => kids.has(id)), 'full: the children are printed');
});

test('layout: summary prints no entries (charts and index only); gen prints one flow by generation', async () => {
  const { bookModel, planBook } = await lib();
  const M = bookModel(persons());
  assert.equal(entryIds(planBook(M, { layout: 'summary' })).length, 0, 'summary prints no entry');
  assert.ok(planBook(M, { layout: 'summary' }).pages.some((pg) => pg.kind === 'chart'), 'summary keeps the charts');
  const gen = planBook(M, { layout: 'gen' });
  const gens = entryIds(gen).map((id) => M.byId.get(id).data.gen || 0);
  assert.ok(gens.length && gens.every((g, i) => i === 0 || g >= gens[i - 1]), 'entries are in generation order');
});

test('counts: the cover and the count line count everyone in scope, the family total when nothing narrows it', async () => {
  const { bookModel, planBook } = await lib();
  const M = bookModel(persons());
  const whole = planBook(M, '');
  assert.equal(whole.totals.people, M.all.length);
  const root = M.roots[0];
  const part = planBook(M, { root: root.id });
  const cover = part.pages.find((pg) => pg.kind === 'cover');
  assert.equal(cover.people, part.totals.scopePeople, 'cover and count line agree');
  assert.ok(part.totals.scopePeople <= whole.totals.people);
});

test('khổ: portrait A4 is planned on its own page size (more pages, every page numbered, charts inside the page)', async () => {
  const { bookModel, planBook, PAGES } = await lib();
  const M = bookModel(persons());
  const land = planBook(M, { orient: 'land' });
  const port = planBook(M, { orient: 'port' });
  assert.equal(PAGES.port.w, 595); assert.equal(PAGES.port.h, 842);
  assert.ok(port.pages.some((pg) => pg.kind === 'chart') && JSON.stringify(port.pages) !== JSON.stringify(land.pages), 'portrait is planned on its own page size');
  assert.deepEqual(port.pages.map((pg) => pg.n), port.pages.map((_, i) => i + 1), 'numbered 1..N');
  assert.equal(planBook(M, { orient: 'land' }).pages.length, land.pages.length, 'landscape is unchanged after a portrait plan');
  for (const pg of port.pages) if (pg.kind === 'chart') for (const f of pg.figs) assert.ok(!f.s || f.s <= 1.5, 'chart scale is sane');
});
