// Places step 3: new places and the curator's queue (places-enrich.js finds the open-data suggestions).
//   POST /api/places                          an editor of the family adds a place (pending) -> enrichment job
//   GET  /api/places/pending                  curator: pending places with their pending suggestions
//   POST /api/place-suggestions/:id/accept    curator: fill an EMPTY field / add a name (never overwrites)
//   POST /api/place-suggestions/:id/reject    curator
//   POST /api/places/:id/verify               curator: the place is checked (shown to guests from now on)
// Curator = owner or admin of any family on this instance (the gazetteer is shared). Mounted BEFORE places-routes.js
// so that /api/places/pending is not read as a place id.
'use strict';
const R = require('./places-rules');
const E = require('./places-enrich');

function mount(app, d) {
  const { pool, readSession, who, famOf, canRead, H, HttpError } = d;

  async function curator(req) {
    const s = readSession(req);
    if (!s) throw new HttpError(401, 'Cần đăng nhập.');
    if (!s.email) return s.name || 'mã biên tập'; // editor code: admin everywhere
    const { rowCount } = await pool.query("select 1 from members where email=$1 and role in ('owner','admin') and status='active' limit 1", [s.email]);
    if (!rowCount) throw new HttpError(403, 'Chỉ Chủ họ hoặc Quản trị duyệt địa danh.');
    return s.email;
  }

  app.post('/api/places', H(async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 120) throw new HttpError(400, 'Tên địa danh cần 2–120 ký tự.');
    if (!R.KINDS.includes(b.kind)) throw new HttpError(400, 'Loại địa danh không hợp lệ.');
    if (b.parent_id != null && b.parent_id !== '' && !R.isId(b.parent_id)) throw new HttpError(400, 'Mã đơn vị cha không hợp lệ.');
    const f = await famOf(req); const w = await who(req, f.id);
    if (!canRead(f, w) || !['owner', 'admin', 'editor'].includes(w.role)) throw new HttpError(w.email || w.code ? 403 : 401, 'Cần quyền biên tập để thêm địa danh.');
    const parent = b.parent_id ? Number(b.parent_id) : null;
    const by = w.editor || w.email || w.name || 'biên tập';
    const client = await pool.connect();
    try {
      await client.query('begin');
      if (parent && !(await client.query('select 1 from places where id=$1', [parent])).rowCount) throw new HttpError(404, 'Không tìm thấy đơn vị cha.');
      // the same name today under the same parent (or both without one) is the same place: return it
      const dup = (await client.query(`select p.id from places p join place_names n on n.place_id = p.id and n.valid_to is null and n.name_fold = $1
          where p.kind = $2 and coalesce((select pp.parent_id from place_parents pp where pp.place_id = p.id and pp.valid_to is null limit 1), 0) = $3 limit 1`,
      [R.fold(name), b.kind, parent || 0])).rows[0];
      if (dup) { await client.query('rollback'); return res.json({ id: dup.id, existing: true }); }
      const { rows: [p] } = await client.query("insert into places (kind, status, created_by) values ($1,'pending',$2) returning id, kind, status", [b.kind, by]);
      await client.query("insert into place_names (place_id, name, name_fold, lang, is_primary, source) values ($1,$2,$3,'vi',true,'user')", [p.id, name, R.fold(name)]);
      if (parent) await client.query("insert into place_parents (place_id, parent_id, source) values ($1,$2,'user')", [p.id, parent]);
      await E.enqueue(client, p.id);
      await client.query('commit');
      res.json({ id: p.id, kind: p.kind, status: p.status, name, existing: false });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));

  app.get('/api/places/pending', H(async (req, res) => {
    await curator(req);
    const { rows: places } = await pool.query(`select p.id, p.kind, p.status, p.created_at, p.wikidata_id, p.geonames_id, p.lat, p.lon,
        (select n.name from place_names n where n.place_id = p.id order by n.is_primary desc, n.valid_to nulls first, n.id limit 1) as name,
        (select j.status from places_enrich_jobs j where j.place_id = p.id order by j.id desc limit 1) as job
      from places p
      where p.status = 'pending' or exists (select 1 from place_suggestions s where s.place_id = p.id and s.status = 'pending')
      order by p.created_at desc limit 100`);
    const ids = places.map((p) => p.id);
    const sugg = ids.length ? (await pool.query(`select id, place_id, source, external_id, field, value, confidence, licence, attribution
        from place_suggestions where place_id = any($1) and status = 'pending' order by place_id, confidence desc, id`, [ids])).rows : [];
    res.json({ items: places.map((p) => ({ ...p, suggestions: sugg.filter((s) => s.place_id === p.id) })) });
  }));

  const decide = (accept) => H(async (req, res) => {
    if (!R.isId(req.params.id)) throw new HttpError(400, 'Mã đề xuất không hợp lệ.');
    const by = await curator(req);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const s = (await client.query('select * from place_suggestions where id=$1 for update', [Number(req.params.id)])).rows[0];
      if (!s) throw new HttpError(404, 'Không tìm thấy đề xuất.');
      if (s.status !== 'pending') throw new HttpError(409, 'Đề xuất này đã được xử lý.');
      let applied = false;
      if (accept) {
        const p = (await client.query('select id, lat, wikidata_id, geonames_id from places where id=$1 for update', [s.place_id])).rows[0];
        const v = s.value || {};
        const taken = async (col, val) => (await client.query(`select 1 from places where ${col} = $1 and id <> $2`, [val, p.id])).rowCount > 0;
        if (s.field === 'wikidata_id' && !p.wikidata_id) {
          if (await taken('wikidata_id', v.id)) throw new HttpError(409, `${v.id} đã gắn với một địa danh khác.`);
          await client.query('update places set wikidata_id=$2, updated_at=now() where id=$1', [p.id, v.id]); applied = true;
        } else if (s.field === 'geonames_id' && !p.geonames_id) {
          if (await taken('geonames_id', v.id)) throw new HttpError(409, `GeoNames ${v.id} đã gắn với một địa danh khác.`);
          await client.query('update places set geonames_id=$2, updated_at=now() where id=$1', [p.id, v.id]); applied = true;
        } else if (s.field === 'coords' && p.lat == null && Number.isFinite(v.lat) && Number.isFinite(v.lon)) {
          await client.query('update places set lat=$2, lon=$3, coords_source=$4, updated_at=now() where id=$1', [p.id, v.lat, v.lon, s.source]); applied = true;
        } else if (s.field === 'name' && v.name) {
          const dup = await client.query('select 1 from place_names where place_id=$1 and name_fold=$2 and lang=$3', [p.id, R.fold(v.name), v.lang || 'vi']);
          if (!dup.rowCount) {
            await client.query(`insert into place_names (place_id, name, name_fold, lang, valid_from, valid_to, is_primary, source, licence)
              values ($1,$2,$3,$4,$5,$6,false,$7,$8)`, [p.id, v.name, R.fold(v.name), v.lang || 'vi', v.valid_from || null, v.valid_to || null, `${s.source}:${s.external_id}`, s.licence]);
            applied = true;
          }
        }
      }
      // accepting a field that is already filled is recorded as rejected: our copy wins
      await client.query('update place_suggestions set status=$2, decided_by=$3, decided_at=now() where id=$1', [s.id, applied ? 'accepted' : 'rejected', by]);
      await client.query('commit');
      res.json({ ok: true, status: applied ? 'accepted' : 'rejected', applied });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  });
  app.post('/api/place-suggestions/:id/accept', decide(true));
  app.post('/api/place-suggestions/:id/reject', decide(false));

  app.post('/api/places/:id/verify', H(async (req, res) => {
    if (!R.isId(req.params.id)) throw new HttpError(400, 'Mã địa danh không hợp lệ.');
    await curator(req);
    const r = await pool.query("update places set status='verified', updated_at=now() where id=$1 returning id", [Number(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'Không tìm thấy địa danh.');
    res.json({ ok: true });
  }));
}

module.exports = { mount };
