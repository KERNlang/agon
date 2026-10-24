import { currentInvocationOwnerAvailable } from '@kernlang/agon-kernel';
import { judgeTribunalForRating } from '@kernlang/agon-mod-ratings';
import type { EngineRegistry } from '@kernlang/agon-core';
import { loadConfig, classifyTask, updateGlickoRanked, seedNewEnginesFromRegistry } from '@kernlang/agon-core';
import { createTribunalRuntime } from '@kernlang/agon-mod-tribunal';
import type { TribunalRuntimeOptions, TribunalResult } from '@kernlang/agon-mod-tribunal';

export { buildFallbackSummary, requireNonEmptyDispatchText } from '@kernlang/agon-mod-tribunal';
export type { TribunalPosition, TribunalRound, TribunalResult } from '@kernlang/agon-mod-tribunal';

// Retain legacy callers while the mod owns the runtime.
export const runTribunal: (options: TribunalRuntimeOptions<EngineRegistry>) => Promise<TribunalResult> =
  createTribunalRuntime<EngineRegistry>({
    loadConfig, classifyTask, updateRanked: updateGlickoRanked,
    seedRegistry: seedNewEnginesFromRegistry,
    judgeForRating: options => currentInvocationOwnerAvailable('agon.ratings') === false
      ? Promise.resolve([]) : judgeTribunalForRating({ ...options, config: loadConfig(options.cwd) }),
  });
