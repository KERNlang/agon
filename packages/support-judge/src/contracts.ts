export interface JudgeManifest {
  forgeId: string;
  forgeDir: string;
  task: string;
  fitnessCmd: string;
  engines: string[];
  /** Persisted forge result envelopes are versioned by the forge producer. */
  results: Record<string, any>;
  patches: Record<string, string>;
  winner: string | null;
  starter: string;
  enginesDispatched: number;
  alreadySatisfied?: boolean;
  singleSurvivor?: boolean;
  error?: string;
}

export interface ConvergenceEntry {
  file: string;
  fn: string;
  from: string;
  reason: string;
}

export interface JudgeVerdict {
  winner: string;
  strengths: Array<{ engineId: string; category: string; reason: string }>;
  convergencePlan: ConvergenceEntry[];
  summary: string;
  shouldConverge: boolean;
}

export interface JudgeChunk {
  type: string;
  content?: string;
}

export interface JudgeSession {
  alive: boolean;
  send(input: { message: string; signal?: AbortSignal }): AsyncIterable<JudgeChunk>;
}

export type JudgeOutputEvent =
  | { type: 'engine-block'; engineId: string; color: number; content: string }
  | { type: 'spinner-start'; message: string; color?: number }
  | { type: 'spinner-stop'; message?: string }
  | { type: 'header'; title: string }
  | { type: 'success' | 'warning' | 'info'; message: string };

export type JudgeDispatch = (event: JudgeOutputEvent) => void;

export interface JudgeContext {
  config: {
    cesarEngine?: string;
    forgeFixedStarter?: string;
  };
}

export interface JudgeRuntime {
  ensureSession(context: JudgeContext): Promise<JudgeSession>;
  engineColor(engineId: string): number;
  parseConfidence(response: string): { value: number | null; rest: string };
  confidenceBadge(value: number): string;
  classifyTask(task: string): string;
  extractPatchFilePatterns(patches: string): string[];
  recordJudgment(
    winner: string,
    automaticWinner: string | null,
    engines: string[],
    taskClass: string,
    forgeId: string,
    summary: string,
    strengths: JudgeVerdict['strengths'],
    patchPatterns: string[],
  ): void;
}
