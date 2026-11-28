// Profile facts as timeline events (web/js/events-life.js: currentFact, currentFacts): the latest event of the type is the
// current value, a dated event beats an undated one, and the old person field is the fallback when no event holds a text.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'web', 'js', 'events-life.js')).href);

const ev = (o) => ({ id: o.id || 'e' + Math.random().toString(36).slice(2, 8), is_preferred: true, ...o });

test('latest dated event of the type is the current value (its year shown)', async () => {
  const { currentFact } = await load();
  const events = [
    ev({ id: 'a', type: 'nghe', date_from: '2000-01-01', description: 'Giáo viên' }),
    ev({ id: 'b', type: 'nghe', date_from: '2010-06-01', description: 'Kỹ sư\nCông ty X' }),
    ev({ id: 'c', type: 'chuyen_nha', date_from: '2015', place: 'Hà Nội' }),
  ];
  assert.deepStrictEqual(currentFact(events, 'job', { job: 'Cũ' }), { value: 'Kỹ sư', year: '2010', source: 'event', id: 'b' });
});

test('a dated event beats an undated one, even when the undated one comes later in the list', async () => {
  const { currentFact } = await load();
  const events = [
    ev({ id: 'x', type: 'ton_giao', description: 'Công giáo' }),
    ev({ id: 'y', type: 'ton_giao', date_from: '1990', description: 'Phật giáo' }),
  ];
  assert.strictEqual(currentFact(events, 'religion', {}).value, 'Phật giáo');
  assert.strictEqual(currentFact(events, 'religion', {}).year, '1990');
});

test('without a dated event, the last undated one is the current value (no year)', async () => {
  const { currentFact } = await load();
  const events = [ev({ id: 'p', type: 'chuyen_nha', place: 'Huế' }), ev({ id: 'q', type: 'chuyen_nha', place: 'Đà Nẵng' })];
  assert.deepStrictEqual(currentFact(events, 'place', {}), { value: 'Đà Nẵng', year: '', source: 'event', id: 'q' });
});

test('place reads the move place, a job or religion reads the description first line, then the place', async () => {
  const { currentFact } = await load();
  assert.strictEqual(currentFact([ev({ type: 'chuyen_nha', date_from: '2001', place: 'Cần Thơ', description: 'Chuyển từ A đến B' })], 'place').value, 'Cần Thơ');
  assert.strictEqual(currentFact([ev({ type: 'nghe', date_from: '2001', place: 'Bệnh viện', description: '' })], 'job').value, 'Bệnh viện');
  assert.strictEqual(currentFact([ev({ type: 'ton_giao', date_from: '2001', description: 'Công giáo\nrửa tội 1980' })], 'religion').value, 'Công giáo');
});

test('fallback: an event of another type, or an empty event, leaves the old person field as the value', async () => {
  const { currentFact, currentFacts } = await load();
  const events = [ev({ type: 'hoc', date_from: '1980', place: 'Đại học' }), ev({ type: 'nghe', date_from: '2005', description: '' })];
  assert.deepStrictEqual(currentFact(events, 'job', { job: 'Nông dân' }), { value: 'Nông dân', year: '', source: 'field' });
  const all = currentFacts([], { place: ' Củ Chi ', job: '', religion: 'Phật giáo' });
  assert.deepStrictEqual(all.place, { value: 'Củ Chi', year: '', source: 'field' });
  assert.strictEqual(all.job, null);
  assert.deepStrictEqual(all.religion, { value: 'Phật giáo', year: '', source: 'field' });
});

test('derived rows never count as the current value', async () => {
  const { currentFact } = await load();
  const events = [ev({ type: 'nghe', date_from: '2020', description: 'Chỉ hiện trên Dòng đời', derived: true })];
  assert.strictEqual(currentFact(events, 'job', { job: 'Thợ mộc' }).source, 'field');
});

test('a form link prefills the event: its type, and the field text as the place (Nơi sống) or the description', async () => {
  const { linkedEventItem } = await load();
  assert.deepStrictEqual(linkedEventItem('chuyen_nha', { place: ' Củ Chi ' }), { type: 'chuyen_nha', place: 'Củ Chi' });
  assert.deepStrictEqual(linkedEventItem('nghe', { description: 'Kỹ sư' }), { type: 'nghe', description: 'Kỹ sư' });
  assert.deepStrictEqual(linkedEventItem('hoc'), { type: 'hoc' }, 'the education link has no field: type only');
  assert.deepStrictEqual(linkedEventItem('ton_giao', { description: 'x'.repeat(300) }).description.length, 200, 'capped at 200');
  assert.strictEqual(linkedEventItem('khong_co', {}), null, 'a type that is not an event type gives nothing');
  assert.strictEqual(linkedEventItem(null, {}), null);
});
