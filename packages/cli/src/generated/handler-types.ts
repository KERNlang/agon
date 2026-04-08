// @kern-source: handler-types:1
import type { EngineRegistry, EngineAdapter, Plan, AgonConfig, ChatSession, PersistentSession, CesarMemory } from '@agon/core';

// @kern-source: handler-types:3
export interface EngineProgress {
  id: string;
  status: string;
  elapsed: number;
  done: boolean;
  failed: boolean;
  score?: string;
}

// @kern-source: handler-types:11
export type OutputEvent =
  | { type: 'text'; content: string }
  | { type: 'engine-block'; engineId: string; color: number; content: string }
  | { type: 'streaming-chunk'; engineId: string; chunk: string }
  | { type: 'streaming-end'; engineId: string }
  | { type: 'spinner-start'; message: string; color?: number }
  | { type: 'spinner-stop'; message?: string }
  | { type: 'spinner-update'; message: string }
  | { type: 'progress-update'; engines: EngineProgress[] }
  | { type: 'progress-clear' }
  | { type: 'separator' }
  | { type: 'header'; title: string }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }
  | { type: 'warning'; message: string }
  | { type: 'info'; message: string }
  | { type: 'plan'; plan: Plan }
  | { type: 'plan-list'; plans: Plan[] }
  | { type: 'plan-proposal'; plan: any; markdown: string }
  | { type: 'scoreboard'; title: string; winner?: string; engineIds: string[]; metrics: { label: string; values: string[] }[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'clear' }
  | { type: 'kern-draft'; engineId: string; content: string; critique?: string }
  | { type: 'debate-round'; round: number; engineId: string; position: string; argument: string }
  | { type: 'verdict'; summary: string }
  | { type: 'question'; prompt: string; resolve: (answer: string) => void }
  | { type: 'permission-ask'; tool: string; command: string; description?: string; reason: string; resolve: (approved: boolean) => void }
  | { type: 'patch-review'; winnerId: string; patchPath: string; patchContent: string }
  | { type: 'tool-call'; engineId: string; tool: string; input: string; status: 'running'|'done'|'error'; output?: string }
  | { type: 'user-message'; content: string }
  | { type: 'response-meta'; engineId: string; elapsed: number; inputTokens?: number; outputTokens?: number; cost?: number }
  | { type: 'confidence-update'; value: number|null; engineId: string }
  | { type: 'file-changes'; files: { path: string; status: 'modified'|'created'|'deleted'; additions: number; deletions: number }[] }
  | { type: 'dashboard'; available: string[]; enabled: string[]; defaultEngine: string; eloTop?: { id: string; rating: number }; totalForges: number; workspace?: { name: string; path: string; isKern?: boolean }; runCount: number };

// @kern-source: handler-types:112
export interface HandlerContext {
  registry: EngineRegistry;
  adapter: EngineAdapter;
  activeEngines: () => string[];
  config: AgonConfig;
  chatSession: ChatSession;
  currentPlan: Plan | null;
  setCurrentPlan: (plan: Plan | null) => void;
  setActiveAbort: (abort: AbortController | null) => void;
  askQuestion: (prompt: string) => Promise<string>;
  cesarSession: PersistentSession | null;
  setCesarSession: (session: PersistentSession | null) => void;
  explorationMode: boolean;
  setExplorationMode: (mode: boolean) => void;
  neroMode: boolean;
  setNeroMode: (mode: boolean) => void;
  cesarMemory: CesarMemory;
}

