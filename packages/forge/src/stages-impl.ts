import { worktreeCreate, worktreeRemoveBestEffort, repoRoot, estimateTokens, estimateCost, estimateCostCacheAware, worktreeDiff, diffLineCount, diffFileCount } from '@kernlang/agon-core';
import { createForgeStages } from '@kernlang/agon-mod-forge';
import { runSyntaxCheck } from './quality.js';

export {
  resolveForgeMode, resolveForgeRequireDiff, resolveForgeAcceptReviewOutput,
  classifyNoDiffForgeResult, resolveForgeDispatchTimeout, shouldHarvestFailedDispatch,
} from '@kernlang/agon-mod-forge';

/** Bind legacy host effects until the legacy Forge entrypoint retires. */
const stages = createForgeStages({
  worktreeCreate, worktreeRemoveBestEffort, repoRoot, estimateTokens, estimateCost, estimateCostCacheAware,
  fitness: { worktreeDiff, diffLineCount, diffFileCount, runSyntaxCheck },
});
export const { runForgeEngineAttempt, runBaseline, runStage1, runStage2 } = stages;
