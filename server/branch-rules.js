// Branch trees by reference (migrations/036_branch_trees.sql, branch-routes.js). Pure rules: the scope of a branch and
// the relation rows inside it. The people stay in the home tree; nothing here copies a person.
'use strict';
const crypto = require('crypto');
const G = require('./gedcom'); // branchIds: root + blood descendants + their spouses (the GEDCOM branch rule)

const NAME_MAX = 120;
const newBranchId = () => 'br-' + crypto.randomBytes(5).toString('hex');
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
// Persons of a branch as a Set of ids. rel = readRel(home): { pc, cp } with parent_id / child_id / kind and a_id / b_id.
const scopeOf = (rootId, rel) => G.branchIds(rootId, rel.pc || [], rel.cp || []);
// Relation rows with both ends in the scope (an ancestor above the root is outside the branch).
function relIn(rel, set) {
  return {
    source: rel.source, ids: [...set],
    pc: (rel.pc || []).filter((r) => set.has(r.parent_id) && set.has(r.child_id)),
    cp: (rel.cp || []).filter((r) => set.has(r.a_id) && set.has(r.b_id)),
  };
}
module.exports = { newBranchId, cleanName, scopeOf, relIn, NAME_MAX };
