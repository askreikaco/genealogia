// Gợi ý câu lệnh cho AI (sheet Kết nối ứng dụng AI). Tiếng Việt; generated from scratchpad ai1/vi.json.
export const AI_RECIPES = [
  {
    "id": "tieu-su",
    "title": "Viết tiểu sử từ gia phả",
    "prompt": "Dùng gia phả để đọc người [họ tên người cần viết] (thông tin, sự kiện và quan hệ, qua các công cụ get_person, get_timeline và get_relatives). Viết một tiểu sử ngắn bằng tiếng Việt, chỉ dựa trên những gì đã đọc được. Không bịa thêm; chỗ thiếu thì ghi rõ [chưa có thông tin]. Cuối bài, liệt kê từng dữ kiện đã dùng kèm nguồn (sự kiện hoặc câu chuyện)."
  },
  {
    "id": "chep-trang",
    "title": "Chép trang gia phả cũ",
    "prompt": "Tôi gửi ảnh một trang gia phả cũ [mô tả ngắn, ví dụ: trang 12, chi họ Nguyễn]. Chép nguyên văn chữ Hán Nôm hoặc quốc ngữ, rồi dịch sang tiếng Việt hiện đại. Dùng search_people để khớp từng tên với người đã có trong gia phả, và ghi rõ tên nào chưa khớp. Chỉ gửi thay đổi bằng suggest_person_change để thành góp ý, không ghi trực tiếp."
  }
];
