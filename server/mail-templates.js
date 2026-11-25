// Mail templates (Vietnamese, plain and calm). Each returns { subject, html, text }. Pure: no DB, no network.
// Every value from users or data is escaped in html. Times are shown in Vietnam time (UTC+7).
'use strict';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// dd/mm/yyyy hh:mm (giờ Việt Nam)
function vnTime(d) {
  const t = new Date(new Date(d).getTime() + 7 * 3600e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

// One 600 px card: title, paragraphs, an optional button and a footer line.
function layout({ title, paras, button, footer }) {
  const body = paras.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#161616">${esc(p)}</p>`).join('');
  const btn = button ? `<p style="margin:24px 0 8px"><a href="${esc(button.url)}" style="display:inline-block;background:#0043ce;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:4px;font-size:16px">${esc(button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#525252">Nếu nút không mở được, hãy dán đường dẫn này vào trình duyệt:<br><span style="word-break:break-all">${esc(button.url)}</span></p>` : '';
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:6px">
<tr><td style="padding:24px 28px 0"><p style="margin:0;font-size:13px;color:#525252">Gia phả</p>
<h1 style="margin:8px 0 20px;font-size:22px;line-height:1.3;color:#161616;font-weight:700">${esc(title)}</h1></td></tr>
<tr><td style="padding:0 28px 24px">${body}${btn}</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #e0e0e0"><p style="margin:0;font-size:13px;line-height:1.5;color:#525252">${esc(footer || 'Đây là email tự động từ Gia phả. Vui lòng không trả lời email này.')}</p></td></tr>
</table></td></tr></table></body></html>`;
}
const textOf = (title, paras, button, footer) => [title, '', ...paras, ...(button ? ['', `${button.label}: ${button.url}`] : []), '', footer || 'Đây là email tự động từ Gia phả. Vui lòng không trả lời email này.'].join('\n');
function build(title, paras, button, footer) {
  return { html: layout({ title, paras, button, footer }), text: textOf(title, paras, button, footer) };
}

// Invite to be a trusted contact (Người được ủy thác). The link opens the accept page; accepting needs a Google sign-in with this email.
function trustedInvite({ family, inviter, name, url, days = 14 }) {
  const title = `Mời bạn làm Người được ủy thác của ${family}`;
  const paras = [`${name ? 'Chào ' + name + '. ' : 'Xin chào. '}${inviter || 'Chủ họ'} mời bạn làm Người được ủy thác của ${family}.`,
    'Người được ủy thác là người đầu tiên được báo khi Chủ họ lâu không đăng nhập, hoặc khi có báo đã mất. Bạn không cần làm gì khác ngoài việc chấp nhận bằng tài khoản Google có địa chỉ email này.',
    `Lời mời có hiệu lực trong ${days} ngày.`];
  const button = { label: 'Xem và chấp nhận lời mời', url };
  return { subject: title, ...build(title, paras, button) };
}

const REMINDER_WHEN = { '1m': '1 tháng', '1w': '1 tuần', '1d': '1 ngày' };
// Owner inactivity reminders: stage '1m' | '1w' | '1d' before the handover notice would start.
function ownerReminder({ family, stage, url, months }) {
  const when = REMINDER_WHEN[stage] || stage;
  const title = `Còn ${when} nữa, ${family} sẽ bắt đầu chuyển quyền Chủ họ`;
  const paras = [`Bạn chưa đăng nhập Gia phả của ${family} trong ${months} tháng qua.`,
    `Nếu bạn vẫn giữ quyền Chủ họ, hãy đăng nhập trước khi hết thời hạn ${when}. Đăng nhập một lần là đủ, và mọi việc được giữ như cũ.`,
    'Nếu không đăng nhập, dòng họ sẽ báo cho bạn kèm 14 ngày để hủy, rồi trao quyền cho Người được ủy thác, Quản trị hoặc Biên tập viên theo thứ tự.'];
  const button = { label: 'Đăng nhập để giữ quyền Chủ họ', url };
  return { subject: title, ...build(title, paras, button) };
}

// Notice to the owner: the handover starts after 14 days unless the owner signs in (that cancels it).
function handoverNotice({ family, deadline, url, reason }) {
  const title = `${family} sẽ chuyển quyền Chủ họ sau 14 ngày`;
  const why = reason === 'deceased'
    ? 'Có người báo Chủ họ đã mất và một người được ủy thác đã xác nhận.'
    : 'Chủ họ chưa đăng nhập đủ lâu theo thời hạn đã đặt.';
  const paras = [why, `Để hủy, hãy đăng nhập trước ${vnTime(deadline)} (giờ Việt Nam). Chỉ cần đăng nhập, không cần làm gì thêm.`,
    'Sau thời hạn này, quyền Chủ họ được mời lần lượt cho từng người trong danh sách, mỗi người có 14 ngày để nhận hoặc từ chối.'];
  const button = { label: 'Mở Cài đặt dòng họ để hủy', url };
  return { subject: title, ...build(title, paras, button) };
}

// Offer of the owner role to one candidate. The link opens the offer page; accepting needs a code sent to this email.
function handoverOffer({ family, expiresAt, url }) {
  const title = `Bạn được mời nhận quyền Chủ họ của ${family}`;
  const paras = ['Chủ họ trước chưa đăng nhập đủ lâu, và bạn là người tiếp theo trong danh sách được mời.',
    'Nếu nhận, bạn sẽ là Chủ họ. Chủ họ trước sẽ thành Quản trị và có 90 ngày để lấy lại quyền Chủ họ.',
    `Lời mời này hết hạn lúc ${vnTime(expiresAt)} (giờ Việt Nam). Để nhận, bạn sẽ nhập mã gửi tới email này.`];
  const button = { label: 'Xem lời mời', url };
  return { subject: title, ...build(title, paras, button) };
}

// The one-time code for an offer (15 minutes).
function handoverCode({ family, code, minutes = 15 }) {
  const title = `Mã xác nhận nhận quyền Chủ họ ${family}`;
  const paras = [`Mã của bạn là: ${code}`, `Mã có hiệu lực trong ${minutes} phút. Nếu bạn không yêu cầu mã này, hãy bỏ qua email.`];
  return { subject: title, ...build(title, paras, null) };
}

// To the trusted contacts or admins: a death report needs one confirmation.
function confirmRequest({ family, url }) {
  const title = `Cần xác nhận một báo cáo ở ${family}`;
  const paras = ['Một thành viên đã báo Chủ họ đã mất, kèm thông tin đính kèm.',
    'Nếu bạn xác nhận, dòng họ bắt đầu thời hạn 14 ngày. Trong thời hạn đó, Chủ họ có thể đăng nhập để hủy.'];
  const button = { label: 'Xem và xác nhận', url };
  return { subject: title, ...build(title, paras, button) };
}

// The owner role changed hands. role: 'new' (you are the owner now) | 'prev' (you are an admin now; 90 days to reclaim).
function ownerChanged({ family, role, name, reclaimUntil, url }) {
  if (role === 'new') {
    const title = `Bạn là Chủ họ của ${family}`;
    const paras = [`Quyền Chủ họ của ${family} đã chuyển cho bạn.`, 'Bạn có thể mời thành viên, duyệt góp ý và đặt thời hạn nhắc cho Chủ họ.'];
    return { subject: title, ...build(title, paras, { label: 'Mở dòng họ', url }) };
  }
  const title = `Quyền Chủ họ của ${family} đã chuyển cho ${name || 'người khác'}`;
  const paras = [`Bạn là Quản trị của ${family} từ bây giờ.`,
    `Đến ${vnTime(reclaimUntil)} (giờ Việt Nam) bạn vẫn có thể lấy lại quyền Chủ họ bằng cách đăng nhập và chọn "Lấy lại quyền Chủ họ".`];
  return { subject: title, ...build(title, paras, { label: 'Mở Cài đặt dòng họ', url }) };
}

// Someone asked to take over an unattended family. The owner refuses by signing in within 30 days.
function claimStarted({ family, claimant, deadline, url }) {
  const title = `Có người xin nhận quyền Chủ họ của ${family}`;
  const paras = [`${claimant || 'Một thành viên'} xin nhận quyền Chủ họ vì không có Người được ủy thác, Quản trị hay Biên tập viên nào để trao.`,
    `Các thành viên khác sẽ được hỏi có đồng ý không. Nếu bạn vẫn giữ quyền, hãy đăng nhập trước ${vnTime(deadline)} (giờ Việt Nam) để từ chối.`];
  return { subject: title, ...build(title, paras, { label: 'Đăng nhập để từ chối', url }) };
}

// Enough backers for a claim: the objection window runs until `deadline`. The owner may refuse by signing in; a member may object.
function claimWindow({ family, claimant, deadline, url }) {
  const title = `Đủ người ủng hộ xin nhận quyền Chủ họ của ${family}`;
  const paras = [`${claimant || 'Một thành viên'} đã đủ người ủng hộ để nhận quyền Chủ họ.`,
    `Trong 30 ngày, đến ${vnTime(deadline)} (giờ Việt Nam), Chủ họ có thể đăng nhập để từ chối, và thành viên có thể phản đối.`,
    'Nếu không có gì như vậy, quyền Chủ họ sẽ chuyển sang người xin nhận khi hết thời hạn.'];
  return { subject: title, ...build(title, paras, { label: 'Mở Cài đặt dòng họ', url }) };
}
// A member objected to a claim: the claim is stopped and the admins decide what to do next.
function claimObjected({ family, url }) {
  const title = `Có phản đối việc nhận quyền Chủ họ của ${family}`;
  const paras = ['Một thành viên đã phản đối việc nhận quyền Chủ họ. Việc này đã dừng và không chuyển quyền.',
    'Quản trị có thể xem lại và quyết định bước tiếp theo.'];
  return { subject: title, ...build(title, paras, { label: 'Mở Cài đặt dòng họ', url }) };
}

// A contribution (góp ý) to the sender's email: approved or rejected.
function contribution({ family, approved, personName, reason, url }) {
  const title = approved ? 'Góp ý của bạn đã được duyệt' : 'Góp ý của bạn chưa được duyệt';
  const what = personName ? `về ${personName} ` : '';
  const paras = [approved ? `Cảm ơn bạn. Góp ý ${what}trong ${family} đã được duyệt và đã cập nhật.`
    : `Cảm ơn bạn đã góp ý ${what}trong ${family}. Quản trị chưa duyệt góp ý này.${reason ? ' Lý do: ' + reason : ''}`];
  return { subject: title, ...build(title, paras, url ? { label: 'Mở dòng họ', url } : null) };
}

// A join request (xin tham gia): approved or rejected.
function joinDecision({ family, approved, url }) {
  const title = approved ? `Bạn đã được vào ${family}` : `Yêu cầu tham gia ${family} chưa được duyệt`;
  const paras = [approved ? 'Yêu cầu tham gia của bạn đã được duyệt. Bạn có thể xem và góp ý trong dòng họ.'
    : 'Quản trị dòng họ chưa duyệt yêu cầu tham gia của bạn. Bạn vẫn có thể xem dòng họ và gửi góp ý.'];
  return { subject: title, ...build(title, paras, { label: 'Mở dòng họ', url }) };
}

// Account: confirm an email added on the Account page (the link verifies it; it lives `minutes`).
function accountVerifyEmail({ url, minutes = 30 }) {
  const title = 'Xác minh email cho tài khoản Gia phả';
  const paras = ['Có người vừa thêm địa chỉ email này vào một tài khoản Gia phả. Nếu đó là bạn, bấm nút bên dưới để xác minh.',
    `Đường dẫn có hiệu lực trong ${minutes} phút và chỉ dùng được một lần. Nếu không phải bạn, hãy bỏ qua email này: email sẽ không được thêm.`];
  return { subject: title, ...build(title, paras, { label: 'Xác minh email', url }) };
}
// Account: a sign-in method was added or removed (sent to every verified email of the account).
function accountChanged({ what, when, device, url }) {
  const title = 'Tài khoản Gia phả của bạn vừa thay đổi';
  const paras = [`${what}.`, `Thời điểm: ${vnTime(when)}${device ? ' · ' + device : ''}.`,
    'Nếu không phải bạn, hãy mở trang Tài khoản, đăng xuất các thiết bị khác và gỡ cách đăng nhập lạ.'];
  return { subject: title, ...build(title, paras, { label: 'Mở trang Tài khoản', url }) };
}

// Thùng rác (server/trash.js): a person deleted / restored, a delete waiting for approval.
function trashNotice({ family, title, paras = [], url }) {
  return { subject: `${title} · ${family}`, ...build(title, [...paras, `Dòng họ: ${family}.`], { label: 'Mở Thùng rác', url }) };
}
// Nhận quản lý (tree claim): a claim opened for a tree with no active owner (sent to the owners of an abandoned tree),
// its approval or rejection (to the claimant and the other owners). The notice runs until `until`.
function treeClaimOpened({ family, claimant, abandoned, until, url }) {
  const title = `Có người xin nhận quản lý ${family}`;
  const paras = [`${claimant || 'Một người'} đã nộp đơn xin nhận quản lý dòng họ này${abandoned ? ' vì các Chủ họ hiện có đã lâu không đăng nhập hoặc đã mất' : ''}.`,
    `Đơn được công khai góp ý đến ${vnTime(until)} (giờ Việt Nam). Sau đó quản trị ứng dụng sẽ xem xét. Nếu bạn vẫn quản lý dòng họ, hãy đăng nhập để góp ý hoặc phản đối.`];
  return { subject: title, ...build(title, paras, { label: 'Xem dòng họ', url }) };
}
function treeClaimDecided({ family, approved, reason, url }) {
  const title = approved ? `Bạn đã được nhận quản lý ${family}` : `Đơn nhận quản lý ${family} chưa được duyệt`;
  const paras = approved ? [`Quản trị ứng dụng đã duyệt đơn. Bạn là Chủ họ của dòng họ này và có thể cùng quản lý với các Chủ họ khác.`]
    : [`Quản trị ứng dụng chưa duyệt đơn của bạn.`, `Lý do: ${reason || 'không ghi'}`];
  return { subject: title, ...build(title, paras, { label: 'Mở dòng họ', url }) };
}
// Another owner was added to a tree by an app admin (sent to the owners already there).
function treeOwnerAdded({ family, name, url }) {
  const title = `${name} đã được thêm làm Chủ họ ${family}`;
  return { subject: title, ...build(title, [`Quản trị ứng dụng đã duyệt đơn nhận quản lý. ${name} giờ có quyền Chủ họ cùng với bạn.`], { label: 'Mở dòng họ', url }) };
}
// The brake stopped an account's deletes (more than the hourly limit).
function deleteBrake({ family, who, count, limit, url }) {
  const title = `Đã tạm dừng việc xóa trong ${family}`;
  const paras = [`${who} đã xóa ${count} mục trong một giờ (giới hạn ${limit}). Việc xóa tiếp theo của tài khoản này bị từ chối trong một giờ.`,
    'Mọi mục đã xóa vẫn nằm trong Thùng rác và khôi phục được. Nếu đây không phải việc bạn mong muốn, hãy xem Thùng rác và đổi quyền của tài khoản này.'];
  return { subject: title, ...build(title, paras, { label: 'Mở Thùng rác', url }) };
}

// Tin họ: a new post or a gathering reminder (in-app notice and mail to members).
function newsNotice({ family, title, paras = [], url }) {
  return { subject: `${title} · ${family}`, ...build(title, [...paras, `Dòng họ: ${family}.`], { label: 'Mở tin', url }) };
}
module.exports = { treeClaimOpened, treeClaimDecided, treeOwnerAdded, newsNotice, trashNotice, deleteBrake, esc, vnTime, trustedInvite, ownerReminder, handoverNotice, handoverOffer, handoverCode, confirmRequest, ownerChanged, claimStarted, claimWindow, claimObjected, contribution, joinDecision, accountVerifyEmail, accountChanged };
