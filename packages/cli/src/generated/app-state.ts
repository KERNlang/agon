import type { Plan } from '@agon/core';

export type ReplStateState = 'idle' | 'busy' | 'streaming' | 'questioning';

export class ReplStateStateError extends Error {
  constructor(
    public readonly expected: string | string[],
    public readonly actual: string,
  ) {
    const expectedStr = Array.isArray(expected) ? expected.join(' | ') : expected;
    super(`Invalid replstate state: expected ${expectedStr}, got ${actual}`);
    this.name = 'ReplStateStateError';
  }
}

/** idle → busy */
export function startCommandReplState<T extends { state: ReplStateState }>(entity: T): T {
  if (entity.state !== 'idle') {
    throw new ReplStateStateError('idle', entity.state);
  }
  return { ...entity, state: 'busy' as ReplStateState };
}

/** busy → streaming */
export function startStreamReplState<T extends { state: ReplStateState }>(entity: T): T {
  if (entity.state !== 'busy') {
    throw new ReplStateStateError('busy', entity.state);
  }
  return { ...entity, state: 'streaming' as ReplStateState };
}

/** busy → questioning */
export function askQuestionReplState<T extends { state: ReplStateState }>(entity: T): T {
  if (entity.state !== 'busy') {
    throw new ReplStateStateError('busy', entity.state);
  }
  return { ...entity, state: 'questioning' as ReplStateState };
}

/** questioning → busy */
export function answerQuestionReplState<T extends { state: ReplStateState }>(entity: T): T {
  if (entity.state !== 'questioning') {
    throw new ReplStateStateError('questioning', entity.state);
  }
  return { ...entity, state: 'busy' as ReplStateState };
}

/** busy|streaming|questioning → idle */
export function finishReplState<T extends { state: ReplStateState }>(entity: T): T {
  const validStates: ReplStateState[] = ['busy', 'streaming', 'questioning'];
  if (!validStates.includes(entity.state)) {
    throw new ReplStateStateError(validStates, entity.state);
  }
  return { ...entity, state: 'idle' as ReplStateState };
}

/** busy|streaming → idle */
export function cancelReplState<T extends { state: ReplStateState }>(entity: T): T {
  const validStates: ReplStateState[] = ['busy', 'streaming'];
  if (!validStates.includes(entity.state)) {
    throw new ReplStateStateError(validStates, entity.state);
  }
  return { ...entity, state: 'idle' as ReplStateState };
}


export type OutputEventType = 'text' | 'engine-block' | 'streaming-chunk' | 'spinner-start' | 'spinner-stop' | 'spinner-update' | 'progress-update' | 'progress-clear' | 'separator' | 'header' | 'success' | 'error' | 'warning' | 'info' | 'plan' | 'plan-list' | 'scoreboard' | 'table' | 'clear' | 'dashboard' | 'help' | 'kern-draft' | 'debate-round' | 'verdict' | 'question';

export interface OutputEvent {
  type: OutputEventType;
  engineId?: string;
  data?: Record<string, unknown>;
}

export interface OutputEventMap {
  'text': { content: string };
  'engine-block': { engineId: string, color: number, content: string };
  'streaming-chunk': { engineId: string, chunk: string };
  'spinner-start': { message: string, color?: number };
  'spinner-stop': { message?: string };
  'spinner-update': { message: string };
  'progress-update': { engines: Array<{ id: string, status: string, elapsed: number, done: boolean, failed: boolean }> };
  'progress-clear': Record<string, unknown>;
  'separator': Record<string, unknown>;
  'header': { title: string };
  'success': { message: string };
  'error': { message: string };
  'warning': { message: string };
  'info': { message: string };
  'plan': { plan: Plan };
  'plan-list': { plans: Plan[] };
  'scoreboard': { title: string, winner?: string, metrics: Array<{ name: string, values: string[] }> };
  'table': { headers: string[], rows: string[][] };
  'clear': Record<string, unknown>;
  'dashboard': { engines: string[], eloStats: Record<string, { rating: number, wins: number, losses: number }>, activeWorkspace?: { name: string, path: string, isKern?: boolean }, runCount: number, defaultEngine: string };
  'help': Record<string, unknown>;
  'kern-draft': { engineId: string, content: string, critique?: string };
  'debate-round': { round: number, engineId: string, position: string, argument: string };
  'verdict': { summary: string };
  'question': { prompt: string, resolve: (answer: string) => void };
}

export type OutputEventCallback = (event: OutputEvent) => void;

