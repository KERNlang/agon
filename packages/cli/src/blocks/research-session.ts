import { randomUUID } from 'node:crypto';
import { appendMessage, tracker } from '@kernlang/agon-core';
import { runResearchSession as runOwnedSession } from '@kernlang/agon-mod-research';
import type { ResearchSessionContext } from '@kernlang/agon-mod-research';
import type { CommandResult } from '@kernlang/agon-mod-api';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import { captureProcessSurfaceAuthority, assertProcessSurfaceAvailable } from '../surface-authority-runtime.js';
import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';
import { sessionResultStore } from '../models/session-results.js';
import { recordRun, formatRunSummary } from '../telemetry/index.js';

export async function runResearchSession(input: Record<string, unknown>, cb: DispatchCallbacks, context: ResearchSessionContext,
  execute: (input: Record<string, unknown>, context: ResearchSessionContext) => Promise<CommandResult>) {
  const session = cb.ctx.chatSession;
  const selected = captureProcessSurfaceAuthority();
  const assertCurrent = () => { selected(); assertProcessSurfaceAvailable('tui', '/research'); };
  context.signal.throwIfAborted();
  assertCurrent();
  const controller = new AbortController();
  const progressOwner = randomUUID();
  const signal = AbortSignal.any([context.signal, controller.signal]);
  cb.ctx.setActiveAbort(controller);
  try {
    await runOwnedSession(input, { ...context, signal }, {
      assertCurrent, now: Date.now,
      defaultEngines: () => filterDefaultOrchestrationEngines(cb.ctx.activeEngines()),
      resolveEngine: id => {
        const resolved = cb.ctx.registry.resolveId(id);
        const config = cb.ctx.config;
        return cb.ctx.registry.activeIds({ engineActivationMode: config.engineActivationMode ?? 'auto',
          forgeEnabledEngines: config.forgeEnabledEngines ?? [], hiddenEngines: config.hiddenEngines ?? [],
          removedEngines: config.removedEngines ?? [] }).includes(resolved) ? resolved : undefined;
      },
      dispatch: event => cb.dispatch(event.type === 'engine-block' ? { ...event, color: 39 }
        : event.type === 'progress-update' || event.type === 'progress-clear' ? { ...event, ownerId: progressOwner } : event),
      scheduleEvery: (callback, ms) => { const timer = setInterval(callback, ms); return () => clearInterval(timer); },
      appendMessage: message => appendMessage(session, message),
      track: (engine, exchange) => tracker.record(engine, exchange),
      addResult: result => sessionResultStore.add(result),
      recordRun: result => {
        const record = recordRun(result);
        assertCurrent();
        signal.throwIfAborted();
        if (!process.env.AGON_NO_SUMMARY) cb.dispatch({ type: 'info', message: formatRunSummary(record) });
      },
    }, execute);
  } finally {
    cb.ctx.setActiveAbort(null, controller);
    signal.throwIfAborted();
  }
}
