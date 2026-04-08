// @kern-source: tool-types:4
export interface ToolInput {
  type: string;
}

// @kern-source: tool-types:5

// @kern-source: tool-types:7
export interface ToolResult {
  ok: boolean;
  content: string;
  error?: string;
  metadata?: Record<string,unknown>;
}

// @kern-source: tool-types:13
export interface PermissionDecision {
  behavior: 'allow'|'ask'|'deny';
  message?: string;
  reason?: string;
}

// @kern-source: tool-types:18
export interface ToolContext {
  cwd: string;
  readFileState: Map<string, FileState>;
  abortSignal?: AbortSignal;
  permissionMode?: 'auto'|'ask'|'deny-all';
  explorationMode?: boolean;
  allowedCommands?: string[];
  toolPermissions?: Record<string,'allow'|'ask'|'deny'>;
  onProgress?: ((message: string) => void);
}

// @kern-source: tool-types:28
export interface FileState {
  content: string;
  timestamp: number;
  offset: number|undefined;
  limit: number|undefined;
  isPartialView?: boolean;
}

// @kern-source: tool-types:35
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string,unknown>;
  maxResultSizeChars: number;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  isDestructive?: boolean;
}

// @kern-source: tool-types:44
export interface ToolHandler {
  definition: ToolDefinition;
  validate: (input: Record<string,unknown>, ctx: ToolContext) => string|null;
  checkPermission: (input: Record<string,unknown>, ctx: ToolContext) => PermissionDecision;
  execute: (input: Record<string,unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// @kern-source: tool-types:50
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string,unknown>;
}

// @kern-source: tool-types:55
export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  durationMs: number;
}

