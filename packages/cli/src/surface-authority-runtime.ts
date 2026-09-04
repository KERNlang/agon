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

export async function initializeProcessSurfaceAuthority(hostRoot = modularHostRoot()): Promise<void> {
  if (boot) return;
  const candidate = await bootstrapFirstPartySurfaceGeneration({
    hostRoot,
    runtime: compatibilityRuntime,
    safeMode: process.env.AGON_MOD_SAFE_MODE === '1',
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
