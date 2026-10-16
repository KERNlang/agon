import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { doneOracleDecision, evaluateDoneEvidence, parseBuilderSignals, buildConquerSystemPrompt } from './completion-policy.js';
export type { DoneOracleInput, DoneEvidenceInput } from './completion-policy.js';
export { runConquerWorkflow, ESCAPING_OPS, DONE_SENTINEL, ASK_SENTINEL, DEFAULT_PROTECTED_PUSH_BRANCHES, pickEscalationMode, classifyStuck, shouldEscalate, shouldAutoApprove, summarizeConsultForBuilder, isProtectedPushBranch, capBreached, classifyAsk, buildConquerTurnPrompt } from './workflow.js';
export type { ConquerWorkflowOptions, ConquerWorkflowEffects, StuckSignals, ConquerCaps, ConquerState, ConquerTurn, ConquerResult } from './workflow.js';
export { isAgentCapableEngine, buildFalsifierPrompt, parseFalsifierOutput, isSafeCounterexample, runDoneFalsifier, runDoneOracle } from './falsifier.js';
export type { SandboxOps, FalsifierResult, FalsifierOptions, FalsifierEffects, DoneOracleOptions, DoneOracleResult } from './falsifier.js';
export { createConquerHostServices } from './host.js';
export type { ConquerHostServices, ConquerPublicationPolicy } from './host.js';
export { createConquerIsolation } from './isolation.js';
export type { ConquerIsolation, ConquerIsolationEffects } from './isolation.js';
export { publishConquerBranch } from './publication.js';
export type { ConquerPublicationOptions, ConquerPublicationGit, ConquerPublicationResult } from './publication.js';
