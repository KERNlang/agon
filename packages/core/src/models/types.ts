import type { KernelSettings } from '@kernlang/agon-kernel';
import { DEFAULT_KERNEL_SETTINGS } from '@kernlang/agon-kernel';
import type { PersistenceSettings } from '@kernlang/agon-support-persistence';
import { DEFAULT_PERSISTENCE_SETTINGS } from '@kernlang/agon-support-persistence';
import type { BrowserSettings } from '@kernlang/agon-support-browser-bridge';
import { DEFAULT_BROWSER_SETTINGS } from '@kernlang/agon-support-browser-bridge';
import type { FirstPartyLegacySettings } from './first-party-settings.generated.js';
import { DEFAULT_FIRST_PARTY_SETTINGS } from './first-party-settings.generated.js';
export type {
  AgentDispatchResult, CliModelEntry, CompanionConfig, DispatchOptions, DispatchResult, EngineAdapter,
  EngineCliModelConfig, EngineDefinition, EngineEffortConfig, EngineEnvVar, EngineMode, EngineModeConfig,
  EngineModelConfig, ImageAttachment, SessionBudget, TaskClass,
} from '@kernlang/agon-support-engine-runtime';
import type { TaskClass, EngineSettings } from '@kernlang/agon-support-engine-runtime';
import { DEFAULT_ENGINE_SETTINGS } from '@kernlang/agon-support-engine-runtime';
export type { BrainstormResult } from '@kernlang/agon-mod-brainstorm';
export type { BrainstormGroup, BrainstormDedupStatus } from '@kernlang/agon-support-dedup';


export interface FitnessResult {
  pass: boolean;
  diffLines: number;
  filesChanged: number;
  durationSec: number;
  lintWarnings: number;
  styleScore: number;
  compositeScore: number;
  syntaxErrors?: number;
  syntaxInvalidFiles?: string[];
}

export interface ScoreWeights {
  pass: number;
  quality: number;
  diff: number;
  files: number;
  duration: number;
}

export interface ScoreComponents {
  passScore: number;
  qualityScore: number;
  diffScore: number;
  filesScore: number;
  durationScore: number;
  composite: number;
}

export type { GlickoRating, EngineMeta, RatingRecord } from '@kernlang/agon-mod-ratings';

export interface AgonConfig extends EngineSettings, KernelSettings, PersistenceSettings, BrowserSettings, FirstPartyLegacySettings {}

export const DEFAULT_AGON_CONFIG: Required<AgonConfig> = {
  debug: DEFAULT_KERNEL_SETTINGS.debug,
  timeout: DEFAULT_KERNEL_SETTINGS.timeout,
  forgeTimeout: DEFAULT_KERNEL_SETTINGS.forgeTimeout,
  forgeDispatchTimeout: DEFAULT_ENGINE_SETTINGS.forgeDispatchTimeout,
  forgeAutoAcceptScore: DEFAULT_KERNEL_SETTINGS.forgeAutoAcceptScore,
  forgeClearWinnerSpread: DEFAULT_KERNEL_SETTINGS.forgeClearWinnerSpread,
  forgeEnableSynthesis: DEFAULT_FIRST_PARTY_SETTINGS.forgeEnableSynthesis,
  forgeMaxCritiques: DEFAULT_KERNEL_SETTINGS.forgeMaxCritiques,
  forgeStarterStrategy: DEFAULT_KERNEL_SETTINGS.forgeStarterStrategy,
  forgeFixedStarter: DEFAULT_KERNEL_SETTINGS.forgeFixedStarter,
  reviewDefaultEngine: DEFAULT_ENGINE_SETTINGS.reviewDefaultEngine,
  goalReviewEngines: [...DEFAULT_FIRST_PARTY_SETTINGS.goalReviewEngines],
  forgeRequireBaselineCheck: DEFAULT_KERNEL_SETTINGS.forgeRequireBaselineCheck,
  engineActivationMode: DEFAULT_ENGINE_SETTINGS.engineActivationMode,
  forgeEnabledEngines: DEFAULT_ENGINE_SETTINGS.forgeEnabledEngines,
  forgeFitnessTimeout: DEFAULT_FIRST_PARTY_SETTINGS.forgeFitnessTimeout,
  forgeSynthesisTimeout: DEFAULT_FIRST_PARTY_SETTINGS.forgeSynthesisTimeout,
  forgeEarlyFinalizeEnabled: DEFAULT_KERNEL_SETTINGS.forgeEarlyFinalizeEnabled,
  forgeEarlyFinalizePassingCount: DEFAULT_KERNEL_SETTINGS.forgeEarlyFinalizePassingCount,
  forgeEarlyFinalizeMinScore: DEFAULT_KERNEL_SETTINGS.forgeEarlyFinalizeMinScore,
  forgeHealthCheckEnabled: DEFAULT_KERNEL_SETTINGS.forgeHealthCheckEnabled,
  forgeHealthCheckTimeoutSec: DEFAULT_KERNEL_SETTINGS.forgeHealthCheckTimeoutSec,
  forgeHealthCheckApiTimeoutSec: DEFAULT_KERNEL_SETTINGS.forgeHealthCheckApiTimeoutSec,
  forgeMaxParallelApi: DEFAULT_KERNEL_SETTINGS.forgeMaxParallelApi,
  forgeJudgeEngine: DEFAULT_ENGINE_SETTINGS.forgeJudgeEngine,
  reviewMaxTokens: DEFAULT_KERNEL_SETTINGS.reviewMaxTokens,
  reviewFileContext: DEFAULT_KERNEL_SETTINGS.reviewFileContext,
  ratingsEnabled: DEFAULT_KERNEL_SETTINGS.ratingsEnabled,
  contextSummary: DEFAULT_KERNEL_SETTINGS.contextSummary,
  sessionContinuity: DEFAULT_PERSISTENCE_SETTINGS.sessionContinuity,
  onboarded: DEFAULT_KERNEL_SETTINGS.onboarded,
  projectContext: DEFAULT_KERNEL_SETTINGS.projectContext,
  contextFormat: DEFAULT_KERNEL_SETTINGS.contextFormat,
  approvalLevel: DEFAULT_KERNEL_SETTINGS.approvalLevel,
  agentTimeout: DEFAULT_KERNEL_SETTINGS.agentTimeout,
  agentPermissionLevel: DEFAULT_KERNEL_SETTINGS.agentPermissionLevel,
  jobEventLimit: DEFAULT_KERNEL_SETTINGS.jobEventLimit,
  jobRetentionLimit: DEFAULT_KERNEL_SETTINGS.jobRetentionLimit,
  jobMaxConcurrency: DEFAULT_KERNEL_SETTINGS.jobMaxConcurrency,
  jobLabelMaxChars: DEFAULT_KERNEL_SETTINGS.jobLabelMaxChars,
  jobOutputChunkChars: DEFAULT_KERNEL_SETTINGS.jobOutputChunkChars,
  jobCancelGraceMs: DEFAULT_KERNEL_SETTINGS.jobCancelGraceMs,
  jobShutdownTimeoutMs: DEFAULT_KERNEL_SETTINGS.jobShutdownTimeoutMs,
  daemonFrameMaxBytes: DEFAULT_KERNEL_SETTINGS.daemonFrameMaxBytes,
  gauntletEnabled: DEFAULT_KERNEL_SETTINGS.gauntletEnabled,
  gauntletMaxBreakers: DEFAULT_KERNEL_SETTINGS.gauntletMaxBreakers,
  gauntletRepairTimeout: DEFAULT_KERNEL_SETTINGS.gauntletRepairTimeout,
  corpusReplayLimit: DEFAULT_KERNEL_SETTINGS.corpusReplayLimit,
  skillSynthesisThreshold: DEFAULT_FIRST_PARTY_SETTINGS.skillSynthesisThreshold,
  cesarEnabled: DEFAULT_KERNEL_SETTINGS.cesarEnabled,
  cesarScoutCount: DEFAULT_KERNEL_SETTINGS.cesarScoutCount,
  cesarScoutTimeout: DEFAULT_KERNEL_SETTINGS.cesarScoutTimeout,
  cesarDirectThreshold: DEFAULT_PERSISTENCE_SETTINGS.cesarDirectThreshold,
  cesarDisagreementSpread: DEFAULT_KERNEL_SETTINGS.cesarDisagreementSpread,
  cesarCodeFastPathChars: DEFAULT_PERSISTENCE_SETTINGS.cesarCodeFastPathChars,
  cesarAutoPipeline: DEFAULT_KERNEL_SETTINGS.cesarAutoPipeline,
  cesarPipelineThreshold: DEFAULT_KERNEL_SETTINGS.cesarPipelineThreshold,
  cesarEngine: DEFAULT_ENGINE_SETTINGS.cesarEngine,
  cesarBackend: DEFAULT_KERNEL_SETTINGS.cesarBackend,
  claudeBackend: DEFAULT_KERNEL_SETTINGS.claudeBackend,
  cesarActingFallback: DEFAULT_KERNEL_SETTINGS.cesarActingFallback,
  cesarMcpEnabled: DEFAULT_KERNEL_SETTINGS.cesarMcpEnabled,
  cesarMcpConfigPath: DEFAULT_PERSISTENCE_SETTINGS.cesarMcpConfigPath,
  cesarAutoApproveMode: DEFAULT_KERNEL_SETTINGS.cesarAutoApproveMode,
  cesarAutoApproveMaxCostUsd: DEFAULT_KERNEL_SETTINGS.cesarAutoApproveMaxCostUsd,
  cesarAutoMode: DEFAULT_KERNEL_SETTINGS.cesarAutoMode,
  cesarAutoHarnessProfile: DEFAULT_KERNEL_SETTINGS.cesarAutoHarnessProfile,
  cesarAgenticContinuationLimit: DEFAULT_FIRST_PARTY_SETTINGS.cesarAgenticContinuationLimit,
  cesarImportantTaskPattern: DEFAULT_KERNEL_SETTINGS.cesarImportantTaskPattern,
  cesarDangerousTaskPattern: DEFAULT_KERNEL_SETTINGS.cesarDangerousTaskPattern,
  cesarDestructiveActionPattern: DEFAULT_KERNEL_SETTINGS.cesarDestructiveActionPattern,
  cesarSensitivePathPatterns: DEFAULT_PERSISTENCE_SETTINGS.cesarSensitivePathPatterns,
  cesarAutoModePrompted: DEFAULT_KERNEL_SETTINGS.cesarAutoModePrompted,
  resumePausedPlanOnStartup: DEFAULT_KERNEL_SETTINGS.resumePausedPlanOnStartup,
  cesarSelfTurnAutoApprove: DEFAULT_KERNEL_SETTINGS.cesarSelfTurnAutoApprove,
  cesarSelfTurnAutoApproveMaxDiffTokens: DEFAULT_KERNEL_SETTINGS.cesarSelfTurnAutoApproveMaxDiffTokens,
  cesarApprovalLedger: DEFAULT_PERSISTENCE_SETTINGS.cesarApprovalLedger,
  cesarToolTimeline: DEFAULT_KERNEL_SETTINGS.cesarToolTimeline,
  protectedPushBranches: DEFAULT_KERNEL_SETTINGS.protectedPushBranches,
  cesarExperience: DEFAULT_KERNEL_SETTINGS.cesarExperience,
  cesarExperienceMinSimilarity: DEFAULT_KERNEL_SETTINGS.cesarExperienceMinSimilarity,
  cesarExperienceMinEpisodes: DEFAULT_KERNEL_SETTINGS.cesarExperienceMinEpisodes,
  cesarExperienceTopK: DEFAULT_KERNEL_SETTINGS.cesarExperienceTopK,
  cesarExperienceWindow: DEFAULT_KERNEL_SETTINGS.cesarExperienceWindow,
  cesarDelegationReflex: DEFAULT_KERNEL_SETTINGS.cesarDelegationReflex,
  cesarMutateReflex: DEFAULT_FIRST_PARTY_SETTINGS.cesarMutateReflex,
  cesarGateAutoRun: DEFAULT_KERNEL_SETTINGS.cesarGateAutoRun,
  cesarGateAutoRunLimit: DEFAULT_KERNEL_SETTINGS.cesarGateAutoRunLimit,
  cesarGateTimeoutSec: DEFAULT_KERNEL_SETTINGS.cesarGateTimeoutSec,
  cesarGateOutputTailChars: DEFAULT_KERNEL_SETTINGS.cesarGateOutputTailChars,
  cesarSearchNudgeThreshold: DEFAULT_KERNEL_SETTINGS.cesarSearchNudgeThreshold,
  cesarReadSpiralThreshold: DEFAULT_KERNEL_SETTINGS.cesarReadSpiralThreshold,
  cesarReadRepeatThreshold: DEFAULT_KERNEL_SETTINGS.cesarReadRepeatThreshold,
  cesarStreamingXmlTools: DEFAULT_KERNEL_SETTINGS.cesarStreamingXmlTools,
  campfireObserverStrategy: DEFAULT_KERNEL_SETTINGS.campfireObserverStrategy,
  hooks: DEFAULT_KERNEL_SETTINGS.hooks,
  permissionMode: DEFAULT_KERNEL_SETTINGS.permissionMode,
  agonPermissionMode: DEFAULT_KERNEL_SETTINGS.agonPermissionMode,
  allowedCommands: DEFAULT_KERNEL_SETTINGS.allowedCommands,
  toolPermissions: DEFAULT_KERNEL_SETTINGS.toolPermissions,
  permissions: DEFAULT_KERNEL_SETTINGS.permissions,
  hiddenEngines: DEFAULT_ENGINE_SETTINGS.hiddenEngines,
  removedEngines: DEFAULT_ENGINE_SETTINGS.removedEngines,
  engineModels: DEFAULT_ENGINE_SETTINGS.engineModels,
  engineEfforts: DEFAULT_ENGINE_SETTINGS.engineEfforts,
  engineIsolation: DEFAULT_ENGINE_SETTINGS.engineIsolation,
  terminalMode: DEFAULT_KERNEL_SETTINGS.terminalMode,
  uiMotion: DEFAULT_KERNEL_SETTINGS.uiMotion,
  statusLine: DEFAULT_KERNEL_SETTINGS.statusLine,
  iconTheme: DEFAULT_KERNEL_SETTINGS.iconTheme,
  narrationFold: DEFAULT_KERNEL_SETTINGS.narrationFold,
  autoReviewAfterForge: DEFAULT_FIRST_PARTY_SETTINGS.autoReviewAfterForge,
  autoReviewAfterImpl: DEFAULT_FIRST_PARTY_SETTINGS.autoReviewAfterImpl,
  buddyTimeout: DEFAULT_KERNEL_SETTINGS.buddyTimeout,
  speculativeThresholdUsd: DEFAULT_KERNEL_SETTINGS.speculativeThresholdUsd,
  speculativeEloSpreadThreshold: DEFAULT_KERNEL_SETTINGS.speculativeEloSpreadThreshold,
  neroExplorationRate: DEFAULT_KERNEL_SETTINGS.neroExplorationRate,
  ratingsPurgeKeepEngines: DEFAULT_ENGINE_SETTINGS.ratingsPurgeKeepEngines,
  autoCredit: DEFAULT_KERNEL_SETTINGS.autoCredit,
  commitCoAuthor: DEFAULT_ENGINE_SETTINGS.commitCoAuthor,
  browserExtensionIds: DEFAULT_BROWSER_SETTINGS.browserExtensionIds,
};

export interface ScoutBid {
  engineId: string;
  confidence: number;
  approach: string;
  steps: string[];
  keyFiles: string[];
  risk: 'low'|'medium'|'high';
  needsCompetition: boolean;
}

export interface RoutingDecision {
  action: 'chat'|'build'|'pipeline'|'campfire'|'forge'|'brainstorm'|'tribunal'|'agent'|'team-agent';
  leadEngine: string;
  confidence: number;
  reasoning: string;
  seedPlan?: string;
  observerEngines: string[];
  forgeEngines?: string[];
  bids: ScoutBid[];
}

export interface CampfireMessage {
  engineId: string;
  content: string;
  isLead: boolean;
}

export interface ForgeOptions {
  task: string;
  fitnessCmd: string;
  cwd: string;
  forgeDir: string;
  mode?: 'implement'|'improve'|'validate';
  requireDiff?: boolean;
  baselineMayPass?: boolean;
  acceptReviewOutput?: boolean;
  context?: string;
  seedPlan?: string;
  timeout?: number;
  fitnessTimeout?: number;
  starter?: string;
  engines?: string[];
  dryRun?: boolean;
  hardened?: boolean;
  signal?: AbortSignal;
  earlyFinalizeCount?: number;
  healthCheckEnabled?: boolean;
  healthCheckTimeoutSec?: number;
  synthesize?: 'always'|'close-call'|'never';
  synthEngine?: string;
}

export interface EngineResult {
  engineId: string;
  pass: boolean;
  score: number;
  status?: string;
  fitnessPassed?: boolean;
  engineCompleted?: boolean;
  reason?: string;
  diffLines: number;
  filesChanged: number;
  durationSec: number;
  lintWarnings: number;
  styleScore: number;
  patchPath?: string;
  worktreePath?: string;
  fitnessLogPath?: string;
  dispatchStdout?: string;
  syntaxErrors?: number;
  syntaxInvalidFiles?: string[];
}

export interface SkippedEngine {
  engineId: string;
  status: string;
  reason?: string;
}

export interface DispatchMetric {
  engineId: string;
  phase: 'stage1'|'stage1-fallback'|'stage2-scout'|'stage2-scout-fallback'|'stage2-follower'|'stage2-fallback'|'synthesis'|'gauntlet';
  dispatchDurationMs: number;
  fitnessDurationMs?: number;
  totalDurationMs: number;
  pass?: boolean;
  score?: number;
  timedOut?: boolean;
  error?: string;
  tokens?: {prompt:number, response:number, costUsd:number};
}

export interface ForgeManifest {
  forgeId: string;
  forgeDir: string;
  task: string;
  fitnessCmd: string;
  timestamp: string;
  engines: string[];
  skippedEngines?: SkippedEngine[];
  results: Record<string,EngineResult>;
  patches: Record<string,string>;
  winner: string|null;
  closeCall: boolean;
  stage1Accepted: boolean;
  baselinePasses: boolean;
  mode?: 'implement'|'improve'|'validate';
  requireDiff?: boolean;
  acceptReviewOutput?: boolean;
  status?: string;
  noDiffSummary?: {status:string,count:number,toolLoopLimit:number,usefulReports:number};
  alreadySatisfied?: boolean;
  singleSurvivor?: boolean;
  error?: string;
  starter: string;
  enginesDispatched: number;
  dispatchLog?: DispatchMetric[];
  resultBundlePath?: string;
  cleanupCommand?: string;
  synthesis?: {pass:boolean,score:number,wins:boolean,patchPath:string,originalWinnerScore:number,reason?:string};
  gauntlet?: GauntletResult;
}

export interface ConvergenceEntry {
  file: string;
  fn: string;
  from: string;
  reason: string;
}

export interface ForgeJudgment {
  winner: string;
  strengths: { engineId: string; category: string; reason: string }[];
  convergencePlan: ConvergenceEntry[];
  summary: string;
  shouldConverge: boolean;
}

export type ForgeEventType = 'baseline:start' | 'baseline:done' | 'stage1:start' | 'stage1:dispatch' | 'stage1:score' | 'stage1:accepted' | 'stage2:start' | 'stage2:dispatch' | 'stage2:score' | 'stage2:done' | 'engine:failed' | 'engine:worktree' | 'winner:determined' | 'forge:no-candidate-diff' | 'synthesis:start' | 'synthesis:critique' | 'synthesis:refine' | 'synthesis:score' | 'synthesis:done' | 'elo:update' | 'gauntlet:start' | 'gauntlet:breaker-dispatch' | 'gauntlet:breaker-done' | 'gauntlet:attack-landed' | 'gauntlet:repair-start' | 'gauntlet:repair-done' | 'gauntlet:corpus-save' | 'gauntlet:done' | 'forge:done' | 'forge:engine-skipped' | 'forge:already-satisfied' | 'forge:single-survivor' | 'forge:no-engines-available' | 'forge:fatal' | 'forge:auto-finalize' | 'forge:health-check-start' | 'forge:health-check-done';

export interface ForgeEvent {
  type: ForgeEventType;
  engineId?: string;
  data?: Record<string, unknown>;
}

export interface ForgeEventMap {
  'baseline:start': Record<string, unknown>;
  'baseline:done': { passes: boolean };
  'stage1:start': Record<string, unknown>;
  'stage1:dispatch': { engineId: string };
  'stage1:score': { engineId: string, score?: number, pass?: boolean, worktreePath?: string };
  'stage1:accepted': { engineId: string, score: number };
  'stage2:start': Record<string, unknown>;
  'stage2:dispatch': { engineId: string };
  'stage2:score': { engineId: string, score?: number, pass?: boolean, worktreePath?: string };
  'stage2:done': Record<string, unknown>;
  'engine:failed': { engineId: string, phase: string, error: string };
  'engine:worktree': { engineId: string, worktreePath: string, phase: string };
  'winner:determined': { winner: string, bestScore: number };
  'forge:no-candidate-diff': { status: string, count: number, toolLoopLimit: number, usefulReports: number };
  'synthesis:start': Record<string, unknown>;
  'synthesis:critique': { engineId: string };
  'synthesis:refine': Record<string, unknown>;
  'synthesis:score': { score: number };
  'synthesis:done': Record<string, unknown>;
  'elo:update': Record<string, unknown>;
  'gauntlet:start': Record<string, unknown>;
  'gauntlet:breaker-dispatch': { engineId: string };
  'gauntlet:breaker-done': { engineId: string, validated: boolean };
  'gauntlet:attack-landed': { engineId: string, failureMessage: string };
  'gauntlet:repair-start': Record<string, unknown>;
  'gauntlet:repair-done': { pass: boolean, score: number };
  'gauntlet:corpus-save': { count: number };
  'gauntlet:done': { attacksLanded: number, repairPass: boolean };
  'forge:done': Record<string, unknown>;
  'forge:engine-skipped': { engineId: string, status: string, reason?: string };
  'forge:already-satisfied': { baselinePasses: boolean };
  'forge:single-survivor': { engineId: string, score: number, totalEngines: number, failedCount: number };
  'forge:no-engines-available': { enabled: string[], skipped: string[] };
  'forge:fatal': { phase: string, error: string };
  'forge:auto-finalize': { passingCount: number, targetCount: number, minScore: number };
  'forge:health-check-start': { engineIds: string[], timeoutSec: number };
  'forge:health-check-done': { healthy: string[], unhealthy: any[], totalMs: number };
}

export type ForgeEventCallback = (event: ForgeEvent) => void;

export interface BrainstormBid {
  engineId: string;
  confidence: number;
  reasoning: string;
  approach: string;
  score?: number;
}

export interface BrainstormSynthesisStatus {
  status: 'completed' | 'fallback';
  detail?: string;
}

export interface PanelHealth {
  requested: number;
  responded: number;
  degraded: boolean;
  notes: string[];
  banner: string | null;
}

export interface BreakerArtifact {
  engineId: string;
  testScript: string;
  testPath: string;
  failureMessage: string;
  deterministic: boolean;
  validated: boolean;
}

export interface GauntletResult {
  winnerId: string;
  breakerArtifacts: BreakerArtifact[];
  attacksLanded: number;
  repairAttempted: boolean;
  repairPass: boolean;
  preRepairScore: number;
  postRepairScore: number;
  finalWinnerId: string;
  patchPath?: string;
}

export interface CorpusEntry {
  forgeId: string;
  taskClass: TaskClass;
  artifact: BreakerArtifact;
  timestamp: string;
  replayCount: number;
  pattern?: string;
}

export interface GapPattern {
  pattern: string;
  taskClass: TaskClass;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
  skillProposed: boolean;
  skillPath?: string;
}

export interface Critique {
  file: string;
  lines: string;
  problem: string;
  minimalFix: string;
}

export const DEFAULT_CONFIG: Required<AgonConfig> = DEFAULT_AGON_CONFIG;
