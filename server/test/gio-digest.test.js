// Giỗ reminder e-mail (N1), pure parts: the 14-day window (Vietnam time), the lunar conversion across New Year, the
// living-person rule, the weekly slot and the signed unsubscribe token. No database, no network. Invented names only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const GD = require('../gio-digest');

const at = (iso) => new Date(iso); // instants given explicitly, e.g. '2027-01-25T01:00:00Z' = 08:00 Vietnam
let lunar;
test.before(async () => { lunar = await GD.loadLunar(); });

const person = (id, data) => ({ id, slug: 'thu-nghiem', data: { name: 'Nguyễn Thị Mẫu', ...data } });
const days = (items) => items.map((x) => x.day);

test('a known giỗ on the Tết day: lunar 1/1 of 2027 is 6 Feb 2027', () => {
  const p = [person('P001', { death_lunar: '1/1' })];
  assert.deepStrictEqual(days(GD.digestItems(p, lunar, at('2027-01-25T01:00:00Z'))), ['2027-02-06']);
});

test('the window is exactly 14 days from today (Vietnam time): day 13 is in, day 14 is out', () => {
  const p = [person('P001', { death_lunar: '1/1' })];
  // window Jan 24..Feb 6 (14 days): Feb 6 is the last day in
  assert.deepStrictEqual(days(GD.digestItems(p, lunar, at('2027-01-24T05:00:00Z'))), ['2027-02-06']);
  // window Jan 23..Feb 5: Feb 6 is the first day out
  assert.deepStrictEqual(days(GD.digestItems(p, lunar, at('2027-01-23T05:00:00Z'))), []);
  assert.equal(GD.WINDOW_DAYS, 14);
});

test('the window uses the Vietnam day: 23:30 UTC on Jan 23 is already Jan 24 in Vietnam', () => {
  const p = [person('P001', { death_lunar: '1/1' })];
  assert.deepStrictEqual(days(GD.digestItems(p, lunar, at('2027-01-23T23:30:00Z'))), ['2027-02-06']);
});

test('across New Year: every lunar giỗ in a window from 25 Dec 2026 matches the calendar day by day', () => {
  const now = at('2026-12-24T17:00:00Z'); // Vietnam 25 Dec 2026
  const window = []; for (let i = 0; i < 14; i++) window.push(new Date(Date.UTC(2026, 11, 25 + i)).toISOString().slice(0, 10));
  // the lunar date of each day in the window (leap months skipped: a giỗ is kept on the ordinary month)
  const expect = new Map();
  for (const iso of window) {
    const [y, m, d] = iso.split('-').map(Number);
    const L = lunar.solarToLunar(d, m, y);
    if (!L.leap) expect.set(`${L.day}/${L.month}`, iso);
  }
  const persons = [...expect.keys()].map((k, i) => person('P' + String(i + 100).padStart(3, '0'), { death_lunar: k }));
  const got = GD.digestItems(persons, lunar, now);
  for (const [k, iso] of expect) {
    const hit = got.find((x) => x.lunar === k);
    assert.ok(hit, `giỗ ${k} missing`);
    assert.equal(hit.day, iso, `giỗ ${k} day`);
  }
  assert.ok(got.some((x) => x.day.startsWith('2027-01')), 'a giỗ in January 2027 is found across New Year');
});

test('gio_lunar wins over death_lunar; a living person and a bad date are never listed', () => {
  const now = at('2027-01-25T01:00:00Z');
  const items = GD.digestItems([
    person('P001', { death_lunar: '1/1', gio_lunar: '2/1' }),
    person('P002', { death_lunar: '1/1', living: 'living' }),
    person('P003', { death_lunar: 'x/y' }),
    person('P004', {}),
  ], lunar, now);
  assert.deepStrictEqual(items.map((x) => x.id), ['P001']);
  assert.equal(items[0].lunar, '2/1');
});

test('weekly slot: Monday 07:00 Vietnam time, the previous one before it', () => {
  assert.equal(GD.weekSlot(at('2027-01-25T00:00:00Z')).toISOString(), '2027-01-25T00:00:00.000Z'); // Mon 07:00 VN
  assert.equal(GD.weekSlot(at('2027-01-25T00:30:00Z')).toISOString(), '2027-01-25T00:00:00.000Z'); // Mon 07:30 VN
  assert.equal(GD.weekSlot(at('2027-01-24T23:59:00Z')).toISOString(), '2027-01-18T00:00:00.000Z'); // Mon 06:59 VN: last week
  assert.equal(GD.weekSlot(at('2027-01-29T12:00:00Z')).toISOString(), '2027-01-25T00:00:00.000Z'); // Fri: this week's Monday
});

test('the unsubscribe token opens only for the account it was signed for', () => {
  const secret = 'test-' + 'x'.repeat(26);
  const t = GD.signUnsub('Ban.Mau@Example.test', secret);
  assert.equal(GD.openUnsub(t, secret), 'ban.mau@example.test', 'lower-cased, round-trips');
  assert.equal(GD.openUnsub(t, 'another-secret-0123456789abcdef'), null, 'wrong secret refused');
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'other@example.test', v: 1 })).toString('base64url');
  assert.equal(GD.openUnsub(`${forged}.${sig}`, secret), null, 'changed payload refused');
  assert.equal(GD.openUnsub(`${body}.`, secret), null, 'empty signature refused');
  assert.equal(GD.openUnsub('not-a-token', secret), null);
  assert.equal(GD.signUnsub('a@example.test', ''), null, 'no secret, no link');
  assert.equal(GD.openUnsub(t, ''), null, 'no secret, nothing opens');
});
