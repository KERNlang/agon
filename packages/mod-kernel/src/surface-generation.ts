import type {
  Dispose,
  InvocationContext,
  InvocationOutput,
  Json,
  ModIdentity,
  ModManifest,
  Registrar,
} from '@kernlang/agon-mod-api';

import { ModRegistry } from './registry.js';
import type { RegistryKind, RegistryRecord, Surface, SurfaceProjection } from './registry.js';

export interface SurfaceAccessibility {
  readonly label: string;
  readonly fallbackText: string;
  readonly keyboardAccessible: boolean;
  readonly colorIndependent: boolean;
}

export interface GeneratedSurfaceCatalogEntry {
  readonly surface: Surface;
  readonly kind: RegistryKind;
  readonly registryId: string;
  readonly publicId: string;
  readonly category: string;
  readonly group: string;
  readonly source: string;
  readonly aliasOf?: string;
  readonly aliases: readonly string[];
  readonly owner: ModIdentity;
  readonly ownerClass: ModManifest['packageClass'];
  readonly description: string;
  readonly accessibility: SurfaceAccessibility;
}

export interface GeneratedSurfaceRuntime {
  command(surface: 'cli' | 'tui', publicId: string, input: Json, context: InvocationContext): InvocationOutput;
  tool(surface: 'mcp' | 'cesar', publicId: string, input: Json, context: InvocationContext): Promise<Json> | Json;
  parseIntent(publicId: string, input: string): Promise<Json | undefined> | Json | undefined;
  renderDocs(publicId: string, payload: Json): Promise<{ readonly text: string; readonly markdown?: string }> | { readonly text: string; readonly markdown?: string };
}

export type SurfaceGenerationMode = 'legacy-authoritative' | 'generated-authoritative';

export class SurfaceGenerationError extends Error {
  readonly code: 'MOD_GENERATION_MISMATCH' | 'MOD_SURFACE_UNAVAILABLE' | 'MOD_SURFACE_AMBIGUOUS';
  readonly restartRequired: boolean;

  constructor(code: SurfaceGenerationError['code'], message: string, restartRequired = false) {
    super(message);
    this.name = 'SurfaceGenerationError';
    this.code = code;
    this.restartRequired = restartRequired;
  }
}

const MANIFEST_KIND = Object.freeze({
  'cli-command': 'cliCommands',
  'tui-action': 'tuiActions',
  intent: 'tuiActions',
  'mcp-tool': 'mcpTools',
  'cesar-tool': 'cesarTools',
  'plan-step': 'cesarTools',
  lifecycle: 'lifecycleHooks',
  'result-type': 'resultTypes',
  docs: 'generatedDocs',
  config: 'configKeys',
} satisfies Record<RegistryKind, keyof ModManifest['contributes']>);

const inputSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;
const resultSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function catalogKey(entry: Pick<GeneratedSurfaceCatalogEntry, 'surface' | 'publicId'>): string {
  return `${entry.surface}\0${entry.publicId}`;
}

function manifestFor(owner: ModIdentity, entries: readonly GeneratedSurfaceCatalogEntry[]): ModManifest {
  const contributes = {
    cliCommands: [], tuiActions: [], mcpTools: [], cesarTools: [], lifecycleHooks: [],
    resultTypes: [], configKeys: [], generatedDocs: [],
  } as { [K in keyof ModManifest['contributes']]: Array<{ id: string; aliases: readonly string[] }> };
  for (const entry of entries) contributes[MANIFEST_KIND[entry.kind]].push({ id: entry.registryId, aliases: entry.aliases });
  return Object.freeze({
    schemaVersion: 2,
    id: owner.id,
    name: owner.id,
    version: owner.version,
    apiRange: '>=1.0.0 <2',
    execution: 'executable',
    compatibility: { kernelRange: '>=0.0.0-0 <2', nodeRange: '>=22' },
    packageClass: entries[0]?.ownerClass ?? (owner.id === 'agon.kernel' ? 'minimal-kernel-machinery' : 'hidden-shared-support-package'),
    entrypoints: { runtime: 'generated:surface', types: 'generated:surface' },
    display: { group: owner.id === 'agon.kernel' ? 'Kernel' : 'Generated', order: 0 },
    dependencies: { required: [], optional: [], conflicts: [] },
    permissions: [],
    platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'],
    assets: [],
    contributes,
    pack: { include: [], executable: [] },
  } as ModManifest);
}

function registerEntry(
  registrar: Registrar,
  entry: GeneratedSurfaceCatalogEntry,
  runtime: GeneratedSurfaceRuntime,
): Dispose {
  const base = { id: entry.registryId, aliases: entry.aliases, description: entry.description, inputSchema };
  if (entry.kind === 'cli-command') return registrar.command('cli', { ...base, run: (input, context) => runtime.command('cli', entry.publicId, input, context) });
  if (entry.kind === 'tui-action') return registrar.command('tui', { ...base, run: (input, context) => runtime.command('tui', entry.publicId, input, context) });
  if (entry.kind === 'intent') return registrar.intent({ ...base, parse: (input) => runtime.parseIntent(entry.publicId, input), run: (input, context) => runtime.command('tui', entry.publicId, input, context) });
  if (entry.kind === 'mcp-tool') return registrar.tool('mcp', { ...base, effect: 'process', run: (input, context) => runtime.tool('mcp', entry.publicId, input, context) });
  if (entry.kind === 'cesar-tool') return registrar.tool('cesar', { ...base, effect: 'process', run: (input, context) => runtime.tool('cesar', entry.publicId, input, context) });
  if (entry.kind === 'plan-step') return registrar.planStep({ ...base, resultSchema, risk: 'read', run: async (input, context) => ({ exitCode: 0, result: await runtime.tool('cesar', entry.publicId, input, context) }) });
  if (entry.kind === 'docs') return registrar.docs({ id: entry.registryId, aliases: entry.aliases, title: entry.description, markdown: entry.accessibility.fallbackText });
  if (entry.kind === 'result-type') return registrar.resultType({ id: entry.registryId, aliases: entry.aliases, schema: resultSchema, readableVersions: '>=0', render: (payload) => runtime.renderDocs(entry.publicId, payload) });
  if (entry.kind === 'config') return registrar.config(entry.registryId, inputSchema, entry.aliases);
  return registrar.lifecycle({ event: entry.registryId, aliases: entry.aliases, handle: async (payload, context) => { await runtime.tool('cesar', entry.publicId, payload, context); } });
}

export class SurfaceGeneration {
  readonly id: string;
  readonly mode: SurfaceGenerationMode;
  readonly registry: ModRegistry;
  readonly #catalog: readonly GeneratedSurfaceCatalogEntry[];
  readonly #byPublic = new Map<string, readonly GeneratedSurfaceCatalogEntry[]>();

  constructor(options: {
    readonly id: string;
    readonly mode: SurfaceGenerationMode;
    readonly catalog: readonly GeneratedSurfaceCatalogEntry[];
    readonly runtime: GeneratedSurfaceRuntime;
    readonly disabledOwnerIds?: readonly string[];
    readonly syntheticOwnerIds?: readonly string[];
  }) {
    this.id = options.id;
    this.mode = options.mode;
    const disabled = new Set(options.disabledOwnerIds ?? []);
    const catalog = options.catalog
      .filter((entry) => !disabled.has(entry.owner.id))
      .sort((left, right) => compareAscii(left.surface, right.surface) || compareAscii(left.kind, right.kind) || compareAscii(left.registryId, right.registryId));
    const ownerMap = new Map(catalog.map(({ owner }) => [owner.id, owner]));
    this.registry = new ModRegistry({ generation: this.id, activeOwners: [...ownerMap.values()] });
    const syntheticOwners = options.syntheticOwnerIds ? new Set(options.syntheticOwnerIds) : undefined;
    for (const owner of ownerMap.values()) {
      if (syntheticOwners && !syntheticOwners.has(owner.id)) continue;
      const owned = catalog.filter((entry) => entry.owner.id === owner.id);
      const session = this.registry.beginRegistration(manifestFor(owner, owned));
      for (const entry of owned) registerEntry(session.registrar, entry, options.runtime);
      session.commit();
    }
    this.#catalog = Object.freeze(catalog.map((entry) => Object.freeze({ ...entry, aliases: Object.freeze([...entry.aliases]), accessibility: Object.freeze({ ...entry.accessibility }) })));
    const grouped = new Map<string, GeneratedSurfaceCatalogEntry[]>();
    for (const entry of this.#catalog) {
      for (const publicId of [entry.publicId, ...entry.aliases]) {
        const key = catalogKey({ surface: entry.surface, publicId });
        const values = grouped.get(key) ?? [];
        values.push(entry);
        grouped.set(key, values);
      }
    }
    for (const [key, values] of grouped) {
      const owners = new Set(values.map(({ owner }) => owner.id));
      if (owners.size > 1) throw new SurfaceGenerationError('MOD_SURFACE_AMBIGUOUS', 'public surface name has multiple owners: ' + key);
      this.#byPublic.set(key, Object.freeze(values));
    }
    Object.freeze(this);
  }

  project(surface: Surface, expectedGeneration = this.id): SurfaceProjection {
    this.assertGeneration(expectedGeneration);
    return this.registry.project(surface);
  }

  catalog(surface?: Surface): readonly GeneratedSurfaceCatalogEntry[] {
    const registered = this.#catalog.filter((entry) => this.registry.resolve(entry.kind, entry.registryId));
    return Object.freeze(surface ? registered.filter((entry) => entry.surface === surface) : registered);
  }

  resolvePublic(surface: Surface, publicId: string, expectedGeneration = this.id): readonly RegistryRecord[] {
    this.assertGeneration(expectedGeneration);
    const catalogEntries = this.#byPublic.get(catalogKey({ surface, publicId })) ?? [];
    return Object.freeze(catalogEntries.flatMap((entry) => {
      const record = this.registry.resolve(entry.kind, entry.registryId);
      return record ? [record] : [];
    }));
  }

  assertAvailable(surface: Surface, publicId: string, expectedGeneration = this.id): RegistryRecord {
    const records = this.resolvePublic(surface, publicId, expectedGeneration);
    if (records.length === 0) throw new SurfaceGenerationError('MOD_SURFACE_UNAVAILABLE', `${surface} contribution is unavailable in ${this.id}: ${publicId}`);
    if (records.length > 1) throw new SurfaceGenerationError('MOD_SURFACE_AMBIGUOUS', `${surface} contribution is ambiguous in ${this.id}: ${publicId}`);
    return records[0]!;
  }

  assertGeneration(expectedGeneration: string): void {
    if (expectedGeneration !== this.id) {
      throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', `surface client is pinned to ${expectedGeneration}; active generation is ${this.id}`, true);
    }
  }
}

export class SurfaceGenerationSelector {
  #active: SurfaceGeneration;
  readonly #retained = new Map<string, SurfaceGeneration>();

  constructor(initial: SurfaceGeneration) {
    this.#active = initial;
    this.#retained.set(initial.id, initial);
  }

  get active(): SurfaceGeneration { return this.#active; }

  select(candidate: SurfaceGeneration, verify: (candidate: SurfaceGeneration) => void): void {
    verify(candidate);
    this.#retained.set(candidate.id, candidate);
    this.#active = candidate;
  }

  rollback(generationId: string): void {
    const target = this.#retained.get(generationId);
    if (!target) throw new SurfaceGenerationError('MOD_SURFACE_UNAVAILABLE', `retained surface generation does not exist: ${generationId}`);
    this.#active = target;
  }

  client(surface: Surface): SurfaceClient {
    return new SurfaceClient(this, surface, this.#active.id);
  }
}

export class SurfaceClient {
  readonly surface: Surface;
  readonly generation: string;
  readonly #selector: SurfaceGenerationSelector;

  constructor(selector: SurfaceGenerationSelector, surface: Surface, generation: string) {
    this.#selector = selector;
    this.surface = surface;
    this.generation = generation;
    Object.freeze(this);
  }

  project(): SurfaceProjection {
    return this.#selector.active.project(this.surface, this.generation);
  }

  resolve(publicId: string): readonly RegistryRecord[] {
    return this.#selector.active.resolvePublic(this.surface, publicId, this.generation);
  }

  assertAvailable(publicId: string): RegistryRecord {
    return this.#selector.active.assertAvailable(this.surface, publicId, this.generation);
  }
}

export function assertGeneratedSurfaceAccessibility(generation: SurfaceGeneration): void {
  for (const surface of ['tui', 'docs'] as const) {
    for (const entry of generation.catalog(surface)) {
      if (!entry.accessibility.label.trim() || !entry.accessibility.fallbackText.trim()) {
        throw new SurfaceGenerationError('MOD_SURFACE_UNAVAILABLE', surface + ' accessibility text is missing: ' + entry.registryId);
      }
      if (!entry.accessibility.keyboardAccessible || !entry.accessibility.colorIndependent) {
        throw new SurfaceGenerationError('MOD_SURFACE_UNAVAILABLE', surface + ' accessibility contract is incomplete: ' + entry.registryId);
      }
    }
  }
}
