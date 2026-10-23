import { randomUUID } from 'node:crypto';
import { getModeConfig, isTribunalMode, isTribunalProtocol } from './modes.js';
import type { TribunalMode, TribunalProtocol } from './modes.js';
import type { TribunalResult } from './runtime.js';

export type TribunalSessionEvent =
  | { type: 'header'; title: string }
  | { type: 'info' | 'warning'; message: string }
  | { type: 'verdict'; summary: string }
  | { type: 'debate-round'; round: number; engineId: string; position: string; argument: string }
  | { type: 'progress-clear' }
  | { type: 'progress-update'; engines: Array<{ id: string; status: string; elapsed: number; done: boolean; failed: boolean }> };

export interface TribunalSessionContext {
  cwd: string;
  signal: AbortSignal;
  onWorkflowEvent(event: { type: string; engineId?: string; data?: Record<string, unknown> }): void;
  onRunStarted(path: string): void;
}

export interface TribunalSessionCommandResult {
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly result?: unknown;
  readonly failure?: { readonly message?: string };
}

export interface TribunalSessionHost {
  cwd(): string;
  hasSession(): boolean;
  defaultEngines(): { active: string[]; excluded: string[] };
  scanContext(cwd: string): string;
  now(): number;
  dispatch(event: TribunalSessionEvent): void;
  scheduleEvery(callback: () => void, milliseconds: number): () => void;
  checkpoint(runId: string, phase: 'pre-dispatch' | 'post-dispatch', engines: string[], metadata: Record<string, unknown>): void;
  createScoreboard(runId: string, engines: string[]): { finish(engineId: string, status: string): void; render(): string };
  createRecord(options: { question: string; engines: string[]; mode: TribunalMode; protocol: TribunalProtocol; startedAt: number; signal: AbortSignal }): { complete(result: TribunalResult): void };
}

/** Own session preparation and settlement; the caller supplies selected execution. */
export async function runTribunalSession(
  input: Record<string, unknown>, signal: AbortSignal, host: TribunalSessionHost,
  execute: (input: Record<string, unknown>, context: TribunalSessionContext) => Promise<TribunalSessionCommandResult>,
): Promise<unknown> {
  let stopTimer = () => {};
  let outputDir: string | undefined;
  try {
    signal.throwIfAborted();
    const cwd = host.cwd();
    if (!host.hasSession()) {
      const output = await execute(input, { cwd, signal, onWorkflowEvent: () => {}, onRunStarted: () => {} });
      signal.throwIfAborted();
      if ((output.exitCode ?? 0) !== 0) throw new Error(output.stderr?.trim() || output.failure?.message || 'Tribunal failed');
      const result = output.result ?? output;
      if (result && typeof result === 'object' && 'summary' in result && typeof result.summary === 'string') {
        host.dispatch({ type: 'verdict', summary: result.summary });
      }
      return result;
    }
    if (typeof input.question !== 'string' || !input.question.trim()) throw new Error('Tribunal requires a question.');
    const question = input.question;
    const defaults = input.engines === undefined ? host.defaultEngines() : undefined;
    if (defaults?.excluded.length) host.dispatch({ type: 'info', message: `Skipping disabled orchestration engines: ${defaults.excluded.join(', ')}` });
    const engines = defaults ? defaults.active.slice(0, 4)
      : (typeof input.engines === 'string' ? input.engines.split(',').map(id => id.trim()).filter(Boolean) : input.engines);
    if (!Array.isArray(engines) || !engines.every(id => typeof id === 'string' && id.length > 0) || engines.length < 2) {
      throw new Error('Tribunal needs at least 2 engines.');
    }
    const selected = engines.slice(0, 4) as string[];
    const mode = input.tribunalMode ?? input.mode ?? 'adversarial';
    if (typeof mode !== 'string' || !isTribunalMode(mode)) throw new Error(`Invalid tribunal mode: ${String(mode)}`);
    const requestedProtocol = String(input.tribunalProtocol ?? input.protocol ?? 'auto').toLowerCase();
    if (requestedProtocol !== 'auto' && !isTribunalProtocol(requestedProtocol)) throw new Error(`Invalid tribunal protocol: ${requestedProtocol}`);
    const protocol = requestedProtocol === 'auto' ? getModeConfig(mode, selected.length).protocol : requestedProtocol as TribunalProtocol;
    const context = host.scanContext(cwd);
    signal.throwIfAborted();
    const runId = `tribunal-${randomUUID()}`;
    const startedAt = host.now();
    const record = host.createRecord({ question, engines: selected, mode, protocol, startedAt, signal });
    const board = host.createScoreboard(runId, selected);
    host.checkpoint(runId, 'pre-dispatch', selected, { question, mode, protocol });
    const seats = new Map(selected.map(id => [id, { status: 'waiting', done: false }]));
    const progress = () => {
      if (signal.aborted) return;
      host.dispatch({ type: 'progress-update', engines: selected.map(id => ({ id, ...seats.get(id)!,
        elapsed: Math.floor((host.now() - startedAt) / 1000), failed: false })) });
    };
    host.dispatch({ type: 'header', title: `Tribunal (${mode}): ${question}` });
    for (const message of [`Engines: ${selected.join(', ')}`, `Mode: ${mode}`, `Protocol: ${protocol}`, ...(context ? [`Context: ${cwd}`] : [])]) host.dispatch({ type: 'info', message });
    progress();
    stopTimer = host.scheduleEvery(progress, 250);
    signal.throwIfAborted();
    const output = await execute({ ...input, question: context ? `${question}\n\n## PROJECT CONTEXT\n${context}` : question,
      engines: selected, mode, protocol }, {
      cwd, signal, onRunStarted: path => { outputDir = path; },
      onWorkflowEvent: event => {
        if (signal.aborted) return;
        if (event.engineId && seats.has(event.engineId) && event.data?.round && event.data.position) {
          seats.set(event.engineId, { status: `R${event.data.round} ${String(event.data.position)}`, done: false });
          progress();
        }
      },
    });
    stopTimer();
    signal.throwIfAborted();
    if ((output.exitCode ?? 0) !== 0) throw new Error(output.stderr?.trim() || output.failure?.message || 'Tribunal failed');
    const result = output.result as TribunalResult | undefined;
    if (!result || typeof result.summary !== 'string' || !Array.isArray(result.rounds)) throw new Error('Tribunal returned an invalid session result.');
    for (const id of selected) board.finish(id, seats.get(id)?.status ?? 'done');
    host.dispatch({ type: 'info', message: board.render() });
    host.checkpoint(runId, 'post-dispatch', selected, { question, mode, protocol });
    signal.throwIfAborted();
    for (const id of selected) seats.set(id, { status: '✓ done', done: true });
    progress();
    host.dispatch({ type: 'progress-clear' });
    for (const round of result.rounds) {
      host.dispatch({ type: 'header', title: `Round ${round.round}` });
      for (const position of round.positions) host.dispatch({ type: 'debate-round', round: round.round,
        engineId: position.engineId, position: position.position, argument: position.arguments[0] ?? '' });
    }
    if (result.panelHealth?.banner) host.dispatch({ type: 'info', message: `⚠ ${result.panelHealth.banner}` });
    host.dispatch({ type: 'header', title: mode === 'socratic' ? 'Unresolved Questions' : mode === 'red-team' ? 'Risk Register' : mode === 'synthesis' ? 'Decision Matrix' : mode === 'postmortem' ? 'Postmortem Report' : 'Verdict' });
    signal.throwIfAborted();
    host.dispatch({ type: 'verdict', summary: result.summary });
    if (outputDir) host.dispatch({ type: 'info', message: `Full debate saved: ${outputDir}` });
    signal.throwIfAborted();
    record.complete(result);
    return result;
  } finally {
    stopTimer();
    host.dispatch({ type: 'progress-clear' });
  }
}
