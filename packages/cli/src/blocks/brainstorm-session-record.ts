import { randomUUID } from 'node:crypto';
import { appendMessage, tracker } from '@kernlang/agon-core';
import type { BrainstormResult, ChatSession } from '@kernlang/agon-core';
import { sessionResultStore } from '../models/session-results.js';
import { buildCheckpoint, recordCheckpoint } from '../cesar/checkpoint.js';
import { recordRun, formatRunSummary } from '../telemetry/index.js';

const defaultEffects = {
  now: Date.now,
  checkpoint(runId: string, phase: 'pre-dispatch' | 'post-dispatch', engines: string[], metadata: Record<string, unknown>) {
    recordCheckpoint(buildCheckpoint(runId, phase, 'brainstorm', engines, metadata));
  },
  appendMessage,
  track: tracker.record.bind(tracker),
  addResult: sessionResultStore.add.bind(sessionResultStore),
  recordRun,
  formatSummary: formatRunSummary,
};

/** A06-SESSION-EFFECTS (KL-011): CLI effects only; the mod owns execution.
 * Remove when session effects are injected through the public host boundary.
 * Writes preserve legacy ordering, not an atomic persistence transaction.
 */
export function createBrainstormSessionRecord(options: {
  question: string;
  engines: readonly string[];
  chatSession: ChatSession;
  signal: AbortSignal;
}, effects = defaultEffects) {
  const { question, chatSession, signal } = options;
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
    complete(result: BrainstormResult): string | undefined {
      if (settled) return;
      if (signal.aborted) { fail(); signal.throwIfAborted(); }
      effects.checkpoint(runId, 'post-dispatch', engines, { winner: result.winner, question });
      effects.appendMessage(chatSession, { role: 'user', content: `[brainstorm] ${question}`, timestamp: timestamp() });
      effects.appendMessage(chatSession, { role: 'engine', engineId: result.winner, content: result.response, timestamp: timestamp() });
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
