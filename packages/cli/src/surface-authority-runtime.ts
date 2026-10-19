import { readFileSync } from 'node:fs';
import type { EngineAdapter } from '@kernlang/agon-core';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { BrainstormWorkflowEvent } from '@kernlang/agon-mod-brainstorm';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  FIRST_PARTY_SURFACE_CATALOG,
  AGON_RUNTIME_VERSION,
  DurableModHost,
  DurableHostError,
  SurfaceGeneration,
  SurfaceGenerationError,
  SurfaceGenerationSelector,
  bootstrapFirstPartySurfaceGeneration,
  canonicalJson,
  selectModSettings,
} from '@kernlang/agon-kernel';
import type {
  FirstPartySurfaceBoot,
  GeneratedSurfaceCatalogEntry,
  GeneratedSurfaceRuntime,
  GenerationPointer,
  Surface,
  SurfaceClient,
} from '@kernlang/agon-kernel';

const compatibilityRuntime: GeneratedSurfaceRuntime = Object.freeze({
  command: () => { throw new Error('generated registry payloads execute through the CLI compatibility adapter'); },
  tool: () => { throw new Error('generated registry payloads execute through the tool compatibility adapter'); },
  parseIntent: () => undefined,
  renderDocs: (publicId: string) => ({ text: publicId }),
});

let selector = new SurfaceGenerationSelector(new SurfaceGeneration({
  id: 'bootstrap:full-compat',
  mode: 'legacy-authoritative',
  catalog: FIRST_PARTY_SURFACE_CATALOG,
  runtime: compatibilityRuntime,
}));
let boot: FirstPartySurfaceBoot | undefined;
const clients = new Map<Surface, SurfaceClient>();
const pendingLeaseCleanup = new Set<DurableModHost>();
let leaseCleanupTimer: ReturnType<typeof setTimeout> | undefined;
let leaseCleanupDrain: Promise<void> | undefined;

function scheduleLeaseCleanup(): void {
  if (!pendingLeaseCleanup.size || leaseCleanupTimer || leaseCleanupDrain) return;
  leaseCleanupTimer = setTimeout(() => {
    leaseCleanupTimer = undefined;
    void drainLeaseCleanup().catch(error => {
      console.warn(`[agon] generation lease cleanup remains pending: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, 1_000);
  leaseCleanupTimer.unref();
}

function retainLeaseCleanup(host: DurableModHost): void {
  pendingLeaseCleanup.add(host);
  scheduleLeaseCleanup();
}

function drainLeaseCleanup(): Promise<void> {
  if (leaseCleanupDrain) return leaseCleanupDrain;
  if (leaseCleanupTimer) { clearTimeout(leaseCleanupTimer); leaseCleanupTimer = undefined; }
  leaseCleanupDrain = (async () => {
    const errors: unknown[] = [];
    for (const host of [...pendingLeaseCleanup]) {
      try { await host.retryGenerationLeaseCleanup(); pendingLeaseCleanup.delete(host); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'generation lease cleanup needs recovery');
  })().finally(() => {
    leaseCleanupDrain = undefined;
    scheduleLeaseCleanup();
  });
  return leaseCleanupDrain;
}

export function modularHostRoot(): string {
  return process.env.AGON_MODULAR_HOST_ROOT ?? join(process.env.AGON_HOME ?? join(homedir(), '.agon'), 'modular-host');
}

export async function initializeProcessSurfaceAuthority(
  hostRoot = modularHostRoot(),
  decorateFirstPartyServices?: Parameters<typeof bootstrapFirstPartySurfaceGeneration>[0]['decorateFirstPartyServices'],
): Promise<void> {
  if (boot) return;
  const safeMode = process.env.AGON_MOD_SAFE_MODE === '1';
  // Recovery must not import optional feature packages or their host effects.
  const services = safeMode ? undefined : await import('./first-party-services.js');
  const candidate = await bootstrapFirstPartySurfaceGeneration({
    hostRoot,
    runtime: compatibilityRuntime,
    safeMode,
    decorateFirstPartyServices: decorateFirstPartyServices ?? services?.decorateCliFirstPartyServices,
    dispatchEngine: services?.createCliEngineServices().dispatch,
  });
  selector = new SurfaceGenerationSelector(candidate.activated.generation);
  boot = candidate;
  clients.clear();
}

export async function disposeProcessSurfaceAuthority(): Promise<void> {
  const selected = boot;
  boot = undefined;
  clients.clear();
  const outcomes = await Promise.allSettled([
    selected?.activated.dispose(),
    drainLeaseCleanup(),
  ]);
  const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'modular host disposal and lease cleanup failed');
}

export function assertCanonicalSurfaceSelectionCurrent(): void {
  if (!boot || boot.activated.generation.id === 'kernel-safe-mode') return;
  let current: string | null;
  try {
    current = canonicalJson(JSON.parse(readFileSync(boot.pointerPath, 'utf8')));
  } catch (error) {
    if (boot.pointerCanonical === null && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', 'canonical modular generation changed or became unreadable; restart Agon', true);
  }
  if (current !== boot.pointerCanonical) {
    throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', 'canonical modular generation changed; restart Agon', true);
  }
}

export function processSurfaceClient(surface: Surface): SurfaceClient {
  assertCanonicalSurfaceSelectionCurrent();
  const existing = clients.get(surface);
  if (existing) return existing;
  const client = selector.client(surface);
  clients.set(surface, client);
  return client;
}

export function assertProcessSurfaceAvailable(surface: Surface, publicId: string): void {
  assertCanonicalSurfaceSelectionCurrent();
  processSurfaceClient(surface).assertAvailable(publicId);
}

/** Bind captured host effects to this exact host lifetime, not whichever
 * generation happens to be globally selected when a cached closure runs. */
export function captureProcessSurfaceAuthority(): () => void {
  assertCanonicalSurfaceSelectionCurrent();
  const selectedBoot = boot;
  const selectedSelector = selector;
  return () => {
    if (boot !== selectedBoot || selector !== selectedSelector) {
      throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', 'captured modular host was disposed or replaced; rebuild the invocation after restart', true);
    }
    assertCanonicalSurfaceSelectionCurrent();
  };
}

/** Guard provider entry points without changing the session's shared adapter. */
export function guardProcessEngineAdapter(adapter: EngineAdapter, assertAvailable: () => void): EngineAdapter {
  if (!boot) return adapter;
  const assertSelected = captureProcessSurfaceAuthority();
  const check = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    assertSelected();
    assertAvailable();
  };
  return guardEngineAdapter(adapter, check);
}

/** Keep a running invocation pinned; request cooperative cancellation if its
 * authority becomes stale. Never switch its registry or abandon its cleanup. */
export async function withProcessSurfaceAuthority<T>(
  parentSignal: AbortSignal | undefined,
  assertAvailable: (signal?: AbortSignal) => void,
  run: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  const selected = boot;
  // The rollback compatibility catalog has no durable generation to monitor.
  if (!selected) return run(parentSignal);
  if (pendingLeaseCleanup.size) await drainLeaseCleanup();
  parentSignal?.throwIfAborted();
  assertAvailable(parentSignal);
  const host = selected.pointerCanonical && selected.activated.generation.id !== 'kernel-safe-mode'
    ? new DurableModHost(selected.hostRoot, { kernelVersion: AGON_RUNTIME_VERSION }) : undefined;
  const pointer = selected.pointerCanonical ? JSON.parse(selected.pointerCanonical) as GenerationPointer : undefined;
  let lease;
  try {
    lease = host && pointer ? await host.leaseGeneration(pointer.generation, 'agon.kernel.invocation', parentSignal) : undefined;
  } catch (error) {
    if (host) retainLeaseCleanup(host);
    throw error;
  }
  const child = new AbortController();
  const cancel = () => child.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', cancel, { once: true });
  const monitor = setInterval(() => {
    if (child.signal.aborted) return;
    try {
      if (boot !== selected) throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', 'modular host was disposed or replaced; restart Agon', true);
      assertAvailable(child.signal);
    } catch (error) {
      child.abort(error);
    }
  }, 100);
  monitor.unref();
  let outcome: { completed: true; value: T } | { completed: false; error: unknown };
  try {
    // Lease acquisition can wait for a writer. Recheck authority before effects.
    parentSignal?.throwIfAborted();
    if (boot !== selected) throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', 'modular host was disposed or replaced; restart Agon', true);
    assertAvailable(child.signal);
    const value = await run(child.signal);
    // The caller owns result semantics, including structured cancellation results.
    outcome = { completed: true, value };
  } catch (error) {
    outcome = { completed: false, error };
  } finally {
    clearInterval(monitor);
    parentSignal?.removeEventListener('abort', cancel);
  }
  if (host && lease) {
    try { await host.releaseGenerationLease(lease.leaseId); }
    catch (cleanup) {
      retainLeaseCleanup(host);
      if (!outcome.completed) throw new AggregateError([outcome.error, cleanup], 'invocation and generation lease cleanup failed');
      throw new DurableHostError('MOD_RESTART_REQUIRED', 'invocation completed but generation lease cleanup failed; do not repeat its effects', {
        outcome: 'invocation-completed', leaseId: lease.leaseId, generation: lease.generation,
        cause: cleanup instanceof Error ? cleanup.message : String(cleanup),
      });
    }
  }
  if (!outcome.completed) throw outcome.error;
  return outcome.value;
}

export function processSurfacePublicIds(surface: Surface): ReadonlySet<string> {
  assertCanonicalSurfaceSelectionCurrent();
  return new Set(selector.active.catalog(surface).map(({ publicId }) => publicId));
}

export function processSurfaceNames(surface: Surface): ReadonlySet<string> {
  assertCanonicalSurfaceSelectionCurrent();
  return new Set(selector.active.catalog(surface).flatMap(({ publicId, aliases }) => [publicId, ...aliases]));
}

export function processSurfaceCatalog(surface: Surface): readonly GeneratedSurfaceCatalogEntry[] {
  assertCanonicalSurfaceSelectionCurrent();
  return selector.active.catalog(surface);
}

/** Resolve a step by its executor key, not by caller-supplied step data. */
export function assertProcessPlanStepAvailable(publicId: string): void {
  const entries = processSurfaceCatalog('cesar').filter(entry => entry.kind === 'plan-step'
    && (entry.publicId === publicId || entry.aliases.includes(publicId)));
  if (!entries.length) throw new SurfaceGenerationError('MOD_SURFACE_UNAVAILABLE', `Plan step '${publicId}' is unavailable`);
  if (new Set(entries.map(entry => entry.owner.id)).size !== 1) {
    throw new SurfaceGenerationError('MOD_SURFACE_AMBIGUOUS', `Plan step '${publicId}' has ambiguous owners`);
  }
}

/** Execute the exact owner-tagged physical Cesar route selected by the active
 * generation. This is the only bridge the TUI orchestration router may use;
 * it deliberately selects the registry record rather than importing a legacy
 * workflow implementation. */
export async function executeProcessCesarRoute(
  publicId: string,
  input: Record<string, unknown>,
  context: { readonly cwd: string; readonly signal: AbortSignal; readonly onWorkflowEvent?: (event: BrainstormWorkflowEvent) => void },
): Promise<unknown> {
  const assertSelected = captureProcessSurfaceAuthority();
  if (!boot) throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', 'modular surface authority is not initialized', true);
  const entry = selector.active.catalog('cesar').find((candidate) =>
    candidate.kind === 'plan-step'
    && candidate.ownerClass === 'user-toggleable-mod-package'
    && (candidate.publicId === publicId || candidate.aliases.includes(publicId)));
  if (!entry) throw new SurfaceGenerationError('MOD_SURFACE_UNAVAILABLE', `Cesar route '${publicId}' is unavailable`, false);
  const record = processSurfaceClient('cesar').project().entries.find((candidate) =>
    candidate.kind === entry.kind && candidate.id === entry.registryId);
  const payload = record?.payload as { run?: (value: unknown, invocation: unknown) => Promise<unknown> | unknown } | undefined;
  if (!payload?.run) throw new SurfaceGenerationError('MOD_SURFACE_UNAVAILABLE', `Cesar route '${publicId}' has no executable payload`, false);
  const platform = `${process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform))
    throw new Error(`unsupported platform: ${platform}`);
  const { loadConfig } = await import('@kernlang/agon-core');
  assertSelected();
  return payload.run(input, {
    invocationId: `cesar-route-${Date.now()}`,
    onWorkflowEvent: context.onWorkflowEvent,
    cwd: context.cwd,
    platform,
    signal: context.signal,
    config: selectModSettings(loadConfig(context.cwd), entry.owner.id),
  });
}

export function parseProcessFirstPartyIntent(command: string, input: string):
  | { readonly authoritative: false }
  | {
      readonly authoritative: true;
      readonly publicId: string;
      readonly registryId: string;
      readonly kind: GeneratedSurfaceCatalogEntry['kind'];
      readonly value: unknown;
    } {
  assertCanonicalSurfaceSelectionCurrent();
  if (!boot) return { authoritative: false };
  const entries = selector.active.catalog('tui');
  const directIntents = entries.filter((candidate) => candidate.kind === 'intent'
    && candidate.ownerClass === 'user-toggleable-mod-package'
    && (candidate.publicId === command || candidate.aliases.includes(command)));
  const matchingActions = entries.filter((candidate) => candidate.kind === 'tui-action'
      && candidate.ownerClass === 'user-toggleable-mod-package'
      && ([candidate.publicId, ...candidate.aliases].some((name) => name.replace(/^\//, '').toLowerCase() === command)));
  const actionIntents = matchingActions.flatMap((action) => {
    const canonical = action.publicId.replace(/^\//, '').toLowerCase().split(/\s+/)[0];
    return entries.filter((candidate) => candidate.kind === 'intent' && candidate.owner.id === action.owner.id
      && [candidate.publicId, ...candidate.aliases].some((name) => name.replace(/^\//, '').toLowerCase() === canonical));
  });
  const candidates = [...directIntents, ...actionIntents, ...matchingActions];
  const projected = processSurfaceClient('tui').project().entries;
  const selected = candidates.map((entry) => ({ entry, record: projected.find((candidate) => candidate.kind === entry.kind && candidate.id === entry.registryId) }))
    .find(({ record }) => typeof (record?.payload as { parse?: unknown } | undefined)?.parse === 'function');
  if (!selected) return { authoritative: false };
  const { entry, record } = selected;
  const parse = (record!.payload as { parse: (value: string) => unknown }).parse;
  const value = parse(input);
  if (value && typeof value === 'object' && 'then' in value) {
    throw new Error(`bundled first-party intent parser must be synchronous: ${entry.owner.id}/${entry.registryId}`);
  }
  return {
    authoritative: true,
    publicId: entry.publicId.replace(/^\//, ''),
    registryId: entry.registryId,
    kind: entry.kind,
    value,
  };
}
