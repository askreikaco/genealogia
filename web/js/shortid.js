// Stable person ID (mã người): 6 random characters + 1 check character from Crockford's base32 set without Z (31 symbols), stored in persons.short_id
// (set by the database on insert, never changes) and shown as "D7K2-QX3". It says nothing about position in the tree,
// so it stays the same when birth order, the thủy tổ or the tree around the person changes.
// Input is forgiving (Crockford): case, spaces and dashes are ignored, O reads as 0, I and L read as 1, U as V.
// Check character: sum of (position × value) over the 6 characters, mod 31 -> one alphabet character; it catches every
// single wrong character and every swap of two neighbouring different characters. Plain ES module (server tests too).
// 31 symbols (Crockford base32 minus Z): with a prime count, the mod-31 check catches every single error and swap.
export const SID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXY';
const VAL = new Map([...SID_ALPHABET].map((c, i) => [c, i]));

export function sidCheck(body6) {
  let w = 0;
  for (let i = 0; i < 6; i++) { const v = VAL.get(body6[i]); if (v === undefined) return null; w += (i + 1) * v; }
  return SID_ALPHABET[w % 31];
}
// raw text -> canonical 7-char form (no dash), or '' when it is not a well-formed ID with a correct check character
export function normalizeSid(text) {
  const t = String(text ?? '').toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  if (!/^[0-9A-HJKMNP-TV-Y]{7}$/.test(t)) return '';
  return sidCheck(t.slice(0, 6)) === t[6] ? t : '';
}
export const isSid = (text) => normalizeSid(text) !== '';
// "D7K2QX3" -> "D7K2-QX3"
export const formatSid = (sid) => (sid && sid.length === 7 ? `${sid.slice(0, 4)}-${sid.slice(4)}` : String(sid || ''));
export const SID_HELP = 'Mã người cố định: không đổi khi thêm người, sửa thứ tự hay đổi thủy tổ. Dùng để tìm và chia sẻ đúng một người.';
