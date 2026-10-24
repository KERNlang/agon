import type { BrainstormResult } from './result.js';
import type { BrainstormWorkflowEvent } from './host.js';

export interface BrainstormProgress {
  id: string;
  status: string;
  elapsed: number;
  done: boolean;
  failed: boolean;
}

export type BrainstormPresentationEvent =
  | { type: 'progress-update'; engines: BrainstormProgress[] }
  | { type: 'progress-clear' | 'separator' }
  | { type: 'info' | 'warning'; message: string }
  | { type: 'kern-draft'; engineId: string; content: string; critique: string }
  | { type: 'engine-block'; engineId: string; color: number; content: string };

/** Terminal primitives only. Brainstorm owns event interpretation and display decisions. */
export interface BrainstormPresentationHost {
  now(): number;
  /** Register periodic work; return an idempotent cancellation callback. */
  scheduleEvery(callback: () => void, milliseconds: number): () => void;
  dispatch(event: BrainstormPresentationEvent): void;
  icons(): { success: string; fail: string; winner: string };
  engineColor(engineId: string): number;
  createScoreboard(runId: string): {
    entries(): readonly { engineId: string; state: string }[];
    add(engineId: string): void;
    start(engineId: string): void;
    finish(engineId: string, result: { score?: number; result?: string }): void;
    fail(engineId: string, reason: string): void;
    render(): string;
  };
}

/** Invocation-local presentation only; execution stays in the physical mod. */
export function createBrainstormPresentation(host: BrainstormPresentationHost) {
  const startedAt = host.now();
  const seats = new Map<string, { status: string; done: boolean; failed: boolean }>();
  const board = host.createScoreboard(`brainstorm-${startedAt}`);
  let disposed = false;
  let finished = false;
  const addEngine = (engineId: string) => {
    if (!board.entries().some(entry => entry.engineId === engineId)) {
      board.add(engineId);
      seats.set(engineId, { status: 'queued', done: false, failed: false });
    }
  };
  let signature = '';
  const progress = () => {
    if (disposed || finished || !seats.size) return;
    const elapsed = Math.floor((host.now() - startedAt) / 1000);
    const engines: BrainstormProgress[] = [...seats].map(([id, state]) => ({ id, ...state, elapsed }));
    const next = JSON.stringify(engines);
    if (next === signature) return;
    signature = next;
    host.dispatch({ type: 'progress-update', engines });
  };
  const stopTimer = host.scheduleEvery(progress, 250);
  return {
    setEngines(engines: readonly string[]) {
      if (disposed || finished) return;
      engines.forEach(addEngine);
      progress();
    },
    fail() {
      if (disposed || finished) return;
      finished = true;
      stopTimer();
      for (const entry of board.entries()) {
        if (entry.state !== 'failed') board.fail(entry.engineId, 'brainstorm aborted before a usable draft');
      }
      if (board.entries().length) host.dispatch({ type: 'info', message: board.render() });
    },
    onEvent(event: BrainstormWorkflowEvent) {
      if (disposed || finished) return;
      const data = event.data ?? {};
      if (event.type === 'brainstorm:seat-started' && typeof data.engineId === 'string') {
        addEngine(data.engineId);
        board.start(data.engineId);
        seats.set(data.engineId, { status: 'drafting…', done: false, failed: false });
      } else if (event.type === 'brainstorm:seat-completed' && typeof data.engineId === 'string') {
        addEngine(data.engineId);
        const ok = data.ok === true;
        const detail = String(data.detail ?? data.failure ?? 'no response');
        if (ok) board.finish(data.engineId, { result: 'response received' });
        else board.fail(data.engineId, detail);
        seats.set(data.engineId, { status: ok ? `${host.icons().success} response received` : `${host.icons().fail} ${detail}`, done: ok, failed: !ok });
        if (Number(data.attempts) > 1) host.dispatch({ type: 'info', message: `${data.engineId}: ${data.attempts} attempt(s)` });
      } else if (event.type === 'brainstorm:dedup-started') {
        host.dispatch({ type: 'info', message: 'Checking draft overlap…' });
      } else if (event.type === 'brainstorm:synthesis-started') {
        host.dispatch({ type: 'info', message: `Synthesizing with ${String(data.engineId)}…` });
      }
      progress();
    },
    complete(result: BrainstormResult) {
      if (disposed || finished) return;
      finished = true;
      stopTimer();
      for (const bid of result.bids) {
        addEngine(bid.engineId);
        board.finish(bid.engineId, { score: bid.score, result: 'bid submitted' });
      }
      for (const entry of board.entries()) {
        if (!result.bids.some(bid => bid.engineId === entry.engineId)) board.fail(entry.engineId, 'no response');
      }
      if (board.entries().length) host.dispatch({ type: 'info', message: board.render() });
      host.dispatch({ type: 'separator' });
      for (const bid of result.bids) {
        const winner = bid.engineId === result.winner;
        const metrics = [
          ...(bid.score != null ? [`score: ${bid.score}`] : []),
          ...(Number.isFinite(bid.confidence) ? [`confidence: ${bid.confidence}%`] : []),
        ];
        host.dispatch({ type: 'kern-draft', engineId: bid.engineId,
          content: bid.reasoning + (bid.approach ? '\n' + bid.approach : ''),
          critique: (winner ? `${host.icons().winner} best draft` : `${host.icons().success} done`)
            + (metrics.length ? ` (${metrics.join(', ')})` : '') });
      }
      if (result.panelHealth?.banner) host.dispatch({ type: 'info', message: `⚠ ${result.panelHealth.banner}` });
      if (result.dedup && !['applied', 'not-needed'].includes(result.dedup.status)) {
        host.dispatch({ type: 'info', message: `Dedup ${result.dedup.status}${result.dedup.detail ? ': ' + result.dedup.detail : ''}` });
      }
      if (result.synthesis?.status === 'fallback') host.dispatch({ type: 'warning', message: `Synthesis fallback: ${result.synthesis.detail ?? 'winner expansion failed'}` });
      host.dispatch({ type: 'engine-block', engineId: result.winner, color: host.engineColor(result.winner), content: result.response });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTimer();
      host.dispatch({ type: 'progress-clear' });
    },
  };
}
