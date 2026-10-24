import { appendMessage, tracker, resolveWorkingDir, scanProjectContext } from '@kernlang/agon-core';
import { createTribunalSessionRecord, runTribunalSession as runOwnedSession } from '@kernlang/agon-mod-tribunal';
import type { TribunalSessionContext, TribunalSessionCommandResult } from '@kernlang/agon-mod-tribunal';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';
import { sessionResultStore } from '../models/session-results.js';
import { buildCheckpoint, recordCheckpoint } from '../cesar/checkpoint.js';
import { createScoreboard, scoreboardFinishEngine, renderScoreboard } from '../cesar/scoreboard.js';
import { recordRun, formatRunSummary } from '../telemetry/index.js';

/** Bind host effects; Tribunal owns session decisions and settlement. */
export function runTribunalSession(
  input: Record<string, unknown>, cb: DispatchCallbacks, signal: AbortSignal,
  execute: (input: Record<string, unknown>, context: TribunalSessionContext) => Promise<TribunalSessionCommandResult>,
  cwd = resolveWorkingDir(),
): Promise<unknown> {
  return runOwnedSession(input, signal, {
    cwd: () => cwd,
    hasSession: () => Boolean(cb.ctx?.chatSession),
    defaultEngines: () => {
      const all = cb.ctx.activeEngines();
      const active = filterDefaultOrchestrationEngines(all);
      return { active, excluded: all.filter(id => !active.includes(id)) };
    },
    scanContext: path => scanProjectContext(path, cb.ctx.config.projectContext || undefined, cb.ctx.config.contextFormat),
    now: Date.now,
    dispatch: cb.dispatch,
    scheduleEvery: (callback, milliseconds) => {
      const timer = setInterval(callback, milliseconds);
      return () => clearInterval(timer);
    },
    checkpoint: (runId, phase, engines, metadata) => recordCheckpoint(buildCheckpoint(runId, phase, 'tribunal', engines, metadata)),
    createScoreboard: (runId, engines) => {
      const board = createScoreboard(runId, 'tribunal', engines);
      return { finish: (engineId, status) => { scoreboardFinishEngine(board, engineId, { result: status }); }, render: () => renderScoreboard(board) };
    },
    createRecord: options => createTribunalSessionRecord(options, {
      now: Date.now,
      appendMessage: message => appendMessage(cb.ctx.chatSession, message),
      addResult: saved => sessionResultStore.add(saved),
      recordRun, formatSummary: formatRunSummary,
      summaryEnabled: () => !process.env.AGON_NO_SUMMARY,
      notify: message => cb.dispatch({ type: 'info', message }),
      warn: message => cb.dispatch({ type: 'warning', message }),
      track: (engineId, exchange) => tracker.record(engineId, exchange),
    }),
  }, execute);
}
