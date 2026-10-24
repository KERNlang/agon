import { appendMessage, resolveWorkingDir } from '@kernlang/agon-core';
import { runConquerSession as runOwnedSession } from '@kernlang/agon-mod-conquer';
import type { ConquerSessionContext, ConquerSessionCommandResult } from '@kernlang/agon-mod-conquer';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import { recordRun, formatRunSummary } from '../telemetry/index.js';

/** Bind host effects; Conquer owns session presentation and settlement. */
export function runConquerSession(
  input: Record<string, unknown>, cb: DispatchCallbacks, signal: AbortSignal,
  execute: (input: Record<string, unknown>, context: ConquerSessionContext) => Promise<ConquerSessionCommandResult>,
  cwd = resolveWorkingDir(),
): Promise<unknown> {
  return runOwnedSession(input, signal, {
    cwd: () => cwd, now: Date.now, dispatch: cb.dispatch,
    appendMessage: message => { if (cb.ctx.chatSession) appendMessage(cb.ctx.chatSession, message); },
    recordRun: result => {
      const record = recordRun(result);
      try { if (!process.env.AGON_NO_SUMMARY) cb.dispatch({ type: 'info', message: formatRunSummary(record) }); }
      catch { /* Optional display must not reverse a saved receipt. */ }
    },
  }, execute);
}
