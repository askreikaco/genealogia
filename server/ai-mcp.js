// MCP endpoint (Streamable HTTP, stateless) at /mcp. Every call is authenticated with an OAuth access token (ai-oauth.js),
// checked against the scopes and the account's role in the token's family (ai-perm.js), then runs the tool in ai-tools.js.
// Tested in test/ai-mcp.test.js (SDK client over HTTP) and test/ai-tools.test.js.
'use strict';
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const P = require('./ai-perm');
const T = require('./ai-tools');
const crypto = require('crypto');
const { sha } = require('./ai-oauth');

const RATE_MAX = 120; const RATE_WINDOW_MS = 60e3; // calls per token per minute
const rate = new Map(); // token id -> [count, windowStart]
function rateLimited(id) {
  const now = Date.now(); const t = rate.get(id);
  if (rate.size > 5000) rate.clear();
  if (!t || now - t[1] > RATE_WINDOW_MS) { rate.set(id, [1, now]); return false; }
  if (t[0] >= RATE_MAX) return true;
  t[0]++; return false;
}

const ID = z.string().regex(/^P\d{3,6}$|^N[0-9a-z-]{6,40}$/).describe('Mã người, ví dụ P001');
const VALUE = z.union([z.string().max(5000), z.number(), z.null(), z.boolean()]);
const ROLE_ASSIGN = z.enum(['admin', 'editor', 'member']);
const CHANGE = z.discriminatedUnion('type', [
  z.object({ type: z.literal('edit'), person_id: ID, fields: z.record(z.string(), VALUE).describe('Trường cần sửa: name, birth_date, place, job, note, ...') }),
  z.object({ type: z.literal('event'), person_id: ID, item: z.record(z.string(), z.any()).describe('Sự kiện: type, date_text, place, description') }),
  z.object({ type: z.literal('relation'), relation: z.looseObject({ kind: z.enum(['parent_child', 'couple']), action: z.literal('add').optional() }) }),
]);

// The tool's answer: compact JSON text. A failure is an isError result with the message (and details, when any).
async function run(name, fn) {
  try {
    const out = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(out) }] };
  } catch (e) {
    if (!e.status) console.error('ai tool', name, e && e.message);
    const body = e.status ? { error: e.message, ...(e.extra || {}) } : { error: 'Có trục trặc, vui lòng thử lại sau.' };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
  }
}
// Admin actions: the client asks the person to confirm (MCP elicitation) when it supports it. The request is still
// created and logged; an admin still approves it in the app.
async function confirmWith(server, message) {
  if (!server.server.getClientCapabilities()?.elicitation) return { supported: false, accepted: true };
  const r = await server.server.elicitInput({ message, requestedSchema: { type: 'object', properties: {
    confirm: { type: 'boolean', title: 'Gửi yêu cầu này để quản trị duyệt?' } }, required: ['confirm'] } });
  return { supported: true, accepted: r.action === 'accept' && r.content?.confirm === true };
}

function buildServer({ deps, tok, base }) {
  const server = new McpServer({ name: 'giapha', version: '1.0.0' }, { instructions:
    'Gia phả: tra cứu người và quan hệ, xem sách, đề xuất thay đổi. Mọi việc làm bằng quyền của người đã cho phép, ' +
    'không hơn. Sửa dữ liệu: propose_changes (xem trước) rồi apply_changes với batch_id. Quyền quản trị chỉ tạo yêu cầu để quản trị duyệt.' });
  const ctx = { tok, deps, base };
  const allowed = new Set(P.toolsForScopes(tok.scopes));
  // Each call: the tool must be allowed for the scopes and for the account's role here, else a plain refusal.
  const gate = async (name, fn) => run(name, async () => {
    const eff = await T.account(ctx);
    if (!P.toolAllowed(name, tok.scopes, eff.userRole)) throw Object.assign(new Error('Tài khoản này không có quyền việc này trong dòng họ này.'), { status: 403 });
    return fn();
  });
  const reg = (name, title, description, shape, handler) => {
    if (!allowed.has(name)) return;
    server.registerTool(name, { title, description, inputSchema: shape }, (args) => gate(name, () => handler(args || {})));
  };

  reg('list_families', 'Dòng họ', 'Dòng họ mà mã này được dùng, với vai trò hiện tại của bạn.', {},
    () => T.listFamilies(ctx));
  reg('search_people', 'Tìm người', 'Tìm người theo tên (không dấu cũng được).',
    { query: z.string().min(1).max(100), limit: z.number().int().min(1).max(25).optional() },
    (a) => T.searchPeople(ctx, a));
  reg('get_person', 'Chi tiết người', 'Một người. Hồ sơ riêng tư: chỉ thành viên thấy đầy đủ.',
    { person_id: ID }, (a) => T.getPerson(ctx, a));
  reg('get_relatives', 'Quan hệ', 'Cha mẹ, con, vợ/chồng, anh chị em của một người.', { person_id: ID }, (a) => T.getRelatives(ctx, a));
  reg('get_timeline', 'Sự kiện', 'Sự kiện và câu chuyện của một người.', { person_id: ID }, (a) => T.getTimeline(ctx, a));
  reg('get_book_link', 'Link sách', 'Link trang sách gia phả (có tham số nhánh, đời), mã nhúng iframe và link in.',
    { root: ID.optional(), dir: z.enum(['down', 'up', 'both']).optional(), gen: z.number().int().min(0).max(20).optional(),
      spouses: z.boolean().optional(), status: z.enum(['all', 'living', 'dead']).optional() },
    (a) => T.getBookLink(ctx, a));
  reg('propose_changes', 'Đề xuất thay đổi', 'Xem trước một lô thay đổi (tối đa 200). Người có quyền biên tập nhận lô xem trước để áp dụng; người khác tạo góp ý chờ quản trị duyệt.',
    { changes: z.array(CHANGE).min(1).max(P.MAX_BATCH) }, (a) => T.proposeChanges(ctx, a.changes));
  reg('add_event', 'Thêm sự kiện', 'Thêm một sự kiện cho một người (đi qua cùng đường với đề xuất).',
    { person_id: ID, item: z.record(z.string(), z.any()) }, (a) => T.proposeChanges(ctx, [{ type: 'event', person_id: a.person_id, item: a.item }]));
  reg('add_relation', 'Thêm quan hệ', 'Thêm quan hệ cha mẹ-con hoặc vợ/chồng (đi qua cùng đường với đề xuất).',
    { relation: z.looseObject({ kind: z.enum(['parent_child', 'couple']) }) },
    (a) => T.proposeChanges(ctx, [{ type: 'relation', relation: { ...a.relation, action: 'add' } }]));
  reg('suggest_person_change', 'Góp ý sửa một người', 'Góp ý sửa thông tin của một người: tạo góp ý chờ quản trị duyệt trong app. Không ghi ngay, kể cả khi mã có quyền ghi.',
    { person_id: ID, fields: z.record(z.string(), VALUE).describe('Trường cần sửa: name, birth_date, place, job, note, ...') },
    (a) => T.suggestPersonChange(ctx, a));
  reg('apply_changes', 'Áp dụng lô', 'Ghi một lô đã xem trước. Cần op_id mới cho mỗi lần ghi (gửi lại cùng op_id thì không ghi lần nữa).',
    { batch_id: z.string().regex(/^b[0-9a-f]{24}$/), op_id: z.string().min(1).max(80) },
    (a) => T.applyChanges(ctx, a));

  // Admin actions run no change here: confirm (elicitation when supported), then a logged request for an admin's approval.
  const adminAction = (name, title, label, shape) => reg(name, title, `${label}: chỉ tạo yêu cầu để quản trị duyệt trong app, không chạy ngay.`, shape,
    async (a) => {
      const c = await confirmWith(server, `${label}? Yêu cầu sẽ chờ quản trị duyệt.`);
      return T.requestAdminAction(ctx, name, a, { elicited: c.supported, cancelled: !c.accepted });
    });
  adminAction('invite_member', 'Mời thành viên', 'Mời thành viên qua email', { email: z.email().max(200), role: ROLE_ASSIGN.optional() });
  adminAction('change_role', 'Đổi vai trò', 'Đổi vai trò thành viên', { member_id: z.number().int().positive(), role: ROLE_ASSIGN });
  adminAction('remove_member', 'Gỡ thành viên', 'Gỡ thành viên khỏi dòng họ', { member_id: z.number().int().positive() });
  return server;
}

async function authToken(deps, req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const { rows } = await deps.pool.query('select * from ai_tokens where token_hash = $1 and revoked_at is null and expires_at > now()', [sha(m[1])]);
  return rows[0] || null;
}

// Sessions: the SDK keeps the client's capabilities (elicitation) per session, so a session is opened at initialize and
// bound to the token that opened it. Idle sessions end after 30 minutes.
const sessions = new Map(); // session id -> { transport, server, tokenId, last }
const SESSION_IDLE_MS = 30 * 60e3;
function sweep(now) { for (const [id, s] of sessions) if (now - s.last > SESSION_IDLE_MS) { sessions.delete(id); s.transport.close().catch(() => {}); } }

function mountMcp(app, deps) {
  const challenge = (req, res) => {
    res.set('WWW-Authenticate', `Bearer resource_metadata="${req.protocol}://${req.get('host')}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Cần đăng nhập bằng OAuth (Bearer).' }, id: null });
  };
  const bad = (res, status, code, message) => res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
  app.all('/mcp', async (req, res) => {
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return bad(res, 405, -32000, 'Dùng POST, GET hoặc DELETE.');
    let tok;
    try { tok = await authToken(deps, req); } catch (e) { console.error('mcp auth', e.message); return res.status(500).end(); }
    if (!tok) return challenge(req, res);
    if (rateLimited(tok.id)) { res.set('Retry-After', '60'); return bad(res, 429, -32029, 'Quá nhiều yêu cầu. Thử lại sau 1 phút.'); }
    sweep(Date.now());
    const sid = req.headers['mcp-session-id'];
    if (sid) {
      const s = sessions.get(String(sid));
      if (!s) return bad(res, 404, -32001, 'Phiên không còn. Kết nối lại.');
      if (s.tokenId !== tok.id) return bad(res, 403, -32000, 'Phiên này thuộc mã khác.');
      s.last = Date.now();
      if (req.method === 'DELETE') { sessions.delete(String(sid)); await s.transport.close().catch(() => {}); return res.status(200).end(); }
      try { return await s.transport.handleRequest(req, res, req.body); } catch (e) { console.error('mcp', e.message); if (!res.headersSent) bad(res, 500, -32603, 'Có trục trặc, vui lòng thử lại sau.'); return undefined; }
    }
    if (req.method !== 'POST' || !(req.body && req.body.method === 'initialize')) return bad(res, 400, -32000, 'Bắt đầu bằng initialize.');
    deps.pool.query('update ai_tokens set last_used_at = now() where id = $1', [tok.id]).catch(() => {});
    const server = buildServer({ deps, tok, base: `${req.protocol}://${req.get('host')}` });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => { sessions.set(id, { transport, server, tokenId: tok.id, last: Date.now() }); } });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('mcp', e.message);
      if (!res.headersSent) bad(res, 500, -32603, 'Có trục trặc, vui lòng thử lại sau.');
    }
  });
}

module.exports = { mountMcp, buildServer, rateLimited, sessions };
