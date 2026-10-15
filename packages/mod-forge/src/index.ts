import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export type {
  ForgeOptions, EngineResult, SkippedEngine, DispatchMetric, ForgeManifest,
  ConvergenceEntry, ForgeJudgment, ForgeEventType, ForgeEvent, ForgeEventMap,
  ForgeEventCallback, BreakerArtifact, GauntletResult, CorpusEntry, GapPattern,
  StageResult, WorktreeEntry, Critique, SynthesisResult,
} from './types.js';
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runForgeCompetition } from './implementation.js';
export { createForgeWorkflow } from './workflow.js';
export type { ForgeWorkflowConfig, ForgeWorkflowRegistry, ForgeWorkflowEffects } from './workflow.js';
export type { ForgeHostServices, ForgeModServices, ForgeInvocationContext } from './host.js';
export { planSynthesis } from './synth-plan.js';
export { createForgeCorpus } from './corpus.js';
export type { CorpusRecord } from './corpus.js';
export { runGauntlet, validateBreakerArtifact, buildBreakerPrompt, buildRepairPrompt } from './gauntlet.js';
export type { GauntletRuntime } from './gauntlet.js';
export { computeScore, tiebreak, DEFAULT_WEIGHTS } from './scoring.js';
export type { FitnessResult, ScoreWeights, ScoreComponents } from './scoring.js';
export { runLint, runStyleCheck, runSyntaxCheck, changedFilesIncludingUntracked, MAX_SYNTAX_FILE_BYTES } from './quality.js';
export type { SyntaxCheckResult, ForgeSyntaxRuntime } from './quality.js';
export { runFitness, normalizeFitnessCommandForShell } from './fitness.js';
export type { ForgeFitnessRuntime } from './fitness.js';
export { createForgeStages, resolveForgeDispatchTimeout, shouldHarvestFailedDispatch } from './stages.js';
export type { ForgeStageConfig, ForgeStageRegistry, ForgeStageRuntime } from './stages.js';
export { buildForgePrompt, buildCritiquePrompt, buildSynthesisPrompt, buildForgePromptWithContext } from './prompts.js';
export { buildStageContext, renderStageContext } from './stage-context.js';
export type { StageContext, StageDecision, ToolResultRef } from './stage-context.js';
export { createForgeSynthesis, parseCritiques } from './synthesis.js';
export type { ForgeSynthesisRuntime } from './synthesis.js';
export { FitnessError } from './errors.js';
export { createForgeManifestStore, readManifest } from './manifest.js';
export type { ForgeManifestRuntime } from './manifest.js';
export type { SynthCandidate, SynthPlanOpts, SynthPlan } from './synth-plan.js';
export { resolveForgeMode, resolveForgeRequireDiff, resolveForgeAcceptReviewOutput, classifyNoDiffForgeResult } from './result-policy.js';
