import {
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  parseProfileDefinition,
  planDesiredStateChange,
  resolveDesiredState,
  type DesiredModState,
  type FirstPartyModCatalog,
  type ProfileDefinition,
} from './desired-state.js';

export type BuiltInProfileId = 'minimal' | 'maker' | 'reviewer' | 'researcher' | 'full-compat' | 'custom';

export interface ReleaseSetupRequest {
  readonly profile: BuiltInProfileId;
  readonly with?: readonly string[];
  readonly without?: readonly string[];
  readonly now: string;
}

export interface ReleaseSetupSelection {
  readonly schemaVersion: 1;
  readonly profile: BuiltInProfileId;
  readonly requestedWith: readonly string[];
  readonly requestedWithout: readonly string[];
  readonly desiredState: DesiredModState;
  readonly effectiveModIds: readonly string[];
  readonly effectivePackageIds: readonly string[];
}

const PRESETS: Readonly<Record<Exclude<BuiltInProfileId, 'full-compat' | 'custom'>, readonly string[]>> = Object.freeze({
  minimal: Object.freeze(['agon.ask']),
  maker: Object.freeze(['agon.forge', 'agon.mutate', 'agon.plan', 'agon.review', 'agon.team-forge', 'agon.think']),
  reviewer: Object.freeze(['agon.mutate', 'agon.nero', 'agon.review', 'agon.think', 'agon.tribunal']),
  researcher: Object.freeze(['agon.browser', 'agon.rag', 'agon.research', 'agon.synthesis', 'agon.think']),
});

function canonicalModId(input: string): string {
  const value = input.trim();
  if (!value) throw new TypeError('mod selection contains an empty ID');
  return value.startsWith('agon.') ? value : `agon.${value}`;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  const normalized = values.map(canonicalModId);
  if (new Set(normalized).size !== normalized.length) throw new TypeError('mod selection contains duplicate IDs');
  return Object.freeze(normalized.sort());
}


export function createBuiltInProfileDefinition(
  id: BuiltInProfileId,
  catalog: FirstPartyModCatalog = createFirstPartyModCatalog(),
): ProfileDefinition {
  const all = catalog.mods.map(({ modId }) => modId).sort();
  const selected = id === 'full-compat'
    ? catalog.mods.filter(({ defaultEnabled }) => defaultEnabled).map(({ modId }) => modId).sort()
    : id === 'custom' ? [] : [...PRESETS[id]];
  const selectedSet = new Set(selected);
  const disabled = id === 'full-compat' ? [] : all.filter((modId) => !selectedSet.has(modId));
  return parseProfileDefinition({ schemaVersion: 1, id, revision: 1, selected, disabled, constraints: {}, settingsDefaults: {} });
}

export function createReleaseSetupSelection(
  request: ReleaseSetupRequest,
  catalog: FirstPartyModCatalog = createFirstPartyModCatalog(),
): ReleaseSetupSelection {
  const requestedWith = uniqueSorted(request.with ?? []);
  const requestedWithout = uniqueSorted(request.without ?? []);
  const overlap = requestedWith.filter((id) => requestedWithout.includes(id));
  if (overlap.length) throw new TypeError(`mods cannot be both included and excluded: ${overlap.join(', ')}`);
  let desired = createFullCompatDesiredState(catalog, request.now);
  desired = planDesiredStateChange(catalog, desired, {
    kind: 'apply-profile', profile: createBuiltInProfileDefinition(request.profile, catalog),
  }, request.now).nextState;
  for (const id of requestedWith) desired = planDesiredStateChange(catalog, desired, { kind: 'enable', id }, request.now).nextState;
  for (const id of requestedWithout) desired = planDesiredStateChange(catalog, desired, { kind: 'disable', id }, request.now).nextState;
  const resolved = resolveDesiredState(catalog, desired);
  return Object.freeze({
    schemaVersion: 1, profile: request.profile, requestedWith, requestedWithout,
    desiredState: desired, effectiveModIds: resolved.effective, effectivePackageIds: resolved.effectivePackages,
  });
}
