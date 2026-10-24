import { appendMessage, tracker } from '@kernlang/agon-core';
import { runCouncilSession as runOwnedSession } from '@kernlang/agon-mod-council';
import type { CouncilSessionContext, CouncilSessionCommandResult } from '@kernlang/agon-mod-council';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import { captureProcessSurfaceAuthority, assertProcessSurfaceAvailable } from '../surface-authority-runtime.js';
import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';
import { sessionResultStore } from '../models/session-results.js';
import { recordRun, formatRunSummary } from '../telemetry/index.js';
import { ENGINE_COLORS } from './output-format.js';

/** Bind Council effects to the selected generation and original chat. */
export function runCouncilSession(
  input: Record<string, unknown>, cb: DispatchCallbacks, context: CouncilSessionContext,
  execute: (input: Record<string, unknown>, context: CouncilSessionContext) => Promise<CouncilSessionCommandResult>,
) {
  const session = cb.ctx.chatSession;
  const selected = captureProcessSurfaceAuthority();
  const assertCurrent = () => { selected(); assertProcessSurfaceAvailable('tui', '/council'); };
  return runOwnedSession(input, context, {
    assertCurrent, now: Date.now,
    defaultEngines: () => filterDefaultOrchestrationEngines(cb.ctx.activeEngines()),
    resolveChairman: id => {
      const resolved = cb.ctx.registry.resolveId(id);
      const config = cb.ctx.config;
      return cb.ctx.registry.activeIds({ engineActivationMode: config.engineActivationMode ?? 'auto',
        forgeEnabledEngines: config.forgeEnabledEngines ?? [], hiddenEngines: config.hiddenEngines ?? [],
        removedEngines: config.removedEngines ?? [] }).includes(resolved) ? resolved : undefined;
    },
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
