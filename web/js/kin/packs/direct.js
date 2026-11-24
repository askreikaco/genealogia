// Scaffold helper for the unreviewed locale packs: direct-line terms only (1-4 generations, either direction).
// T = { up: {n: {m, f, u}}, maternal: {n: {m, f, u}}, down: {n: {m, f, u}} }. Anything else returns undefined,
// so index.js falls back to the English pack.
const pick = (row, sex) => (sex === 'm' ? row.m : sex === 'f' ? row.f : row.u);
export function directPack(T) {
  return (d) => {
    if (d.shape === 'ancestor' && d.up >= 1 && d.up <= 4) {
      const row = d.line === 'maternal' && T.maternal[d.up] ? T.maternal[d.up] : T.up[d.up];
      return pick(row, d.sexOther);
    }
    if (d.shape === 'descendant' && d.down >= 1 && d.down <= 4) return pick(T.down[d.down], d.sexOther);
    return undefined;
  };
}
