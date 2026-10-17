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
export type { GoalHostServices, GoalModServices, GoalWorktree, GoalWorktreeEffects } from './host.js';
export type { GoalSpec, AttemptRecord, GoalTask, GoalEvent, JournalState } from './journal-types.js';
export { gateFailureSignature, taskParkDecision, pushRecentOutcome, globalBreaker, pickImplementWinner, chooseImplementRoster, mutationGateDecision, foldMutationVerdicts, budgetExceeded, timeExceeded } from './policy.js';
