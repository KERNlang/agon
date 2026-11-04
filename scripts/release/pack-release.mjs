#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkManifestShape, checkPackedTree } from './leak-check.mjs';
import { LAUNCHER, orderForPublish, readWorkspaces, REPO_ROOT } from './release-plan.mjs';

export const MANIFEST_FILE = 'release-manifest.json';

function packWorkspace(directory, out) {
  const stdout = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], {
    cwd: join(REPO_ROOT, directory), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(stdout)[0];
}

function inspectTarball(tarball, scratch) {
  const target = mkdtempSync(join(scratch, 'inspect-'));
  execFileSync('tar', ['-xzf', tarball, '-C', target]);
  const packageRoot = join(target, 'package');
  return { packageRoot, manifest: JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) };
}

function assertChannelMatches(entries, launcherRoot, launcherFiles) {
  const channel = JSON.parse(readFileSync(join(launcherRoot, 'release-channel.json'), 'utf8'));
  const launcher = entries.find(({ name }) => name === LAUNCHER);
  const problems = [];
  if (channel.version !== launcher.version) problems.push(`channel version ${channel.version} is not ${launcher.version}`);
  const pinned = new Map([...channel.packages, ...channel.compatibilityArtifacts].map((entry) => [entry.id, entry]));
  for (const { name, version, integrity } of entries) {
    if (name === LAUNCHER) continue;
    const entry = pinned.get(name);
    if (!entry) { problems.push(`${name} is published but absent from the channel`); continue; }
    if (entry.version !== version) problems.push(`${name}: channel pins ${entry.version}, packed ${version}`);
    if (entry.integrity !== integrity) problems.push(`${name}: channel integrity differs from the packed tarball`);
    pinned.delete(name);
  }
  for (const id of pinned.keys()) problems.push(`${id} is pinned by the channel but not published`);
  if (JSON.stringify([...channel.launcherFiles].sort()) !== JSON.stringify([...launcherFiles].sort())) {
    problems.push('channel launcherFiles differs from the packed launcher');
  }
  return problems;
}

export function packRelease(out) {
  mkdirSync(out, { recursive: true });
  const scratch = mkdtempSync(join(out, '.inspect-'));
  const problems = [];
  const entries = [];
  let launcherPack = null;
  try {
    for (const { directory, manifest } of orderForPublish(readWorkspaces())) {
      const packed = packWorkspace(directory, out);
      const tarball = join(out, packed.filename);
      const inspected = inspectTarball(tarball, scratch);
      const paths = packed.files.map(({ path }) => path);
      problems.push(...checkManifestShape(inspected.manifest, paths).map((problem) => `${manifest.name}: ${problem}`));
      problems.push(...checkPackedTree(inspected.packageRoot, paths).map((finding) => `${manifest.name}: ${finding}`));
      entries.push({ name: manifest.name, version: manifest.version, directory, filename: packed.filename,
        integrity: packed.integrity, packedBytes: packed.size, unpackedBytes: packed.unpackedSize, fileCount: packed.entryCount });
      if (manifest.name === LAUNCHER) launcherPack = { root: inspected.packageRoot, paths };
    }
    if (!launcherPack) problems.push(`${LAUNCHER} is not in the release plan`);
    else problems.push(...assertChannelMatches(entries, launcherPack.root, launcherPack.paths));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (problems.length) throw new Error(`release pack rejected:\n  ${problems.join('\n  ')}`);
  writeFileSync(join(out, MANIFEST_FILE), `${JSON.stringify({ schemaVersion: 1, packages: entries }, null, 2)}\n`);
  return entries;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  if (!values.out) throw new Error('usage: pack-release.mjs --out <dir>');
  const entries = packRelease(resolve(values.out));
  const bytes = entries.reduce((sum, { packedBytes }) => sum + packedBytes, 0);
  console.log(`packed ${entries.length} packages, ${(bytes / 1024 / 1024).toFixed(1)} MiB; leak check clean`);
}
