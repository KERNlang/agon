import { ensureAgonHome, scanProjectContext, appendMessage, resolveWorkingDir, loadConfig } from '@kernlang/agon-core';
import { runTeamBrainstormSession } from '@kernlang/agon-mod-team-brainstorm';
import type { CommandResult } from '@kernlang/agon-mod-api';
import type { Dispatch, HandlerContext } from './types.js';
import { filterDefaultOrchestrationEngines } from './engine-filter.js';
import { executeProcessCesarRoute } from '../surface-authority-runtime.js';

/** Bind terminal/session effects; the mod owns the workflow and presentation. */
export async function handleTeamBrainstorm(
  question: string, dispatch: Dispatch, ctx: HandlerContext, membersPerSide?: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    return await runTeamBrainstormSession(question, membersPerSide, controller, {
      ensureHome: ensureAgonHome,
      engines: () => {
        const all = ctx.activeEngines();
        const active = filterDefaultOrchestrationEngines(all);
        return { active, excluded: all.filter(id => !active.includes(id)) };
      },
      project: () => {
        const cwd = resolveWorkingDir();
        const config = loadConfig(cwd);
        return { cwd, judge: config.cesarEngine,
          context: scanProjectContext(cwd, config.projectContext || undefined, config.contextFormat) };
      },
      dispatch: event => dispatch(event as Parameters<Dispatch>[0]),
      setActiveAbort: controller => ctx.setActiveAbort(controller),
      appendMessage: message => appendMessage(ctx.chatSession, message),
    }, async (input, context) => await executeProcessCesarRoute('team-brainstorm', input, context) as CommandResult);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
