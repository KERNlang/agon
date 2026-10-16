import type { EngineAdapter } from '@kernlang/agon-core';

import { EngineRegistry } from '@kernlang/agon-core';

import { runDelegate } from './delegate.js';

export interface PrTextOptions {
  engineId: string;
  intent: string;
  context?: string | undefined;
  commits: string;
  diff: string;
  registry: EngineRegistry;
  adapter: EngineAdapter;
  timeout: number;
  outputDir: string;
  cwd?: string | undefined;
  signal?: AbortSignal | undefined;
}

export { buildPrTextPrompt, parsePrText } from '@kernlang/agon-mod-forge';
export type { PrTextResult } from '@kernlang/agon-mod-forge';
import { runPrText as runOwnedPrText } from '@kernlang/agon-mod-forge';
import type { PrTextResult } from '@kernlang/agon-mod-forge';

/** Bind legacy provider effects to the physical Forge owner. */
export function runPrText(opts: PrTextOptions): Promise<PrTextResult> {
  return runOwnedPrText(opts, {
    dispatch: async task => (await runDelegate({
      engineId: opts.engineId, task, cwd: opts.cwd, registry: opts.registry,
      adapter: opts.adapter, timeout: opts.timeout, outputDir: opts.outputDir,
      signal: opts.signal,
    })).response,
  });
}
