// @kern-source: types:1
export type EngineMode = 'exec' | 'review' | 'agent';

// @kern-source: types:2
export type TaskClass = 'algorithm' | 'refactor' | 'bugfix' | 'test' | 'docs' | 'feature' | 'other';

// @kern-source: types:4
export interface EngineModeConfig {
  args: string[];
  stdin?: boolean;
}

// @kern-source: types:8
export interface ImageAttachment {
  path: string;
  filename: string;
  mimeType: string;
}

// @kern-source: types:13
export interface EngineModelConfig {
  configKey?: string;
  flag?: string;
  default?: string|null;
}

// @kern-source: types:18
export interface EngineEnvVar {
  required?: boolean;
  default?: string;
}

// @kern-source: types:22
export interface CompanionConfig {
  protocol: 'jsonrpc'|'acp'|'structured-cli';
  serverCmd: string[];
  features?: {threadResume?:boolean, nativeReview?:boolean, structuredOutput?:boolean};
}

// @kern-source: types:27
export interface EngineDefinition {
  schemaVersion: 1|2|3;
  id: string;
  displayName: string;
  binary?: string;
  searchPaths?: string[];
  versionCmd?: string[];
  isLocal: boolean;
  tier: 'builtin'|'user';
  installHint?: string;
  timeout: number;
  exec?: EngineModeConfig;
  review?: EngineModeConfig;
  model?: EngineModelConfig;
  env?: Record<string,EngineEnvVar>;
  test?: {args:string[]};
  modes?: EngineMode[];
  modelConfigKey?: string;
  adapterType?: string;
  capabilities?: string[];
  imageFlag?: string;
  systemPromptFlag?: string;
  agent?: EngineModeConfig;
  api?: {baseUrl:string, apiKeyEnv:string, model:string, maxTokens?:number, format?:'openai'|'anthropic', firstChunkTimeoutMs?:number, idleTimeoutMs?:number};
  companion?: CompanionConfig;
}

// @kern-source: types:53
export interface DispatchOptions {
  engine: EngineDefinition;
  prompt: string;
  cwd: string;
  mode: EngineMode;
  timeout: number;
  outputDir: string;
  signal?: AbortSignal;
  images?: ImageAttachment[];
  systemPrompt?: string;
}

// @kern-source: types:64
/**
 * Structured parts captured at stream time. Enables compaction to fold over typed data instead of parsing strings.
 */
export interface DispatchResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  usage?: {promptTokens:number,completionTokens:number,totalTokens:number,source:'sdk'|'cli-reported'|'estimated'};
  parts?: Array<{kind:'text',text:string}|{kind:'reasoning',text:string}|{kind:'tool_call',toolName:string,toolCallId:string,args:Record<string,unknown>}>;
}

// @kern-source: types:74
export interface AgentDispatchResult extends DispatchResult {
  diff: string;
  diffLines: number;
  filesChanged: number;
}

// @kern-source: types:79
export interface EngineAdapter {
  dispatch: (options:DispatchOptions)=>Promise<DispatchResult>;
  dispatchStream?: (options:DispatchOptions)=>AsyncGenerator<string, DispatchResult, void>;
  dispatchAgent?: (options:DispatchOptions)=>Promise<AgentDispatchResult>;
  dispatchAgentStream?: (options:DispatchOptions)=>AsyncGenerator<string, AgentDispatchResult, void>;
  isAvailable: (engine:EngineDefinition)=>Promise<boolean>;
  getVersion: (engine:EngineDefinition)=>Promise<string|null>;
}

// @kern-source: types:87
export interface FitnessResult {
  pass: boolean;
  diffLines: number;
  filesChanged: number;
  durationSec: number;
  lintWarnings: number;
  styleScore: number;
  compositeScore: number;
}

// @kern-source: types:96
export interface ScoreWeights {
  pass: number;
  quality: number;
  diff: number;
  files: number;
  duration: number;
}

// @kern-source: types:103
export interface ScoreComponents {
  passScore: number;
  qualityScore: number;
  diffScore: number;
  filesScore: number;
  durationScore: number;
  composite: number;
}

// @kern-source: types:111
export interface GlickoRating {
  mu: number;
  phi: number;
  sigma: number;
  wins: number;
  losses: number;
  lastActive: string;
}

// @kern-source: types:119
export interface EngineMeta {
  firstSeen: string;
  lastActive: string;
  matchCount: number;
  derivedFrom: string|null;
  versions: string[];
}

// @kern-source: types:126
export interface RatingRecord {
  global: Record<string,GlickoRating>;
  byMode: {forge:Record<string,GlickoRating>,brainstorm:Record<string,GlickoRating>,tribunal:Record<string,GlickoRating>};
  byTaskClass: Record<string,Record<string,GlickoRating>>;
  engineMeta: Record<string,EngineMeta>;
  lastUpdated: string;
}

// @kern-source: types:133
export interface AgonConfig {
  debug?: boolean;
  timeout?: number;
  forgeTimeout?: number;
  forgeAutoAcceptScore?: number;
  forgeClearWinnerSpread?: number;
  forgeEnableSynthesis?: boolean;
  forgeMaxCritiques?: number;
  forgeStarterStrategy?: 'fixed'|'rotate';
  forgeFixedStarter?: string;
  forgeRequireBaselineCheck?: boolean;
  forgeEnabledEngines?: string[];
  forgeFitnessTimeout?: number;
  forgeSynthesisTimeout?: number;
  ratingsEnabled?: boolean;
  contextSummary?: boolean;
  onboarded?: boolean;
  projectContext?: string;
  contextFormat?: 'plain'|'kern';
  approvalLevel?: 'plan'|'task'|'write'|'none';
  agentTimeout?: number;
  agentPermissionLevel?: 'full'|'plan'|'read-only';
  gauntletEnabled?: boolean;
  gauntletMaxBreakers?: number;
  gauntletRepairTimeout?: number;
  corpusReplayLimit?: number;
  skillSynthesisThreshold?: number;
  cesarEnabled?: boolean;
  cesarScoutCount?: number;
  cesarDirectThreshold?: number;
  cesarDisagreementSpread?: number;
  cesarEngine?: string;
  cesarBackend?: 'cli'|'api'|'auto';
  cesarMcpEnabled?: boolean;
  cesarMcpConfigPath?: string;
  campfireObserverStrategy?: 'lead-first'|'all-respond';
  hooks: Record<string,Array<{command:string,engines?:string[],timeout?:number}>>;
  permissionMode?: 'auto'|'ask'|'deny-all';
  allowedCommands: string[];
  toolPermissions: Record<string,'allow'|'ask'|'deny'>;
  hiddenEngines: string[];
  iconTheme?: 'roman'|'classic';
}

export const DEFAULT_AGON_CONFIG: Required<AgonConfig> = {
  debug: false,
  timeout: 360,
  forgeTimeout: 600,
  forgeAutoAcceptScore: 88,
  forgeClearWinnerSpread: 8,
  forgeEnableSynthesis: true,
  forgeMaxCritiques: 3,
  forgeStarterStrategy: 'fixed',
  forgeFixedStarter: 'claude',
  forgeRequireBaselineCheck: true,
  forgeEnabledEngines: ['claude','codex','gemini'],
  forgeFitnessTimeout: 120,
  forgeSynthesisTimeout: 300,
  ratingsEnabled: true,
  contextSummary: true,
  onboarded: false,
  projectContext: '',
  contextFormat: 'plain',
  approvalLevel: 'plan',
  agentTimeout: 600,
  agentPermissionLevel: 'full',
  gauntletEnabled: false,
  gauntletMaxBreakers: 3,
  gauntletRepairTimeout: 300,
  corpusReplayLimit: 5,
  skillSynthesisThreshold: 3,
  cesarEnabled: true,
  cesarScoutCount: 2,
  cesarDirectThreshold: 85,
  cesarDisagreementSpread: 20,
  cesarEngine: 'claude',
  cesarBackend: 'auto',
  cesarMcpEnabled: false,
  cesarMcpConfigPath: '',
  campfireObserverStrategy: 'lead-first',
  hooks: {} as any,
  permissionMode: 'ask',
  allowedCommands: [],
  toolPermissions: {} as any,
  hiddenEngines: [],
  iconTheme: 'roman',
};

// @kern-source: types:176
export interface ScoutBid {
  engineId: string;
  confidence: number;
  approach: string;
  steps: string[];
  keyFiles: string[];
  risk: 'low'|'medium'|'high';
  needsCompetition: boolean;
}

// @kern-source: types:185
export interface RoutingDecision {
  action: 'chat'|'build'|'pipeline'|'campfire'|'forge'|'brainstorm'|'tribunal';
  leadEngine: string;
  confidence: number;
  reasoning: string;
  seedPlan?: string;
  observerEngines: string[];
  forgeEngines?: string[];
  bids: ScoutBid[];
}

// @kern-source: types:195
export interface CampfireMessage {
  engineId: string;
  content: string;
  isLead: boolean;
}

// @kern-source: types:200
export interface ForgeOptions {
  task: string;
  fitnessCmd: string;
  cwd: string;
  forgeDir: string;
  context?: string;
  seedPlan?: string;
  timeout?: number;
  fitnessTimeout?: number;
  starter?: string;
  engines?: string[];
  dryRun?: boolean;
  hardened?: boolean;
  signal?: AbortSignal;
}

// @kern-source: types:215
export interface EngineResult {
  engineId: string;
  pass: boolean;
  score: number;
  diffLines: number;
  filesChanged: number;
  durationSec: number;
  lintWarnings: number;
  styleScore: number;
  patchPath?: string;
  worktreePath?: string;
  fitnessLogPath?: string;
  dispatchStdout?: string;
}

// @kern-source: types:229
export interface DispatchMetric {
  engineId: string;
  phase: 'stage1'|'stage2-scout'|'stage2-follower'|'synthesis'|'gauntlet';
  dispatchDurationMs: number;
  fitnessDurationMs?: number;
  totalDurationMs: number;
  pass?: boolean;
  score?: number;
  timedOut?: boolean;
  error?: string;
  tokens?: {prompt:number, response:number, costUsd:number};
}

// @kern-source: types:241
export interface ForgeManifest {
  forgeId: string;
  forgeDir: string;
  task: string;
  fitnessCmd: string;
  timestamp: string;
  engines: string[];
  results: Record<string,EngineResult>;
  patches: Record<string,string>;
  winner: string|null;
  closeCall: boolean;
  stage1Accepted: boolean;
  baselinePasses: boolean;
  starter: string;
  enginesDispatched: number;
  dispatchLog?: DispatchMetric[];
  synthesis?: {pass:boolean,score:number,wins:boolean,patchPath:string,originalWinnerScore:number};
  gauntlet?: GauntletResult;
}

// @kern-source: types:260
export interface ConvergenceEntry {
  file: string;
  fn: string;
  from: string;
  reason: string;
}

// @kern-source: types:266
export interface ForgeJudgment {
  winner: string;
  strengths: { engineId: string; category: string; reason: string }[];
  convergencePlan: ConvergenceEntry[];
  summary: string;
  shouldConverge: boolean;
}

// @kern-source: types:273
export type ForgeEventType = 'baseline:start' | 'baseline:done' | 'stage1:start' | 'stage1:dispatch' | 'stage1:score' | 'stage1:accepted' | 'stage2:start' | 'stage2:dispatch' | 'stage2:score' | 'stage2:done' | 'winner:determined' | 'synthesis:start' | 'synthesis:critique' | 'synthesis:refine' | 'synthesis:score' | 'synthesis:done' | 'elo:update' | 'gauntlet:start' | 'gauntlet:breaker-dispatch' | 'gauntlet:breaker-done' | 'gauntlet:attack-landed' | 'gauntlet:repair-start' | 'gauntlet:repair-done' | 'gauntlet:corpus-save' | 'gauntlet:done' | 'forge:done';

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
  'stage1:score': { engineId: string };
  'stage1:accepted': { engineId: string, score: number };
  'stage2:start': Record<string, unknown>;
  'stage2:dispatch': { engineId: string };
  'stage2:score': { engineId: string };
  'stage2:done': Record<string, unknown>;
  'winner:determined': { winner: string, bestScore: number };
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
}

export type ForgeEventCallback = (event: ForgeEvent) => void;

// @kern-source: types:301
export interface BrainstormBid {
  engineId: string;
  confidence: number;
  reasoning: string;
  approach: string;
  score?: number;
}

// @kern-source: types:308
export interface BrainstormResult {
  question: string;
  bids: BrainstormBid[];
  winner: string;
  response: string;
}

// @kern-source: types:314
export interface BreakerArtifact {
  engineId: string;
  testScript: string;
  testPath: string;
  failureMessage: string;
  deterministic: boolean;
  validated: boolean;
}

// @kern-source: types:322
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

// @kern-source: types:333
export interface CorpusEntry {
  forgeId: string;
  taskClass: TaskClass;
  artifact: BreakerArtifact;
  timestamp: string;
  replayCount: number;
  pattern?: string;
}

// @kern-source: types:341
export interface GapPattern {
  pattern: string;
  taskClass: TaskClass;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
  skillProposed: boolean;
  skillPath?: string;
}

// @kern-source: types:350
export interface Critique {
  file: string;
  lines: string;
  problem: string;
  minimalFix: string;
}

// @kern-source: types:356
export const DEFAULT_CONFIG: Required<AgonConfig> = DEFAULT_AGON_CONFIG;

