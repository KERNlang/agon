#!/usr/bin/env node
// Lockstep release versioning. Stamp ONE version (from a git tag) into the WHOLE
// @kernlang/agon-* family at once — every workspace package's version AND its
// internal dependency ranges — plus the two hand-maintained version literals
// (the citty meta in index.ts that drives `agon --version`, and the VERSION
// fallback in engine.kern that drives the banner). One tag => the whole product
// moves together, so a release NEVER needs a manual per-package bump.
//
// Usage: node scripts/release/set-version.mjs <version|vX.Y.Z> [--dry-run]
//   - Accepts a bare semver (1.2.3) or a v-prefixed tag (v1.2.3).
//   - Bumps `version` in every package in PACKAGES (the agon family). The
//     independently-versioned @kernlang/agon-engines is intentionally excluded —
//     it self-publishes from its own repo; agon only depends on it.
//   - Rewrites internal @kernlang/agon-* dependency ranges to ^<version> so a
//     published @kernlang/agon never resolves a stale in-family dep (e.g. dedup).
//     Ranges in INDEPENDENT_DEPS (engines) and "*"/"workspace:" ranges are left
//     as-is.
//   - Stamps the citty meta version in packages/cli/src/index.ts (this is what
//     `agon --version` prints) and the VERSION fallback literal in engine.kern
//     (the banner's last resort when runtime package.json resolution fails).
//   - --dry-run prints the planned changes without writing any file.
//
// Prints each change, then the bare resolved version last (so CI can capture it
// if needed). Exits non-zero on a malformed version or a missing required file.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Every workspace package whose version tracks the agon product release. Order
// here is cosmetic (logging only); npm publish order is governed by the `release`
// script. @kernlang/agon-engines is deliberately NOT here: it's an independent,
// shared substrate (consumed by agon, the KERN site, …) that owns its own
// version + release pipeline in its own repo — agon only DEPENDS on a published
// version of it, it does not bump or publish it.
const PACKAGES = [
  'packages/core',
  'packages/forge',
  'packages/adapter-cli',
  'packages/cli',
  'packages/mcp',
  'packages/saas-api',
  'packages/dedup',
];

// Internal deps that are independently versioned — never rewrite their range to
// the agon tag version (they move on their own cadence).
const INDEPENDENT_DEPS = new Set(['@kernlang/agon-engines']);

const DEP_BUCKETS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const raw = argv.find((a) => !a.startsWith('--'));
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

const write = (path, content) => {
  if (!dryRun) writeFileSync(path, content);
};

// 1. Stamp version + internal dependency ranges in every workspace package.json.
for (const rel of PACKAGES) {
  const pkgPath = join(ROOT, rel, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error(`warning: ${rel}/package.json not found — skipping`);
    continue;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const previous = pkg.version;
  pkg.version = version;

  const depChanges = [];
  for (const bucket of DEP_BUCKETS) {
    const deps = pkg[bucket];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (!name.startsWith('@kernlang/agon')) continue;
      if (INDEPENDENT_DEPS.has(name)) continue; // independently versioned — leave its range alone
      const current = deps[name];
      // "*" already matches any version; workspace: is resolved by the workspace.
      if (current === '*' || current.startsWith('workspace:')) continue;
      const next = `^${version}`;
      if (current !== next) {
        deps[name] = next;
        depChanges.push(`${name} ${current} → ${next}`);
      }
    }
  }

  write(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  const suffix = depChanges.length ? ` [${depChanges.join(', ')}]` : '';
  console.log(`${(pkg.name || rel).padEnd(28)} ${previous} → ${version}${suffix}`);
}

// 2. Stamp the citty meta version in index.ts — this is what `agon --version`
//    prints (separate from the runtime-resolved banner VERSION). Anchored on
//    `name: 'agon'` so it can only match the main command's meta block.
const indexPath = join(ROOT, 'packages', 'cli', 'src', 'index.ts');
let indexSrc = readFileSync(indexPath, 'utf8');
const metaRe = /(name:\s*'agon',\s*version:\s*')[^']*(')/;
if (metaRe.test(indexSrc)) {
  indexSrc = indexSrc.replace(metaRe, `$1${version}$2`);
  write(indexPath, indexSrc);
  console.log(`index.ts citty meta.version → ${version}`);
} else {
  console.error('warning: citty meta.version literal not found in index.ts — `agon --version` not updated');
}

// 3. Stamp the VERSION fallback literal in engine.kern — last resort if runtime
//    resolution fails; keep it equal to the release so the banner is never wrong.
const enginePath = join(ROOT, 'packages', 'cli', 'src', 'kern', 'blocks', 'engine.kern');
let engineSrc = readFileSync(enginePath, 'utf8');
const fallbackRe = /(resolvePackageVersion\(null, '@kernlang\/agon', ')[^']*(')/;
if (fallbackRe.test(engineSrc)) {
  engineSrc = engineSrc.replace(fallbackRe, `$1${version}$2`);
  write(enginePath, engineSrc);
  console.log(`engine.kern VERSION fallback → ${version}`);
} else {
  console.error('warning: VERSION fallback literal not found in engine.kern — banner fallback not updated');
}

console.log(dryRun
  ? `\n(dry-run) would set the @kernlang/agon-* family to ${version}`
  : `\nThe @kernlang/agon-* family is now ${version}`);
console.log(version);
