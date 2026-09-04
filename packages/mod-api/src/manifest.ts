import { z } from 'zod';
import { valid as validVersion, validRange } from 'semver';

export const MOD_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
export const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
export const RELATIVE_PACKAGE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

const Semver = z.string().refine((value) => validVersion(value) !== null, "invalid semantic version");
const ModId = z.string().max(256).regex(MOD_ID_PATTERN);
const ContentHash = z.string().regex(CONTENT_HASH_PATTERN);
const ContributionId = z.string().min(1).max(256).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/);
const RelativePath = z.string().regex(RELATIVE_PACKAGE_PATH_PATTERN);
const Platform = z.enum(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']);
const Contribution = z.object({
  id: ContributionId,
  aliases: z.array(ContributionId).default([]),
}).strict();
const Dependency = z.object({ id: ModId, range: z.string().min(1) }).strict();
const Permission = z.object({
  capability: z.string().min(1).max(256).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/),
  resources: z.array(z.string().min(1).max(1024).regex(/^[\x20-\x7e]+$/)).default([]),
  required: z.boolean().default(true),
}).strict();
const Asset = z.object({
  path: RelativePath,
  kind: z.enum(['static', 'native', 'schema', 'documentation']),
  mediaType: z.string().min(1),
  contentHash: ContentHash,
  bytes: z.number().int().nonnegative(),
  executable: z.boolean().default(false),
  platforms: z.array(Platform).min(1),
  consumerContributionId: ContributionId.optional(),
}).strict();

export const ManifestSchema = z.object({
  schemaVersion: z.literal(2),
  id: ModId,
  name: z.string().min(1),
  version: Semver,
  apiRange: z.string().min(1),
  execution: z.enum(['executable', 'declarative']),
  compatibility: z.object({
    kernelRange: z.string().min(1),
    nodeRange: z.string().min(1),
  }).strict(),
  packageClass: z.enum([
    'minimal-kernel-machinery',
    'hidden-shared-support-package',
    'user-toggleable-mod-package',
  ]),
  entrypoints: z.object({ runtime: RelativePath, types: RelativePath }).strict().optional(),
  display: z.object({
    group: z.string().min(1),
    order: z.number().int(),
    parent: ModId.optional(),
  }).strict(),
  dependencies: z.object({
    required: z.array(Dependency).default([]),
    optional: z.array(Dependency).default([]),
    conflicts: z.array(ModId).default([]),
  }).strict(),
  permissions: z.array(Permission).default([]),
  platforms: z.array(Platform).min(1),
  assets: z.array(Asset).default([]),
  contributes: z.object({
    cliCommands: z.array(Contribution).default([]),
    tuiActions: z.array(Contribution).default([]),
    mcpTools: z.array(Contribution).default([]),
    cesarTools: z.array(Contribution).default([]),
    lifecycleHooks: z.array(Contribution).default([]),
    resultTypes: z.array(Contribution).default([]),
    configKeys: z.array(Contribution).default([]),
    generatedDocs: z.array(Contribution).default([]),
  }).strict(),
  pack: z.object({
    include: z.array(RelativePath).min(1),
    executable: z.array(RelativePath).default([]),
  }).strict(),
}).strict();

type DeepReadonly<T> = T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T;

type ManifestShape = z.infer<typeof ManifestSchema>;
export type ModManifest = DeepReadonly<ManifestShape>;
export type ModPlatform = z.infer<typeof Platform>;
export type ModPackageClass = ModManifest['packageClass'];
export type ManifestContributionKind = keyof ModManifest['contributes'];

export class ManifestValidationError extends Error {
  readonly code = 'INVALID_MOD_MANIFEST';

  constructor(message: string, readonly causeValue?: unknown) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) throw new ManifestValidationError(message);
}
function portablePathKey(path: string): string {
  return path.split('/').filter((segment) => segment !== '.').join('/').normalize('NFC').toLowerCase();
}


export function validateManifest(input: unknown): ModManifest {
  const parsed = ManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ManifestValidationError(z.prettifyError(parsed.error), parsed.error);
  }
  const manifest = parsed.data;
  if (manifest.execution === 'executable' && !manifest.entrypoints) {
    throw new ManifestValidationError('executable manifest requires entrypoints');
  }
  if (manifest.execution === 'declarative') {
    if (manifest.entrypoints) throw new ManifestValidationError('declarative manifest cannot declare entrypoints');
    if (manifest.permissions.length) throw new ManifestValidationError('declarative manifest cannot request permissions');
    const executableKinds: ManifestContributionKind[] = [
      'cliCommands', 'tuiActions', 'mcpTools', 'cesarTools', 'lifecycleHooks', 'resultTypes',
    ];
    if (executableKinds.some((kind) => manifest.contributes[kind].length > 0)) {
      throw new ManifestValidationError('declarative manifest cannot register executable contributions');
    }
    if (manifest.pack.executable.length || manifest.assets.some((asset) => asset.executable)) {
      throw new ManifestValidationError('declarative manifest cannot contain executable artifacts');
    }
  }
  const ranges = [manifest.apiRange, manifest.compatibility.kernelRange, manifest.compatibility.nodeRange];
  for (const dependency of [...manifest.dependencies.required, ...manifest.dependencies.optional]) {
    ranges.push(dependency.range);
  }
  if (ranges.some((range) => validRange(range) === null)) {
    throw new ManifestValidationError('invalid compatibility or dependency semver range');
  }
  const dependencyIds = [...manifest.dependencies.required, ...manifest.dependencies.optional].map(({ id }) => id);
  if (dependencyIds.includes(manifest.id)) throw new ManifestValidationError('manifest cannot depend on itself');
  assertUnique(dependencyIds, 'duplicate dependency id');
  if (manifest.dependencies.conflicts.some((id) => id === manifest.id || dependencyIds.includes(id))) {
    throw new ManifestValidationError('dependency/conflict overlap');
  }
  assertUnique(manifest.platforms, 'duplicate platform');
  assertUnique(manifest.dependencies.conflicts, 'duplicate conflict id');
  assertUnique(manifest.assets.map(({ path }) => path), 'duplicate asset path');
  assertUnique(manifest.pack.include, 'duplicate pack path');
  assertUnique(manifest.pack.executable, 'duplicate executable pack path');
  assertUnique(manifest.permissions.map(({ capability }) => capability), 'duplicate permission capability');
  for (const permission of manifest.permissions) assertUnique(permission.resources, `duplicate permission resource: ${permission.capability}`);
  const rawPackagePaths = [...new Set([
    ...(manifest.entrypoints ? [manifest.entrypoints.runtime, manifest.entrypoints.types] : []),
    ...manifest.assets.map(({ path }) => path),
    ...manifest.pack.include,
    ...manifest.pack.executable,
  ])];
  assertUnique(rawPackagePaths.map(portablePathKey), 'portable package path collision');
  if (manifest.execution === 'executable' && !manifest.id.startsWith('agon.') && manifest.entrypoints?.runtime.endsWith('.js') && !manifest.pack.include.includes('package.json')) {
    throw new ManifestValidationError('JavaScript runtime requires declared package.json module metadata');
  }
  for (const contribution of manifest.id.startsWith('agon.') ? [] : manifest.contributes.tuiActions) {
    if ([contribution.id, ...contribution.aliases].some((name) => name !== name.toLowerCase())) {
      throw new ManifestValidationError('TUI contribution IDs and aliases must be lowercase');
    }
  }
  if (!manifest.pack.include.includes('agon.mod.json')) throw new ManifestValidationError('agon.mod.json missing from pack include');
  const requiredPackPaths = [...(manifest.entrypoints ? [manifest.entrypoints.runtime, manifest.entrypoints.types] : []), ...manifest.assets.map(({ path }) => path), ...manifest.pack.executable];
  if (requiredPackPaths.some((path) => !manifest.pack.include.includes(path))) throw new ManifestValidationError('entrypoint, asset, or executable path missing from pack include');
  for (const [kind, contributions] of Object.entries(manifest.contributes)) {
    assertUnique(contributions.flatMap(({ id, aliases }) => [id, ...aliases]), `duplicate ${kind} contribution or alias`);
  }
  const contributionIds = new Set(Object.values(manifest.contributes).flatMap((contributions) => contributions.map(({ id }) => id)));
  if (manifest.assets.some(({ consumerContributionId }) => consumerContributionId && !contributionIds.has(consumerContributionId))) {
    throw new ManifestValidationError('asset references unknown consumer contribution');
  }
  return deepFreeze(manifest);
}
