import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  SurfaceGenerationError,
  bootstrapFirstPartySurfaceGeneration,
  canonicalJson,
} from '@kernlang/agon-kernel';
import type { FirstPartySurfaceBoot, GeneratedSurfaceRuntime } from '@kernlang/agon-kernel';

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
  boot = await bootstrapFirstPartySurfaceGeneration({ hostRoot: hostRoot(), runtime: compatibilityRuntime });
}

export async function disposeMcpSurfaceAuthority(): Promise<void> {
  const selected = boot;
  boot = undefined;
  if (selected) await selected.activated.dispose();
}

export function assertMcpSurfaceSelectionCurrent(): void {
  if (!boot) throw new SurfaceGenerationError('MOD_SURFACE_UNAVAILABLE', 'MCP surface authority has not been initialized');
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
  return new Set(boot!.activated.generation.catalog('mcp').map(({ publicId }) => publicId));
}
