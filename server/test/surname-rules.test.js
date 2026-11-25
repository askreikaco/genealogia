// Surname over time (surname-rules.js; browser copy web/js/surname-rules.js): the names[] rules, the timeline, inheritance
// from the father, the họ gốc visibility, the historical hint pack, date-aware aliases in the match engine, and that the
// server and browser copies agree. Pure: no database. Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const SR = require('../surname-rules');
const { validateValue, validateOp, publicView, mergeOp } = require('../core');
const R = require('../match-rules');

let WEB;
test.before(async () => {
  WEB = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'surname-rules.js')).href);
});

test('names: a valid list is accepted; the whole list is one field', () => {
  const ok = [{ type: 'birth', surname: 'Lý', given: 'Thử', from: '1200', confidence: 'confirmed' },
    { type: 'changed', surname: 'Nguyễn', given: 'Thử', han: '阮', from: '1232', to: '', reason: 'Đổi họ theo lệnh', source: 'gia phả', confidence: 'tradition' }];
  assert.strictEqual(SR.namesError(ok), null);
  assert.strictEqual(SR.namesError([]), null, 'an empty list clears the timeline');
  assert.strictEqual(validateValue('names', ok), null);
  assert.strictEqual(validateOp({ op_id: 'o1', id: 'P001', fields: { names: ok }, ts: Date.now() }), null);
});

test('names: bad entries are refused with a reason', () => {
  const bad = [
    [{ type: 'other', surname: 'Lý' }], // unknown type
    [{ type: 'birth', surname: '' }], // a surname is needed
    [{ type: 'birth', surname: 'Lý', nickname: 'x' }], // unknown key
    [{ type: 'changed', surname: 'Lý', confidence: 'sure' }], // unknown confidence
    [{ type: 'changed', surname: 'Lý', from: '1300', to: '1200' }], // from after to
    [{ type: 'aka', surname: 'Lý', han: 'Lý' }], // Hán field: Han characters only
    [{ type: 'aka', surname: 'Lý'.repeat(30) }], // over 40 characters
    [{ type: 'aka', surname: 'Lý', reason: 'x'.repeat(201) }],
    Array.from({ length: 13 }, () => ({ type: 'aka', surname: 'Lý' })), // at most 12 entries
    'Lý',
  ];
  for (const v of bad) assert.notStrictEqual(SR.namesError(v), null, JSON.stringify(v).slice(0, 60));
  assert.notStrictEqual(validateValue('names', [{ type: 'birth', surname: '' }]), null);
});

test('timeline: sorted by the year the mark starts, undated marks first, order kept on ties', () => {
  const data = { names: [{ type: 'changed', surname: 'C', from: '1300' }, { type: 'birth', surname: 'A' }, { type: 'changed', surname: 'B', from: '1200' }, { type: 'aka', surname: 'D', from: '1200' }] };
  assert.deepStrictEqual(SR.timelineOf(data).map((e) => e.surname), ['A', 'B', 'D', 'C']);
});

test('surnameAt: the change in force wins; before the change the birth surname applies', () => {
  const get = (id) => ({ P1: { data: { names: [{ type: 'birth', surname: 'Lý', from: '1200' }, { type: 'changed', surname: 'Nguyễn', from: '1232' }] } } })[id] || null;
  assert.strictEqual(SR.surnameAt('P1', 1220, get).surname, 'Lý');
  assert.strictEqual(SR.surnameAt('P1', 1240, get).surname, 'Nguyễn');
  assert.strictEqual(SR.surnameAt('P1', 1240, get).source, 'own');
});

test('surnameAt: a descendant inherits the father surname at its birth year, unless it has its own mark', () => {
  const people = {
    F: { data: { names: [{ type: 'birth', surname: 'Lý', from: '1200' }, { type: 'changed', surname: 'Nguyễn', from: '1232' }] } },
    C1: { data: { born: '1225' }, father: 'F' }, // born before the change: Lý
    C2: { data: { born: '1240' }, father: 'F' }, // born after: Nguyễn
    C3: { data: { born: '1245', names: [{ type: 'changed', surname: 'Trần', from: '1260' }] }, father: 'F' }, // own mark overrides
    C4: { data: { born: '1250' } }, // no father known
  };
  const get = (id) => people[id] || null;
  assert.deepStrictEqual([SR.surnameAt('C1', 1225, get).surname, SR.surnameAt('C1', 1225, get).source], ['Lý', 'inherited']);
  assert.strictEqual(SR.surnameAt('C2', 1240, get).surname, 'Nguyễn');
  assert.deepStrictEqual([SR.surnameAt('C3', 1245, get).surname, SR.surnameAt('C3', 1245, get).source], ['Nguyễn', 'inherited'], 'an own mark that starts later does not apply yet');
  assert.strictEqual(SR.surnameAt('C3', 1265, get).surname, 'Trần');
  assert.strictEqual(SR.surnameAt('C4', 1250, get).surname, null);
});

test('surnameAt: a cycle in the parent links stops', () => {
  const get = (id) => ({ X: { data: {}, father: 'Y' }, Y: { data: {}, father: 'X' } })[id] || null;
  assert.strictEqual(SR.surnameAt('X', 1300, get).surname, null);
});

test('họ gốc visibility: all | members | editors', () => {
  const cases = [['all', null, true], ['all', 'member', true], ['members', null, false], ['members', 'guest', false], ['members', 'member', true], ['members', 'editor', true],
    ['editors', 'member', false], ['editors', 'editor', true], ['editors', 'admin', true], ['editors', 'owner', true], ['nope', 'owner', false]];
  for (const [vis, role, want] of cases) assert.strictEqual(SR.originVisibleTo(vis, role), want, `${vis}/${role}`);
});

test('publicView: the reason and source of a change are not shown to visitors; members see them', () => {
  const d = { name: 'Lý Thử Gốc', names: [{ type: 'changed', surname: 'Nguyễn', from: '1232', reason: 'lý do nhạy cảm', source: 'nguồn', confidence: 'tradition' }] };
  const pub = publicView(d).names[0];
  assert.deepStrictEqual(pub, { type: 'changed', surname: 'Nguyễn', from: '1232', confidence: 'tradition' });
  assert.strictEqual(d.names[0].reason, 'lý do nhạy cảm', 'the stored data keeps it');
});

test('mergeOp: the names list is written whole, newest write wins', () => {
  const row = { data: { name: 'Lý Thử' }, field_ts: {} };
  const m = mergeOp(row, { op_id: 'x', id: 'P1', fields: { names: [{ type: 'changed', surname: 'Nguyễn', from: '1232' }] }, ts: 100 });
  assert.strictEqual(m.data.names[0].surname, 'Nguyễn');
  assert.strictEqual(m.changes[0].field, 'names');
});

test('hint pack: a sane shape, editor hints only by name, found by either surname', () => {
  const pack = SR.hintPack();
  assert.ok(pack.length >= 2);
  for (const h of pack) {
    for (const k of ['id', 'from', 'year', 'title', 'note', 'confidence', 'source']) assert.ok(typeof h[k] === 'string' && h[k], `${h.id} ${k}`);
    assert.ok(['confirmed', 'tradition', 'uncertain'].includes(h.confidence));
  }
  assert.ok(SR.hintsFor('Lý').some((h) => h.id === 'ly-nguyen-1232'));
  assert.ok(SR.hintsFor('Nguyễn').some((h) => h.id === 'ly-nguyen-1232'), 'found by the surname it changed to');
  assert.deepStrictEqual(SR.hintsFor('Không Có'), []);
});

test('aliases: the Lý name counts only where its years meet the other person life', () => {
  const data = { name: 'Nguyễn Văn An', sex: 'm', born: '1220', names: [{ type: 'birth', surname: 'Lý', from: '1200', to: '1232' }, { type: 'changed', surname: 'Nguyễn', from: '1232' }] };
  const [alias] = R.aliasCtxs('P1', 'fa', data, {});
  assert.strictEqual(alias.alias.of, 'Lý');
  const early = R.toCtx('P2', 'fb', { name: 'Lý Văn An', sex: 'm', born: '1222' }, {});
  const late = R.toCtx('P3', 'fb', { name: 'Lý Văn An', sex: 'm', born: '1600' }, {});
  const hit = R.scorePair(alias, early);
  assert.ok(hit.score >= 0.6, `score ${hit.score}`);
  assert.ok(hit.reasons.some((r) => r.startsWith('theo họ đã dùng: Lý')));
  assert.strictEqual(R.scorePair(alias, late).score, 0, 'a namesake of a later age does not match through an old surname');
});

test('aliases: a name equal to the primary name is not added twice', () => {
  const data = { name: 'Lý Văn An', names: [{ type: 'birth', surname: 'Lý' }] };
  assert.strictEqual(R.aliasCtxs('P1', 'fa', data, {}).length, 0);
});

test('parity: the browser copy and the server agree on the rules', () => {
  const samples = [
    [{ type: 'birth', surname: 'Lý', from: '1200' }, { type: 'changed', surname: 'Nguyễn', from: '1232', reason: 'x' }],
    [{ type: 'other', surname: 'x' }], [{ type: 'birth', surname: '' }], [{ type: 'aka', surname: 'Lý', han: 'Lý' }],
    [{ type: 'changed', surname: 'Lý', from: '1300', to: '1200' }], [{ type: 'changed', surname: 'Lý', confidence: 'uncertain', source: 's' }],
  ];
  for (const s of samples) assert.strictEqual(SR.namesError(s) === null, WEB.namesError(s) === null, JSON.stringify(s).slice(0, 50));
  const get = (id) => ({ F: { data: { names: [{ type: 'birth', surname: 'Lý', from: '1200' }] } }, C: { data: { born: '1225' }, father: 'F' } })[id] || null;
  const a = SR.surnameAt('C', 1225, get); const b = WEB.surnameAt('C', 1225, get);
  assert.deepStrictEqual([a.surname, a.source], [b.surname, b.source]);
  for (const [vis, role] of [['all', null], ['members', 'member'], ['editors', 'member'], ['editors', 'owner']]) assert.strictEqual(SR.originVisibleTo(vis, role), WEB.originVisibleTo(vis, role));
  for (const [w, l] of [[{ from: 1200, to: 1232 }, { by: 1220, dy: null }], [{ from: 1200, to: 1232 }, { by: 1600, dy: null }], [{ from: null, to: null }, { by: 1600 }]]) {
    assert.strictEqual(SR.windowOverlaps(w, l), WEB.windowOverlaps(w, l));
  }
});

test('search: a person is found by a name carried before a change (alias), and by the new surname', async () => {
  const F = await import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'fuzzy.js')).href);
  const person = { id: 'P1', data: { name: 'Nguyễn Văn An', names: [{ type: 'birth', surname: 'Lý', given: 'Văn An' }, { type: 'changed', surname: 'Nguyễn' }] } };
  assert.ok(F.scorePerson('Lý', person).matched === 1, 'the surname before the change');
  assert.ok(F.scorePerson('Nguyễn', person).matched === 1);
  assert.ok(F.scorePerson('Trần', person).matched === 0);
});
