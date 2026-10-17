import { loadPlan, listPlans, savePlan, PlanStateError } from '@kernlang/agon-core';
import type { WorktreePlanHost } from '@kernlang/agon-mod-plan';
import type { Dispatch, HandlerContext } from '../handlers/types.js';
import { assertProcessSurfaceAvailable, captureProcessSurfaceAuthority } from '../surface-authority-runtime.js';

/** Bind terminal and persistence effects to the physical Plan workflow. */
export function worktreePlanHost(dispatch: Dispatch, ctx: HandlerContext): WorktreePlanHost {
  let assertCurrent: (() => void) | undefined;
  const host: WorktreePlanHost = {
    available: plan => {
      try {
        assertCurrent ??= captureProcessSurfaceAuthority();
        assertCurrent();
        assertProcessSurfaceAvailable('tui', '/plan');
        if (plan?.action.type === 'forge') assertProcessSurfaceAvailable('tui', '/forge');
        return true;
      } catch (error) {
        dispatch({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        return false;
      }
    },
    current: () => ctx.currentPlan,
    setCurrent: plan => ctx.setCurrentPlan(plan),
    load: loadPlan, list: listPlans, save: savePlan, emit: dispatch,
    ask: question => ctx.askQuestion(question),
    stateRuntime: { createStateError: (expected, actual) => new PlanStateError(expected, actual) },
    forge: async plan => {
      const { handleForge } = await import('../handlers/forge.js');
      if (!host.available(plan)) return;
      await handleForge(plan.action.task, plan.action.fitnessCmd ?? null, dispatch, ctx, plan, plan.action.hardened);
    },
  };
  return host;
}
