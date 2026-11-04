import { appendMessage, tracker, resolveWorkingDir, scanProjectContext } from '@kernlang/agon-core';
import { runCampfireSession as runOwnedSession } from '@kernlang/agon-mod-campfire';
import type { CampfireSessionContext, CampfireSessionCommandResult } from '@kernlang/agon-mod-campfire';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';
import { sessionResultStore } from '../models/session-results.js';
import { recordRun, formatRunSummary } from '../telemetry/index.js';
import { ENGINE_COLORS } from './output-format.js';

/** Bind host effects; Campfire owns session preparation and settlement. */
export function runCampfireSession(
  input: Record<string, unknown>, cb: DispatchCallbacks, signal: AbortSignal,
  execute: (input: Record<string, unknown>, context: CampfireSessionContext) => Promise<CampfireSessionCommandResult>,
  cwd = resolveWorkingDir(),
): Promise<unknown> {
  const session = cb.ctx?.chatSession;
  return runOwnedSession(input, signal, {
    cwd: () => cwd, hasSession: () => Boolean(session), now: Date.now,
    defaultEngines: () => {
      const all = cb.ctx.activeEngines();
      const active = filterDefaultOrchestrationEngines(all);
      return { active, excluded: all.filter(id => !active.includes(id)) };
    },
    scanContext: path => scanProjectContext(path, cb.ctx.config.projectContext || undefined, cb.ctx.config.contextFormat),
    dispatch: event => cb.dispatch(event.type === 'engine-block' ? { ...event, color: ENGINE_COLORS[event.engineId] ?? 124 } : event),
    scheduleEvery: (callback, milliseconds) => {
      const timer = setInterval(callback, milliseconds);
      return () => clearInterval(timer);
    },
    appendMessage: message => { if (session) appendMessage(session, message); },
    track: (engineId, exchange) => tracker.record(engineId, exchange),
    addResult: result => sessionResultStore.add(result),
    recordRun: result => {
      const record = recordRun(result);
      try { if (!process.env.AGON_NO_SUMMARY) cb.dispatch({ type: 'info', message: formatRunSummary(record) }); }
      catch { /* Optional display must not reverse a saved receipt. */ }
    },
  }, execute);
}
