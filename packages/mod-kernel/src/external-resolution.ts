import { AGON_MOD_API_VERSION, validateManifest, type ModPlatform } from '@kernlang/agon-mod-api';

import type { FirstPartySurfacePackage } from './activated-surface-generation.js';
import type { FolderModDiagnostic } from './folder-mod-diagnostics.js';
import type { FolderModCandidate } from './folder-mods.js';
import { resolveCandidates } from './resolver.js';
import { HOST_PROVIDED_DEPENDENCY_IDS } from './package-activation-order.js';

function hostPlatform(): ModPlatform {
  const value = `${process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(value)) throw new TypeError(`unsupported modular host platform: ${value}`);
  return value as ModPlatform;
}

function hostCapabilityManifest(id: string) {
  return validateManifest({
    schemaVersion: 2, id, name: id, version: '0.0.0-slice.8', apiRange: '>=1 <2', execution: 'declarative',
    compatibility: { kernelRange: '>=0.0.0-0 <2', nodeRange: '>=22' },
    packageClass: 'hidden-shared-support-package', display: { group: 'Host capabilities', order: 0 },
    dependencies: { required: [], optional: [], conflicts: [] }, permissions: [],
    platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'], assets: [],
    contributes: { cliCommands: [], tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [], resultTypes: [], configKeys: [], generatedDocs: [] },
    pack: { include: ['agon.mod.json'], executable: [] },
  });
}

function suppliedHostCapabilities(packages: readonly FirstPartySurfacePackage[]): readonly string[] {
  const packageIds = new Set(packages.map(({ manifest }) => manifest.id));
  const missing = [...new Set(packages.flatMap(({ manifest }) => manifest.dependencies.required.map(({ id }) => id)))]
    .filter((id) => !packageIds.has(id)).sort();
  const supported = new Set(HOST_PROVIDED_DEPENDENCY_IDS);
  const unknown = missing.filter((id) => !supported.has(id));
  if (unknown.length > 0) {
    throw new Error(`physical surface package dependency is not a frozen host capability: ${unknown.join(', ')}`);
  }
  return Object.freeze(missing);
}

/** Resolve every enabled external artifact with the exact active host set before any external import. */
export function resolveExternalFolderMods(options: {
  readonly candidates: readonly FolderModCandidate[];
  readonly hostPackages: readonly FirstPartySurfacePackage[];
  readonly kernelVersion: string;
}): readonly FolderModCandidate[] {
  const hostCapabilities = suppliedHostCapabilities(options.hostPackages);
  const graph = resolveCandidates([
    ...options.hostPackages.map(({ manifest, services }) => ({ manifest, source: 'bundled' as const, sourceLocator: `bundled:${manifest.id}`, contentHash: services.identity.contentHash })),
    ...hostCapabilities.map((id) => ({ manifest: hostCapabilityManifest(id), source: 'bundled' as const, sourceLocator: `host-capability:${id}` })),
    ...options.candidates,
  ], [...options.hostPackages.map(({ manifest }) => manifest.id), ...hostCapabilities, ...options.candidates.map(({ manifest }) => manifest.id)], {
    platform: hostPlatform(), kernelVersion: options.kernelVersion, apiVersion: AGON_MOD_API_VERSION, nodeVersion: process.versions.node,
    allowPrerelease: [...options.hostPackages.map(({ manifest }) => manifest.id), ...hostCapabilities],
  });
  const byIdentity = new Map(options.candidates.map((candidate) => [`${candidate.manifest.id}\0${candidate.manifest.version}\0${candidate.sourceLocator}`, candidate]));
  return Object.freeze(graph.selected.flatMap((selected) => {
    if (selected.source !== 'user-folder' && selected.source !== 'explicit-dev') return [];
    const candidate = byIdentity.get(`${selected.manifest.id}\0${selected.manifest.version}\0${selected.sourceLocator}`);
    if (!candidate) throw new Error(`resolved external candidate disappeared: ${selected.manifest.id}`);
    return [candidate];
  }));
}


export interface IsolatedExternalResolution {
  readonly candidates: readonly FolderModCandidate[];
  readonly diagnostics: readonly FolderModDiagnostic[];
}

/** Resolve independent external packages without letting one invalid graph suppress healthy siblings. */
export function resolveExternalFolderModsIsolated(options: {
  readonly candidates: readonly FolderModCandidate[];
  readonly hostPackages: readonly FirstPartySurfacePackage[];
  readonly kernelVersion: string;
}): IsolatedExternalResolution {
  let selected: readonly FolderModCandidate[] = Object.freeze([]);
  let pending = [...options.candidates].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  const lastErrors = new Map<string, unknown>();
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    const next: FolderModCandidate[] = [];
    for (const candidate of pending) {
      try {
        selected = resolveExternalFolderMods({ ...options, candidates: [...selected, candidate] });
        lastErrors.delete(candidate.manifest.id);
        progressed = true;
      } catch (error) {
        lastErrors.set(candidate.manifest.id, error);
        next.push(candidate);
      }
    }
    pending = next;
  }
  const diagnostics = pending.map((candidate): FolderModDiagnostic => Object.freeze({
    entry: candidate.sourceLocator,
    code: 'EXTERNAL_RESOLUTION_FAILED',
    message: `external mod did not resolve and remains blocked: ${candidate.manifest.id}`,
    details: Object.freeze({ modId: candidate.manifest.id, version: candidate.manifest.version,
      cause: String(lastErrors.get(candidate.manifest.id) ?? 'unresolved dependency graph') }),
  }));
  return Object.freeze({ candidates: Object.freeze([...selected]), diagnostics: Object.freeze(diagnostics) });
}
