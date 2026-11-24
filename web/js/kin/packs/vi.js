// Vietnamese pack (locale 'vi'). Two layers: 'everyday' (what families say) and 'classical' (Hán-Việt cửu tộc names).
// Rules (the source of truth; server/test/kin.test.js pins them):
//  Ancestors (up = generations above ego; line = side of the optimal first parent link):
//    1  Cha / Mẹ
//    2  Ông / Bà + nội (paternal) | ngoại (maternal); no side word when mixed or unknown
//    3, 4  by region. bac (the national standard, default): Ông/Bà cụ, Ông/Bà kỵ. nam (per-user choice): Ông/Bà cố, Ông/Bà sơ.
//    5+  Tổ đời N; a line top (no recorded parents) at 5+ is Thủy tổ.
//  Classical ancestors: 1 Phụ / Mẫu (Khảo / Tỷ when the relative is deceased); 2 Tổ phụ / Tổ mẫu, maternal Ngoại tổ phụ / mẫu;
//    3 Tằng tổ, 4 Cao tổ, 5 Thiên tổ, 6 Liệt tổ; 7+ top Thủy tổ, else Tổ đời N.
//  Descendants: Con, Cháu, Chắt, Chút, Chít (1-5); 6+ Hậu duệ đời N. Classical: Tử, Tôn, Tằng tôn, Huyền tôn, Lai tôn,
//    Côn tôn, Nhưng tôn, Vân tôn, Nhĩ tôn (1-9).
//  Collateral:
//    sibling (1,1): elder Anh (man) / Chị (woman), younger Em; unknown age Anh/Chị/Em.
//    parent's sibling (2,1), paternal side: elder sibling of father Bác (both sexes); younger brother Chú; younger sister Cô.
//    parent's sibling, maternal side: Cậu (brother of mother), Dì (sister of mother); no age rule.
//    sibling's child (1,n): the descendant ladder (Cháu for n=2, Chắt for 3 ...).
//    cousin (a>=2, b>=2): Anh/Chị/Em họ by sex; uneven generations add "(lệch N đời)".
//  Kind: adopted adds " nuôi", step adds " kế".
//  In-law (spouse at the first / last hop, relative to ego):
//    spouse: Vợ / Chồng; spouse's parent: Bố/Mẹ + vợ|chồng (by the spouse's sex); spouse's sibling: Anh/Em|Chị/Em + vợ|chồng;
//    spouse's child: Con riêng; child's spouse: Con rể / Con dâu; step-parent: Cha kế / Mẹ kế; sibling's spouse: Anh/Em rể, Chị/Em dâu.
// Everything else falls back to a Vietnamese generic ("Họ hàng ..."), never to English.
export const reviewed = true;

const LADDER = ['Con', 'Cháu', 'Chắt', 'Chút', 'Chít'];
const CLASSICAL_DOWN = ['Tử', 'Tôn', 'Tằng tôn', 'Huyền tôn', 'Lai tôn', 'Côn tôn', 'Nhưng tôn', 'Vân tôn', 'Nhĩ tôn'];
const CLASSICAL_UP = { 3: 'Tằng tổ', 4: 'Cao tổ', 5: 'Thiên tổ', 6: 'Liệt tổ' };
const REGION_NAMES = { bac: { 3: 'cụ', 4: 'kỵ' }, nam: { 3: 'cố', 4: 'sơ' } };

const sexWord = (sex, m, f, u) => (sex === 'm' ? m : sex === 'f' ? f : u);
const gw = (sex) => sexWord(sex, 'Ông', 'Bà', 'Ông/Bà');

function ancestor(d, opts) {
  const n = d.up; const sex = d.sexOther;
  if (opts.layer === 'classical') {
    if (n === 1) return sexWord(sex, opts.deceased ? 'Khảo' : 'Phụ', opts.deceased ? 'Tỷ' : 'Mẫu', 'Phụ/Mẫu');
    if (n === 2) return d.line === 'maternal'
      ? sexWord(sex, 'Ngoại tổ phụ', 'Ngoại tổ mẫu', 'Ngoại tổ phụ/mẫu')
      : sexWord(sex, 'Tổ phụ', 'Tổ mẫu', 'Tổ phụ/mẫu');
    if (CLASSICAL_UP[n]) return CLASSICAL_UP[n];
    return d.top ? 'Thủy tổ' : `Tổ đời ${n}`;
  }
  if (n === 1) return sexWord(sex, 'Cha', 'Mẹ', 'Cha/Mẹ');
  if (n === 2) return gw(sex) + (d.line === 'paternal' ? ' nội' : d.line === 'maternal' ? ' ngoại' : '');
  if (n <= 4) {
    const names = REGION_NAMES[opts.region === 'nam' ? 'nam' : 'bac'];
    return `${gw(sex)} ${names[n]}`;
  }
  return d.top ? 'Thủy tổ' : `Tổ đời ${n}`;
}

function descendant(d, opts) {
  const n = d.down;
  if (opts.layer === 'classical') return n <= CLASSICAL_DOWN.length ? CLASSICAL_DOWN[n - 1] : `Hậu duệ đời ${n}`;
  return n <= LADDER.length ? LADDER[n - 1] : `Hậu duệ đời ${n}`;
}

function collateral(d) {
  const a = d.up; const b = d.down; const m = d.sexOther;
  if (a === 1 && b === 1) {
    if (d.elderYounger === 'younger') return 'Em';
    if (d.elderYounger === 'elder') return sexWord(m, 'Anh', 'Chị', 'Anh/Chị');
    return sexWord(m, 'Anh/Em trai', 'Chị/Em gái', 'Anh/Chị/Em');
  }
  if (a === 2 && b === 1) {
    if (d.line === 'paternal') {
      if (d.elderYounger === 'elder') return 'Bác';
      if (d.elderYounger === 'younger') return sexWord(m, 'Chú', 'Cô', 'Chú/Cô');
      return sexWord(m, 'Bác/Chú', 'Bác/Cô', 'Bác/Chú/Cô');
    }
    if (d.line === 'maternal') return sexWord(m, 'Cậu', 'Dì', 'Cậu/Dì');
    return sexWord(m, 'Bác/Chú/Cậu', 'Bác/Cô/Dì', 'Họ hàng bên nội hoặc ngoại');
  }
  if (a === 1) return LADDER[b - 1] || `Hậu duệ đời ${b}`;
  if (a >= 2 && b >= 2) {
    const base = sexWord(m, 'Anh/Em họ', 'Chị/Em họ', 'Anh/Chị/Em họ');
    return a === b ? base : `${base} (lệch ${Math.abs(a - b)} đời)`;
  }
  return `Họ hàng, ${a} đời lên, ${b} đời xuống`;
}

function inlaw(d) {
  const m = d.sexOther; const spouseSex = d.viaSexes[0];
  const owner = spouseSex === 'f' ? 'vợ' : spouseSex === 'm' ? 'chồng' : 'vợ/chồng';
  if (d.hops === 1) return sexWord(m, 'Chồng', 'Vợ', 'Bạn đời');
  if (d.spouseAt === 'first') {
    if (d.up === 1 && d.down === 0) return `${sexWord(m, 'Bố', 'Mẹ', 'Bố/Mẹ')} ${owner}`;
    if (d.up === 1 && d.down === 1) return `${sexWord(m, 'Anh/Em', 'Chị/Em', 'Anh/Chị/Em')} ${owner}`;
    if (d.up === 0 && d.down >= 1) return `${LADDER[d.down - 1] || 'Hậu duệ'} riêng`;
    if (d.up === 2 && d.down === 0) return 'Ông/Bà thông gia';
    return `Họ hàng bên ${owner}`;
  }
  if (d.spouseAt === 'last') {
    if (d.up === 0 && d.down === 1) return sexWord(m, 'Con rể', 'Con dâu', 'Con rể/dâu');
    if (d.up === 1 && d.down === 0) return sexWord(m, 'Cha kế', 'Mẹ kế', 'Cha/Mẹ kế');
    if (d.up === 1 && d.down === 1) return sexWord(m, 'Anh/Em rể', 'Chị/Em dâu', 'Anh/Chị/Em rể dâu');
  }
  return 'Họ hàng qua hôn nhân';
}

const kindSuffix = (d) => (d.kind === 'adopted' ? ' nuôi' : d.kind === 'step' ? ' kế' : '');

// Term for a descriptor (see engine.js). opts: { region: 'bac'|'nam' (default 'bac'), layer: 'everyday'|'classical', deceased }.
export function term(d, opts = {}) {
  if (d.shape === 'inlaw') return inlaw(d);
  if (d.shape === 'ancestor') return ancestor(d, opts) + kindSuffix(d);
  if (d.shape === 'descendant') return descendant(d, opts) + kindSuffix(d);
  if (d.shape === 'collateral') return collateral(d) + kindSuffix(d);
  return 'Họ hàng';
}
