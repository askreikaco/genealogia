// Conflicting data, step 1 (migration 023): several sourced values for one person field. Read: anyone who can read
// the family, for a person whose life details they may see (a living person's: members only); non-members get years
// only for dates and never who recorded a value. Write: editors add a value with its source, choose the one the
// profile shows (written through the normal op + history, so profile and list stay in step), or remove one that is
// not shown. Rules in variants-rules.js. Mounted by server.js.
'use strict';
const V = require('./variants-rules');

function mount(app, d) {
  const { pool, who, famOf, canRead, H, HttpError, ROLE_RANK, applyOp, actorName, validateValue, seeLife, onWrite } = d;
  const isMember = (w) => ROLE_RANK[w.role] >= ROLE_RANK.member;
  const isEditor = (w) => ROLE_RANK[w.role] >= ROLE_RANK.editor;
  const needEditor = (w) => { if (!isEditor(w)) throw new HttpError(w.email || w.code ? 403 : 401, w.email || w.code ? 'Tài khoản này chưa có quyền sửa.' : 'Cần đăng nhập để sửa.'); };
  const personIn = async (q, id, famId, lock = false) => {
    const r = await q.query(`select id, data, deleted from persons where id=$1 and family_id=$2${lock ? ' for update' : ''}`, [id, famId]);
    const p = r.rows[0]; if (!p || p.deleted) throw new HttpError(404, 'Không tìm thấy người này.'); return p;
  };
  const variantRow = async (q, vid, famId) => {
    const id = Number(vid); if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Mã giá trị không hợp lệ.');
    const r = await q.query('select * from field_variants where id=$1 and family_id=$2', [id, famId]);
    if (!r.rows[0]) throw new HttpError(404, 'Không tìm thấy giá trị này.'); return r.rows[0];
  };

  // Every field of a person that has variants: { fields: { born: { label, count, items: [...] } }, can_edit }.
  app.get('/api/persons/:id/variants', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id);
    if (!canRead(f, w)) throw new HttpError(403, 'Dòng họ này là riêng tư.');
    const p = await personIn(pool, req.params.id, f.id);
    const member = isMember(w);
    res.set('Cache-Control', 'no-store');
    if (!(await seeLife(p.data, member))) return res.json({ fields: {}, can_edit: false, hidden: true });
    const { rows } = await pool.query('select id, field, value, source, quality, by_user, created_at from field_variants where person_id=$1 order by created_at, id', [p.id]);
    const fields = {};
    for (const field of Object.keys(V.VARIANT_FIELDS)) {
      const rs = rows.filter((r) => r.field === field); if (!rs.length) continue;
      const cur = p.data[field] ?? null;
      const items = V.viewList(rs, cur, { member });
      fields[field] = { label: V.VARIANT_FIELDS[field], count: member ? V.distinctCount(rs, cur) : new Set(items.map((x) => V.clean(x.value).toLowerCase())).size, items };
    }
    res.json({ fields, can_edit: isEditor(w) });
  }));

  // Add a value with its source. The first time a field gets a second value, the profile's own value is kept as a
  // variant too ("Dữ liệu đang có trong hồ sơ"), marked as the one shown.
  app.post('/api/persons/:id/variants', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id); needEditor(w);
    const b = req.body || {}; const err = V.validateVariant(b); if (err) throw new HttpError(400, err);
    const value = V.clean(b.value); const vErr = validateValue(b.field, value); if (vErr) throw new HttpError(400, vErr);
    const by = actorName(w);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const p = await personIn(client, req.params.id, f.id, true);
      const cur = p.data[b.field] ?? null;
      const have = await client.query('select value from field_variants where person_id=$1 and field=$2', [p.id, b.field]);
      if (have.rows.some((r) => V.sameValue(r.value, value))) throw new HttpError(409, 'Giá trị này đã có trong danh sách.');
      if (!have.rowCount && V.clean(cur) && !V.sameValue(cur, value)) {
        await client.query("insert into field_variants (person_id, family_id, field, value, source, quality, by_user, chosen) values ($1,$2,$3,$4,'Dữ liệu đang có trong hồ sơ','binh_thuong',$5,true)",
          [p.id, f.id, b.field, JSON.stringify(V.clean(cur)), by]);
      }
      const chosen = V.sameValue(cur, value) && !have.rows.length;
      const ins = await client.query('insert into field_variants (person_id, family_id, field, value, source, quality, by_user, chosen) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
        [p.id, f.id, b.field, JSON.stringify(value), V.clean(b.source), b.quality || 'binh_thuong', by, chosen]);
      await client.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'nguon_khac',null,$2,$3)",
        [p.id, JSON.stringify(`${V.VARIANT_FIELDS[b.field]}: ${value} (${V.clean(b.source)})`), by]);
      await client.query('commit');
      res.json({ ok: true, id: ins.rows[0].id });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));

  // Show this value on the profile: the person field is written through the normal op (newest wins + history).
  app.post('/api/variants/:vid/choose', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id); needEditor(w);
    const by = actorName(w);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const v = await variantRow(client, req.params.vid, f.id);
      await personIn(client, v.person_id, f.id);
      const value = V.clean(v.value);
      const vErr = validateValue(v.field, value); if (vErr) throw new HttpError(400, vErr);
      await client.query('update field_variants set chosen=false where person_id=$1 and field=$2 and chosen', [v.person_id, v.field]);
      await client.query('update field_variants set chosen=true where id=$1', [v.id]);
      const out = await applyOp(client, { op_id: `var-${v.id}-${Date.now().toString(36)}`, id: v.person_id, fields: { [v.field]: value }, ts: Date.now() }, by, f.id);
      await client.query('commit');
      onWrite();
      res.json({ ok: true, changed: out.changes.length > 0, field: v.field, value });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));

  // Remove a value that the profile does not show.
  app.delete('/api/variants/:vid', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id); needEditor(w);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const v = await variantRow(client, req.params.vid, f.id);
      const p = await personIn(client, v.person_id, f.id);
      if (V.sameValue(v.value, p.data[v.field])) throw new HttpError(409, 'Đây là giá trị hồ sơ đang hiển thị: chọn giá trị khác trước.');
      await client.query('delete from field_variants where id=$1', [v.id]);
      await client.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'nguon_khac',$2,null,$3)",
        [p.id, JSON.stringify(`${V.VARIANT_FIELDS[v.field]}: ${V.clean(v.value)} (${v.source || ''})`), actorName(w)]);
      await client.query('commit');
      res.json({ ok: true });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));
}

module.exports = { mount };
