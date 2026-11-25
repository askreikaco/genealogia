// Nhận quản lý (claim an unowned or abandoned tree) and the join decision, as pure rules (no DB, no express).
// Tested in test/claim-rules.test.js. Owner decisions 2026-11-24: unowned trees are read-only references cared for by
// app admins; a claim needs evidence, then a 30-day public notice, then app-admin approval; non-exclusive; ownership
// never changes silently; system accounts (.invalid) are never owners; reference trees count as unowned.
'use strict';
const { SYSTEM_DOMAIN } = require('./system-accounts');
const { isDead } = require('./core');

const DAY = 86400e3;
const NOTICE_MS = 30 * DAY;      // public notice before approval
const INACTIVE_MS = 365 * DAY;   // an owner not seen for this long is inactive (baseline: last seen, else approved, else created)
const MAX_FILE_BYTES = 700 * 1024; // raw size; base64 of this stays under the 1 MB JSON limit
const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_EVIDENCE = 2000;

const norm = (s) => String(s || '').trim().toLowerCase();
const isSystemEmail = (e) => norm(e).endsWith(SYSTEM_DOMAIN);

// App admins: a comma-separated list of account emails in GP_APP_ADMINS (read on each call, so tests can set it).
const appAdmins = (list) => new Set(String(list || '').split(',').map(norm).filter(Boolean));
const isAppAdmin = (email, admins) => !!email && admins.has(norm(email));

// owners: active owner rows of one tree: { email, baseline_ms, deceased }. System accounts are dropped first.
// unowned: no real owner. abandoned: every real owner inactive for INACTIVE_MS or deceased. owned: otherwise.
function treeState(owners, nowMs) {
  const real = (owners || []).filter((o) => !isSystemEmail(o.email));
  if (!real.length) return { state: 'unowned', owners: 0 };
  const gone = real.every((o) => o.deceased || (o.baseline_ms != null && nowMs - o.baseline_ms >= INACTIVE_MS));
  return { state: gone ? 'abandoned' : 'owned', owners: real.length };
}
const claimable = (state) => state === 'unowned' || state === 'abandoned';

// Why a signed-in person cannot open a claim now, or null. ctx: { state, signedIn, isMember, hasOpen }.
function claimBlock({ state, signedIn, isMember, hasOpen }) {
  if (!signedIn) return 'Cần đăng nhập bằng Google để nhận quản lý.';
  if (isMember) return 'Bạn đã là thành viên của cây này.';
  if (!claimable(state)) return 'Cây này đã có Chủ họ đang quản lý.';
  if (hasOpen) return 'Bạn đã có đơn đang chờ góp ý cho cây này.';
  return null;
}

// Evidence: text (kept short) or a file, at least one. file: { type, bytes } or null.
function evidenceBlock({ evidence, file }) {
  const text = String(evidence || '').trim();
  if (text.length > MAX_EVIDENCE) return `Bằng chứng tối đa ${MAX_EVIDENCE} ký tự.`;
  if (!text && !file) return 'Cần ghi bằng chứng hoặc đính kèm một tệp.';
  if (file && !FILE_TYPES.includes(file.type)) return 'Tệp chỉ nhận PDF, JPG hoặc PNG.';
  if (file && file.bytes > MAX_FILE_BYTES) return 'Tệp tối đa 700 KB.';
  return null;
}

const noticeUntil = (createdMs) => createdMs + NOTICE_MS;
// The public notice shown on the tree: the latest open claim whose notice has not ended.
// claims: rows { status, notice_until (ms), abandoned }.
function publicNotice(claims, nowMs) {
  const open = (claims || []).filter((c) => c.status === 'notice' && c.notice_until > nowMs);
  if (!open.length) return null;
  const until = Math.max(...open.map((c) => c.notice_until));
  return { until, days_left: Math.ceil((until - nowMs) / DAY), abandoned: open.some((c) => c.abandoned), count: open.length };
}

// Approval: an app admin, a claim still open, and the notice has ended. Returns an error message or null.
function approveBlock({ claim, admin, nowMs }) {
  if (!admin) return 'Chỉ quản trị ứng dụng duyệt được.';
  if (!claim || claim.status !== 'notice') return 'Đơn này đã được xử lý.';
  if (nowMs < claim.notice_until) return 'Chưa hết 30 ngày góp ý công khai.';
  return null;
}
function rejectBlock({ claim, admin, reason }) {
  if (!admin) return 'Chỉ quản trị ứng dụng từ chối được.';
  if (!claim || claim.status !== 'notice') return 'Đơn này đã được xử lý.';
  if (!String(reason || '').trim()) return 'Cần ghi lý do từ chối.';
  return null;
}
const withdrawBlock = ({ claim, email }) => {
  if (!claim || norm(claim.claimant_email) !== norm(email)) return 'Chỉ người nộp đơn rút được.';
  if (claim.status !== 'notice') return 'Đơn này đã được xử lý.';
  return null;
};

// The change an approval makes: the claimant becomes an owner. `existing` is the member row today (or null), so the
// history can say what the role was before. Nothing else in the tree changes.
function approvalChange(existing) {
  return { role: 'owner', status: 'active', from: existing ? { role: existing.role, status: existing.status } : null };
}

// Who may decide a join link (person_links) that is pending: the owner or admin of the receiving tree (links-rules),
// or an app admin (owner decision: "approved by the board, or by an app admin").
const canDecideLink = ({ roleB, appAdmin }) => roleB === 'owner' || roleB === 'admin' || !!appAdmin;

// Owner death or inactivity for an owner row from the database: { deceased, baseline_ms }.
function ownerFacts({ person_data, deceased_email, email, last_seen_at, approved_at, created_at }) {
  const deceased = !!(person_data && isDead(person_data)) || !!deceased_email;
  const ms = (x) => (x ? new Date(x).getTime() : null);
  const baseline_ms = ms(last_seen_at) ?? ms(approved_at) ?? ms(created_at);
  return { email, deceased, baseline_ms };
}

module.exports = { DAY, NOTICE_MS, INACTIVE_MS, MAX_FILE_BYTES, FILE_TYPES, MAX_EVIDENCE, norm, isSystemEmail, appAdmins,
  isAppAdmin, treeState, claimable, claimBlock, evidenceBlock, noticeUntil, publicNotice, approveBlock, rejectBlock,
  withdrawBlock, approvalChange, canDecideLink, ownerFacts };
