// ── Engine Definition (JSON on disk) ──────────────────────────────────

export interface EngineModeConfig {
  /** Args template. Use {prompt}, {model}, {cwd}, {timeout} as placeholders. */
  args: string[];
  /** If true, send prompt via stdin instead of as an arg. */
  stdin?: boolean;
}

export interface EngineModelConfig {
  /** Config key for user-selected model (e.g. "claude_model"). */
  configKey?: string;
  /** CLI flag to pass model (e.g. "--model"). Inserted before value. */
  flag?: string;
  /** Default model if none configured. */
  default?: string | null;
}

export interface EngineEnvVar {
  /** If true, engine won't dispatch without this env var set. */
  required?: boolean;
  /** Default value if not set. */
  default?: string;
}

export interface EngineDefinition {
  schemaVersion: 1 | 2;
  id: string;
  displayName: string;
  binary: string;
  searchPaths: string[];
  versionCmd: string[];
  isLocal: boolean;
  tier: 'builtin' | 'user';
  installHint?: string;
  timeout: number;

  /** Declarative mode configs — how to invoke for exec/review. */
  exec?: EngineModeConfig;
  review?: EngineModeConfig;

  /** Model selection config. */
  model?: EngineModelConfig;

  /** Required/optional environment variables. */
  env?: Record<string, EngineEnvVar>;

  /** Test command to verify engine works. */
  test?: { args: string[] };

  // ── Legacy v1 fields (kept for backward compat) ──
  /** @deprecated Use exec/review instead. */
  modes?: EngineMode[];
  /** @deprecated Use model.configKey instead. */
  modelConfigKey?: string;
  /** @deprecated Use exec/review instead. */
  adapterType?: string;
}

export type EngineMode = 'exec' | 'review';

// ── Engine Adapter ───────────────────────────────────────────────────

export interface DispatchOptions {
  engine: EngineDefinition;
  prompt: string;
  cwd: string;
  mode: EngineMode;
  /** Timeout in seconds. */
  timeout: number;
  outputDir: string;
}

export interface DispatchResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface EngineAdapter {
  dispatch(options: DispatchOptions): Promise<DispatchResult>;
  isAvailable(engine: EngineDefinition): Promise<boolean>;
  getVersion(engine: EngineDefinition): Promise<string | null>;
}

// ── Scoring ──────────────────────────────────────────────────────────

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

// ── ELO ──────────────────────────────────────────────────────────────

export type TaskClass =
  | 'algorithm'
  | 'refactor'
  | 'bugfix'
  | 'test'
  | 'docs'
  | 'feature'
  | 'other';

export interface EloRating {
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface EloRecord {
  global: Record<string, EloRating>;
  byTaskClass: Record<string, Record<string, EloRating>>;
  lastUpdated: string;
}

// ── Config ───────────────────────────────────────────────────────────

export interface AgonConfig {
  debug?: boolean;
  timeout?: number;
  forgeTimeout?: number;
  forgeAutoAcceptScore?: number;
  forgeClearWinnerSpread?: number;
  forgeEnableSynthesis?: boolean;
  forgeMaxCritiques?: number;
  forgeStarterStrategy?: 'fixed' | 'rotate';
  forgeFixedStarter?: string;
  forgeRequireBaselineCheck?: boolean;
  forgeEnabledEngines?: string[];
  forgeFitnessTimeout?: number;
  forgeSynthesisTimeout?: number;
  eloEnabled?: boolean;
  eloKFactor?: number;
  contextSummary?: boolean;
  onboarded?: boolean;
  caesarModel?: 'smollm2-360m' | 'phi-3-mini' | 'none';
  projectContext?: string;
}

export const DEFAULT_CONFIG: Required<AgonConfig> = {
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
  forgeEnabledEngines: ['claude', 'codex', 'gemini'],
  forgeFitnessTimeout: 120,
  forgeSynthesisTimeout: 300,
  eloEnabled: true,
  eloKFactor: 32,
  contextSummary: true,
  onboarded: false,
  caesarModel: 'smollm2-360m',
  projectContext: '',
};

// ── Forge ────────────────────────────────────────────────────────────

export interface ForgeOptions {
  task: string;
  fitnessCmd: string;
  cwd: string;
  forgeDir: string;
  timeout?: number;
  fitnessTimeout?: number;
  starter?: string;
  engines?: string[];
  dryRun?: boolean;
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
  results: Record<string, EngineResult>;
  patches: Record<string, string>;
  winner: string | null;
  closeCall: boolean;
  stage1Accepted: boolean;
  baselinePasses: boolean;
  starter: string;
  enginesDispatched: number;
  synthesis?: {
    pass: boolean;
    score: number;
    wins: boolean;
    patchPath: string;
    originalWinnerScore: number;
  };
}

export type ForgeEventType =
  | 'baseline:start'
  | 'baseline:done'
  | 'stage1:start'
  | 'stage1:dispatch'
  | 'stage1:score'
  | 'stage1:accepted'
  | 'stage2:start'
  | 'stage2:dispatch'
  | 'stage2:score'
  | 'stage2:done'
  | 'winner:determined'
  | 'synthesis:start'
  | 'synthesis:critique'
  | 'synthesis:refine'
  | 'synthesis:score'
  | 'synthesis:done'
  | 'elo:update'
  | 'forge:done';

export interface ForgeEvent {
  type: ForgeEventType;
  engineId?: string;
  data?: Record<string, unknown>;
}

// ── Brainstorm ───────────────────────────────────────────────────────

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

// ── Critique ─────────────────────────────────────────────────────────

export interface Critique {
  file: string;
  lines: string;
  problem: string;
  minimalFix: string;
}
