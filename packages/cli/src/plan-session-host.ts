import { AsyncLocalStorage } from 'node:async_hooks';
import type { PlanSessionHostServices } from '@kernlang/agon-mod-api';

type Run = PlanSessionHostServices['run'];
const scope = new AsyncLocalStorage<{ invocationId: string; run: Run; active: boolean }>();

/** A05 compatibility adapter: session/UI ownership remains in CLI until extracted. */
export async function withPlanSession<T>(invocationId: string, run: Run, invoke: () => Promise<T>): Promise<T> {
  const session = { invocationId, run, active: true };
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
    return session.run(request, context);
  },
});
