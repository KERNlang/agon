import { worktreeCreate, worktreeRemoveBestEffort, worktreeDiff, repoRoot, createSidechainLogger } from '@kernlang/agon-core';
import { runGauntlet as runOwnedGauntlet } from '@kernlang/agon-mod-forge';
import { runFitness } from './fitness.js';

export { buildBreakerPrompt, buildRepairPrompt, validateBreakerArtifact } from '@kernlang/agon-mod-forge';

/** Bind legacy effects until the legacy Forge caller retires. */
export function runGauntlet(options: Parameters<typeof runOwnedGauntlet>[0]) {
  return runOwnedGauntlet(options, {
    worktreeCreate, worktreeRemoveBestEffort, worktreeDiff, repoRoot, createSidechainLogger, runFitness,
  });
}
