// Member-notification fan-out (decisions notifyMembers, news notify, trash notify and warnings) never reaches a system
// account (.invalid only, see system-accounts.js). Same rule as electorate(): the member query carries SYSTEM_MEMBER_SQL.
// Source-level check, like council.test.js: the queries are inline in the modules and need a database to run.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('system-accounts helper: .invalid-only accounts are system, real accounts are not', () => {
  const SA = require('../system-accounts');
  assert.strictEqual(SA.isSystemAccount({ emails: ['qa@giapha.invalid'] }), true);
  assert.strictEqual(SA.isSystemAccount({ emails: ['qa@giapha.invalid', 'real@example.test'] }), false);
  assert.strictEqual(SA.isSystemAccount({ emails: [] }), false);
  assert.match(SA.SYSTEM_MEMBER_SQL, /members\.email like '%\.invalid'/);
});

test('decisions notifyMembers excludes system accounts', () => {
  const src = read('decisions.js');
  const fn = src.slice(src.indexOf('async function notifyMembers'), src.indexOf('// Owners whose "đã mất"'));
  assert.match(fn, /query\(`select email from members where family_id=\$1 and status='active' and email is not null and not \$\{SYSTEM_MEMBER_SQL\}`/); // a template literal: the SQL is interpolated
});

test('news notify and admin fan-out exclude system accounts', () => {
  const src = read('news.js');
  assert.match(src, /require\('\.\/system-accounts'\)/);
  const mem = src.slice(src.indexOf('async function memberEmails'), src.indexOf('// In-app notice and mail to members'));
  assert.match(mem, /and email is not null and not \$\{SYSTEM_MEMBER_SQL\}`, \[famId\]/);
  assert.match(mem, /role in \('owner','admin'\) and email is not null and not \$\{SYSTEM_MEMBER_SQL\}`/);
});

test('trash recipients and archive warnings exclude system accounts', () => {
  const src = read('trash.js');
  assert.match(src, /require\('\.\/system-accounts'\)/);
  const rec = src.slice(src.indexOf('async function recipients'), src.indexOf('async function notify('));
  assert.match(rec, /role in \('owner','admin'\) and not \$\{SYSTEM_MEMBER_SQL\}/);
  const warn = src.slice(src.indexOf('async function warnRecipients'), src.indexOf('async function warnDue'));
  assert.match(warn, /role in \('owner','admin'\) and not \$\{SYSTEM_MEMBER_SQL\}/);
});
