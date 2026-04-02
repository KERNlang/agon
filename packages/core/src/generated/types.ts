export type EngineMode = 'exec' | 'review' | 'agent';

export type TaskClass = 'algorithm' | 'refactor' | 'bugfix' | 'test' | 'docs' | 'feature' | 'other';

export interface EngineModeConfig {
  args: string[];
  stdin?: boolean;
}

export interface ImageAttachment {
  path: string;
  filename: string;
  mimeType: string;
}

export interface EngineModelConfig {
  configKey?: string;
  flag?: string;
  default?: string|null;
}

export interface EngineEnvVar {
  required?: boolean;
  default?: string;
}

export interface CompanionConfig {
  protocol: 'jsonrpc'|'structured-cli';
  serverCmd: string[];
  features?: {threadResume?:boolean, nativeReview?:boolean, structuredOutput?:boolean};
}

export interface EngineDefinition {
  schemaVersion: 1|2|3;
  id: string;
  displayName: string;
  binary: string;
  searchPaths: string[];
  versionCmd: string[];
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
  agent?: EngineModeConfig;
  api?: {baseUrl:string, apiKeyEnv:string, model:string, maxTokens?:number};
  companion?: CompanionConfig;
}

export interface DispatchOptions {
  engine: EngineDefinition;
  prompt: string;
  cwd: string;
  mode: EngineMode;
  timeout: number;
  outputDir: string;
  signal?: AbortSignal;
  images?: ImageAttachment[];
}

export interface DispatchResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface AgentDispatchResult extends DispatchResult {
  diff: string;
  diffLines: number;
  filesChanged: number;
}

export interface EngineAdapter {
  dispatch: (options:DispatchOptions)=>Promise<DispatchResult>;
  dispatchStream?: (options:DispatchOptions)=>AsyncGenerator<string, DispatchResult, void>;
  dispatchAgent?: (options:DispatchOptions)=>Promise<AgentDispatchResult>;
  dispatchAgentStream?: (options:DispatchOptions)=>AsyncGenerator<string, AgentDispatchResult, void>;
  isAvailable: (engine:EngineDefinition)=>Promise<boolean>;
  getVersion: (engine:EngineDefinition)=>Promise<string|null>;
}

export interface FitnessResult {
  pass: boolean;
  diffLines: number;
  filesChanged: number;
  durationSec: number;
  lintWarnings: number;
  styleScore: number;
  compositeScore: number;
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

export interface EloRating {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface EloRecord {
  global: Record<string,EloRating>;
  byTaskClass: Record<string,Record<string,EloRating>>;
  lastUpdated: string;
}

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
  eloEnabled?: boolean;
  eloKFactor?: number;
  contextSummary?: boolean;
  onboarded?: boolean;
  projectContext?: string;
  contextFormat?: 'plain'|'kern';
  approvalLevel?: 'auto'|'plan'|'step';
  agentTimeout?: number;
  agentPermissionLevel?: 'full'|'plan'|'read-only';
  cesarEnabled?: boolean;
  cesarScoutCount?: number;
  cesarDirectThreshold?: number;
  cesarDisagreementSpread?: number;
  cesarEngine?: string;
  campfireObserverStrategy?: 'lead-first'|'all-respond';
  hooks: Record<string,Array<{command:string,engines?:string[],timeout?:number}>>;
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
  eloEnabled: true,
  eloKFactor: 32,
  contextSummary: true,
  onboarded: false,
  projectContext: '',
  contextFormat: 'plain',
  approvalLevel: 'plan',
  agentTimeout: 600,
  agentPermissionLevel: 'full',
  cesarEnabled: true,
  cesarScoutCount: 2,
  cesarDirectThreshold: 85,
  cesarDisagreementSpread: 20,
  cesarEngine: 'claude',
  campfireObserverStrategy: 'lead-first',
  hooks: {},
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
  action: 'chat'|'build'|'pipeline'|'campfire'|'forge';
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
  context?: string;
  seedPlan?: string;
  timeout?: number;
  fitnessTimeout?: number;
  starter?: string;
  engines?: string[];
  dryRun?: boolean;
  signal?: AbortSignal;
}

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
}

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
  synthesis?: {pass:boolean,score:number,wins:boolean,patchPath:string,originalWinnerScore:number};
}

export type ForgeEventType = 'baseline:start' | 'baseline:done' | 'stage1:start' | 'stage1:dispatch' | 'stage1:score' | 'stage1:accepted' | 'stage2:start' | 'stage2:dispatch' | 'stage2:score' | 'stage2:done' | 'winner:determined' | 'synthesis:start' | 'synthesis:critique' | 'synthesis:refine' | 'synthesis:score' | 'synthesis:done' | 'elo:update' | 'forge:done';

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
  'forge:done': Record<string, unknown>;
}

export type ForgeEventCallback = (event: ForgeEvent) => void;

export interface BrainstormBid {
  engineId: string;
  confidence: number;
  reasoning: string;
  approach: string;
}

export interface BrainstormResult {
  question: string;
  bids: BrainstormBid[];
  winner: string;
  response: string;
}

export interface Critique {
  file: string;
  lines: string;
  problem: string;
  minimalFix: string;
}

export const DEFAULT_CONFIG: Required<AgonConfig> = DEFAULT_AGON_CONFIG;

