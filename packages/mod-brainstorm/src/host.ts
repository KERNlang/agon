import type { Awaitable, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import type { BrainstormRuntimeServices } from './runtime.js';
import type { BrainstormWorkflowOptions } from './workflow.js';

/** Bundled host integration only; no workflow implementation is supplied here. */
export interface BrainstormHostServices {
  open(context: InvocationContext): Awaitable<BrainstormRuntimeServices<BrainstormWorkflowOptions>>;
}

export interface BrainstormModServices extends ModServices {
  readonly brainstorm?: BrainstormHostServices;
}
