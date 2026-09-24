import type {
  CommandContribution,
  Dispose,
  DocsContribution,
  IntentContribution,
  Json,
  LifecycleContribution,
  ModIdentity,
  ModManifest,
  PlanStepContribution,
  Registrar,
  ResultContribution,
  ToolContribution,
} from '@kernlang/agon-mod-api';

export type RegistryKind =
  | 'cli-command'
  | 'tui-action'
  | 'intent'
  | 'mcp-tool'
  | 'cesar-tool'
  | 'plan-step'
  | 'lifecycle'
  | 'result-type'
  | 'docs'
  | 'config';

export type Surface = 'cli' | 'tui' | 'mcp' | 'cesar' | 'docs';

export interface RegistryRecord<T = unknown> {
  readonly kind: RegistryKind;
  readonly id: string;
  readonly aliases: readonly string[];
  readonly owner: ModIdentity;
  readonly payload: T;
}

export interface SurfaceProjection {
  readonly surface: Surface;
  readonly generation: string;
  readonly entries: readonly RegistryRecord[];
}

export interface RegistrationSession {
  readonly registrar: Registrar;
  commit(): void;
  rollback(): Promise<void>;
}

export interface ModRegistryOptions {
  readonly generation: string;
  readonly activeOwners: readonly ModIdentity[];
  readonly reservedIds?: Readonly<Partial<Record<RegistryKind, readonly string[]>>>;
}

export interface LegacyRegistryEntry {
  readonly surface: Surface;
  readonly kind: RegistryKind;
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly owner: ModIdentity;
  readonly payload?: Readonly<Record<string, unknown>>;
}

const SURFACE_KINDS: Readonly<Record<Surface, readonly RegistryKind[]>> = Object.freeze({
  cli: ['cli-command'],
  tui: ['tui-action', 'intent'],
  mcp: ['mcp-tool'],
  cesar: ['cesar-tool', 'plan-step'],
  docs: ['docs'],
});

const MANIFEST_KIND: Readonly<Partial<Record<RegistryKind, keyof ModManifest['contributes']>>> = Object.freeze({
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
});

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function registryKey(kind: RegistryKind, id: string): string {
  return kind + "\0" + id;
}

function freezeCompatibilityPayload<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;

  const pending: object[] = [value];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const child of Object.values(current as Record<string, unknown>)) {
      if (child && typeof child === 'object' && !seen.has(child)) pending.push(child);
    }
    Object.freeze(current);
  }
  return value;
}

export class RegistryInvariantError extends Error {
  readonly code = 'MOD_REGISTRY_INVARIANT';

  constructor(message: string) {
    super(message);
    this.name = 'RegistryInvariantError';
  }
}

export class ModRegistry {
  readonly generation: string;
  readonly #activeOwners = new Map<string, ModIdentity>();
  readonly #records = new Map<string, RegistryRecord>();
  readonly #aliases = new Map<string, string>();
  readonly #ownerKeys = new Map<string, string[]>();
  readonly #reservedIds: Readonly<Partial<Record<RegistryKind, readonly string[]>>>;

  constructor(options: ModRegistryOptions) {
    this.generation = options.generation;
    this.#reservedIds = options.reservedIds ?? {};
    for (const owner of options.activeOwners) {
      if (this.#activeOwners.has(owner.id)) throw new RegistryInvariantError(`duplicate active owner: ${owner.id}`);
      this.#activeOwners.set(owner.id, Object.freeze({ ...owner }));
    }
  }

  static fromLegacy(options: ModRegistryOptions, entries: readonly LegacyRegistryEntry[]): ModRegistry {
    const registry = new ModRegistry(options);
    for (const entry of entries) {
      const surfaceKinds = SURFACE_KINDS[entry.surface];
      if (!surfaceKinds || !surfaceKinds.includes(entry.kind)) {
        throw new RegistryInvariantError('kind ' + entry.kind + ' cannot project to ' + entry.surface);
      }
      const owner = registry.#activeOwners.get(entry.owner.id);
      if (!owner) continue;
      registry.#register(owner, entry.kind, entry.id, entry.aliases ?? [], freezeCompatibilityPayload(entry.payload ?? { compatibility: true }), true);
    }
    return registry;
  }

  beginRegistration(manifest: ModManifest): RegistrationSession {
    const owner = this.#activeOwners.get(manifest.id);
    if (!owner || owner.version !== manifest.version) {
      throw new RegistryInvariantError(`owner is not active in generation ${this.generation}: ${manifest.id}@${manifest.version}`);
    }
    let state: 'open' | 'committed' | 'rolled-back' = 'open';
    const ownedDisposers: Dispose[] = [];
    const staged: Array<{ kind: RegistryKind; id: string; aliases: readonly string[]; payload: unknown; committedDispose?: Dispose }> = [];
    const registeredDeclarations = new Set<string>();
    const assertOpen = (): void => {
      if (state !== 'open') throw new RegistryInvariantError(`registration session is ${state}: ${manifest.id}`);
    };
    const register = <T>(kind: RegistryKind, id: string, aliases: readonly string[], payload: T): Dispose => {
      assertOpen();
      this.#assertDeclared(manifest, kind, id, aliases);
      const manifestKind = MANIFEST_KIND[kind]!;
      const declarationKey = manifestKind + '\0' + id;
      if (registeredDeclarations.has(declarationKey)) {
        throw new RegistryInvariantError(`manifest declaration registered more than once: ${manifestKind}/${id}`);
      }
      for (const name of [id, ...aliases]) {
        if (this.#reservedIds[kind]?.includes(name)) throw new RegistryInvariantError(`reserved contribution ID: ${kind}/${name}`);
        const key = registryKey(kind, name);
        if (this.#records.has(key) || this.#aliases.has(key)
          || staged.some((entry) => entry.kind === kind && [entry.id, ...entry.aliases].includes(name))) {
          throw new RegistryInvariantError(`duplicate contribution or alias: ${kind}/${name}`);
        }
      }
      const entry: (typeof staged)[number] = { kind, id, aliases: Object.freeze([...aliases]), payload };
      staged.push(entry);
      registeredDeclarations.add(declarationKey);
      let disposed = false;
      return async () => {
        if (disposed) return;
        disposed = true;
        if (state === 'committed') {
          await entry.committedDispose?.();
          return;
        }
        const index = staged.indexOf(entry);
        if (index >= 0) staged.splice(index, 1);
        registeredDeclarations.delete(declarationKey);
      };
    };
    const registrar: Registrar = Object.freeze({
      command: (surface: 'cli' | 'tui', contribution: CommandContribution) => register(surface === 'cli' ? 'cli-command' : 'tui-action', contribution.id, contribution.aliases ?? [], contribution),
      intent: (contribution: IntentContribution) => register('intent', contribution.id, contribution.aliases ?? [], contribution),
      tool: (surface: 'mcp' | 'cesar', contribution: ToolContribution) => register(surface === 'mcp' ? 'mcp-tool' : 'cesar-tool', contribution.id, contribution.aliases ?? [], contribution),
      planStep: (contribution: PlanStepContribution) => register('plan-step', contribution.id, contribution.aliases ?? [], contribution),
      lifecycle: (contribution: LifecycleContribution) => register('lifecycle', contribution.event, contribution.aliases ?? [], contribution),
      resultType: (contribution: ResultContribution) => register('result-type', contribution.id, contribution.aliases ?? [], contribution),
      docs: (contribution: DocsContribution) => register('docs', contribution.id, contribution.aliases ?? [], contribution),
      config: (namespace: string, schema: Readonly<Record<string, Json>>, aliases: readonly string[] = []) => register('config', namespace, aliases, schema),
    });
    return Object.freeze({
      registrar,
      commit: () => {
        assertOpen();
        const expectedDeclarations = Object.entries(manifest.contributes).flatMap(([kind, declarations]) =>
          declarations.map(({ id }) => kind + '\0' + id));
        const missing = expectedDeclarations.filter((key) => !registeredDeclarations.has(key));
        if (missing.length > 0) {
          throw new RegistryInvariantError(`declared contribution was not registered: ${missing.join(', ')}`);
        }
        try {
          for (const entry of staged) {
            entry.committedDispose = this.#register(owner, entry.kind, entry.id, entry.aliases, entry.payload, false);
            ownedDisposers.push(entry.committedDispose);
          }
        } catch (error) {
          for (const dispose of [...ownedDisposers].reverse()) void dispose();
          throw error;
        }
        state = 'committed';
      },
      rollback: async () => {
        if (state === 'rolled-back') return;
        if (state === 'committed') throw new RegistryInvariantError(`cannot roll back committed registration: ${manifest.id}`);
        state = 'rolled-back';
        staged.length = 0;
      },
    });
  }

  project(surface: Surface): SurfaceProjection {
    const kinds = new Set(SURFACE_KINDS[surface]);
    const entries = [...this.#records.values()]
      .filter((record) => kinds.has(record.kind) && this.#activeOwners.has(record.owner.id))
      .sort((left, right) => compareAscii(left.kind, right.kind) || compareAscii(left.id, right.id) || compareAscii(left.owner.id, right.owner.id));
    return Object.freeze({ surface, generation: this.generation, entries: Object.freeze(entries) });
  }

  projections(): Readonly<Record<Surface, SurfaceProjection>> {
    return Object.freeze({
      cli: this.project('cli'),
      tui: this.project('tui'),
      mcp: this.project('mcp'),
      cesar: this.project('cesar'),
      docs: this.project('docs'),
    });
  }

  resolve(kind: RegistryKind, idOrAlias: string): RegistryRecord | undefined {
    const key = registryKey(kind, idOrAlias);
    const canonicalKey = this.#aliases.get(key) ?? key;
    const record = this.#records.get(canonicalKey);
    return record && this.#activeOwners.has(record.owner.id) ? record : undefined;
  }

  async disposeOwner(ownerId: string): Promise<void> {
    const keys = [...(this.#ownerKeys.get(ownerId) ?? [])].reverse();
    for (const key of keys) this.#remove(key);
    this.#activeOwners.delete(ownerId);
  }

  #assertDeclared(manifest: ModManifest, kind: RegistryKind, id: string, aliases: readonly string[]): void {
    const manifestKind = MANIFEST_KIND[kind];
    if (!manifestKind) throw new RegistryInvariantError(`unsupported registration kind: ${kind}`);
    const declaration = manifest.contributes[manifestKind].find((entry) => entry.id === id);
    if (!declaration) throw new RegistryInvariantError(`${manifest.id} did not declare ${kind} ${id}`);
    const declaredAliases = [...declaration.aliases].sort().join('\0');
    if ([...aliases].sort().join('\0') !== declaredAliases) {
      throw new RegistryInvariantError(`${manifest.id} aliases do not match manifest for ${kind} ${id}`);
    }
  }

  #register<T>(owner: ModIdentity, kind: RegistryKind, id: string, aliases: readonly string[], payload: T, compatibility: boolean): Dispose {
    if (!this.#activeOwners.has(owner.id)) throw new RegistryInvariantError(`disabled owner cannot register: ${owner.id}`);
    if (!id) throw new RegistryInvariantError('contribution ID cannot be empty');
    if (!compatibility && [id, ...aliases].some((name) => this.#reservedIds[kind]?.includes(name))) {
      throw new RegistryInvariantError(`reserved contribution ID or alias: ${kind}/${id}`);
    }
    const key = registryKey(kind, id);
    if (this.#records.has(key) || this.#aliases.has(key)) throw new RegistryInvariantError(`duplicate contribution: ${kind}/${id}`);
    const names = [id, ...aliases];
    if (new Set(names).size !== names.length) throw new RegistryInvariantError(`duplicate alias: ${kind}/${id}`);
    for (const alias of aliases) {
      const aliasKey = registryKey(kind, alias);
      if (this.#records.has(aliasKey) || this.#aliases.has(aliasKey)) throw new RegistryInvariantError(`alias collision: ${kind}/${alias}`);
    }
    const record = Object.freeze({ kind, id, aliases: Object.freeze([...aliases]), owner, payload: freezeCompatibilityPayload(payload) });
    this.#records.set(key, record);
    for (const alias of aliases) this.#aliases.set(registryKey(kind, alias), key);
    const ownerKeys = this.#ownerKeys.get(owner.id) ?? [];
    ownerKeys.push(key);
    this.#ownerKeys.set(owner.id, ownerKeys);
    let disposed = false;
    return async () => {
      if (disposed) return;
      disposed = true;
      this.#remove(key);
    };
  }

  #remove(key: string): void {
    const record = this.#records.get(key);
    if (!record) return;
    this.#records.delete(key);
    for (const alias of record.aliases) this.#aliases.delete(registryKey(record.kind, alias));
    const ownerKeys = this.#ownerKeys.get(record.owner.id);
    if (ownerKeys) this.#ownerKeys.set(record.owner.id, ownerKeys.filter((ownerKey) => ownerKey !== key));
  }
}
