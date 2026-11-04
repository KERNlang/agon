import { isThinkStrategy, joinProblemInput } from './thinking.js';
import type { ThinkResult } from './thinking.js';
import { thoughtGlyph } from './presentation.js';

export type ThinkSessionEvent =
  | { type: 'header'; title: string }
  | { type: 'info' | 'warning'; message: string }
  | { type: 'text'; content: string }
  | { type: 'engine-block'; engineId: string; content: string; color?: number }
  | { type: 'progress-clear' }
  | { type: 'progress-update'; engines: Array<{ id: string; status: string; elapsed: number; done: boolean; failed: boolean }> };
export interface ThinkSessionContext { cwd: string; signal: AbortSignal }
export interface ThinkSessionCommandResult {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly result?: unknown;
  readonly failure?: { readonly code?: string; readonly message?: string };
}
export interface ThinkSessionHost {
  assertCurrent(): void;
  now(): number;
  defaultEngine(): string | undefined;
  dispatch(event: ThinkSessionEvent): void;
  scheduleEvery(callback: () => void, milliseconds: number): () => void;
  appendMessage(message: { role: 'user' | 'engine'; engineId?: string; content: string; timestamp: string }): void;
  track(engineId: string, exchange: { prompt: string; response: string }): void;
  addResult(result: { type: 'think'; timestamp: string; question: string; engines: string[]; winner: string;
    data: { strategy: string; thoughtCount: number; summary: string; openQuestions: string[] } }): void;
  recordRun(result: { mode: 'think'; intent: string; winner: string; success: true; durationMs: number; engineIds: string[]; completionState: 'completed' }): void;
}

function sessionResult(value: unknown): ThinkResult {
  if (!value || typeof value !== 'object') throw new Error('Think returned an invalid session result.');
  const result = value as ThinkResult;
  if (result.ok !== true || typeof result.engineId !== 'string' || typeof result.strategy !== 'string'
    || typeof result.summary !== 'string' || !Array.isArray(result.openQuestions)
    || !result.openQuestions.every(question => typeof question === 'string') || !Array.isArray(result.thoughts)
    || !result.thoughts.every(thought => thought && typeof thought.thought === 'string'
      && typeof thought.kind === 'string' && Number.isFinite(thought.thoughtNumber) && Number.isFinite(thought.totalThoughts))
    || (result.adversarialCritique !== undefined && typeof result.adversarialCritique !== 'string')
    || (result.chosenBranch !== undefined && typeof result.chosenBranch !== 'string')) {
    throw new Error('Think returned an invalid session result.');
  }
  return result;
}

/** Own Think session policy; the host supplies effects bound to one invocation. */
export async function runThinkSession(
  input: Record<string, unknown>, context: ThinkSessionContext, host: ThinkSessionHost,
  execute: (input: Record<string, unknown>, context: ThinkSessionContext) => Promise<ThinkSessionCommandResult>,
): Promise<ThinkResult> {
  const check = () => { context.signal.throwIfAborted(); host.assertCurrent(); };
  const effect = (run: () => void) => { check(); run(); check(); };
  check();
  const named = typeof input.input === 'string' ? input.input : typeof input.problem === 'string' ? input.problem : '';
  const problem = joinProblemInput(named, Array.isArray(input._) ? input._.map(String) : []);
  if (!problem) throw new Error('No problem provided. Usage: /think <problem> [--strategy reflexion] [--steps 8]');
  const engineId = typeof input.engine === 'string' && input.engine.trim() ? input.engine.trim() : host.defaultEngine();
  if (!engineId) throw new Error('No engines available.');
  const requested = typeof input.strategy === 'string' ? input.strategy : 'linear';
  const strategy = isThinkStrategy(requested) ? requested : 'linear';
  if (requested !== strategy) effect(() => host.dispatch({ type: 'info', message: `Unknown strategy '${requested}' — using linear (valid: linear|reflexion|tot|graph|hypothesis).` }));
  const startedAt = host.now();
  let stopTimer = () => {};
  let stopped = false;
  let progressCleared = false;
  const stop = () => { if (!stopped) { stopped = true; stopTimer(); } };
  try {
    effect(() => host.dispatch({ type: 'header', title: `Think · ${strategy} · ${engineId}` }));
    effect(() => host.dispatch({ type: 'info', message: problem.length > 120 ? problem.slice(0, 120) + '…' : problem }));
    stopTimer = host.scheduleEvery(() => {
      if (stopped) return;
      try {
        check();
        const elapsed = Math.floor((host.now() - startedAt) / 1000);
        effect(() => host.dispatch({ type: 'progress-update', engines: [{ id: engineId, status: `thinking… ${elapsed}s`, elapsed, done: false, failed: false }] }));
      } catch { stop(); }
    }, 250);
    check();
    const output = await execute({ ...input, input: problem, problem, _: [], strategy, engine: engineId, json: true, quiet: true }, context);
    check();
    stop();
    effect(() => { progressCleared = true; host.dispatch({ type: 'progress-clear' }); });
    if (output.stdout) effect(() => host.dispatch({ type: 'info', message: output.stdout! }));
    const receiptFailed = output.failure?.code === 'THINK_RECEIPT_FAILED';
    const failureMessage = output.stderr?.trim() || output.failure?.message || 'Think failed.';
    if ((output.exitCode ?? 0) !== 0 && !receiptFailed) throw new Error(failureMessage);
    const result = sessionResult(output.result);
    const lines = result.thoughts.map(thought => `${thoughtGlyph(thought.kind)} ${thought.thoughtNumber}/${thought.totalThoughts} [${thought.kind}] ${thought.thought}${thought.grounded === false ? '  ⚠ ungrounded' : ''}${thought.pruned ? ' ✂ pruned' : ''}`);
    effect(() => host.dispatch({ type: 'text', content: lines.join('\n') }));
    if (result.chosenBranch) effect(() => host.dispatch({ type: 'info', message: `Chosen branch: ${result.chosenBranch}` }));
    if (result.summary) effect(() => host.dispatch({ type: 'engine-block', engineId: result.engineId, content: result.summary }));
    if (result.openQuestions.length) effect(() => host.dispatch({ type: 'text', content: ['Open questions:', ...result.openQuestions.map(question => `  ❓ ${question}`)].join('\n') }));
    if (result.adversarialCritique) effect(() => host.dispatch({ type: 'engine-block', engineId: result.criticEngineId ?? 'critic', color: 196, content: result.adversarialCritique! }));
    const persisted = result.summary || lines.join('\n');
    effect(() => host.appendMessage({ role: 'user', content: `[think] ${problem}`, timestamp: new Date(host.now()).toISOString() }));
    effect(() => host.appendMessage({ role: 'engine', engineId: result.engineId, content: persisted, timestamp: new Date(host.now()).toISOString() }));
    effect(() => host.track(result.engineId, { prompt: problem, response: persisted }));
    effect(() => host.addResult({ type: 'think', timestamp: new Date(host.now()).toISOString(), question: problem, engines: [result.engineId], winner: result.engineId,
      data: { strategy: result.strategy, thoughtCount: result.thoughts.length, summary: result.summary, openQuestions: result.openQuestions } }));
    if (receiptFailed) {
      effect(() => host.dispatch({ type: 'warning', message: failureMessage }));
      throw new Error(failureMessage);
    }
    effect(() => host.recordRun({ mode: 'think', intent: problem, winner: result.engineId, success: true, durationMs: host.now() - startedAt, engineIds: [result.engineId], completionState: 'completed' }));
    return result;
  } finally {
    try { stop(); } catch { /* Timer cleanup must not replace the outcome. */ }
    if (!progressCleared) {
      try { check(); host.dispatch({ type: 'progress-clear' }); } catch { /* A stale invocation cannot clear the current display. */ }
    }
  }
}
