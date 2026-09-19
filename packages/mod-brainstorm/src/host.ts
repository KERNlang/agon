import type { Awaitable, InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import type { BrainstormRuntimeServices } from './runtime.js';
import type { BrainstormWorkflowOptions } from './workflow.js';

export type BrainstormWorkflowEvent = Parameters<NonNullable<BrainstormWorkflowOptions['onEvent']>>[0];
export interface BrainstormInvocationContext extends InvocationContext {
  readonly onWorkflowEvent?: (event: BrainstormWorkflowEvent) => void;
}

/** Bundled host integration only; no workflow implementation is supplied here. */
export interface BrainstormHostServices {
  open(context: InvocationContext): Awaitable<BrainstormRuntimeServices<BrainstormWorkflowOptions>>;
  /** Optional terminal sink. Used only by the CLI contribution, never MCP/TUI. */
  writeCliOutput?(text: string): void;
}

export interface BrainstormModServices extends ModServices {
  readonly brainstorm?: BrainstormHostServices;
}
