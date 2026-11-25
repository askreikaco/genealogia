#!/usr/bin/env node
// Vendors the pinned REIKA DS release (scripts/reika-ds.pin.json) into web/vendor/reika-ds/. No build step, no node_modules.
//   node scripts/sync-ds.mjs          -> download, verify (fail closed), extract, write VERSION, NOTICE, SHA256SUMS
//   node scripts/sync-ds.mjs --check  -> verify the vendored tree against SHA256SUMS and the pin (no network)
// Fail closed: a tarball whose sha256 differs from the pin, or a SHA256SUMS that disagrees with the pin, stops the sync
// before anything is written. Only the listed members are extracted; nothing from a tarball is executed.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PIN_FILE = join(ROOT, 'scripts/reika-ds.pin.json');
export const VENDOR = join(ROOT, 'web/vendor/reika-ds');
export const PIN = JSON.parse(readFileSync(PIN_FILE, 'utf8'));

// tarball -> members to vendor (path inside the tarball -> path under web/vendor/reika-ds/)
const MEMBERS = {
  [`reika-ds-tokens-${PIN.version}.tgz`]: { 'package/dist/tokens.css': 'tokens.css' },
  [`reika-ds-web-${PIN.version}.tgz`]: {
    'package/dist/web.css': 'web.css',
    'package/dist/index.js': 'js/index.js',
    'package/dist/html.js': 'js/html.js',
    'package/dist/components.js': 'js/components.js',
    'package/dist/menu-controller.js': 'js/menu-controller.js',
    'package/dist/confirm.js': 'js/confirm.js',
  },
  [`reika-ds-styles-${PIN.version}.tgz`]: {
    'package/fonts/fonts.css': 'fonts/fonts.css',
    'package/fonts/IBMPlexSans-Light.woff2': 'fonts/IBMPlexSans-Light.woff2',
    'package/fonts/IBMPlexSans-Regular.woff2': 'fonts/IBMPlexSans-Regular.woff2',
    'package/fonts/IBMPlexSans-Medium.woff2': 'fonts/IBMPlexSans-Medium.woff2',
    'package/fonts/IBMPlexSans-SemiBold.woff2': 'fonts/IBMPlexSans-SemiBold.woff2',
    'package/fonts/IBMPlexMono-Regular.woff2': 'fonts/IBMPlexMono-Regular.woff2',
    'package/fonts/LICENSE-OFL.txt': 'fonts/LICENSE-OFL.txt',
  },
};

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// Lists every file under dir (relative, forward slashes), except SHA256SUMS itself.
export function listFiles(dir, rel = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return listFiles(dir, r);
    return r === 'SHA256SUMS' ? [] : [r];
  }).sort();
}

// Checks a vendored tree: VERSION matches the pin, every file matches SHA256SUMS, and no file is missing or extra.
// Returns a list of problems (empty = clean).
export function verifyVendor(dir = VENDOR, pin = PIN) {
  const problems = [];
  const read = (p) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p)) : null);
  const version = read('VERSION')?.toString().trim();
  if (version !== pin.version) problems.push(`VERSION is ${version ?? 'missing'}, pin is ${pin.version}`);
  const sums = new Map();
  for (const line of (read('SHA256SUMS')?.toString() ?? '').split('\n').filter(Boolean)) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) { problems.push(`bad SHA256SUMS line: ${line}`); continue; }
    sums.set(m[2], m[1]);
  }
  const files = listFiles(dir);
  for (const f of files) {
    if (!sums.has(f)) problems.push(`not in SHA256SUMS: ${f}`);
    else if (sha256(read(f)) !== sums.get(f)) problems.push(`checksum mismatch: ${f}`);
  }
  for (const f of sums.keys()) if (!files.includes(f)) problems.push(`listed but missing: ${f}`);
  return problems;
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function sync() {
  const base = `https://github.com/${PIN.repo}/releases/download/v${PIN.version}`;
  const work = mkdtempSync(join(tmpdir(), 'reika-ds-sync-'));
  try {
    const sumsBuf = await download(`${base}/SHA256SUMS`);
    const sumsTxt = sumsBuf.toString();
    for (const [name, want] of Object.entries(PIN.tarballs)) {
      const line = sumsTxt.split('\n').find((l) => l.endsWith(`  ${name}`));
      if (!line || !line.startsWith(want)) throw new Error(`release SHA256SUMS does not list ${name} with the pinned sha256`);
    }
    const out = new Map(); // vendored path -> Buffer
    for (const [name, members] of Object.entries(MEMBERS)) {
      const buf = await download(`${base}/${name}`);
      if (sha256(buf) !== PIN.tarballs[name]) throw new Error(`${name}: sha256 ${sha256(buf)} differs from the pin, refusing to extract`);
      const tgz = join(work, name);
      writeFileSync(tgz, buf);
      const dir = join(work, name + '.d');
      mkdirSync(dir);
      execFileSync('tar', ['-xzf', tgz, '-C', dir, '--no-same-owner', ...Object.keys(members)]);
      for (const [member, dest] of Object.entries(members)) out.set(dest, readFileSync(join(dir, member)));
    }
    out.set('VERSION', Buffer.from(PIN.version + '\n'));
    out.set('NOTICE', Buffer.from(
      `REIKA DS ${PIN.version} (${PIN.repo}), vendored unmodified.\n` +
      'Code: Apache License 2.0. Fonts (fonts/): IBM Plex, SIL Open Font License 1.1 (fonts/LICENSE-OFL.txt).\n' +
      `Source: https://github.com/${PIN.repo}/releases/tag/v${PIN.version}\n`));
    const lines = [...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, b]) => `${sha256(b)}  ${p}`);
    out.set('SHA256SUMS', Buffer.from(lines.join('\n') + '\n'));
    rmSync(VENDOR, { recursive: true, force: true });
    for (const [p, b] of out) {
      mkdirSync(dirname(join(VENDOR, p)), { recursive: true });
      writeFileSync(join(VENDOR, p), b);
    }
    const problems = verifyVendor();
    if (problems.length) throw new Error('vendored tree failed its own check:\n  ' + problems.join('\n  '));
    console.log(`vendored REIKA DS ${PIN.version}: ${out.size} files into ${relative(ROOT, VENDOR)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = verifyVendor();
    if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
    console.log(`vendored REIKA DS ${PIN.version}: clean`);
  } else {
    await sync().catch((e) => { console.error(`sync-ds: ${e.message}`); process.exit(1); });
  }
}
