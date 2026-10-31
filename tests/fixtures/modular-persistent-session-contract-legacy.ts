// Legacy contract oracle from 26c026356a28dfd681aeacbc0e3aa2b4acd7c0d7.
// Source: Core sessions/persistent-session.ts and sessions/turn-protocol.ts.
// Test-only declarations. Production code must not import this fixture.

export interface ControlPlaneEnvelopeV1 {
  schemaVersion: 1;
  sessionId: string;
  turnId: string;
  leaseEpoch: number;
  attempt: number;
  producerId: string;
  responseSeq?: number;
  stepId?: string;
  toolCallId?: string;
}

export interface SessionChunk {
  type: 'text'|'preview'|'status'|'tool_call'|'error'|'done';
  content: string;
  metadata?: Record<string,unknown>;
}

export interface SessionSendOptions {
  message: string;
  images?: string[];
  signal?: AbortSignal;
  systemPrompt?: string;
  toolLoopBaseBudget?: number;
  toolLoopMaxBudget?: number;
  controlPlane?: ControlPlaneEnvelopeV1;
  gateMatchers?: string[];
  shouldYield?: () => boolean;
}

export interface PersistentSession {
  alive: boolean;
  sessionId: string|null;
  engineId: string;
  pid?: number|null;
  start: () => Promise<void>;
  send: (opts: SessionSendOptions) => AsyncGenerator<SessionChunk, void, void>;
  close: () => void;
  getMessageHistory: () => Array<{role:string,content:any,tool_calls?:any[],tool_call_id?:string}>;
  getContextUsage?: () => {tokens:number, limit:number, softLimit:number, source:'api'|'projected'|'estimate', cachedInputTokens:number};
  compact?: () => Promise<{ok:boolean, method:'llm'|'regex'|'none'|'deferred', beforeTokens:number, afterTokens:number, limit:number}>;
  getTurnUsage?: () => {promptTokens:number, completionTokens:number, totalTokens:number, cachedInputTokens?:number, source:'sdk', model?:string} | null;
  getReadPaths?: () => string[] | undefined;
}
