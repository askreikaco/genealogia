// Consistency checker API (consistency-rules.js): GET /api/trees/:tree/consistency lists one tree's issues, split into
// open and ignored. POST and DELETE /api/trees/:tree/consistency/ignore hide or show one issue. Members only: a guest
// gets 401 and a signed-in non-member 403 (private trees: 403 for everyone outside). Ignoring needs editor or above.
// Rule ids and person ids only; the error codes are ASCII and the UI shows its own text.
'use strict';
const { checkTree, SEVERITY, key } = require('./consistency-rules');

const MEMBERS = ['owner', 'admin', 'editor', 'member'];
const EDIT = ['owner', 'admin', 'editor'];

function mount(app, d) {
  const { pool, who, findFamily, canRead, H, HttpError, readRel, express } = d;
  const json = express.json({ limit: '4kb' });

  // The tree named in the path, and the viewer's role there. Guests and non-members never get the issues.
  async function treeAndRole(req) {
    const f = await findFamily(req.params.tree);
    if (!f) throw new HttpError(404, 'tree_not_found');
    req.fam = f;
    const w = await who(req, f.id);
    if (!canRead(f, w) || !MEMBERS.includes(w.role)) throw new HttpError(w.email || w.code ? 403 : 401, 'members_only');
    return { f, w };
  }

  app.get('/api/trees/:tree/consistency', H(async (req, res) => {
    const { f } = await treeAndRole(req);
    const { rows: people } = await pool.query('select id, data from persons where family_id = $1 and not deleted', [f.id]);
    const persons = people.map((r) => ({ ...(r.data || {}), id: r.id, sex: (r.data && r.data.sex) || '' }));
    const rel = await readRel(pool, f.id, true);
    const { rows: evs } = await pool.query('select person_id, type, date_from from events where family_id = $1', [f.id]);
    const found = checkTree({ persons, links: { pc: rel.pc, cp: rel.cp }, events: evs });
    const { rows: ign } = await pool.query('select rule, person_ids_key from consistency_ignores where tree_id = $1', [f.id]);
    const ignoredKeys = new Set(ign.map((r) => r.rule + '|' + r.person_ids_key));
    const isIgnored = (i) => ignoredKeys.has(i.rule + '|' + i.key);
    const open = found.filter((i) => !isIgnored(i));
    const ignored = found.filter(isIgnored);
    const counts = { error: open.filter((i) => i.severity === 'error').length, warn: open.filter((i) => i.severity === 'warn').length };
    const strip = (i) => ({ rule: i.rule, severity: i.severity, personIds: i.personIds, key: i.key });
    res.set('Cache-Control', 'no-store');
    res.json({ issues: open.map(strip), counts, ignored: ignored.map(strip), family: f.id });
  }));

  const ignoreBody = (b) => {
    const rule = b && b.rule; const ids = b && b.person_ids;
    if (!Object.prototype.hasOwnProperty.call(SEVERITY, rule)) throw new HttpError(400, 'bad_rule');
    if (!Array.isArray(ids) || !ids.length || ids.length > 2 || !ids.every((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(x))) throw new HttpError(400, 'bad_person_ids');
    return { rule, pk: key(ids) };
  };
  app.post('/api/trees/:tree/consistency/ignore', json, H(async (req, res) => {
    const { f, w } = await treeAndRole(req);
    if (!EDIT.includes(w.role)) throw new HttpError(403, 'editor_only');
    const { rule, pk } = ignoreBody(req.body);
    await pool.query(`insert into consistency_ignores (tree_id, rule, person_ids_key, ignored_by) values ($1,$2,$3,$4)
      on conflict do nothing`, [f.id, rule, pk, w.editor || w.email || 'guest']);
    res.json({ ok: true });
  }));
  app.delete('/api/trees/:tree/consistency/ignore', json, H(async (req, res) => {
    const { f, w } = await treeAndRole(req);
    if (!EDIT.includes(w.role)) throw new HttpError(403, 'editor_only');
    const { rule, pk } = ignoreBody(req.body);
    await pool.query('delete from consistency_ignores where tree_id = $1 and rule = $2 and person_ids_key = $3', [f.id, rule, pk]);
    res.json({ ok: true });
  }));
}

module.exports = { mount };
