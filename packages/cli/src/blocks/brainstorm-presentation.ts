import type { BrainstormResult } from '@kernlang/agon-core';
import type { BrainstormWorkflowEvent } from '@kernlang/agon-mod-brainstorm';
import type { Dispatch, EngineProgress } from '../handlers/types.js';
import { ENGINE_COLORS } from './output-format.js';
import { icons } from '../signals/icons.js';

/** Invocation-local presentation only; execution stays in the physical mod. */
export function createBrainstormPresentation(dispatch: Dispatch) {
  const startedAt = Date.now();
  const seats = new Map<string, { status: string; done: boolean; failed: boolean }>();
  let disposed = false;
  let signature = '';
  const progress = () => {
    if (disposed || !seats.size) return;
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const engines: EngineProgress[] = [...seats].map(([id, state]) => ({ id, ...state, elapsed }));
    const next = JSON.stringify(engines);
    if (next === signature) return;
    signature = next;
    dispatch({ type: 'progress-update', engines });
  };
  const timer = setInterval(progress, 250);
  return {
    onEvent(event: BrainstormWorkflowEvent) {
      if (disposed) return;
      const data = event.data ?? {};
      if (event.type === 'brainstorm:seat-started' && typeof data.engineId === 'string') {
        seats.set(data.engineId, { status: 'drafting…', done: false, failed: false });
      } else if (event.type === 'brainstorm:seat-completed' && typeof data.engineId === 'string') {
        const ok = data.ok === true;
        const detail = String(data.detail ?? data.failure ?? 'no response');
        seats.set(data.engineId, { status: ok ? `${icons().success} response received` : `${icons().fail} ${detail}`, done: ok, failed: !ok });
        if (Number(data.attempts) > 1) dispatch({ type: 'info', message: `${data.engineId}: ${data.attempts} attempt(s)` });
      } else if (event.type === 'brainstorm:dedup-started') {
        dispatch({ type: 'info', message: 'Checking draft overlap…' });
      } else if (event.type === 'brainstorm:synthesis-started') {
        dispatch({ type: 'info', message: `Synthesizing with ${String(data.engineId)}…` });
      }
      progress();
    },
    complete(result: BrainstormResult) {
      if (disposed) return;
      dispatch({ type: 'separator' });
      for (const bid of result.bids) {
        const winner = bid.engineId === result.winner;
        const score = bid.score != null ? ` (score: ${bid.score})` : '';
        dispatch({ type: 'kern-draft', engineId: bid.engineId,
          content: bid.reasoning + (bid.approach ? '\n' + bid.approach : ''),
          critique: (winner ? `${icons().winner} best draft` : `${icons().success} done`) + score });
      }
      if (result.panelHealth?.banner) dispatch({ type: 'info', message: `⚠ ${result.panelHealth.banner}` });
      if (result.dedup && !['applied', 'not-needed'].includes(result.dedup.status)) {
        dispatch({ type: 'info', message: `Dedup ${result.dedup.status}${result.dedup.detail ? ': ' + result.dedup.detail : ''}` });
      }
      if (result.synthesis?.status === 'fallback') dispatch({ type: 'warning', message: `Synthesis fallback: ${result.synthesis.detail ?? 'winner expansion failed'}` });
      dispatch({ type: 'engine-block', engineId: result.winner, color: ENGINE_COLORS[result.winner] ?? 124, content: result.response });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      dispatch({ type: 'progress-clear' });
    },
  };
}
