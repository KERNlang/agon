import type { CouncilResult } from './runtime.js';

export interface CouncilSessionContext { cwd: string; signal: AbortSignal }
export interface CouncilSessionCommandResult {
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly result?: unknown;
  readonly failure?: { readonly code?: string; readonly message?: string };
}
export type CouncilSessionEvent =
  | { type: 'header'; title: string }
  | { type: 'info' | 'warning' | 'error'; message: string }
  | { type: 'text'; content: string }
  | { type: 'separator' | 'progress-clear' }
  | { type: 'engine-block'; engineId: string; content: string }
  | { type: 'progress-update'; engines: Array<{ id: string; status: string; elapsed: number; done: boolean; failed: boolean }> };
export interface CouncilSessionHost {
  assertCurrent(): void;
  now(): number;
  defaultEngines(): string[];
  resolveChairman(id: string): string | undefined;
  dispatch(event: CouncilSessionEvent): void;
  scheduleEvery(callback: () => void, milliseconds: number): () => void;
  appendMessage(message: { role: 'engine'; engineId: string; content: string; timestamp: string }): void;
  track(engineId: string, exchange: { prompt: string; response: string }): void;
  addResult(result: { type: 'council'; timestamp: string; question: string; engines: string[]; winner: string;
    data: { verdict: string; chairmanId: string; confidence: number | null; seats: Array<{ role: string; engineId: string }> } }): void;
  recordRun(result: { mode: 'council'; intent: string; winner: string; success: true; durationMs: number; engineIds: string[]; completionState: 'completed' }): void;
}

function sessionResult(value: unknown): CouncilResult {
  if (!value || typeof value !== 'object') throw new Error('Council returned an invalid session result.');
  const result = value as CouncilResult;
  if (result.ok !== true || typeof result.chairmanId !== 'string' || !result.chairmanId
    || typeof result.actingChairmanId !== 'string' || typeof result.verdict !== 'string'
    || !result.verdict.trim() || typeof result.brief !== 'string'
    || !(result.confidence === null || (Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 100))
    || !Array.isArray(result.warnings) || !result.warnings.every(warning => typeof warning === 'string')
    || !Array.isArray(result.seats) || !result.seats.every(seat => seat && typeof seat.engineId === 'string'
      && typeof seat.role === 'string' && typeof seat.response === 'string'
      && typeof seat.critique === 'string' && typeof seat.critiquedRole === 'string')) {
    throw new Error('Council returned an invalid session result.');
  }
  return result;
}

/** Own Council session effects; the host binds them to one session and generation. */
export async function runCouncilSession(
  input: Record<string, unknown>, context: CouncilSessionContext, host: CouncilSessionHost,
  execute: (input: Record<string, unknown>, context: CouncilSessionContext) => Promise<CouncilSessionCommandResult>,
): Promise<CouncilResult> {
  const check = () => { context.signal.throwIfAborted(); host.assertCurrent(); };
  const effect = (run: () => void) => { check(); run(); check(); };
  check();
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) throw new Error('No decision provided. Usage: /council <decision>');
  let pool = [...new Set(typeof input.engines === 'string' && input.engines.trim()
    ? input.engines.split(',').map(id => id.trim()).filter(Boolean) : host.defaultEngines())];
  check();
  let chairman: string | undefined;
  if (typeof input.chairman === 'string' && input.chairman.trim()) {
    const requested = input.chairman.trim();
    chairman = host.resolveChairman(requested);
    check();
    if (!chairman) effect(() => host.dispatch({ type: 'info', message: `Chairman '${requested}' is not available — using rating-based selection.` }));
  }
  if (chairman && !pool.includes(chairman)) pool = [chairman, ...pool];
  if (pool.length < 2) throw new Error(`A council needs at least 2 engines (have ${pool.length}). Add engines with /engines.`);
  const startedAt = host.now();
  let stopTimer = () => {};
  let stopped = false;
  let cleared = false;
  const stop = () => { if (!stopped) { stopped = true; stopTimer(); } };
  try {
    effect(() => host.dispatch({ type: 'header', title: `Council · ${pool.length} engines` }));
    effect(() => host.dispatch({ type: 'info', message: question.length > 120 ? question.slice(0, 120) + '…' : question }));
    stopTimer = host.scheduleEvery(() => {
      if (stopped) return;
      try {
        check();
        const elapsed = Math.floor((host.now() - startedAt) / 1000);
        effect(() => host.dispatch({ type: 'progress-update', engines: pool.map(id => ({ id, status: `deliberating… ${elapsed}s`, elapsed, done: false, failed: false })) }));
      } catch { stop(); }
    }, 250);
    check();
    const output = await execute({ ...input, question, engines: pool.join(','), chairman: chairman ?? '', _: [], json: true, quiet: true,
      roles: Array.isArray(input.roles) ? input.roles.join(',') : input.roles }, context);
    check();
    stop();
    effect(() => { cleared = true; host.dispatch({ type: 'progress-clear' }); });
    const receiptFailed = output.failure?.code === 'COUNCIL_RECEIPT_FAILED';
    const failureMessage = output.stderr?.trim() || output.failure?.message || 'Council produced no usable verdict.';
    if ((output.exitCode ?? 0) !== 0 && !receiptFailed) throw new Error(failureMessage);
    const result = sessionResult(output.result);
    const seating = result.seats.map(seat => `${seat.role}=${seat.engineId}`).join(', ');
    effect(() => host.dispatch({ type: 'info', message: `Chair: ${result.chairmanId}  ·  ${seating}` }));
    if (result.brief && result.brief !== question) effect(() => host.dispatch({ type: 'text', content: `Decision brief:\n${result.brief}` }));
    for (const seat of result.seats) {
      const content = seat.critique ? `${seat.response || '(no response)'}\n\n↳ ${seat.role} critiquing ${seat.critiquedRole}:\n${seat.critique}` : seat.response || '(no response)';
      effect(() => host.dispatch({ type: 'engine-block', engineId: seat.engineId, content: `[${seat.role}]\n${content}` }));
      effect(() => host.appendMessage({ role: 'engine', engineId: seat.engineId, content: `[council:${seat.role}] ${seat.response || ''}`, timestamp: new Date(host.now()).toISOString() }));
      effect(() => host.track(seat.engineId, { prompt: question, response: seat.response || '' }));
    }
    effect(() => host.dispatch({ type: 'separator' }));
    const verdictBy = result.actingChairmanId || result.chairmanId;
    effect(() => host.dispatch({ type: 'engine-block', engineId: verdictBy, content: `━━━ Chairman verdict ━━━\n${result.verdict}${result.confidence != null ? `\n\nConfidence: ${result.confidence}%` : ''}` }));
    effect(() => host.appendMessage({ role: 'engine', engineId: verdictBy, content: `[council:verdict] ${result.verdict}`, timestamp: new Date(host.now()).toISOString() }));
    for (const warning of result.warnings) effect(() => host.dispatch({ type: 'info', message: `⚠ ${warning}` }));
    effect(() => host.addResult({ type: 'council', timestamp: new Date(host.now()).toISOString(), question, engines: pool, winner: verdictBy,
      data: { verdict: result.verdict, chairmanId: result.chairmanId, confidence: result.confidence, seats: result.seats.map(({ role, engineId }) => ({ role, engineId })) } }));
    if (receiptFailed) {
      effect(() => host.dispatch({ type: 'warning', message: failureMessage }));
      throw new Error(failureMessage);
    }
    effect(() => host.recordRun({ mode: 'council', intent: question, winner: verdictBy, success: true, durationMs: host.now() - startedAt, engineIds: pool, completionState: 'completed' }));
    return result;
  } finally {
    try { stop(); } catch { /* Timer cleanup must not replace the outcome. */ }
    if (!cleared) {
      try { check(); host.dispatch({ type: 'progress-clear' }); } catch { /* A stale invocation cannot clear the current display. */ }
    }
  }
}
