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

/**
 * A streamed unit from a PersistentSession.send() turn. 'text' is the authoritative answer; 'preview' is a SPECULATIVE, best-effort live draft (currently emitted only by the PTY brain while it waits for the DeliverAnswer channel). A 'preview' chunk may ONLY update the live/dynamic streaming pane — it must NEVER be committed to the transcript or accumulated into the final answer. Every consumer that does not understand 'preview' must ignore it (all current consumers accumulate only 'text' and break on 'done'/'error', so a new 'preview' falls through harmlessly).
 */
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
