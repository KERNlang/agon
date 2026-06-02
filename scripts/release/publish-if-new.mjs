#!/usr/bin/env node
// Idempotent npm publish: publish a package ONLY if its current version is not
// already on the registry. Lets a CLI-only release run the full chain without
// failing on "cannot publish over existing version" for engines/dedup whose
// versions did not change.
//
// Usage: node scripts/release/publish-if-new.mjs <publish-cwd> [extra npm args...]
//   <publish-cwd> = directory containing the package.json to publish
//                   (e.g. packages/cli, packages/dedup, kern_engines).
//   Reads name+version from that package.json, queries `npm view <name>
//   versions`, and runs `npm publish` there only when the version is absent.
//
// Honors NODE_AUTH_TOKEN / the ambient npm auth. Exits non-zero only on a real
// publish failure — an already-published version is a clean skip (exit 0).

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const cwd = process.argv[2];
if (!cwd) {
  console.error('error: publish-cwd argument required (e.g. packages/cli)');
  process.exit(1);
}
const extraArgs = process.argv.slice(3);
const pkgDir = resolve(process.cwd(), cwd);
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const { name, version } = pkg;

if (!name || !version) {
  console.error(`error: ${cwd}/package.json missing name or version`);
  process.exit(1);
}

// Query published versions. A 404 (E404 — never published) is a clean "new".
let published = [];
try {
  const out = execFileSync('npm', ['view', `${name}`, 'versions', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out);
  published = Array.isArray(parsed) ? parsed : [parsed];
} catch (err) {
  const msg = String(err.stdout || '') + String(err.stderr || '') + String(err.message || '');
  if (/E404|not found|is not in this registry/i.test(msg)) {
    published = []; // never published — treat as new
  } else {
    console.error(`error: failed to query npm for ${name}: ${msg.slice(0, 300)}`);
    process.exit(1);
  }
}

if (published.includes(version)) {
  console.log(`skip: ${name}@${version} already published`);
  process.exit(0);
}

// A prerelease tag (v1.2.3-beta.1) must NOT become the default `latest` install
// target. Publish prereleases under the `next` dist-tag unless the caller already
// passed an explicit --tag.
const isPrerelease = version.includes('-');
const hasExplicitTag = extraArgs.some((a) => a === '--tag' || a.startsWith('--tag='));
const publishArgs = ['publish', ...extraArgs];
if (isPrerelease && !hasExplicitTag) {
  publishArgs.push('--tag', 'next');
  console.log(`note: ${version} is a prerelease — publishing under dist-tag 'next' (not latest)`);
}

console.log(`publish: ${name}@${version} (new)`);
execFileSync('npm', publishArgs, { cwd: pkgDir, stdio: 'inherit' });
console.log(`published: ${name}@${version}`);
