// scripts/next-version.mjs: the release number a deploy gets from the last tag and the squash commit's prefix.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let V;
test.before(async () => { V = await import(pathToFileURL(path.join(__dirname, '..', '..', 'scripts', 'next-version.mjs')).href); });

test('feat -> minor (resets patch)', () => {
  assert.strictEqual(V.nextVersion({ lastTag: 'v1.80.3', pkgVersion: '1.80.0', subject: 'feat: sắp xếp theo năm (#60)' }), '1.81.0');
  assert.strictEqual(V.nextVersion({ lastTag: 'v1.80.3', subject: 'feat(tree): nút mở rộng (#61)' }), '1.81.0');
});

test('fix and the other patch types -> patch', () => {
  for (const s of ['fix: sửa lỗi (#1)', 'perf: nhanh hơn', 'refactor: gọn', 'style: căn lề', 'ops: deploy', 'docs: ghi chú', 'test: thêm', 'chore: deps']) {
    assert.strictEqual(V.nextVersion({ lastTag: 'v1.80.3', subject: s }), '1.80.4', s);
  }
});

test('feat! or type!: -> major (resets minor and patch)', () => {
  assert.strictEqual(V.nextVersion({ lastTag: 'v1.80.3', subject: 'feat!: đổi định dạng' }), '2.0.0');
  assert.strictEqual(V.nextVersion({ lastTag: 'v1.80.3', subject: 'fix(api)!: bỏ đường cũ' }), '2.0.0');
});

test('BREAKING CHANGE in the body -> major', () => {
  const body = 'Chi tiết\n\nBREAKING CHANGE: /api/x bị bỏ';
  assert.strictEqual(V.nextVersion({ lastTag: 'v1.80.3', subject: 'feat: thêm (#9)', body }), '2.0.0');
  assert.strictEqual(V.bumpKind('fix: a', 'BREAKING-CHANGE: b'), 'major');
});

test('no prefix -> patch; unknown type -> patch', () => {
  assert.strictEqual(V.nextVersion({ lastTag: 'v1.80.3', subject: 'giapha: sửa menu (#57)' }), '1.80.4');
  assert.strictEqual(V.nextVersion({ lastTag: 'v1.80.3', subject: 'Cập nhật văn bản' }), '1.80.4');
});

test('no tag -> the package.json version (the first release)', () => {
  assert.strictEqual(V.nextVersion({ lastTag: '', pkgVersion: '1.80.0', subject: 'feat: x' }), '1.80.0');
  assert.strictEqual(V.nextVersion({ pkgVersion: '1.80.0' }), '1.80.0');
});

test('bad input throws (a deploy must not stamp a guess)', () => {
  assert.throws(() => V.nextVersion({ lastTag: 'gp-v79', subject: 'fix: x' }), /not vX\.Y\.Z/);
  assert.throws(() => V.nextVersion({ lastTag: '', pkgVersion: 'dev' }), /no tag/);
});

// Regression: the two squash messages that were wrongly bumped to a major (v1.80.0 -> v2.0.0, v2.0.0 -> v3.0.0).
// Their bodies mention "BREAKING CHANGE" in a bullet, not as a footer; each must be a minor bump.
// the fixtures are real squash messages from the private repo: the public export drops them, so the test skips there
const SEMVER_FIXTURES = path.join(__dirname, 'fixtures', 'semver');
test('real squash messages with "BREAKING CHANGE" in a bullet -> minor (v1.80.0 -> v1.81.0 -> v1.82.0)',
  { skip: !fs.existsSync(SEMVER_FIXTURES) && 'private-only fixtures (not in the public export)' }, () => {
  const dir = SEMVER_FIXTURES;
  const cases = [
    ['0ef4609-release-train-2.txt', 'v1.80.0', '1.81.0'], // was v2.0.0 (#71)
    ['98b31db-release-train-3.txt', 'v1.81.0', '1.82.0'], // was v3.0.0 (#81)
  ];
  for (const [file, lastTag, expected] of cases) {
    const message = fs.readFileSync(path.join(dir, file), 'utf8');
    const [subject = '', ...rest] = message.split('\n');
    const body = rest.join('\n');
    assert.match(subject, /^feat\(giapha\): /, file);
    assert.match(body, /BREAKING CHANGE/, `${file} keeps the phrase in a bullet`);
    assert.doesNotMatch(body, /^BREAKING[ -]CHANGE:/m, `${file} has no footer`);
    assert.strictEqual(V.bumpKind(subject, body), 'minor', file);
    assert.strictEqual(V.nextVersion({ lastTag, subject, body }), expected, file);
  }
});

test('BREAKING CHANGE footer must start a line; a mention inside a line does not count', () => {
  assert.strictEqual(V.bumpKind('feat: x', 'Ghi chú: BREAKING CHANGE: không phải footer'), 'minor');
  assert.strictEqual(V.bumpKind('feat: x', '* feat! or BREAKING CHANGE -> major'), 'minor');
  assert.strictEqual(V.bumpKind('feat: x', '* note\nBREAKING CHANGE: /api/x bị bỏ'), 'major');
  assert.strictEqual(V.bumpKind('fix: x', 'BREAKING-CHANGE: y'), 'major');
  assert.strictEqual(V.bumpKind('fix: x', 'BREAKING CHANGE y'), 'patch');
});

test('a "!" in the body does not count, only before the header colon', () => {
  assert.strictEqual(V.bumpKind('fix: x', '* feat!: đổi định dạng'), 'patch');
  assert.strictEqual(V.bumpKind('fix(api)!: x', ''), 'major');
});
