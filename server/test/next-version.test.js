// scripts/next-version.mjs: the release number a deploy gets from the last tag and the squash commit's prefix.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
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
