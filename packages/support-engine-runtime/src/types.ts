export type EngineMode = 'exec' | 'review' | 'agent';
export type TaskClass = 'algorithm' | 'refactor' | 'bugfix' | 'test' | 'docs' | 'feature' | 'other';

export interface EngineModeConfig { args: string[]; stdin?: boolean }
export interface ImageAttachment { path: string; filename: string; mimeType: string }
export interface EngineModelConfig { configKey?: string; flag?: string; default?: string | null }
export interface EngineEffortConfig { flag?: string; configKey?: string; levels: string[]; default?: string }
export interface EngineEnvVar { required?: boolean; default?: string }
export interface CompanionConfig {
  protocol: 'jsonrpc' | 'acp' | 'structured-cli' | 'stream-json';
  serverCmd: string[];
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  cwdArg?: string;
  systemPromptFlag?: string;
  textOnlyArgs?: string[];
  features?: { threadResume?: boolean; nativeReview?: boolean; structuredOutput?: boolean };
}
export interface CliModelEntry { id: string; name?: string }
export interface EngineCliModelConfig { default?: string; list?: CliModelEntry[]; dynamicListCmd?: string[] }
export interface SessionBudget {
  contextWindow: number;
  reserveTokens?: number;
  warnAt?: number;
  compactAt?: number;
  hardStopAt?: number;
  estimator?: 'chars-per-token' | 'message-history';
  charsPerToken?: number;
}
export interface EngineDefinition {
  schemaVersion: 1 | 2 | 3;
  id: string;
  displayName: string;
  binary?: string;
  searchPaths?: string[];
  versionCmd?: string[];
  isLocal: boolean;
  tier: 'builtin' | 'user';
  installHint?: string;
  timeout: number;
  exec?: EngineModeConfig;
  review?: EngineModeConfig;
  model?: EngineModelConfig;
  effort?: EngineEffortConfig;
  env?: Record<string, EngineEnvVar>;
  test?: { args: string[] };
  modes?: EngineMode[];
  modelConfigKey?: string;
  adapterType?: string;
  family?: string;
  derivedFrom?: string;
  capabilities?: string[];
  guards?: 'strict' | 'invariants' | 'shadow';
  imageFlag?: string;
  systemPromptFlag?: string;
  agent?: EngineModeConfig;
  nonAgenticFraming?: 'all' | 'review';
  api?: {
    baseUrl: string; apiKeyEnv: string; model: string; maxTokens?: number; contextWindow?: number;
    format?: 'openai' | 'anthropic'; firstChunkTimeoutMs?: number; idleTimeoutMs?: number;
    firstChunkRetryCount?: number; firstChunkRetryBackoffMs?: number; emptyResponseRetryCount?: number;
  };
  companion?: CompanionConfig;
  sessionBudget?: SessionBudget;
  cliModels?: EngineCliModelConfig;
  isolationHints?: {
    configEnv?: string; strictMcpArgs?: string[]; personalPaths?: string[]; authFiles?: string[];
    authMarker?: string; setupHint?: string; loginArgs?: string[]; supportsProjectMcp?: boolean;
  };
}
export interface DispatchOptions {
  engine: EngineDefinition;
  prompt: string;
  cwd: string;
  mode: EngineMode;
  reviewTarget?: 'uncommittedChanges';
  timeout: number;
  outputDir: string;
  maxTokens?: number;
  signal?: AbortSignal;
  images?: ImageAttachment[];
  systemPrompt?: string;
  textOnly?: boolean;
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  messages?: Array<{ role: string; content: any; tool_calls?: any[]; tool_call_id?: string }>;
  onApproval?: (tool: string, command: string, reason?: string) => Promise<boolean | string>;
  permissionMode?: 'auto' | 'smart' | 'ask' | 'deny-all';
  allowedCommands?: string[];
  toolPermissions?: Record<string, 'allow' | 'ask' | 'deny'>;
  onSpawn?: (pid: number) => void;
  onTodos?: (todos: Array<{ id: string; text: string; state: string; kind?: string; note?: string }>) => void;
  isolation?: 'workspace-pure' | 'inherit';
}
export interface DispatchResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  engineFault?: boolean;
  pid?: number | null;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedInputTokens?: number; source: 'sdk' | 'cli-reported' | 'estimated' };
  parts?: Array<{ kind: 'text'; text: string } | { kind: 'reasoning'; text: string } | { kind: 'tool_call'; toolName: string; toolCallId: string; args: Record<string, unknown> }>;
  finishReason?: string;
}
export interface AgentDispatchResult extends DispatchResult { diff: string; diffLines: number; filesChanged: number }
export interface EngineAdapter {
  dispatch: (options: DispatchOptions) => Promise<DispatchResult>;
  dispatchStream?: (options: DispatchOptions) => AsyncGenerator<string, DispatchResult, void>;
  dispatchAgent?: (options: DispatchOptions) => Promise<AgentDispatchResult>;
  dispatchAgentStream?: (options: DispatchOptions) => AsyncGenerator<string, AgentDispatchResult, void>;
  isAvailable: (engine: EngineDefinition) => Promise<boolean>;
  getVersion: (engine: EngineDefinition) => Promise<string | null>;
}
