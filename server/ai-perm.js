// Permission rules for AI clients (pure: no DB, no express). Tested in test/ai-perm.test.js.
// Effective role = min(the account's role in the token's family, the ceiling of the granted scopes).
// The AI never acts above the signed-in person: a scope can only lower the role, never raise it.
'use strict';

// Same order as server.js (guest < member < editor < admin < owner).
const ROLE_RANK = { guest: 0, member: 1, editor: 2, admin: 3, owner: 4 };
const SCOPES = ['read', 'suggest', 'write', 'admin'];
// The highest role a scope lets an AI act with. read/suggest stop at member: they can see what a member sees, and
// suggest; they never edit.
const SCOPE_CEILING = { read: 'member', suggest: 'member', write: 'editor', admin: 'admin' };
// A broader scope includes the narrower ones (write includes suggest and read).
const SCOPE_IMPLIES = { read: ['read'], suggest: ['read', 'suggest'], write: ['read', 'suggest', 'write'], admin: SCOPES };
// Each tool needs one scope and a minimum effective role. Admin tools never run directly: they create a request.
const TOOL_POLICY = {
  search_people: { scope: 'read', min: 'guest' },
  get_person: { scope: 'read', min: 'guest' },
  get_relatives: { scope: 'read', min: 'guest' },
  get_timeline: { scope: 'read', min: 'guest' },
  list_families: { scope: 'read', min: 'guest' },
  get_book_link: { scope: 'read', min: 'guest' },
  propose_changes: { scope: 'suggest', min: 'guest' },
  add_event: { scope: 'suggest', min: 'guest' },
  add_relation: { scope: 'suggest', min: 'guest' },
  suggest_person_change: { scope: 'suggest', min: 'guest' },
  apply_changes: { scope: 'write', min: 'editor' },
  invite_member: { scope: 'admin', min: 'admin' },
  change_role: { scope: 'admin', min: 'admin' },
  remove_member: { scope: 'admin', min: 'admin' },
};

// Keeps only known scopes, in SCOPES order, without duplicates. Empty or unknown -> null.
function normalizeScopes(list) {
  if (!Array.isArray(list)) return null;
  const set = new Set(list.map((s) => String(s)));
  if (!set.size || [...set].some((s) => !SCOPES.includes(s))) return null;
  return SCOPES.filter((s) => set.has(s));
}
// True when the granted scopes include `need` (directly or through a broader scope).
const scopeIncludes = (scopes, need) => (scopes || []).some((s) => (SCOPE_IMPLIES[s] || []).includes(need));
// The highest ceiling among the granted scopes.
function ceilingOf(scopes) {
  let best = 'guest';
  for (const s of scopes || []) if (ROLE_RANK[SCOPE_CEILING[s]] > ROLE_RANK[best]) best = SCOPE_CEILING[s];
  return best;
}
// min(user role, ceiling). An unknown user role counts as guest.
function effectiveRole(userRole, scopes) {
  const u = ROLE_RANK[userRole] ?? 0;
  const c = ROLE_RANK[ceilingOf(scopes)];
  return Object.keys(ROLE_RANK).find((r) => ROLE_RANK[r] === Math.min(u, c)) || 'guest';
}
// Whether a tool may run for this token and account role. Unknown tools are refused.
function toolAllowed(tool, scopes, userRole) {
  const p = TOOL_POLICY[tool];
  if (!p) return false;
  return scopeIncludes(scopes, p.scope) && ROLE_RANK[effectiveRole(userRole, scopes)] >= ROLE_RANK[p.min];
}
// Tools the token may see in tools/list (scope level only; the role is checked on each call).
const toolsForScopes = (scopes) => Object.keys(TOOL_POLICY).filter((t) => scopeIncludes(scopes, TOOL_POLICY[t].scope));

// Batches: at most this many records per preview / apply.
const MAX_BATCH = 200;

module.exports = { ROLE_RANK, SCOPES, SCOPE_CEILING, TOOL_POLICY, MAX_BATCH, normalizeScopes, scopeIncludes, ceilingOf,
  effectiveRole, toolAllowed, toolsForScopes };
