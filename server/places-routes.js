// Places gazetteer, read API (shared by every family; places hold no personal data).
//   GET /api/places?q=&limit=  search by any name, any era, accents optional; current name + "nay là" chain
//   GET /api/places/:id        one place: names over time, parents over time, changes, external ids
//   GET /api/places/:id/people?family=     ids + fields of the family's people linked to it
//   GET|POST /api/persons/:id/places, DELETE /api/persons/:id/places/:field   a person's place links (editors write)
// Pending places (not yet verified by a curator) are shown to signed-in people only. Mounted by server.js.
'use strict';
const R = require('./places-rules');

function mount(app, d) {
  const { pool, readSession, who, famOf, canRead, H, HttpError } = d;
  const statusOk = (req) => (readSession(req) ? ['verified', 'pending'] : ['verified']);

  // Current full label: the place's name today plus its open-ended parents, nearest first.
  async function labels(ids) {
    if (!ids.length) return new Map();
    const { rows: names } = await pool.query('select place_id, name, lang, valid_from, valid_to, is_primary from place_names where place_id = any($1)', [ids]);
    const { rows: pars } = await pool.query('select place_id, parent_id, valid_from, valid_to from place_parents where place_id = any($1)', [ids]);
    const byP = (arr, id) => arr.filter((r) => r.place_id === id);
    const out = new Map();
    // walk up to 5 levels of today's parents
    const parentIds = new Set(); const chain = new Map();
    for (const id of ids) {
      const c = []; let cur = id;
      for (let i = 0; i < 5; i++) {
        const p = byP(pars, cur).find((r) => R.validAt(r, null)); if (!p) break;
        c.push(p.parent_id); parentIds.add(p.parent_id); cur = p.parent_id;
        if (!pars.some((r) => r.place_id === cur)) {
          const more = await pool.query('select place_id, parent_id, valid_from, valid_to from place_parents where place_id=$1', [cur]);
          pars.push(...more.rows);
        }
      }
      chain.set(id, c);
    }
    const extra = [...parentIds].filter((x) => !ids.includes(x));
    if (extra.length) names.push(...(await pool.query('select place_id, name, lang, valid_from, valid_to, is_primary from place_names where place_id = any($1)', [extra])).rows);
    const now = (id) => R.nameAt(byP(names, id), null);
    for (const id of ids) out.set(id, { name: now(id), label: [now(id), ...chain.get(id).map(now)].filter(Boolean).join(', ') });
    return out;
  }

  app.get('/api/places', H(async (req, res) => {
    const q = R.fold(req.query.q);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    if (q.length < 2) return res.json({ items: [] });
    const { rows } = await pool.query(
      `select n.place_id, n.name, n.name_fold, n.valid_from, n.valid_to, p.kind, p.status
         from place_names n join places p on p.id = n.place_id
        where p.status = any($3) and (n.name_fold like $1 or n.name_fold like $2)
        limit 500`, [q + '%', '% ' + q + '%', statusOk(req)]);
    const best = new Map();
    for (const r of rows) {
      const s = R.score(r.name_fold, q); const cur = best.get(r.place_id);
      if (!cur || s > cur.s) best.set(r.place_id, { s, r });
    }
    const top = [...best.values()].sort((a, b) => b.s - a.s || a.r.name.localeCompare(b.r.name, 'vi')).slice(0, limit);
    const L = await labels(top.map((x) => x.r.place_id));
    res.json({ items: top.map(({ r }) => {
      const l = L.get(r.place_id) || {};
      const historical = !R.validAt(r, null) && r.name !== l.name;
      return { id: r.place_id, kind: r.kind, status: r.status, name: l.name || r.name, label: l.label || r.name,
        matched: r.name, ...(historical ? { matched_era: [r.valid_from || null, r.valid_to || null] } : {}) };
    }) });
  }));

  app.get('/api/places/:id', H(async (req, res) => {
    if (!R.isId(req.params.id)) throw new HttpError(400, 'Mã địa danh không hợp lệ.');
    const id = Number(req.params.id);
    const { rows: [p] } = await pool.query('select id, kind, lat, lon, precision, wikidata_id, geonames_id, official_code, status, note, coords_source from places where id=$1 and status = any($2)', [id, statusOk(req)]);
    if (!p) throw new HttpError(404, 'Không tìm thấy địa danh.');
    const [names, parents, events] = await Promise.all([
      pool.query('select name, lang, valid_from, valid_to, is_primary, source, licence from place_names where place_id=$1 order by valid_from nulls first, id', [id]),
      pool.query('select parent_id, valid_from, valid_to, source from place_parents where place_id=$1 order by valid_from nulls first', [id]),
      pool.query('select date, kind, other_place_id, source from place_events where place_id=$1 order by date', [id]),
    ]);
    const L = await labels([id, ...new Set([...parents.rows.map((r) => r.parent_id), ...events.rows.map((r) => r.other_place_id).filter(Boolean)])]);
    const me = L.get(id) || {};
    // GeoNames asks for credit wherever its data is shown (CC BY 4.0); Wikidata is CC0.
    const fromGeo = p.coords_source === 'geonames' || names.rows.some((n) => String(n.source || '').startsWith('geonames'));
    const attribution = fromGeo ? [{ source: 'geonames', text: 'GeoNames (CC BY 4.0)', url: 'https://www.geonames.org/' }] : [];
    res.json({ ...p, name: me.name, label: me.label, attribution,
      names: names.rows,
      parents: parents.rows.map((r) => ({ ...r, name: (L.get(r.parent_id) || {}).name || '' })),
      events: events.rows.map((r) => ({ ...r, other_name: r.other_place_id ? (L.get(r.other_place_id) || {}).name || '' : null })) });
  }));

  // ---- a person's place fields -> places (the text as written stays in persons.data, never rewritten) ----
  const personRow = async (q, id) => (await q.query('select id, family_id, deleted, data from persons where id=$1', [id])).rows[0] || null;
  const isEditor = (w) => ['owner', 'admin', 'editor'].includes(w.role);
  const actor = (w) => w.editor || w.email || w.name || 'khách';
  // The person, in the family the request names, readable by the viewer (404 otherwise: no probing other families).
  async function personFor(req, q = pool) {
    if (!R.isPid(req.params.id)) throw new HttpError(400, 'Mã người không hợp lệ.');
    const f = await famOf(req); const w = await who(req, f.id);
    if (!canRead(f, w)) throw new HttpError(403, 'Dòng họ này là riêng tư.');
    const p = await personRow(q, req.params.id);
    if (!p || p.deleted || p.family_id !== f.id) throw new HttpError(404, 'Không tìm thấy người này.');
    return { f, w, p };
  }
  const itemsOf = async (personId) => {
    const { rows } = await pool.query('select field, place_id, as_written from person_places where person_id=$1 order by field', [personId]);
    const L = await labels([...new Set(rows.map((r) => r.place_id))]);
    return rows.map((r) => ({ ...r, ...(L.get(r.place_id) || { name: '', label: '' }) }));
  };

  app.get('/api/persons/:id/places', H(async (req, res) => {
    const { p } = await personFor(req);
    res.json({ items: (await itemsOf(p.id)).filter((x) => R.PERSON_FIELDS.includes(x.field)) });
  }));

  app.post('/api/persons/:id/places', H(async (req, res) => {
    const b = req.body || {};
    if (!R.PERSON_FIELDS.includes(b.field)) throw new HttpError(400, 'Trường địa danh không hợp lệ.');
    if (!R.isId(b.place_id)) throw new HttpError(400, 'Mã địa danh không hợp lệ.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { w, p } = await personFor(req, client);
      if (!isEditor(w)) throw new HttpError(w.email || w.code ? 403 : 401, 'Cần quyền biên tập để gắn địa danh.');
      const pl = (await client.query('select id from places where id=$1', [Number(b.place_id)])).rows[0];
      if (!pl) throw new HttpError(404, 'Không tìm thấy địa danh.');
      const old = (await client.query('select place_id from person_places where person_id=$1 and field=$2 for update', [p.id, b.field])).rows[0];
      await client.query(`insert into person_places (person_id, field, place_id, as_written, matched_by, matched_at) values ($1,$2,$3,$4,$5,now())
        on conflict (person_id, field) do update set place_id=excluded.place_id, as_written=excluded.as_written, matched_by=excluded.matched_by, matched_at=now()`,
      [p.id, b.field, pl.id, String(p.data[b.field] || ''), actor(w)]);
      const L = await labels([pl.id, ...(old ? [old.place_id] : [])]);
      await client.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'dia_danh',$2,$3,$4)",
        [p.id, old ? JSON.stringify({ field: b.field, place_id: old.place_id, name: (L.get(old.place_id) || {}).name || '' }) : null,
          JSON.stringify({ field: b.field, place_id: pl.id, name: (L.get(pl.id) || {}).name || '' }), actor(w)]);
      await client.query('commit');
      res.json({ ok: true, item: { field: b.field, place_id: pl.id, as_written: String(p.data[b.field] || ''), ...(L.get(pl.id) || {}) } });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));

  app.delete('/api/persons/:id/places/:field', H(async (req, res) => {
    if (!R.PERSON_FIELDS.includes(req.params.field)) throw new HttpError(400, 'Trường địa danh không hợp lệ.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { w, p } = await personFor(req, client);
      if (!isEditor(w)) throw new HttpError(w.email || w.code ? 403 : 401, 'Cần quyền biên tập để bỏ gắn địa danh.');
      const del = await client.query('delete from person_places where person_id=$1 and field=$2 returning place_id', [p.id, req.params.field]);
      if (del.rowCount) {
        const L = await labels([del.rows[0].place_id]);
        await client.query("insert into history (person_id, field, old_value, new_value, by_user) values ($1,'dia_danh',$2,null,$3)",
          [p.id, JSON.stringify({ field: req.params.field, place_id: del.rows[0].place_id, name: (L.get(del.rows[0].place_id) || {}).name || '' }), actor(w)]);
      }
      await client.query('commit');
      res.json({ ok: true, removed: del.rowCount });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));

  // People of one family linked to a place: ids and fields only (the app shows the ones its own data has, so a
  // viewer never learns more than the family page already shows them).
  app.get('/api/places/:id/people', H(async (req, res) => {
    if (!R.isId(req.params.id)) throw new HttpError(400, 'Mã địa danh không hợp lệ.');
    const f = await famOf(req); const w = await who(req, f.id);
    if (!canRead(f, w)) throw new HttpError(403, 'Dòng họ này là riêng tư.');
    const { rows } = await pool.query(
      `select pp.person_id, pp.field from person_places pp join persons p on p.id = pp.person_id
        where pp.place_id=$1 and p.family_id=$2 and not p.deleted and pp.field = any($3) order by pp.person_id, pp.field`,
      [Number(req.params.id), f.id, R.PERSON_FIELDS]);
    res.json({ items: rows });
  }));
}

module.exports = { mount };
