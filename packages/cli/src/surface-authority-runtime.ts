import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  FIRST_PARTY_SURFACE_CATALOG,
  SurfaceGeneration,
  SurfaceGenerationError,
  SurfaceGenerationSelector,
  bootstrapFirstPartySurfaceGeneration,
  canonicalJson,
} from '@kernlang/agon-kernel';
import type {
  FirstPartySurfaceBoot,
  GeneratedSurfaceCatalogEntry,
  GeneratedSurfaceRuntime,
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

export function modularHostRoot(): string {
  return process.env.AGON_MODULAR_HOST_ROOT ?? join(process.env.AGON_HOME ?? join(homedir(), '.agon'), 'modular-host');
}

export async function initializeProcessSurfaceAuthority(
  hostRoot = modularHostRoot(),
  decorateFirstPartyServices?: Parameters<typeof bootstrapFirstPartySurfaceGeneration>[0]['decorateFirstPartyServices'],
): Promise<void> {
  if (boot) return;
  const decorate = decorateFirstPartyServices
    ?? (await import('./first-party-services.js')).decorateCliFirstPartyServices;
  const candidate = await bootstrapFirstPartySurfaceGeneration({
    hostRoot,
    runtime: compatibilityRuntime,
    safeMode: process.env.AGON_MOD_SAFE_MODE === '1',
    decorateFirstPartyServices: decorate,
    dispatchEngine: (await import('./first-party-services.js')).createCliEngineServices().dispatch,
  });
  selector = new SurfaceGenerationSelector(candidate.activated.generation);
  boot = candidate;
  clients.clear();
}

export async function disposeProcessSurfaceAuthority(): Promise<void> {
  const selected = boot;
  boot = undefined;
  clients.clear();
  if (selected) await selected.activated.dispose();
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

/** Execute the exact owner-tagged physical Cesar route selected by the active
 * generation. This is the only bridge the TUI orchestration router may use;
 * it deliberately selects the registry record rather than importing a legacy
 * workflow implementation. */
export async function executeProcessCesarRoute(
  publicId: string,
  input: Record<string, unknown>,
  context: { readonly cwd: string; readonly signal: AbortSignal },
): Promise<unknown> {
  assertCanonicalSurfaceSelectionCurrent();
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
  return payload.run(input, {
    invocationId: `cesar-route-${Date.now()}`,
    cwd: context.cwd,
    platform,
    signal: context.signal,
    config: Object.freeze({}),
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
