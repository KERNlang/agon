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
export { runGauntlet } from './generated/gauntlet.js';
export { addToCorpus, getCorpusForReplay, getGapPatterns, getCorpusStats, loadCorpus } from './generated/corpus.js';
export type { CorpusRecord } from './generated/corpus.js';
// ── Team Competition ──
export { runTeamForge, decideTeamWinner } from './generated/team-forge.js';
export type { TeamForgeOptions } from './generated/team-forge.js';
export { runTeamTribunal } from './generated/team-tribunal.js';
export type { TeamTribunalOptions } from './generated/team-tribunal.js';
export { runTeamBrainstorm } from './generated/team-brainstorm.js';
export type { TeamBrainstormOptions } from './generated/team-brainstorm.js';
// ── Campfire ──
export { runCampfire } from './generated/campfire.js';
export type { CampfireResult } from './generated/campfire.js';
// ── Sequential thinking ──
export { runThinkChain, buildThinkPrompt, parseThoughts, groundThoughts, validateChain, isThinkStrategy, joinProblemInput, selectBranch, runAdversarialCritique } from './generated/thinking.js';
export type { ThoughtNode, ThinkResult } from './generated/thinking.js';
// ── Naturalize (Phase 2: sanitize → non-author rewrite → re-scan) ──
export { runNaturalize, buildNaturalizePrompt, wordDiffStats } from './generated/naturalize.js';
export type { NaturalizeOptions, NaturalizeResult } from './generated/naturalize.js';
// ── Mutate (mutation testing as a test-strength oracle) ──
export {
  runMutate, dedupeMutants, selectMutants,
  mutationTargetsFromDiff, isMutableFile,
} from './generated/mutate.js';
export type { MutateOptions, MutateResult } from './generated/mutate.js';
// The ONE mutation-report renderer — every surface (mutate, /mutate, review
// --mutate) must render through formatMutationReportLines, never its own copy.
export {
  formatMutationReportLines, formatMutateVerdict, mutateVerdictLine,
  allMutantsSurvived, noMutantsRanLine, staleDistHint, mutateLensSuffix, MUTATE_ALL_SURVIVED_WARNING,
} from './generated/mutate-report.js';
export {
  prepareSandboxNodeModules, clearShadowingDist, workspacePackageDirs,
  packageEntryDirs, repointWorkspaceLinks, isInside, isSafePackageName,
  pnpmWorkspaceGlobs, gitIgnoredPaths,
} from './generated/mutate-sandbox.js';
export type { SandboxNodeModules } from './generated/mutate-sandbox.js';
export {
  buildSemanticMutantPrompt, extractJsonArray, validateSemanticMutants, collectSemanticMutants,
  seatGrantsWriteAccess, stripControlChars, normalizeLens, MUTATE_LENS_PRESETS,
} from './generated/mutate-semantic.js';
export type {
  SemanticTarget, SemanticTargetLine, SemanticMutantsResult, DroppedSemanticEntry,
} from './generated/mutate-semantic.js';
// ── Delegate ──
export { runDelegate } from './generated/delegate.js';
export type { DelegateResult } from './generated/delegate.js';
// ── PR text (engine-written title/body for pushed branches) ──
export { runPrText, buildPrTextPrompt, parsePrText } from './generated/pr-text.js';
export type { PrTextOptions, PrTextResult } from './generated/pr-text.js';
// ── Goal controller ──
export type { GoalSpec, GoalTask, AttemptRecord, GoalEvent, JournalState } from './generated/goal/types.js';
export {
  goalDir, journalPath, createJournal, saveJournal, loadJournal,
  addTasks, nextTask, markStatus, recordAttempt, remainingCount, isDone, logEvent, boundEvents,
} from './generated/goal/journal.js';
export { assertSafeGoalId, resolveWithin, safePathSegment } from './generated/goal/paths.js';
export type { Mutant } from './generated/goal/mutation.js';
export { generateMutants, applyMutantToSource, mutationSurvivors } from './generated/goal/mutation.js';
export type { FrozenOracle, WitnessResult } from './generated/goal/oracle.js';
export { hashOracleInputs, snapshotOracle, oracleTampered, witnessTest } from './generated/goal/oracle.js';
export { isTestFile, parseChangedLines, newFilesInDiff } from './generated/goal/diff.js';
export { gateFailureSignature, taskParkDecision, globalBreaker, budgetExceeded, timeExceeded, pickImplementWinner, chooseImplementRoster } from './generated/goal/policy.js';
export { planSynthesis } from './generated/synth-plan.js';
export type { SynthCandidate, SynthPlanOpts, SynthPlan } from './generated/synth-plan.js';
export { summarizeGoal, writeGoalArtifacts, runGoalController } from './generated/goal/controller.js';
export { supervisorDecision, computeBackoffMs, isDeterministicExit, runSupervisor } from './generated/goal/supervisor.js';
export type { SupervisorDecision } from './generated/goal/supervisor.js';
export { buildOracleCheatPrompt, oracleGateDecision, oracleProbeConclusive, DEFAULT_ORACLE_GATE } from './generated/goal/oracle-redteam.js';
export type { OracleHole } from './generated/goal/oracle-redteam.js';
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
export { dispatchSeatWithRetry, buildPanelHealth, classifySeatFailure } from './generated/seat-dispatch.js';
export type { SeatOutcome } from './generated/seat-dispatch.js';
