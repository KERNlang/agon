import { appendMessage, tracker } from '@kernlang/agon-core';
import { runSynthesisSession as runOwnedSession } from '@kernlang/agon-mod-synthesis';
import type { SynthesisSessionContext, SynthesisSessionCommandResult } from '@kernlang/agon-mod-synthesis';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import { captureProcessSurfaceAuthority, assertProcessSurfaceAvailable } from '../surface-authority-runtime.js';
import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';
import { sessionResultStore } from '../models/session-results.js';
import { recordRun, formatRunSummary } from '../telemetry/index.js';
import { ENGINE_COLORS } from './output-format.js';

/** Bind Synthesis effects to the original chat and selected generation. */
export function runSynthesisSession(
  input: Record<string, unknown>, cb: DispatchCallbacks, context: SynthesisSessionContext,
  execute: (input: Record<string, unknown>, context: SynthesisSessionContext) => Promise<SynthesisSessionCommandResult>,
) {
  const session = cb.ctx.chatSession;
  const selected = captureProcessSurfaceAuthority();
  const assertCurrent = () => { selected(); assertProcessSurfaceAvailable('tui', '/synthesis'); };
  return runOwnedSession(input, context, {
    assertCurrent, now: Date.now,
    defaultEngines: () => filterDefaultOrchestrationEngines(cb.ctx.activeEngines()),
    dispatch: event => cb.dispatch(event.type === 'engine-block' ? { ...event, color: ENGINE_COLORS[event.engineId] ?? 124 } : event),
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
