// Reusable family sources (E2): GET (members), POST / PATCH / DELETE (editors and above). Rules and rows: sources.js.
// The family comes from the path (id or slug, like /api/families/:ref). Non-members get 403 (401 when not signed in).
// Delete is soft and refused while an event cites the source (409 with the count).
'use strict';
const SRC = require('./sources');

module.exports = function mountSources(app, ctx) {
  const { pool, H, HttpError, findFamily, requireRole } = ctx;
  const famByRef = async (req) => {
    const f = await findFamily(req.params.ref);
    if (!f) throw new HttpError(404, 'Không tìm thấy dòng họ.');
    return f;
  };
  const wrap = (fn) => H(async (req, res) => {
    try { await fn(req, res); } catch (e) { if (e instanceof SRC.SrcError) throw new HttpError(e.status, e.message); throw e; }
  });

  app.get('/api/families/:ref/sources', H(async (req, res) => {
    const f = await famByRef(req);
    await requireRole(req, f.id, 'member');
    res.set('Cache-Control', 'no-store');
    res.json({ items: await SRC.listSources(pool, f.id) });
  }));
  app.post('/api/families/:ref/sources', wrap(async (req, res) => {
    const f = await famByRef(req);
    const w = await requireRole(req, f.id, 'editor');
    const source = await SRC.insertSource(pool, f.id, req.body, w.editor || w.name || w.email || null);
    res.json({ ok: true, source });
  }));
  app.patch('/api/families/:ref/sources/:id', wrap(async (req, res) => {
    const f = await famByRef(req);
    await requireRole(req, f.id, 'editor');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const source = await SRC.updateSource(client, f.id, String(req.params.id), req.body);
      if (!source) { await client.query('rollback'); return res.status(404).json({ error: 'Không tìm thấy nguồn này.' }); }
      await client.query('commit');
      res.json({ ok: true, source });
    } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
  }));
  app.delete('/api/families/:ref/sources/:id', wrap(async (req, res) => {
    const f = await famByRef(req);
    await requireRole(req, f.id, 'editor');
    const out = await SRC.deleteSource(pool, f.id, String(req.params.id));
    if (out.status === 'missing') return res.status(404).json({ error: 'Không tìm thấy nguồn này.' });
    if (out.status === 'in_use') return res.status(409).json({ error: `Nguồn này đang được dùng ở ${out.uses} sự kiện. Gỡ khỏi các sự kiện trước.`, uses: out.uses });
    res.json({ ok: true });
  }));
};
