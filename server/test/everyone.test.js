// Unit tests for "everyone is the default set" (web/js/model.js): lists, counts, map, stats and CSV use every person,
// people married in (spouse_of) take Đời and Chi from their spouse for filters. No database: server/seed/demo-persons.json,
// plus in-law records added here (the seed itself has none).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let L = null;
const lib = async () => L || (L = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'model.js')).href));
const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'demo-persons.json'), 'utf8'));
const seedPersons = () => SEED.map((p) => ({ id: p.id, fam: 'duong', data: JSON.parse(JSON.stringify(p.data)) }));

// One in-law (dâu / rể) for every nth bloodline person; the in-law carries no gen and no parent, like the server data.
function withInLaws(persons, every = 25) {
  const out = persons.slice();
  const bloodline = persons.filter((p) => !p.data.spouse_of);
  bloodline.forEach((b, i) => {
    if (i % every) return;
    out.push({ id: 'S' + b.id, fam: 'duong', data: { name: 'Vợ của ' + b.data.name, sex: b.data.sex === 'm' ? 'f' : 'm', spouse_of: b.id, spouse_n: 1, place: i % 2 ? 'Củ Chi' : '' } });
  });
  return out;
}
const branchOf3 = (m) => m.ps.find((p) => p.data.gen === 3 && m.kids(p.id).length);

test('seed data: the default set is every person (no spouse records, so all = bloodline = every seed row)', async () => {
  const { buildFrom } = await lib();
  const m = buildFrom(seedPersons());
  assert.equal(m.everyone.length, SEED.length);
  assert.equal(m.all.length, SEED.length);
  assert.equal(m.ps.length, SEED.length);
  assert.deepStrictEqual(new Set(m.everyone.map((p) => p.id)), new Set(SEED.map((p) => p.id)));
});

test('with people married in: default count = all people, bloodline stays in ps (tree only)', async () => {
  const { buildFrom } = await lib();
  const persons = withInLaws(seedPersons());
  const inLaws = persons.filter((p) => p.data.spouse_of).length;
  assert.ok(inLaws >= 10, 'fixture has in-laws');
  const m = buildFrom(persons);
  assert.equal(m.everyone.length, persons.length, 'list / map / export / stats default = everyone');
  assert.equal(m.all.length, persons.length);
  assert.equal(m.ps.length, SEED.length, 'ps is bloodline only');
  const ids = m.everyone.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'every person once');
});

test('a person married in comes right after their bloodline spouse in the default order', async () => {
  const { buildFrom } = await lib();
  const m = buildFrom(withInLaws(seedPersons()));
  const pos = new Map(m.everyone.map((p, i) => [p.id, i]));
  for (const p of m.all.filter((x) => x.data.spouse_of)) assert.equal(pos.get(p.id), pos.get(p.data.spouse_of) + 1 + m.inlaws(p.data.spouse_of).indexOf(p), p.id);
});

test('an orphan in-law (spouse missing) is still in the default set', async () => {
  const { buildFrom } = await lib();
  const persons = seedPersons(); persons.push({ id: 'SX', fam: 'duong', data: { name: 'Không rõ', sex: 'f', spouse_of: 'NOPE' } });
  const m = buildFrom(persons);
  assert.equal(m.everyone.length, SEED.length + 1);
  assert.ok(m.everyone.some((p) => p.id === 'SX'));
});

test('Đời and Chi of a person married in come from the spouse (filters keep them)', async () => {
  const { buildFrom, genOf, inChi, baseOf } = await lib();
  const m = buildFrom(withInLaws(seedPersons()));
  const inLaw = m.all.find((p) => p.data.spouse_of && baseOf(m, p).data.gen);
  const base = baseOf(m, inLaw);
  assert.equal(genOf(m, inLaw), base.data.gen);
  assert.equal(inLaw.data.gen, undefined, 'the record itself has no Đời');
  // Chi: the in-law is in the branch that holds their spouse, and in no other branch
  const branches = m.ps.filter((p) => p.data.gen === 3 && m.kids(p.id).length);
  const own = branches.filter((b) => inChi(m, inLaw, b.id));
  assert.ok(own.length <= 1, 'at most one branch');
  if (own.length) assert.ok(inChi(m, base, own[0].id), 'same branch as the spouse');
  assert.equal(inChi(m, inLaw, ''), true, 'no Chi filter = everyone');
});

test('Đời filter over everyone adds up to the default count (people with a Đời)', async () => {
  const { buildFrom, genOf } = await lib();
  const m = buildFrom(withInLaws(seedPersons()));
  const gens = [...new Set(m.all.map((p) => genOf(m, p)).filter(Boolean))];
  const total = gens.reduce((s, g) => s + m.everyone.filter((p) => genOf(m, p) === g).length, 0);
  assert.equal(total, m.everyone.filter((p) => genOf(m, p)).length);
  assert.equal(m.everyone.filter((p) => genOf(m, p)).length, m.everyone.length, 'every seed person has a Đời');
});

test('Chi filter on a branch includes its in-laws (count = base descendants + in-laws)', async () => {
  const { buildFrom, inChi } = await lib();
  const m = buildFrom(withInLaws(seedPersons()));
  const chi = branchOf3(m);
  const expected = m.everyone.filter((p) => { let x = (p.data.spouse_of && m.byId.get(p.data.spouse_of)) || p; while (x) { if (x.id === chi.id) return true; x = m.byId.get(x.data.parent); } return false; });
  const got = m.everyone.filter((p) => inChi(m, p, chi.id));
  assert.deepStrictEqual(got.map((p) => p.id), expected.map((p) => p.id));
  assert.ok(got.some((p) => p.data.spouse_of), 'the branch has an in-law');
});

test('stats: a person married in is counted under their spouse branch, not "before the branches"', async () => {
  const { buildFrom, branchOf, baseOf } = await lib();
  const m = buildFrom(withInLaws(seedPersons()));
  const inLaws = m.all.filter((p) => p.data.spouse_of && branchOf(m, baseOf(m, p)));
  assert.ok(inLaws.length > 0, 'in-laws under a branch');
  // app.js stats: bi(p) = branchOf(M, baseOf(M, p)); a plain branchOf on the in-law record has no parent to climb
  assert.ok(inLaws.every((p) => branchOf(m, p) === null));
});
