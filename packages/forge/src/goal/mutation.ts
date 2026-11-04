import { spawnWithTimeout, applyMutantToSource } from '@kernlang/agon-core';
import { createGoalMutationRunner } from '@kernlang/agon-mod-goal';
import { resolveWithin } from './paths.js';

export { generateMutants } from '@kernlang/agon-core';
export type { Mutant } from '@kernlang/agon-core';
export { applyMutantToSource };

export const mutationSurvivors = createGoalMutationRunner({
  spawnWithTimeout, applyMutantToSource, resolveWithin,
});
