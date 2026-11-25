// Historical context for Dòng đời (the "Lịch sử" switch) and reign-year dates. Data packs per country: HISTORY_VI
// (Việt Nam), HISTORY_JP, HISTORY_KR; HISTORY_ALL joins them. Facts only, neutral wording; each item links its
// Wikipedia article (search by title; vi for Vietnam, en for Japan and Korea). Kinds:
//   era    a dynasty or period, shown as a thin band while it overlaps a life
//   period another span shown as a band (e.g. a pandemic)
//   reign  a king's reign (band) with its niên hiệu: y1 = year 1 of the era name, last = last year it was used
//   war    a war: a start row and an end row
//   event  one date
// Fields: from/to are 'yyyy' or 'yyyy-mm[-dd]' ('-yyyy' = BCE, legendary dates only: they never fall inside a
// life, so no row shows them yet). country: 'VN' (default when absent), 'JP', 'KR'; region 'world' shows for every
// family. A family sees its own country's entries plus the world ones (families.country null = VN).
// Legends (BCE, '-yyyy') are not on Dòng đời: parseIso reads only yyyy, so startDays() returns null for them. Years
// 0–99 are exact (events.js dayNum sets the year explicitly), so 0040 Hai Bà Trưng and 0043 Mã Viện are in KEY.
// KEY: the short list shown on Dòng đời (one or two rows per decade at most). The rest stays in the pack for later
// views; historyRows(..., { all: true }) returns everything. Each pack is sorted by year at export.
const W = (t) => `https://vi.wikipedia.org/w/index.php?search=${encodeURIComponent(t)}`;
const EN = (t) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(t)}`;
const byYear = (a, b) => parseInt(a.from, 10) - parseInt(b.from, 10);
const era = (id, name, from, to) => ({ id, kind: 'era', label: `Thời nhà ${name}`, from: String(from).padStart(4, '0'), to: String(to).padStart(4, '0'), region: 'vn', source: W(`Nhà ${name}`) });
const reign = (id, king, from, to, y1, title = king) => ({ id, kind: 'reign', king, label: `Thời vua ${king}`, from: String(from), to: String(to), y1, last: y1 ? to : null, region: 'vn', source: W(title) });
const war = (id, label, from, to, region = 'vn', title = label) => ({ id, kind: 'war', label, from, to, region, source: W(title) });
const period = (id, label, from, to, region, title = label) => ({ id, kind: 'period', label, from, to, region, source: W(title) });
const ev = (id, label, date, region = 'vn', title = label) => ({ id, kind: 'event', label, from: date, region, source: W(title) });
const band = (id, label, from, to, country, title) => ({ id, kind: 'era', label, from: String(from).padStart(4, '0'), to: String(to).padStart(4, '0'), country, region: country.toLowerCase(), source: EN(title) });
const jp = (id, label, date, title = label) => ({ id, kind: 'event', label, from: date, country: 'JP', region: 'jp', source: EN(title) });
const kr = (id, label, date, title = label) => ({ id, kind: 'event', label, from: date, country: 'KR', region: 'kr', source: EN(title) });

export const HISTORY_VI = [
  // legends and early history (legendary dates: BCE, never inside a life)
  ev('van-lang', '~2879 TCN: nước Văn Lang (truyền thuyết)', '-2879', 'vn', 'Hùng Vương'),
  ev('au-lac', '~257 TCN: nước Âu Lạc (truyền thuyết)', '-0257', 'vn', 'Âu Lạc'),
  ev('trieu-da', 'Triệu Đà thôn tính Âu Lạc', '-0179', 'vn', 'Triệu Đà'),
  ev('han-chiem', 'Nhà Hán chiếm Nam Việt, đặt quận huyện ở Giao Chỉ', '-0111', 'vn', 'Nam Việt'),
  ev('hai-ba-trung', 'Khởi nghĩa Hai Bà Trưng', '0040', 'vn', 'Hai Bà Trưng'),
  ev('ma-vien', 'Mã Viện đánh bại khởi nghĩa Hai Bà Trưng', '0043', 'vn', 'Mã Viện'),
  ev('ba-trieu', 'Khởi nghĩa Bà Triệu', '0248', 'vn', 'Bà Triệu'),
  ev('ly-bi', 'Lý Bí xưng đế, lập nước Vạn Xuân', '0544', 'vn', 'Lý Bí'),
  ev('khuc', 'Khúc Thừa Dụ tự xưng Tiết độ sứ', '0905', 'vn', 'Khúc Thừa Dụ'),
  ev('duong-dinh-nghe', 'Dương Đình Nghệ đánh đuổi quân Nam Hán', '0931', 'vn', 'Dương Đình Nghệ'),
  ev('bach-dang-938', 'Ngô Quyền đánh thắng quân Nam Hán trên sông Bạch Đằng', '0938', 'vn', 'Trận Bạch Đằng (938)'),
  ev('dinh-hoang', 'Đinh Bộ Lĩnh lên ngôi, đặt quốc hiệu Đại Cồ Việt', '0968', 'vn', 'Đinh Tiên Hoàng'),
  ev('le-hoan', 'Lê Hoàn lên ngôi, mở đầu nhà Tiền Lê', '0980', 'vn', 'Lê Đại Hành'),
  ev('chi-lang-981', 'Chiến thắng Chi Lăng: quân Tống thất bại', '0981', 'vn', 'Chiến tranh Tống – Việt'),
  ev('ly-cong-uan', 'Lý Công Uẩn lên ngôi, mở đầu nhà Lý', '1009', 'vn', 'Lý Thái Tổ'),
  ev('thang-long', 'Dời đô về Thăng Long', '1010', 'vn', 'Thăng Long'),
  ev('dai-viet', 'Đổi quốc hiệu thành Đại Việt', '1054', 'vn', 'Đại Việt'),
  ev('van-mieu', 'Lập Văn Miếu', '1070', 'vn', 'Văn Miếu Quốc Tử Giám'),
  ev('quoc-tu-giam', 'Lập Quốc Tử Giám', '1076', 'vn', 'Quốc Tử Giám'),
  ev('nhu-nguyet', 'Chiến thắng sông Như Nguyệt trước quân Tống', '1077', 'vn', 'Lý Thường Kiệt'),
  ev('tran-thai-tong', 'Trần Cảnh lên ngôi, mở đầu nhà Trần', '1226', 'vn', 'Trần Thái Tông'),
  ev('mong-1258', 'Quân Mông Cổ xâm lược Đại Việt lần thứ nhất', '1258', 'vn', 'Chiến tranh Mông Cổ – Đại Việt'),
  ev('mong-1285', 'Quân Mông Cổ xâm lược Đại Việt lần thứ hai', '1285', 'vn', 'Chiến tranh Mông Cổ – Đại Việt'),
  ev('bach-dang-1288', 'Chiến thắng Bạch Đằng lần thứ ba, đánh bại quân Nguyên', '1288', 'vn', 'Trận Bạch Đằng (1288)'),
  ev('ho-quy-ly', 'Hồ Quý Ly lập nhà Hồ', '1400', 'vn', 'Hồ Quý Ly'),
  ev('minh-1407', 'Nhà Minh xâm lược, chiếm Đại Ngu', '1407', 'vn', 'Chiến tranh Minh – Hồ'),
  ev('lam-son', 'Khởi nghĩa Lam Sơn', '1418', 'vn', 'Khởi nghĩa Lam Sơn'),
  ev('le-loi', 'Lê Lợi lên ngôi, mở đầu nhà Lê sơ', '1428', 'vn', 'Lê Thái Tổ'),
  ev('champa-1471', 'Lê Thánh Tông đánh chiếm Chiêm Thành', '1471', 'vn', 'Champa'),
  ev('hong-duc', '~1483: ban hành Bộ luật Hồng Đức', '1483', 'vn', 'Luật Hồng Đức'),
  ev('mac-dang-dung', 'Mạc Đăng Dung lên ngôi, mở đầu nhà Mạc', '1527', 'vn', 'Mạc Đăng Dung'),
  ev('nguyen-hoang', 'Nguyễn Hoàng vào trấn thủ Thuận Hóa', '1558', 'vn', 'Nguyễn Hoàng'),
  ev('trinh-tung', 'Trịnh Tùng lấy lại Thăng Long, nhà Mạc rút lên Cao Bằng', '1592', 'vn', 'Trịnh Tùng'),
  ev('tay-son-1771', 'Khởi nghĩa Tây Sơn', '1771', 'vn', 'Khởi nghĩa Tây Sơn'),
  ev('dong-da', 'Chiến thắng Ngọc Hồi – Đống Đa, đánh bại quân Thanh', '1789', 'vn', 'Trận Ngọc Hồi – Đống Đa'),
  ev('nguyen-1802', 'Nguyễn Ánh lên ngôi, thống nhất đất nước, mở đầu nhà Nguyễn', '1802', 'vn', 'Gia Long'),
  ev('dai-nam', 'Đổi quốc hiệu thành Đại Nam', '1838', 'vn', 'Đại Nam'),
  // French period: the start (1858–1887), the 1930s and 1940s
  ev('tay-nam-ky-1867', 'Pháp chiếm ba tỉnh miền Tây Nam Kỳ', '1867-06-20', 'vn', 'Chiến tranh Pháp – Nguyễn'),
  ev('garnier-1873', 'Francis Garnier đánh chiếm Hà Nội', '1873-11-20', 'vn', 'Francis Garnier'),
  ev('giap-tuat-1874', 'Hòa ước Giáp Tuất', '1874', 'vn', 'Hòa ước Giáp Tuất'),
  ev('harmand-1883', 'Hiệp ước Harmand', '1883-08-25', 'vn', 'Hiệp ước Harmand'),
  ev('lien-bang-1887', 'Thành lập Liên bang Đông Dương', '1887-10-17', 'vn', 'Liên bang Đông Dương'),
  ev('yeu-sach-1919', 'Nguyễn Ái Quốc gửi Yêu sách của nhân dân An Nam', '1919-06-18', 'vn', 'Yêu sách của nhân dân An Nam'),
  ev('thanh-nien-1925', 'Thành lập Hội Việt Nam Cách mạng Thanh niên', '1925-06-21', 'vn', 'Hội Việt Nam Cách mạng Thanh niên'),
  ev('dcs-1930', 'Thành lập Đảng Cộng sản Việt Nam', '1930-02-03', 'vn', 'Đảng Cộng sản Việt Nam'),
  ev('xo-viet-1930', 'Xô viết Nghệ Tĩnh', '1930-09', 'vn', 'Xô viết Nghệ Tĩnh'),
  ev('bac-son-1940', 'Khởi nghĩa Bắc Sơn', '1940-09-27', 'vn', 'Khởi nghĩa Bắc Sơn'),
  ev('viet-minh-1941', 'Thành lập Mặt trận Việt Minh', '1941-05-19', 'vn', 'Việt Minh'),
  ev('tuyen-truyen-1944', 'Thành lập Đội Việt Nam Tuyên truyền Giải phóng quân', '1944-12-22', 'vn', 'Quân đội nhân dân Việt Nam'),
  ev('cmt8-1945', 'Cách mạng tháng Tám: tổng khởi nghĩa', '1945-08-19', 'vn', 'Cách mạng tháng Tám'),
  ev('dbp-1954', 'Chiến thắng Điện Biên Phủ', '1954-05-07', 'vn', 'Chiến dịch Điện Biên Phủ'),
  ev('ha-noi-1954', 'Hà Nội được giải phóng', '1954-10-10', 'vn', 'Giải phóng Thủ đô'),
  ev('mttn-1960', 'Thành lập Mặt trận Dân tộc Giải phóng miền Nam Việt Nam', '1960-12-20', 'vn', 'Mặt trận Dân tộc Giải phóng miền Nam Việt Nam'),
  ev('mau-than-1968', 'Tổng tiến công và nổi dậy Tết Mậu Thân', '1968-01-30', 'vn', 'Tổng tiến công và nổi dậy Tết Mậu Thân 1968'),
  ev('thong-nhat-1976', 'Thống nhất đất nước, đổi tên thành Cộng hòa Xã hội chủ nghĩa Việt Nam', '1976-07-02', 'vn', 'Cộng hòa Xã hội chủ nghĩa Việt Nam'),
  ev('rut-campuchia-1989', 'Quân đội Việt Nam rút khỏi Campuchia', '1989-09-26', 'vn', 'Quân tình nguyện Việt Nam tại Campuchia'),
  ev('bttm-2001', 'Hiệp định Thương mại Việt – Mỹ có hiệu lực', '2001-12-10', 'vn', 'Hiệp định Thương mại song phương Việt Nam – Hoa Kỳ'),
  ev('thang-long-1000', 'Kỷ niệm 1000 năm Thăng Long – Hà Nội', '2010-10-01', 'vn', 'Thăng Long – Hà Nội'),
  ev('sap-nhap-2025', 'Sắp xếp đơn vị hành chính: từ 63 xuống 34 tỉnh, thành phố', '2025-07-01', 'vn', 'Sắp xếp đơn vị hành chính cấp tỉnh (Việt Nam, 2025)'),
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
].sort(byYear);

// Japan (country JP): shown for Japanese families only. Legendary Jimmu is marked; dates after 539 are the
// commonly cited years.
export const HISTORY_JP = [
  jp('jp-jimmu', '~660 TCN: Thiên hoàng Jimmu lên ngôi (truyền thuyết)', '-0660', 'Emperor Jimmu'),
  jp('jp-buddhism', '~538: Phật giáo truyền vào Nhật Bản', '0538', 'Buddhism in Japan'),
  jp('jp-taika', 'Cải cách Taika', '0645', 'Taika Reform'),
  jp('jp-hakusuki', 'Trận Hakusukinoe: Nhật Bản thua liên quân Silla – nhà Đường', '0663', 'Battle of Baekgang'),
  band('jp-nara', 'Thời Nara', 710, 794, 'JP', 'Nara period'),
  band('jp-heian', 'Thời Heian', 794, 1185, 'JP', 'Heian period'),
  band('jp-kamakura', 'Mạc phủ Kamakura', 1185, 1333, 'JP', 'Kamakura shogunate'),
  jp('jp-mongol-1274', 'Mông Cổ tấn công Nhật Bản lần thứ nhất', '1274', 'Mongol invasions of Japan'),
  jp('jp-kenmu', 'Trung hưng Kenmu', '1333', 'Kenmu Restoration'),
  band('jp-muromachi', 'Mạc phủ Muromachi', 1336, 1573, 'JP', 'Muromachi period'),
  jp('jp-onin', 'Chiến tranh Ōnin: mở đầu thời Chiến Quốc', '1467', 'Ōnin War'),
  jp('jp-nobunaga', 'Oda Nobunaga vào Kyoto, mở đầu thống nhất', '1568', 'Oda Nobunaga'),
  jp('jp-hideyoshi', 'Toyotomi Hideyoshi thống nhất Nhật Bản', '1590', 'Toyotomi Hideyoshi'),
  jp('jp-sekigahara', 'Trận Sekigahara', '1600-10-21', 'Battle of Sekigahara'),
  band('jp-edo', 'Mạc phủ Edo', 1603, 1868, 'JP', 'Edo period'),
  jp('jp-sakoku', 'Chính sách Sakoku (đóng cửa đất nước)', '1639', 'Sakoku'),
  jp('jp-perry', 'Matthew Perry đến Edo, Nhật Bản mở cửa', '1853-07-08', 'Matthew C. Perry'),
  jp('jp-meiji', 'Minh Trị Duy tân', '1868-01-03', 'Meiji Restoration'),
  jp('jp-constitution', 'Hiến pháp Minh Trị có hiệu lực', '1889-02-11', 'Constitution of the Empire of Japan'),
  jp('jp-sino-1894', 'Chiến tranh Trung – Nhật lần thứ nhất', '1894', 'First Sino-Japanese War'),
  jp('jp-russo-1904', 'Chiến tranh Nga – Nhật', '1904', 'Russo-Japanese War'),
  jp('jp-kanto', 'Động đất Kantō', '1923-09-01', '1923 Kantō earthquake'),
  jp('jp-sino-1937', 'Chiến tranh Trung – Nhật lần thứ hai', '1937-07-07', 'Second Sino-Japanese War'),
  jp('jp-pearl', 'Tấn công Trân Châu Cảng', '1941-12-07', 'Attack on Pearl Harbor'),
  jp('jp-hiroshima', 'Ném bom nguyên tử Hiroshima', '1945-08-06', 'Atomic bombings of Hiroshima and Nagasaki'),
  jp('jp-surrender', 'Nhật Bản tuyên bố đầu hàng', '1945-08-15', 'Surrender of Japan'),
  jp('jp-okinawa', 'Trả Okinawa cho Nhật Bản', '1972-05-15', 'Okinawa Reversion'),
  jp('jp-heisei', 'Thiên hoàng Chiêu Hòa băng hà, bắt đầu thời Bình Thành', '1989-01-08', 'Heisei'),
  jp('jp-tohoku', 'Động đất và sóng thần Tōhoku', '2011-03-11', '2011 Tōhoku earthquake and tsunami'),
  jp('jp-reiwa', 'Bắt đầu thời Lệnh Hòa', '2019-05-01', 'Reiwa'),
].sort(byYear);

// Korea (country KR): shown for Korean families only (no family has it yet). Ancient kingdoms: traditional dates, marked ~.
export const HISTORY_KR = [
  kr('kr-gojoseon', '~2333 TCN: Triều Tiên cổ (Gojoseon) theo truyền thuyết', '-2333', 'Gojoseon'),
  kr('kr-silla', '~57 TCN: Silla (Tân La) thành lập', '-0057', 'Silla'),
  kr('kr-goguryeo', '~37 TCN: Goguryeo (Cao Câu Ly) thành lập', '-0037', 'Goguryeo'),
  kr('kr-baekje', '~18 TCN: Baekje (Bách Tế) thành lập', '-0018', 'Baekje'),
  kr('kr-silla-unify', 'Silla thống nhất phần lớn bán đảo, Goguryeo sụp đổ', '0668', 'Unified Silla'),
  band('kr-goryeo', 'Triều Cao Ly (Goryeo)', 918, 1392, 'KR', 'Goryeo'),
  kr('kr-mongol', 'Mông Cổ bắt đầu xâm lược Cao Ly', '1231', 'Mongol invasions of Korea'),
  band('kr-joseon', 'Triều Triều Tiên (Joseon)', 1392, 1897, 'KR', 'Joseon'),
  kr('kr-hangul', 'Ban hành chữ Hangul (Huấn dân chính âm)', '1446', 'Hangul'),
  kr('kr-imjin', 'Chiến tranh Imjin: Nhật Bản xâm lược Triều Tiên', '1592', 'Imjin War'),
  kr('kr-qing', 'Nhà Thanh xâm lược Triều Tiên', '1636', 'Second Manchu invasion of Korea'),
  kr('kr-annex', 'Nhật Bản sáp nhập Triều Tiên', '1910-08-29', 'Korea under Japanese rule'),
  kr('kr-march1', 'Phong trào Độc lập 1 tháng 3', '1919-03-01', 'March 1st Movement'),
  kr('kr-liberation', 'Triều Tiên được giải phóng khỏi Nhật Bản', '1945-08-15', 'Liberation Day (Korea)'),
  kr('kr-war', 'Chiến tranh Triều Tiên bắt đầu', '1950-06-25', 'Korean War'),
  kr('kr-armistice', 'Hiệp định đình chiến Triều Tiên', '1953-07-27', 'Korean Armistice Agreement'),
  kr('kr-democracy', 'Tuyên bố 29 tháng 6: bắt đầu dân chủ hóa', '1987-06-29', 'June Democratic Struggle'),
].sort(byYear);

export const HISTORY_ALL = [...HISTORY_VI, ...HISTORY_JP, ...HISTORY_KR];
export const HISTORY_PACKS = { vi: HISTORY_VI, jp: HISTORY_JP, kr: HISTORY_KR };

// Shown by default on Dòng đời: the short list. Eras and reigns of two years or more are listed by rule.
export const KEY_HISTORY = new Set([
  ...HISTORY_ALL.filter((x) => (x.kind === 'reign' && x.to - x.from >= 2) || (x.kind === 'era' && x.id !== 'nguyen')).map((x) => x.id),
  'trinh-nguyen', 'da-nang-1858', 'nan-doi', 'doc-lap-1945', 'dong-duong', 'vn-war', 'tay-nam', 'phia-bac', 'doi-moi-1986',
  'sars-2003', 'covid', // COVID-19: a start row and an end row (owner 2026-11-24)
  // more key events (owner 2026-11-25): founding legends and the first turning points of each era
  'hai-ba-trung', 'ma-vien', 'van-lang', 'au-lac', 'ly-bi', 'bach-dang-938', 'thang-long', 'mong-1258', 'bach-dang-1288',
  'minh-1407', 'dong-da', 'patenotre-1884', 'dcs-1930', 'sap-nhap-2025',
  'jp-jimmu', 'jp-taika', 'jp-nobunaga', 'jp-perry', 'jp-meiji', 'jp-pearl', 'jp-surrender', 'jp-heisei', 'jp-tohoku', 'jp-reiwa',
  'kr-gojoseon', 'kr-silla-unify', 'kr-hangul', 'kr-imjin', 'kr-annex', 'kr-march1', 'kr-liberation', 'kr-war', 'kr-democracy',
]);

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
