// "Có thể là cùng một người" on the review page: list the stored suggestions of one tree, dismiss one ("Không phải"),
// or turn one into a link proposal through the normal links flow (links-routes.js propose): the other tree still
// accepts, unless the viewer is owner/admin of both trees (the same rule as a hand-made link).
// Who sees a suggestion: an editor, admin or owner of this tree, and only when the other side may be shown to them:
// owner/admin of the other tree, or the other tree is public and its person may be shown (deceased, or the viewer
// is a member there). Nobody else learns that the pair exists.
'use strict';
const L = require('./links-rules');

const yearOf = (v) => { const m = /(\d{4})/.exec(String(v || '')); return m ? m[1] : ''; };
const years = (d) => [yearOf(d.born || d.birth_date), yearOf(d.died || d.death_date)].filter(Boolean).join('–');
const EDIT = ['owner', 'admin', 'editor'];

function mount(app, d) {
  const { pool, who, famOf, findFamily, canRead, H, HttpError, propose } = d;
  const actor = (w) => w.editor || w.email || w.name || 'khách';

  // The viewer's view of one row from the side of family `here`; null when they may not see it.
  async function viewOf(req, r, here) {
    const hereA = r.a_family === here;
    const other = { family: hereA ? r.b_family : r.a_family, person: hereA ? r.b_person : r.a_person, data: hereA ? r.b_data : r.a_data };
    const fo = await findFamily(other.family); if (!fo) return null;
    const wo = await who(req, fo.id);
    const ok = L.isTop(wo.role) || (fo.visibility === 'public' && L.canSeeOther(other.data, wo.role, canRead(fo, wo)));
    if (!ok) return null;
    const mine = hereA ? r.a_data : r.b_data;
    return { id: r.id, score: Number(r.score), reasons: r.reasons || [], status: r.status,
      person: hereA ? r.a_person : r.b_person, name: mine.name || '', years: years(mine),
      other_family: fo.id, other_label: fo.short_name || fo.name, other_person: other.person, other_name: other.data.name || '', other_years: years(other.data) };
  }
  async function rowFor(q, id) {
    return (await q.query(`select s.*, pa.data a_data, pb.data b_data from match_suggestions s
      join persons pa on pa.id = s.a_person and not pa.deleted join persons pb on pb.id = s.b_person and not pb.deleted where s.id = $1`, [id])).rows[0] || null;
  }
  // The family of the request must be one side of the row, and the viewer an editor+ there who may see the other side.
  async function gate(req, id) {
    if (!Number.isInteger(id)) throw new HttpError(400, 'Mã đề xuất không hợp lệ.');
    const f = await famOf(req); const w = await who(req, f.id);
    if (!EDIT.includes(w.role)) throw new HttpError(w.email || w.code ? 403 : 401, 'Cần quyền biên tập ở cây này.');
    const r = await rowFor(pool, id);
    if (!r || (r.a_family !== f.id && r.b_family !== f.id)) throw new HttpError(404, 'Không tìm thấy đề xuất.');
    const v = await viewOf(req, r, f.id); if (!v) throw new HttpError(404, 'Không tìm thấy đề xuất.');
    return { f, w, r, v };
  }

  app.get('/api/match-suggestions', H(async (req, res) => {
    const f = await famOf(req); const w = await who(req, f.id);
    if (!EDIT.includes(w.role)) throw new HttpError(w.email || w.code ? 403 : 401, 'Cần quyền biên tập ở cây này.');
    const { rows } = await pool.query(`select s.*, pa.data a_data, pb.data b_data from match_suggestions s
      join persons pa on pa.id = s.a_person and not pa.deleted join persons pb on pb.id = s.b_person and not pb.deleted
      where (s.a_family = $1 or s.b_family = $1) and s.status = 'new' order by s.score desc, s.id limit 200`, [f.id]);
    const items = [];
    for (const r of rows) { const v = await viewOf(req, r, f.id); if (v) items.push(v); }
    res.json({ items });
  }));

  app.post('/api/match-suggestions/:id/dismiss', H(async (req, res) => {
    const { w, r } = await gate(req, Number(req.params.id));
    if (r.status !== 'new') throw new HttpError(409, 'Đề xuất này đã được xử lý.');
    await pool.query("update match_suggestions set status='dismissed', decided_by=$2, decided_at=now() where id=$1", [r.id, actor(w)]);
    res.json({ ok: true });
  }));

  app.post('/api/match-suggestions/:id/link', H(async (req, res) => {
    const { f, w, r, v } = await gate(req, Number(req.params.id));
    if (r.status !== 'new') throw new HttpError(409, 'Đề xuất này đã được xử lý.');
    let out;
    try {
      out = await propose(req, f, w, { person: v.person, other_family: v.other_family, other_person: v.other_person,
        reason: `Gợi ý tự động (${Math.round(v.score * 100)}%): ${(v.reasons || []).slice(0, 3).join('; ')}`.slice(0, 300) });
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 409) throw e;
      out = { status: 'exists' }; // already linked or waiting: the suggestion is done either way
    }
    await pool.query("update match_suggestions set status='linked', decided_by=$2, decided_at=now() where id=$1", [r.id, actor(w)]);
    res.json({ ok: true, status: out.status, id: out.id || null });
  }));
}

module.exports = { mount };
