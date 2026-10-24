import { worktreeCreate, worktreeRemoveBestEffort } from '@kernlang/agon-core';
import { createGoalOracleProbe } from '@kernlang/agon-mod-goal';
import { goalDir } from './journal.js';

export const probeTaskOracle = createGoalOracleProbe({ goalDir, worktreeCreate, worktreeRemoveBestEffort });
