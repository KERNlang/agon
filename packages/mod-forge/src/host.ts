import type { Awaitable, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import { guardEngineAdapter } from '@kernlang/agon-support-engine-runtime';
import type { ForgeEvent } from './types.js';
import type { ForgeWorkflowEffects, ForgeWorkflowRegistry } from './workflow.js';

export interface ForgeInvocationContext extends InvocationContext {
  readonly onWorkflowEvent?: (event: ForgeEvent) => void;
}

/** The host supplies effects and engine transport, never a workflow callback. */
export interface ForgeHostServices {
  open(context: InvocationContext): Awaitable<{
    registry: ForgeWorkflowRegistry;
    adapter: EngineAdapter;
    effects: ForgeWorkflowEffects<ForgeWorkflowRegistry>;
  }>;
}

export interface ForgeModServices extends ModServices {
  readonly forge?: ForgeHostServices;
}

/** Bind each invocation to its registry and captured execution authority. */
export function createForgeHostServices<Registry extends ForgeWorkflowRegistry>(options: {
  openRegistry(cwd: string): Registry;
  createAdapter(registry: Registry): EngineAdapter;
  createEffects(): ForgeWorkflowEffects<Registry>;
  captureAuthority?(): () => void;
}): ForgeHostServices {
  const { captureAuthority = () => () => {} } = options;
  return {
    open(context) {
      context.signal.throwIfAborted();
      const assertCurrent = captureAuthority();
      assertCurrent();
      const registry = options.openRegistry(context.cwd);
      const adapter = guardEngineAdapter(options.createAdapter(registry), signal => {
        context.signal.throwIfAborted();
        signal?.throwIfAborted();
        assertCurrent();
      });
      const effects = options.createEffects();
      return {
        registry, adapter,
        effects: { ...effects, seedNewEnginesFromRegistry: () => { effects.seedNewEnginesFromRegistry(registry); } },
      };
    },
  };
}
