export interface ToolInput {
  type: string;
}

export type ToolTerminalReason = 'succeeded' | 'failed' | 'skipped_policy' | 'denied' | 'cancelled' | 'unknown';

export interface ToolResult {
  ok: boolean;
  content: string;
  error?: string;
  metadata?: Record<string,unknown>;
  terminalReason?: ToolTerminalReason;
}

export interface PermissionDecision {
  behavior: 'allow'|'ask'|'deny';
  message?: string;
  reason?: string;
}

export interface ParsedPermissionRule {
  tool: string;
  command?: string;
  prefix: boolean;
}

export interface PermissionRuleSet {
  allow: ParsedPermissionRule[];
  deny: ParsedPermissionRule[];
}

export interface ToolHookDef {
  matcher?: string;
  command: string;
  timeout?: number;
}

export interface ParsedToolHooks {
  preToolUse: ToolHookDef[];
  postToolUse: ToolHookDef[];
}

export interface ToolContext {
  cwd: string;
  readFileState: Map<string, FileState>;
  abortSignal?: AbortSignal;
  permissionMode?: 'auto'|'smart'|'ask'|'deny-all';
  explorationMode?: boolean;
  allowedCommands?: string[];
  toolPermissions?: Record<string,'allow'|'ask'|'deny'>;
  onProgress?: ((message: string) => void);
  onStreamChunk?: ((chunk: string) => void);
  onTodos?: ((todos: Array<{id:string,text:string,state:string,kind?:string,note?:string}>) => void);
  authorizeToolCall?: ((tool:string,input:Record<string,unknown>)=>Promise<boolean|string>|boolean|string);
  readOnlyMode?: boolean;
  blockedTools?: string[];
  blockedToolMessage?: string;
  virtualFs?: any;
  sessionAllowList?: string[];
  source?: 'user'|'orchestrator';
  permissionRules?: PermissionRuleSet;
  toolHooks?: ParsedToolHooks;
}

export interface FileState {
  content: string;
  timestamp: number;
  offset: number|undefined;
  limit: number|undefined;
  isPartialView?: boolean;
  lastTouchedBy?: string;
  lastTouchedAt?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string,unknown>;
  maxResultSizeChars: number;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  isDestructive?: boolean;
  metadata?: Record<string,unknown>;
}

export interface ToolHandler {
  definition: ToolDefinition;
  validate: (input: Record<string,unknown>, ctx: ToolContext) => string|null;
  checkPermission: (input: Record<string,unknown>, ctx: ToolContext) => PermissionDecision;
  execute: (input: Record<string,unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string,unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  durationMs: number;
}
