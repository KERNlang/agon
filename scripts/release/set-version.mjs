#!/usr/bin/env node
// Stamp a release version into @kernlang/agon (the published CLI) from a git
// tag. The banner reads @kernlang/agon's package.json version at runtime
// (packages/cli/src/kern/blocks/engine.kern::VERSION), so setting it here is
// what makes `agon` display the released tag.
//
// Usage: node scripts/release/set-version.mjs <version|vX.Y.Z>
//   - Accepts a bare semver (1.2.3) or a v-prefixed tag (v1.2.3).
//   - Updates ONLY packages/cli/package.json. Engines and dedup keep their own
//     independent versions (see scripts/release/publish-if-new.mjs); the tag is
//     the PRODUCT (CLI) version, not a monorepo-wide lockstep version.
//   - Also keeps the VERSION fallback literal in engine.kern in sync, so a
//     resolution-failure fallback still shows the right version.
//
// Prints the resolved version to stdout (so CI can capture it). Exits non-zero
// on a malformed version or a missing file.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const raw = process.argv[2];
if (!raw) {
  console.error('error: version argument required (e.g. 1.2.3 or v1.2.3)');
  process.exit(1);
}

// Strip a leading v and any refs/tags/ prefix CI might pass through.
const version = raw.replace(/^refs\/tags\//, '').replace(/^v/, '').trim();

// Strict semver (optionally with a prerelease/build tail) — never stamp junk.
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`error: "${raw}" is not a valid semver version`);
  process.exit(1);
}

// 1. packages/cli/package.json — the published version (drives the banner + npm).
const cliPkgPath = join(ROOT, 'packages', 'cli', 'package.json');
const cliPkg = JSON.parse(readFileSync(cliPkgPath, 'utf8'));
const previous = cliPkg.version;
cliPkg.version = version;
writeFileSync(cliPkgPath, JSON.stringify(cliPkg, null, 2) + '\n');

// 2. engine.kern VERSION fallback literal — last-resort if runtime resolution
//    fails; keep it equal to the release so the banner is never wrong.
const enginePath = join(ROOT, 'packages', 'cli', 'src', 'kern', 'blocks', 'engine.kern');
let engineSrc = readFileSync(enginePath, 'utf8');
const fallbackRe = /(resolvePackageVersion\(null, '@kernlang\/agon', ')[^']*(')/;
if (fallbackRe.test(engineSrc)) {
  engineSrc = engineSrc.replace(fallbackRe, `$1${version}$2`);
  writeFileSync(enginePath, engineSrc);
} else {
  console.error('warning: VERSION fallback literal not found in engine.kern — banner fallback not updated');
}

console.log(`@kernlang/agon: ${previous} → ${version}`);
console.log(version);
