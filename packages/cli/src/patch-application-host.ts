import { AsyncLocalStorage } from 'node:async_hooks';
import type { Awaitable, InvocationContext, PatchApplicationHostServices, PatchApplicationInteraction } from '@kernlang/agon-mod-api';
import type { Dispatch, HandlerContext } from './handlers/types.js';
import { assertProcessSurfaceAvailable } from './surface-authority-runtime.js';
import { escapeLiteralText } from './blocks/literal-text.js';

type PatchUi = Omit<PatchApplicationInteraction, 'assertActive' | 'confirm'> & {
  confirm(cwd: string, signal: AbortSignal): Awaitable<string>;
  acquire?(): () => void;
};
const scope = new AsyncLocalStorage<{ invocationId: string; ui: PatchUi; active: boolean }>();
// The CLI has one question slot per process. React can replace its dispatch
// callback on a mode/session change, so function identity is not its owner.
let approvalUiActive = false;

/** Host-owned interaction lifetime, with no patch workflow or Git effects. */
export async function withPatchApplication<T>(invocationId: string, ui: PatchUi, run: () => Promise<T>): Promise<T> {
  const session = { invocationId, ui, active: true };
  const release = ui.acquire?.();
  try { return await scope.run(session, run); }
  finally { session.active = false; release?.(); }
}

export const patchApplicationHost: PatchApplicationHostServices = Object.freeze({
  open(context: InvocationContext) {
    context.signal.throwIfAborted();
    const session = scope.getStore();
    if (!session?.active || session.invocationId !== context.invocationId) {
      return undefined;
    }
    const assertActive = () => {
      context.signal.throwIfAborted();
      if (!session.active || scope.getStore() !== session) throw new Error('Patch approval session expired.');
      assertProcessSurfaceAvailable('tui', '/apply');
    };
    assertActive();
    return Object.freeze<PatchApplicationInteraction>({
      artifacts: session.ui.artifacts,
      assertActive,
      notify(level, message) { assertActive(); session.ui.notify(level, message); },
      preview(patch) { assertActive(); session.ui.preview(patch); },
      confirm(cwd) {
        const confirmation = (async () => {
          assertActive();
          const answer = await session.ui.confirm(cwd, context.signal);
          assertActive();
          return answer;
        })();
        // Observe the public promise, not only the inner UI promise. Awaiting
        // callers still receive rejection; abandoned calls cannot crash teardown.
        void confirmation.catch(() => {});
        return confirmation;
      },
    });
  },
});

export function createPatchApplicationUi(dispatch: Dispatch, ctx: HandlerContext): PatchUi {
  let lifetime: AbortController | undefined;
  return {
    acquire() {
      if (approvalUiActive) throw new Error('Another Apply approval is active. Finish or cancel it before starting another.');
      approvalUiActive = true;
      lifetime = new AbortController();
      return () => {
        lifetime?.abort(new Error('Patch approval session expired.'));
        approvalUiActive = false;
      };
    },
    get artifacts() {
      return Object.freeze((ctx.currentPlan?.steps ?? []).map(step => Object.freeze(
        (step.result.artifacts ?? []).map(({ type, path }) => Object.freeze({ type, path })),
      )));
    },
    notify(level, message) { dispatch({ type: level, message: escapeLiteralText(message) }); },
    preview(patch) {
      dispatch({ type: 'text', content: '' });
      dispatch({ type: 'engine-block', engineId: patch.engineId, color: 245, format: 'diff', content: patch.content });
    },
    confirm(cwd, signal) {
      return askPatchApproval(dispatch, cwd, lifetime ? AbortSignal.any([signal, lifetime.signal]) : signal);
    },
  };
}

/** This question has an identity and a cancellation owner. A late answer
 * cannot revive a cancelled invocation or dismiss a newer question. */
function askPatchApproval(dispatch: Dispatch, cwd: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', cancel);
    const answer = (value: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try { dispatch({ type: 'question-cancel', resolve: answer }); }
      catch (error) { console.warn('[agon] failed to dismiss cancelled Apply question:', error); }
      reject(signal.reason ?? new DOMException('Apply cancelled', 'AbortError'));
    };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    try { dispatch({ type: 'question', prompt: `Apply to ${escapeLiteralText(cwd)}? [y/N]`, resolve: answer }); }
    catch (error) { settled = true; cleanup(); reject(error); }
  });
}
