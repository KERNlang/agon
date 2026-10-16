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
import type { EngineSettings } from '@kernlang/agon-support-engine-runtime';
import { DEFAULT_ENGINE_SETTINGS } from '@kernlang/agon-support-engine-runtime';
export type { BrainstormResult } from '@kernlang/agon-mod-brainstorm';
export type { BrainstormGroup, BrainstormDedupStatus } from '@kernlang/agon-support-dedup';


export type { FitnessResult, ScoreWeights, ScoreComponents } from '@kernlang/agon-mod-forge';

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
  gauntletEnabled: DEFAULT_FIRST_PARTY_SETTINGS.gauntletEnabled,
  gauntletMaxBreakers: DEFAULT_FIRST_PARTY_SETTINGS.gauntletMaxBreakers,
  gauntletRepairTimeout: DEFAULT_FIRST_PARTY_SETTINGS.gauntletRepairTimeout,
  corpusReplayLimit: DEFAULT_FIRST_PARTY_SETTINGS.corpusReplayLimit,
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

export type {
  ForgeOptions, EngineResult, SkippedEngine, DispatchMetric, ForgeManifest,
  ConvergenceEntry, ForgeJudgment, ForgeEventType, ForgeEvent, ForgeEventMap,
  ForgeEventCallback, BreakerArtifact, GauntletResult, CorpusEntry, GapPattern,
} from '@kernlang/agon-mod-forge';

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


export type { Critique } from '@kernlang/agon-mod-forge';

export const DEFAULT_CONFIG: Required<AgonConfig> = DEFAULT_AGON_CONFIG;
