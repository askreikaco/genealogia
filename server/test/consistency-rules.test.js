// Consistency checker rules (consistency-rules.js): one passing and one failing case per rule, partial dates
// (a year-only date counts, a missing date is skipped). Pure: no database.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkTree, RULE, SEVERITY } = require('../consistency-rules');

const NOW = 2026;
const ids = (r) => r.map((i) => i.rule);
const run = (o) => checkTree({ now: NOW, ...o });
const P = (id, extra = {}) => ({ id, name: 'Test ' + id, sex: '', ...extra });
const PC = (parent_id, child_id) => ({ parent_id, child_id });

test('death before birth: fails when death year is earlier', () => {
  assert.deepStrictEqual(ids(run({ persons: [P('a', { born: '1950', died: '1940' })] })), [RULE.DEATH_BEFORE_BIRTH]);
  assert.deepStrictEqual(run({ persons: [P('a', { born: '1950', died: '1990' })] }), []);
});
test('parent too young: fails under 12 at the birth, passes at 12', () => {
  const kid = P('k', { born: '1960' });
  assert.deepStrictEqual(ids(run({ persons: [P('p', { born: '1950' }), kid], links: { pc: [PC('p', 'k')] } })), [RULE.PARENT_TOO_YOUNG]);
  assert.deepStrictEqual(run({ persons: [P('p', { born: '1948' }), kid], links: { pc: [PC('p', 'k')] } }), []);
});
test('father too old (warn): over 70 at the birth; mother too old (warn): over 55', () => {
  const kid = P('k', { born: '2000' });
  const f = run({ persons: [P('p', { born: '1925', sex: 'm' }), kid], links: { pc: [PC('p', 'k')] } });
  assert.deepStrictEqual(ids(f), [RULE.FATHER_TOO_OLD]); assert.strictEqual(f[0].severity, 'warn');
  const m = run({ persons: [P('p', { born: '1940', sex: 'f' }), kid], links: { pc: [PC('p', 'k')] } });
  assert.deepStrictEqual(ids(m), [RULE.MOTHER_TOO_OLD]); assert.strictEqual(SEVERITY[RULE.MOTHER_TOO_OLD], 'warn');
  assert.deepStrictEqual(run({ persons: [P('p', { born: '1960', sex: 'm' }), kid], links: { pc: [PC('p', 'k')] } }), []);
});
test('child born after the mother died: fails; passes when born before', () => {
  const mom = P('m', { born: '1930', died: '1960', sex: 'f' });
  assert.deepStrictEqual(ids(run({ persons: [mom, P('k', { born: '1965' })], links: { pc: [PC('m', 'k')] } })), [RULE.BORN_AFTER_MOTHER_DEATH]);
  assert.deepStrictEqual(run({ persons: [mom, P('k', { born: '1959' })], links: { pc: [PC('m', 'k')] } }), []);
});
test('child born more than 1 year after the father died: fails; within 1 year passes', () => {
  const dad = P('d', { born: '1930', died: '1960', sex: 'm' });
  assert.deepStrictEqual(ids(run({ persons: [dad, P('k', { born: '1963' })], links: { pc: [PC('d', 'k')] } })), [RULE.BORN_AFTER_FATHER_DEATH]);
  assert.deepStrictEqual(run({ persons: [dad, P('k', { born: '1961' })], links: { pc: [PC('d', 'k')] } }), []);
});
test('marriage before age 12: fails; at 12 passes', () => {
  const c = (sy) => run({ persons: [P('a', { born: '1950' }), P('b', { born: '1950' })], links: { cp: [{ a_id: 'a', b_id: 'b', start_year: sy }] } });
  assert.deepStrictEqual(ids(c(1960)), [RULE.MARRIED_TOO_YOUNG, RULE.MARRIED_TOO_YOUNG]);
  assert.deepStrictEqual(c(1962), []);
});
test('no death and older than 110 (warn, probably deceased); a death mark or a younger age passes', () => {
  const f = run({ persons: [P('a', { born: '1900' })] });
  assert.deepStrictEqual(ids(f), [RULE.PROBABLY_DECEASED]); assert.strictEqual(f[0].severity, 'warn');
  assert.deepStrictEqual(run({ persons: [P('a', { born: '1900', living: 'dead' })] }), []);
  assert.deepStrictEqual(run({ persons: [P('a', { born: '1920' })] }), []);
});
test('event before birth fails; event after death fails unless memorial or burial type', () => {
  const p = P('a', { born: '1950', died: '1990' });
  assert.deepStrictEqual(ids(run({ persons: [p], events: [{ person_id: 'a', type: 'hoc', date_from: '1940' }] })), [RULE.EVENT_BEFORE_BIRTH]);
  assert.deepStrictEqual(ids(run({ persons: [p], events: [{ person_id: 'a', type: 'hoc', date_from: '2001' }] })), [RULE.EVENT_AFTER_DEATH]);
  assert.deepStrictEqual(run({ persons: [p], events: [{ person_id: 'a', type: 'an_tang', date_from: '2001' }] }), []);
  assert.deepStrictEqual(run({ persons: [p], events: [{ person_id: 'a', type: 'hoc', date_from: '1970' }] }), []);
});
test('same-name siblings born the same year: warn; different years pass', () => {
  const kids = [P('k1', { name: 'Name A', born: '1980' }), P('k2', { name: 'Name A', born: '1980' })];
  const f = run({ persons: [P('p', { born: '1950' }), ...kids], links: { pc: [PC('p', 'k1'), PC('p', 'k2')] } });
  assert.deepStrictEqual(ids(f), [RULE.SAME_NAME_SIBLING]); assert.strictEqual(f[0].severity, 'warn');
  const ok = [P('k1', { name: 'Name A', born: '1980' }), P('k2', { name: 'Name A', born: '1982' })];
  assert.deepStrictEqual(run({ persons: [P('p', { born: '1950' }), ...ok], links: { pc: [PC('p', 'k1'), PC('p', 'k2')] } }), []);
});
test('spouse age gap over 40 (warn); within 40 passes', () => {
  const c = (b2) => run({ persons: [P('a', { born: '1940' }), P('b', { born: b2 })], links: { cp: [{ a_id: 'a', b_id: 'b', start_year: 2000 }] } });
  assert.deepStrictEqual(ids(c('1975')), []);
  const f = c('1985'); assert.deepStrictEqual(ids(f), [RULE.SPOUSE_AGE_GAP]); assert.strictEqual(f[0].severity, 'warn');
});
test('partial dates: a year-only date counts, a missing date is skipped', () => {
  // year-only birth ("1950") still compares; full ISO date ("1950-03-02") is read by its year
  assert.deepStrictEqual(ids(run({ persons: [P('a', { birth_date: '1950-03-02', death_date: '1940' })] })), [RULE.DEATH_BEFORE_BIRTH]);
  // no birth year at all: no parent-age or event-before-birth finding, however old the events look
  const noBirth = [P('p', {}), P('k', { born: '2000' })];
  assert.deepStrictEqual(run({ persons: noBirth, links: { pc: [PC('p', 'k')] }, events: [{ person_id: 'p', type: 'hoc', date_from: '1700' }] }), []);
});
