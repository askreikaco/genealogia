// Kinship engine and terms (web/js/kin): paths, collateral rules, elder/younger, pedigree collapse, in-laws, adopted and
// step links, beyond-range labels, vi (nam/bac/classical), en snapshot, scaffold packs (reviewed:false), region resolver.
// Also the Tổ tiên rows: each row's link, name and label come from the same person (relgraph pedigreeRows).
// No DB. Run: npm test (server/).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const WEB = path.join(__dirname, '..', '..', 'web', 'js');
const load = async () => ({
  R: await import(pathToFileURL(path.join(WEB, 'relgraph.js')).href),
  K: await import(pathToFileURL(path.join(WEB, 'kin', 'index.js')).href),
});

// ---- fixture: one family with two sides, a spouse, in-laws, a step father, an adopted child, a 6-generation line ----
const SEX = {};
const pc = []; const cp = [];
let seq = 1;
const person = (id, sex) => { SEX[id] = sex; };
const kid = (parents, child, kind = 'ruot', bo = null) => parents.forEach((p) => pc.push({ id: seq++, parent_id: p, child_id: child, kind, birth_order: bo }));
const wed = (a, b, oa = null) => cp.push({ id: seq++, a_id: a, b_id: b, kind: 'cuoi', order_a: oa, order_b: null, start_year: null, end_year: null });
[['G5F', 'm'], ['G4F', 'm'], ['GGGF', 'm'], ['GGF', 'm'], ['GF', 'm'], ['GM', 'f'], ['FSE', 'f'], ['FE', 'm'], ['F', 'm'], ['FY', 'm'], ['FS', 'f'],
  ['C_FE', 'm'], ['CC', 'm'], ['MGGF', 'm'], ['MGF', 'm'], ['MGM', 'f'], ['MB', 'm'], ['M', 'f'], ['MS', 'f'], ['C_MB', 'f'],
  ['E', 'm'], ['ESIS', 'f'], ['EYB', 'm'], ['UX', ''], ['ST', 'm'], ['S', 'f'], ['SF', 'm'], ['SM', 'f'], ['SB', 'm'], ['SCH', 'm'],
  ['K1', 'm'], ['K2', 'f'], ['AD', 'm'], ['G1', 'm'], ['H1', 'f'], ['I1', 'm'], ['J1', 'm'], ['L1', 'f'], ['DIL', 'f'], ['BR', 'm'], ['X', 'f']]
  .forEach(([id, s]) => person(id, s));
kid(['G5F'], 'G4F', 'ruot', 1); kid(['G4F'], 'GGGF', 'ruot', 1); kid(['GGGF'], 'GGF', 'ruot', 1); kid(['GGF'], 'GF', 'ruot', 1);
wed('GF', 'GM', 1);
kid(['GF', 'GM'], 'FSE', 'ruot', 1); kid(['GF', 'GM'], 'FE', 'ruot', 2); kid(['GF', 'GM'], 'F', 'ruot', 3); kid(['GF', 'GM'], 'FY', 'ruot', 4); kid(['GF', 'GM'], 'FS', 'ruot', 5);
kid(['FE'], 'C_FE', 'ruot', 1); kid(['C_FE'], 'CC', 'ruot', 1);
kid(['MGGF'], 'MGF', 'ruot', 1); wed('MGF', 'MGM', 1);
kid(['MGF', 'MGM'], 'MB', 'ruot', 1); kid(['MGF', 'MGM'], 'M', 'ruot', 2); kid(['MGF', 'MGM'], 'MS', 'ruot', 3); kid(['MB'], 'C_MB', 'ruot', 1);
wed('F', 'M', 1);
kid(['F', 'M'], 'ESIS', 'ruot', 1); kid(['F', 'M'], 'E', 'ruot', 2); kid(['F', 'M'], 'EYB', 'ruot', 3); kid(['F', 'M'], 'UX', 'ruot', 4);
kid(['ST'], 'E', 'ke', null); wed('M', 'ST', 2);
wed('E', 'S', 1);
kid(['SF', 'SM'], 'S', 'ruot', 1); kid(['SF', 'SM'], 'SB', 'ruot', 2); wed('SF', 'SM', 1); kid(['S'], 'SCH', 'ruot', 1);
kid(['E', 'S'], 'K1', 'ruot', 1); kid(['E', 'S'], 'K2', 'ruot', 2); kid(['E'], 'AD', 'nuoi', 3);
wed('K1', 'DIL', 1);
kid(['K1'], 'G1', 'ruot', 1); kid(['G1'], 'H1', 'ruot', 1); kid(['H1'], 'I1', 'ruot', 1); kid(['I1'], 'J1', 'ruot', 1); kid(['J1'], 'L1', 'ruot', 1);
wed('ESIS', 'BR'); kid(['ESIS', 'BR'], 'X', 'ruot', 1);

const sex = (id) => SEX[id] || '';
const NAME = (id) => id;
const opts = { sex, year: () => null };

let R; let K; let ix;
test.before(async () => {
  ({ R, K } = await load());
  ix = R.index(pc, cp);
});
const dsc = (to, from = 'E') => K.kinPath(ix, from, to, opts);
const vi = (to, o = {}) => K.term(dsc(to), { locale: 'vi', ...o });
const vic = (to, o = {}) => K.term(dsc(to), { locale: 'vi', layer: 'classical', ...o });
const en = (to) => K.term(dsc(to), { locale: 'en' });

test('kinPath: paths and shapes (ancestors, descendants, collateral pivot, in-law)', () => {
  assert.deepStrictEqual([dsc('F').path, dsc('F').up, dsc('F').down, dsc('F').shape], ['F', 1, 0, 'ancestor']);
  assert.equal(dsc('GF').path, 'FF');
  assert.equal(dsc('MGF').path, 'MF');
  assert.equal(dsc('MGM').path, 'MM');
  assert.equal(dsc('ESIS').path, 'Z');
  assert.equal(dsc('EYB').path, 'B');
  assert.equal(dsc('MB').path, 'MB');
  assert.equal(dsc('C_MB').path, 'MBd', 'mother\'s brother\'s daughter');
  assert.equal(dsc('C_FE').path, 'FBs');
  assert.equal(dsc('K1').path, 's');
  assert.equal(dsc('K2').path, 'd');
  assert.equal(dsc('G1').path, 'ss');
  assert.equal(dsc('S').path, 'W');
  assert.equal(dsc('SF').path, 'WF');
  assert.equal(dsc('SB').path, 'WFs');
  assert.equal(dsc('SB').shape, 'inlaw');
  assert.equal(dsc('C_FE').shape, 'collateral');
});

test('kinPath: degrees (촌수) and the root of a relation', () => {
  assert.equal(dsc('K1').collateralDegree, 1);
  assert.equal(dsc('G1').collateralDegree, 2);
  assert.equal(dsc('ESIS').collateralDegree, 2);
  assert.equal(dsc('FE').collateralDegree, 3);
  assert.equal(dsc('C_FE').collateralDegree, 4);
  assert.equal(dsc('CC').collateralDegree, 5);
  assert.equal(dsc('G5F').top, true);
  assert.equal(dsc('G4F').top, false);
});

test('kinPath: null for the same person and for people not connected', () => {
  assert.equal(K.kinPath(ix, 'E', 'E', opts), null);
  assert.equal(K.kinPath(ix, 'E', 'NOBODY', opts), null);
});

test('line: paternal, maternal, mixed (both parents on an optimal walk)', () => {
  assert.equal(dsc('F').line, 'paternal');
  assert.equal(dsc('GF').line, 'paternal');
  assert.equal(dsc('M').line, 'maternal');
  assert.equal(dsc('MGF').line, 'maternal');
  assert.equal(dsc('ESIS').line, 'mixed', 'full siblings share both parents');
  assert.equal(dsc('K1').line, 'mixed', 'descendants have no parent side');
});

test('elder / younger: birth order at the common ancestor, against ego or ego\'s parent', () => {
  assert.equal(dsc('ESIS').elderYounger, 'elder');
  assert.equal(dsc('EYB').elderYounger, 'younger');
  assert.equal(dsc('FE').elderYounger, 'elder', 'elder brother of the father');
  assert.equal(dsc('FY').elderYounger, 'younger');
  assert.equal(dsc('FSE').elderYounger, 'elder', 'elder sister of the father');
  assert.equal(dsc('FS').elderYounger, 'younger');
  assert.equal(dsc('MB').elderYounger, 'elder');
  assert.equal(dsc('MS').elderYounger, 'younger');
  assert.equal(dsc('K1').elderYounger, null);
});

test('kind: blood, adopted, step, inlaw', () => {
  assert.equal(dsc('F').kind, 'blood');
  assert.equal(dsc('AD').kind, 'adopted');
  assert.equal(dsc('ST').kind, 'step');
  assert.equal(dsc('S').kind, 'inlaw');
  assert.equal(dsc('SCH').kind, 'inlaw');
  assert.equal(dsc('S').spouseAt, 'first');
  assert.equal(dsc('DIL').spouseAt, 'last');
});

test('pedigree collapse: a person reached by two parents is one shortest path, and pedigree draws it once', () => {
  // C2 has parents F2 and M2, both children of CG: CG is reached by two equal walks
  const fam = [['CG', 'm'], ['F2', 'm'], ['M2', 'f'], ['C2', 'm']];
  fam.forEach(([id, s]) => { SEX[id] = s; });
  const pc2 = [
    { id: 1, parent_id: 'CG', child_id: 'F2', kind: 'ruot', birth_order: 1 },
    { id: 2, parent_id: 'CG', child_id: 'M2', kind: 'ruot', birth_order: 2 },
    { id: 3, parent_id: 'F2', child_id: 'C2', kind: 'ruot', birth_order: 1 },
    { id: 4, parent_id: 'M2', child_id: 'C2', kind: 'ruot', birth_order: 1 },
  ];
  const ix2 = R.index(pc2, []);
  const d = K.kinPath(ix2, 'C2', 'CG', opts);
  assert.equal(d.up, 2);
  assert.ok(['FF', 'MF'].includes(d.path));
  assert.equal(d.line, 'mixed');
  const rows = R.pedigreeRows(ix2, 'C2', 4, NAME, (id) => K.term(K.kinPath(ix2, 'C2', id, opts), { locale: 'vi' }));
  assert.equal(rows.filter((r) => r.id === 'CG').length, 2);
  assert.equal(rows.filter((r) => r.id === 'CG' && r.repeat).length, 1, 'the second route is a repeat link, not a second subtree');
});

test('vi everyday: ancestors by side and generation (default region is the standard, bac)', () => {
  assert.equal(vi('F'), 'Cha');
  assert.equal(vi('M'), 'Mẹ');
  assert.equal(vi('GF'), 'Ông nội');
  assert.equal(vi('GM'), 'Bà nội');
  assert.equal(vi('MGF'), 'Ông ngoại');
  assert.equal(vi('MGM'), 'Bà ngoại');
  assert.equal(vi('GGF'), 'Ông cụ', 'standard: 3rd generation');
  assert.equal(vi('GGGF'), 'Ông kỵ', 'standard: 4th generation');
  assert.equal(vi('G4F'), 'Tổ đời 5', 'beyond the everyday range, not a top');
  assert.equal(vi('G5F'), 'Thủy tổ', 'top of a recorded line beyond the range');
});

test('vi everyday: region nam (per-user choice) uses the Southern 3rd/4th generation names', () => {
  assert.equal(vi('GGF', { region: 'nam' }), 'Ông cố');
  assert.equal(vi('GGGF', { region: 'nam' }), 'Ông sơ');
  assert.equal(vi('GF', { region: 'nam' }), 'Ông nội', 'generations 1-2 are the same in both regions');
  assert.equal(vi('GGF'), vi('GGF', { region: 'bac' }), 'no region argument means bac');
});

test('vi everyday: uncles and aunts by side and age (Bác / Chú / Cô / Cậu / Dì)', () => {
  assert.equal(vi('FE'), 'Bác', 'father\'s elder brother');
  assert.equal(vi('FSE'), 'Bác', 'father\'s elder sister');
  assert.equal(vi('FY'), 'Chú', 'father\'s younger brother');
  assert.equal(vi('FS'), 'Cô', 'father\'s younger sister');
  assert.equal(vi('MB'), 'Cậu', 'mother\'s brother');
  assert.equal(vi('MS'), 'Dì', 'mother\'s sister');
});

test('vi everyday: siblings, cousins and nephews', () => {
  assert.equal(vi('ESIS'), 'Chị', 'elder sister');
  assert.equal(vi('EYB'), 'Em', 'younger brother');
  assert.equal(vi('UX'), 'Em', 'younger, sex unknown');
  assert.equal(vi('C_FE'), 'Anh/Em họ');
  assert.equal(vi('C_MB'), 'Chị/Em họ');
  assert.equal(vi('CC'), 'Anh/Em họ (lệch 1 đời)');
  assert.equal(vi('X'), 'Cháu', 'sibling\'s child');
});

test('vi everyday: descendants, adopted and beyond range', () => {
  assert.equal(vi('K1'), 'Con');
  assert.equal(vi('G1'), 'Cháu');
  assert.equal(vi('H1'), 'Chắt');
  assert.equal(vi('I1'), 'Chút');
  assert.equal(vi('J1'), 'Chít');
  assert.equal(vi('L1'), 'Hậu duệ đời 6');
  assert.equal(vi('AD'), 'Con nuôi');
  assert.equal(vi('ST'), 'Cha kế');
});

test('vi in-laws: spouse, parents and siblings of the spouse, child\'s spouse, sibling\'s spouse', () => {
  assert.equal(vi('S'), 'Vợ');
  assert.equal(vi('SF'), 'Bố vợ');
  assert.equal(vi('SM'), 'Mẹ vợ');
  assert.equal(vi('SB'), 'Anh/Em vợ');
  assert.equal(vi('SCH'), 'Con riêng');
  assert.equal(vi('DIL'), 'Con dâu');
  assert.equal(vi('BR'), 'Anh/Em rể');
});

test('vi classical layer: cửu tộc names, khảo/tỷ when deceased, ngoại tổ, Hán-Việt descent', () => {
  assert.equal(vic('F'), 'Phụ');
  assert.equal(vic('F', { deceased: true }), 'Khảo');
  assert.equal(vic('M', { deceased: true }), 'Tỷ');
  assert.equal(vic('M'), 'Mẫu');
  assert.equal(vic('GF'), 'Tổ phụ');
  assert.equal(vic('MGF'), 'Ngoại tổ phụ');
  assert.equal(vic('MGM'), 'Ngoại tổ mẫu');
  assert.equal(vic('GGF'), 'Tằng tổ');
  assert.equal(vic('GGGF'), 'Cao tổ');
  assert.equal(vic('K1'), 'Tử');
  assert.equal(vic('G1'), 'Tôn');
  assert.equal(vic('H1'), 'Tằng tôn');
  assert.equal(vic('I1'), 'Huyền tôn');
  assert.equal(vic('J1'), 'Lai tôn');
  assert.equal(vic('L1'), 'Côn tôn');
});

test('en snapshot: lineal, collateral, cousins, in-laws, step and adopted', () => {
  const table = {
    F: 'father', M: 'mother', GF: 'grandfather', GGF: 'great-grandfather', GGGF: 'great-great-grandfather',
    G4F: '2nd great-grandfather', G5F: '3rd great-grandfather', ST: 'stepfather',
    ESIS: 'sister', EYB: 'brother', FE: 'uncle', FS: 'aunt', MB: 'uncle', MS: 'aunt',
    C_FE: 'first cousin', CC: 'first cousin once removed', X: 'niece', BR: 'brother-in-law',
    K1: 'son', K2: 'daughter', G1: 'grandson', H1: 'great-granddaughter', I1: 'great-great-grandson', J1: '2nd great-grandson', L1: '3rd great-granddaughter',
    AD: 'adopted son', S: 'wife', SF: 'father-in-law', SM: 'mother-in-law', SB: 'brother-in-law', SCH: 'stepson', DIL: 'daughter-in-law',
  };
  for (const [id, expected] of Object.entries(table)) assert.equal(en(id), expected, id);
});

test('scaffold packs: reviewed:false, direct lines only, anything else falls back to en', () => {
  for (const loc of ['zh-Hans', 'zh-Hant', 'ja', 'ko']) assert.equal(K.reviewed(loc), false, loc);
  assert.equal(K.reviewed('vi'), true);
  assert.equal(K.term(dsc('F'), { locale: 'zh-Hans' }), '父亲');
  assert.equal(K.term(dsc('MGF'), { locale: 'zh-Hant' }), '外祖父');
  assert.equal(K.term(dsc('K1'), { locale: 'ja' }), '息子');
  assert.equal(K.term(dsc('F'), { locale: 'ko' }), '아버지');
  assert.equal(K.term(dsc('MB'), { locale: 'zh-Hans' }), 'uncle', 'collateral is not in the scaffold: en fallback');
  assert.equal(K.term(dsc('G4F'), { locale: 'ja' }), '2nd great-grandfather', 'beyond ±4: en fallback');
  assert.equal(K.degree(dsc('FE'), 'ko'), '3촌');
  assert.equal(K.degree(dsc('S'), 'ko'), null, 'in-laws have no 촌수 here');
});

test('region resolver: only the user\'s own choice counts; default and unknown values are the standard (bac)', () => {
  assert.equal(K.resolveRegion('nam'), 'nam');
  assert.equal(K.resolveRegion('chuan'), 'bac');
  assert.equal(K.resolveRegion(undefined), 'bac');
  assert.equal(K.resolveRegion(''), 'bac');
  assert.equal(K.resolveRegion('auto'), 'bac', 'no auto-from-region rule');
  assert.equal(K.resolveRegion('bogus'), 'bac');
});

// Tổ tiên rows: P092-style data. The child's father is P088; the child's other parent is a spouse record (N-sp-*) of P088.
test('Tổ tiên rows: each row link, name and label are one person (second parents and spouse records)', () => {
  const names = { P092: 'Vương Văn Thử', P088: 'Vương Hữu Dụ', 'N-sp-p088-1': 'Võ Thị Sen', P073: 'Vương Đức Nghĩa', 'N-sp-p073-1': 'Trần Thị Loan' };
  const sx = { P092: 'm', P088: 'm', 'N-sp-p088-1': 'f', P073: 'm', 'N-sp-p073-1': 'f' };
  const pcA = [
    { id: 1, parent_id: 'P088', child_id: 'P092', kind: 'ruot', birth_order: null },
    { id: 2, parent_id: 'N-sp-p088-1', child_id: 'P092', kind: 'ruot', birth_order: null },
    { id: 3, parent_id: 'P073', child_id: 'P088', kind: 'ruot', birth_order: 1 },
    { id: 4, parent_id: 'N-sp-p073-1', child_id: 'P088', kind: 'ruot', birth_order: 1 },
  ];
  const cpA = [{ id: 5, a_id: 'P088', b_id: 'N-sp-p088-1', kind: 'cuoi', order_a: 1, order_b: null }];
  const ixA = R.index(pcA, cpA);
  const nameOf = (id) => names[id] || '(chưa có tên)';
  const labelOf = (id) => K.term(K.kinPath(ixA, 'P092', id, { sex: (x) => sx[x] || '' }), { locale: 'vi' });
  const rows = R.pedigreeRows(ixA, 'P092', 4, nameOf, labelOf);
  const cha = rows.find((r) => r.gen === 1 && r.label === 'Cha');
  assert.ok(cha, 'father row exists');
  assert.equal(cha.id, 'P088', 'the Cha row links to the father, not to a spouse record');
  assert.equal(cha.name, 'Vương Hữu Dụ');
  const mother = rows.find((r) => r.gen === 1 && r.label === 'Mẹ');
  assert.equal(mother.id, 'N-sp-p088-1');
  assert.equal(mother.name, 'Võ Thị Sen');
  for (const r of rows) assert.equal(r.name, nameOf(r.id), `row ${r.id}: link, name and label come from one person`);
});

// Tổ tiên chain: the fold ghost and the Thủy tổ sit right after the last visible father-line ancestor (the Thủy tổ one
// indent deeper), the hidden generations between them; a woman with a recorded father has her own line under her.
test('Tổ tiên chain: fold ghost and Thủy tổ in the slot after the last visible father, hidden rows between', async () => {
  const { R } = await load();
  // C -> F1 -> G2 -> G3 -> G4 -> G5 -> G6 (fathers, all 'm'); each father has a mother beside him (M1..M6); MG5 is the
  // mother of M5, so ancestors deeper than the root are hidden with the middle
  const pcC = []; const sexC = { C: 'f' };
  const line = ['F1', 'G2', 'G3', 'G4', 'G5', 'G6'];
  let k = 1; let child = 'C';
  for (const f of line) { sexC[f] = 'm'; pcC.push({ id: k++, parent_id: f, child_id: child, kind: 'ruot', birth_order: 1 }); child = f; }
  line.forEach((f, i) => { const m = 'M' + (i + 1); sexC[m] = 'f'; pcC.push({ id: k++, parent_id: m, child_id: f, kind: 'ruot', birth_order: 2 }); });
  sexC.MG5 = 'f'; pcC.push({ id: k++, parent_id: 'MG5', child_id: 'M5', kind: 'ruot', birth_order: 1 });
  const ix = R.index(pcC, []);
  const sexOf = (x) => sexC[x] || '';
  assert.deepEqual(R.paternalLine(ix, 'C', sexOf), line, 'the father line, father first');
  assert.deepEqual(R.paternalLine(R.index([], []), 'C', sexOf), [], 'no father on record: empty line');
  const items = R.ancestorChain(ix, 'C', sexOf, 4);
  const shape = items.map((it) => (it.type === 'fold' ? `fold@${it.d}` : `${it.type} ${it.id}@${it.d}`));
  assert.deepEqual(shape, [
    'row F1@1', 'row G2@2', 'row G3@3', 'row G4@4',
    'fold@5', 'root G6@5',
    'row M3@4', 'row M2@3', 'row M1@2',
  ], 'Ông kỵ, fold, Thủy tổ (one deeper), then the wives as before');
  const fold = items.find((it) => it.type === 'fold');
  const body = fold.body.map((it) => it.id);
  assert.deepEqual(body, ['G5', 'M6', 'M5', 'MG5', 'M4'], 'hidden rows in walk order');
  assert.deepEqual([fold.gens, fold.people], [3, 5], 'generations 5 to 7 are folded; five people');
  assert.deepEqual(fold.tiles, ['G5', 'M6', 'M5'], 'the ghost shows up to three of the folded people');
  assert.equal(items.find((it) => it.type === 'root').mother, false, 'the person\'s own Thủy tổ, not a mother line');
  // short chain: nothing hidden, no fold, the root is a plain row at its own generation
  const short = R.layoutLevel(R.ancestorGroups(ix, 'C', sexOf).filter((g) => g.gen <= 3 || g.id === 'G6'), 0, line, 4);
  assert.ok(!short.some((it) => it.type === 'fold'), 'no fold');
  assert.deepEqual(short.filter((it) => it.type === 'root').map((it) => [it.id, it.d]), [['G6', 6]], 'root kept at its own depth');
  // no father on record: no root, the fold closes the chain
  const none = R.layoutLevel(R.ancestorGroups(ix, 'C', sexOf), 0, [], 4);
  assert.equal(none.at(-1).type, 'fold', 'the fold closes the chain');
  assert.ok(!none.some((it) => it.type === 'root'), 'no root row');
});

// A woman with a recorded father has her own line under her (a ghost row "Họ X · N đời" that ends with her Thủy tổ).
test('Tổ tiên chain: a mother line under her, ending with her own Thủy tổ; a woman without a father gets nothing extra', async () => {
  const { R } = await load();
  // C (f) <- F1 (m) <- G2 (m) <- G3 (m, the Thủy tổ); F1's wife M2 (f, no parents); C's mother W1 (f) <- V1 (m) <- V2 (m) <- V3 (m)
  const sex = { C: 'f', F1: 'm', G2: 'm', G3: 'm', M2: 'f', W1: 'f', V1: 'm', V2: 'm', V3: 'm' };
  const pc = [
    { id: 1, parent_id: 'F1', child_id: 'C', kind: 'ruot', birth_order: 1 },
    { id: 2, parent_id: 'W1', child_id: 'C', kind: 'ruot', birth_order: 2 },
    { id: 3, parent_id: 'G2', child_id: 'F1', kind: 'ruot', birth_order: 1 },
    { id: 4, parent_id: 'M2', child_id: 'F1', kind: 'ruot', birth_order: 2 },
    { id: 5, parent_id: 'G3', child_id: 'G2', kind: 'ruot', birth_order: 1 },
    { id: 6, parent_id: 'V1', child_id: 'W1', kind: 'ruot', birth_order: 1 },
    { id: 7, parent_id: 'V2', child_id: 'V1', kind: 'ruot', birth_order: 1 },
    { id: 8, parent_id: 'V3', child_id: 'V2', kind: 'ruot', birth_order: 1 },
  ];
  const ix = R.index(pc, []);
  const sexOf = (x) => sex[x] || '';
  const items = R.ancestorChain(ix, 'C', sexOf, 4);
  const top = items.map((it) => `${it.type} ${it.id}@${it.d}${it.ghost ? ' +ghost' : ''}`);
  assert.deepEqual(top, ['row F1@1', 'row G2@2', 'root G3@3', 'row M2@2', 'row W1@1 +ghost'], 'the mother W1 carries a ghost; M2 (no father) has none');
  assert.equal(items.at(-1).ghost.d, 2, 'her ghost sits one indent under her');
  assert.equal(items.at(-1).ghost.n, 3, 'Họ X · 3 đời');
  assert.equal(items.at(-1).ghost.root, 'V3', 'her line ends with its Thủy tổ');
  assert.deepEqual(items.at(-1).ghost.items.map((it) => `${it.type} ${it.id}@${it.d}${it.mother ? ' mother' : ''}`),
    ['row V1@2', 'row V2@3', 'root V3@4 mother'], 'her line in place: father, grandfather, then the Thủy tổ họ');
  assert.equal(items.find((it) => it.id === 'M2').ghost, null, 'a woman without a recorded father shows nothing extra');
  // her line folds inside its own depth limit: with one visible generation below her, V2 folds and V3 is her Thủy tổ
  const inner = R.layoutLevel(R.ancestorGroups(ix, 'C', sexOf).find((g) => g.id === 'W1').ghost.groups, 1, R.paternalLine(ix, 'W1', sexOf), 1);
  assert.deepEqual(inner.map((it) => (it.type === 'fold' ? `fold@${it.d} gens ${it.gens} people ${it.people}` : `${it.type} ${it.id}@${it.d}`)),
    ['row V1@2', 'fold@3 gens 1 people 1', 'root V3@3'], 'the fold inside her line, the Thủy tổ after it');
});
