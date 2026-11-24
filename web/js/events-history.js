// Historical context for Dòng đời (the "Lịch sử" switch) and reign-year dates. A data pack, region 'vn'; other packs
// (China, Korea, …) can sit next to it in HISTORY_PACKS. Facts only, neutral wording; each item links its Wikipedia
// article (search by title). Kinds:
//   era    a dynasty, shown as a thin "thời …" band while it overlaps a life
//   period another span shown as a band (e.g. a pandemic)
//   reign  a king's reign (band) with its niên hiệu: y1 = year 1 of the era name, last = last year it was used
//   war    a war: a start row and an end row
//   event  one date
// KEY: the short list shown on Dòng đời (one or two rows per decade at most). The rest stays in the pack for later
// views; historyRows(..., { all: true }) returns everything.
const W = (t) => `https://vi.wikipedia.org/w/index.php?search=${encodeURIComponent(t)}`;
const era = (id, name, from, to) => ({ id, kind: 'era', label: `Thời nhà ${name}`, from: String(from).padStart(4, '0'), to: String(to).padStart(4, '0'), region: 'vn', source: W(`Nhà ${name}`) });
const reign = (id, king, from, to, y1, title = king) => ({ id, kind: 'reign', king, label: `Thời vua ${king}`, from: String(from), to: String(to), y1, last: y1 ? to : null, region: 'vn', source: W(title) });
const war = (id, label, from, to, region = 'vn', title = label) => ({ id, kind: 'war', label, from, to, region, source: W(title) });
const period = (id, label, from, to, region, title = label) => ({ id, kind: 'period', label, from, to, region, source: W(title) });
const ev = (id, label, date, region = 'vn', title = label) => ({ id, kind: 'event', label, from: date, region, source: W(title) });

export const HISTORY_VI = [
  // dynasties
  era('ngo', 'Ngô', 939, 965), era('dinh', 'Đinh', 968, 980), era('tien-le', 'Tiền Lê', 980, 1009), era('ly', 'Lý', 1009, 1225),
  era('tran', 'Trần', 1225, 1400), era('ho', 'Hồ', 1400, 1407), era('le-so', 'Lê sơ', 1428, 1527), era('mac', 'Mạc', 1527, 1592),
  { ...era('le-trung-hung', 'Lê trung hưng', 1533, 1789) }, war('trinh-nguyen', 'Trịnh – Nguyễn phân tranh', '1627', '1672'),
  era('tay-son', 'Tây Sơn', 1778, 1802), era('nguyen', 'Nguyễn', 1802, 1945),
  // Tây Sơn reigns (niên hiệu year 1 = the reign's first year)
  reign('thai-duc', 'Thái Đức', 1778, 1793, 1778, 'Nguyễn Nhạc'), reign('quang-trung', 'Quang Trung', 1788, 1792, 1788),
  reign('canh-thinh', 'Cảnh Thịnh', 1793, 1801, 1793), reign('bao-hung', 'Bảo Hưng', 1801, 1802, 1801),
  // Nguyễn reigns
  reign('gia-long', 'Gia Long', 1802, 1820, 1802), reign('minh-mang', 'Minh Mạng', 1820, 1841, 1820), reign('thieu-tri', 'Thiệu Trị', 1841, 1847, 1841),
  reign('tu-duc', 'Tự Đức', 1847, 1883, 1848), reign('duc-duc', 'Dục Đức', 1883, 1883, null), reign('hiep-hoa', 'Hiệp Hòa', 1883, 1883, 1883),
  reign('kien-phuc', 'Kiến Phúc', 1883, 1884, 1884), reign('ham-nghi', 'Hàm Nghi', 1884, 1885, 1885), reign('dong-khanh', 'Đồng Khánh', 1885, 1889, 1886),
  reign('thanh-thai', 'Thành Thái', 1889, 1907, 1889), reign('duy-tan', 'Duy Tân', 1907, 1916, 1907), reign('khai-dinh', 'Khải Định', 1916, 1925, 1916),
  reign('bao-dai', 'Bảo Đại', 1926, 1945, 1926),
  // wars and events
  ev('da-nang-1858', 'Pháp tấn công Đà Nẵng', '1858-09-01', 'vn', 'Liên quân Pháp – Tây Ban Nha tấn công Đà Nẵng'),
  ev('nham-tuat-1862', 'Hòa ước Nhâm Tuất ký kết', '1862', 'vn', 'Hòa ước Nhâm Tuất'),
  ev('patenotre-1884', 'Hòa ước Patenôtre ký kết', '1884-06-06', 'vn', 'Hòa ước Patenôtre'),
  war('can-vuong', 'Phong trào Cần Vương', '1885', '1896'),
  war('ww1', 'Chiến tranh thế giới thứ nhất', '1914', '1918', 'world'),
  war('ww2', 'Chiến tranh thế giới thứ hai', '1939', '1945', 'world'),
  ev('nan-doi', 'Nạn đói năm Ất Dậu', '1945', 'vn', 'Nạn đói năm Ất Dậu'),
  ev('nhat-dao-chinh-1945', 'Nhật đảo chính Pháp ở Đông Dương', '1945-03-09', 'vn', 'Nhật đảo chính Pháp tại Đông Dương'),
  ev('doc-lap-1945', 'Tuyên ngôn độc lập', '1945-09-02', 'vn', 'Tuyên ngôn độc lập (Việt Nam Dân chủ Cộng hòa)'),
  war('dong-duong', 'Chiến tranh Đông Dương', '1946-12-19', '1954-07-21'),
  ev('geneve-1954', 'Hiệp định Genève ký kết', '1954-07-21', 'vn', 'Hiệp định Genève 1954'),
  war('vn-war', 'Chiến tranh Việt Nam', '1955-11-01', '1975-04-30'),
  ev('paris-1973', 'Hiệp định Paris ký kết', '1973-01-27', 'vn', 'Hiệp định Paris 1973'),
  war('tay-nam', 'Chiến tranh biên giới Tây Nam', '1978', '1989'),
  war('phia-bac', 'Chiến tranh biên giới phía Bắc', '1979-02-17', '1979-03-16'),
  ev('doi-moi-1986', 'Đổi mới', '1986-12', 'vn'),
  ev('asean-1995', 'Việt Nam gia nhập ASEAN', '1995-07-28', 'vn', 'Hiệp hội các quốc gia Đông Nam Á'),
  // global events that directly affected Vietnam
  war('cum-1918', 'Đại dịch cúm 1918', '1918', '1920', 'world', 'Đại dịch cúm 1918'),
  war('khung-hoang-1929', 'Đại khủng hoảng kinh tế', '1929', '1939', 'world', 'Đại khủng hoảng'),
  ev('nhat-1940', 'Nhật Bản đưa quân vào Đông Dương', '1940-09', 'vn', 'Nhật Bản xâm chiếm Đông Dương'),
  ev('cam-van-1994', 'Hoa Kỳ bỏ cấm vận với Việt Nam', '1994-02-03', 'vn', 'Quan hệ Hoa Kỳ – Việt Nam'),
  ev('binh-thuong-hoa-1995', 'Việt Nam – Hoa Kỳ bình thường hóa quan hệ', '1995-07-11', 'vn', 'Quan hệ Hoa Kỳ – Việt Nam'),
  ev('khung-hoang-a-1997', 'Khủng hoảng tài chính châu Á', '1997-07', 'world', 'Khủng hoảng tài chính châu Á 1997'),
  ev('bao-linda-1997', 'Bão Linda đổ bộ Nam Bộ', '1997-11-02', 'vn', 'Bão Linda (1997)'),
  ev('sars-2003', 'Dịch SARS: Việt Nam là nước đầu tiên khống chế thành công', '2003-04-28', 'vn', 'Hội chứng hô hấp cấp tính nặng'),
  ev('h5n1-2004', 'Dịch cúm gia cầm H5N1', '2004', 'vn', 'Cúm gia cầm H5N1'),
  ev('wto-2007', 'Việt Nam gia nhập WTO', '2007-01-11', 'vn', 'Việt Nam và Tổ chức Thương mại Thế giới'),
  ev('khung-hoang-2008', 'Khủng hoảng tài chính toàn cầu', '2008', 'world', 'Khủng hoảng tài chính 2007–2008'),
  ev('covid-vn-2020', 'Ca nhiễm COVID-19 đầu tiên tại Việt Nam', '2020-01-23', 'vn', 'Đại dịch COVID-19 tại Việt Nam'),
  ev('gian-cach-2020', 'Giãn cách xã hội toàn quốc vì COVID-19', '2020-04-01', 'vn', 'Đại dịch COVID-19 tại Việt Nam'),
  war('covid', 'Đại dịch COVID-19', '2020-03-11', '2023-05-05', 'world', 'Đại dịch COVID-19'),
  ev('covid-1', 'Đại dịch COVID-19 (2020–2023)', '2020-03-11', 'world', 'Đại dịch COVID-19'), // the one row on Dòng đời
  period('covid-band', 'Thời kỳ đại dịch COVID-19', '2020', '2023', 'world', 'Đại dịch COVID-19'),
];
// Kings who reigned 2+ years stand in for the Nguyễn era band (1883–1885 had four short reigns); one row per
// turning point after 1945.
export const KEY_HISTORY = new Set([
  ...HISTORY_VI.filter((x) => (x.kind === 'reign' && x.to - x.from >= 2) || (x.kind === 'era' && x.id !== 'nguyen')).map((x) => x.id),
  'trinh-nguyen', 'da-nang-1858', 'nan-doi', 'doc-lap-1945', 'dong-duong', 'vn-war', 'tay-nam', 'phia-bac', 'doi-moi-1986',
  'sars-2003', 'covid', // COVID-19: a start row and an end row (owner 2026-11-24)
]);
export const HISTORY_PACKS = { vi: HISTORY_VI };

// ---- reign-year dates: "Tự Đức thứ 10", "Tự Đức năm thứ 10", "năm Tự Đức 10" -> 1857 (y1 + N − 1) ----
const fold = (x) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
const REIGNS = HISTORY_VI.filter((x) => x.kind === 'reign');
// Returns null when the text names no reign; { error } when it does but cannot be used; else { year, king, n }.
export function parseReignYear(text) {
  const t = fold(text).replace(/^nam\s+/, '');
  if (!t) return null;
  for (const r of REIGNS) {
    const k = fold(r.king);
    if (!t.startsWith(k + ' ') && t !== k) continue;
    const rest = t.slice(k.length).trim();
    const m = /^(?:nam\s+)?(?:thu\s+)?(\d{1,2})$/.exec(rest);
    if (!r.y1) return { error: `Vua ${r.king} không có niên hiệu riêng; ghi năm dương lịch.` };
    if (!m) return { error: `Ghi như "${r.king} thứ 10".` };
    const n = Number(m[1]); const max = r.last - r.y1 + 1;
    if (n < 1 || n > max) return { error: `Niên hiệu ${r.king} chỉ dùng ${max} năm (${r.y1}–${r.last}).` };
    return { year: r.y1 + n - 1, king: r.king, n };
  }
  return null;
}

// Timeline rows for the history switch, inside the window [from, to] (day numbers): bands for eras and reigns that
// overlap the life (placed at the later of their start and the life start), start/end rows for wars, event rows.
export function historyItems(pack, { inside, overlaps, clampStart }) {
  const out = [];
  for (const x of pack) {
    if (x.kind === 'era' || x.kind === 'reign' || x.kind === 'period') {
      if (!overlaps(x.from, x.to)) continue;
      out.push({ id: `h:${x.id}`, band: true, label: `${x.label} (${+x.from}–${+x.to})`, source: x.source, region: x.region, date_kind: 'exact', date_from: clampStart(x.from) });
    } else if (x.kind === 'war' && x.from.slice(0, 4) === x.to.slice(0, 4)) {
      if (inside(x.from)) out.push({ id: `h:${x.id}`, label: `${x.label} (${x.from.slice(0, 4)})`, source: x.source, region: x.region, date_kind: 'exact', date_from: x.from });
    } else if (x.kind === 'war') {
      if (inside(x.from)) out.push({ id: `h:${x.id}:a`, label: `Bắt đầu: ${x.label}`, source: x.source, region: x.region, date_kind: 'exact', date_from: x.from });
      if (inside(x.to)) out.push({ id: `h:${x.id}:b`, label: `Kết thúc: ${x.label}`, source: x.source, region: x.region, date_kind: 'exact', date_from: x.to });
    } else if (inside(x.from)) out.push({ id: `h:${x.id}`, label: x.label, source: x.source, region: x.region, date_kind: 'exact', date_from: x.from });
  }
  return out;
}
