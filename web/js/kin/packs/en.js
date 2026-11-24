// English pack (locale 'en'), the fallback for every locale. Layer is ignored (no classical names in English).
//  Lineal: parent, grandparent, great-grandparent, great-great-grandparent, 2nd great-grandparent (5), 3rd (6) ...
//  Collateral: sibling; nephew/niece, grand-nephew/niece; uncle/aunt, great-uncle/aunt; first cousin Nth removed.
//  Kind: step -> stepfather/stepson/stepsibling ...; adopted -> adoptive parent, adopted child ...
//  In-law: spouse, parent-in-law, sibling-in-law, son/daughter-in-law, stepchild, stepparent.
export const reviewed = true;

const ORD_WORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordNum = (n) => { const v = n % 100; const s = ['th', 'st', 'nd', 'rd']; return n + ((v >= 11 && v <= 13) ? 'th' : (s[n % 10] || 'th')); };
const ordWord = (n) => ORD_WORD[n] || ordNum(n);
const greats = (k) => (k <= 0 ? '' : k === 1 ? 'great-' : k === 2 ? 'great-great-' : `${ordNum(k - 1)} great-`);

// n generations above (n >= 2 gives grand*), role is the sex-specific noun
function up(n, sex) {
  const role = sex === 'm' ? 'father' : sex === 'f' ? 'mother' : 'parent';
  if (n === 1) return role;
  if (n === 2) return `grand${role === 'parent' ? 'parent' : role}`;
  if (n === 3) return `great-grand${role}`;
  if (n === 4) return `great-great-grand${role}`;
  return `${ordNum(n - 3)} great-grand${role}`;
}
function down(n, sex) {
  const role = sex === 'm' ? 'son' : sex === 'f' ? 'daughter' : 'child';
  if (n === 1) return role;
  if (n === 2) return `grand${role}`;
  if (n === 3) return `great-grand${role}`;
  if (n === 4) return `great-great-grand${role}`;
  return `${ordNum(n - 3)} great-grand${role}`;
}

const STEP = { father: 'stepfather', mother: 'stepmother', parent: 'stepparent', son: 'stepson', daughter: 'stepdaughter', child: 'stepchild', brother: 'stepbrother', sister: 'stepsister', sibling: 'stepsibling' };
const ADOPT = { father: 'adoptive father', mother: 'adoptive mother', parent: 'adoptive parent', son: 'adopted son', daughter: 'adopted daughter', child: 'adopted child' };

function collateral(d) {
  const a = d.up; const b = d.down; const m = d.sexOther;
  if (a === 1 && b === 1) return m === 'm' ? 'brother' : m === 'f' ? 'sister' : 'sibling';
  if (a === 1) { const k = b - 2; const pre = k <= 0 ? '' : k === 1 ? 'grand-' : `${greats(k - 1)}grand-`; return `${pre}${m === 'm' ? 'nephew' : m === 'f' ? 'niece' : 'nephew/niece'}`; }
  if (b === 1) { const pre = greats(a - 2); return `${pre}${m === 'm' ? 'uncle' : m === 'f' ? 'aunt' : 'uncle/aunt'}`; }
  const removed = Math.abs(a - b);
  const rem = removed === 0 ? '' : removed === 1 ? ' once removed' : removed === 2 ? ' twice removed' : ` ${removed} times removed`;
  return `${ordWord(Math.min(a, b) - 1)} cousin${rem}`;
}

function inlaw(d) {
  const m = d.sexOther;
  if (d.hops === 1) return m === 'm' ? 'husband' : m === 'f' ? 'wife' : 'spouse';
  if (d.spouseAt === 'first') {
    if (d.down === 0) return `${up(d.up, m)}-in-law`;
    if (d.up === 1 && d.down === 1) return m === 'm' ? 'brother-in-law' : m === 'f' ? 'sister-in-law' : 'sibling-in-law';
    if (d.up === 0) return STEP[down(d.down, m)] || `step-${down(d.down, m)}`;
    return 'in-law';
  }
  if (d.spouseAt === 'last') {
    if (d.up === 0 && d.down === 1) return m === 'm' ? 'son-in-law' : m === 'f' ? 'daughter-in-law' : 'child-in-law';
    if (d.up === 1 && d.down === 0) return m === 'm' ? 'stepfather' : m === 'f' ? 'stepmother' : 'stepparent';
    if (d.up === 1 && d.down === 1) return m === 'm' ? 'brother-in-law' : m === 'f' ? 'sister-in-law' : 'sibling-in-law';
  }
  return 'relative by marriage';
}

function base(d) {
  const m = d.sexOther;
  if (d.shape === 'ancestor') return up(d.up, m);
  if (d.shape === 'descendant') return down(d.down, m);
  if (d.shape === 'collateral') return collateral(d);
  return null;
}

// Term for a descriptor (see engine.js). Always a string.
export function term(d) {
  if (d.shape === 'inlaw') return inlaw(d);
  const b = base(d);
  if (!b) return 'relative';
  if (d.kind === 'step') return STEP[b] || `step-${b}`;
  if (d.kind === 'adopted') return ADOPT[b] || `${b} (adopted)`;
  return b;
}
