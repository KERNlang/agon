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
} from './types.js';
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runForgeCompetition } from './implementation.js';
export { planSynthesis } from './synth-plan.js';
export type { SynthCandidate, SynthPlanOpts, SynthPlan } from './synth-plan.js';
export { resolveForgeMode, resolveForgeRequireDiff, resolveForgeAcceptReviewOutput, classifyNoDiffForgeResult } from './result-policy.js';
