// AI connections end to end over HTTP: OAuth (metadata, registration, PKCE, consent in the app, token, revoke), the /mcp
// endpoint through the MCP SDK client, and the rules behind each tool (privacy, suggestions, preview -> apply, stale
// check, batch cap, admin requests, elicitation). Needs a SCRATCH database: GP_TEST_DATABASE_URL=postgres://... (skipped otherwise).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { ElicitRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `ai-${TAG}`; // public
const PRIV = `ai-p-${TAG}`; // private (not used for reads by guests)
const rid = () => 'P' + (800000 + crypto.randomInt(99000));
const P1 = rid(); const P2 = rid(); const PX = rid();
const EMAIL = { owner: `owner.${TAG}@example.test`, editor: `editor.${TAG}@example.test`, member: `member.${TAG}@example.test`, guest: `guest.${TAG}@example.test` };
const SECRET = crypto.randomBytes(24).toString('hex');
const REDIRECT = 'http://localhost:4567/cb';
let base; let pool; let close; let sess = {};

async function call(method, p, body, cookie, headers = {}) {
  const r = await fetch(base + p, { method, redirect: 'manual',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const cookieFrom = (r) => {
  const all = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')];
  const gp = all.find((c) => c && c.startsWith('gp_s=') && !/Max-Age=0/.test(c));
  return gp ? gp.split(';')[0] : null;
};
async function signIn(email, name) {
  const r = await call('POST', '/api/test/session', { email, name });
  assert.equal(r.status, 200, r.text);
  return cookieFrom(r);
}
// OAuth: register a client, authorize (PKCE), consent in the app for one family and scopes, exchange the code.
async function connect(session, scopes, famId, clientName = 'Trợ lý thử') {
  const reg = await call('POST', '/oauth/register', { client_name: clientName, redirect_uris: [REDIRECT] });
  assert.equal(reg.status, 201, reg.text);
  const cid = reg.json.client_id;
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: cid, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st-' + TAG, scope: scopes.join(' '), resource: base + '/mcp' });
  const auth = await call('GET', '/oauth/authorize?' + q, undefined);
  assert.equal(auth.status, 302, auth.text);
  assert.match(auth.headers.get('location') || '', /\/oauth\/consent$/);
  const oa = /gp_oa=([^;]+)/.exec(auth.headers.get('set-cookie'))[1];
  const cookie = `${session}; gp_oa=${oa}`;
  const cons = await call('POST', '/api/oauth/consent', { family: famId, scopes, decision: 'allow' }, cookie);
  assert.equal(cons.status, 200, cons.text);
  const back = new URL(cons.json.redirect);
  assert.equal(back.searchParams.get('state'), 'st-' + TAG);
  const form = new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code'), client_id: cid, redirect_uri: REDIRECT, code_verifier: verifier });
  const t = await fetch(base + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  assert.equal(t.status, 200, 'token exchange');
  const json = await t.json();
  return { access: json.access_token, refresh: json.refresh_token, cid, scope: json.scope };
}
// An MCP client over HTTP, with the access token. elicit: how the client answers a confirmation request (optional).
async function mcp(access, elicit) {
  const client = new Client({ name: 'giapha-test', version: '1.0.0' }, { capabilities: elicit ? { elicitation: {} } : {} });
  if (elicit) client.setRequestHandler(ElicitRequestSchema, async () => elicit);
  const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { authorization: 'Bearer ' + access } } });
  await client.connect(transport);
  return client;
}
const tool = async (client, name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, data: r.content?.[0]?.text ? JSON.parse(r.content[0].text) : null };
};
// Guests cannot connect (only members are listed). A member who connected and was removed afterwards acts as a guest:
// roles are read on every call, so the token is a guest token from then on.
async function asGuestNow(scopes, label) {
  const email = `gone-${label}-${TAG}@example.test`;
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,'Đã gỡ','member','active',$2)", [email, FAM]);
  const s = await signIn(email, 'Đã gỡ');
  const t = await connect(s, scopes, FAM, 'Trợ lý ' + label);
  await pool.query("update members set status='removed' where email=$1 and family_id=$2", [email, FAM]);
  return t;
}
const one = (sql, p) => pool.query(sql, p).then((r) => r.rows[0]);

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = SECRET;
  process.env.EDITORS = '';
  process.env.AI_REG_PER_HOUR = '100000';
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ AI thử',  '楊', 'public'), ($2,$2,'Họ riêng AI', '楊', 'private')", [FAM, PRIV]);
  await pool.query(`insert into persons (id, family_id, data) values
    ($1, $3, '{"name":"Dương Văn Ai","gen":3,"sex":"m","living":"living","birth_date":"1980-05-01","born":"1980","phone":"0900000001","email":"ai1@example.test","job":"Kỹ sư","contact_public":"no"}'),
    ($2, $3, '{"name":"Dương Thị Bé","gen":2,"sex":"f","living":"dead","died":"1950","birth_date":"1900-01-01","born":"1900","job":"Nội trợ"}'),
    ($4, $3, '{"name":"Dương Chờ Duyệt","gen":4,"sex":"m","living":"living","job":"Sinh viên"}')`, [P1, P2, FAM, PX]);
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,'Chủ AI','owner','active',$4), ($2,'Biên AI','editor','active',$4), ($3,'Thành AI','member','active',$4)",
    [EMAIL.owner, EMAIL.editor, EMAIL.member, FAM]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }); // SSE streams would hold the close
  sess.owner = await signIn(EMAIL.owner, 'Chủ AI');
  sess.editor = await signIn(EMAIL.editor, 'Biên AI');
  sess.member = await signIn(EMAIL.member, 'Thành AI');
  sess.guest = await signIn(EMAIL.guest, 'Khách AI');
});
test.after(async () => { if (close) await close(); if (pool) await pool.end(); });

test('metadata, registration and the refusals', { skip }, async () => {
  const pr = await call('GET', '/.well-known/oauth-protected-resource');
  assert.equal(pr.status, 200);
  assert.ok(pr.json.resource.endsWith('/mcp'));
  assert.deepEqual(pr.json.authorization_servers, [base]);
  const as = await call('GET', '/.well-known/oauth-authorization-server');
  assert.equal(as.json.code_challenge_methods_supported[0], 'S256');
  assert.equal(as.json.token_endpoint, base + '/oauth/token');
  const bad = await call('POST', '/oauth/register', { client_name: 'x', redirect_uris: ['http://evil.example/cb'] });
  assert.equal(bad.status, 400, 'a plain http redirect off this machine is refused');
  const frag = await call('POST', '/oauth/register', { client_name: 'x', redirect_uris: ['https://a.example/cb#x'] });
  assert.equal(frag.status, 400);
  const noauth = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(noauth.status, 401);
  assert.match(noauth.headers.get('www-authenticate') || '', /resource_metadata=/);
  const get = await call('GET', '/mcp');
  assert.equal(get.status, 401, 'auth comes before the method check');
});

test('PKCE and codes: wrong verifier, reuse and an unregistered redirect are refused', { skip }, async () => {
  const reg = await call('POST', '/oauth/register', { client_name: 'PKCE', redirect_uris: [REDIRECT] });
  const cid = reg.json.client_id;
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = (extra) => new URLSearchParams({ response_type: 'code', client_id: cid, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope: 'read', ...extra });
  const wrongRedirect = await call('GET', '/oauth/authorize?' + q({ redirect_uri: 'http://localhost:9/other' }));
  assert.equal(wrongRedirect.status, 400, 'an unregistered redirect is never followed');
  const plain = await call('GET', '/oauth/authorize?' + q({ code_challenge_method: 'plain' }));
  assert.equal(plain.status, 302);
  assert.match(plain.headers.get('location'), /error=invalid_request/);
  const auth = await call('GET', '/oauth/authorize?' + q({}));
  const oa = /gp_oa=([^;]+)/.exec(auth.headers.get('set-cookie'))[1];
  const cons = await call('POST', '/api/oauth/consent', { family: FAM, scopes: ['read'], decision: 'allow' }, `${sess.member}; gp_oa=${oa}`);
  const code = new URL(cons.json.redirect).searchParams.get('code');
  const tokenWith = (v) => fetch(base + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: cid, redirect_uri: REDIRECT, code_verifier: v }) });
  const wrong = await tokenWith(crypto.randomBytes(48).toString('base64url'));
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, 'invalid_grant');
  const ok = await tokenWith(verifier);
  assert.equal(ok.status, 400, 'the code is one-time: a failed exchange already used it');
});

test('reading: privacy follows the web (guest sees the birth year only; members see full details)', { skip }, async () => {
  const guest = await asGuestNow(['read'], 'khach');
  const g = await mcp(guest.access);
  const got = await tool(g, 'get_person', { person_id: P1 });
  assert.equal(got.isError, false);
  assert.equal(got.data.person.born, '1980', 'birth year is public');
  assert.equal(got.data.person.birth_date, undefined, 'full birth date is for members');
  assert.equal(got.data.person.phone, undefined, 'phone of a living person is private');
  const member = await connect(sess.member, ['read'], FAM);
  const m = await mcp(member.access);
  const full = await tool(m, 'get_person', { person_id: P1 });
  assert.equal(full.data.person.phone, '0900000001', 'a member sees the phone');
  const found = await tool(m, 'search_people', { query: 'van ai' });
  assert.equal(found.isError, false, JSON.stringify(found.data));
  assert.ok(found.data.people.some((p) => p.id === P1), 'search ignores accents');
  const book = await tool(m, 'get_book_link', { gen: 2 });
  assert.match(book.data.url, new RegExp(`/book\\?family=${FAM}`));
  assert.match(book.data.embed_html, /embed=1/);
  assert.match(book.data.print_url, /inapp=1/);
  const fams = await tool(m, 'list_families', {});
  assert.equal(fams.data.families.length, 1);
  assert.equal(fams.data.families[0].your_role, 'member');
  const tl = await tool(m, 'get_timeline', { person_id: P1 });
  assert.equal(tl.data.hidden, false);
  const rel = await tool(m, 'get_relatives', { person_id: P2 });
  assert.equal(rel.isError, false);
});

test('read-only token: the write tools are not even listed; a suggest attempt is refused', { skip }, async () => {
  const t = await connect(sess.member, ['read'], FAM);
  const c = await mcp(t.access);
  const names = (await c.listTools()).tools.map((x) => x.name);
  assert.ok(names.includes('get_person'));
  assert.ok(!names.includes('propose_changes') && !names.includes('apply_changes') && !names.includes('invite_member'));
  const r = await c.callTool({ name: 'propose_changes', arguments: { changes: [{ type: 'edit', person_id: P2, fields: { job: 'X' } }] } }).catch((e) => ({ isError: true, e }));
  assert.equal(!!r.isError, true);
});

test('suggest path: a member\'s proposal waits for an admin, then applies with the AI in the history', { skip }, async () => {
  const t = await connect(sess.member, ['suggest'], FAM, 'Trợ lý góp ý');
  const c = await mcp(t.access);
  const out = await tool(c, 'propose_changes', { changes: [{ type: 'edit', person_id: P2, fields: { job: 'Giáo viên' } }] });
  assert.equal(out.data.mode, 'suggested');
  const sid = out.data.suggestions[0].id;
  const s = await one('select status, by_name, changes from suggestions where id = $1', [sid]);
  assert.equal(s.status, 'pending');
  assert.match(s.by_name, /qua AI · Trợ lý góp ý/);
  assert.equal((await one("select data->>'job' as job from persons where id=$1", [P2])).job, 'Nội trợ', 'nothing written yet');
  const ap = await call('POST', `/api/suggestions/${sid}/approve`, { fields: {} }, sess.owner);
  assert.equal(ap.status, 200, ap.text);
  assert.equal((await one("select data->>'job' as job from persons where id=$1", [P2])).job, 'Giáo viên');
  const h = await one("select by_user from history where person_id=$1 and field='job' order by at desc limit 1", [P2]);
  assert.match(h.by_user, /qua AI · Trợ lý góp ý/);
});

test('editor: preview first, apply writes once (idempotent op_id), history tagged with the client', { skip }, async () => {
  const t = await connect(sess.editor, ['read', 'write'], FAM, 'Trợ lý biên tập');
  const c = await mcp(t.access);
  const pv = await tool(c, 'propose_changes', { changes: [{ type: 'edit', person_id: P1, fields: { job: 'Bác sĩ' } }] });
  assert.equal(pv.data.mode, 'preview');
  assert.equal(pv.data.preview.counts.field_changes, 1);
  assert.equal(pv.data.preview.diff[0].old, 'Kỹ sư');
  assert.equal(pv.data.preview.diff[0].new, 'Bác sĩ');
  assert.equal((await one("select data->>'job' as job from persons where id=$1", [P1])).job, 'Kỹ sư', 'a preview writes nothing');
  const batch = pv.data.batch_id;
  const ap = await tool(c, 'apply_changes', { batch_id: batch, op_id: 'op-' + TAG });
  assert.equal(ap.isError, false, JSON.stringify(ap.data));
  assert.equal(ap.data.applied, 1);
  assert.equal((await one("select data->>'job' as job from persons where id=$1", [P1])).job, 'Bác sĩ');
  const h = await one("select by_user from history where person_id=$1 and field='job' order by at desc limit 1", [P1]);
  assert.match(h.by_user, /qua AI · Trợ lý biên tập/);
  const again = await tool(c, 'apply_changes', { batch_id: batch, op_id: 'op-' + TAG });
  assert.equal(again.isError, false);
  assert.equal(again.data.duplicate, true, 'the same op_id is not written twice');
  const other = await tool(c, 'apply_changes', { batch_id: batch, op_id: 'other-' + TAG });
  assert.equal(other.isError, true, 'a different op_id on an applied batch is refused');
  const hist = await pool.query("select count(*)::int n from history where person_id=$1 and field='job'", [P1]);
  assert.equal(hist.rows[0].n, 1, 'one history row for the one change; a repeated apply writes nothing');
});

test('stale preview: a change made after the preview refuses the apply', { skip }, async () => {
  const t = await connect(sess.editor, ['write'], FAM);
  const c = await mcp(t.access);
  const pv = await tool(c, 'propose_changes', { changes: [{ type: 'edit', person_id: P2, fields: { note: 'từ AI' } }] });
  await call('POST', '/api/ops', { family: FAM, ops: [{ op_id: 'human-' + TAG, id: P2, fields: { note: 'người khác sửa' }, ts: Date.now() + 1000 }] }, sess.owner);
  const ap = await tool(c, 'apply_changes', { batch_id: pv.data.batch_id, op_id: 'stale-' + TAG });
  assert.equal(ap.isError, true);
  assert.match(ap.data.error, /xem trước|Xem trước/);
  assert.ok(ap.data.stale.includes(P2));
});

test('batch cap: more than 200 records in one batch is refused', { skip }, async () => {
  const t = await connect(sess.editor, ['write'], FAM);
  const c = await mcp(t.access);
  const changes = Array.from({ length: 201 }, (_, i) => ({ type: 'edit', person_id: P1, fields: { note: 'n' + i } }));
  const r = await c.callTool({ name: 'propose_changes', arguments: { changes } }).catch((e) => ({ isError: true, e }));
  assert.equal(!!r.isError, true, 'refused before any preview is stored');
  const rows = await pool.query("select count(*)::int n from ai_batches where family_id=$1 and status='previewed' and changes::text like '%n200%'", [FAM]);
  assert.equal(rows.rows[0].n, 0);
});

test('guest or member with write scope: proposals become suggestions and apply is refused', { skip }, async () => {
  const t = await asGuestNow(['write'], 'ghi');
  const c = await mcp(t.access);
  const out = await tool(c, 'propose_changes', { changes: [{ type: 'edit', person_id: PX, fields: { job: 'Kỹ sư phần mềm' } }] });
  assert.equal(out.data.mode, 'suggested', 'a guest never gets a preview batch');
  const ap = await tool(c, 'apply_changes', { batch_id: 'b' + '0'.repeat(24), op_id: 'g1' });
  assert.equal(ap.isError, true);
  assert.equal((await one("select data->>'job' as job from persons where id=$1", [PX])).job, 'Sinh viên', 'nothing written');
});

test('admin actions never run directly: a request waits for an admin in the app', { skip }, async () => {
  const t = await connect(sess.owner, ['admin', 'read'], FAM, 'Trợ lý quản trị');
  const c = await mcp(t.access);
  const names = (await c.listTools()).tools.map((x) => x.name);
  assert.ok(names.includes('invite_member'));
  const inv = await tool(c, 'invite_member', { email: `new.${TAG}@example.test`, role: 'member' });
  assert.equal(inv.data.status, 'pending');
  const exists = await one('select 1 from members where email=$1', [`new.${TAG}@example.test`]);
  assert.equal(exists, undefined, 'no member yet');
  const list = await call('GET', '/api/ai/requests', undefined, sess.owner);
  const mine = list.json.items.find((i) => i.id === inv.data.request_id);
  assert.ok(mine, 'the request is in the inbox');
  assert.equal(mine.action, 'invite_member');
  const ok = await call('POST', `/api/ai/requests/${inv.data.request_id}/approve`, {}, sess.owner);
  assert.equal(ok.status, 200, ok.text);
  const now = await one("select status from members where email=$1 and family_id=$2", [`new.${TAG}@example.test`, FAM]);
  assert.equal(now.status, 'active');
  const again = await call('POST', `/api/ai/requests/${inv.data.request_id}/approve`, {}, sess.owner);
  assert.equal(again.status, 409);
});

test('admin tools need an admin account: an editor with an admin scope is refused', { skip }, async () => {
  const t = await connect(sess.editor, ['admin'], FAM);
  const c = await mcp(t.access);
  const r = await tool(c, 'remove_member', { member_id: 1 });
  assert.equal(r.isError, true);
});

test('elicitation: a declined confirmation is still logged, as cancelled', { skip }, async () => {
  const t = await connect(sess.owner, ['admin'], FAM, 'Trợ lý hỏi lại');
  const c = await mcp(t.access, { action: 'decline' });
  const r = await tool(c, 'remove_member', { member_id: await memberIdOf(EMAIL.member) });
  assert.equal(r.data.status, 'cancelled');
  const row = await one("select status, elicited from ai_requests where client_name='Trợ lý hỏi lại' order by id desc limit 1", []);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.elicited, true);
});

test('elicitation accepted: the request is still pending for an admin (never executed here)', { skip }, async () => {
  const t = await connect(sess.owner, ['admin'], FAM, 'Trợ lý đồng ý');
  const c = await mcp(t.access, { action: 'accept', content: { confirm: true } });
  const r = await tool(c, 'change_role', { member_id: await memberIdOf(EMAIL.member), role: 'editor' });
  assert.equal(r.data.status, 'pending');
  assert.equal((await one('select role from members where email=$1 and family_id=$2', [EMAIL.member, FAM])).role, 'member');
});
async function memberIdOf(email) { return (await one('select id from members where email=$1 and family_id=$2', [email, FAM])).id; }

test('revoke: the token stops working at once and leaves the Settings list', { skip }, async () => {
  const t = await connect(sess.member, ['read'], FAM, 'Trợ lý thu hồi');
  const before = await call('GET', '/api/ai/connections', undefined, sess.member);
  assert.ok(before.json.items.some((i) => i.client_name === 'Trợ lý thu hồi'), 'listed while active');
  const row = await one('select id, token_hash from ai_tokens where client_id=$1', [t.cid]);
  assert.notEqual(row.token_hash, t.access, 'only the hash is stored');
  const rv = await call('POST', '/oauth/revoke', undefined, undefined, {});
  assert.ok(rv.status === 200);
  const rv2 = await fetch(base + '/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.access }) });
  assert.equal(rv2.status, 200);
  await assert.rejects(() => mcp(t.access), /401|Unauthorized|Cần đăng nhập/i);
  const after = await call('GET', '/api/ai/connections', undefined, sess.member);
  assert.ok(!after.json.items.some((i) => i.client_name === 'Trợ lý thu hồi'), 'gone from the list');
});

test('Settings revoke: one row by id, only for the account that owns it', { skip }, async () => {
  const t = await connect(sess.member, ['read'], FAM, 'Trợ lý Cài đặt');
  const list = await call('GET', '/api/ai/connections', undefined, sess.member);
  const item = list.json.items.find((i) => i.client_name === 'Trợ lý Cài đặt');
  const other = await call('POST', `/api/ai/connections/${item.id}/revoke`, {}, sess.editor);
  assert.equal(other.status, 404, 'another account cannot revoke it');
  const mine = await call('POST', `/api/ai/connections/${item.id}/revoke`, {}, sess.member);
  assert.equal(mine.status, 200);
  await assert.rejects(() => mcp(t.access));
});

test('refresh token rotates: the old access token stops, the new one works', { skip }, async () => {
  const t = await connect(sess.member, ['read'], FAM, 'Trợ lý làm mới');
  const r = await fetch(base + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.cid }) });
  assert.equal(r.status, 200);
  const next = await r.json();
  assert.notEqual(next.access_token, t.access);
  const c = await mcp(next.access_token);
  assert.equal((await tool(c, 'list_families', {})).isError, false);
  await assert.rejects(() => mcp(t.access));
});

test('rate limit: 120 calls a minute per token, then a clear refusal', () => {
  const { rateLimited } = require('../ai-mcp');
  const id = 'rl-' + TAG;
  let blocked = 0;
  for (let i = 0; i < 125; i++) if (rateLimited(id)) blocked++;
  assert.equal(blocked, 5);
});

test('add_event: a member\'s event waits as a suggestion, with the same event rules as the web', { skip }, async () => {
  const t = await connect(sess.member, ['suggest'], FAM, 'Trợ lý sự kiện');
  const c = await mcp(t.access);
  const out = await tool(c, 'add_event', { person_id: P2, item: { type: 'sinh', date_text: '1900', place: 'Quảng Nam', description: 'Sinh' } });
  assert.equal(out.isError, false, JSON.stringify(out.data));
  assert.equal(out.data.mode, 'suggested');
  const s = await one('select changes, person_id, status from suggestions where id = $1', [out.data.suggestions[0].id]);
  assert.equal(s.status, 'pending');
  assert.equal(s.person_id, P2);
  assert.equal(s.changes._ev.action, 'add');
  assert.equal(s.changes._ev.kind, 'event');
  const bad = await tool(c, 'add_event', { person_id: P2, item: { type: 'khong_co' } });
  assert.equal(bad.isError, true, 'an event without the web rules is refused before storing');
});

test('add_relation: an editor previews a parent-child link, the apply writes it once', { skip }, async () => {
  const RF = `ai-r-${TAG}`;
  await pool.query("insert into families (id, slug, name, han, visibility) values ($1,$1,'Họ quan hệ AI','楊','public')", [RF]);
  const A = rid(); const B = rid();
  await pool.query(`insert into persons (id, family_id, data) values ($1,$3,'{"name":"Cha thử","gen":1,"sex":"m"}'), ($2,$3,'{"name":"Con thử","gen":2,"sex":"f"}')`, [A, B, RF]);
  await pool.query('insert into relation_migrations (family_id) values ($1)', [RF]);
  const ed = `rel-ed.${TAG}@example.test`;
  await pool.query("insert into members (email, name, role, status, family_id) values ($1,'Biên quan hệ','editor','active',$2)", [ed, RF]);
  const s = await signIn(ed, 'Biên quan hệ');
  const t = await connect(s, ['write'], RF, 'Trợ lý quan hệ');
  const c = await mcp(t.access);
  const pv = await tool(c, 'add_relation', { relation: { kind: 'parent_child', parent_id: A, child_id: B, pc_kind: 'ruot' } });
  assert.equal(pv.isError, false, JSON.stringify(pv.data));
  assert.equal(pv.data.mode, 'preview');
  assert.equal((await pool.query('select 1 from parent_child where family_id = $1', [RF])).rowCount, 0, 'a preview writes nothing');
  const ap = await tool(c, 'apply_changes', { batch_id: pv.data.batch_id, op_id: 'rel-' + TAG });
  assert.equal(ap.isError, false, JSON.stringify(ap.data));
  const link = await pool.query('select 1 from parent_child where family_id = $1 and parent_id = $2 and child_id = $3', [RF, A, B]);
  assert.equal(link.rowCount, 1);
  const again = await tool(c, 'apply_changes', { batch_id: pv.data.batch_id, op_id: 'rel-' + TAG });
  assert.equal(again.data.duplicate, true);
  assert.equal((await pool.query('select 1 from parent_child where family_id = $1', [RF])).rowCount, 1, 'one link, not two');
});

test('consent deny: no code is issued; the client is told access_denied', { skip }, async () => {
  const reg = await call('POST', '/oauth/register', { client_name: 'Từ chối', redirect_uris: [REDIRECT] });
  const verifier = crypto.randomBytes(48).toString('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.json.client_id, redirect_uri: REDIRECT, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', scope: 'read', state: 'deny-' + TAG });
  const auth = await call('GET', '/oauth/authorize?' + q);
  const oa = /gp_oa=([^;]+)/.exec(auth.headers.get('set-cookie'))[1];
  const cons = await call('POST', '/api/oauth/consent', { decision: 'deny' }, `${sess.member}; gp_oa=${oa}`);
  assert.equal(cons.status, 200, cons.text);
  const back = new URL(cons.json.redirect);
  assert.equal(back.searchParams.get('error'), 'access_denied');
  assert.equal(back.searchParams.get('state'), 'deny-' + TAG);
  assert.equal(back.searchParams.get('code'), null);
  assert.equal((await pool.query('select 1 from ai_codes where client_id = $1', [reg.json.client_id])).rowCount, 0);
  const again = await call('POST', '/api/oauth/consent', { family: FAM, scopes: ['read'], decision: 'allow' }, `${sess.member}; gp_oa=${oa}`);
  assert.equal(again.status, 404, 'the request is used up by the decision');
});

test('refresh reuse (RFC 9700): a rotated refresh token used again revokes the whole grant', { skip }, async () => {
  const t = await connect(sess.member, ['read'], FAM, 'Trợ lý reuse');
  const refresh = (rt) => fetch(base + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: t.cid }) });
  const r1 = await refresh(t.refresh);
  assert.equal(r1.status, 200);
  const n1 = await r1.json();
  const r2 = await refresh(t.refresh); // the same token again: a leak
  assert.equal(r2.status, 400);
  const r3 = await refresh(n1.refresh_token); // the newer one is part of the same grant: revoked too
  assert.equal(r3.status, 400, 'the whole grant is revoked');
  await assert.rejects(() => mcp(n1.access_token));
  await assert.rejects(() => mcp(t.access));
});

test('only members connect: a guest cannot consent, and the family list is the memberships', { skip }, async () => {
  const reg = await call('POST', '/oauth/register', { client_name: 'Chỉ thành viên', redirect_uris: [REDIRECT] });
  const verifier = crypto.randomBytes(48).toString('base64url');
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.json.client_id, redirect_uri: REDIRECT, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'read' });
  const auth = await call('GET', '/oauth/authorize?' + q);
  const oa = /gp_oa=([^;]+)/.exec(auth.headers.get('set-cookie'))[1];
  const list = await call('GET', '/api/oauth/request', undefined, `${sess.member}; gp_oa=${oa}`);
  const slugs = list.json.families.map((f) => f.slug);
  assert.ok(slugs.includes(FAM), 'a family the member belongs to is listed');
  assert.ok(!slugs.includes(PRIV), 'a family of non-members is not listed');
  const guestTry = await call('POST', '/api/oauth/consent', { family: FAM, scopes: ['read'], decision: 'allow' }, `${sess.guest}; gp_oa=${oa}`);
  assert.equal(guestTry.status, 403);
});
