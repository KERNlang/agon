import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  SurfaceGenerationError,
  assertContributionInput,
  bootstrapFirstPartySurfaceGeneration,
  canonicalJson,
} from '@kernlang/agon-kernel';
import type { FirstPartySurfaceBoot, GeneratedSurfaceRuntime } from '@kernlang/agon-kernel';
import { createMcpEngineServices, decorateMcpFirstPartyServices } from './first-party-services.js';

const compatibilityRuntime: GeneratedSurfaceRuntime = Object.freeze({
  command: () => { throw new Error('MCP host cannot execute CLI compatibility commands'); },
  tool: () => { throw new Error('generated registry payloads execute through the MCP compatibility adapter'); },
  parseIntent: () => undefined,
  renderDocs: (publicId: string) => ({ text: publicId }),
});

let boot: FirstPartySurfaceBoot | undefined;

function hostRoot(): string {
  return process.env.AGON_MODULAR_HOST_ROOT ?? join(process.env.AGON_HOME ?? join(homedir(), '.agon'), 'modular-host');
}

export async function initializeMcpSurfaceAuthority(): Promise<void> {
  if (boot) return;
  boot = await bootstrapFirstPartySurfaceGeneration({
    hostRoot: hostRoot(), runtime: compatibilityRuntime,
    safeMode: process.env.AGON_MOD_SAFE_MODE === '1',
    decorateFirstPartyServices: decorateMcpFirstPartyServices,
    dispatchEngine: createMcpEngineServices().dispatch,
  });
}

export async function disposeMcpSurfaceAuthority(): Promise<void> {
  const selected = boot;
  boot = undefined;
  if (selected) await selected.activated.dispose();
}

export function assertMcpSurfaceSelectionCurrent(): void {
  if (!boot) throw new SurfaceGenerationError('MOD_SURFACE_UNAVAILABLE', 'MCP surface authority has not been initialized');
  if (boot.activated.generation.id === 'kernel-safe-mode') return;
  let current: string | null;
  try {
    current = canonicalJson(JSON.parse(readFileSync(boot.pointerPath, 'utf8')));
  } catch (error) {
    if (boot.pointerCanonical === null && error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', 'canonical modular generation changed or became unreadable; restart MCP host', true);
  }
  if (current !== boot.pointerCanonical) {
    throw new SurfaceGenerationError('MOD_GENERATION_MISMATCH', 'canonical modular generation changed; restart MCP host', true);
  }
}

export function mcpSurfacePublicIds(): ReadonlySet<string> {
  assertMcpSurfaceSelectionCurrent();
  return new Set(boot!.activated.generation.catalog('mcp').flatMap(({ publicId, aliases }) => [publicId, ...aliases]));
}

export interface ActiveMcpSurfaceTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly ownerId: string;
}

export function activeMcpSurfaceTools(): readonly ActiveMcpSurfaceTool[] {
  assertMcpSurfaceSelectionCurrent();
  const generation = boot!.activated.generation;
  return Object.freeze(generation.catalog('mcp').flatMap((entry) => {
    const record = generation.registry.resolve(entry.kind, entry.registryId);
    if (!record) return [];
    const payload = record.payload as { readonly description: string; readonly inputSchema?: Record<string, unknown> };
    return [entry.publicId, ...entry.aliases].map((name) => Object.freeze({ name, description: payload.description, inputSchema: payload.inputSchema ?? { type: 'object' }, ownerId: record.owner.id }));
  }));
}

export async function invokeActiveMcpSurfaceTool(name: string, input: Record<string, unknown>, signal: AbortSignal = new AbortController().signal): Promise<unknown> {
  signal.throwIfAborted();
  assertMcpSurfaceSelectionCurrent();
  const record = boot!.activated.generation.assertAvailable('mcp', name);
  const payload = record.payload as { inputSchema: Record<string, unknown>; run(input: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown> | unknown };
  assertContributionInput(payload.inputSchema, input);
  const platform = `${process.platform}-${process.arch}`;
  if (!['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'].includes(platform)) throw new Error(`unsupported MCP platform: ${platform}`);
  return payload.run(input, {
    invocationId: randomUUID(), cwd: process.env.AGON_CWD ?? process.cwd(), platform,
    signal, config: Object.freeze({}),
  });
}
