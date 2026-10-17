import { agonPath, ensureAgonHome, spawnWithTimeout, worktreeCreate, worktreeRemoveBestEffort } from '@kernlang/agon-core';
import { createGoalOracle } from '@kernlang/agon-mod-goal';
import { resolveWithin } from './paths.js';

export type { FrozenOracle, WitnessResult } from '@kernlang/agon-mod-goal';
export { hashOracleInputs, oracleTampered } from '@kernlang/agon-mod-goal';

export const { snapshotOracle, witnessTest, witnessVerifyCommand } = createGoalOracle({
  path: agonPath, ensureHome: ensureAgonHome,
  spawnWithTimeout, worktreeCreate, worktreeRemoveBestEffort, resolveWithin,
});
