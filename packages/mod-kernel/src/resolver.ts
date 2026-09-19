import { prerelease, rcompare, satisfies, lt, valid } from 'semver';
import { validateManifest } from '@kernlang/agon-mod-api';
import { ImmutableMap } from './readonly-map.js';
import type { ModManifest, ModPlatform, ModSource } from '@kernlang/agon-mod-api';

export const SOURCE_PRECEDENCE: Readonly<Record<ModSource, number>> = Object.freeze({
  bundled: 0,
  registry: 1,
  'user-folder': 2,
  'explicit-dev': 3,
});

export type ResolutionFailureCode =
  | 'not-installed'
  | 'incompatible-agon'
  | 'incompatible-mod-api'
  | 'missing-dependency'
  | 'integrity-mismatch'
  | 'dependency-cycle'
  | 'conflict'
  | 'collision'
  | 'reserved-first-party-id'
  | 'untrusted-source'
  | 'unsupported-platform'
  | 'no-eligible-version'
  | 'unsatisfiable-version-ranges'
  | 'resolution-budget-exceeded'
  | 'downgrade-not-approved';

export class ModResolutionError extends Error {
  constructor(
    readonly code: ResolutionFailureCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ModResolutionError';
  }
}

export interface ModCandidate {
  readonly manifest: ModManifest;
  readonly source: ModSource;
  readonly sourceLocator: string;
  readonly publisherIdentity?: string;
  readonly provenanceVerified?: boolean;
  readonly explicitlySelected?: boolean;
  readonly yanked?: boolean;
  readonly contentHash?: `sha256:${string}`;
  readonly manifestHash?: `sha256:${string}`;
}

const NORMALIZED_CANDIDATE = Symbol('agon.normalized-mod-candidate');
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export type NormalizedModCandidate = ModCandidate & { readonly [NORMALIZED_CANDIDATE]: true };
export function normalizeCandidates(candidates: readonly ModCandidate[]): readonly NormalizedModCandidate[] {
  return Object.freeze(candidates.map((candidate) => {
    if (NORMALIZED_CANDIDATE in candidate) return candidate as NormalizedModCandidate;
    if (!candidate.sourceLocator || candidate.sourceLocator.trim() === '') {
      throw new ModResolutionError('untrusted-source', 'candidate source locator must be non-empty');
    }
    for (const [field, hash] of [['contentHash', candidate.contentHash], ['manifestHash', candidate.manifestHash]] as const) {
      if (hash !== undefined && !SHA256.test(hash)) {
        throw new ModResolutionError('integrity-mismatch', `candidate ${field} must be a canonical SHA-256 hash`, { field, hash });
      }
    }
    return Object.freeze({ ...candidate, manifest: validateManifest(candidate.manifest), [NORMALIZED_CANDIDATE]: true }) as NormalizedModCandidate;
  }));
}

export interface ResolveOptions {
  readonly platform?: ModPlatform;
  readonly kernelVersion?: string;
  readonly apiVersion?: string;
  readonly nodeVersion?: string;
  readonly frozenVersions?: Readonly<Record<string, string>>;
  readonly requestedVersions?: Readonly<Record<string, string>>;
  readonly currentVersions?: Readonly<Record<string, string>>;
  readonly allowPrerelease?: boolean | readonly string[];
  readonly allowDowngrade?: boolean | readonly string[];
}

export interface RejectedCandidate {
  readonly id: string;
  readonly version: string;
  readonly source: ModSource;
  readonly sourceLocator: string;
  readonly reason: ResolutionFailureCode;
}

export interface ShadowedCandidate {
  readonly id: string;
  readonly version: string;
  readonly source: ModSource;
  readonly sourceLocator: string;
}

export interface ResolvedModGraph {
  readonly resolutionContext: Readonly<{
    readonly platform: ModPlatform | undefined;
    readonly kernelVersion: string | undefined;
    readonly apiVersion: string | undefined;
    readonly nodeVersion: string | undefined;
  }>;
  readonly order: readonly string[];
  readonly selected: readonly ModCandidate[];
  readonly selectedById: ReadonlyMap<string, ModCandidate>;
  readonly reverseDependencies: ReadonlyMap<string, readonly string[]>;
  readonly optionalIntegrations: readonly { readonly owner: string; readonly dependency: string }[];
  readonly shadowed: readonly ShadowedCandidate[];
  readonly rejected: readonly RejectedCandidate[];
}

function exactPrereleaseVersion(range: string): string | undefined {
  const normalized = range.trim().replace(/^=\s*/, '');
  return valid(normalized) && prerelease(normalized) ? normalized : undefined;
}

function isAllowed(value: boolean | readonly string[] | undefined, id: string): boolean {
  return value === true || Array.isArray(value) && value.includes(id);
}


function assertHostVersion(label: string, version: string | undefined, code: ResolutionFailureCode): void {
  if (version !== undefined && !valid(version)) {
    throw new ModResolutionError(code, `invalid ${label} version: ${version}`, { label, version });
  }
}
function assertOptionVersions(label: string, versions: Readonly<Record<string, string>> | undefined): void {
  for (const [id, version] of Object.entries(versions ?? {})) {
    if (!valid(version)) {
      throw new ModResolutionError('no-eligible-version', 'invalid ' + label + ' version for ' + id + ': ' + version, {
        id, label, version,
      });
    }
  }
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareLocator(left: ModCandidate, right: ModCandidate): number {
  return compareAscii(left.sourceLocator, right.sourceLocator);
}

function assertCandidateCompatibility(candidate: ModCandidate, options: ResolveOptions): void {
  const { manifest } = candidate;
  if (options.platform && !manifest.platforms.includes(options.platform)) {
    throw new ModResolutionError('unsupported-platform', `${manifest.id}@${manifest.version} does not support ${options.platform}`, { id: manifest.id, platform: options.platform });
  }
  if (options.kernelVersion && !satisfies(options.kernelVersion, manifest.compatibility.kernelRange)) {
    throw new ModResolutionError('incompatible-agon', `${manifest.id}@${manifest.version} is incompatible with kernel ${options.kernelVersion}`, { id: manifest.id });
  }
  if (options.apiVersion && !satisfies(options.apiVersion, manifest.apiRange)) {
    throw new ModResolutionError('incompatible-mod-api', `${manifest.id}@${manifest.version} is incompatible with Mod API ${options.apiVersion}`, { id: manifest.id });
  }
  if (options.nodeVersion && !satisfies(options.nodeVersion, manifest.compatibility.nodeRange)) {
    throw new ModResolutionError('incompatible-agon', `${manifest.id}@${manifest.version} is incompatible with Node ${options.nodeVersion}`, { id: manifest.id });
  }
}

function cyclePath(selected: ReadonlyMap<string, ModCandidate>, desired: ReadonlySet<string>): readonly string[] | undefined {
  const state = new Map<string, 0 | 1 | 2>();
  for (const id of [...desired].sort()) {
    if (state.get(id) === 2) continue;
    const frames: Array<{ id: string; dependencies: readonly { id: string }[]; next: number }> = [{
      id, dependencies: selected.get(id)?.manifest.dependencies.required ?? [], next: 0,
    }];
    const activeIndex = new Map<string, number>([[id, 0]]);
    state.set(id, 1);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      if (frame.next >= frame.dependencies.length) {
        state.set(frame.id, 2);
        activeIndex.delete(frame.id);
        frames.pop();
        continue;
      }
      const dependency = frame.dependencies[frame.next++]!;
      if (!desired.has(dependency.id) || state.get(dependency.id) === 2) continue;
      const cycleStart = activeIndex.get(dependency.id);
      if (cycleStart !== undefined) return [...frames.slice(cycleStart).map(({ id: frameId }) => frameId), dependency.id];
      state.set(dependency.id, 1);
      activeIndex.set(dependency.id, frames.length);
      frames.push({
        id: dependency.id,
        dependencies: selected.get(dependency.id)?.manifest.dependencies.required ?? [],
        next: 0,
      });
    }
  }
  return undefined;
}

export function resolveCandidates(
  candidates: readonly ModCandidate[],
  desiredIds: readonly string[],
  options: ResolveOptions = {},
): ResolvedModGraph {
  const normalizedCandidates = normalizeCandidates(candidates);
  const desiredList = [...desiredIds];
  if (new Set(desiredList).size !== desiredList.length) {
    throw new ModResolutionError('collision', 'desired mod IDs must be unique');
  }
  const desired = new Set(desiredList);
  assertHostVersion('kernel', options.kernelVersion, 'incompatible-agon');
  assertHostVersion('Mod API', options.apiVersion, 'incompatible-mod-api');
  assertHostVersion('Node', options.nodeVersion, 'incompatible-agon');
  assertOptionVersions('frozen', options.frozenVersions);
  assertOptionVersions('requested', options.requestedVersions);
  assertOptionVersions('current', options.currentVersions);
  const exactPrereleasePins = new Set(normalizedCandidates
    .filter(({ manifest }) => desired.has(manifest.id))
    .flatMap(({ manifest }) => manifest.dependencies.required
    .flatMap(({ id, range }) => {
      const version = exactPrereleaseVersion(range);
      return version ? [id + '\0' + version] : [];
    })));
  const groups = new Map<string, ModCandidate[]>();
  const rejected: RejectedCandidate[] = [];
  for (const candidate of normalizedCandidates) {
    if (!Object.hasOwn(SOURCE_PRECEDENCE, candidate.source)) {
      throw new ModResolutionError('untrusted-source', 'unknown candidate source', { source: candidate.source });
    }
    const { id, version } = candidate.manifest;
    if (id.startsWith('agon.')) {
      const permitted = candidate.source === 'bundled'
        || candidate.source === 'registry'
          && candidate.publisherIdentity === 'kernlang:first-party-release-set'
          && candidate.provenanceVerified === true
        || candidate.source === 'explicit-dev' && candidate.explicitlySelected === true;
      if (!permitted) {
        rejected.push(Object.freeze({ id, version, source: candidate.source, sourceLocator: candidate.sourceLocator, reason: 'reserved-first-party-id' }));
        continue;
      }
    }
    const group = groups.get(id) ?? [];
    group.push(candidate);
    groups.set(id, group);
  }

  const candidateSets = new Map<string, ModCandidate[]>();
  const shadowed: ShadowedCandidate[] = [];
  for (const [id, group] of groups) {
    const ranked = [...group].sort((left, right) => SOURCE_PRECEDENCE[right.source] - SOURCE_PRECEDENCE[left.source] || compareLocator(left, right));
    const topRank = SOURCE_PRECEDENCE[ranked[0]!.source];
    const top = ranked.filter((candidate) => SOURCE_PRECEDENCE[candidate.source] === topRank);
    const topSet = new Set(top);
    const seenVersion = new Set<string>();
    for (const candidate of top) {
      const version = candidate.manifest.version;
      if (seenVersion.has(version)) {
        throw new ModResolutionError("collision", "same-precedence collision: " + id + "@" + version, { id, version, source: candidate.source });
      }
      seenVersion.add(version);
    }
    if (!desired.has(id)) continue;
    const frozenVersion = options.frozenVersions?.[id];
    const requestedVersion = options.requestedVersions?.[id];
    const currentVersion = options.currentVersions?.[id];
    let compatibilityFailure: ModResolutionError | undefined;
    const eligible = top.filter((candidate) => {
      const version = candidate.manifest.version;
      if (requestedVersion && requestedVersion !== version) return false;
      if (candidate.yanked && frozenVersion !== version) return false;
      if (prerelease(version) && frozenVersion !== version && requestedVersion !== version && !exactPrereleasePins.has(id + '\0' + version) && !isAllowed(options.allowPrerelease, id)) return false;
      if (currentVersion && lt(version, currentVersion) && frozenVersion !== version && !isAllowed(options.allowDowngrade, id)) return false;
      try {
        assertCandidateCompatibility(candidate, options);
      } catch (error) {
        if (error instanceof ModResolutionError) {
          compatibilityFailure ??= error;
          return false;
        }
        throw error;
      }
      return true;
    }).sort((left, right) => rcompare(left.manifest.version, right.manifest.version) || compareLocator(left, right));
    if (eligible.length === 0) {
      if (compatibilityFailure) throw compatibilityFailure;
      const code = currentVersion && top.some(({ manifest }) => lt(manifest.version, currentVersion))
        ? 'downgrade-not-approved'
        : 'no-eligible-version';
      throw new ModResolutionError(code, `no eligible version: ${id}`, { id, frozenVersion, requestedVersion });
    }
    candidateSets.set(id, eligible);
    for (const candidate of ranked) {
      if (!topSet.has(candidate)) shadowed.push(Object.freeze({ id, version: candidate.manifest.version, source: candidate.source, sourceLocator: candidate.sourceLocator }));
    }
  }

  for (const id of desired) {
    if (!candidateSets.has(id)) {
      const reserved = rejected.find((entry) => entry.id === id && entry.reason === 'reserved-first-party-id');
      if (reserved) throw new ModResolutionError('reserved-first-party-id', 'reserved first-party ID rejected: ' + id, { id, rejected: reserved });
      throw new ModResolutionError('not-installed', 'missing desired mod: ' + id, { id });
    }
  }

  const ids = [...desired].sort();
  const selected = new Map<string, ModCandidate>();
  let assignmentFailure: ModResolutionError | undefined;
  const validatePartialAssignment = (id: string, candidate: ModCandidate): boolean => {
    for (const conflict of candidate.manifest.dependencies.conflicts) {
      if (desired.has(conflict)) {
        assignmentFailure = new ModResolutionError('conflict', 'conflict: ' + id + ' conflicts with ' + conflict, { id, conflict });
        return false;
      }
    }
    for (const dependency of candidate.manifest.dependencies.required) {
      if (!desired.has(dependency.id)) {
        assignmentFailure = new ModResolutionError('missing-dependency', 'disabled dependency: ' + id + ' requires ' + dependency.id, { id, dependency: dependency.id });
        return false;
      }
      const selectedDependency = selected.get(dependency.id);
      const possible = selectedDependency
        ? satisfies(selectedDependency.manifest.version, dependency.range, { includePrerelease: true })
        : candidateSets.get(dependency.id)!.some((entry) => satisfies(entry.manifest.version, dependency.range, { includePrerelease: true }));
      if (!possible) {
        assignmentFailure = new ModResolutionError('unsatisfiable-version-ranges', 'version range is not satisfiable: ' + id + ' requires ' + dependency.id + ' ' + dependency.range, { id, dependency: dependency.id, range: dependency.range });
        return false;
      }
    }
    for (const [ownerId, owner] of selected) {
      if (ownerId === id) continue;
      for (const dependency of owner.manifest.dependencies.required) {
        if (dependency.id === id && !satisfies(candidate.manifest.version, dependency.range, { includePrerelease: true })) {
          assignmentFailure = new ModResolutionError('unsatisfiable-version-ranges', 'version range is not satisfied: ' + ownerId + ' requires ' + id + ' ' + dependency.range, { id: ownerId, dependency: id, range: dependency.range });
          return false;
        }
      }
    }
    return true;
  };

  const selectedPrereleaseAuthorityFailure = (): ModResolutionError | undefined => {
    for (const [id, candidate] of selected) {
      const version = candidate.manifest.version;
      if (!prerelease(version)) continue;
      const explicit = options.frozenVersions?.[id] === version
        || options.requestedVersions?.[id] === version
        || isAllowed(options.allowPrerelease, id);
      const pinnedBySelectedOwner = [...selected.values()].some((owner) => owner.manifest.dependencies.required.some(
        (dependency) => dependency.id === id && exactPrereleaseVersion(dependency.range) === version,
      ));
      if (!explicit && !pinnedBySelectedOwner) {
        return new ModResolutionError('no-eligible-version', `selected prerelease lacks authority: ${id}@${version}`, { id, version });
      }
    }
    return undefined;
  };

  const nextCandidate = new Array<number>(ids.length).fill(0);
  let index = 0;
  let attempts = 0;
  const maxAttempts = 100_000;
  while (index >= 0) {
    if (index === ids.length) {
      const authorityFailure = selectedPrereleaseAuthorityFailure();
      if (!authorityFailure) break;
      assignmentFailure = authorityFailure;
      index -= 1;
      selected.delete(ids[index]!);
      continue;
    }
    const id = ids[index]!;
    const candidatesForId = candidateSets.get(id)!;
    const frozenVersion = options.frozenVersions?.[id];
    selected.delete(id);
    let advanced = false;
    while (nextCandidate[index]! < candidatesForId.length) {
      if (++attempts > maxAttempts) {
        throw new ModResolutionError('resolution-budget-exceeded', 'resolution search exceeded deterministic attempt budget', { attempts: maxAttempts, desired: ids.length });
      }
      const candidate = candidatesForId[nextCandidate[index]!]!;
      nextCandidate[index]! += 1;
      if (frozenVersion && candidate.manifest.version !== frozenVersion) continue;
      selected.set(id, candidate);
      if (validatePartialAssignment(id, candidate)) {
        index += 1;
        if (index < ids.length) nextCandidate[index] = 0;
        advanced = true;
        break;
      }
      selected.delete(id);
    }
    if (!advanced) {
      nextCandidate[index] = 0;
      selected.delete(id);
      index -= 1;
      if (index >= 0) selected.delete(ids[index]!);
    }
  }
  if (index < 0) throw assignmentFailure ?? new ModResolutionError('unsatisfiable-version-ranges', 'unsatisfiable version ranges');

  const cycle = cyclePath(selected, desired);
  if (cycle) throw new ModResolutionError('dependency-cycle', `dependency cycle: ${cycle.join(' -> ')}`, { cycle });
  const indegree = new Map([...desired].map((id) => [id, 0]));
  const outgoing = new Map([...desired].map((id) => [id, [] as string[]]));
  const reverseDependencies = new Map([...desired].map((id) => [id, [] as string[]]));
  const optionalIntegrations: { owner: string; dependency: string }[] = [];
  for (const id of desired) {
    const manifest = selected.get(id)!.manifest;
    for (const dependency of manifest.dependencies.required) {
      indegree.set(id, indegree.get(id)! + 1);
      outgoing.get(dependency.id)!.push(id);
      reverseDependencies.get(dependency.id)!.push(id);
    }
    for (const dependency of manifest.dependencies.optional) {
      const selectedDependency = selected.get(dependency.id);
      if (selectedDependency && satisfies(selectedDependency.manifest.version, dependency.range, { includePrerelease: true })) {
        optionalIntegrations.push(Object.freeze({ owner: id, dependency: dependency.id }));
      }
    }
  }
  const ready = [...desired].filter((id) => indegree.get(id) === 0).sort();
  const enqueued = new Set(ready);
  const emitted = new Set<string>();
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    enqueued.delete(id);
    if (emitted.has(id)) continue;
    emitted.add(id);
    order.push(id);
    for (const child of outgoing.get(id)!.sort()) {
      indegree.set(child, indegree.get(child)! - 1);
      if (indegree.get(child) === 0 && !enqueued.has(child) && !emitted.has(child)) {
        ready.push(child);
        enqueued.add(child);
        ready.sort();
      }
    }
  }
  if (order.length !== desired.size) {
    throw new ModResolutionError('dependency-cycle', 'topological resolution did not emit every desired mod', { expected: desired.size, actual: order.length });
  }
  return Object.freeze({
    resolutionContext: Object.freeze({
      platform: options.platform,
      kernelVersion: options.kernelVersion,
      apiVersion: options.apiVersion,
      nodeVersion: options.nodeVersion,
    }),
    order: Object.freeze(order),
    selected: Object.freeze(order.map((id) => selected.get(id)!)),
    selectedById: new ImmutableMap(selected),
    reverseDependencies: new ImmutableMap([...reverseDependencies].map(([id, dependents]) => [id, Object.freeze(dependents.sort())])),
    optionalIntegrations: Object.freeze(optionalIntegrations.sort((left, right) => compareAscii(left.owner, right.owner) || compareAscii(left.dependency, right.dependency))),
    shadowed: Object.freeze(shadowed.sort((left, right) => compareAscii(left.id, right.id) || compareAscii(left.sourceLocator, right.sourceLocator))),
    rejected: Object.freeze(rejected.sort((left, right) => compareAscii(left.id, right.id) || compareAscii(left.sourceLocator, right.sourceLocator))),
  });
}
