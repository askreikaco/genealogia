// Consistency checker API (consistency-rules.js): GET /api/trees/:tree/consistency lists one tree's issues, split into
// open and ignored. POST and DELETE /api/trees/:tree/consistency/ignore hide or show one issue. Members only: a guest
// gets 401 and a signed-in non-member 403 (private trees: 403 for everyone outside). Ignoring needs editor or above.
// Review rules (REVIEW_RULES: year conflicts, possible duplicates, missing sex, verify notes) go to editors only.
// GET /api/trees/:tree/needs: "Cần bổ sung thông tin" for members (guests and non-members get 403): people with no
// birth year (and no death year when known dead), with the narrowest live estimate (estimate-graph.js, the same engine
// the profile uses, run here on the whole tree with every stored event).
// Rule ids, person ids and the estimate years only; the UI shows its own text.
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { checkTree, checkReview, needsRows, SEVERITY, REVIEW_RULES, key } = require('./consistency-rules');

const MEMBERS = ['owner', 'admin', 'editor', 'member'];
const EDIT = ['owner', 'admin', 'editor'];

// The web engine is an ES module (pure rules, shared with the browser): loaded once, on first use.
let engines = null;
const loadEngines = () => {
  if (!engines) {
    const u = (f) => pathToFileURL(path.join(__dirname, '..', 'web', 'js', f)).href;
    engines = import(u('estimate-graph.js'));
  }
  return engines;
};
// Parents, children and partners from the relation rows (pc: parent_id/child_id, cp: a_id/b_id), as the engine reads them.
function graphOf(pc = [], cp = []) {
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const parents = new Map(); const children = new Map(); const partners = new Map();
  for (const r of pc) { push(parents, r.child_id, r.parent_id); push(children, r.parent_id, r.child_id); }
  for (const c of cp) { push(partners, c.a_id, { id: c.b_id, start_year: c.start_year ?? null }); push(partners, c.b_id, { id: c.a_id, start_year: c.start_year ?? null }); }
  return { parents: (id) => parents.get(id) || [], children: (id) => children.get(id) || [], partners: (id) => partners.get(id) || [] };
}

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

  // The tree's people, relations, events and the live estimates of every person (one pass, used by both lists).
  async function treeFacts(f) {
    const { rows: people } = await pool.query('select id, data from persons where family_id = $1 and not deleted', [f.id]);
    const persons = people.map((r) => ({ ...(r.data || {}), id: r.id, sex: (r.data && r.data.sex) || '' }));
    const rel = await readRel(pool, f.id, true);
    const { rows: evs } = await pool.query('select person_id, type, date_kind, date_from, date_to from events where family_id = $1', [f.id]);
    const byP = new Map();
    for (const e of evs) { if (!byP.has(e.person_id)) byP.set(e.person_id, []); byP.get(e.person_id).push(e); }
    const eg = await loadEngines();
    const est = eg.estimateFamily(new Map(persons.map((p) => [p.id, p])), graphOf(rel.pc, rel.cp),
      { eventsOf: (id) => byP.get(id) || [], today: new Date().toISOString().slice(0, 10) });
    return { persons, rel, evs, est, eg };
  }

  app.get('/api/trees/:tree/consistency', H(async (req, res) => {
    const { f, w } = await treeAndRole(req);
    const { persons, rel, evs, est } = await treeFacts(f);
    const links = { pc: rel.pc, cp: rel.cp };
    let found = [...checkTree({ persons, links, events: evs }), ...checkReview({ persons, links, estimates: est })];
    if (!EDIT.includes(w.role)) found = found.filter((i) => !REVIEW_RULES.has(i.rule));
    const { rows: ign } = await pool.query('select rule, person_ids_key from consistency_ignores where tree_id = $1', [f.id]);
    const ignoredKeys = new Set(ign.map((r) => r.rule + '|' + r.person_ids_key));
    const isIgnored = (i) => ignoredKeys.has(i.rule + '|' + i.key);
    const open = found.filter((i) => !isIgnored(i));
    const ignored = found.filter(isIgnored);
    const counts = { error: open.filter((i) => i.severity === 'error').length, warn: open.filter((i) => i.severity === 'warn').length };
    const strip = (i) => ({ rule: i.rule, severity: i.severity, personIds: i.personIds, key: i.key, ...(i.detail ? { detail: i.detail } : {}) });
    res.set('Cache-Control', 'no-store');
    res.json({ issues: open.map(strip), counts, ignored: ignored.map(strip), family: f.id });
  }));

  app.get('/api/trees/:tree/needs', H(async (req, res) => {
    const f = await findFamily(req.params.tree);
    if (!f) throw new HttpError(404, 'tree_not_found');
    const w = await who(req, f.id);
    if (!canRead(f, w) || !MEMBERS.includes(w.role)) throw new HttpError(403, 'members_only');
    const { persons, est, eg } = await treeFacts(f);
    const rows = needsRows({ persons, estimates: est, maxWidth: eg.SHOW_MAX_WIDTH });
    res.set('Cache-Control', 'no-store');
    res.json({ rows, total: rows.length, family: f.id });
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

module.exports = { mount, graphOf };
