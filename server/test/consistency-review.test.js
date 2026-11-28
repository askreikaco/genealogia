// Review rules and the needs list (consistency-rules.js: checkReview, needsRows) and the estimate display rules
// (web/js/est-years.js). Pure: no database. The engine comes from web/js/estimate-graph.js, as the browser runs it.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { checkTree, checkReview, needsRows, normName, RULE, REVIEW_RULES, SEVERITY } = require('../consistency-rules');

const mod = (f) => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', f)).href);
const TODAY = '2026-11-28';
const P = (id, extra = {}) => ({ id, name: 'Test ' + id, sex: 'm', ...extra });
const PC = (parent_id, child_id) => ({ parent_id, child_id });
const rules = (r) => r.map((i) => i.rule);

// Engine input from parent links only (the legacy shape: data.parent / data.other_parent), as the server passes it.
async function engine(rows) {
  const eg = await mod('estimate-graph.js');
  const persons = new Map(rows.map(([id, d]) => [id, { name: 'Test ' + id, sex: 'm', ...d }]));
  const kids = new Map();
  for (const [id, d] of persons) for (const p of [d.parent, d.other_parent]) if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(id); }
  const R = {
    parents: (id) => { const d = persons.get(id); return d ? [d.parent, d.other_parent].filter(Boolean) : []; },
    children: (id) => kids.get(id) || [],
    partners: () => [],
  };
  return eg.estimateFamily(persons, R, { today: TODAY });
}

test('normName: diacritics, đ, case and spaces give one key', () => {
  assert.strictEqual(normName('Nguyễn  Văn   An'), normName('nguyen van an'));
  assert.strictEqual(normName(' ĐINH Thị  Mai '), 'dinh thi mai');
  assert.notStrictEqual(normName('Nguyễn Văn An'), normName('Nguyễn Thị An'));
});

test('possible duplicate: same name under the same parent (normalized) fails; different name or parent passes', () => {
  const persons = [P('f', { sex: 'm' }), P('a', { name: 'Nguyễn Văn An', parent: 'f' }), P('b', { name: 'nguyen  van AN', parent: 'f' })];
  const links = { pc: [PC('f', 'a'), PC('f', 'b')] };
  const hit = checkReview({ persons, links }).filter((i) => i.rule === RULE.POSSIBLE_DUPLICATE);
  assert.strictEqual(hit.length, 1);
  assert.deepStrictEqual(hit[0].personIds.sort(), ['a', 'b']);
  assert.strictEqual(hit[0].severity, SEVERITY.possible_duplicate);
  // different name: no duplicate
  const ok1 = checkReview({ persons: [P('f'), P('a', { name: 'Trần An' }), P('b', { name: 'Trần Bình' })], links: { pc: [PC('f', 'a'), PC('f', 'b')] } });
  assert.deepStrictEqual(rules(ok1), []);
  // same name, different parents: no duplicate
  const ok2 = checkReview({ persons: [P('f'), P('g'), P('a', { name: 'Trần An' }), P('b', { name: 'Trần An' })], links: { pc: [PC('f', 'a'), PC('g', 'b')] } });
  assert.deepStrictEqual(rules(ok2), []);
});

test('missing sex: an empty or unknown sex fails; m and f pass', () => {
  assert.deepStrictEqual(rules(checkReview({ persons: [P('a', { sex: '' })] })), [RULE.MISSING_SEX]);
  assert.deepStrictEqual(rules(checkReview({ persons: [P('a', { sex: 'x' })] })), [RULE.MISSING_SEX]);
  assert.deepStrictEqual(checkReview({ persons: [P('a', { sex: 'f' }), P('b', { sex: 'm' })] }), []);
});

test('verify note: a person with verify set fails and carries the note; without it passes', () => {
  const [hit] = checkReview({ persons: [P('a', { verify: 'Thiếu năm sinh' })] });
  assert.strictEqual(hit.rule, RULE.VERIFY_NOTE);
  assert.deepStrictEqual(hit.detail, ['Thiếu năm sinh']);
  assert.deepStrictEqual(checkReview({ persons: [P('a', { verify: '' })] }), []);
});

test('year conflict: a known birth that clashes with a parent fails with the basis; a consistent tree passes', async () => {
  // the mother is born 1950 but the child is born 1900 (a child is 15 to 45 years after the mother): the mother's range is empty
  const est = await engine([['MO', { sex: 'f', born: '1950' }], ['CH', { sex: 'm', born: '1900', parent: 'MO' }]]);
  const issues = checkReview({ persons: [P('MO', { sex: 'f', born: '1950' }), P('CH', { born: '1900', parent: 'MO' })], links: { pc: [PC('MO', 'CH')] }, estimates: est });
  const hit = issues.find((i) => i.rule === RULE.YEAR_CONFLICT);
  assert.ok(hit, 'a conflict is reported');
  assert.deepStrictEqual(hit.personIds, ['MO']);
  assert.ok(hit.detail.length > 0, 'the basis comes with the issue');
  // consistent: a child born 1980 to a mother born 1950
  const ok = await engine([['MO', { sex: 'f', born: '1950' }], ['CH', { sex: 'm', born: '1980', parent: 'MO' }]]);
  assert.deepStrictEqual(rules(checkReview({ persons: [P('MO', { sex: 'f' }), P('CH', { born: '1980' })], links: { pc: [PC('MO', 'CH')] }, estimates: ok })), []);
});

test('review rules are not in the checkTree (member view) list', () => {
  const found = checkTree({ persons: [P('a', { sex: '' })] });
  assert.ok(!found.some((i) => REVIEW_RULES.has(i.rule)));
  assert.ok([...REVIEW_RULES].every((r) => SEVERITY[r]));
});

test('needs: no birth year is listed; known dead without a death year is listed; narrowest estimate first, then generation', async () => {
  const est = await engine([
    ['G1', { born: '1850', gen: 1 }],
    ['K1', { parent: 'G1', gen: 2 }], // born 1865–1900 (15 to 50 years after the father): a range of 35 years
    ['W1', {}], // no link, no generation, no year: no estimate
    ['D1', { parent: 'G1', gen: 2, died: '1930' }], // known dead, born 1865–1915
    ['B1', { born: '1880', gen: 2 }], // born: not listed
  ]);
  const persons = [P('G1', { gen: 1 }), P('K1', { gen: 2 }), P('W1'), P('D1', { gen: 2 }), P('B1', { gen: 2 })];
  const rows = needsRows({ persons, estimates: est, maxWidth: 60 });
  const ids = rows.map((r) => r.id);
  assert.ok(!ids.includes('B1'), 'a person with a birth year is not listed');
  assert.ok(!ids.includes('G1'), 'a person with a birth year is not listed');
  assert.ok(ids.includes('K1') && ids.includes('W1') && ids.includes('D1'));
  const w1 = rows.find((r) => r.id === 'W1');
  assert.strictEqual(w1.est, null, 'no estimate when the range is open');
  assert.deepStrictEqual(rows.find((r) => r.id === 'K1').need, ['born']);
  assert.ok(rows.find((r) => r.id === 'K1').est, 'a 35 year range is shown');
  // narrowest first: the ranges in width order, the person with no estimate last
  const widths = rows.filter((r) => r.est).map((r) => r.width);
  assert.deepStrictEqual(widths, [...widths].sort((a, b) => a - b));
  assert.strictEqual(ids[ids.length - 1], 'W1');
});

test('needs: a range wider than maxWidth is not an estimate for the list', async () => {
  const est = await engine([['G1', { born: '1850', gen: 1 }], ['K1', { parent: 'G1', gen: 2 }]]);
  const rows = needsRows({ persons: [P('K1', { gen: 2 })], estimates: est, maxWidth: 10 });
  assert.strictEqual(rows[0].est, null);
});

test('est-years: shown for a missing birth, one year wide as "≈ 1880", hidden when wider than 60, never for hidden or conflict', async () => {
  const ey = await mod('est-years.js');
  const one = ey.estItems({ name: 'A' }, { bornKnown: false, born: [1880, 1880], bornBasis: ['x'], diedKnown: false, died: null, dead: false, ruleDead: false, conflict: false });
  assert.deepStrictEqual(one.map((i) => i.range), ['1880']);
  assert.strictEqual(ey.estLabel(one[0], false), '≈ 1880');
  assert.strictEqual(ey.estPlain(one), '≈ 1880 · ước tính');
  const wide = ey.estItems({}, { bornKnown: false, born: [1800, 1870], bornBasis: [], diedKnown: false, died: null, dead: false, conflict: false });
  assert.deepStrictEqual(wide, [], 'a 70 year range is not shown');
  const edge = ey.estItems({}, { bornKnown: false, born: [1800, 1860], bornBasis: [], diedKnown: false, died: null, dead: false, conflict: false });
  assert.deepStrictEqual(edge.map((i) => i.range), ['1800–1860'], 'exactly 60 years is shown');
  const hidden = ey.estItems({ hidden_living: true }, { bornKnown: false, born: [1880, 1880], bornBasis: [], diedKnown: false, died: null, dead: false, conflict: false });
  assert.deepStrictEqual(hidden, [], 'a hidden living person shows no estimate');
  const conflict = ey.estItems({}, { bornKnown: false, born: [1880, 1880], bornBasis: [], diedKnown: false, died: null, dead: false, conflict: true });
  assert.deepStrictEqual(conflict, []);
  const died = ey.estItems({}, { bornKnown: true, born: [1880, 1880], bornBasis: [], diedKnown: false, died: [1950, 1970], diedBasis: ['con X: mẹ sinh 15–45 năm trước'], diedEvidence: true, dead: true, ruleDead: false, conflict: false });
  assert.strictEqual(ey.estLabel(died[0], true), 'mất ≈ 1950–1970');
  const bornWithDeath = ey.estItems({ died: '1950' }, { bornKnown: false, born: [1880, 1880], bornBasis: [], diedKnown: true, died: null, dead: true, conflict: false });
  assert.strictEqual(ey.estLabel(bornWithDeath[0], true), 'sinh ≈ 1880');
});

test('death year: a lifespan-only range is hidden (no invented death); a range bounded by a relative or a note is shown', async () => {
  const ey = await mod('est-years.js');
  // born 1850, nothing else: the probably-deceased rule gives a death year (born + 60) and nothing else bounds it
  const alone = await engine([['P', { born: '1830', sex: 'f' }]]);
  assert.strictEqual(alone.get('P').ruleDead, true, 'deceased by rule');
  assert.strictEqual(alone.get('P').diedEvidence, false, 'no evidence beyond the lifespan default');
  assert.deepStrictEqual(ey.estItems({ born: '1830' }, alone.get('P')).map((i) => i.kind), [], 'no death estimate from the lifespan alone');
  // a child born 1870 bounds the mother's death from below (she was alive at the birth): the death year is shown
  const withChild = await engine([['M', { born: '1830', sex: 'f' }], ['K', { born: '1870', sex: 'm', parent: 'M' }]]);
  const m = withChild.get('M');
  assert.strictEqual(m.diedEvidence, true, 'the child is evidence');
  const items = ey.estItems({ born: '1830' }, m);
  assert.deepStrictEqual(items.map((i) => i.kind), ['died']);
  assert.ok(items[0].basis.length >= 1 && items[0].basis.every((t) => !/^sống tối đa 100 năm|^quy tắc: sinh hơn 110/.test(t)), 'the basis lines are evidence, one each');
  // a note year bounds it too
  const note = await engine([['N', { born: '1830', sex: 'f', note: 'còn sống năm 1880' }]]);
  assert.deepStrictEqual(ey.estItems({ born: '1830', note: 'còn sống năm 1880' }, note.get('N')).map((i) => i.kind), ['died']);
});

test('needs: a death year is listed as missing only with evidence; a lifespan-only death gives no estimate for it', async () => {
  const est = await engine([['P', { born: '1830', sex: 'f' }]]);
  const rows = needsRows({ persons: [P('P', { sex: 'f' })], estimates: est, maxWidth: 60 });
  assert.strictEqual(rows.length, 0, 'a person with a birth year and no known death is not in the born list');
  const est2 = await engine([['P', { born: '1830', sex: 'f', died: '1880' }]]);
  assert.deepStrictEqual(needsRows({ persons: [P('P', { sex: 'f' })], estimates: est2 }), []);
});
