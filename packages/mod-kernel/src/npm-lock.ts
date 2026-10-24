import { posix } from 'node:path';
import { satisfies, valid } from 'semver';

/** npm metadata is retained so platform, peer and engine constraints survive. */
export interface NpmLockRecord {
  readonly [key: string]: unknown;
  readonly name?: string;
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
  readonly link?: boolean;
  readonly optional?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

export interface FrozenNpmCatalog {
  readonly schemaVersion: 1;
  readonly packages: Readonly<Record<string, NpmLockRecord>>;
}

export interface FrozenNpmArtifact {
  readonly version: string;
  readonly resolved: string;
  readonly integrity?: string;
}

const PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
function assertName(name: string): void {
  if (!PACKAGE_NAME.test(name) || name.split('/').some(part => ['.', '..', '__proto__', 'constructor', 'prototype'].includes(part))) {
    throw new TypeError(`invalid npm package name: ${name}`);
  }
}

function isRelativeLocation(path: string): boolean {
  return !/[\\\0\r\n:]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
}

function assertFrozenLocation(path: string): void {
  const parts = path.split('/');
  if (!isRelativeLocation(path)) throw new TypeError(`invalid frozen npm path: ${path}`);
  for (let index = 0; index < parts.length;) {
    if (parts[index++] !== 'node_modules' || !parts[index]) throw new TypeError(`invalid frozen npm path: ${path}`);
    const name = parts[index++]!;
    try {
      assertName(name.startsWith('@') ? `${name}/${parts[index++] ?? ''}` : name);
    } catch {
      throw new TypeError(`invalid frozen npm path: ${path}`);
    }
  }
}

function findDependency(packages: Readonly<Record<string, NpmLockRecord>>, from: string, name: string): string | undefined {
  assertName(name);
  let parent = from;
  while (true) {
    const candidate = `${parent ? `${parent}/` : ''}node_modules/${name}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
    if (!parent) return undefined;
    const next = posix.dirname(parent);
    if (next === parent) return undefined;
    parent = next;
    if (parent === '.') parent = '';
  }
}

function closure(packages: Readonly<Record<string, NpmLockRecord>>, roots: readonly string[], includeOptional: boolean) {
  const visited = new Set<string>();
  const bindings: Array<{ from: string; name: string; target: string }> = [];
  function visit(path: string): void {
    if (visited.has(path)) return;
    const entry = packages[path];
    if (!entry) throw new TypeError(`npm lock record is missing: ${path}`);
    visited.add(path);
    if (entry.link) {
      if (!entry.resolved) throw new TypeError(`npm workspace target is missing: ${path}`);
      visit(entry.resolved);
      return;
    }
    if (typeof entry.version !== 'string' || !valid(entry.version)) throw new TypeError(`npm version is not exact: ${path}`);
    // npm loads peers first, then ordinary dependencies, then optional ones.
    const dependencies = { ...entry.peerDependencies, ...entry.dependencies, ...(includeOptional ? entry.optionalDependencies : {}) };
    for (const [name, range] of Object.entries(dependencies)) {
      if (!includeOptional && Object.hasOwn(entry.optionalDependencies ?? {}, name)) continue;
      if (entry.peerDependenciesMeta?.[name]?.optional && !Object.hasOwn(entry.dependencies ?? {}, name)
        && !Object.hasOwn(entry.optionalDependencies ?? {}, name)) continue;
      const target = findDependency(packages, path, name);
      if (!target) throw new TypeError(`npm dependency is not locked: ${path} -> ${name}`);
      const candidate = packages[target]!;
      const version = candidate.link ? packages[candidate.resolved ?? '']?.version : candidate.version;
      if (typeof range !== 'string' || !version || !satisfies(version, range)) {
        throw new TypeError(`npm dependency range does not match: ${path} -> ${name}`);
      }
      bindings.push({ from: path, name, target });
      visit(target);
    }
  }
  for (const root of [...roots].sort()) visit(root);
  return { paths: visited, bindings };
}

/** Translate source workspace locations; never choose a new dependency version. */
export function createNpmReleaseCatalog(
  source: { readonly lockfileVersion: number; readonly packages: Readonly<Record<string, NpmLockRecord>> },
  roots: readonly string[],
): FrozenNpmCatalog {
  if (source.lockfileVersion !== 3) throw new TypeError('npm source lock must use version 3');
  const locations = new Map<string, string>();
  for (const [path, entry] of Object.entries(source.packages)) {
    if (!entry.link) continue;
    if (!path.startsWith('node_modules/') || !entry.resolved || !isRelativeLocation(entry.resolved) || !source.packages[entry.resolved]) {
      throw new TypeError(`npm workspace link is invalid: ${path}`);
    }
    const name = path.slice('node_modules/'.length);
    assertName(name);
    if (locations.has(entry.resolved)) throw new TypeError(`duplicate npm workspace target: ${entry.resolved}`);
    locations.set(entry.resolved, path);
  }
  const relocate = (path: string): string => {
    if (path.startsWith('node_modules/')) return path;
    for (const [workspace, target] of locations) {
      if (path === workspace || path.startsWith(`${workspace}/node_modules/`)) return target + path.slice(workspace.length);
    }
    throw new TypeError(`npm package cannot be relocated: ${path}`);
  };
  const packages: Record<string, NpmLockRecord> = {};
  const sourceClosure = closure(source.packages, roots, true);
  for (const path of [...sourceClosure.paths].sort()) {
    const original = source.packages[path]!;
    if (original.link) continue;
    const entry = { ...structuredClone(original) };
    for (const key of ['dev', 'devOptional', 'devDependencies', 'optional', 'workspaces']) delete entry[key];
    const target = relocate(path);
    if (Object.hasOwn(packages, target)) throw new TypeError(`npm relocation collision: ${target}`);
    packages[target] = entry;
  }
  const ordered = Object.fromEntries(Object.entries(packages).sort(([a], [b]) => a.localeCompare(b)));
  // Semver compatibility alone cannot prove the same package was selected.
  for (const { from, name, target } of sourceClosure.bindings) {
    if (findDependency(ordered, relocate(from), name) !== relocate(target)) {
      throw new TypeError(`npm dependency binding changed during relocation: ${from} -> ${name}`);
    }
  }
  closure(ordered, roots.map(relocate), true);
  return { schemaVersion: 1, packages: ordered };
}

/** Build one immutable npm-ci input for the selected physical package closure. */
export function createFrozenNpmInstall(
  catalog: FrozenNpmCatalog,
  selectedNames: readonly string[],
  artifacts: Readonly<Record<string, FrozenNpmArtifact>>,
) {
  if (catalog.schemaVersion !== 1 || !selectedNames.length || new Set(selectedNames).size !== selectedNames.length) {
    throw new TypeError('frozen npm selection is malformed');
  }
  const packages: Record<string, NpmLockRecord> = structuredClone(catalog.packages);
  for (const [name, artifact] of Object.entries(artifacts)) {
    assertName(name);
    const path = `node_modules/${name}`;
    if (!packages[path] || packages[path].version !== artifact.version) throw new TypeError(`npm artifact version differs from lock: ${name}`);
    if (!artifact.resolved || /[\0\r\n]/.test(artifact.resolved)) throw new TypeError(`npm artifact locator is invalid: ${name}`);
    const entry = { ...packages[path], resolved: artifact.resolved };
    delete entry.integrity;
    if (artifact.integrity) entry.integrity = artifact.integrity;
    packages[path] = entry;
  }
  const roots = selectedNames.map(name => { assertName(name); return `node_modules/${name}`; });
  const required = closure(packages, roots, false).paths;
  const dependencies: Record<string, string> = {};
  for (const path of Object.keys(packages).sort()) {
    const entry = packages[path]!;
    assertFrozenLocation(path);
    if (entry.link) throw new TypeError(`invalid frozen npm path: ${path}`);
    if (!entry.resolved || (!entry.integrity && !Object.hasOwn(artifacts, path.slice('node_modules/'.length)))) {
      throw new TypeError(`npm artifact has no frozen source: ${path}`);
    }
    if (entry.integrity) {
      const digest = entry.integrity.slice('sha512-'.length);
      const decoded = Buffer.from(digest, 'base64');
      if (!entry.integrity.startsWith('sha512-') || decoded.length !== 64 || decoded.toString('base64') !== digest) {
        throw new TypeError(`invalid npm integrity: ${path}`);
      }
    }
    const selected = required.has(path);
    packages[path] = { ...entry, optional: !selected };
    const name = path.slice('node_modules/'.length);
    if (selected && (selectedNames.includes(name) || Object.hasOwn(artifacts, name))) dependencies[name] = entry.resolved;
  }
  const manifest = { name: 'agon-managed-candidate', version: '1.0.0', private: true, dependencies };
  return {
    manifest,
    lock: { name: manifest.name, version: manifest.version, lockfileVersion: 3 as const, requires: true,
      packages: { '': manifest, ...packages } },
    requiredPaths: [...required].sort(),
  };
}
