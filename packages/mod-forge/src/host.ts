import type { Awaitable, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
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
