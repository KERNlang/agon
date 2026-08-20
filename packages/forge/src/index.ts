export { runForge } from './forge.js';
export { runBrainstorm, runScout } from './brainstorm.js';
export { runNero, rankNeroCritics, applyNeroExploration, buildNeroPrompt, parseNeroVerdict, parseNeroConfidence } from './nero.js';
export type { NeroOptions, NeroResult } from './nero.js';
export { runResearch, buildResearchPrompt, formatResearchResult } from './research.js';
export type { ResearchOptions, ResearchResult, ResearchSource } from './research.js';
export {
  runCouncil, assignCouncilRoles, roleGuidance, buildCouncilBriefPrompt,
  buildRolePrompt, buildCritiquePrompt, buildChairmanPrompt, parseCouncilConfidence,
  DEFAULT_COUNCIL_ROLES,
} from './council.js';
export type { CouncilOptions, CouncilResult, CouncilSeat } from './council.js';
export { runTribunal } from './tribunal.js';
export { runSynthesis } from './synthesis.js';
export { runSynthesisModus, synthesisRoutingAdvice } from './synthesis-modus.js';
export type { SynthesisDraft, SynthesisSwap, SynthesisScore, SynthesisResult as SynthesisModusResult } from './synthesis-modus.js';
export { runBaseline, runStage1, runStage2, determineWinner } from './stages.js';
export { runFitness } from './fitness.js';
export { runLint, runStyleCheck } from './quality.js';
export { writeManifest, readManifest, updateManifest } from './manifest.js';
export type { StageResult, SynthesisResult, ForgeEventCallback, WorktreeEntry } from './types.js';
export type { TribunalResult, TribunalRound, TribunalPosition } from './tribunal.js';
export { getModeConfig, buildModePrompt, buildModeSummaryPrompt, isTribunalMode, isTribunalProtocol, TRIBUNAL_MODES, TRIBUNAL_PROTOCOLS } from './tribunal-modes.js';
export type { TribunalMode, TribunalModeConfig, TribunalProtocol } from './tribunal-modes.js';
// ── Gauntlet ──
export { runGauntlet } from './gauntlet.js';
export { addToCorpus, getCorpusForReplay, getGapPatterns, getCorpusStats, loadCorpus } from './corpus.js';
export type { CorpusRecord } from './corpus.js';
// ── Team Competition ──
export { runTeamForge, decideTeamWinner } from './team-forge.js';
export type { TeamForgeOptions } from './team-forge.js';
export { runTeamTribunal } from './team-tribunal.js';
export type { TeamTribunalOptions } from './team-tribunal.js';
export { runTeamBrainstorm } from './team-brainstorm.js';
export type { TeamBrainstormOptions } from './team-brainstorm.js';
// ── Campfire ──
export { runCampfire } from './campfire.js';
export type { CampfireResult } from './campfire.js';
// ── Sequential thinking ──
export { runThinkChain, buildThinkPrompt, parseThoughts, groundThoughts, validateChain, isThinkStrategy, joinProblemInput, selectBranch, runAdversarialCritique } from './thinking.js';
export type { ThoughtNode, ThinkResult } from './thinking.js';
// ── Naturalize (Phase 2: sanitize → non-author rewrite → re-scan) ──
export { runNaturalize, buildNaturalizePrompt, wordDiffStats } from './naturalize.js';
export type { NaturalizeOptions, NaturalizeResult } from './naturalize.js';
// ── Mutate (mutation testing as a test-strength oracle) ──
export {
  runMutate, dedupeMutants, selectMutants,
  mutationTargetsFromDiff, isMutableFile,
} from './mutate.js';
export type { MutateOptions, MutateResult } from './mutate.js';
// The ONE mutation-report renderer — every surface (mutate, /mutate, review
// --mutate) must render through formatMutationReportLines, never its own copy.
export {
  formatMutationReportLines, formatMutateVerdict, mutateVerdictLine,
  allMutantsSurvived, noMutantsRanLine, staleDistHint, mutateLensSuffix, MUTATE_ALL_SURVIVED_WARNING,
} from './mutate-report.js';
export {
  prepareSandboxNodeModules, clearShadowingDist, workspacePackageDirs,
  packageEntryDirs, repointWorkspaceLinks, isInside, isSafePackageName,
  pnpmWorkspaceGlobs, gitIgnoredPaths, expandWorkspaceGlob, workspaceGlobToRegExp,
} from './mutate-sandbox.js';
export type { SandboxNodeModules, SandboxLinkRepair } from './mutate-sandbox.js';
export {
  buildSemanticMutantPrompt, extractJsonArray, validateSemanticMutants, collectSemanticMutants,
  seatGrantsWriteAccess, stripControlChars, normalizeLens, MUTATE_LENS_PRESETS,
} from './mutate-semantic.js';
export type {
  SemanticTarget, SemanticTargetLine, SemanticMutantsResult, DroppedSemanticEntry,
} from './mutate-semantic.js';
// ── Delegate ──
export { runDelegate } from './delegate.js';
export type { DelegateResult } from './delegate.js';
// ── PR text (engine-written title/body for pushed branches) ──
export { runPrText, buildPrTextPrompt, parsePrText } from './pr-text.js';
export type { PrTextOptions, PrTextResult } from './pr-text.js';
// ── Goal controller ──
export type { GoalSpec, GoalTask, AttemptRecord, GoalEvent, JournalState } from './goal/types.js';
export {
  goalDir, journalPath, createJournal, saveJournal, loadJournal,
  addTasks, nextTask, markStatus, recordAttempt, remainingCount, isDone, logEvent, boundEvents,
} from './goal/journal.js';
export { assertSafeGoalId, resolveWithin, safePathSegment } from './goal/paths.js';
export type { Mutant } from './goal/mutation.js';
export { generateMutants, applyMutantToSource, mutationSurvivors } from './goal/mutation.js';
export type { FrozenOracle, WitnessResult } from './goal/oracle.js';
export { hashOracleInputs, snapshotOracle, oracleTampered, witnessTest } from './goal/oracle.js';
export { isTestFile, parseChangedLines, newFilesInDiff } from './goal/diff.js';
export { gateFailureSignature, taskParkDecision, globalBreaker, budgetExceeded, timeExceeded, pickImplementWinner, chooseImplementRoster } from './goal/policy.js';
export { planSynthesis } from './synth-plan.js';
export type { SynthCandidate, SynthPlanOpts, SynthPlan } from './synth-plan.js';
export { summarizeGoal, writeGoalArtifacts, runGoalController } from './goal/controller.js';
export { supervisorDecision, computeBackoffMs, isDeterministicExit, runSupervisor } from './goal/supervisor.js';
export type { SupervisorDecision } from './goal/supervisor.js';
export { buildOracleCheatPrompt, oracleGateDecision, oracleProbeConclusive, DEFAULT_ORACLE_GATE } from './goal/oracle-redteam.js';
export type { OracleHole } from './goal/oracle-redteam.js';
// ── Conquer (supervised-autonomous build) ──
export {
  pickEscalationMode, classifyStuck, shouldEscalate, shouldAutoApprove, summarizeConsultForBuilder,
  capBreached, parseBuilderSignals, classifyAsk, buildConquerSystemPrompt, buildConquerTurnPrompt, createConquerIsolation,
  dispatchConsult, doneOracleDecision, runDoneOracle, runConquer,
  isAgentCapableEngine, buildFalsifierPrompt, parseFalsifierOutput, isSafeCounterexample, runDoneFalsifier,
  isProtectedPushBranch, DEFAULT_PROTECTED_PUSH_BRANCHES,
  ESCAPING_OPS, DONE_SENTINEL, ASK_SENTINEL,
} from './conquer.js';
export type { StuckSignals, ConquerCaps, ConquerState, ConquerTurn, ConquerOptions, ConquerResult, ConquerIsolation, DoneOracleInput, SandboxOps, FalsifierResult } from './conquer.js';
export { dispatchSeatWithRetry, buildPanelHealth, classifySeatFailure } from './seat-dispatch.js';
export type { SeatOutcome } from './seat-dispatch.js';
