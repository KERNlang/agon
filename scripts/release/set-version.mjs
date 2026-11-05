#!/usr/bin/env node
// Usage: node scripts/release/set-version.mjs <version|vX.Y.Z> [--dry-run]
// Prints the bare resolved version last so CI can capture it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isFamilyPackage, readWorkspaces, REPO_ROOT } from './release-plan.mjs';

const LITERALS = [
  ['packages/cli/src/index.ts', /(name:\s*'agon',\s*version:\s*')[^']*(')/],
  ['packages/cli/src/blocks/engine.tsx', /(resolvePackageVersion\('@kernlang\/agon', ')[^']*(')/],
  ['packages/cli/src/commands/setup.ts', /(const VERSION = ')[^']*(')/],
  ['packages/mod-kernel/src/runtime-version.ts', /(AGON_RUNTIME_VERSION = ')[^']*(')/],
  ['packages/mod-api/src/version.ts', /(AGON_MOD_API_VERSION = ')[^']*(')/],
  ['scripts/spec/generate-modular-first-party-packages.mjs', /(const RELEASE_VERSION = ')[^']*(')/],
  ['scripts/spec/generate-modular-support-package-metadata.mjs', /(const version = ')[^']*(')/],
];

// Peer ranges are compatibility declarations and stay broad; only these are pinned.
const PINNED_BUCKETS = ['dependencies', 'devDependencies', 'optionalDependencies'];

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const raw = argv.find((arg) => !arg.startsWith('--'));
if (!raw) {
  console.error('error: version argument required (e.g. 1.2.3 or v1.2.3)');
  process.exit(1);
}
const version = raw.replace(/^refs\/tags\//, '').replace(/^v/, '').trim();
if (/^\d+\.\d+\.\d+-/.test(version)) {
  console.error(`error: "${raw}" is a prerelease; the kernel peer ranges (>=0.0.0-0 <2) exclude prereleases, so it could not install`);
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`error: "${raw}" is not a valid release version`);
  process.exit(1);
}

const writes = [];
const log = [];

for (const { directory, manifest } of readWorkspaces()) {
  const previous = manifest.version;
  manifest.version = version;
  const changes = [];
  for (const bucket of PINNED_BUCKETS) {
    for (const [name, range] of Object.entries(manifest[bucket] ?? {})) {
      if (!isFamilyPackage(name) || range === '*' || range.startsWith('workspace:') || range === version) continue;
      manifest[bucket][name] = version;
      changes.push(`${name} ${range} -> ${version}`);
    }
  }
  writes.push([join(REPO_ROOT, directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`]);

  const modManifestPath = join(REPO_ROOT, directory, 'agon.mod.json');
  if (existsSync(modManifestPath)) {
    const modManifest = JSON.parse(readFileSync(modManifestPath, 'utf8'));
    modManifest.version = version;
    writes.push([modManifestPath, `${JSON.stringify(modManifest, null, 2)}\n`]);
  }
  log.push(`${manifest.name.padEnd(44)} ${previous} -> ${version}${changes.length ? ` [${changes.length} ranges]` : ''}`);
}

for (const [relative, pattern] of LITERALS) {
  const path = join(REPO_ROOT, relative);
  const source = readFileSync(path, 'utf8');
  if (!pattern.test(source)) {
    console.error(`error: version literal not found in ${relative}`);
    process.exit(1);
  }
  writes.push([path, source.replace(pattern, `$1${version}$2`)]);
  log.push(`${relative} -> ${version}`);
}

if (!dryRun) for (const [path, content] of writes) writeFileSync(path, content);
for (const line of log) console.log(line);

console.log(version);
