import { appendMessage, tracker } from '@kernlang/agon-core';
import type { ChatSession } from '@kernlang/agon-core';
import { createBrainstormSessionRecord as createOwnedSessionRecord } from '@kernlang/agon-mod-brainstorm';
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

/** A06-SESSION-EFFECTS (KL-011): CLI bindings only; the mod owns recording.
 * Remove when session effects are injected through the public host boundary.
 * Writes preserve legacy ordering, not an atomic persistence transaction.
 */
export function createBrainstormSessionRecord(options: {
  question: string;
  engines: readonly string[];
  chatSession: ChatSession;
  signal: AbortSignal;
}, effects = defaultEffects) {
  return createOwnedSessionRecord({ question: options.question, engines: options.engines, signal: options.signal }, {
    now: () => effects.now(),
    checkpoint: (runId, phase, engines, metadata) => effects.checkpoint(runId, phase, engines, metadata),
    appendMessage: message => effects.appendMessage(options.chatSession, message),
    track: (engineId, exchange) => effects.track(engineId, exchange),
    addResult: result => effects.addResult(result),
    recordRun: result => effects.recordRun(result),
    formatSummary: receipt => effects.formatSummary(receipt),
  });
}
