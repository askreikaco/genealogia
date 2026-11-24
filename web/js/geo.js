// Place text -> map point. Keyword gazetteer for this family's places (first match wins).
// precision: exact (xã/ấp), approx (huyện/vùng), province. lat/lon typed on a person override this.
export const GAZ = [
  ['Mỏ Công', 11.55, 106.02, 'exact'], ['Ninh Thạnh', 11.40, 106.13, 'exact'], ['Ninh Hòa', 11.40, 106.13, 'approx'],
  ['Hiệp Tân', 11.24, 106.19, 'exact'], ['Hiệp Ninh', 11.31, 106.09, 'exact'], ['Hiệp Thạnh', 11.31, 106.09, 'approx'],
  ['Long Hoa', 11.29, 106.13, 'exact'], ['Bàu Năng', 11.24, 106.25, 'exact'], ['Bến Củi', 11.30, 106.30, 'approx'],
  ['Suối Đá', 11.37, 106.21, 'approx'], ['Tân Châu', 11.58, 106.20, 'approx'], ['Suối Ngô', 11.65, 106.25, 'approx'],
  ['Tân Bình, Tây Ninh', 11.38, 106.07, 'approx'], ['Tân Biên', 11.55, 106.02, 'approx'], ['Hòa Thành', 11.28, 106.15, 'approx'],
  ['Dương Minh Châu', 11.33, 106.27, 'approx'], ['Trảng Bàng', 11.03, 106.36, 'approx'], ['Bàu Cà Na', 11.25, 106.15, 'approx'],
  ['Phường 3, TP Tây Ninh', 11.31, 106.10, 'approx'], ['Phường 4', 11.31, 106.10, 'approx'], ['TP Tây Ninh', 11.31, 106.10, 'approx'],
  ['Thái Mỹ', 11.03, 106.40, 'exact'], ['Tân Thông', 10.98, 106.52, 'approx'], ['Truông Mít', 11.25, 106.33, 'approx'],
  ['Đồng Dù', 11.00, 106.48, 'approx'], ['Củ Chi', 10.97, 106.49, 'approx'], ['Suối Cục', 10.99, 106.46, 'approx'],
  ['Trảng Dầu', 11.07, 106.31, 'approx'], ['An Tịnh', 11.07, 106.31, 'approx'], ['Lộc Giang', 10.97, 106.37, 'approx'],
  ['Hiệp Hòa', 10.93, 106.34, 'approx'], ['An Ninh Tây', 10.90, 106.38, 'approx'], ['Đức Hòa', 10.86, 106.42, 'approx'],
  ['Sông Tra', 10.95, 106.40, 'approx'], ['Hóc Môn', 10.89, 106.59, 'approx'], ['Bà Điểm', 10.84, 106.60, 'approx'],
  ['Lái Thiêu', 10.90, 106.70, 'approx'], ['Bình Dương', 10.98, 106.68, 'province'], ['Đồng Nai', 10.95, 106.82, 'province'],
  ['Giồng Ông Tố', 10.79, 106.77, 'approx'], ['Calmette', 10.77, 106.70, 'approx'], ['Bùi Hữu Nghĩa', 10.75, 106.69, 'approx'],
  ['Q.3', 10.78, 106.68, 'approx'], ['Chợ Lớn', 10.75, 106.65, 'approx'], ['Phú Lâm', 10.75, 106.63, 'approx'],
  ['TP.HCM', 10.78, 106.70, 'province'], ['Sài Gòn', 10.78, 106.70, 'province'], ['Tây Ninh', 11.31, 106.10, 'province'],
  ['Long An', 10.70, 106.30, 'province'], ['Thừa Thiên', 16.46, 107.59, 'province'], ['Huế', 16.46, 107.59, 'province'],
  ['New York', 40.71, -74.0, 'province'], ['Texas', 31.0, -97.5, 'province'], ['California', 36.7, -119.4, 'province'],
  ['Mỹ', 39.8, -98.6, 'province'], ['Úc', -25.3, 133.8, 'province'],
];
export function locate(d) {
  if (d.lat && d.lon) return { lat: +d.lat, lon: +d.lon, precision: d.geo_precision || 'exact', key: d.place || '' };
  const p = d.place || ''; if (!p) return null;
  const last = p.split('→').pop();
  for (const [k, lat, lon, precision] of GAZ) if (last.includes(k)) return { lat, lon, precision, key: k };
  return null;
}
