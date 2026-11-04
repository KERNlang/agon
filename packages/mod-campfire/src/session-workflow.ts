import { campfireTopic } from './input.js';

export type CampfireSessionEvent =
  | { type: 'header'; title: string }
  | { type: 'info' | 'warning'; message: string }
  | { type: 'engine-block'; engineId: string; content: string }
  | { type: 'progress-clear' }
  | { type: 'progress-update'; engines: Array<{ id: string; status: string; elapsed: number; done: boolean; failed: boolean }> };

export interface CampfireSessionContext { cwd: string; signal: AbortSignal }
export interface CampfireSessionCommandResult {
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly result?: unknown;
  readonly failure?: { readonly message?: string };
}
type Round = { engineId: string; content: string };
export interface CampfireSessionHost {
  cwd(): string;
  hasSession(): boolean;
  defaultEngines(): { active: string[]; excluded: string[] };
  scanContext(cwd: string): string;
  now(): number;
  dispatch(event: CampfireSessionEvent): void;
  scheduleEvery(callback: () => void, milliseconds: number): () => void;
  appendMessage(message: { role: 'engine'; engineId: string; content: string; timestamp: string }): void;
  track(engineId: string, exchange: { prompt: string; response: string }): void;
  addResult(result: { type: 'campfire'; timestamp: string; question: string; engines: string[]; winner: null; data: { rounds: Round[] } }): void;
  recordRun(result: { mode: 'campfire'; intent: string; success: true; durationMs: number; engineIds: string[]; completionState: 'completed' }): void;
}

/** Own session policy; the host binds storage and selected execution. */
export async function runCampfireSession(
  input: Record<string, unknown>, signal: AbortSignal, host: CampfireSessionHost,
  execute: (input: Record<string, unknown>, context: CampfireSessionContext) => Promise<CampfireSessionCommandResult>,
): Promise<unknown> {
  let stopTimer = () => {};
  let stopped = false;
  const stopProgress = () => {
    if (stopped) return;
    stopped = true;
    stopTimer();
  };
  const checked = (effect: () => void) => { signal.throwIfAborted(); effect(); signal.throwIfAborted(); };
  try {
    signal.throwIfAborted();
    const cwd = host.cwd();
    const hasSession = host.hasSession();
    const startedAt = host.now();
    let prepared = input;
    let engines: string[] = [];
    const topic = campfireTopic(input);
    if (hasSession) {
      if (!topic.trim()) throw new Error('Campfire requires a topic.');
      const defaults = input.engines === undefined ? host.defaultEngines() : undefined;
      if (defaults?.excluded.length) checked(() => host.dispatch({ type: 'info', message: `Skipping disabled orchestration engines: ${defaults.excluded.join(', ')}` }));
      const selected = defaults?.active ?? (typeof input.engines === 'string' ? input.engines.split(',').map(id => id.trim()).filter(Boolean) : input.engines);
      if (!Array.isArray(selected) || !selected.length || !selected.every(id => typeof id === 'string' && id.length > 0)) throw new Error('No engines available.');
      engines = [...selected];
      const strategy = input.strategy ?? input.observerStrategy ?? 'all-respond';
      if (strategy !== 'all-respond' && strategy !== 'lead-first') throw new Error('Invalid Campfire strategy.');
      const lead = input.lead ?? input.leadEngine;
      prepared = { ...input, topic, _: [], context: input.context ?? host.scanContext(cwd), engines: engines.join(','), strategy,
        lead: typeof lead === 'string' && engines.includes(lead) ? lead : engines[0] };
      checked(() => host.dispatch({ type: 'header', title: 'Campfire — no competition, just thinking together' }));
      checked(() => host.dispatch({ type: 'info', message: `Topic: ${topic}` }));
      stopTimer = host.scheduleEvery(() => {
        if (signal.aborted || stopped) return;
        try {
          const elapsed = Math.floor((host.now() - startedAt) / 1000);
          host.dispatch({ type: 'progress-update', engines: engines.map(id => ({ id, status: `thinking… ${elapsed}s`, elapsed, done: false, failed: false })) });
        } catch (error) {
          // Progress is optional; execution must still settle and release its lease.
          try { stopProgress(); } catch { /* Preserve the display failure for diagnostics. */ }
          try { host.dispatch({ type: 'warning', message: `Campfire progress stopped: ${error instanceof Error ? error.message : String(error)}` }); }
          catch { /* A closed display cannot report its own failure. */ }
        }
      }, 250);
    }
    signal.throwIfAborted();
    const output = await execute(prepared, { cwd, signal });
    signal.throwIfAborted();
    if ((output.exitCode ?? 0) !== 0) throw new Error(output.stderr?.trim() || output.failure?.message || 'Campfire failed');
    const result = output.result;
    if (!result || typeof result !== 'object' || !('rounds' in result) || !Array.isArray(result.rounds)
      || !result.rounds.every((round: unknown) => round !== null && typeof round === 'object'
        && 'engineId' in round && typeof round.engineId === 'string' && 'content' in round && typeof round.content === 'string')) {
      throw new Error('Campfire returned an invalid session result.');
    }
    const rounds = result.rounds as Round[];
    for (const round of rounds) {
      checked(() => host.dispatch({ type: 'engine-block', ...round }));
      if (hasSession) {
        checked(() => host.appendMessage({ role: 'engine', ...round, timestamp: new Date(host.now()).toISOString() }));
        checked(() => host.track(round.engineId, { prompt: topic, response: round.content }));
      }
    }
    if (hasSession) {
      // These stores commit in order, not as one transaction.
      checked(() => host.addResult({ type: 'campfire', timestamp: new Date(host.now()).toISOString(), question: topic, engines, winner: null, data: { rounds } }));
      checked(() => host.recordRun({ mode: 'campfire', intent: topic, success: true, durationMs: host.now() - startedAt, engineIds: engines, completionState: 'completed' }));
    }
    return result;
  } finally {
    try { stopProgress(); } catch { /* Cleanup must not replace the workflow outcome. */ }
    try { host.dispatch({ type: 'progress-clear' }); } catch { /* Display cleanup must not reverse saved records. */ }
  }
}
