import { processSurfaceClient, captureProcessSurfaceAuthority } from '../surface-authority-runtime.js';
import { runPhysicalTuiContribution } from '../signals/dispatch/intent-session.js';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import type { Dispatch, HandlerContext } from './types.js';

/** Adapt legacy-shaped intents to the same generated session workflow. */
export async function handleSynthesis(prompt: string, dispatch: Dispatch, ctx: HandlerContext,
  opts?: { swaps?: number; judge?: string; signal?: AbortSignal }): Promise<void> {
  const controller = new AbortController();
  const signal = opts?.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
  signal.throwIfAborted();
  const assertCurrent = captureProcessSurfaceAuthority();
  const client = processSurfaceClient('tui');
  client.assertAvailable('/synthesis');
  const record = client.project().entries.find(entry => entry.owner.id === 'agon.synthesis'
    && entry.id === 'tuiSlashCommands:0063');
  if (!record) throw new Error('Synthesis session contribution is unavailable. Restart Agon.');
  try {
    assertCurrent();
    ctx.setActiveAbort(controller);
    await runPhysicalTuiContribution(record, { input: prompt,
      ...(opts?.swaps !== undefined ? { swaps: opts.swaps } : {}),
      ...(opts?.judge !== undefined ? { judge: opts.judge } : {}),
    }, 'synthesis', { dispatch, ctx } as DispatchCallbacks, signal);
  } finally {
    ctx.setActiveAbort(null);
  }
}
