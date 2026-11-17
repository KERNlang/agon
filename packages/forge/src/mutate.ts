import type { EngineRegistry } from '@kernlang/agon-core';
import { runLegacyMutate } from '@kernlang/agon-mod-mutate';
import type { MutateOptions as OwnerMutateOptions, MutateResult } from '@kernlang/agon-mod-mutate';
import { resolveMutateTargets } from './mutate-targets.js';
import { collectSemanticMutants } from './mutate-semantic.js';
import { prepareNodeSandbox } from './mutate-sandbox.js';
import { formatMutateVerdict, staleDistHint } from './mutate-report.js';

export { isMutableFile, mutationTargetsFromDiff } from './mutate-targets.js';
export { dedupeMutants, selectMutants } from '@kernlang/agon-mod-mutate';
export type { MutateResult } from '@kernlang/agon-mod-mutate';

export interface MutateOptions extends Omit<OwnerMutateOptions, 'registry'> {
  registry: EngineRegistry;
}

/** Preserve the legacy registry and host bindings at the public boundary. */
export async function runMutate(opts: MutateOptions): Promise<MutateResult> {
  return runLegacyMutate(opts, {
    resolveMutateTargets,
    collectSemanticMutants,
    prepareNodeSandbox,
    formatMutateVerdict,
    staleDistHint,
  });
}
