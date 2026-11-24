// Seed the places gazetteer with Vietnam's provinces and districts (or communes) from a LOCAL JSON file: nothing is
// downloaded here, so CI never touches the network. Dry run by default (counts only, rolled back); --apply commits.
// Usage (from server/): node scripts/places-import-vn.js <units.json> [--apply]
// File: an array (or { "units": [...] }) of
//   { "code": "79", "name": "Thành phố Hồ Chí Minh", "kind": "province", "parent_code": null,
//     "valid_from": "1976-07-02", "valid_to": null, "wikidata_id": "Q…", "geonames_id": 123,
//     "other_names": [{ "name": "…", "lang": "vi", "valid_from": "…", "valid_to": "…" }] }
// Matching is by the official code: a unit that exists only gets its EMPTY ids filled and its missing names and
// parents added (our copy wins). New units are created as verified. Parents must come in the same file or exist.
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../places-rules');

const KINDS = ['country', 'province', 'district', 'commune'];

function validate(u, i) {
  const at = `unit ${i + 1}`;
  if (!u || typeof u !== 'object') return `${at}: not an object`;
  if (!/^[A-Za-z0-9._-]{1,20}$/.test(String(u.code || ''))) return `${at}: code`;
  if (!String(u.name || '').trim()) return `${at}: name`;
  if (!KINDS.includes(u.kind)) return `${at}: kind must be one of ${KINDS.join(', ')}`;
  if (u.wikidata_id && !/^Q\d+$/.test(u.wikidata_id)) return `${at}: wikidata_id`;
  if (u.geonames_id != null && !/^\d{1,12}$/.test(String(u.geonames_id))) return `${at}: geonames_id`;
  for (const v of [u.valid_from, u.valid_to, ...(u.other_names || []).flatMap((n) => [n.valid_from, n.valid_to])]) if (!R.isDate(v)) return `${at}: date ${v}`;
  return null;
}

// Parents before children: provinces, then districts, then communes (file order inside one level).
const order = (units) => [...units].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));

async function importUnits(q, units, { source = 'import', by = 'import' } = {}) {
  const errs = units.map(validate).filter(Boolean);
  if (errs.length) throw new Error(errs.slice(0, 5).join('; '));
  const n = { created: 0, filled: 0, names: 0, parents: 0, unchanged: 0 };
  const idOf = new Map();
  for (const u of order(units)) {
    const code = String(u.code);
    let p = (await q.query('select id, wikidata_id, geonames_id from places where official_code=$1 order by id limit 1', [code])).rows[0];
    let touched = false;
    if (!p) {
      p = (await q.query("insert into places (kind, official_code, wikidata_id, geonames_id, status, created_by) values ($1,$2,$3,$4,'verified',$5) returning id, wikidata_id, geonames_id",
        [u.kind, code, u.wikidata_id || null, u.geonames_id || null, by])).rows[0];
      n.created++; touched = true;
    } else {
      const set = [];
      if (u.wikidata_id && !p.wikidata_id && !(await q.query('select 1 from places where wikidata_id=$1', [u.wikidata_id])).rowCount) set.push(['wikidata_id', u.wikidata_id]);
      if (u.geonames_id && !p.geonames_id && !(await q.query('select 1 from places where geonames_id=$1', [u.geonames_id])).rowCount) set.push(['geonames_id', u.geonames_id]);
      for (const [col, val] of set) await q.query(`update places set ${col}=$2, updated_at=now() where id=$1`, [p.id, val]);
      if (set.length) { n.filled++; touched = true; }
    }
    idOf.set(code, p.id);
    const names = [{ name: u.name, lang: 'vi', valid_from: u.valid_from || null, valid_to: u.valid_to || null, primary: true }, ...(u.other_names || []).map((x) => ({ ...x, primary: false }))];
    for (const nm of names) {
      const name = String(nm.name || '').trim(); if (!name) continue;
      const lang = nm.lang || 'vi';
      if ((await q.query('select 1 from place_names where place_id=$1 and name_fold=$2 and lang=$3 and coalesce(valid_from,\'\')=coalesce($4,\'\')', [p.id, R.fold(name), lang, nm.valid_from || null])).rowCount) continue;
      await q.query('insert into place_names (place_id, name, name_fold, lang, valid_from, valid_to, is_primary, source) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [p.id, name, R.fold(name), lang, nm.valid_from || null, nm.valid_to || null, nm.primary, source]);
      n.names++; touched = true;
    }
    if (u.parent_code) {
      const parent = idOf.get(String(u.parent_code)) || (await q.query('select id from places where official_code=$1 order by id limit 1', [String(u.parent_code)])).rows[0]?.id;
      if (!parent) throw new Error(`unit ${code}: parent ${u.parent_code} not found`);
      if (!(await q.query('select 1 from place_parents where place_id=$1 and parent_id=$2', [p.id, parent])).rowCount) {
        await q.query('insert into place_parents (place_id, parent_id, valid_from, valid_to, source) values ($1,$2,$3,$4,$5)', [p.id, parent, u.valid_from || null, u.valid_to || null, source]);
        n.parents++; touched = true;
      }
    }
    if (!touched) n.unchanged++;
  }
  return n;
}

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) { console.error('usage: node scripts/places-import-vn.js <units.json> [--apply]'); process.exit(2); }
  const apply = flag === '--apply';
  if (!process.env.DATABASE_URL) { // read only DATABASE_URL from ../.env (never printed)
    const env = path.resolve(__dirname, '..', '..', '.env');
    const line = fs.existsSync(env) && fs.readFileSync(env, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const units = Array.isArray(raw) ? raw : raw.units || [];
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const c = await pool.connect();
  try {
    await c.query('begin');
    const n = await importUnits(c, units, { source: 'import:' + path.basename(file) });
    if (apply) await c.query('commit'); else await c.query('rollback');
    console.log(apply ? 'APPLIED' : 'DRY RUN', JSON.stringify({ units: units.length, ...n }));
  } catch (e) { await c.query('rollback').catch(() => {}); console.error('FAILED', e.message); process.exitCode = 1; }
  finally { c.release(); await pool.end(); }
}

if (require.main === module) main();
module.exports = { importUnits, validate };
