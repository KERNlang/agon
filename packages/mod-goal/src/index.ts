import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runGoal } from './implementation.js';
export { createGoalHostServices } from './host.js';
export type { GoalHostServices, GoalModServices, GoalWorktree, GoalWorktreeEffects, GoalTaskAcceptance } from './host.js';
export type { GoalSpec, AttemptRecord, GoalTask, GoalEvent, JournalState } from './journal-types.js';
export { createGoalJournalStore, createJournal, addTasks, requeueInflightTasks, nextTask, markStatus, recordAttempt, remainingCount, isDone, logEvent, boundEvents, GOAL_EVENT_CAP } from './journal.js';
export type { GoalJournalEffects } from './journal.js';
export { assertSafeGoalId, safePathSegment } from './paths.js';
export { createGoalOracle, hashOracleInputs, oracleTampered } from './oracle.js';
export type { GoalOracleEffects, FrozenOracle, WitnessResult } from './oracle.js';
export { createGoalOracleProbe } from './oracle-probe.js';
export type { GoalOracleProbeEffects } from './oracle-probe.js';
export { buildOracleCheatPrompt, oracleGateDecision, oracleProbeConclusive, DEFAULT_ORACLE_GATE } from './oracle-redteam.js';
export type { OracleHole } from './oracle-redteam.js';
export { createGoalMutationRunner } from './mutation.js';
export type { GoalMutationEffects } from './mutation.js';
export { gateFailureSignature, taskParkDecision, pushRecentOutcome, globalBreaker, pickImplementWinner, chooseImplementRoster, mutationGateDecision, foldMutationVerdicts, budgetExceeded, timeExceeded } from './policy.js';
