import { appendMessage, tracker } from '@kernlang/agon-core';
import { runThinkSession as runOwnedSession } from '@kernlang/agon-mod-think';
import type { ThinkSessionContext, ThinkSessionCommandResult } from '@kernlang/agon-mod-think';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import { captureProcessSurfaceAuthority, assertProcessSurfaceAvailable } from '../surface-authority-runtime.js';
import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';
import { sessionResultStore } from '../models/session-results.js';
import { recordRun, formatRunSummary } from '../telemetry/index.js';
import { ENGINE_COLORS } from './output-format.js';

/** Bind session effects to the selected Think generation and original chat. */
export function runThinkSession(
  input: Record<string, unknown>, cb: DispatchCallbacks, context: ThinkSessionContext,
  execute: (input: Record<string, unknown>, context: ThinkSessionContext) => Promise<ThinkSessionCommandResult>,
) {
  const session = cb.ctx.chatSession;
  const selected = captureProcessSurfaceAuthority();
  const assertCurrent = () => { selected(); assertProcessSurfaceAvailable('tui', '/think'); };
  return runOwnedSession(input, context, {
    assertCurrent, now: Date.now,
    defaultEngine: () => filterDefaultOrchestrationEngines(cb.ctx.activeEngines())[0],
    dispatch: event => cb.dispatch(event.type === 'engine-block' ? { ...event, color: event.color ?? ENGINE_COLORS[event.engineId] ?? 124 } : event),
    scheduleEvery: (callback, milliseconds) => { const timer = setInterval(callback, milliseconds); return () => clearInterval(timer); },
    appendMessage: message => appendMessage(session, message),
    track: (engineId, exchange) => tracker.record(engineId, exchange),
    addResult: result => sessionResultStore.add(result),
    recordRun: result => {
      const record = recordRun(result);
      assertCurrent();
      context.signal.throwIfAborted();
      try { if (!process.env.AGON_NO_SUMMARY) cb.dispatch({ type: 'info', message: formatRunSummary(record) }); }
      catch { /* Optional display must not reverse a saved record. */ }
    },
  }, execute);
}
