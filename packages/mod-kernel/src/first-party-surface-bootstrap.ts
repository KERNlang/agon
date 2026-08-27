import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AgonModV1, Json, ModManifest, ModServices } from '@kernlang/agon-mod-api';

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
import type { GeneratedSurfaceRuntime } from './surface-generation.js';

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

function createServices(manifest: ModManifest, runtime: GeneratedSurfaceRuntime): ModServices {
  const state = new Map<string, Json>();
  const compatibility = {
    command: (kind: string, id: string, input: Json, context: Parameters<GeneratedSurfaceRuntime['command']>[3]) => runtime.command(kind === 'cli-command' ? 'cli' : 'tui', id, input, context),
    tool: (kind: string, id: string, input: Json, context: Parameters<GeneratedSurfaceRuntime['tool']>[3]) => runtime.tool(kind === 'mcp-tool' ? 'mcp' : 'cesar', id, input, context),
    parseIntent: (id: string, input: string) => runtime.parseIntent(id, input),
    lifecycle: async (id: string, payload: Json, context: Parameters<GeneratedSurfaceRuntime['tool']>[3]) => { await runtime.tool('cesar', id, payload, context); },
    render: (id: string, payload: Json) => runtime.renderDocs(id, payload),
  };
  return Object.freeze({
    identity: Object.freeze({ id: manifest.id, version: manifest.version, contentHash: sha256Canonical(manifest) }),
    source: 'bundled' as const,
    logger: Object.freeze({ debug: () => undefined, info: () => undefined, warn: () => undefined }),
    receipts: Object.freeze({ record: async (kind: string, payload: Json) => sha256Canonical({ kind, payload }) }),
    permissions: Object.freeze({ check: async () => 'allow' as const }),
    state: Object.freeze({
      read: async <T extends Json>(key: string) => state.get(key) as T | undefined,
      write: async (key: string, value: Json) => { state.set(key, structuredClone(value)); },
    }),
    engines: Object.freeze({ dispatch: async () => { throw new Error('engine dispatch is available only through the compatibility executor'); } }),
    firstPartyCompatibility: Object.freeze(compatibility),
  } as unknown as ModServices);
}

async function loadPackage(packageId: string, runtime: GeneratedSurfaceRuntime): Promise<FirstPartySurfacePackage> {
  const loaded = await import(packageId) as FirstPartyModule;
  if (!loaded.MANIFEST || typeof loaded.createMod !== 'function') throw new Error(`invalid bundled first-party package: ${packageId}`);
  if (loaded.MANIFEST.id !== packageId.replace('@kernlang/agon-mod-', 'agon.')) {
    throw new Error(`bundled package identity mismatch: ${packageId} != ${loaded.MANIFEST.id}`);
  }
  const services = createServices(loaded.MANIFEST, runtime);
  return Object.freeze({ manifest: loaded.MANIFEST, mod: await loaded.createMod(services), services });
}

/** Read and validate the selected durable generation, then activate its physical first-party packages. */
export async function bootstrapFirstPartySurfaceGeneration(options: {
  readonly hostRoot: string;
  readonly runtime: GeneratedSurfaceRuntime;
}): Promise<FirstPartySurfaceBoot> {
  const selection = await selectedDesiredState(options.hostRoot);
  const catalog = createFirstPartyModCatalog();
  const resolved = resolveDesiredState(catalog, selection.state);
  if (selection.lock) assertSelectedLockPackageClosure(selection.lock, resolved.effectivePackages);
  const activePackageIds = catalog.mods.map(({ id }) => id).filter((id) => resolved.effectivePackages.includes(id)).sort();
  const activeOwners = new Set(catalog.mods.filter(({ id }) => activePackageIds.includes(id)).map(({ modId }) => modId));
  const disabledOwnerIds = catalog.mods.map(({ modId }) => modId).filter((id) => !activeOwners.has(id)).sort();
  const packages = await Promise.all(activePackageIds.map((id) => loadPackage(id, options.runtime)));
  if (selection.lock) assertFirstPartyPackagesMatchLock(activePackageIds, packages, selection.lock);
  const activated = await activateFirstPartySurfaceGeneration({
    id: selection.generationId,
    catalog: FIRST_PARTY_SURFACE_CATALOG,
    runtime: options.runtime,
    packages,
    disabledOwnerIds,
  });
  return Object.freeze({ activated, desiredState: selection.state, hostRoot: options.hostRoot,
    pointerPath: selection.pointerPath, pointerCanonical: selection.pointerCanonical,
    activePackageIds: Object.freeze(activePackageIds), disabledOwnerIds: Object.freeze(disabledOwnerIds) });
}
