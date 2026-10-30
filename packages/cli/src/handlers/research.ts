import { ResearchGroundingError, ResearchInputError } from '@kernlang/agon-mod-research';
import { captureProcessSurfaceAuthority, processSurfaceClient } from '../surface-authority-runtime.js';
import { runPhysicalTuiContribution } from '../signals/dispatch/intent-session.js';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import type { Dispatch, HandlerContext } from './types.js';

/** Preserve the public handler while the selected mod owns execution and effects. */
export async function handleResearch(question: string, dispatch: Dispatch, ctx: HandlerContext,
  opts?: { engine?: string; count?: number; signal?: AbortSignal }): Promise<void> {
  const signal = opts?.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  const assertSelected = captureProcessSurfaceAuthority();
  const record = processSurfaceClient('tui').assertAvailable('/research');
  try {
    await runPhysicalTuiContribution(record, { question,
      ...(opts?.engine ? { engine: opts.engine } : {}),
      ...(opts?.count !== undefined ? { count: String(opts.count) } : {}) },
    'research', { ctx, dispatch } as DispatchCallbacks, signal);
  } catch (error) {
    if (!(error instanceof ResearchGroundingError) && !(error instanceof ResearchInputError)) throw error;
    signal.throwIfAborted();
    assertSelected();
    dispatch(error instanceof ResearchInputError
      ? { type: error.severity, message: error.message }
      : { type: 'error', message: `No grounded answer: ${error.message}` });
  }
}
