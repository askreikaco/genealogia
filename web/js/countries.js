// Countries for the clan levels (Toàn cầu → Quốc gia → cây): ISO 3166-1 alpha-2 code + Vietnamese name. A short list
// of where Vietnamese and other families live; the settings field searches it (datalist). Plain ES module.
export const COUNTRIES = [
  ['VN', 'Việt Nam'], ['US', 'Hoa Kỳ'], ['FR', 'Pháp'], ['AU', 'Úc'], ['CA', 'Canada'], ['DE', 'Đức'], ['GB', 'Anh'],
  ['JP', 'Nhật Bản'], ['KR', 'Hàn Quốc'], ['TW', 'Đài Loan'], ['CN', 'Trung Quốc'], ['HK', 'Hồng Kông'], ['SG', 'Singapore'],
  ['MY', 'Malaysia'], ['TH', 'Thái Lan'], ['KH', 'Campuchia'], ['LA', 'Lào'], ['PH', 'Philippines'], ['ID', 'Indonesia'],
  ['IN', 'Ấn Độ'], ['RU', 'Nga'], ['CZ', 'Séc'], ['PL', 'Ba Lan'], ['NL', 'Hà Lan'], ['BE', 'Bỉ'], ['CH', 'Thụy Sĩ'],
  ['NO', 'Na Uy'], ['SE', 'Thụy Điển'], ['DK', 'Đan Mạch'], ['FI', 'Phần Lan'], ['IT', 'Ý'], ['ES', 'Tây Ban Nha'],
  ['NZ', 'New Zealand'], ['AE', 'UAE'], ['IL', 'Israel'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['ZA', 'Nam Phi'],
];
const NAME = new Map(COUNTRIES);
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
export const countryName = (code) => NAME.get(String(code || '').toUpperCase()) || String(code || '');
// "Việt Nam", "viet nam", "VN" -> "VN"; '' -> ''; unknown -> null
export function countryCode(text) {
  const t = String(text ?? '').trim(); if (!t) return '';
  if (/^[A-Za-z]{2}$/.test(t) && NAME.has(t.toUpperCase())) return t.toUpperCase();
  const f = fold(t); const hit = COUNTRIES.find(([, n]) => fold(n) === f);
  return hit ? hit[0] : null;
}
