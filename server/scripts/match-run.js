#!/usr/bin/env node
// "Có thể là cùng một người": find people who may be the same person in two trees and (with --apply) store the
// suggestions for the review page. Dry run by default: counts and the best pairs with their reasons, nothing written.
// Never links anyone: an editor proposes the link from the review page and the other tree still decides.
// Usage (in server/): node scripts/match-run.js [--family <id>] [--top 20] [--min 0.8] [--apply]
// The database login is read from ../.env (DATABASE_URL) when not in the environment, and never printed.
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('../match-rules');
const M = require('../match-store');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const apply = args.includes('--apply');
const family = opt('--family', ''); const top = Number(opt('--top', 20)); const min = Number(opt('--min', R.MIN));
if (!Number.isFinite(min) || min < 0.5 || min > 1) { console.error('--min must be between 0.5 and 1'); process.exit(2); }
if (!process.env.DATABASE_URL) {
  const env = path.join(__dirname, '..', '..', '.env');
  const line = fs.existsSync(env) ? fs.readFileSync(env, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL=')) : null;
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await M.scoreAll(pool, { family, min: 0.5 });
    const above = r.scored.filter((s) => s.score >= min);
    console.log(`people ${r.people} · candidate pairs ${r.pairs} · already linked ${r.alreadyLinked} · scored ≥0.5: ${r.scored.length} · ≥${min}: ${above.length}`);
    for (const s of r.skipped) console.log(`skipped bucket (too common, ${s.size} people): ${s.key}`);
    for (const s of r.scored.slice(0, top)) console.log(`${s.score.toFixed(2)}  ${s.a.family}/${s.a.id} ⇄ ${s.b.family}/${s.b.id}  ${s.reasons.join('; ')}`);
    if (!apply) { console.log('DRY RUN: nothing written (add --apply to store the pairs at or above --min)'); return; }
    const w = await M.store(pool, above, min);
    console.log(`APPLIED: inserted ${w.inserted} · updated ${w.updated} · kept (dismissed/linked) ${w.kept}`);
  } catch (e) { console.error('FAILED', e.message); process.exitCode = 1; } finally { await pool.end(); }
})();
