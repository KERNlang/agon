import { randomUUID } from 'node:crypto';
import type { BrainstormDedupStatus } from '@kernlang/agon-support-dedup';
import type { BrainstormBid } from './workflow.js';

/** Only the result fields consumed by session recording cross this boundary. */
export interface BrainstormSessionResult {
  winner: string;
  response: string;
  bids: readonly Pick<BrainstormBid, 'engineId' | 'reasoning' | 'approach' | 'score'>[];
  dedup?: BrainstormDedupStatus;
  synthesis?: { status: 'completed' | 'fallback'; detail?: string };
}

export interface BrainstormSessionEffects<Receipt> {
  now(): number;
  checkpoint(runId: string, phase: 'pre-dispatch' | 'post-dispatch', engines: string[], metadata: Record<string, unknown>): void;
  appendMessage(message: { role: 'user' | 'engine'; content: string; timestamp: string; engineId?: string }): void;
  track(engineId: string, exchange: { prompt: string; response: string }): void;
  addResult(result: {
    type: 'brainstorm'; timestamp: string; question: string; engines: string[]; winner: string;
    data: Omit<BrainstormSessionResult, 'winner' | 'bids'> & { bids: BrainstormSessionResult['bids'][number][] };
  }): void;
  recordRun(result: {
    mode: 'brainstorm'; intent: string; winner?: string; success: boolean;
    durationMs: number; engineIds: string[]; completionState: 'completed' | 'aborted' | 'crashed';
  }): Receipt;
  formatSummary(receipt: Receipt): string | undefined;
}

/** Owns recording order and settlement. Host effects bind storage and UI state.
 * These ordered writes preserve existing behavior; they are not a transaction. */
export function createBrainstormSessionRecord<Receipt>(options: {
  question: string;
  engines: readonly string[];
  signal: AbortSignal;
}, effects: BrainstormSessionEffects<Receipt>) {
  const { question, signal } = options;
  const engines = [...options.engines];
  const runId = `brainstorm-${randomUUID()}`;
  const startedAt = effects.now();
  let settled = false;
  effects.checkpoint(runId, 'pre-dispatch', engines, { question });
  const timestamp = () => new Date(effects.now()).toISOString();
  function fail(): void {
    if (settled) return;
    effects.recordRun({ mode: 'brainstorm', intent: question, success: false,
      durationMs: effects.now() - startedAt, engineIds: engines,
      completionState: signal.aborted ? 'aborted' : 'crashed' });
    settled = true;
  }
  return {
    complete(result: BrainstormSessionResult): string | undefined {
      if (settled) return;
      if (signal.aborted) { fail(); signal.throwIfAborted(); }
      effects.checkpoint(runId, 'post-dispatch', engines, { winner: result.winner, question });
      effects.appendMessage({ role: 'user', content: `[brainstorm] ${question}`, timestamp: timestamp() });
      effects.appendMessage({ role: 'engine', engineId: result.winner, content: result.response, timestamp: timestamp() });
      for (const bid of result.bids) effects.track(bid.engineId, { prompt: question, response: bid.reasoning });
      effects.track(result.winner, { prompt: question, response: result.response });
      effects.addResult({ type: 'brainstorm', timestamp: timestamp(), question, engines, winner: result.winner,
        data: { bids: result.bids.map(({ engineId, reasoning, approach, score }) => ({ engineId, reasoning, approach, score })),
          response: result.response, dedup: result.dedup, synthesis: result.synthesis } });
      const record = effects.recordRun({ mode: 'brainstorm', intent: question, winner: result.winner,
        success: true, durationMs: effects.now() - startedAt, engineIds: engines, completionState: 'completed' });
      settled = true;
      return effects.formatSummary(record);
    },
    fail,
  };
}
