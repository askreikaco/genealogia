// Deterministic FICTIONAL demo family for tests and local runs: writes server/seed/demo-persons.json.
// Every name is invented from the pools below (a made-up family surname, plain given names); places are public
// provinces and cities; notes and sources say "dữ liệu mẫu" (sample data). Same output on every run (seeded PRNG).
// Shape = the production person record: [{ id: 'P001', data: { gen, thu, name, sex, order, parent, place, note,
// source, spouse, verify, born, died, alias, death_lunar, gio_lunar } }], parents listed before their children.
// Generation sizes follow a 9-generation tree of ~300 people (1, 2, 4, 18, 85, 110, 65, 18, 2 by generation).
//
// Usage (repo root):
//   node scripts/make-demo-seed.mjs            write server/seed/demo-persons.json
//   node scripts/make-demo-seed.mjs --check    exit 1 if the committed file differs from the generator output
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'seed', 'demo-persons.json');

let s = 0x5eed2026; // mulberry32
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

const SURNAME = 'Giả'; // invented family name for the demo tree ("giả" = fake)
const MID_M = ['Văn', 'Minh', 'Đức', 'Quang', 'Hữu', 'Thanh', 'Công', 'Ngọc'];
const MID_F = ['Thị', 'Ngọc', 'Thanh', 'Kim', 'Mỹ', 'Bích', 'Như', 'Thu'];
const GIVEN_M = ['An', 'Cảnh', 'Duy', 'Định', 'Gia', 'Hiển', 'Khang', 'Khôi', 'Lạc', 'Nghĩa', 'Nhân', 'Phúc', 'Quý', 'Sang', 'Tài', 'Thắng', 'Tín', 'Toàn', 'Trí', 'Trung', 'Tuấn', 'Vĩnh', 'Vượng', 'Xuân', 'Yên', 'Lộc', 'Kiệt', 'Hòa', 'Bình', 'Tịnh'];
const GIVEN_F = ['Cúc', 'Diệu', 'Duyên', 'Giao', 'Hạnh', 'Hiền', 'Huệ', 'Khuê', 'Lài', 'Loan', 'Mận', 'Ngân', 'Nhàn', 'Oanh', 'Phấn', 'Quyên', 'Sen', 'Thoa', 'Thục', 'Trâm', 'Tuyết', 'Uyên', 'Vân', 'Xuyến', 'Đào', 'Hoa', 'Ánh', 'Liễu', 'Mai', 'Nguyệt'];
// married-in people: two-part given names, so they do not reuse the bloodline's given-name pools
const SPOUSE_GIVEN_F = ['Bạch Liên', 'Tố Uyên', 'Hồng Đào', 'Ánh Tuyết', 'Phương Thảo', 'Mộng Điệp', 'Ý Nhi', 'Thúy Hằng', 'Cẩm Tú', 'Hà Vi', 'Lệ Thủy', 'Ngọc Diệp', 'Kiều Oanh', 'Thiên Hương', 'Quỳnh Giao', 'Yến Nhi', 'Mỹ Linh', 'Đan Quế', 'Hoài Châu', 'Vân Khánh'];
const SPOUSE_GIVEN_M = ['Hữu Phước', 'Đăng Khoa', 'Bá Lộc', 'Thành Đạt', 'Quốc Bảo', 'Minh Triết', 'Công Danh', 'Gia Huy', 'Tấn Phát', 'Trọng Nghĩa'];
const OTHER_SURNAMES = ['Giả Ảo', 'Lý Mộng', 'Thạch Hư', 'Kiều Tưởng', 'Đoàn Huyễn', 'Mạc Giả Ảnh', 'Tô Vô Danh', 'Hứa Ảo Ảnh', 'Chu Giả Tạo', 'Đinh Mộng Mị'];
const PLACES = ['Bình Dương', 'Tây Ninh', 'Long An', 'Tiền Giang', 'Đồng Nai', 'Bến Tre', 'Cần Thơ', 'Huế', 'Quảng Nam', 'Bình Định', 'Hà Nội', 'Nam Định', 'Đà Lạt', 'Vũng Tàu', 'TP Hồ Chí Minh'];
const ALIASES = ['Út', 'Bé', 'Hai', 'Tư', 'Sáu', 'Tám'];
const VERIFY = ['Thiếu tên', 'Thiếu con cháu', 'Thiếu thông tin', 'Năm sinh chưa chắc'];
const SOURCE = 'Dữ liệu mẫu (demo)';
const NOTES = ['Ghi chú mẫu: thông tin minh họa, không phải người thật.', 'Dữ liệu mẫu: từng đi học xa nhà, sau về quê làm ruộng và dạy chữ cho con cháu trong làng.', 'Dữ liệu mẫu: gia đình chuyển vào Nam lập nghiệp, giữ giỗ tổ hằng năm.'];

const used = new Set();
function nameFor(sex) {
  const mids = sex === 'm' ? MID_M : MID_F; const givens = sex === 'm' ? GIVEN_M : GIVEN_F;
  for (let i = 0; i < 2000; i++) {
    const n = `${SURNAME} ${pick(mids)} ${pick(givens)}`;
    if (!used.has(n)) { used.add(n); return n; }
  }
  throw new Error('name pool exhausted: widen MID_* or GIVEN_*');
}
const spouseOf = (sex) => (sex === 'm' ? `${pick(OTHER_SURNAMES)} Thị ${pick(SPOUSE_GIVEN_F)}` : `(chồng: ${pick(OTHER_SURNAMES)} ${pick(SPOUSE_GIVEN_M)})`);
const lunar = () => `${1 + Math.floor(rnd() * 29)}/${1 + Math.floor(rnd() * 12)}`;

export function generate() {
  s = 0x5eed2026; used.clear();
  const out = []; let order = 0;
  const add = (data) => { const id = 'P' + String(out.length + 1).padStart(3, '0'); out.push({ id, data: { ...data, order: order++, source: SOURCE } }); return id; };
  const get = (id) => out.find((p) => p.id === id).data;

  const TARGET = { 2: 2, 3: 4, 4: 18, 5: 85, 6: 110, 7: 65, 8: 18, 9: 2 };
  const root = add({ gen: 1, thu: '1', name: nameFor('m'), sex: 'm', place: 'Huế → Bình Dương', note: 'Người lập làng (dữ liệu mẫu)', death_lunar: '12/3', gio_lunar: '12/3', spouse: spouseOf('m') });
  let level = [root];
  for (let g = 2; g <= 9; g++) {
    const want = TARGET[g];
    const parents = level.filter((id) => get(id).sex === 'm' || chance(0.35));
    const pool = parents.length ? parents : level; const next = [];
    // spread `want` children over the parents (a few parents get many: a 10-12 child household exists)
    const counts = pool.map(() => 0); for (let i = 0; i < want; i++) counts[Math.floor(Math.pow(rnd(), 2.2) * pool.length)]++;
    pool.forEach((pid, k) => {
      for (let c = 0; c < counts[k]; c++) {
        const sex = chance(0.5) ? 'm' : 'f';
        const born = 1760 + (g - 1) * 25 + Math.floor(rnd() * 12);
        const dead = born < 1950 || chance(0.15);
        const d = { gen: g, thu: String(c + 2), name: nameFor(sex), sex, parent: pid };
        if (g >= 6 || chance(0.25)) d.place = chance(0.3) ? `${pick(PLACES)} → ${pick(PLACES)}` : pick(PLACES);
        if (g >= 5 && chance(0.5)) d.born = String(born);
        if (dead && g >= 5 && chance(0.3)) d.died = String(born + 50 + Math.floor(rnd() * 30));
        if (dead && chance(0.12)) d.death_lunar = lunar();
        if (dead && chance(0.04)) d.gio_lunar = lunar();
        if (chance(0.25)) d.spouse = spouseOf(sex) + (chance(0.5) ? ` (giỗ ${lunar()} ÂL; quê ${pick(PLACES)})` : '');
        if (chance(0.06)) d.alias = pick(ALIASES);
        if (chance(0.15)) d.verify = pick(VERIFY);
        if (chance(0.14)) d.note = pick(NOTES);
        if (g === 4 && c === 0) d.note = 'Trưởng chi (dữ liệu mẫu)';
        next.push(add(d));
      }
    });
    level = next;
  }
  // shapes the tests and the UI rely on
  out[out.length - 1].data.verify = 'Thiếu thông tin';
  const living = out.find((p) => p.data.gen === 8 && !p.data.died); if (living) { living.data.born = '1995'; living.data.place = 'TP Hồ Chí Minh'; }
  const unnamed = out.find((p) => p.data.gen === 7 && p.data.sex === 'f'); if (unnamed) { unnamed.data.name = `${SURNAME} Thị (mẫu: thiếu tên)`; unnamed.data.verify = 'Thiếu tên'; }
  return out;
}

export function toJson(out) {
  return JSON.stringify(out, null, 0).replace(/\},\{"id"/g, '},\n{"id"') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const people = generate(); const text = toJson(people);
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error(`demo seed is stale: run node scripts/make-demo-seed.mjs`); process.exit(1); }
    console.log('demo seed matches the generator');
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${people.length} people`);
  }
}
