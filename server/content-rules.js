// Light checks before a family post is published (no external AI call). A post is HELD when a check fires: an owner or
// admin approves it on the Tin họ page. Edit the lists here; keep them short. Owners skip the link check only.
'use strict';
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|vn|info|xyz|top|me|io|co|biz|shop)\b)/i;
// A Vietnamese or international phone number, or a run of 9+ digits (a bank or account number).
const PHONE = /(\+?84|\b0)[\s.-]?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}\b/;
const ACCOUNT = /(?:\d[\s.-]?){9,}/;
// Block list: Vietnamese and English slurs and scam phrases. Whole words only.
const BLOCK = ['chuyển khoản', 'trúng thưởng', 'vay tiền', 'cho vay', 'lãi suất cao', 'kiếm tiền nhanh', 'nổ hũ', 'cá độ',
  'casino', 'bitcoin', 'free money', 'click here', 'win prize', 'loan now', 'fuck', 'shit', 'bitch', 'whore', 'slut'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORDS = BLOCK.map((w) => new RegExp(`(^|[^\\p{L}])${esc(w)}($|[^\\p{L}])`, 'iu'));

// Reasons a post is held: 'link', 'phone', 'account', 'word'. Empty when the post is clean.
// allowLink: owners may post links (still held for phone numbers, account numbers and block-list words).
function holdReasons(text, { allowLink = false } = {}) {
  const s = String(text || '').normalize('NFC');
  const out = [];
  if (!allowLink && LINK.test(s)) out.push('link');
  if (PHONE.test(s)) out.push('phone');
  if (ACCOUNT.test(s)) out.push('account');
  if (WORDS.some((re) => re.test(s))) out.push('word');
  return out;
}
const REASON_VI = { link: 'có liên kết', phone: 'có số điện thoại', account: 'có dãy số giống số tài khoản', word: 'có từ không phù hợp' };
module.exports = { holdReasons, REASON_VI, BLOCK };
