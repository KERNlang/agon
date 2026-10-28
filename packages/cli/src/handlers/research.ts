import { processSurfaceClient } from '../surface-authority-runtime.js';
import { runPhysicalTuiContribution } from '../signals/dispatch/intent-session.js';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import type { Dispatch, HandlerContext } from './types.js';

/** Preserve the public handler while the selected mod owns execution and effects. */
export async function handleResearch(question: string, dispatch: Dispatch, ctx: HandlerContext,
  opts?: { engine?: string; count?: number; signal?: AbortSignal }): Promise<void> {
  const controller = new AbortController();
  const signal = opts?.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
  signal.throwIfAborted();
  const record = processSurfaceClient('tui').assertAvailable('/research');
  ctx.setActiveAbort(controller);
  try {
    await runPhysicalTuiContribution(record, { question,
      ...(opts?.engine ? { engine: opts.engine } : {}),
      ...(opts?.count !== undefined ? { count: String(opts.count) } : {}) },
    'research', { ctx, dispatch } as DispatchCallbacks, signal);
  } finally { ctx.setActiveAbort(null); }
}
