import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { AgonModV1, Json, ModManifest, ModServices, Registrar } from '@kernlang/agon-mod-api';

import { activateFirstPartySurfaceGeneration } from './activated-surface-generation.js';
import type { ActivatedSurfaceGeneration, FirstPartySurfacePackage } from './activated-surface-generation.js';
import { createFirstPartyModCatalog, createFullCompatDesiredState, parseDesiredState, resolveDesiredState } from './desired-state.js';
import type { DesiredModState } from './desired-state.js';
import { DurableModHost } from './durable-host.js';
import { canonicalJson, sha256Canonical } from './lock.js';
import type { CanonicalModLock } from './lock.js';
import { assertFirstPartyPackagesMatchLock } from './first-party-lock-validation.js';
import { assertSelectedLockIntegrity, assertSelectedLockPackageClosure } from './selected-lock-integrity.js';
import { FIRST_PARTY_SURFACE_CATALOG } from './generated/first-party-surface-catalog.js';
import type { GeneratedSurfaceCatalogEntry, GeneratedSurfaceRuntime } from './surface-generation.js';
import { KERNEL_MANAGEMENT_SURFACE_CATALOG } from './kernel-management-surfaces.js';
import { discoverUserFolderModsDetailed, type FolderModDiagnostic } from './folder-mod-diagnostics.js';
import { createExternalSurfaceCatalog } from './external-surface-catalog.js';
import { TrustGrantStore, evaluateThirdPartyAuthority, type TrustPublisher } from './trust-authority.js';
import { activatePreparedThirdPartyMod, prepareTrustedFolderMod } from './third-party-activation.js';
import { ExternalActivationStore } from './external-activation-state.js';
import { resolveExternalFolderModsIsolated } from './external-resolution.js';
import { ModStateStore } from './mod-state-store.js';
import { createSafeExternalModServices } from './external-mod-services-safe.js';
import { HOST_PROVIDED_DEPENDENCY_IDS } from './package-activation-order.js';
import { AGON_RUNTIME_VERSION } from './runtime-version.js';

interface FirstPartyModule {
  readonly MANIFEST: ModManifest;
  readonly createMod: (services: ModServices) => Promise<AgonModV1> | AgonModV1;
}

export interface FirstPartySurfaceBoot {
  readonly activated: ActivatedSurfaceGeneration;
  readonly desiredState: DesiredModState;
  readonly hostRoot: string;
  readonly pointerPath: string;
  readonly pointerCanonical: string | null;
  readonly activePackageIds: readonly string[];
  readonly disabledOwnerIds: readonly string[];
  readonly externalDiagnostics: readonly FolderModDiagnostic[];
}

function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

async function readJsonIfPresent(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function selectedDesiredState(hostRoot: string): Promise<{
  readonly state: DesiredModState;
  readonly generationId: string;
  readonly pointerPath: string;
  readonly pointerCanonical: string | null;
  readonly lock: CanonicalModLock | null;
}> {
  const catalog = createFirstPartyModCatalog();
  const pointerPath = join(hostRoot, 'current-generation.json');
  const pointerInput = await readJsonIfPresent(pointerPath);
  const desiredPath = join(hostRoot, 'desired-state.json');
  const desiredInput = await readJsonIfPresent(desiredPath);

  if (pointerInput === undefined) {
    if (desiredInput !== undefined) throw new Error('modular desired state exists without a canonical generation pointer');
    return {
      state: createFullCompatDesiredState(catalog, '1970-01-01T00:00:00.000Z'),
      generationId: 'generated:first-party-full-compat',
      pointerPath,
      pointerCanonical: null,
      lock: null,
    };
  }
  if (desiredInput === undefined) throw new Error('canonical generation pointer exists without desired state');

  const pointer = pointerInput as Record<string, unknown>;
  if (!Number.isSafeInteger(pointer.generation) || typeof pointer.graphHash !== 'string' || typeof pointer.lockHash !== 'string') {
    throw new Error('canonical generation pointer is malformed');
  }
  const generationRoot = join(hostRoot, 'generations', String(pointer.generation).padStart(16, '0'));
  const manifestInput = await readJsonIfPresent(join(generationRoot, 'generation.json')) as Record<string, unknown> | undefined;
  if (!manifestInput || typeof manifestInput.kernelVersion !== 'string') throw new Error('selected generation manifest is missing or malformed');
  const host = new DurableModHost(hostRoot, { kernelVersion: manifestInput.kernelVersion });
  const parsedPointer = await host.readCurrentPointer();
  if (!parsedPointer) throw new Error('canonical generation pointer disappeared during bootstrap');
  const manifest = await host.validateGeneration(parsedPointer.generation);
  if (parsedPointer.graphHash !== manifest.graphHash || parsedPointer.lockHash !== manifest.lockHash) {
    throw new Error('canonical pointer does not bind the selected generation');
  }
  const generationDesired = await readJsonIfPresent(join(generationRoot, 'desired-state.json'));
  const lock = await readJsonIfPresent(join(generationRoot, 'mods.lock.json')) as CanonicalModLock | undefined;
  if (!lock) throw new Error('selected generation lock is missing');
  assertSelectedLockIntegrity(lock, desiredInput);
  if (canonicalJson(generationDesired) !== canonicalJson(desiredInput)) {
    throw new Error('selected generation and host desired-state snapshots differ');
  }
  return {
    state: parseDesiredState(desiredInput),
    generationId: `generated:${parsedPointer.generation}:${parsedPointer.graphHash}`,
    pointerPath,
    pointerCanonical: canonicalJson(parsedPointer),
    lock,
  };
}

function createServices(hostRoot: string, manifest: ModManifest, runtime: GeneratedSurfaceRuntime, source: ModServices['source'] = 'bundled', contentHash = sha256Canonical(manifest)): ModServices {
  const state = new ModStateStore(hostRoot, manifest.id);
  const compatibility = {
    command: (kind: string, id: string, input: Json, context: Parameters<GeneratedSurfaceRuntime['command']>[3]) => runtime.command(kind === 'cli-command' ? 'cli' : 'tui', id, input, context),
    tool: (kind: string, id: string, input: Json, context: Parameters<GeneratedSurfaceRuntime['tool']>[3]) => runtime.tool(kind === 'mcp-tool' ? 'mcp' : 'cesar', id, input, context),
    parseIntent: (id: string, input: string) => runtime.parseIntent(id, input),
    lifecycle: async (id: string, payload: Json, context: Parameters<GeneratedSurfaceRuntime['tool']>[3]) => { await runtime.tool('cesar', id, payload, context); },
    render: (id: string, payload: Json) => runtime.renderDocs(id, payload),
  };
  return Object.freeze({
    identity: Object.freeze({ id: manifest.id, version: manifest.version, contentHash }),
    source,
    logger: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
    receipts: Object.freeze({ record: async (kind: string, payload: Json) => sha256Canonical({ kind, payload }) }),
    permissions: Object.freeze({ check: async () => 'allow' as const }),
    state: Object.freeze({
      read: async <T extends Json>(key: string) => state.read<T>(key),
      write: async (key: string, value: Json) => state.write(key, value),
    }),
    engines: Object.freeze({ dispatch: async () => { throw new Error('engine dispatch is available only through the compatibility executor'); } }),
    firstPartyCompatibility: Object.freeze(compatibility),
  } as unknown as ModServices);
}

async function loadPackage(hostRoot: string, packageId: string, runtime: GeneratedSurfaceRuntime, decorateServices?: (manifest: ModManifest, services: ModServices) => ModServices): Promise<FirstPartySurfacePackage> {
  const loaded = await import(packageId) as FirstPartyModule;
  if (!loaded.MANIFEST || typeof loaded.createMod !== 'function') throw new Error(`invalid bundled first-party package: ${packageId}`);
  if (loaded.MANIFEST.id !== packageId.replace('@kernlang/agon-mod-', 'agon.')) {
    throw new Error(`bundled package identity mismatch: ${packageId} != ${loaded.MANIFEST.id}`);
  }
  const baseServices = createServices(hostRoot, loaded.MANIFEST, runtime);
  const services = decorateServices ? decorateServices(loaded.MANIFEST, baseServices) : baseServices;
  return Object.freeze({ manifest: loaded.MANIFEST, mod: await loaded.createMod(services), services });
}

function surfaceNames(entries: readonly GeneratedSurfaceCatalogEntry[]): readonly string[] {
  return entries.flatMap((entry) => [entry.publicId, ...entry.aliases].map((name) => `${entry.surface}\0${name}`));
}

function localFolderPublisher(modId: string): TrustPublisher {
  return Object.freeze({
    registryOrigin: 'local-user-folder',
    packageName: modId,
    provenanceIdentity: 'local-user',
    provenanceStatus: 'not-applicable',
  });
}

/** Read and validate the selected durable generation, then activate its physical first-party packages. */
export async function bootstrapFirstPartySurfaceGeneration(options: {
  readonly hostRoot: string;
  readonly runtime: GeneratedSurfaceRuntime;
  readonly modsRoot?: string;
  readonly safeMode?: boolean;
  readonly activationTimeoutMs?: number;
  readonly decorateFirstPartyServices?: (manifest: ModManifest, services: ModServices) => ModServices;
}): Promise<FirstPartySurfaceBoot> {
  if (options.safeMode) {
    const safeCatalog = createFirstPartyModCatalog();
    const safeHost = new DurableModHost(options.hostRoot, { kernelVersion: AGON_RUNTIME_VERSION });
    const safeSelection = await safeHost.boot();
    let safeDesired = createFullCompatDesiredState(safeCatalog, '1970-01-01T00:00:00.000Z');
    if (safeSelection.pointer) {
      const input = await readJsonIfPresent(join(safeHost.generationPath(safeSelection.pointer.generation), 'desired-state.json'));
      if (input !== undefined) safeDesired = parseDesiredState(input);
    }
    const disabledOwnerIds = safeCatalog.mods.map(({ modId }) => modId).sort();
    const activated = await activateFirstPartySurfaceGeneration({
      id: 'kernel-safe-mode',
      catalog: KERNEL_MANAGEMENT_SURFACE_CATALOG,
      runtime: options.runtime,
      packages: [],
      providedDependencyIds: HOST_PROVIDED_DEPENDENCY_IDS,
      disabledOwnerIds,
    });
    return Object.freeze({
      activated,
      desiredState: safeDesired,
      hostRoot: options.hostRoot,
      pointerPath: join(options.hostRoot, 'current-generation.json'),
      pointerCanonical: safeSelection.pointer ? canonicalJson(safeSelection.pointer) : null,
      activePackageIds: Object.freeze([]),
      disabledOwnerIds: Object.freeze(disabledOwnerIds),
      externalDiagnostics: Object.freeze([]),
    });
  }
  const selection = await selectedDesiredState(options.hostRoot);
  const catalog = createFirstPartyModCatalog();
  const resolved = resolveDesiredState(catalog, selection.state);
  if (selection.lock) assertSelectedLockPackageClosure(selection.lock, resolved.effectivePackages);
  const activePackageIds = catalog.mods.map(({ id }) => id).filter((id) => resolved.effectivePackages.includes(id)).sort();
  const activeOwners = new Set(catalog.mods.filter(({ id }) => activePackageIds.includes(id)).map(({ modId }) => modId));
  const disabledOwnerIds = catalog.mods.map(({ modId }) => modId).filter((id) => !activeOwners.has(id)).sort();
  const firstPartyPackages = await Promise.all(activePackageIds.map((id) => loadPackage(options.hostRoot, id, options.runtime, options.decorateFirstPartyServices)));
  if (selection.lock) assertFirstPartyPackagesMatchLock(activePackageIds, firstPartyPackages, selection.lock);

  const modsRoot = options.modsRoot ?? join(dirname(options.hostRoot), 'mods');
  const discovery = await discoverUserFolderModsDetailed(modsRoot);
  const externalDiagnostics: FolderModDiagnostic[] = [...discovery.diagnostics];
  const authority = new TrustGrantStore(options.hostRoot);
  const activation = new ExternalActivationStore(options.hostRoot);
  const activationIdentityFor = (candidate: (typeof discovery.candidates)[number]) => {
    const publisher = localFolderPublisher(candidate.manifest.id);
    return Object.freeze({ modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source,
      sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash,
      publisherHash: sha256Canonical(publisher) });
  };
  const persistActivationFailure = async (candidate: (typeof discovery.candidates)[number], phase: 'import' | 'factory' | 'activation' | 'catalog', error: unknown) => {
    try { await activation.recordFailure(activationIdentityFor(candidate), phase, error); }
    catch (persistenceError) { externalDiagnostics.push(Object.freeze({ entry: candidate.sourceLocator, code: 'EXTERNAL_AUTHORITY_FAILED',
      message: 'external activation failure could not be persisted', details: Object.freeze({ cause: String(persistenceError) }) })); }
  };
  let trustRecords: Awaited<ReturnType<typeof authority.readTrust>> = Object.freeze([]);
  let grantRecords: Awaited<ReturnType<typeof authority.readGrants>> = Object.freeze([]);
  let activationRecords: Awaited<ReturnType<typeof activation.read>> = Object.freeze([]);
  try {
    await activation.recover();
    [trustRecords, grantRecords, activationRecords] = await Promise.all([authority.readTrust(), authority.readGrants(), activation.read()]);
  } catch (error) {
    externalDiagnostics.push(Object.freeze({ entry: options.hostRoot, code: 'EXTERNAL_AUTHORITY_FAILED',
      message: 'external authority or activation state is corrupt; all external mods remain blocked', details: Object.freeze({ cause: String(error) }) }));
  }
  const allowedCandidates = externalDiagnostics.some(({ code }) => code === 'EXTERNAL_AUTHORITY_FAILED') ? [] : discovery.candidates.filter((candidate) => {
    const publisher = localFolderPublisher(candidate.manifest.id);
    const identity = { modId: candidate.manifest.id, version: candidate.manifest.version, source: candidate.source,
      sourceLocator: candidate.sourceLocator, contentHash: candidate.contentHash, manifestHash: candidate.manifestHash, publisherHash: sha256Canonical(publisher) };
    const allowed = evaluateThirdPartyAuthority({ ...identity, publisher }, candidate.manifest, trustRecords, grantRecords).allowed;
    const latest = activationRecords.filter((record) => record.modId === identity.modId && record.version === identity.version
      && record.source === identity.source && record.sourceLocator === identity.sourceLocator && record.contentHash === identity.contentHash
      && record.manifestHash === identity.manifestHash && record.publisherHash === identity.publisherHash)
      .sort((left, right) => right.sequence - left.sequence)[0];
    return allowed && latest?.enabled === true;
  });
  const resolution = resolveExternalFolderModsIsolated({ candidates: allowedCandidates, hostPackages: firstPartyPackages,
    kernelVersion: selection.lock?.kernelVersion ?? AGON_RUNTIME_VERSION });
  externalDiagnostics.push(...resolution.diagnostics);
  const prepared: Awaited<ReturnType<typeof prepareTrustedFolderMod>>[] = [];
  const failedPreparation = new Set<string>();
  try {
    // Worker startup is independent and expensive. Prepare the resolver-approved set concurrently,
    // then walk the deterministic topological order to cascade dependency failures.
    const preparationResults = await Promise.all(resolution.candidates.map(async (candidate) => {
      try {
        const services = createSafeExternalModServices({ hostRoot: options.hostRoot, manifest: candidate.manifest,
          contentHash: candidate.contentHash, source: candidate.source });
        const entry = await prepareTrustedFolderMod({
          candidate,
          publisher: localFolderPublisher(candidate.manifest.id),
          trustRecords,
          grantRecords,
          readAuthority: async () => ({ trustRecords: await authority.readTrust(), grantRecords: await authority.readGrants() }),
          services,
          capabilityRuntime: { dispatchEngine: async (engineId, prompt, context) =>
            options.runtime.tool('cesar', 'engine.dispatch', { engineId, prompt }, context) },
          safeMode: false,
          timeoutMs: options.activationTimeoutMs,
        });
        return Object.freeze({ candidate, entry, error: undefined });
      } catch (error) {
        return Object.freeze({ candidate, entry: undefined, error });
      }
    }));
    for (const result of preparationResults) {
      const failedDependencies = result.candidate.manifest.dependencies.required.map(({ id }) => id).filter((id) => failedPreparation.has(id));
      if (result.error !== undefined) {
        failedPreparation.add(result.candidate.manifest.id);
        await persistActivationFailure(result.candidate, 'import', result.error);
        externalDiagnostics.push(Object.freeze({ entry: result.candidate.sourceLocator, code: 'EXTERNAL_ACTIVATION_FAILED',
          message: `external mod import or factory failed and remains blocked: ${result.candidate.manifest.id}`,
          details: Object.freeze({ modId: result.candidate.manifest.id, cause: String(result.error) }) }));
      } else if (failedDependencies.length > 0) {
        failedPreparation.add(result.candidate.manifest.id);
        await result.entry?.dispose().catch(() => undefined);
        externalDiagnostics.push(Object.freeze({ entry: result.candidate.sourceLocator, code: 'EXTERNAL_ACTIVATION_FAILED',
          message: `external mod remains blocked because a dependency failed: ${result.candidate.manifest.id}`,
          details: Object.freeze({ modId: result.candidate.manifest.id, failedDependencies }) }));
      } else if (result.entry) prepared.push(result.entry);
    }
    const occupiedSurfaceNames = new Set(surfaceNames([...FIRST_PARTY_SURFACE_CATALOG, ...KERNEL_MANAGEMENT_SURFACE_CATALOG]));
    const acceptedPrepared: typeof prepared = [];
    const acceptedOwnerIds = new Set(firstPartyPackages.map(({ manifest }) => manifest.id));
    for (const entry of prepared) {
      const missingRequired = entry.manifest.dependencies.required.map(({ id }) => id).filter((id) => !acceptedOwnerIds.has(id));
      const entries = createExternalSurfaceCatalog([entry.candidate]);
      const collisions = surfaceNames(entries).filter((name) => occupiedSurfaceNames.has(name));
      if (missingRequired.length || collisions.length) {
        await persistActivationFailure(entry.candidate, 'catalog', new Error(JSON.stringify({ missingRequired, collisions })));
        await entry.dispose().catch(() => undefined);
        externalDiagnostics.push(Object.freeze({ entry: entry.candidate.sourceLocator, code: 'EXTERNAL_ACTIVATION_FAILED',
          message: `external mod surface collision or unavailable dependency was isolated: ${entry.manifest.id}`,
          details: Object.freeze({ modId: entry.manifest.id, missingRequired, collisions }) }));
        continue;
      }
      acceptedPrepared.push(entry);
      acceptedOwnerIds.add(entry.manifest.id);
      for (const name of surfaceNames(entries)) occupiedSurfaceNames.add(name);
    }
    prepared.splice(0, prepared.length, ...acceptedPrepared);
    const externalPackages: FirstPartySurfacePackage[] = prepared.map((entry) => Object.freeze({
      manifest: entry.manifest,
      services: entry.services,
      mod: Object.freeze({
        apiVersion: '1' as const,
        activate: async (registrar: Registrar, _services: ModServices) => {
          const dispose = await activatePreparedThirdPartyMod(entry, registrar, options.activationTimeoutMs);
          return async () => {
            try { if (dispose) await dispose(); }
            finally { await entry.dispose(); }
          };
        },
      }),
    }));
    const surfaceCatalog = Object.freeze([
      ...FIRST_PARTY_SURFACE_CATALOG,
      ...KERNEL_MANAGEMENT_SURFACE_CATALOG,
      ...createExternalSurfaceCatalog(prepared.map(({ candidate }) => candidate)),
    ]);
    const activated = await activateFirstPartySurfaceGeneration({
      id: selection.generationId,
      catalog: surfaceCatalog,
      runtime: options.runtime,
      packages: [...firstPartyPackages, ...externalPackages],
      providedDependencyIds: HOST_PROVIDED_DEPENDENCY_IDS,
      disabledOwnerIds,
      isolatePackageFailure: async (candidate, error) => {
        const entry = prepared.find(({ manifest }) => manifest.id === candidate.manifest.id);
        if (!entry) return false;
        await persistActivationFailure(entry.candidate, 'activation', error);
        await entry.dispose().catch(() => undefined);
        externalDiagnostics.push(Object.freeze({ entry: entry.candidate.sourceLocator, code: 'EXTERNAL_ACTIVATION_FAILED',
          message: `external mod activation failed and remains blocked: ${candidate.manifest.id}`,
          details: Object.freeze({ modId: candidate.manifest.id, cause: String(error) }) }));
        return true;
      },
    });
    for (const entry of prepared.filter(({ manifest }) => !activated.failedOwnerIds.includes(manifest.id))) {
      try { await activation.recordSuccess(activationIdentityFor(entry.candidate)); }
      catch (error) { externalDiagnostics.push(Object.freeze({ entry: entry.candidate.sourceLocator, code: 'EXTERNAL_AUTHORITY_FAILED',
        message: 'successful activation could not be recorded durably', details: Object.freeze({ cause: String(error) }) })); }
    }
    return Object.freeze({ activated, desiredState: selection.state, hostRoot: options.hostRoot,
      pointerPath: selection.pointerPath, pointerCanonical: selection.pointerCanonical,
      activePackageIds: Object.freeze(activePackageIds), disabledOwnerIds: Object.freeze(disabledOwnerIds),
      externalDiagnostics: Object.freeze(externalDiagnostics) });
  } catch (error) {
    for (const entry of [...prepared].reverse()) await entry.dispose().catch(() => undefined);
    throw error;
  }
}
