// Guard (owner 2026-11-24): every delete / remove / leave / sign-out-all control in web/js is made with the shared
// destructive-action component (web/js/danger.js) and confirmed with confirmDanger. Fails on a hand-made one.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'web', 'js');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
// a destructive label as a button / menu-item / row text: right after > or a quote
const LABEL = /(?:>|['"`])\s*(Xóa|Xoá|Gỡ|Rời dòng họ|Đăng xuất tất cả|Rút lại|Bỏ nháp|Bỏ)(?=[\s<'"`(:…]|$)/u;
// not destructive: filters, form-local chips/rows not saved yet, unfollow, selection
// Bỏ phiếu = cast a vote (the vote card's group label), not a removal.
const EXEMPT = /Xóa lọc|Xoá lọc|Xóa tất cả|Bỏ lọc|Bỏ theo dõi|Bỏ chọn|Bỏ người này|Bỏ nguồn|Bỏ gắn|Bỏ qua|Gỡ rối|Bỏ phiếu/u;
const OK = /dangerButton\(|dangerItem\(|dangerLabel\(|dangerZone\(|confirmDanger\(|data-danger/;

test('danger.js exists and exports the shared component', () => {
  const src = fs.readFileSync(path.join(DIR, 'danger.js'), 'utf8');
  for (const n of ['dangerButton', 'dangerZone', 'dangerItem', 'dangerLabel', 'confirmDanger']) assert.match(src, new RegExp(`export (const|function) ${n}\\b`), n);
});

test('every destructive label in web/js goes through the shared component', () => {
  const bad = [];
  for (const f of files) {
    if (f === 'danger.js') continue;
    fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return; // comments
      const m = LABEL.exec(line); if (!m) return;
      if (EXEMPT.test(line) && !LABEL.exec(line.replace(new RegExp(EXEMPT.source, 'gu'), ''))) return;
      if (!OK.test(line)) bad.push(`${f}:${i + 1}: "${m[1]}" ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepStrictEqual(bad, [], 'make these with dangerButton / dangerItem / dangerLabel / dangerZone + confirmDanger');
});

test('no destructive question uses the generic confirm', () => {
  const bad = [];
  for (const f of files) {
    fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
      if (/(confirmDialog|confirmModal|deps\.confirm)\(\{?\s*(title:\s*)?[`'"](Xóa|Xoá|Gỡ|Rời|Rút|Bỏ|Đăng xuất tất cả)/u.test(line)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(bad, [], 'use confirmDanger for destructive questions');
});

test('files that call DELETE import the shared confirm (place unlink keeps the written text: exempt)', () => {
  const bad = files.filter((f) => f !== 'places.js' && f !== 'danger.js')
    .filter((f) => { const s = fs.readFileSync(path.join(DIR, f), 'utf8'); return /method:\s*'DELETE'/.test(s) && !/from '\.\/danger\.js'/.test(s); });
  assert.deepStrictEqual(bad, []);
});
