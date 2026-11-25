// GEDCOM routes: export (members and above) and import (owners and admins; the editor code counts as admin).
// Import: POST with dry_run (default) returns the plan; dry_run false applies the same plan in one transaction:
//   new people and empty fields go straight in (history "nhập GEDCOM"), a field with another value goes to the review
//   queue as a suggestion with its base (3-way like any suggestion), events and relations are added when missing,
//   story notes (Câu chuyện) are written as stories unless the person already has the same one.
// Rules live in gedcom.js (pure), event and date rules in web/js/events.js, fuzzy names in web/js/fuzzy.js.
'use strict';
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const G = require('./gedcom');
const REL = require('./relations');
const EV = require('./events');
const { validateOp } = require('./core');

const LIB = (file) => import(pathToFileURL(path.join(__dirname, '..', 'web', 'js', file)).href);
let fuzzyP = null; const fuzzy = () => fuzzyP || (fuzzyP = LIB('fuzzy.js'));
const MAX_BYTES = 8 * 1024 * 1024; const MAX_PEOPLE = 5000;
const newId = () => 'N' + crypto.randomBytes(6).toString('hex');
const IMPORT_BY = 'nhập GEDCOM';

// deps: { pool, need, famOf, who, HttpError, applyOp, actorName, clearBookCache } (server.js helpers)
module.exports = function mountGedcom(app, deps) {
  const { pool, need, famOf, who, HttpError, applyOp, actorName, clearBookCache } = deps;

  async function buildPlan(q, f, content) {
    const R = await EV.rules(); const F = await fuzzy();
    const doc = G.readGedcom(R, content);
    if (!doc.persons.length) throw new HttpError(400, 'Không tìm thấy người nào trong tệp GEDCOM.');
    if (doc.persons.length > MAX_PEOPLE) throw new HttpError(400, `Tệp có quá nhiều người (tối đa ${MAX_PEOPLE}).`);
    const { rows: persons } = await q.query('select id, data from persons where family_id = $1 and not deleted', [f.id]);
    const { rows: events } = await q.query(
      'select id, person_id, type, date_kind, date_from, date_to, place, description, lunar from events where family_id = $1', [f.id]);
    const { rows: stories } = await q.query('select person_id, kind, title, body from stories where family_id = $1', [f.id]);
    const table = await REL.isTable(q, f.id);
    const rel = await REL.readRel(q, f.id, true);
    const plan = G.planImport(doc, { R, F, persons, events, stories, pc: rel.pc, cp: rel.cp, relMode: table ? 'table' : 'legacy', newId });
    return { doc, plan, table };
  }

  function previewOf(doc, plan, table) {
    return { ok: true, dry_run: true, version: doc.version, relation_mode: table ? 'table' : 'legacy', counts: plan.counts,
      items: plan.items, warnings: plan.warnings.slice(0, 100), warnings_total: plan.warnings.length };
  }

  // Apply: same plan, one transaction. Returns what was written.
  async function applyPlan(q, f, w, plan, table) {
    const actor = `${IMPORT_BY}: ${actorName(w)}`;
    const batch = crypto.randomBytes(6).toString('hex');
    let seq = 0; const opId = () => `gx-${batch}-${++seq}`;
    const out = { persons_created: 0, persons_filled: 0, events_added: 0, stories_added: 0, suggestions_queued: 0, relations_added: 0, relations_skipped: [] };
    for (const pp of plan.persons) {
      const fields = { ...pp.fill };
      if (Object.keys(fields).length) {
        const op = { op_id: opId(), id: pp.id, fields, ts: Date.now() };
        const err = validateOp(op);
        if (err) throw new HttpError(422, `Dữ liệu không hợp lệ (${pp.xref}): ${err}`);
        await applyOp(q, op, actor, f.id);
        if (pp.isNew) out.persons_created++; else out.persons_filled++;
      }
      for (const ev of pp.events) {
        await EV.insertEvent(q, f.id, pp.id, ev, actor);
        out.events_added++;
      }
      for (const st of pp.stories) {
        await EV.upsertStory(q, f.id, pp.id, { kind: st.kind, title: st.title, body: st.body }, actor);
        out.stories_added++;
      }
      if (pp.conflicts.length) {
        const changes = Object.fromEntries(pp.conflicts.map((c) => [c.field, c.incoming]));
        const base = Object.fromEntries(pp.conflicts.map((c) => [c.field, c.current ?? null]));
        const dup = await q.query(
          "select 1 from suggestions where person_id = $1 and family_id = $2 and status = 'pending' and by_name = $3 and changes = $4::jsonb",
          [pp.id, f.id, IMPORT_BY, JSON.stringify(changes)]);
        if (!dup.rowCount) {
          await q.query(
            `insert into suggestions (person_id, changes, note, by_name, by_contact, base, family_id, account_email, notify_pending)
             values ($1, $2, $3, $4, null, $5, $6, $7, false)`,
            [pp.id, JSON.stringify(changes), `Nhập từ tệp GEDCOM (${pp.xref})`, IMPORT_BY, JSON.stringify(base), f.id, w.email || null]);
          out.suggestions_queued++;
        }
      }
    }
    for (const r of plan.relations) {
      if (r.status !== 'new') continue;
      if (!table) { out.relations_skipped.push('quan hệ chưa áp dụng: dòng họ chưa chuyển dữ liệu quan hệ'); continue; }
      const id = `gx-${batch}-r${++seq}`;
      const op = r.type === 'couple'
        ? { op_id: id, action: 'add', kind: 'couple', a_id: r.a, b_id: r.b, cp_kind: r.kind, order_a: r.order_a, order_b: r.order_b,
          start_year: r.start_year, end_year: r.end_year, private: r.private, note: r.note }
        : { op_id: id, action: 'add', kind: 'parent_child', parent_id: r.parent, child_id: r.child, pc_kind: r.kind, birth_order: r.birth_order, private: r.private };
      try {
        const res = await REL.applyRelOp(q, op, actor, f.id);
        if (res.applied) out.relations_added++;
      } catch (e) {
        if (e instanceof REL.RelError) out.relations_skipped.push(e.message); else throw e;
      }
    }
    return out;
  }

  // The family's rows for an export (full or branch): people, events, stories and relations.
  async function exportRows(f) {
    const { rows: persons } = await pool.query('select id, data from persons where family_id = $1 and not deleted order by id', [f.id]);
    const { rows: events } = await pool.query(
      'select id, person_id, type, date_kind, date_from, date_to, place, description, lunar, sources from events where family_id = $1', [f.id]);
    const { rows: stories } = await pool.query('select person_id, kind, title, body from stories where family_id = $1 order by created_at', [f.id]);
    const rel = await REL.readRel(pool, f.id, true);
    return { persons, events, stories, rel };
  }

  app.get('/api/gedcom', need('member'), async (req, res, next) => {
    try {
      const f = req.fam;
      const living = req.query.living === 'hide' ? 'hide' : 'show';
      const R = await EV.rules();
      const { persons, events, stories, rel } = await exportRows(f);
      const text = G.buildExport({ R, family: f, persons, events, pc: rel.pc, cp: rel.cp, stories, living });
      res.set('Cache-Control', 'no-store');
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${String(f.slug || f.id).replace(/[^a-z0-9-]/g, '')}.ged"`);
      res.send(text);
    } catch (e) { next(e); }
  });

  // One branch as GEDCOM: the person, blood descendants and their spouses (G.branchIds). Same privacy as the full export.
  app.get('/api/persons/:id/gedcom', need('member'), async (req, res, next) => {
    try {
      if (req.query.scope !== 'branch') return res.status(400).json({ error: 'Chỉ có xuất nhánh (scope=branch).' });
      const f = req.fam;
      const living = req.query.living === 'hide' ? 'hide' : 'show';
      const id = String(req.params.id || '');
      const R = await EV.rules();
      const { persons: all, events, stories, rel } = await exportRows(f);
      const root = all.find((p) => p.id === id);
      if (!root) return res.status(404).json({ error: 'Không tìm thấy người này.' });
      const set = G.branchIds(id, rel.pc, rel.cp);
      const persons = all.filter((p) => set.has(p.id));
      const text = G.buildExport({ R, family: f, persons, events, pc: rel.pc, cp: rel.cp, stories, living });
      res.set('Cache-Control', 'no-store');
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${G.asciiBase(root.data?.name)}-nhanh.ged"`);
      res.send(text);
    } catch (e) { next(e); }
  });

  app.post('/api/gedcom/import', need('admin'), async (req, res, next) => {
    const f = req.fam;
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!content.trim()) return res.status(400).json({ error: 'Tệp trống.' });
    if (content.length > MAX_BYTES) return res.status(413).json({ error: 'Tệp quá lớn (tối đa 8 MB).' });
    const dry = req.body.dry_run !== false;
    const client = await pool.connect();
    try {
      const w = await who(req, f.id);
      await client.query('begin');
      const { doc, plan, table } = await buildPlan(client, f, content);
      if (dry) {
        await client.query('rollback');
        return res.json(previewOf(doc, plan, table));
      }
      const applied = await applyPlan(client, f, w, plan, table);
      await client.query('commit');
      clearBookCache();
      res.json({ ok: true, dry_run: false, counts: plan.counts, applied, warnings: plan.warnings.slice(0, 100) });
    } catch (e) {
      await client.query('rollback').catch(() => {});
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      next(e);
    } finally { client.release(); }
  });
};
