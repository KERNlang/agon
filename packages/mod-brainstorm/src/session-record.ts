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
    id: string;
    mode: 'brainstorm'; intent: string; winner?: string; success: boolean;
    durationMs: number; engineIds: string[]; completionState: 'completed' | 'aborted' | 'crashed';
  }): Receipt;
  formatSummary(receipt: Receipt): string | undefined;
  /** Report optional summary failures without changing the saved receipt. */
  warn?(message: string): void;
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
  let recordingStarted = false;
  effects.checkpoint(runId, 'pre-dispatch', engines, { question });
  const timestamp = () => new Date(effects.now()).toISOString();
  function fail(): void {
    if (settled) return;
    effects.recordRun({ id: runId, mode: 'brainstorm', intent: question, success: false,
      durationMs: effects.now() - startedAt, engineIds: engines,
      completionState: signal.aborted ? 'aborted' : 'crashed' });
    settled = true;
  }
  function checkCancellation(): void {
    if (!signal.aborted) return;
    fail();
    signal.throwIfAborted();
  }
  return {
    complete(result: BrainstormSessionResult): string | undefined {
      if (settled) return;
      if (recordingStarted) throw new Error('Brainstorm recording already started. Do not repeat partial history writes.');
      recordingStarted = true;
      checkCancellation();
      effects.checkpoint(runId, 'post-dispatch', engines, { winner: result.winner, question });
      checkCancellation();
      effects.appendMessage({ role: 'user', content: `[brainstorm] ${question}`, timestamp: timestamp() });
      checkCancellation();
      effects.appendMessage({ role: 'engine', engineId: result.winner, content: result.response, timestamp: timestamp() });
      checkCancellation();
      for (const bid of result.bids) {
        effects.track(bid.engineId, { prompt: question, response: bid.reasoning });
        checkCancellation();
      }
      effects.track(result.winner, { prompt: question, response: result.response });
      checkCancellation();
      effects.addResult({ type: 'brainstorm', timestamp: timestamp(), question, engines, winner: result.winner,
        data: { bids: result.bids.map(({ engineId, reasoning, approach, score }) => ({ engineId, reasoning, approach, score })),
          response: result.response, dedup: result.dedup, synthesis: result.synthesis } });
      checkCancellation();
      const record = effects.recordRun({ id: runId, mode: 'brainstorm', intent: question, winner: result.winner,
        success: true, durationMs: effects.now() - startedAt, engineIds: engines, completionState: 'completed' });
      settled = true;
      try { return effects.formatSummary(record); }
      catch {
        try { effects.warn?.('Brainstorm receipt saved, but its summary could not be formatted.'); }
        catch { /* A diagnostic failure must not change the saved outcome. */ }
        return undefined;
      }
    },
    fail,
  };
}
