// Book page wording: the chrome (toolbar, sheets, cover, section headings, fact labels) in Vietnamese or English, and the
// "child of" line from the kin module (Cách gọi: the shared kinRegion setting). Printed names and dates are data, not text.
import { term, lineDesc, resolveRegion, KIN_REGION_KEY } from './kin/index.js';

export const LANGS = ['vi', 'en'];
export const REGIONS = ['chuan', 'nam'];
const T = {
  search: ['Tìm người trong sách', 'Find a person in the book'],
  childOfReg: ['con của', 'child of'],
  filters: ['Bộ lọc', 'Filters'],
  settings: ['Cài đặt', 'Settings'],
  share: ['Chia sẻ', 'Share'],
  apply: ['Áp dụng', 'Apply'],
  reset: ['Xóa tất cả', 'Clear all'],
  close: ['Đóng', 'Close'],
  notFound: ['Không tìm thấy', 'No match'],
  people: ['người', 'people'],
  start: ['Bắt đầu từ', 'Start from'],
  wholeFamily: ['Cả họ (từ tổ tiên đầu)', 'Whole family (from the first ancestor)'],
  direction: ['Hướng', 'Direction'],
  down: ['Hậu duệ', 'Descendants'],
  up: ['Tổ tiên', 'Ancestors'],
  both: ['Cả hai', 'Both'],
  gens: ['Số đời', 'Generations'],
  all: ['Tất cả', 'All'],
  genWord: ['đời', 'gen'],
  spouses: ['Kèm vợ/chồng', 'Include spouses'],
  daughters: ['Con cháu của con gái', "Daughters' descendants"],
  full: ['Ghi đầy đủ', 'Full record'],
  nameOnly: ['Chỉ ghi tên con gái', 'Name only'],
  status: ['Tình trạng', 'Status'],
  living: ['Đang sống', 'Living'],
  dead: ['Đã khuất', 'Deceased'],
  settingsTitle: ['Cài đặt sách', 'Book settings'],
  colour: ['Màu', 'Colour'],
  themeClassic: ['Cổ điển', 'Classic'],
  themeCalm: ['Trang nhã', 'Calm'],
  themeModern: ['Hiện đại', 'Modern'],
  font: ['Phông chữ', 'Font'],
  fontSerif: ['Có chân (serif)', 'Serif'],
  fontSans: ['Không chân (sans)', 'Sans'],
  size: ['Cỡ chữ', 'Text size'],
  sizeS: ['Nhỏ', 'Small'], sizeM: ['Vừa', 'Medium'], sizeL: ['Lớn', 'Large'],
  layout: ['Kiểu gia phả', 'Layout'],
  layoutGen: ['Phổ hệ theo đời', 'By generation'],
  layoutBranch: ['Theo nhánh', 'By branch'],
  layoutSummary: ['Tóm tắt', 'Summary'],
  hideLiving: ['Ẩn hồ sơ riêng tư', 'Hide living people'],
  living2: ['Người còn sống', 'Living person'],
  privateLabel: ['Riêng tư', 'Private'],
  showCodes: ['Hiện mã người', 'Show person codes'],
  codeLabel: ['Mã', 'Code'],
  language: ['Ngôn ngữ', 'Language'],
  paper: ['Khổ', 'Page'], landscape: ['Ngang', 'Landscape'], portrait: ['Dọc', 'Portrait'],
  langVi: ['Tiếng Việt', 'Vietnamese'],
  langEn: ['English', 'English'],
  terms: ['Cách gọi', 'Address terms'],
  termsStd: ['Chuẩn', 'Standard'],
  termsSouth: ['Miền Nam', 'Southern'],
  print: ['In / Lưu PDF', 'Print / Save PDF'],
  embed: ['Mã nhúng (iframe)', 'Embed code (iframe)'],
  copy: ['Sao chép liên kết', 'Copy link'],
  copied: ['Đã sao chép liên kết', 'Link copied'],
  from: ['Từ', 'From'], chosen: ['người đã chọn', 'selected person'],
  daughtersTag: ['Con gái: chỉ tên', 'Daughters: names only'], noSpouses: ['Không kèm vợ/chồng', 'Without spouses'],
  days: ['ngày', 'days'],
  indexNote: ['Xếp theo tên (chữ cuối). Số bên phải là số mục.', 'Sorted by the last word of the name. Figures on the right are entry numbers.'],
  places: ['chỗ. Bà con biết xin bổ sung trên {site}.', 'places. Family members can add details on {site}.'],
  gensWord: ['Đời', 'Gen.'],
  fromAncestor: ['Từ cụ tổ', 'From the founding ancestor'],
  childrenCount: ['người con', 'children'],
  descCount: ['con cháu đã ghi', 'descendants recorded'],
  livesAt: ['Sống tại', 'Lives in'],
  loading: ['Đang dựng sách…', 'Building the book…'],
  // cover
  cover: ['Gia phả', 'Family genealogy'],
  gensCount: ['đời', 'generations'],
  printedOn: ['In ngày', 'Printed on'],
  // section headings and pages
  foreword: ['Lời đầu sách', 'Foreword'],
  contents: ['Mục lục', 'Contents'],
  gen13: ['Đời 1 – 3 · Cụ tổ và các ông', 'Generations 1–3'],
  giotitle: ['Lịch giỗ âm lịch', 'Death anniversaries (lunar)'],
  indexTitle: ['Tra tên theo vần', 'Name index'],
  verifyTitle: ['Cần bổ sung, xác minh', 'To add or verify'],
  genLabel: ['ĐỜI THỨ', 'GENERATION'],
  branch: ['Tông chi', 'Branch'],
  toVerify: ['Cần xác minh', 'To verify'],
  // fact labels
  born: ['Sinh', 'Born'], died: ['Mất', 'Died'], anniv: ['Giỗ', 'Anniversary'], lives: ['Sống ở', 'Lives in'],
  alias: ['Tên khác', 'Other name'], job: ['Nghề', 'Occupation'], religion: ['Đạo', 'Religion'], burial: ['An táng', 'Burial'],
  husband: ['Chồng', 'Husband'], wife: ['Vợ', 'Wife'], married: ['cưới', 'married'],
  lunar: ['ÂL', 'lunar'],
};

// Chrome string in the book's language (Vietnamese when the key or language is missing).
export function tx(key, lang = 'vi') {
  const e = T[key];
  if (!e) return key;
  return lang === 'en' ? e[1] : e[0];
}

// The region in use: the app's own Cách gọi setting (localStorage kinRegion), 'chuan' when none.
export function kinRegionPref() {
  try { return resolveRegion(localStorage.getItem(KIN_REGION_KEY) || 'chuan'); } catch { return 'bac'; }
}
export const setKinRegion = (pref) => { try { localStorage.setItem(KIN_REGION_KEY, pref); } catch {} };

// "child of" line: how the child's line reads from the parent, e.g. "con Ông Dương Văn A" / "son of father X".
// childSex is 'm' | 'f' | ''; parent is the person record (name, sex) or null.
export function childOf(parent, childSex, lang = 'vi', region = 'bac') {
  if (!parent) return '';
  if (lang === 'en') {
    const child = term(lineDesc(0, 1, childSex), { locale: 'en', region });
    const up = term(lineDesc(1, 0, parent.sex || ''), { locale: 'en', region });
    return `${child} of ${up} ${parent.name}`;
  }
  const child = term(lineDesc(0, 1, childSex), { locale: 'vi', region });
  return `${child.toLowerCase()} ${parent.sex === "f" ? "bà" : "ông"} ${parent.name}`;
}
