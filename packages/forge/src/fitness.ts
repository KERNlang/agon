import { worktreeDiff, diffLineCount, diffFileCount } from '@kernlang/agon-core';
import { runFitness as runOwnedFitness } from '@kernlang/agon-mod-forge';
import { runSyntaxCheck } from './quality.js';

export { normalizeFitnessCommandForShell } from '@kernlang/agon-mod-forge';

export function runFitness(options: Parameters<typeof runOwnedFitness>[0]): ReturnType<typeof runOwnedFitness> {
  return runOwnedFitness(options, { worktreeDiff, diffLineCount, diffFileCount, runSyntaxCheck });
}
