import type { SynthesisResult } from './runtime.js';

export interface SynthesisSessionContext { cwd: string; signal: AbortSignal }
export interface SynthesisSessionCommandResult {
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly result?: unknown;
  readonly failure?: { readonly message?: string };
}
export type SynthesisSessionEvent =
  | { type: 'header'; title: string }
  | { type: 'info' | 'warning'; message: string }
  | { type: 'separator' | 'progress-clear' }
  | { type: 'kern-draft'; engineId: string; content: string; critique: string }
  | { type: 'engine-block'; engineId: string; content: string }
  | { type: 'progress-update'; engines: Array<{ id: string; status: string; elapsed: number; done: boolean; failed: boolean }> };
export interface SynthesisSessionHost {
  assertCurrent(): void;
  now(): number;
  defaultEngines(): string[];
  dispatch(event: SynthesisSessionEvent): void;
  scheduleEvery(callback: () => void, milliseconds: number): () => void;
  appendMessage(message: { role: 'user' | 'engine'; engineId?: string; content: string; timestamp: string }): void;
  track(engineId: string, exchange: { prompt: string; response: string }): void;
  addResult(result: { type: 'synthesis'; timestamp: string; question: string; engines: string[]; winner: string | null;
    data: { winner: string | null; judgeReasoning: string; swaps: number } }): void;
  recordRun(result: { mode: 'synthesis'; intent: string; winner?: string; success: boolean; durationMs: number;
    engineIds: string[]; completionState: 'completed' }): void;
}

function sessionResult(value: unknown): SynthesisResult {
  if (!value || typeof value !== 'object') throw new Error('Synthesis returned an invalid session result.');
  const result = value as SynthesisResult;
  if (typeof result.winner !== 'string' || typeof result.judgeReasoning !== 'string'
    || !Array.isArray(result.drafts) || !result.drafts.every(draft => draft && typeof draft.engineId === 'string' && typeof draft.content === 'string')
    || !Array.isArray(result.swaps) || !result.swaps.every(swap => swap && typeof swap.toEngineId === 'string' && typeof swap.improvedContent === 'string')
    || !Array.isArray(result.scores) || !result.scores.every(score => score && typeof score.engineId === 'string' && Number.isFinite(score.score))) {
    throw new Error('Synthesis returned an invalid session result.');
  }
  if (result.winner && !result.drafts.some(draft => draft.engineId === result.winner)) {
    throw new Error('Synthesis returned a winner without a draft.');
  }
  return result;
}

/** Keep session decisions in Synthesis; the host owns storage and terminal effects. */
export async function runSynthesisSession(
  input: Record<string, unknown>, context: SynthesisSessionContext, host: SynthesisSessionHost,
  execute: (input: Record<string, unknown>, context: SynthesisSessionContext) => Promise<SynthesisSessionCommandResult>,
): Promise<SynthesisResult> {
  const check = () => { context.signal.throwIfAborted(); host.assertCurrent(); };
  const effect = (run: () => void) => { check(); run(); check(); };
  check();
  const prompt = typeof input.input === 'string' ? input.input.trim() : '';
  if (!prompt) throw new Error('No prompt provided. Usage: /synthesis <task> [--swaps 2]');
  const engines = [...new Set(host.defaultEngines())];
  check();
  if (engines.length < 2) throw new Error(`Synthesis needs at least 2 engines to cross-pollinate (have ${engines.length}). Add engines with /engines.`);
  const swaps = input.swaps ?? 1;
  if (typeof swaps !== 'number' || !Number.isSafeInteger(swaps) || swaps < 0) throw new Error('Synthesis needs a non-negative integer swap count.');
  const start = host.now();
  let stopTimer = () => {};
  let stopped = false;
  let cleared = false;
  const stop = () => { if (!stopped) { stopped = true; stopTimer(); } };
  const clearProgress = () => {
    stop();
    if (cleared) return;
    host.assertCurrent();
    cleared = true;
    host.dispatch({ type: 'progress-clear' });
  };
  try {
    effect(() => host.dispatch({ type: 'header', title: `Synthesis · ${engines.length} engines · ${swaps} swap(s)` }));
    effect(() => host.dispatch({ type: 'info', message: prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt }));
    stopTimer = host.scheduleEvery(() => {
      if (stopped) return;
      try {
        check();
        const elapsed = Math.floor((host.now() - start) / 1000);
        effect(() => host.dispatch({ type: 'progress-update', engines: engines.map(id => ({ id,
          status: `synthesizing… ${elapsed}s`, elapsed, done: false, failed: false })) }));
      } catch {
        try { clearProgress(); } catch { /* Stale work cannot clear the current display. */ }
      }
    }, 250);
    check();
    const output = await execute({ ...input, input: prompt, swaps, engines: engines.join(',') }, context);
    check();
    effect(clearProgress);
    if ((output.exitCode ?? 0) !== 0 || output.failure) {
      throw new Error(output.stderr?.trim() || output.failure?.message || 'Synthesis produced no usable judged result.');
    }
    const result = sessionResult(output.result);
    effect(() => host.dispatch({ type: 'separator' }));
    for (const draft of result.drafts) {
      const score = result.scores.find(entry => entry.engineId === draft.engineId);
      const tag = `${result.winner === draft.engineId ? '★ winner' : 'draft'}${score ? ` · score ${score.score}` : ''}`;
      effect(() => host.dispatch({ type: 'kern-draft', engineId: draft.engineId, content: draft.content, critique: tag }));
    }
    effect(() => host.dispatch({ type: 'separator' }));
    if (result.winner) {
      let content = result.drafts.find(draft => draft.engineId === result.winner)?.content;
      for (const swap of result.swaps) if (swap.toEngineId === result.winner) content = swap.improvedContent;
      effect(() => host.dispatch({ type: 'engine-block', engineId: result.winner,
        content: `★ Winner: ${result.winner}\n\n${content ?? ''}\n\n— Judge —\n${result.judgeReasoning}` }));
      effect(() => host.appendMessage({ role: 'user', content: `[synthesis] ${prompt}`, timestamp: new Date(host.now()).toISOString() }));
      effect(() => host.appendMessage({ role: 'engine', engineId: result.winner, content: content ?? result.judgeReasoning, timestamp: new Date(host.now()).toISOString() }));
    } else effect(() => host.dispatch({ type: 'warning', message: 'Synthesis produced no winner.' }));
    for (const draft of result.drafts) effect(() => host.track(draft.engineId, { prompt, response: draft.content }));
    effect(() => host.addResult({ type: 'synthesis', timestamp: new Date(host.now()).toISOString(), question: prompt,
      engines, winner: result.winner || null, data: { winner: result.winner || null, judgeReasoning: result.judgeReasoning, swaps } }));
    effect(() => host.recordRun({ mode: 'synthesis', intent: prompt, winner: result.winner || undefined, success: !!result.winner,
      durationMs: host.now() - start, engineIds: engines, completionState: 'completed' }));
    return result;
  } finally {
    try { clearProgress(); } catch { /* Cleanup must not replace the outcome or clear a newer display. */ }
  }
}
