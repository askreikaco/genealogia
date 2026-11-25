// Nhận quản lý rules (server/claim-rules.js): the 30-day notice, non-exclusive claims, system accounts never count as
// owners, reference trees count as unowned, approval only by an app admin after the notice, no silent ownership change.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../claim-rules');

const NOW = Date.UTC(2026, 10, 25);
const DAY = C.DAY;
const owner = (email, extra = {}) => ({ email, baseline_ms: NOW - 10 * DAY, deceased: false, ...extra });

test('notice window: 30 days from the claim, shown until it ends, then no longer public', () => {
  assert.equal(C.NOTICE_MS, 30 * DAY);
  assert.equal(C.noticeUntil(NOW), NOW + 30 * DAY);
  const claims = [{ status: 'notice', notice_until: NOW + 12 * DAY, abandoned: false }];
  assert.deepStrictEqual(C.publicNotice(claims, NOW), { until: NOW + 12 * DAY, days_left: 12, abandoned: false, count: 1 });
  assert.equal(C.publicNotice(claims, NOW + 13 * DAY), null, 'after the notice ends the banner is gone');
  assert.equal(C.publicNotice([{ status: 'rejected', notice_until: NOW + DAY, abandoned: false }], NOW), null, 'only open notices show');
});

test('approval is refused before the notice ends, and only for an app admin', () => {
  const claim = { status: 'notice', notice_until: NOW + DAY };
  assert.match(C.approveBlock({ claim, admin: true, nowMs: NOW }), /30 ngày/);
  assert.equal(C.approveBlock({ claim, admin: true, nowMs: NOW + DAY }), null, 'at the end of the notice it may be approved');
  assert.match(C.approveBlock({ claim, admin: false, nowMs: NOW + 2 * DAY }), /quản trị ứng dụng/);
  assert.match(C.approveBlock({ claim: { ...claim, status: 'approved' }, admin: true, nowMs: NOW + 2 * DAY }), /đã được xử lý/);
  assert.match(C.rejectBlock({ claim, admin: true, reason: ' ' }), /lý do/);
  assert.equal(C.rejectBlock({ claim, admin: true, reason: 'thiếu bằng chứng' }), null);
});

test('system accounts (.invalid) are never owners; reference trees count as unowned', () => {
  assert.equal(C.isSystemEmail('reference@giapha.invalid'), true);
  assert.equal(C.isSystemEmail('a@example.test'), false);
  assert.equal(C.treeState([], NOW).state, 'unowned');
  assert.equal(C.treeState([owner('reference@giapha.invalid')], NOW).state, 'unowned', 'the reference owner is not counted');
  assert.equal(C.treeState([owner('qa@x.invalid'), owner('reference@giapha.invalid')], NOW).state, 'unowned');
  assert.equal(C.treeState([owner('reference@giapha.invalid'), owner('chu@example.test')], NOW).state, 'owned', 'a real owner counts');
});

test('abandoned: every real owner inactive for a year or deceased; one active owner keeps the tree owned', () => {
  const old = NOW - 400 * DAY;
  assert.equal(C.treeState([owner('a@example.test', { baseline_ms: old })], NOW).state, 'abandoned');
  assert.equal(C.treeState([owner('a@example.test', { deceased: true })], NOW).state, 'abandoned');
  assert.equal(C.treeState([owner('a@example.test', { baseline_ms: old }), owner('b@example.test')], NOW).state, 'owned');
  assert.equal(C.treeState([owner('a@example.test', { baseline_ms: NOW - 364 * DAY })], NOW).state, 'owned', 'a year is the line');
  assert.equal(C.treeState([owner('a@example.test', { baseline_ms: null })], NOW).state, 'owned', 'unknown activity is not abandoned');
  assert.equal(C.claimable('unowned'), true); assert.equal(C.claimable('abandoned'), true); assert.equal(C.claimable('owned'), false);
});

test('ownerFacts: deceased from the person record or the handover, baseline last seen, else approved, else created', () => {
  const f = C.ownerFacts({ email: 'a@x.test', person_data: { died: '1990' }, last_seen_at: null, approved_at: null, created_at: '2020-01-01T00:00:00Z' });
  assert.equal(f.deceased, true);
  const g = C.ownerFacts({ email: 'a@x.test', deceased_email: 'a@x.test', last_seen_at: '2026-01-01T00:00:00Z' });
  assert.equal(g.deceased, true); assert.equal(g.baseline_ms, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(C.ownerFacts({ email: 'b@x.test', approved_at: '2024-02-01T00:00:00Z', created_at: '2020-01-01T00:00:00Z' }).baseline_ms, Date.parse('2024-02-01T00:00:00Z'));
});

test('claim is non-exclusive: many can be open, one per person; members and signed-out people are refused', () => {
  const base = { state: 'unowned', signedIn: true, isOwner: false, hasOpen: false };
  assert.equal(C.claimBlock(base), null);
  assert.equal(C.claimBlock({ ...base, state: 'abandoned' }), null, 'abandoned trees can be claimed too');
  assert.match(C.claimBlock({ ...base, hasOpen: true }), /đã có đơn/);
  assert.match(C.claimBlock({ ...base, state: 'owned' }), /đã có Chủ họ/);
  assert.equal(C.claimBlock({ ...base, isOwner: false }), null, 'a member of a claimable tree may claim it');
  assert.match(C.claimBlock({ ...base, isOwner: true }), /Chủ họ của cây/);
  assert.match(C.claimBlock({ ...base, signedIn: false }), /đăng nhập/);
});

test('evidence: text or one file; file types and size limited', () => {
  assert.match(C.evidenceBlock({ evidence: '  ', file: null }), /Cần ghi/);
  assert.equal(C.evidenceBlock({ evidence: 'Sổ gia phả 1960', file: null }), null);
  assert.equal(C.evidenceBlock({ evidence: '', file: { type: 'image/jpeg', bytes: 1000 } }), null);
  assert.match(C.evidenceBlock({ evidence: 'x', file: { type: 'text/html', bytes: 10 } }), /PDF, JPG hoặc PNG/);
  assert.match(C.evidenceBlock({ evidence: 'x', file: { type: 'application/pdf', bytes: C.MAX_FILE_BYTES + 1 } }), /700 KB/);
  assert.match(C.evidenceBlock({ evidence: 'x'.repeat(C.MAX_EVIDENCE + 1), file: null }), /tối đa/);
});

test('no silent change: an approval makes the claimant an owner and records who it was before', () => {
  assert.deepStrictEqual(C.approvalChange(null), { role: 'owner', status: 'active', from: null });
  assert.deepStrictEqual(C.approvalChange({ role: 'editor', status: 'active' }), { role: 'owner', status: 'active', from: { role: 'editor', status: 'active' } });
});

test('withdraw: only the claimant, only while the notice is open', () => {
  const claim = { status: 'notice', claimant_email: 'a@example.test' };
  assert.equal(C.withdrawBlock({ claim, email: 'A@example.test' }), null);
  assert.match(C.withdrawBlock({ claim, email: 'b@example.test' }), /người nộp đơn/);
  assert.match(C.withdrawBlock({ claim: { ...claim, status: 'approved' }, email: 'a@example.test' }), /đã được xử lý/);
});

test('join links: an owner or admin of the receiving tree, or an app admin, decides; others do not', () => {
  assert.equal(C.canDecideLink({ roleB: 'owner', appAdmin: false }), true);
  assert.equal(C.canDecideLink({ roleB: 'admin', appAdmin: false }), true);
  assert.equal(C.canDecideLink({ roleB: 'guest', appAdmin: true }), true, 'an unowned tree is decided by an app admin');
  assert.equal(C.canDecideLink({ roleB: 'editor', appAdmin: false }), false);
});

test('app admins come from GP_APP_ADMINS (comma list, case-insensitive)', () => {
  const admins = C.appAdmins(' Ops@Example.test, second@example.test ,');
  assert.equal(C.isAppAdmin('ops@example.test', admins), true);
  assert.equal(C.isAppAdmin('nobody@example.test', admins), false);
  assert.equal(C.isAppAdmin(null, admins), false);
});
