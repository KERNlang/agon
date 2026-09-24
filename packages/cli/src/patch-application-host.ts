import { AsyncLocalStorage } from 'node:async_hooks';
import type { PatchApplicationHostServices } from '@kernlang/agon-mod-api';

type Apply = PatchApplicationHostServices['apply'];
const scope = new AsyncLocalStorage<{ invocationId: string; apply: Apply; active: boolean }>();

/** Temporary host adapter for agon.forge; no UI callbacks cross the Mod API. */
export async function withPatchApplication<T>(invocationId: string, apply: Apply, run: () => Promise<T>): Promise<T> {
  const session = { invocationId, apply, active: true };
  try { return await scope.run(session, run); }
  finally { session.active = false; }
}

export const patchApplicationHost: PatchApplicationHostServices = Object.freeze({
  async apply(request: Parameters<Apply>[0], context: Parameters<Apply>[1]) {
    context.signal.throwIfAborted();
    const session = scope.getStore();
    if (!session?.active || session.invocationId !== context.invocationId) {
      return { exitCode: 2, stderr: 'No interactive patch approval session is available.\n' };
    }
    return session.apply(request, context);
  },
});
