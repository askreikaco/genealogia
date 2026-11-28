// Reusable sources (E2) over HTTP: who can read and write (guest 401, non-member 403, member reads, editor writes),
// validation, a citation with a source of another family (422), a source copied into the citations on rename, the
// usage count, the delete that is refused while an event cites the source, living privacy, the migration applied twice,
// and a GEDCOM round trip into an empty family (the sources and the citations, page and quality come back).
// Needs a SCRATCH database (GP_TEST_DATABASE_URL); skipped otherwise.
'use strict';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.GP_TEST_DATABASE_URL || '';
const skip = URL_ ? false : 'set GP_TEST_DATABASE_URL (scratch DB) to run';
const TAG = crypto.randomBytes(3).toString('hex');
const FAM = `srcapi-${TAG}`; const FAM2 = `srcapi2-${TAG}`; const FAM3 = `srcapi3-${TAG}`;
const CODE = 'src-code-' + crypto.randomBytes(4).toString('hex');
const CODE3 = 'src-code3-' + crypto.randomBytes(4).toString('hex');
const MEMBER = `src.member.${TAG}@example.test`; const OUTSIDER = `src.out.${TAG}@example.test`;
const LIVING = `N${TAG}liv1`; const DEAD = `N${TAG}dead1`;
let base, pool, close, editorCookie, editor3Cookie, memberCookie, outsiderCookie;
const op = (n) => `src-op-${TAG}-${n}`;

async function call(method, p, body, cookie) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const ev = (over = {}) => ({ type: 'hoc', date_kind: 'exact', date_from: '1980', date_text: '1980', place: 'Huế', description: 'Học trường làng', people: [], sources: [], is_preferred: true, ...over });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test.before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = URL_;
  process.env.SESSION_SECRET = crypto.randomBytes(24).toString('hex');
  process.env.EDITORS = `Tester:${FAM}:${sha(CODE)},Tester3:${FAM3}:${sha(CODE3)}`;
  const { app, pool: p } = require('../server');
  pool = p;
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter((x) => x.endsWith('.sql')).sort()) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8'));
  for (const f of [FAM, FAM2, FAM3]) await pool.query("insert into families (id, slug, name, visibility) values ($1,$1,'Thử nguồn','public')", [f]);
  await pool.query('insert into persons (id, family_id, data, updated_by) values ($1,$2,$3,$4), ($5,$2,$6,$4)', [
    LIVING, FAM, { name: 'Người Sống', sex: 'm', gen: 4, birth_date: '5/3/1962', born: '1962' }, 'test',
    DEAD, { name: 'Người Mất', sex: 'f', gen: 3, born: '1900', died: '1970' }]);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  close = () => new Promise((r) => srv.close(r));
  editorCookie = (await call('POST', '/api/login', { code: CODE })).headers.get('set-cookie').split(';')[0];
  editor3Cookie = (await call('POST', '/api/login', { code: CODE3 })).headers.get('set-cookie').split(';')[0];
  memberCookie = (await call('POST', '/api/test/session', { email: MEMBER, name: 'Thành viên nguồn' })).headers.get('set-cookie').split(';')[0];
  outsiderCookie = (await call('POST', '/api/test/session', { email: OUTSIDER, name: 'Người ngoài' })).headers.get('set-cookie').split(';')[0];
  await pool.query("insert into members (email, name, family_id, role, status) values ($1,'Thành viên nguồn',$2,'member','active')", [MEMBER, FAM]);
  // a source of another family, to be refused in this one
  await pool.query("insert into sources (id, family_id, title) values ('D' || substr(md5($1), 1, 12), $2, 'Sổ của họ khác')", [TAG, FAM2]);
});
test.after(async () => {
  if (skip || !pool) return;
  if (close) await close();
  await pool.query('delete from events where family_id = any($1)', [[FAM, FAM2, FAM3]]);
  await pool.query('delete from sources where family_id = any($1)', [[FAM, FAM2, FAM3]]);
  await pool.query('delete from history where person_id in ($1,$2)', [LIVING, DEAD]);
  await pool.query('delete from ops where person_id in ($1,$2)', [LIVING, DEAD]);
  await pool.query('delete from members where family_id = any($1)', [[FAM, FAM2, FAM3]]);
  await pool.query('delete from persons where family_id = any($1)', [[FAM, FAM2, FAM3]]);
  await pool.query('delete from families where id = any($1)', [[FAM, FAM2, FAM3]]);
  await pool.end();
});

let srcA; let srcB; let otherFamSource;
test('the migration applies twice without error (idempotent)', { skip }, async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '041_sources.sql'), 'utf8');
  await pool.query(sql); await pool.query(sql);
  const { rows } = await pool.query("select count(*)::int as n from information_schema.columns where table_name = 'sources' and column_name = 'deleted_at'");
  assert.equal(rows[0].n, 1);
});

test('read: guests 401, a signed-in non-member 403, a member reads (with usage 0)', { skip }, async () => {
  assert.equal((await call('GET', `/api/families/${FAM}/sources`)).status, 401);
  assert.equal((await call('GET', `/api/families/${FAM}/sources`, undefined, outsiderCookie)).status, 403);
  const r = await call('GET', `/api/families/${FAM}/sources`, undefined, memberCookie);
  assert.equal(r.status, 200, r.text); assert.deepEqual(r.json.items, []);
  assert.equal((await call('GET', '/api/families/no-such-family-xyz/sources', undefined, memberCookie)).status, 404);
});

test('write: members and outsiders are refused; an editor adds sources; bad input is 422', { skip }, async () => {
  const body = { title: 'Gia phả viết tay 1950', kind: 'gia_pha', author: 'Dương Văn Ất', year: '1950', url: 'https://example.test/gp', note: 'Bìa nâu' };
  assert.equal((await call('POST', `/api/families/${FAM}/sources`, body, memberCookie)).status, 403);
  assert.equal((await call('POST', `/api/families/${FAM}/sources`, body, outsiderCookie)).status, 403);
  const a = await call('POST', `/api/families/${FAM}/sources`, body, editorCookie);
  assert.equal(a.status, 200, a.text);
  assert.match(a.json.source.id, /^D[0-9a-f]{12}$/);
  assert.equal(a.json.source.year, 1950); assert.equal(a.json.source.kind, 'gia_pha');
  srcA = a.json.source;
  srcB = (await call('POST', `/api/families/${FAM}/sources`, { title: 'Bia mộ Nghĩa trang Hòa Thọ', kind: 'bia_mo' }, editorCookie)).json.source;
  for (const bad of [{ title: '  ' }, { title: 'x', kind: 'sach' }, { title: 'x', url: 'javascript:alert(1)' }, { title: 'x', year: 'abc' }, { title: 'x', year: 99999 }]) {
    const r = await call('POST', `/api/families/${FAM}/sources`, bad, editorCookie);
    assert.equal(r.status, 422, JSON.stringify(bad) + ' ' + r.text);
  }
  const list = await call('GET', `/api/families/${FAM}/sources`, undefined, memberCookie);
  assert.equal(list.json.items.length, 2);
});

test('an event cites a source of its family: the title is copied in, the page is kept, the usage counts', { skip }, async () => {
  const one = await call('POST', `/api/events?family=${FAM}`, { op_id: op(1), person_id: DEAD,
    event: ev({ sources: [{ source_id: srcA.id, title: 'tên tự gõ', page: 'tr. 12', quality: 'goc' }] }) }, editorCookie);
  assert.equal(one.status, 200, one.text);
  const c = one.json.event.sources[0];
  assert.equal(c.source_id, srcA.id); assert.equal(c.title, 'Gia phả viết tay 1950'); assert.equal(c.page, 'tr. 12'); assert.equal(c.quality, 'goc');
  const two = await call('POST', `/api/events?family=${FAM}`, { op_id: op(2), person_id: DEAD, event: ev({ type: 'nghe', description: 'Thợ mộc', sources: [{ source_id: srcA.id, title: '', page: 'mục 3' }] }) }, editorCookie);
  assert.equal(two.status, 200, two.text);
  const list = await call('GET', `/api/families/${FAM}/sources`, undefined, memberCookie);
  assert.equal(list.json.items.find((x) => x.id === srcA.id).uses, 2);
  assert.equal(list.json.items.find((x) => x.id === srcB.id).uses, 0);
});

test('a citation of a source of another family (or a broken id) is refused', { skip }, async () => {
  const row = await pool.query('select id from sources where family_id = $1', [FAM2]);
  otherFamSource = row.rows[0].id;
  const cross = await call('POST', `/api/events?family=${FAM}`, { op_id: op(3), person_id: DEAD, event: ev({ sources: [{ source_id: otherFamSource, title: 'x' }] }) }, editorCookie);
  assert.equal(cross.status, 422, cross.text);
  const broken = await call('POST', `/api/events?family=${FAM}`, { op_id: op(4), person_id: DEAD, event: ev({ sources: [{ source_id: 'D../etc', title: 'x' }] }) }, editorCookie);
  assert.equal(broken.status, 422, broken.text);
  const gone = await call('POST', `/api/events?family=${FAM}`, { op_id: op(5), person_id: DEAD, event: ev({ sources: [{ source_id: 'Dffffffffffff', title: 'x' }] }) }, editorCookie);
  assert.equal(gone.status, 422, gone.text);
  const page = await call('POST', `/api/events?family=${FAM}`, { op_id: op(6), person_id: DEAD, event: ev({ sources: [{ title: 'x', page: 'p'.repeat(201) }] }) }, editorCookie);
  assert.equal(page.status, 400, page.text);
});

test('renaming a source updates the citations that use it; a source in use is not deleted (409)', { skip }, async () => {
  const r = await call('PATCH', `/api/families/${FAM}/sources/${srcA.id}`, { title: 'Gia phả 1950 (bản sao)', kind: 'gia_pha', url: 'https://example.test/gp2' }, editorCookie);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.source.title, 'Gia phả 1950 (bản sao)');
  const ev1 = await call('GET', `/api/events?family=${FAM}&person=${DEAD}`, undefined, memberCookie);
  const cites = ev1.json.items.flatMap((e) => e.sources).filter((c) => c.source_id === srcA.id);
  assert.equal(cites.length, 2);
  assert.ok(cites.every((c) => c.title === 'Gia phả 1950 (bản sao)' && c.url === 'https://example.test/gp2'));
  assert.equal((await call('PATCH', `/api/families/${FAM}/sources/${srcA.id}`, { title: 'x' }, memberCookie)).status, 403);
  const del = await call('DELETE', `/api/families/${FAM}/sources/${srcA.id}`, undefined, editorCookie);
  assert.equal(del.status, 409, del.text); assert.equal(del.json.uses, 2);
  // clear the citations, then the source can go (soft delete: it leaves the list, the row stays)
  for (const [i, e] of ev1.json.items.entries()) {
    const put = await call('PUT', `/api/events/${e.id}?family=${FAM}`, { op_id: op(20 + i), event: ev({ description: e.description, sources: [] }) }, editorCookie);
    assert.equal(put.status, 200, put.text);
  }
  assert.equal((await call('DELETE', `/api/families/${FAM}/sources/${srcA.id}`, undefined, memberCookie)).status, 403);
  assert.equal((await call('DELETE', `/api/families/${FAM}/sources/${srcA.id}`, undefined, editorCookie)).status, 200);
  const list = await call('GET', `/api/families/${FAM}/sources`, undefined, memberCookie);
  assert.deepEqual(list.json.items.map((x) => x.id), [srcB.id]);
  const row = await pool.query('select deleted_at from sources where id = $1', [srcA.id]);
  assert.ok(row.rows[0].deleted_at);
});

test('living privacy: a guest gets no citations of a living person; a member does', { skip }, async () => {
  const add = await call('POST', `/api/events?family=${FAM}`, { op_id: op(40), person_id: LIVING, event: ev({ description: 'Việc riêng', sources: [{ source_id: srcB.id, title: '', page: 'ảnh 2' }] }) }, editorCookie);
  assert.equal(add.status, 200, add.text);
  const guest = await call('GET', `/api/events?family=${FAM}&person=${LIVING}`);
  assert.equal(guest.json.hidden, true); assert.deepEqual(guest.json.items, []);
  const member = await call('GET', `/api/events?family=${FAM}&person=${LIVING}`, undefined, memberCookie);
  assert.equal(member.json.items[0].sources[0].title, 'Bia mộ Nghĩa trang Hòa Thọ');
  assert.equal(member.json.items[0].sources[0].page, 'ảnh 2');
});

test('GEDCOM round trip into an empty family: sources, citations, pages and quality come back', { skip }, async () => {
  const gp = await call('POST', `/api/families/${FAM}/sources`, { title: 'Gia phả viết tay 1950', kind: 'gia_pha', author: 'Dương Văn Ất', year: 1950 }, editorCookie);
  const cite = await call('POST', `/api/events?family=${FAM}`, { op_id: op(50), person_id: DEAD, event: ev({ description: 'Sinh con', sources: [{ source_id: gp.json.source.id, title: '', page: 'tr. 12', quality: 'goc' }] }) }, editorCookie);
  assert.equal(cite.status, 200, cite.text);
  const exp = await call('GET', `/api/gedcom?family=${FAM}`, undefined, editorCookie);
  assert.equal(exp.status, 200, exp.text);
  assert.match(exp.text, /^0 @S\d+@ SOUR$/m);
  assert.match(exp.text, /^1 PUBL 1950$/m);
  assert.match(exp.text, /^3 PAGE tr\. 12$/m);
  assert.match(exp.text, /^3 QUAY 3$/m);
  const imp = await call('POST', '/api/gedcom/import', { family: FAM3, content: exp.text, dry_run: false }, editor3Cookie);
  assert.equal(imp.status, 200, imp.text);
  assert.equal(imp.json.applied.sources_added, 2);
  const rows = await pool.query('select title, kind, year, author from sources where family_id = $1 order by title', [FAM3]);
  assert.deepEqual(rows.rows.map((r) => r.title), ['Bia mộ Nghĩa trang Hòa Thọ', 'Gia phả viết tay 1950']);
  const g = rows.rows.find((r) => r.title.startsWith('Gia phả'));
  assert.equal(g.kind, 'gia_pha'); assert.equal(g.year, 1950); assert.equal(g.author, 'Dương Văn Ất');
  const evs = await pool.query("select sources from events where family_id = $1 and sources <> '[]'::jsonb", [FAM3]);
  const cites = evs.rows.flatMap((r) => r.sources);
  assert.ok(cites.every((c) => c.source_id && /^D[0-9a-f]{12}$/.test(c.source_id)), JSON.stringify(cites));
  const pageCite = cites.find((c) => c.page === 'tr. 12');
  assert.ok(pageCite && pageCite.quality === 'goc' && pageCite.title === 'Gia phả viết tay 1950');
  // a second import of the same file adds no sources
  const again = await call('POST', '/api/gedcom/import', { family: FAM3, content: exp.text, dry_run: false }, editor3Cookie);
  assert.equal(again.json.applied.sources_added, 0);
});
