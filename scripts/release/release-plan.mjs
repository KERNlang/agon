import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');
export const LAUNCHER = '@kernlang/agon';
export const INDEPENDENT_PACKAGES = new Set(['@kernlang/agon-engines']);

const RUNTIME_BUCKETS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

export function readWorkspaces(root = REPO_ROOT) {
  const { workspaces } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return workspaces.map((directory) => ({
    directory,
    manifest: JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8')),
  }));
}

export function isFamilyPackage(name) {
  return name.startsWith('@kernlang/agon') && !INDEPENDENT_PACKAGES.has(name);
}

function runtimeFamilyDependencies(manifest) {
  return RUNTIME_BUCKETS.flatMap((bucket) => Object.keys(manifest[bucket] ?? {})).filter(isFamilyPackage);
}

export function orderForPublish(workspaces) {
  const candidates = new Map(workspaces.filter(({ manifest }) => manifest.private !== true)
    .map((workspace) => [workspace.manifest.name, workspace]));
  const known = new Map(workspaces.map(({ manifest }) => [manifest.name, manifest]));
  const ordered = [];
  const state = new Map();
  const visit = (name, path) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'active') throw new Error(`release dependency cycle: ${[...path, name].join(' -> ')}`);
    state.set(name, 'active');
    const { manifest } = candidates.get(name);
    for (const dependency of runtimeFamilyDependencies(manifest).sort()) {
      if (!candidates.has(dependency)) {
        const reason = known.get(dependency)?.private ? 'is private' : 'is not a workspace package';
        throw new Error(`${name} depends on ${dependency}, which ${reason}, so a registry install could never resolve it`);
      }
      visit(dependency, [...path, name]);
    }
    state.set(name, 'done');
    ordered.push(candidates.get(name));
  };
  for (const name of [...candidates.keys()].sort()) if (name !== LAUNCHER) visit(name, []);
  if (candidates.has(LAUNCHER)) visit(LAUNCHER, []);
  return ordered;
}
