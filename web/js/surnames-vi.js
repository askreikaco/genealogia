// Vietnamese family names (họ) -> Hán tự, for the surname tile (ui.js surnameTile) and the family Hán default.
// Data only: one entry per spelling as written in Vietnamese (Võ/Vũ, Huỳnh/Hoàng and Lã/Lữ share a character).
// A family's own Hán (Cài đặt dòng họ) wins over this list. A name with no entry shows its first letter.
// Two-word names (Âu Dương, Tôn Thất) count only when the full name has at least three words (surnameOf in ui.js).
// Add a name: keep alphabetical order inside its block, one Hán form (the common one); a test checks the shape.
export const SURNAME_HAN = {
  // most common (about 90% of Vietnamese people)
  'Nguyễn': '阮', 'Trần': '陳', 'Lê': '黎', 'Phạm': '范', 'Hoàng': '黃', 'Huỳnh': '黃', 'Phan': '潘', 'Vũ': '武', 'Võ': '武',
  'Đặng': '鄧', 'Bùi': '裴', 'Đỗ': '杜', 'Hồ': '胡', 'Ngô': '吳', 'Dương': '楊', 'Lý': '李',
  // others, A-Z
  'Âu': '歐', 'Ân': '殷', 'Bạch': '白', 'Bành': '彭', 'Bế': '閉', 'Biện': '卞', 'Cao': '高', 'Cát': '葛', 'Châu': '周',
  'Chu': '朱', 'Cổ': '古', 'Cù': '瞿', 'Cung': '龔', 'Diệp': '葉', 'Doãn': '尹', 'Dư': '余', 'Đái': '戴', 'Đàm': '譚',
  'Đào': '陶', 'Đậu': '竇', 'Điền': '田', 'Đinh': '丁', 'Đoàn': '段', 'Đồng': '童', 'Đường': '唐', 'Giản': '簡',
  'Giang': '江', 'Giáp': '甲', 'Hà': '何', 'Hạ': '夏', 'Hàn': '韓', 'Hầu': '侯', 'Hình': '邢', 'Hoa': '華', 'Hồng': '洪',
  'Hùng': '熊', 'Hứa': '許', 'Hướng': '向', 'Kha': '柯', 'Khâu': '丘', 'Khổng': '孔', 'Khúc': '曲', 'Khưu': '丘',
  'Khương': '姜', 'Kiều': '喬', 'Kim': '金', 'La': '羅', 'Lã': '呂', 'Lạc': '駱', 'Lại': '賴', 'Lam': '藍', 'Lâm': '林',
  'Lăng': '凌', 'Liễu': '柳', 'Liêu': '廖', 'Lô': '盧', 'Lỗ': '魯', 'Long': '龍', 'Lục': '陸', 'Lữ': '呂', 'Lưu': '劉',
  'Lương': '梁', 'Ma': '麻', 'Mã': '馬', 'Mạc': '莫', 'Mạch': '麥', 'Mai': '梅', 'Mạnh': '孟', 'Mao': '毛', 'Mẫn': '閔',
  'Mông': '蒙', 'Nghê': '倪', 'Nghiêm': '嚴', 'Ngũ': '伍', 'Ngụy': '魏', 'Nguyên': '元', 'Nhâm': '任', 'Nhan': '顏',
  'Nhữ': '汝', 'Ninh': '寧', 'Nông': '農', 'Ôn': '溫', 'Ông': '翁', 'Phàn': '樊', 'Phí': '費', 'Phó': '傅', 'Phù': '符',
  'Phùng': '馮', 'Phương': '方', 'Quách': '郭', 'Quan': '關', 'Quản': '管', 'Quế': '桂', 'Sầm': '岑', 'Sử': '史',
  'Tạ': '謝', 'Tăng': '曾', 'Tào': '曹', 'Tần': '秦', 'Tất': '畢', 'Tề': '齊', 'Thạch': '石', 'Thái': '蔡', 'Thân': '申',
  'Thang': '湯', 'Thẩm': '沈', 'Thi': '施', 'Thiệu': '邵', 'Thiều': '韶', 'Thịnh': '盛', 'Thôi': '崔', 'Thượng': '尚',
  'Tiền': '錢', 'Tiết': '薛', 'Tiêu': '蕭', 'Tô': '蘇', 'Tôn': '孫', 'Tống': '宋', 'Trà': '茶', 'Trác': '卓',
  'Trang': '莊', 'Triệu': '趙', 'Trịnh': '鄭', 'Trình': '程', 'Trưng': '徵', 'Trương': '張', 'Từ': '徐', 'Tưởng': '蔣',
  'Uông': '汪', 'Ưng': '應', 'Vạn': '萬', 'Văn': '文', 'Vi': '韋', 'Viên': '袁', 'Vương': '王', 'Vưu': '尤', 'Xa': '車',
  // two-word names
  'Âu Dương': '歐陽', 'Gia Cát': '諸葛', 'Tôn Nữ': '宗女', 'Tôn Thất': '宗室', 'Tư Mã': '司馬',
};
