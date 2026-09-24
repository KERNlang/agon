import { validRange } from 'semver';
import { FIRST_PARTY_PACKAGE_GRAPH } from './generated/first-party-package-graph.js';
import { canonicalJson, sha256Canonical } from './lock.js';
import { ImmutableMap } from './readonly-map.js';

export type FirstPartyPackageClass =
  | 'minimal-kernel-machinery'
  | 'hidden-shared-support-package'
  | 'user-toggleable-mod-package';

export interface FirstPartyPackageDefinition {
  readonly id: string;
  readonly class: FirstPartyPackageClass;
  readonly defaultEnabled: boolean;
  readonly dependencies: readonly string[];
}

export interface FirstPartyModDefinition extends FirstPartyPackageDefinition {
  readonly class: 'user-toggleable-mod-package';
  readonly modId: string;
}

export interface FirstPartyModCatalog {
  readonly packages: readonly FirstPartyPackageDefinition[];
  readonly packagesById: ReadonlyMap<string, FirstPartyPackageDefinition>;
  readonly mods: readonly FirstPartyModDefinition[];
  readonly modsById: ReadonlyMap<string, FirstPartyModDefinition>;
  readonly packageToModId: ReadonlyMap<string, string>;
}

export interface ProfileDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly revision: number;
  readonly selected: readonly string[];
  readonly disabled: readonly string[];
  readonly constraints: Readonly<Record<string, string>>;
  readonly settingsDefaults: Readonly<Record<string, unknown>>;
}

export interface AppliedProfileSnapshot extends Omit<ProfileDefinition, 'schemaVersion'> {
  readonly definitionHash: `sha256:${string}`;
}

export interface DesiredModState {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly previousHash: `sha256:${string}` | null;
  readonly updatedAt: string;
  readonly selected: readonly string[];
  readonly disabled: readonly string[];
  readonly constraints: Readonly<Record<string, string>>;
  readonly profile: AppliedProfileSnapshot | null;
}

export type DesiredStateAction =
  | { readonly kind: 'enable'; readonly id: string }
  | { readonly kind: 'disable'; readonly id: string; readonly noCascade?: boolean }
  | { readonly kind: 'apply-profile'; readonly profile: ProfileDefinition };

export interface DesiredStatePlan {
  readonly schemaVersion: 1;
  readonly operation: 'enable' | 'disable' | 'profile-update';
  readonly baseRevision: number;
  readonly baseHash: `sha256:${string}`;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly autoEnabled: readonly string[];
  readonly cascaded: readonly string[];
  readonly effective: readonly string[];
  readonly effectivePackages: readonly string[];
  readonly nextState: DesiredModState;
}

export interface ResolvedDesiredState {
  readonly effective: readonly string[];
  readonly effectivePackages: readonly string[];
}

export type DesiredStateErrorCode =
  | 'INVALID_DESIRED_STATE'
  | 'UNKNOWN_MOD'
  | 'DEPENDENTS_ACTIVE'
  | 'DISABLED_DEPENDENCY'
  | 'STALE_DESIRED_STATE'
  | 'REPOSITORY_ACTIVATION_FORBIDDEN';

export class DesiredStateError extends Error {
  constructor(
    readonly code: DesiredStateErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'DesiredStateError';
  }
}

export class DesiredStateConflictError extends DesiredStateError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('STALE_DESIRED_STATE', message, details);
    this.name = 'DesiredStateConflictError';
  }
}

const HASH = /^sha256:[a-f0-9]{64}$/;
const PROFILE_ID = /^[a-z][a-z0-9-]*$/;
const MOD_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compareAscii);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', `${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', `${label} has unknown or missing fields`);
  }
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', `${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', `${label} must be a UTC ISO timestamp`);
  }
  return value;
}

function modIds(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !MOD_ID.test(entry))) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', `${label} must contain canonical mod IDs`);
  }
  if (new Set(value).size !== value.length) throw new DesiredStateError('INVALID_DESIRED_STATE', `${label} must be unique`);
  if (canonicalJson(value) !== canonicalJson(sorted(value))) throw new DesiredStateError('INVALID_DESIRED_STATE', `${label} must be ASCII-sorted`);
  return Object.freeze([...value]);
}

function constraints(value: unknown, label: string): Readonly<Record<string, string>> {
  const input = plainRecord(value, label);
  const entries = Object.entries(input);
  if (canonicalJson(entries.map(([id]) => id)) !== canonicalJson(entries.map(([id]) => id).sort(compareAscii))) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', `${label} keys must be ASCII-sorted`);
  }
  for (const [id, range] of entries) {
    if (!MOD_ID.test(id) || typeof range !== 'string' || validRange(range) === null) {
      throw new DesiredStateError('INVALID_DESIRED_STATE', `${label} must contain canonical mod IDs and semver ranges`);
    }
  }
  return deepFreeze(Object.fromEntries(entries) as Record<string, string>);
}

function settingsDefaults(value: unknown): Readonly<Record<string, unknown>> {
  const input = plainRecord(value, 'profile settingsDefaults');
  for (const id of Object.keys(input)) {
    if (!MOD_ID.test(id)) throw new DesiredStateError('INVALID_DESIRED_STATE', 'profile settingsDefaults keys must be canonical mod IDs');
  }
  try { canonicalJson(input); } catch (error) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', 'profile settingsDefaults must be canonical JSON', { cause: error instanceof Error ? error.message : String(error) });
  }
  return deepFreeze(structuredClone(input));
}

function assertDisjoint(selected: readonly string[], disabled: readonly string[]): void {
  const overlap = selected.filter((id) => disabled.includes(id));
  if (overlap.length) throw new DesiredStateError('INVALID_DESIRED_STATE', 'selected and disabled mod IDs must be disjoint', { overlap });
}

export function parseProfileDefinition(value: unknown): ProfileDefinition {
  const input = plainRecord(value, 'profile');
  exact(input, ['schemaVersion', 'id', 'revision', 'selected', 'disabled', 'constraints', 'settingsDefaults'], 'profile');
  if (input.schemaVersion !== 1 || typeof input.id !== 'string' || !PROFILE_ID.test(input.id)) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', 'profile schema version or ID is invalid');
  }
  const selected = modIds(input.selected, 'profile selected');
  const disabled = modIds(input.disabled, 'profile disabled');
  assertDisjoint(selected, disabled);
  return deepFreeze({
    schemaVersion: 1,
    id: input.id,
    revision: integer(input.revision, 'profile revision'),
    selected,
    disabled,
    constraints: constraints(input.constraints, 'profile constraints'),
    settingsDefaults: settingsDefaults(input.settingsDefaults),
  });
}

function parseAppliedProfile(value: unknown): AppliedProfileSnapshot | null {
  if (value === null) return null;
  const input = plainRecord(value, 'applied profile snapshot');
  exact(input, ['id', 'revision', 'definitionHash', 'selected', 'disabled', 'constraints', 'settingsDefaults'], 'applied profile snapshot');
  const definition = parseProfileDefinition({
    schemaVersion: 1, id: input.id, revision: input.revision, selected: input.selected, disabled: input.disabled,
    constraints: input.constraints, settingsDefaults: input.settingsDefaults,
  });
  if (typeof input.definitionHash !== 'string' || !HASH.test(input.definitionHash)) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', 'profile definitionHash must be a SHA-256 hash');
  }
  const expectedDefinitionHash = sha256Canonical(definition);
  if (input.definitionHash !== expectedDefinitionHash) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', 'profile definitionHash does not match the applied profile snapshot', {
      expected: expectedDefinitionHash,
      actual: input.definitionHash,
    });
  }
  return deepFreeze({
    id: definition.id,
    revision: definition.revision,
    definitionHash: input.definitionHash as `sha256:${string}`,
    selected: definition.selected,
    disabled: definition.disabled,
    constraints: definition.constraints,
    settingsDefaults: definition.settingsDefaults,
  });
}

export function parseDesiredState(value: unknown): DesiredModState {
  const input = plainRecord(value, 'desired state');
  exact(input, ['schemaVersion', 'revision', 'previousHash', 'updatedAt', 'selected', 'disabled', 'constraints', 'profile'], 'desired state');
  if (input.schemaVersion !== 1) throw new DesiredStateError('INVALID_DESIRED_STATE', 'desired state schema version must be 1');
  const selected = modIds(input.selected, 'desired selected');
  const disabled = modIds(input.disabled, 'desired disabled');
  assertDisjoint(selected, disabled);
  if (input.previousHash !== null && (typeof input.previousHash !== 'string' || !HASH.test(input.previousHash))) {
    throw new DesiredStateError('INVALID_DESIRED_STATE', 'desired previousHash must be null or a SHA-256 hash');
  }
  return deepFreeze({
    schemaVersion: 1,
    revision: integer(input.revision, 'desired revision'),
    previousHash: input.previousHash as `sha256:${string}` | null,
    updatedAt: timestamp(input.updatedAt, 'desired updatedAt'),
    selected,
    disabled,
    constraints: constraints(input.constraints, 'desired constraints'),
    profile: parseAppliedProfile(input.profile),
  });
}

function toModId(packageId: string): string {
  const prefix = '@kernlang/agon-mod-';
  if (!packageId.startsWith(prefix)) throw new TypeError(`user mod package has unexpected ID: ${packageId}`);
  return `agon.${packageId.slice(prefix.length)}`;
}

export function createFirstPartyModCatalog(
  input: readonly FirstPartyPackageDefinition[] = FIRST_PARTY_PACKAGE_GRAPH.packages,
): FirstPartyModCatalog {
  const packages = [...input].map((entry) => deepFreeze({ ...entry, dependencies: Object.freeze([...entry.dependencies]) }));
  const packagesById = new Map(packages.map((entry) => [entry.id, entry]));
  if (packagesById.size !== packages.length) throw new TypeError('first-party catalog contains duplicate package IDs');
  for (const entry of packages) for (const dependency of entry.dependencies) {
    if (!packagesById.has(dependency)) throw new TypeError(`${entry.id} depends on unknown package ${dependency}`);
  }
  const mods = packages
    .filter((entry): entry is FirstPartyPackageDefinition & { class: 'user-toggleable-mod-package' } => entry.class === 'user-toggleable-mod-package')
    .map((entry) => deepFreeze({ ...entry, modId: toModId(entry.id) }))
    .sort((left, right) => compareAscii(left.modId, right.modId));
  const modsById = new Map(mods.map((entry) => [entry.modId, entry]));
  if (modsById.size !== mods.length) throw new TypeError('first-party catalog contains duplicate mod IDs');
  const packageToModId = new Map(mods.map((entry) => [entry.id, entry.modId]));
  return deepFreeze({
    packages: Object.freeze(packages),
    packagesById: new ImmutableMap(packagesById),
    mods: Object.freeze(mods),
    modsById: new ImmutableMap(modsById),
    packageToModId: new ImmutableMap(packageToModId),
  });
}

function assertKnown(catalog: FirstPartyModCatalog, ids: readonly string[]): void {
  for (const id of ids) if (!catalog.modsById.has(id)) throw new DesiredStateError('UNKNOWN_MOD', `unknown first-party mod: ${id}`, { id });
}

function packageClosure(catalog: FirstPartyModCatalog, selectedModIds: readonly string[]): readonly string[] {
  const pending = [
    ...catalog.packages
      .filter((entry) => entry.class !== 'user-toggleable-mod-package' && entry.defaultEnabled)
      .map((entry) => entry.id),
    ...selectedModIds.map((id) => catalog.modsById.get(id)!.id),
  ];
  const included = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (included.has(id)) continue;
    included.add(id);
    for (const dependency of catalog.packagesById.get(id)!.dependencies) pending.push(dependency);
  }
  return Object.freeze(sorted(included));
}

function effectiveModIds(catalog: FirstPartyModCatalog, selectedModIds: readonly string[]): readonly string[] {
  return Object.freeze(packageClosure(catalog, selectedModIds)
    .map((packageId) => catalog.packageToModId.get(packageId))
    .filter((id): id is string => id !== undefined)
    .sort(compareAscii));
}

export function resolveDesiredState(
  catalog: FirstPartyModCatalog,
  desiredInput: DesiredModState,
): ResolvedDesiredState {
  const desired = parseDesiredState(desiredInput);
  assertKnown(catalog, [...desired.selected, ...desired.disabled, ...Object.keys(desired.constraints)]);
  const effective = effectiveModIds(catalog, desired.selected);
  const disabledRequired = desired.disabled.filter((id) => effective.includes(id));
  if (disabledRequired.length) {
    throw new DesiredStateError('DISABLED_DEPENDENCY', 'selected mods require explicitly disabled dependencies', { dependencies: disabledRequired });
  }
  return deepFreeze({ effective, effectivePackages: packageClosure(catalog, desired.selected) });
}

function appliedProfile(profile: ProfileDefinition): AppliedProfileSnapshot {
  return deepFreeze({
    id: profile.id,
    revision: profile.revision,
    definitionHash: sha256Canonical(profile),
    selected: Object.freeze([...profile.selected]),
    disabled: Object.freeze([...profile.disabled]),
    constraints: deepFreeze({ ...profile.constraints }),
    settingsDefaults: deepFreeze(structuredClone(profile.settingsDefaults)),
  });
}

export function createFullCompatDesiredState(catalog: FirstPartyModCatalog, now: string): DesiredModState {
  const selected = Object.freeze(sorted(catalog.mods.filter(({ defaultEnabled }) => defaultEnabled).map(({ modId }) => modId)));
  const profile = parseProfileDefinition({
    schemaVersion: 1,
    id: 'full-compat',
    revision: 1,
    selected,
    disabled: [],
    constraints: {},
    settingsDefaults: {},
  });
  return parseDesiredState({
    schemaVersion: 1,
    revision: 0,
    previousHash: null,
    updatedAt: now,
    selected,
    disabled: [],
    constraints: {},
    profile: appliedProfile(profile),
  });
}

function dependsOn(catalog: FirstPartyModCatalog, candidateModId: string, dependencyModId: string): boolean {
  const candidate = catalog.modsById.get(candidateModId)!;
  const targetPackage = catalog.modsById.get(dependencyModId)!.id;
  const pending = [...candidate.dependencies];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === targetPackage) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const nested of catalog.packagesById.get(id)?.dependencies ?? []) pending.push(nested);
  }
  return false;
}

export function planDesiredStateChange(
  catalog: FirstPartyModCatalog,
  currentInput: DesiredModState,
  action: DesiredStateAction,
  now: string,
): DesiredStatePlan {
  const current = parseDesiredState(currentInput);
  let selected = [...current.selected];
  let disabled = [...current.disabled];
  let nextConstraints: Readonly<Record<string, string>> = current.constraints;
  let profile: AppliedProfileSnapshot | null = current.profile;
  let operation: DesiredStatePlan['operation'];
  let cascaded: string[] = [];

  if (action.kind === 'apply-profile') {
    const definition = parseProfileDefinition(action.profile);
    assertKnown(catalog, [...definition.selected, ...definition.disabled, ...Object.keys(definition.constraints)]);
    selected = [...definition.selected];
    disabled = [...definition.disabled];
    nextConstraints = definition.constraints;
    profile = appliedProfile(definition);
    operation = 'profile-update';
  } else if (action.kind === 'enable') {
    assertKnown(catalog, [action.id]);
    selected = sorted(new Set([...selected, action.id]));
    const required = effectiveModIds(catalog, selected);
    disabled = disabled.filter((id) => !required.includes(id));
    profile = null;
    operation = 'enable';
  } else {
    assertKnown(catalog, [action.id]);
    const activeRoots = selected.filter((id) => id === action.id || dependsOn(catalog, id, action.id));
    cascaded = sorted(activeRoots.filter((id) => id !== action.id));
    if (action.noCascade && cascaded.length) {
      throw new DesiredStateError('DEPENDENTS_ACTIVE', `cannot disable ${action.id} without cascading active dependents`, { id: action.id, dependents: cascaded });
    }
    selected = selected.filter((id) => !activeRoots.includes(id));
    disabled = sorted(new Set([...disabled, action.id, ...cascaded]));
    profile = null;
    operation = 'disable';
  }

  selected = sorted(selected);
  disabled = sorted(disabled.filter((id) => !selected.includes(id)));
  assertKnown(catalog, [...selected, ...disabled]);
  const resolution = resolveDesiredState(catalog, { ...current, selected, disabled, constraints: nextConstraints, profile });
  const effective = resolution.effective;
  const currentEffective = effectiveModIds(catalog, current.selected);
  const autoEnabled = effective.filter((id) => !selected.includes(id) && !currentEffective.includes(id));
  const nextState = parseDesiredState({
    schemaVersion: 1,
    revision: current.revision + 1,
    previousHash: sha256Canonical(current),
    updatedAt: timestamp(now, 'plan timestamp'),
    selected,
    disabled,
    constraints: Object.fromEntries(Object.entries(nextConstraints).sort(([left], [right]) => compareAscii(left, right))),
    profile,
  });
  return deepFreeze({
    schemaVersion: 1,
    operation,
    baseRevision: current.revision,
    baseHash: sha256Canonical(current),
    added: sorted(nextState.selected.filter((id) => !current.selected.includes(id))),
    removed: sorted(current.selected.filter((id) => !nextState.selected.includes(id))),
    autoEnabled,
    cascaded: Object.freeze(cascaded),
    effective,
    effectivePackages: resolution.effectivePackages,
    nextState,
  });
}

export function applyDesiredStatePlan(currentInput: DesiredModState, plan: DesiredStatePlan): DesiredModState {
  const current = parseDesiredState(currentInput);
  const actualHash = sha256Canonical(current);
  if (current.revision !== plan.baseRevision || actualHash !== plan.baseHash) {
    throw new DesiredStateConflictError('desired state changed after preview; generate a new plan', {
      expectedRevision: plan.baseRevision,
      actualRevision: current.revision,
      expectedHash: plan.baseHash,
      actualHash,
    });
  }
  return parseDesiredState(plan.nextState);
}

export interface RepositoryModSettingsProjection {
  readonly applied: Readonly<Record<string, unknown>>;
  readonly retained: Readonly<Record<string, unknown>>;
}

export function projectRepositoryModSettings(
  inputValue: unknown,
  desiredInput: DesiredModState,
  catalog: FirstPartyModCatalog,
): RepositoryModSettingsProjection {
  const input = plainRecord(inputValue, 'repository mod settings');
  const forbidden = Object.keys(input).filter((key) => key !== 'mods');
  if (forbidden.length) {
    throw new DesiredStateError('REPOSITORY_ACTIVATION_FORBIDDEN', 'activation, installation, trust, and grants are user-global and cannot come from repository configuration', { fields: forbidden.sort() });
  }
  const mods = plainRecord(input.mods, 'repository mods');
  const desired = parseDesiredState(desiredInput);
  const effective = new Set(effectiveModIds(catalog, desired.selected));
  const applied: Record<string, unknown> = {};
  const retained: Record<string, unknown> = {};
  for (const [id, settings] of Object.entries(mods).sort(([left], [right]) => compareAscii(left, right))) {
    plainRecord(settings, `repository settings for ${id}`);
    (catalog.modsById.has(id) && effective.has(id) ? applied : retained)[id] = structuredClone(settings);
  }
  return deepFreeze({ applied, retained });
}
