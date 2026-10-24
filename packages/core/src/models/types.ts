export type { AgonConfig } from '@kernlang/agon-support-persistence';
export { DEFAULT_AGON_CONFIG, DEFAULT_CONFIG } from '@kernlang/agon-support-persistence';
export type {
  AgentDispatchResult, CliModelEntry, CompanionConfig, DispatchOptions, DispatchResult, EngineAdapter,
  EngineCliModelConfig, EngineDefinition, EngineEffortConfig, EngineEnvVar, EngineMode, EngineModeConfig,
  EngineModelConfig, ImageAttachment, SessionBudget, TaskClass,
} from '@kernlang/agon-support-engine-runtime';
export type { BrainstormResult } from '@kernlang/agon-mod-brainstorm';
export type { BrainstormGroup, BrainstormDedupStatus } from '@kernlang/agon-support-dedup';


export type { FitnessResult, ScoreWeights, ScoreComponents } from '@kernlang/agon-mod-forge';

export type { GlickoRating, EngineMeta, RatingRecord } from '@kernlang/agon-mod-ratings';


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
