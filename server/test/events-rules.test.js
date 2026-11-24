// Unit tests for life-event rules (web/js/events.js): date parsing and sort with qualifiers, ages, family-event
// derivation, privacy by person, validation, auto summary. No DB.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const lib = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'events.js')).href);

test('parseEventDate reads the typed forms', async () => {
  const E = await lib();
  assert.deepEqual(E.parseEventDate('5/3/1963'), { kind: 'exact', from: '1963-03-05', to: null });
  assert.deepEqual(E.parseEventDate('3/1963'), { kind: 'exact', from: '1963-03', to: null });
  assert.deepEqual(E.parseEventDate('1963'), { kind: 'exact', from: '1963', to: null });
  assert.deepEqual(E.parseEventDate('khoảng 1980'), { kind: 'about', from: '1980', to: null });
  assert.deepEqual(E.parseEventDate('trước 1975'), { kind: 'before', from: '1975', to: null });
  assert.deepEqual(E.parseEventDate('sau 1990'), { kind: 'after', from: '1990', to: null });
  assert.deepEqual(E.parseEventDate('1980–1985'), { kind: 'between', from: '1980', to: '1985' });
  assert.deepEqual(E.parseEventDate('từ 1980 đến 1985'), { kind: 'between', from: '1980', to: '1985' });
  assert.ok(E.parseEventDate('32/1/1990').error, 'day out of range');
  assert.ok(E.parseEventDate('1985–1980').error, 'range backwards');
  assert.ok(E.parseEventDate('hôm qua').error, 'free text is not a date');
});

test('sort places qualified dates by their best estimate', async () => {
  const E = await lib();
  const list = [
    { id: 'a', date_kind: 'exact', date_from: '1981' },
    { id: 'b', date_kind: 'before', date_from: '1981' }, // before 1981: the end of 1980
    { id: 'c', date_kind: 'about', date_from: '1980' },  // about 1980: starts 1980
    { id: 'd', date_kind: 'between', date_from: '1978', date_to: '1982' }, // middle of 1978..1982 = 1980
    { id: 'e', date_kind: 'exact', date_from: '1981-03-05' },
  ];
  assert.deepEqual(E.sortEvents(list).map((x) => x.id), ['c', 'd', 'b', 'a', 'e']);
  // same estimated day: preferred first
  const tie = [{ id: 'x', date_kind: 'exact', date_from: '1990', is_preferred: false }, { id: 'y', date_kind: 'exact', date_from: '1990', is_preferred: true }];
  assert.deepEqual(E.sortEvents(tie).map((x) => x.id), ['y', 'x']);
  // undated last
  assert.deepEqual(E.sortEvents([{ id: 'n', date_kind: null }, { id: 'o', date_kind: 'exact', date_from: '2000' }]).map((x) => x.id), ['o', 'n']);
});

test('age at an event: whole years when both dates are full, approximate by year otherwise', async () => {
  const E = await lib();
  const full = E.ageAt('1962-03-05', { date_kind: 'exact', date_from: '1985-02-01' });
  assert.deepEqual(full, { years: 22, approx: false });
  const byYear = E.ageAt('1962', { date_kind: 'exact', date_from: '1985' });
  assert.deepEqual(byYear, { years: 23, approx: true });
  assert.deepEqual(E.ageAt('1962-03-05', { date_kind: 'exact', date_from: '1980' }), { years: 18, approx: true }, 'full birth, year-only event: approximate');
  assert.equal(E.ageAt('1962', { date_kind: 'exact', date_from: '1950' }), null, 'before birth: no age');
  assert.equal(E.ageAt(null, { date_kind: 'exact', date_from: '1950' }), null, 'no birth date');
  // birth from the form's dd/mm/yyyy text
  assert.equal(E.birthIso({ birth_date: '5/3/1963' }), '1963-03-05');
  assert.equal(E.birthIso({ born: '1963' }), '1963');
});

test('stage headers follow the age', async () => {
  const E = await lib();
  assert.equal(E.stageOf(5), 'Thơ ấu'); assert.equal(E.stageOf(18), 'Trưởng thành');
  assert.equal(E.stageOf(45), 'Trưởng thành'); assert.equal(E.stageOf(69), 'Trưởng thành'); assert.equal(E.stageOf(70), 'Cao tuổi'); assert.equal(E.stageOf(80), 'Cao tuổi');
});

test('privacy is by person: living is members only, deceased follows the family', async () => {
  const E = await lib();
  const living = { name: 'Sống' };
  const dead = { name: 'Mất', died: '1980' };
  assert.equal(E.canSeeEventsOf(living, { member: false, familyReadable: true }), false, 'guest, living');
  assert.equal(E.canSeeEventsOf(living, { member: true, familyReadable: true }), true, 'member, living');
  assert.equal(E.canSeeEventsOf(dead, { member: false, familyReadable: true }), true, 'guest, deceased');
  assert.equal(E.canSeeEventsOf(dead, { member: false, familyReadable: false }), false, 'private family');
  assert.equal(E.canSeeEventsOf({ living: 'dead' }, { member: false, familyReadable: true }), true, 'marked dead');
});

test('validation rejects bad input and accepts a good event', async () => {
  const E = await lib();
  const good = { type: 'hoc', date_kind: 'exact', date_from: '1980', place: 'Huế', people: ['P001'], sources: [{ title: 'Sổ', url: 'https://x.example/a', quality: 'goc' }] };
  assert.equal(E.validateEvent(good), null);
  assert.ok(E.validateEvent({ ...good, type: 'lạ' }));
  assert.ok(E.validateEvent({ ...good, date_from: '2020-13' }));
  assert.ok(E.validateEvent({ ...good, date_kind: 'before', date_to: '1990' }), 'end date only for a range');
  assert.ok(E.validateEvent({ ...good, sources: [{ title: 'x', url: 'javascript:alert(1)' }] }));
  assert.ok(E.validateEvent({ ...good, people: ['bad id'] }));
  assert.equal(E.validateStory({ title: 'Tiêu đề', body: 'Nội dung', photos: ['https://x.example/p.jpg'] }), null);
  assert.ok(E.validateStory({ title: 'x', body: 'y', photos: ['data:image/png;base64,AAA'] }));
});

test('auto summary is built from the events, in date order, without derived events', async () => {
  const E = await lib();
  const text = E.autoSummary('Dương Văn Tâm', [
    { type: 'cuoi', date_kind: 'exact', date_from: '1985', place: 'Củ Chi', description: '' },
    { type: 'sinh', date_kind: 'exact', date_from: '1962', place: 'Củ Chi' },
    { type: 'sinh', derived: true, date_kind: 'exact', date_from: '1900' },
  ]);
  assert.ok(text.startsWith('Dương Văn Tâm sinh năm 1962'), text);
  assert.ok(text.indexOf('1962') < text.indexOf('1985'));
  assert.ok(!text.includes('1900'));
});
