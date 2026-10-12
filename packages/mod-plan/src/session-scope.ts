import { AsyncLocalStorage } from 'node:async_hooks';
import type { Awaitable, PlanSessionHostServices } from '@kernlang/agon-mod-api';
import { dispatchPlanSession } from './session.js';
import type { PlanSessionActions, PlanSessionDispatchResult } from './session.js';

type Run = PlanSessionHostServices['run'];
export interface PlanSessionBinding {
  readonly actions: PlanSessionActions;
  onDispatched?(request: Parameters<Run>[0], result: PlanSessionDispatchResult | null): Awaitable<void>;
}
const scope = new AsyncLocalStorage<{ invocationId: string; host: Run | PlanSessionBinding; active: boolean }>();

/** Bind host effects to one Plan invocation; inherited work expires on return. */
export async function withPlanSession<T>(invocationId: string, host: Run | PlanSessionBinding, invoke: () => Promise<T>): Promise<T> {
  const session = { invocationId, host, active: true };
  try { return await scope.run(session, invoke); }
  finally { session.active = false; }
}

export const planSessionHost: PlanSessionHostServices = Object.freeze({
  async run(request: Parameters<Run>[0], context: Parameters<Run>[1]) {
    context.signal.throwIfAborted();
    const session = scope.getStore();
    if (!session?.active || session.invocationId !== context.invocationId) {
      return { exitCode: 2, stderr: 'No interactive Plan session is available.\n' };
    }
    // Retain the published callback form for external callers.
    if (typeof session.host === 'function') return session.host(request, context);
    const result = await dispatchPlanSession(request, session.host.actions);
    await session.host.onDispatched?.(request, result);
    return result?.handled ? { exitCode: 0 } : { exitCode: 2, stderr: 'Unsupported Plan session action.\n' };
  },
});
