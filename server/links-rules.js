// Pure rules for "same person" links between two family trees (no DB, no express). Tested in test/links-rules.test.js.
// All trees are equal: a link only says "this record and that record are one person"; each tree keeps its own data.
'use strict';
const { ROLE_RANK } = require('./ai-perm');
const { isDead } = require('./core');

const isTop = (r) => r === 'owner' || r === 'admin';
const isPid = (s) => /^P\d{3,6}$|^N[0-9a-z-]{6,40}$/.test(String(s || ''));

// a, b: { id, family_id, deleted, data }. Returns an error message or null.
function validateLink(a, b) {
  if (!a || a.deleted) return 'Không tìm thấy người ở cây này.';
  if (!b || b.deleted) return 'Không tìm thấy người ở cây kia.';
  if (a.family_id === b.family_id) return 'Hai người cùng một cây: dùng Quan hệ thay vì liên kết.';
  const sa = a.data?.sex || ''; const sb = b.data?.sex || '';
  if (sa && sb && sa !== sb) return 'Giới tính hai người khác nhau.';
  return null;
}
// Accepted at once when the proposer is owner/admin of BOTH trees (or an editor-code session); otherwise it waits
// for an owner/admin of the other tree.
const statusFor = (roleHere, roleThere, code = false) => (code || (isTop(roleHere) && isTop(roleThere)) ? 'accepted' : 'pending');
// The other side's record is shown only when the viewer may read it there: a deceased person to anyone who can read
// that tree, a living person to members of that tree.
const canSeeOther = (otherData, roleThere, treeReadable) => !!treeReadable && (isDead(otherData || {}) || ROLE_RANK[roleThere] >= ROLE_RANK.member);
// Who decides a pending link: owner/admin of the receiving tree (b). Either side's owner/admin may remove a link.
const canDecide = (roleB) => isTop(roleB);
const canRemove = (roleA, roleB) => isTop(roleA) || isTop(roleB);
const pairKey = (fa, pa, fb, pb) => [`${fa}:${pa}`, `${fb}:${pb}`].sort().join('|');

module.exports = { validateLink, statusFor, canSeeOther, canDecide, canRemove, pairKey, isPid, isTop };
