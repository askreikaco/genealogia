// Pure path search for the relationship page (relpath.js). No DOM: the kin engine's walk only, so node tests can load it.
import { shortest } from './kin/engine.js';

// Pure path search. Returns null when no walk connects a and b, { same: true } when a === b, else:
//   nodes      person ids from a to b (hidden people stay on the path: only their name is withheld)
//   steps      the engine's steps [{ from, to, hop, kind, row }], one per link
//   viaMarriage  per step: true for a couple (spouse) hop
//   hidden     per node: true when visible(id) is false
//   apexIndex  index in nodes of the common ancestor, or -1. Set only for a pure collateral walk (up hops, then down
//              hops, no couple hop); an ancestor line or an in-law walk has no common ancestor to mark.
export function relPath(ix, a, b, { visible = () => true } = {}) {
  if (a == null || b == null) return null;
  if (a === b) return { same: true, nodes: [a], steps: [], viaMarriage: [], hidden: [!visible(a)], apexIndex: -1 };
  const best = shortest(ix, a, b);
  if (!best) return null;
  const { steps } = best;
  const nodes = [a, ...steps.map((s) => s.to)];
  const hops = steps.map((s) => s.hop);
  const down = hops.indexOf('down');
  const collateral = down > 0 && !hops.includes('spouse') && hops.slice(0, down).every((h) => h === 'up') && hops.slice(down).every((h) => h === 'down');
  return {
    same: false, nodes, steps,
    viaMarriage: hops.map((h) => h === 'spouse'),
    hidden: nodes.map((id) => !visible(id)),
    apexIndex: collateral ? down : -1,
  };
}
