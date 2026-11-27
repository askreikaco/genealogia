// Gallery routes (G1): /api/persons/:id/photos. Rules and DB work are in gallery.js; the photo bytes are served by
// /api/photos/:id (server.js photoAccess, which also counts a gallery photo as a record that shows it).
// Read: a living person's gallery goes to members only (404 for anyone else, as the photo route does); a deceased
// person's to anyone who can read the family. Write: editors. Removal goes to the trash (trash.js kind 'photo').
'use strict';
const G = require('./gallery');

module.exports = function mountGallery(app, deps) {
  const { pool, need, famOf, who, canRead, canSeePrivate, HttpError, actorName, TRASH, EV } = deps;

  // The person when this viewer may see the gallery; null otherwise (not in the family, deleted, or a living person to a guest).
  async function visiblePerson(f, w, personId) {
    const { rows } = await pool.query('select id, data from persons where id=$1 and family_id=$2 and not deleted', [personId, f.id]);
    const p = rows[0];
    if (!p) return null;
    return (await EV.rules()).canSeeEventsOf(p.data, { member: canSeePrivate(w), familyReadable: true }) ? p : null;
  }

  // One editor write in one transaction. fn returns the response body, or null when the photo or person is not there.
  async function write(req, res, next, fn) {
    const f = req.fam; const w = await who(req, f.id);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const body = await fn(client, f, w);
      if (body === null) { await client.query('rollback'); return res.status(404).json({ error: (await G.copy()).not_found }); }
      await client.query('commit');
      res.json({ ok: true, ...body });
    } catch (e) {
      await client.query('rollback').catch(() => {});
      if (e instanceof HttpError || (e && e.status && e.message)) return res.status(e.status).json({ error: e.message });
      next(e);
    } finally { client.release(); }
  }

  app.get('/api/persons/:id/photos', async (req, res, next) => {
    try {
      const f = await famOf(req); const w = await who(req, f.id);
      if (!canRead(f, w)) throw new HttpError(403, 'Dòng họ này là riêng tư.');
      const p = await visiblePerson(f, w, req.params.id);
      if (!p) return res.status(404).json({ error: 'Không tìm thấy người này.' });
      res.set('Cache-Control', 'no-store');
      res.json({ max: (await G.rules()).GALLERY_MAX, items: await G.listPhotos(pool, f.id, p.id) });
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  });

  app.post('/api/persons/:id/photos', need('editor'), (req, res, next) => write(req, res, next, async (client, f, w) => {
    const photo = await G.addPhoto(client, f.id, req.params.id, req.body, actorName(w));
    if (!photo) return null;
    return { photo, profile: photo.is_profile ? photo.url : undefined };
  }));
  app.put('/api/persons/:id/photos/:pid', need('editor'), (req, res, next) => write(req, res, next, async (client, f, w) => {
    const photo = await G.updatePhoto(client, f.id, req.params.id, req.params.pid, req.body, actorName(w));
    return photo ? { photo } : null;
  }));
  app.post('/api/persons/:id/photos/:pid/profile', need('editor'), (req, res, next) => write(req, res, next, async (client, f, w) => {
    const done = await G.setProfile(client, f.id, req.params.id, req.params.pid, actorName(w));
    return done ? { profile: done.url } : null;
  }));
  app.post('/api/persons/:id/photos/:pid/delete', need('editor'), (req, res, next) => write(req, res, next, async (client, f, w) => {
    const cur = await client.query('select 1 from person_photos where id=$1 and family_id=$2 and person_id=$3', [req.params.pid, f.id, req.params.id]);
    if (!cur.rowCount) return null;
    await TRASH.brake(f, w);
    const removed = await G.removePhoto(client, f.id, req.params.id, req.params.pid, actorName(w));
    if (!removed) return null;
    const trashId = await TRASH.put(client, { famId: f.id, kind: 'photo', itemId: removed.row.id, personId: removed.row.person_id,
      label: removed.row.caption || (await G.copy()).section, rows: [removed.row], w, by: actorName(w) });
    return { deleted: { id: removed.row.id }, trash_id: trashId, profile: removed.profile };
  }));
};
