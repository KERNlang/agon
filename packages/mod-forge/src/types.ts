import type { TaskClass } from '@kernlang/agon-support-engine-runtime';

export interface StageResult {
  engineResults: Map<string, EngineResult>;
  accepted: boolean;
  winner: string|null;
  metrics?: DispatchMetric[];
}

export interface WorktreeEntry {
  engineId: string;
  path: string;
  repoRoot: string;
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
