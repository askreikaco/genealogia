#!/usr/bin/env node
// Which e2e test files a change set needs (rules and modules: scripts/test-map.json).
//   node scripts/affected-tests.mjs [--base <ref>] [changed-file ...]
// --base <ref>: changed files are `git diff --name-only <ref>...HEAD`.
// stdout: e2e files relative to server/ (../test/e2e/<file>), sorted, unique.
// stderr: one reason line. No dependencies (Node 22).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const E2E_DIR = 'test/e2e';

// Glob -> RegExp: "*" stays in one path segment, "**" crosses segments, "**/" may be empty, "?" is one non-slash char.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

const matchesAny = (globs, file) => globs.some((g) => globToRegExp(g).test(file));
const normalize = (f) => f.trim().replace(/\\/g, '/').replace(/^\.\//, '');

export function loadMap(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'scripts/test-map.json'), 'utf8'));
}

// Every e2e test file on disk, repo-relative ("test/e2e/x.test.js").
export function e2eOnDisk(root = ROOT) {
  return readdirSync(join(root, E2E_DIR))
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => `${E2E_DIR}/${f}`)
    .sort();
}

export function selectTests(changedInput, { map = loadMap(), root = ROOT } = {}) {
  const changed = [...new Set(changedInput.map(normalize).filter(Boolean))];
  const all = e2eOnDisk(root);
  const expand = (globs) => all.filter((f) => matchesAny(globs, f));
  const docs = map.modules.docs.paths;
  const code = changed.filter((f) => !matchesAny(docs, f));

  if (code.length === 0) {
    return { mode: 'none', reason: `mode=none (docs only) files=0`, files: [] };
  }

  const trigger = code.find((f) => matchesAny(map.full, f));
  if (trigger) {
    return { mode: 'full', reason: `mode=full trigger=${trigger} files=${all.length}`, files: all };
  }

  const picked = new Set();
  const modules = new Set();
  for (const f of code) {
    // web/js/app.js and server/server.js match no module: they get the smoke set like any other code file.
    for (const [name, m] of Object.entries(map.modules)) {
      if (name !== 'docs' && matchesAny(m.paths, f)) modules.add(name);
    }
    if (f.startsWith(`${E2E_DIR}/`) && f.endsWith('.test.js') && existsSync(join(root, f))) picked.add(f);
  }
  for (const name of modules) expand(map.modules[name].e2e).forEach((f) => picked.add(f));
  expand(map.smoke).forEach((f) => picked.add(f));

  const files = [...picked].sort();
  const mods = [...modules].sort().join(',') || '-';
  return { mode: 'selected', reason: `mode=selected modules=${mods} smoke=yes files=${files.length}`, files };
}

function main(argv) {
  let base = null;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') {
      base = argv[++i];
      if (!base) throw new Error('--base needs a ref');
    } else if (argv[i].startsWith('--')) {
      throw new Error(`unknown option ${argv[i]}`);
    } else {
      files.push(argv[i]);
    }
  }
  if (base !== null) {
    const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: ROOT, encoding: 'utf8' });
    files.push(...out.split('\n').filter(Boolean));
  } else if (files.length === 0) {
    throw new Error('usage: node scripts/affected-tests.mjs [--base <ref>] [changed-file ...]');
  }
  const { reason, files: picked } = selectTests(files);
  process.stderr.write(`${reason}\n`);
  const lines = picked.map((f) => `../${f}`);
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`affected-tests: ${err.message}\n`);
    process.exit(1);
  }
}
