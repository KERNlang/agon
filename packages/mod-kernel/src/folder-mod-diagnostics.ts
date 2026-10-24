import { readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import { StaticDiscoveryError } from './discovery.js';
import { FOLDER_MOD_LIMITS } from './folder-mod-bounds.js';
import { inspectFolderMod, type FolderModCandidate } from './folder-mods.js';
import { mapSettledBounded } from './bounded-work.js';

export interface FolderModDiagnostic {
  readonly entry: string;
  readonly code: 'INVALID_STATIC_MOD_PACKAGE' | 'EXTERNAL_AUTHORITY_FAILED' | 'EXTERNAL_RESOLUTION_FAILED' | 'EXTERNAL_ACTIVATION_FAILED';
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface FolderModDiscoveryResult {
  readonly candidates: readonly FolderModCandidate[];
  readonly diagnostics: readonly FolderModDiagnostic[];
}

function diagnostic(entry: string, error: unknown): FolderModDiagnostic {
  const source = error instanceof StaticDiscoveryError ? error : new StaticDiscoveryError('folder mod inspection failed', { cause: String(error) });
  return Object.freeze({ entry, code: source.code, message: source.message, details: source.details });
}

/** Inspect packages independently so one hostile or broken sibling cannot disable management or healthy mods. */
export async function discoverUserFolderModsDetailed(modsRoot: string): Promise<FolderModDiscoveryResult> {
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(modsRoot); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze({ candidates: Object.freeze([]), diagnostics: Object.freeze([]) });
    throw error;
  }
  const entries = await readdir(canonicalRoot, { withFileTypes: true });
  if (entries.length > FOLDER_MOD_LIMITS.maxPackages) {
    throw new StaticDiscoveryError('user mods folder exceeds the package-count limit', { maxPackages: FOLDER_MOD_LIMITS.maxPackages });
  }
  const sorted = entries.sort((left, right) => left.name.localeCompare(right.name));
  const inspected = await mapSettledBounded(sorted, FOLDER_MOD_LIMITS.maxConcurrentInspections, async (entry) => {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new StaticDiscoveryError('user mods folder entry must be a real package directory', { entry: entry.name });
    const candidate = await inspectFolderMod(join(canonicalRoot, entry.name), 'user-folder');
    const fromRoot = relative(canonicalRoot, candidate.packageRoot);
    if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new StaticDiscoveryError('folder mod escaped the user mods root', { entry: entry.name });
    return candidate;
  });
  const candidates: FolderModCandidate[] = [];
  const diagnostics: FolderModDiagnostic[] = [];
  inspected.forEach((result, index) => {
    if (result.status === 'fulfilled') candidates.push(result.value);
    else diagnostics.push(diagnostic(sorted[index]!.name, result.reason));
  });
  const byIdentity = new Map<string, FolderModCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.manifest.id;
    const values = byIdentity.get(key) ?? [];
    values.push(candidate);
    byIdentity.set(key, values);
  }
  const duplicateRoots = new Set<string>();
  for (const [identity, values] of byIdentity) {
    if (values.length < 2) continue;
    for (const value of values) {
      duplicateRoots.add(value.packageRoot);
      diagnostics.push(Object.freeze({ entry: relative(canonicalRoot, value.packageRoot), code: 'INVALID_STATIC_MOD_PACKAGE', message: 'duplicate folder mod identity', details: { identity } }));
    }
  }
  return Object.freeze({
    candidates: Object.freeze(candidates.filter(({ packageRoot }) => !duplicateRoots.has(packageRoot))),
    diagnostics: Object.freeze(diagnostics),
  });
}
