import type { BrainstormResult } from '@kernlang/agon-core';
import type { BrainstormWorkflowEvent } from '@kernlang/agon-mod-brainstorm';
import type { Dispatch, EngineProgress } from '../handlers/types.js';
import { ENGINE_COLORS } from './output-format.js';
import { icons } from '../signals/icons.js';
import { createScoreboard, scoreboardStartEngine, scoreboardFinishEngine, scoreboardFailEngine, renderScoreboard } from '../cesar/scoreboard.js';

/** Invocation-local presentation only; execution stays in the physical mod. */
export function createBrainstormPresentation(dispatch: Dispatch) {
  const startedAt = Date.now();
  const seats = new Map<string, { status: string; done: boolean; failed: boolean }>();
  const board = createScoreboard(`brainstorm-${startedAt}`, 'brainstorm', []);
  let disposed = false;
  let finished = false;
  const addEngine = (engineId: string) => {
    if (!board.entries.some(entry => entry.engineId === engineId)) {
      board.entries.push({ engineId, state: 'waiting', progress: 0 });
      seats.set(engineId, { status: 'queued', done: false, failed: false });
    }
  };
  let signature = '';
  const progress = () => {
    if (disposed || finished || !seats.size) return;
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const engines: EngineProgress[] = [...seats].map(([id, state]) => ({ id, ...state, elapsed }));
    const next = JSON.stringify(engines);
    if (next === signature) return;
    signature = next;
    dispatch({ type: 'progress-update', engines });
  };
  const timer = setInterval(progress, 250);
  return {
    setEngines(engines: readonly string[]) {
      if (disposed || finished) return;
      engines.forEach(addEngine);
      progress();
    },
    fail() {
      if (disposed || finished) return;
      finished = true;
      clearInterval(timer);
      for (const entry of board.entries) {
        if (entry.state !== 'failed') scoreboardFailEngine(board, entry.engineId, 'brainstorm aborted before a usable draft');
      }
      if (board.entries.length) dispatch({ type: 'info', message: renderScoreboard(board) });
    },
    onEvent(event: BrainstormWorkflowEvent) {
      if (disposed || finished) return;
      const data = event.data ?? {};
      if (event.type === 'brainstorm:seat-started' && typeof data.engineId === 'string') {
        addEngine(data.engineId);
        scoreboardStartEngine(board, data.engineId);
        seats.set(data.engineId, { status: 'drafting…', done: false, failed: false });
      } else if (event.type === 'brainstorm:seat-completed' && typeof data.engineId === 'string') {
        addEngine(data.engineId);
        const ok = data.ok === true;
        const detail = String(data.detail ?? data.failure ?? 'no response');
        if (ok) scoreboardFinishEngine(board, data.engineId, { result: 'response received' });
        else scoreboardFailEngine(board, data.engineId, detail);
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
      if (disposed || finished) return;
      finished = true;
      clearInterval(timer);
      for (const bid of result.bids) {
        addEngine(bid.engineId);
        scoreboardFinishEngine(board, bid.engineId, { score: bid.score, result: 'bid submitted' });
      }
      for (const entry of board.entries) {
        if (!result.bids.some(bid => bid.engineId === entry.engineId)) scoreboardFailEngine(board, entry.engineId, 'no response');
      }
      if (board.entries.length) dispatch({ type: 'info', message: renderScoreboard(board) });
      dispatch({ type: 'separator' });
      for (const bid of result.bids) {
        const winner = bid.engineId === result.winner;
        const metrics = [
          ...(bid.score != null ? [`score: ${bid.score}`] : []),
          ...(Number.isFinite(bid.confidence) ? [`confidence: ${bid.confidence}%`] : []),
        ];
        dispatch({ type: 'kern-draft', engineId: bid.engineId,
          content: bid.reasoning + (bid.approach ? '\n' + bid.approach : ''),
          critique: (winner ? `${icons().winner} best draft` : `${icons().success} done`)
            + (metrics.length ? ` (${metrics.join(', ')})` : '') });
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
