import type { AgonModFactory, AgonModV1, Dispose, InvocationContext, Json, ModServices, PermissionDecision } from '@kernlang/agon-mod-api';
import { pathToFileURL } from 'node:url';
import type { ModRegistry } from './registry.js';
import type { FolderModCandidate } from './folder-mods.js';
import { createFolderModSnapshot } from './folder-mod-snapshot.js';
import { evaluateThirdPartyAuthority, type GrantRecord, type TrustPublisher, type TrustRecord } from './trust-authority.js';

export class ThirdPartyActivationError extends Error {
  readonly code = 'THIRD_PARTY_ACTIVATION_REFUSED';
  constructor(message: string, readonly details: Readonly<Record<string, unknown>> = {}) {
    super(message); this.name = 'ThirdPartyActivationError';
  }
}

export interface ThirdPartyActivationOptions {
  readonly candidate: FolderModCandidate;
  readonly publisher: TrustPublisher;
  readonly trustRecords: readonly TrustRecord[];
  readonly grantRecords: readonly GrantRecord[];
  /** Reloaded before every capability invocation so revocation affects an already-running host. */
  readonly readAuthority?: () => Promise<{ readonly trustRecords: readonly TrustRecord[]; readonly grantRecords: readonly GrantRecord[] }>;
  readonly registry: ModRegistry;
  readonly services: ModServices;
  readonly safeMode?: boolean;
  readonly timeoutMs?: number;
  readonly importModule?: (url: string) => Promise<unknown>;
  readonly capabilityRuntime?: {
    dispatchEngine(engineId: string, prompt: string, context: InvocationContext): Promise<Json>;
  };
}

export interface ThirdPartyActivationResult {
  readonly modId: string;
  readonly contentHash: `sha256:${string}`;
  readonly trustRecordId: string;
  readonly grantRecordIds: readonly string[];
  readonly trustModel: 'full-code';
  dispose(): Promise<void>;
}

function permissionKey(capability: string, resources: readonly string[]): string {
  return JSON.stringify([capability, [...resources].sort()]);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ThirdPartyActivationError('third-party activation timed out', { timeoutMs })), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function assertMod(value: unknown): AgonModV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ThirdPartyActivationError('mod factory returned an invalid object');
  const mod = value as Partial<AgonModV1>;
  if (mod.apiVersion !== '1' || typeof mod.activate !== 'function') throw new ThirdPartyActivationError('mod factory returned an incompatible API');
  return mod as AgonModV1;
}

function wrapServices(options: Omit<ThirdPartyActivationOptions, 'registry'>): ModServices {
  const requested = new Map(options.candidate.manifest.permissions.map((permission) => [permissionKey(permission.capability, permission.resources), permission]));
  const staticAuthority = Object.freeze({ trustRecords: options.trustRecords, grantRecords: options.grantRecords });
  const decision = async (capability: string, resource?: string): Promise<PermissionDecision> => {
    const current = options.readAuthority ? await options.readAuthority() : staticAuthority;
    const authority = evaluateThirdPartyAuthority({
      modId: options.candidate.manifest.id, version: options.candidate.manifest.version, source: options.candidate.source,
      sourceLocator: options.candidate.sourceLocator, contentHash: options.candidate.contentHash,
      manifestHash: options.candidate.manifestHash, publisher: options.publisher,
    }, options.candidate.manifest, current.trustRecords, current.grantRecords);
    if (!authority.allowed) return 'deny';
    const currentGrantIds = new Set(authority.grantRecordIds);
    const grants = new Map(current.grantRecords.filter((grant) => currentGrantIds.has(grant.recordId)).map((grant) => [permissionKey(grant.capability, grant.resources), grant]));
    const matches = [...requested.values()].filter((permission) => permission.capability === capability && (resource === undefined || permission.resources.includes(resource)));
    return matches.some((permission) => grants.has(permissionKey(permission.capability, permission.resources))) ? 'allow' : 'deny';
  };
  const requireCapability = async (capability: string, resource?: string): Promise<void> => {
    const outcome = await decision(capability, resource);
    await options.services.receipts.record('capability-decision', { capability, resource: resource ?? null, decision: outcome });
    if (outcome !== 'allow') throw new ThirdPartyActivationError('capability is not granted', { capability, resource });
  };
  return Object.freeze({
    ...options.services,
    identity: Object.freeze({ id: options.candidate.manifest.id, version: options.candidate.manifest.version, contentHash: options.candidate.contentHash }),
    source: options.candidate.source,
    permissions: Object.freeze({ check: async (capability: string, resource?: string) => {
      const outcome = await decision(capability, resource);
      await options.services.receipts.record('capability-decision', { capability, resource: resource ?? null, decision: outcome });
      return outcome;
    } }),
    state: Object.freeze({
      read: async <T extends Json>(key: string) => { await requireCapability('state.read', key); return options.services.state.read<T>(key); },
      write: async (key: string, value: Json) => { await requireCapability('state.write', key); await options.services.state.write(key, value); },
    }),
    engines: Object.freeze({
      dispatch: async (engineId: string, prompt: string, context: InvocationContext) => {
        await requireCapability('engine.dispatch', engineId);
        if (!options.capabilityRuntime) throw new ThirdPartyActivationError('engine dispatch host capability is unavailable');
        const result = await options.capabilityRuntime.dispatchEngine(engineId, prompt, context);
        await options.services.receipts.record('capability-action', { capability: 'engine.dispatch', resource: engineId, outcome: 'completed' });
        return result;
      },
    }),
  });
}


export interface PreparedThirdPartyMod {
  readonly candidate: FolderModCandidate;
  readonly manifest: FolderModCandidate['manifest'];
  readonly mod: AgonModV1;
  readonly services: ModServices;
  readonly contentHash: `sha256:${string}`;
  readonly trustRecordId: string;
  readonly grantRecordIds: readonly string[];
  readonly trustModel: 'full-code';
  dispose(): Promise<void>;
}

/** Verify, snapshot, import, and instantiate a folder mod without registering it. */
export async function prepareTrustedFolderMod(
  options: Omit<ThirdPartyActivationOptions, 'registry'>,
): Promise<PreparedThirdPartyMod> {
  if (options.safeMode) throw new ThirdPartyActivationError('kernel-only safe mode forbids third-party activation');
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError('activation timeout must be between 1 and 30000 milliseconds');
  }
  const snapshot = await createFolderModSnapshot(options.candidate);
  try {
    const fresh = snapshot.candidate;
    if (fresh.manifest.execution !== 'executable' || !fresh.manifest.entrypoints) {
      throw new ThirdPartyActivationError('declarative mods are never imported');
    }
    const authority = evaluateThirdPartyAuthority({
      modId: fresh.manifest.id,
      version: fresh.manifest.version,
      source: fresh.source,
      sourceLocator: options.candidate.sourceLocator,
      contentHash: fresh.contentHash,
      manifestHash: fresh.manifestHash,
      publisher: options.publisher,
    }, fresh.manifest, options.trustRecords, options.grantRecords);
    if (!authority.allowed || !authority.trustRecordId) {
      throw new ThirdPartyActivationError('third-party authority is incomplete', {
        reason: authority.reason,
        missingCapabilities: authority.missingCapabilities,
      });
    }
    const runtime = fresh.inspection.containedPaths.get(fresh.manifest.entrypoints.runtime);
    if (!runtime) throw new ThirdPartyActivationError('verified runtime entrypoint is missing');
    const runtimeUrl = `${pathToFileURL(runtime).href}?agon=${fresh.contentHash.slice(7)}`;
    const services = wrapServices(options);
    let mod: AgonModV1; let isolatedDispose: (() => Promise<void>) | undefined;
    if (options.importModule) {
      const namespace = await withTimeout(options.importModule(runtimeUrl), timeoutMs);
      const factory = (namespace as { default?: unknown }).default;
      if (typeof factory !== 'function') throw new ThirdPartyActivationError('runtime must default-export an AgonModFactory');
      mod = assertMod(await withTimeout(Promise.resolve((factory as AgonModFactory)(services)), timeoutMs));
    } else {
      const isolated = await (await import('./third-party-worker.js')).createIsolatedThirdPartyMod({ runtimeUrl, services, timeoutMs });
      mod = isolated.mod; isolatedDispose = isolated.dispose;
    }
    return Object.freeze({
      candidate: fresh,
      manifest: fresh.manifest,
      mod,
      services,
      contentHash: fresh.contentHash,
      trustRecordId: authority.trustRecordId,
      grantRecordIds: authority.grantRecordIds,
      trustModel: 'full-code' as const,
      dispose: async () => { try { await isolatedDispose?.(); } finally { await snapshot.dispose(); } },
    });
  } catch (error) {
    await snapshot.dispose().catch(() => undefined);
    throw error;
  }
}

export async function activatePreparedThirdPartyMod(
  prepared: PreparedThirdPartyMod,
  registrar: Parameters<AgonModV1['activate']>[0],
  timeoutMs = 10_000,
): Promise<Dispose | void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new TypeError('activation timeout must be between 1 and 30000 milliseconds');
  }
  const dispose = await withTimeout(Promise.resolve(prepared.mod.activate(registrar, prepared.services)), timeoutMs);
  if (dispose !== undefined && typeof dispose !== 'function') {
    throw new ThirdPartyActivationError('mod activation disposer must be a function');
  }
  return dispose;
}

export async function activateTrustedFolderMod(options: ThirdPartyActivationOptions): Promise<ThirdPartyActivationResult> {
  const prepared = await prepareTrustedFolderMod(options);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const registration = options.registry.beginRegistration(prepared.manifest);
  let modDispose: Dispose | void = undefined;
  try {
    modDispose = await activatePreparedThirdPartyMod(prepared, registration.registrar, timeoutMs);
    registration.commit();
  } catch (error) {
    await registration.rollback().catch(() => undefined);
    if (typeof modDispose === 'function') await Promise.resolve(modDispose()).catch(() => undefined);
    await prepared.dispose().catch(() => undefined);
    throw error;
  }
  let disposed = false;
  return Object.freeze({
    modId: prepared.manifest.id,
    contentHash: prepared.contentHash,
    trustRecordId: prepared.trustRecordId,
    grantRecordIds: prepared.grantRecordIds,
    trustModel: prepared.trustModel,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      try { if (typeof modDispose === 'function') await modDispose(); }
      finally {
        try { await options.registry.disposeOwner(prepared.manifest.id); }
        finally { await prepared.dispose(); }
      }
    },
  });
}
