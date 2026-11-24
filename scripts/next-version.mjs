// Next release version (semver) for a deploy: the last tag vX.Y.Z plus the squash commit's Conventional Commits prefix.
//   feat / feat(scope) -> minor; feat! / type!: or "BREAKING CHANGE" in the body -> major;
//   fix, perf, refactor, style, ops, docs, test, chore, any other type or no prefix -> patch.
//   No tag yet -> the package.json version (the first release).
// Pure: nextVersion() does no I/O. CLI (used by .github/workflows/deploy.yml):
//   node scripts/next-version.mjs --tag <vX.Y.Z or empty> --pkg <X.Y.Z> --message-file <file with the commit message>
//   prints X.Y.Z on stdout.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
const HEADER = /^([A-Za-z]+)(\([^)\n]*\))?(!)?:/;

export function bumpKind(subject = '', body = '') {
  const m = HEADER.exec(String(subject).trim());
  if (m && m[3]) return 'major';
  if (/BREAKING[ -]CHANGE/.test(String(body))) return 'major';
  if (m && m[1].toLowerCase() === 'feat') return 'minor';
  return 'patch';
}

export function nextVersion({ lastTag = '', pkgVersion = '', subject = '', body = '' } = {}) {
  if (!String(lastTag).trim()) {
    const p = SEMVER.exec(String(pkgVersion).trim());
    if (!p) throw new Error(`no tag and no semver package version: "${pkgVersion}"`);
    return `${Number(p[1])}.${Number(p[2])}.${Number(p[3])}`;
  }
  const t = SEMVER.exec(String(lastTag).trim());
  if (!t) throw new Error(`last tag is not vX.Y.Z: "${lastTag}"`);
  const [major, minor, patch] = [Number(t[1]), Number(t[2]), Number(t[3])];
  const kind = bumpKind(subject, body);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? '' : '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = arg('message-file');
  const message = file ? readFileSync(file, 'utf8') : '';
  const [subject = '', ...rest] = message.split('\n');
  process.stdout.write(`${nextVersion({ lastTag: arg('tag'), pkgVersion: arg('pkg'), subject, body: rest.join('\n') })}\n`);
}
