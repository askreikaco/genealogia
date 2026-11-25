// Branch trees by reference: "Tạo cây cho nhánh này" (branch-rules.js, migrations/036_branch_trees.sql).
// A branch is a family row with branch_home / branch_root. It stores no people: server.js reads its persons from the
// home tree through scopeRead(), so a home edit shows at once and a descendant added at home joins the branch.
// Writes sent to a branch go to the home tree: an editor there applies them (branchOps), anyone else sends suggestions.
// Mounted by server.js. Routes: list, preview, create (owner/admin of the home tree), read, delete (never people).
'use strict';
const BR = require('./branch-rules');
const REL = require('./relations');

const PID = /^[A-Za-z0-9_.-]{1,80}$/;

// Scope of a branch as seen by one viewer: the home tree's relation rows, the person ids in the branch, and the
// relation rows inside it. full = members and above (private relation rows included).
async function scopeRead(q, br, full) {
  const rel = await REL.readRel(q, br.branch_home, full);
  const set = BR.scopeOf(br.branch_root, rel);
  return { home: br.branch_home, set, rel: BR.relIn(rel, set) };
}

function mount(app, d) {
  const { pool, who, famOf, findFamily, canRead, H, HttpError, ROLE_RANK } = d;
  const top = (w) => ROLE_RANK[w.role] >= ROLE_RANK.admin;
  const editor = (w) => ROLE_RANK[w.role] >= ROLE_RANK.editor;
  const needEmail = (w) => { if (!w.email) throw new HttpError(w.code ? 400 : 401, 'Cần đăng nhập bằng tài khoản Google để làm việc này.'); };
  const nameOf = (data) => String(data?.name || '');
  const homeRoot = async (homeId, ref) => {
    const id = typeof ref === 'string' ? ref : '';
    if (!PID.test(id)) throw new HttpError(400, 'Người này không có trong dữ liệu.');
    const { rows } = await pool.query('select id, data from persons where id = $1 and family_id = $2 and not deleted', [id, homeId]);
    if (!rows[0]) throw new HttpError(400, 'Người này không có trong dữ liệu.');
    return rows[0];
  };
  const rootAuth = async (req) => {
    const home = await famOf(req);
    if (home.branch_home) throw new HttpError(400, 'Cây nhánh không tạo thêm cây nhánh.');
    return { home, w: await who(req, home.id) };
  };

  // Branches of this home tree the viewer may see: all for owners and admins, else those where the viewer is a member.
  app.get('/api/branch-trees', H(async (req, res) => {
    const f = await famOf(req);
    const w = await who(req, f.id);
    res.set('Cache-Control', 'no-store');
    if (f.branch_home || !canRead(f, w)) return res.json({ items: [] }); // a branch has no branches; a private tree shows none to a guest
    const email = w.email ? String(w.email).toLowerCase() : null;
    const { rows } = await pool.query(
      `select b.id, b.name, b.branch_root from families b
       left join members m on m.family_id = b.id and m.email = $2 and m.status = 'active'
       where b.branch_home = $1 and ($3 or m.email is not null) order by b.name`, [f.id, email, top(w)]);
    res.json({ items: rows.map((r) => ({ id: r.id, name: r.name, root: r.branch_root })) });
  }));

  // How many people the branch would hold, for the create sheet.
  app.get('/api/branch-trees/preview', H(async (req, res) => {
    const { home, w } = await rootAuth(req);
    if (!top(w)) { needEmail(w); throw new HttpError(403, 'Chỉ Chủ họ hoặc Quản trị của cây này tạo được cây nhánh.'); }
    const root = await homeRoot(home.id, req.query.person);
    const rel = await REL.readRel(pool, home.id, true);
    res.set('Cache-Control', 'no-store');
    res.json({ people: BR.scopeOf(root.id, rel).size, root: { id: root.id, name: nameOf(root.data) } });
  }));

  // Create: the person, blood descendants and spouses of one person of the home tree. The creator owns the branch.
  app.post('/api/branch-trees', H(async (req, res) => {
    const b = req.body || {};
    const { home, w } = await rootAuth(req);
    if (!top(w)) { needEmail(w); throw new HttpError(403, 'Chỉ Chủ họ hoặc Quản trị của cây này tạo được cây nhánh.'); }
    needEmail(w);
    const root = await homeRoot(home.id, b.person);
    const name = BR.cleanName(b.name) || BR.cleanName(`Nhánh ${nameOf(root.data)}`);
    if (!name) throw new HttpError(400, 'Đặt tên cho cây nhánh.');
    const email = String(w.email).toLowerCase();
    const rel = await REL.readRel(pool, home.id, true);
    const people = BR.scopeOf(root.id, rel).size;
    const id = BR.newBranchId();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into families (id, slug, name, color, visibility, branch_home, branch_root, updated_at)
         values ($1, $1, $2, $3, 'private', $4, $5, now())`, [id, name, home.color || null, home.id, root.id]);
      await client.query(
        `insert into members (email, name, family_id, role, status, approved_by, approved_at)
         values ($1, $2, $3, 'owner', 'active', $1, now())`, [email, w.name || email, id]);
      await client.query('commit');
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true, id, name, people, root: { id: root.id, name: nameOf(root.data) } });
  }));

  // One branch: its name, root, home (when the viewer may read it) and what the viewer may do. Not a branch, or not
  // readable by the viewer: { branch: false } (200), so a plain tree or a private branch is not an error to the page.
  app.get('/api/branch-trees/:ref', H(async (req, res) => {
    const br = await findFamily(req.params.ref);
    const w = br && br.branch_home ? await who(req, br.id) : null;
    res.set('Cache-Control', 'no-store');
    if (!br || !br.branch_home || !canRead(br, w)) return res.json({ branch: false });
    const home = await findFamily(br.branch_home);
    const hw = await who(req, home.id);
    const { rows } = await pool.query('select data from persons where id = $1 and family_id = $2', [br.branch_root, home.id]);
    const showHome = canRead(home, hw);
    res.json({
      branch: true, id: br.id, name: br.name, root: { id: br.branch_root, name: nameOf(rows[0]?.data) },
      home: showHome ? { id: home.id, name: home.name, short_name: home.short_name || null } : null,
      role: w.role, can_manage: top(w) || top(hw), home_editor: editor(hw),
    });
  }));

  // Delete the branch: its membership and the row. People are never touched (a branch owns none).
  app.delete('/api/branch-trees/:ref', H(async (req, res) => {
    const br = await findFamily(req.params.ref);
    if (!br || !br.branch_home) throw new HttpError(404, 'Không tìm thấy cây nhánh.');
    const w = await who(req, br.id);
    const hw = await who(req, br.branch_home);
    if (!(top(w) || top(hw))) { needEmail(w); throw new HttpError(403, 'Chỉ Chủ họ hoặc Quản trị của cây nhánh hay cây gốc gỡ được.'); }
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('delete from members where family_id = $1', [br.id]);
      await client.query('delete from families where id = $1 and branch_home is not null', [br.id]);
      await client.query('commit');
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, removed: br.name });
  }));
}

// Writes sent to a branch (server.js /api/ops). An editor of the home tree has these ops applied there (result: { home,
// hw, ops }); anyone else sends each change as a suggestion for the home tree (result: { result }). Ops about people
// outside the branch are rejected in both cases.
async function branchOps(req, br, ops, d) {
  const { pool, who, findFamily, ROLE_RANK, checkSuggestChanges, canSeePrivate } = d;
  const home = await findFamily(br.branch_home);
  const hw = await who(req, home.id);
  const bw = await who(req, br.id);
  const scope = await scopeRead(pool, br, canSeePrivate(hw) || canSeePrivate(bw));
  const rejected = [];
  const inScope = [];
  for (const op of ops) {
    if (op && scope.set.has(op.id)) inScope.push(op);
    else rejected.push({ op_id: op?.op_id, reason: 'Người này không thuộc cây nhánh này.' });
  }
  if (ROLE_RANK[hw.role] >= ROLE_RANK.editor) return { home, hw, ops: inScope, rejected };
  const applied = [];
  for (const op of inScope) {
    const fields = op.fields && typeof op.fields === 'object' && !Array.isArray(op.fields) ? op.fields : null;
    const err = !fields ? 'Không có gì để gửi góp ý.'
      : Object.prototype.hasOwnProperty.call(fields, '_deleted') ? 'Xóa người cần lý do: làm ở cây gốc.'
        : await checkSuggestChanges(fields);
    if (err) { rejected.push({ op_id: op.op_id, reason: err }); continue; }
    const cur = (await pool.query('select data from persons where id = $1 and family_id = $2', [op.id, home.id])).rows[0]?.data || {};
    const base = Object.fromEntries(Object.keys(fields).map((k) => [k, cur[k] ?? null]));
    await pool.query(
      `insert into suggestions (person_id, changes, note, by_name, by_contact, account_email, base, family_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [op.id, fields, `Từ cây nhánh ${br.name}`, hw.name || bw.name || null, bw.email || null, bw.email || null, base, home.id]);
    rejected.push({ op_id: op.op_id, reason: 'Đã gửi góp ý tới cây gốc. Chờ người duyệt bên đó.' });
  }
  return { result: { applied, rejected } };
}

// What a family view reads: the people, events and stories of the family itself, or, for a branch, of its home tree
// within the branch's scope. Returns { famId, ids (null = every person of famId), rel }. full: members and above.
async function viewOf(q, f, full) {
  if (!f.branch_home) return { famId: f.id, ids: null, rel: null };
  const br = await scopeRead(q, f, full);
  return { famId: br.home, ids: [...br.set], rel: br.rel };
}

module.exports = { mount, scopeRead, branchOps, viewOf };
