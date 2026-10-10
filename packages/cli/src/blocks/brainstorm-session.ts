import { appendMessage, tracker, resolveWorkingDir, scanProjectContext } from '@kernlang/agon-core';
import { createBrainstormSessionRecord, runBrainstormSession as runOwnedSession } from '@kernlang/agon-mod-brainstorm';
import type { BrainstormSessionCommandResult, BrainstormSessionExecutionContext } from '@kernlang/agon-mod-brainstorm';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';
import { createBrainstormPresentation } from './brainstorm-presentation.js';
import { sessionResultStore } from '../models/session-results.js';
import { buildCheckpoint, recordCheckpoint } from '../cesar/checkpoint.js';
import { recordRun, formatRunSummary } from '../telemetry/index.js';

/** A06 session compatibility binding. The mod owns preparation and settlement;
 * the caller retains generation-selected execution and the host supplies effects. */
export async function runBrainstormSession(
  input: Record<string, unknown>,
  cb: DispatchCallbacks,
  signal: AbortSignal,
  execute: (input: Record<string, unknown>, context: BrainstormSessionExecutionContext) => Promise<BrainstormSessionCommandResult>,
): Promise<unknown> {
  return runOwnedSession(input, signal, {
    cwd: resolveWorkingDir,
    hasSession: () => Boolean(cb.ctx?.chatSession),
    defaultEngines: () => filterDefaultOrchestrationEngines(cb.ctx.activeEngines()),
    scanContext: cb.ctx?.config ? cwd => scanProjectContext(cwd, cb.ctx.config.projectContext || undefined, cb.ctx.config.contextFormat) : undefined,
    summaryEnabled: () => !process.env.AGON_NO_SUMMARY,
    notify: (type, message) => cb.dispatch({ type, message }),
    createPresentation: () => createBrainstormPresentation(cb.dispatch),
    createRecord: (question, engines, sessionSignal) => {
      const chatSession = cb.ctx.chatSession!;
      return createBrainstormSessionRecord({ question, engines, signal: sessionSignal }, {
        now: Date.now,
        checkpoint: (runId, phase, selected, metadata) => {
          recordCheckpoint(buildCheckpoint(runId, phase, 'brainstorm', selected, metadata));
        },
        appendMessage: message => appendMessage(chatSession, message),
        track: (engineId, exchange) => tracker.record(engineId, exchange),
        addResult: result => sessionResultStore.add(result),
        recordRun,
        formatSummary: formatRunSummary,
        warn: message => cb.dispatch({ type: 'warning', message }),
      });
    },
  }, execute);
}
