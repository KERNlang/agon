import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ModManifest } from '@kernlang/agon-mod-api';
import { inspectStaticManifest, StaticDiscoveryError, type StaticManifestInspection } from './discovery.js';
import { readBoundedPackageFile, walkBoundedPackage, type BoundedPackageFile } from './folder-mod-bounds.js';
import { FOLDER_MOD_LIMITS } from './folder-mod-limits.js';
import { mapSettledBounded } from './bounded-work.js';

export interface FolderModCandidate {
  readonly packageRoot: string;
  readonly manifest: ModManifest;
  readonly manifestHash: `sha256:${string}`;
  readonly contentHash: `sha256:${string}`;
  readonly source: 'user-folder' | 'explicit-dev';
  readonly sourceLocator: string;
  readonly inspection: StaticManifestInspection;
}

function portablePathKey(path: string): string {
  return path.split('/').filter((segment) => segment !== '.').join('/').normalize('NFC').toLowerCase();
}

const ALLOWED_METADATA = new Set(['agon.mod.json', 'package.json', 'README.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt']);

async function hashDeclaredTree(root: string, files: readonly BoundedPackageFile[], declaredPaths: readonly string[]): Promise<`sha256:${string}`> {
  const digest = createHash('sha256');
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const path of [...declaredPaths].sort()) {
    const file = byPath.get(path);
    if (!file) throw new StaticDiscoveryError('declared package path is not a regular file', { path });
    digest.update(path).update('\0').update(await readBoundedPackageFile(root, file)).update('\0');
  }
  return `sha256:${digest.digest('hex')}`;
}

export async function inspectFolderMod(packageRoot: string, source: FolderModCandidate['source'] = 'user-folder'): Promise<FolderModCandidate> {
  const rootStat = await lstat(packageRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new StaticDiscoveryError('folder mod root must be a real directory');
  const canonicalRoot = await realpath(packageRoot);
  const inspection = await inspectStaticManifest(canonicalRoot);
  const packageFiles = await walkBoundedPackage(canonicalRoot);
  const actualFiles = packageFiles.map(({ path }) => path);
  const portablePaths = actualFiles.map(portablePathKey);
  if (new Set(portablePaths).size !== portablePaths.length) {
    throw new StaticDiscoveryError('folder mod contains a portable path collision');
  }
  if (inspection.manifest.execution === 'executable' && actualFiles.includes('package.json') && !inspection.manifest.pack.include.includes('package.json')) throw new StaticDiscoveryError('executable package.json must be declared and hash-bound');
  const declared = new Set(inspection.manifest.pack.include);
  const undeclared = actualFiles.filter((path) => !declared.has(path) && !ALLOWED_METADATA.has(path));
  if (undeclared.length) throw new StaticDiscoveryError('folder mod contains undeclared files', { undeclared: undeclared.sort() });
  const missing = [...declared].filter((path) => !actualFiles.includes(path));
  if (missing.length) throw new StaticDiscoveryError('folder mod is missing declared files', { missing: missing.sort() });
  return Object.freeze({
    packageRoot: canonicalRoot, manifest: inspection.manifest, manifestHash: inspection.manifestHash,
    contentHash: await hashDeclaredTree(canonicalRoot, packageFiles, [...declared]), source, sourceLocator: canonicalRoot, inspection,
  });
}

export async function discoverUserFolderMods(modsRoot: string): Promise<readonly FolderModCandidate[]> {
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(modsRoot); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze([]);
    throw error;
  }
  const entries = await readdir(canonicalRoot, { withFileTypes: true });
  if (entries.length > FOLDER_MOD_LIMITS.maxPackages) throw new StaticDiscoveryError('user mods folder exceeds the package-count limit', { maxPackages: FOLDER_MOD_LIMITS.maxPackages });
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
  const inspected = await mapSettledBounded(sorted, FOLDER_MOD_LIMITS.maxConcurrentInspections, async (entry) => {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new StaticDiscoveryError('user mods folder may contain only real package directories', { entry: entry.name });
    const candidate = await inspectFolderMod(join(canonicalRoot, entry.name), 'user-folder');
    const fromRoot = relative(canonicalRoot, candidate.packageRoot);
    if (!fromRoot || fromRoot.startsWith('..')) throw new StaticDiscoveryError('folder mod escaped the user mods root', { entry: entry.name });
    return candidate;
  });
  const firstFailure = inspected.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
  if (firstFailure) throw firstFailure.reason;
  const output = inspected.map((result) => (result as PromiseFulfilledResult<FolderModCandidate>).value);
  const identities = new Set<string>();
  for (const candidate of output) {
    const key = candidate.manifest.id;
    if (identities.has(key)) throw new StaticDiscoveryError('duplicate folder mod identity', { id: candidate.manifest.id, version: candidate.manifest.version });
    identities.add(key);
  }
  return Object.freeze(output);
}
