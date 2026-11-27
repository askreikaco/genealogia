// Clan view (read only): every family tree that shares a surname, grouped by accepted "same person" links, oldest
// founder first. GET /api/clans/:slug?page=N. The rules (surname, slug, grouping, paging) are in web/js/clan-core.js.
// Cost: a handful of aggregate queries per surname, cached 5 minutes (refreshed sooner when families or accepted links
// change); the viewer filter runs on the cached rows. Privacy: a tree the viewer cannot list (private, or link-only
// and not a member) is only counted, never named; edges to it are dropped. A founder's name and year are shown only
// when the founder has died or the viewer is a member of that tree.
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { isDead, effectiveLiving } = require('./core');
const SR = require('./surname-rules');

let coreMod = null;
const core = () => coreMod || (coreMod = import(pathToFileURL(path.join(__dirname, '..', 'web', 'js', 'clan-core.js')).href));
const TTL = 5 * 60e3;
const PAGE = 50;
const yearOf = (v) => { const m = /(\d{4})/.exec(String(v || '')); return m ? Number(m[1]) : null; };

function mount(app, d) {
  const { pool, readSession, rolesByFamily, H, HttpError } = d;
  const cache = new Map(); // slug -> { at, ver, base }

  // Changes that should refresh the cache before 5 minutes: a family added/edited, a link accepted/removed.
  const version = async () => {
    const { rows } = await pool.query(`select (select count(*) from families) || ':' || coalesce((select max(updated_at) from families)::text, '')
      || ':' || (select count(*) from person_links where status = 'accepted') || ':' || coalesce((select max(decided_at) from person_links)::text, '') v`);
    return rows[0].v;
  };

  async function baseFor(slug, C) {
    const ver = await version();
    const hit = cache.get(slug);
    if (hit && hit.ver === ver && Date.now() - hit.at < TTL) return hit.base;
    const all = (await pool.query(`select id, slug, name, han, short_name, founder_person_id, origin_place, place, visibility, country,
      origin_surname, origin_surname_han, origin_year, origin_reason, origin_visibility, living_visibility from families`)).rows;
    // The trees of this surname, plus the trees that carried it as their họ gốc (carried: true). Which of them a viewer
    // may see is decided per request (origin_visibility), never here: the cache is shared by all viewers.
    const primary = all.filter((f) => C.inClan(f.name, f.country) && C.clanSlug(C.familySurname(f.name)) === slug);
    const carried = all.filter((f) => f.origin_surname && C.clanSlug(f.origin_surname) === slug && C.clanSlug(C.familySurname(f.name)) !== slug && C.inClan(f.name, f.country))
      .map((f) => ({ ...f, carried: true }));
    const fams = [...primary, ...carried];
    let base = null;
    if (fams.length) {
      const ids = fams.map((f) => f.id);
      const counts = new Map((await pool.query(
        'select family_id, count(*)::int n from persons where family_id = any($1) and not deleted group by family_id', [ids])).rows.map((r) => [r.family_id, r.n]));
      const set = fams.filter((f) => f.founder_person_id).map((f) => f.founder_person_id);
      const chosen = new Map((await pool.query(
        'select id, family_id, data, self_visibility from persons where id = any($1) and not deleted', [set])).rows.map((r) => [r.family_id, r]));
      // Automatic founder: the earliest generation of the family's own line (not married-in), then the earliest year.
      const auto = new Map((await pool.query(
        `select distinct on (family_id) family_id, id, data, self_visibility from persons
          where family_id = any($1) and not deleted and coalesce(data->>'spouse_of', '') = ''
          order by family_id, (case when data->>'gen' ~ '^[0-9]+$' then (data->>'gen')::int end) nulls last,
            (substring(coalesce(nullif(data->>'born', ''), data->>'died', '') from '[0-9]{4}'))::int nulls last, id`, [ids])).rows.map((r) => [r.family_id, r]));
      const edges = (await pool.query(
        `select least(a_family, b_family) a, greatest(a_family, b_family) b, count(*)::int n from person_links
          where status = 'accepted' and a_family = any($1) and b_family = any($1) and a_family <> b_family group by 1, 2`, [ids])).rows;
      const hanOf = (f) => (f.carried ? f.origin_surname_han : f.han);
      const hanCount = new Map(); for (const f of fams) if (hanOf(f)) hanCount.set(hanOf(f), (hanCount.get(hanOf(f)) || 0) + 1);
      base = {
        surname: primary.length ? C.familySurname(primary[0].name) : fams[0].origin_surname,
        han: [...hanCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '',
        fams: fams.map((f) => {
          const p = (f.founder_person_id && chosen.get(f.id)) || auto.get(f.id) || null;
          return { ...f, people: counts.get(f.id) || 0,
            founder: p ? { name: p.data.name || '', born: yearOf(p.data.born), died: yearOf(p.data.died), dead: isDead(p.data), names: !isDead(p.data) && effectiveLiving(f.living_visibility, p.self_visibility) === 'names' } : null };
        }),
        edges,
      };
    }
    cache.set(slug, { at: Date.now(), ver, base });
    return base;
  }

  app.get('/api/clans/:slug', H(async (req, res) => {
    const slug = String(req.params.slug || '');
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) throw new HttpError(400, 'Tên họ không hợp lệ.');
    const C = await core();
    const base = await baseFor(slug, C);
    if (!base) throw new HttpError(404, 'Chưa có dòng họ nào mang họ này.');
    // rolesByFamily: a signed-in member's roles, and an editor code's own family as editor (never admin)
    const roles = await rolesByFamily(req);
    const member = (f) => !!roles[f.id];
    const roleOf = (f) => roles[f.id] || null;
    // Họ gốc: a viewer sees it only as its visibility allows (all | members | editors). A carried tree whose origin this
    // viewer may not see is not listed at all, and not counted either.
    const originOk = (f) => !!f.origin_surname && SR.originVisibleTo(f.origin_visibility, roleOf(f));
    const visible = (f) => (member(f) || f.visibility === 'public') && (!f.carried || originOk(f));
    const vis = base.fams.filter(visible);
    const seen = base.fams.filter((f) => !f.carried || originOk(f));
    const trees = vis.map((f) => {
      const show = f.founder && (f.founder.dead || member(f));
      // P1d: a living founder shown as name only (names): the name, no years
      const named = !show && f.founder && f.founder.names;
      const year = show ? (f.founder.born ?? f.founder.died) : null;
      const change = originOk(f) ? { from: f.origin_surname, han: f.origin_surname_han || '', year: f.origin_year || '', reason: f.origin_reason || '',
        now: C.familySurname(f.name), carried: !!f.carried } : null;
      return { id: f.id, slug: f.slug || f.id, label: f.short_name || f.name, han: f.han || '', origin: f.origin_place || f.place || '',
        people: f.people, year, country: f.country || '', founder: show ? { name: f.founder.name, born: f.founder.born, died: f.founder.died } : named ? { name: f.founder.name, born: null, died: null } : null, change };
    });
    // Quốc gia level: counts over the trees this viewer may see (private trees never add to a country), and an
    // optional ?country=XX (or NONE: no country set) filter for the clan page chips.
    const qc = typeof req.query.country === 'string' ? req.query.country.trim().toUpperCase() : '';
    if (qc && !/^([A-Z]{2}|NONE)$/.test(qc)) throw new HttpError(400, 'Quốc gia không hợp lệ.');
    const cc = new Map(); for (const t of trees) { const k = t.country || 'NONE'; cc.set(k, (cc.get(k) || 0) + 1); }
    const countries = cc.size && [...cc.keys()].some((k) => k !== 'NONE')
      ? [...cc.entries()].map(([code, n]) => ({ code, trees: n })).sort((a, b) => (a.code === 'NONE') - (b.code === 'NONE') || b.trees - a.trees || a.code.localeCompare(b.code)) : [];
    const shown = qc ? trees.filter((t) => (qc === 'NONE' ? !t.country : t.country === qc)) : trees;
    const grouped = C.groupTrees(shown, base.edges);
    const out = C.pageOf(grouped, req.query.page, PAGE);
    res.set('Cache-Control', 'no-store');
    res.json({
      surname: base.surname, han: base.han, slug,
      kpis: { groups: grouped.groups.length, trees: trees.length, people: trees.reduce((n, t) => n + t.people, 0) },
      private_count: seen.length - vis.length, countries, country: qc,
      // Historical hints (surname-hints.json): editors only, a suggestion ("có thể liên quan"), never assigned.
      hints: Object.values(roles).some((r) => r === 'owner' || r === 'admin' || r === 'editor') ? SR.hintsFor(base.surname) : [],
      ...out,
    });
  }));
}

module.exports = { mount };
