import type { CommandResult } from '@kernlang/agon-mod-api';
import { formatResearchResult } from './implementation.js';

export interface ResearchSessionContext { cwd: string; signal: AbortSignal }
type Result = Parameters<typeof formatResearchResult>[0];
export interface ResearchSessionHost {
  assertCurrent(): void;
  now(): number;
  defaultEngines(): string[];
  resolveEngine(id: string): string | undefined;
  dispatch(event: { type: 'header'; title: string } | { type: 'info'; message: string }
    | { type: 'engine-block'; engineId: string; content: string }
    | { type: 'progress-clear' }
    | { type: 'progress-update'; engines: Array<{ id: string; status: string; elapsed: number; done: boolean; failed: boolean }> }): void;
  scheduleEvery(callback: () => void, milliseconds: number): () => void;
  appendMessage(message: { role: 'user' | 'engine'; engineId?: string; content: string; timestamp: string }): void;
  track(engineId: string, exchange: { prompt: string; response: string }): void;
  addResult(result: { type: 'research'; timestamp: string; question: string; engines: string[]; winner: string;
    data: { intent: string; answer: string; engineId: string; sources: Array<{ title: string; url: string }>; citationsVerified: number; citationsTotal: number } }): void;
  recordRun(result: { mode: 'research'; intent: string; winner: string; success: true; durationMs: number; engineIds: string[]; completionState: 'completed' }): void;
}

function readResult(value: unknown): Result {
  const r = value as Result | undefined;
  if (!r || typeof r !== 'object' || typeof r.ok !== 'boolean' || typeof r.answer !== 'string'
    || typeof r.engineId !== 'string' || typeof r.intent !== 'string'
    || !Array.isArray(r.sources) || !r.sources.every(s => s && typeof s.title === 'string' && typeof s.url === 'string')
    || !r.citations || !['total', 'verified', 'blocked'].every(key => {
      const n = r.citations[key as 'total' | 'verified' | 'blocked'];
      return Number.isSafeInteger(n) && n >= 0;
    }) || !Array.isArray(r.citations.results) || !r.citations.results.every(c => c && typeof c.verdict === 'string'
      && typeof c.url === 'string' && typeof c.detail === 'string')
    || (r.note !== undefined && typeof r.note !== 'string')
    || (r.ok && (!r.answer.trim() || !r.engineId || !r.citations.verified || r.citations.verified > r.citations.total))) {
    throw new Error('Research returned an invalid session result.');
  }
  return r;
}

/** Bind Research output to the captured session without changing citation policy. */
export async function runResearchSession(input: Record<string, unknown>, context: ResearchSessionContext,
  host: ResearchSessionHost,
  execute: (input: Record<string, unknown>, context: ResearchSessionContext) => Promise<CommandResult>,
): Promise<void> {
  const check = () => { context.signal.throwIfAborted(); host.assertCurrent(); };
  const effect = (run: () => void) => { check(); run(); check(); };
  check();
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) throw new Error('No question provided. Usage: /research <question>');
  const startedAt = host.now();
  const timestamp = () => new Date(host.now()).toISOString();
  let pool = [...new Set(typeof input.engines === 'string' && input.engines.trim()
    ? input.engines.split(',').map(id => id.trim()).filter(Boolean) : host.defaultEngines())];
  check();
  if (!pool.length) throw new Error('No engines available.');
  let engine = '';
  if (typeof input.engine === 'string' && input.engine.trim()) {
    const requested = input.engine.trim();
    engine = host.resolveEngine(requested) ?? '';
    check();
    if (!engine) effect(() => host.dispatch({ type: 'info', message: `Engine '${requested}' is not available — using rating-based selection.` }));
    else if (!pool.includes(engine)) pool = [engine, ...pool];
  }
  let stopTimer = () => {};
  let stopped = false;
  let cleared = false;
  const stop = () => { if (!stopped) { stopped = true; stopTimer(); } };
  const clear = () => {
    stop();
    if (cleared) return;
    try { host.assertCurrent(); cleared = true; host.dispatch({ type: 'progress-clear' }); } catch { /* Stale runs cannot clear newer output. */ }
  };
  context.signal.addEventListener('abort', clear, { once: true });
  try {
    effect(() => host.dispatch({ type: 'header', title: 'Research · keyless web-grounded' }));
    effect(() => host.dispatch({ type: 'info', message: question.length > 120 ? question.slice(0, 120) + '…' : question }));
    stopTimer = host.scheduleEvery(() => {
      try {
        check();
        const elapsed = Math.floor((host.now() - startedAt) / 1000);
        effect(() => host.dispatch({ type: 'progress-update', engines: [{ id: 'research', status: `researching… ${elapsed}s`, elapsed, done: false, failed: false }] }));
      } catch { clear(); }
    }, 250);
    check();
    const output = await execute({ ...input, question, engines: pool.join(','), engine, json: true, quiet: true }, context);
    check();
    clear();
    const structured = output.result;
    const note = structured && typeof structured === 'object' && !Array.isArray(structured)
      && typeof structured.note === 'string' ? structured.note.trim() : '';
    const failure = output.stderr?.trim() || note || 'Research found no grounded answer.';
    if ((output.exitCode ?? 0) !== 0) {
      effect(() => host.appendMessage({ role: 'user', content: `[research] ${question}`, timestamp: timestamp() }));
      effect(() => host.appendMessage({ role: 'engine', engineId: 'research', content: `Research found no grounded answer. (${failure})`, timestamp: timestamp() }));
      throw new Error(failure);
    }
    const result = readResult(output.result);
    if (!result.ok) throw new Error(result.note || failure);
    effect(() => host.dispatch({ type: 'engine-block', engineId: result.engineId, content: formatResearchResult(result) }));
    effect(() => host.appendMessage({ role: 'user', content: `[research] ${question}`, timestamp: timestamp() }));
    effect(() => host.appendMessage({ role: 'engine', engineId: result.engineId, content: result.answer, timestamp: timestamp() }));
    effect(() => host.track(result.engineId, { prompt: question, response: result.answer }));
    effect(() => host.addResult({ type: 'research', timestamp: timestamp(), question, engines: [result.engineId], winner: result.engineId,
      data: { intent: result.intent, answer: result.answer, engineId: result.engineId,
        sources: result.sources.map(({ title, url }) => ({ title, url })), citationsVerified: result.citations.verified, citationsTotal: result.citations.total } }));
    effect(() => host.recordRun({ mode: 'research', intent: question, winner: result.engineId, success: true,
      durationMs: host.now() - startedAt, engineIds: [result.engineId], completionState: 'completed' }));
  } finally {
    context.signal.removeEventListener('abort', clear);
    clear();
  }
}
