import { resolveWorkingDir, scanProjectContext } from '@kernlang/agon-core';
import type { BrainstormResult } from '@kernlang/agon-core';
import type { BrainstormWorkflowEvent } from '@kernlang/agon-mod-brainstorm';
import type { DispatchCallbacks } from '../signals/dispatch.js';
import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';
import { createBrainstormPresentation } from './brainstorm-presentation.js';
import { createBrainstormSessionRecord } from './brainstorm-session-record.js';

interface SessionCommandResult {
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly result?: unknown;
  readonly failure?: { readonly message?: string };
}

/** Session/UI effects only. The caller retains its selected surface authority. */
export async function runBrainstormSession(
  input: Record<string, unknown>,
  cb: DispatchCallbacks,
  signal: AbortSignal,
  execute: (input: Record<string, unknown>, context: {
    cwd: string; signal: AbortSignal; onWorkflowEvent: (event: BrainstormWorkflowEvent) => void;
  }) => Promise<SessionCommandResult>,
): Promise<unknown> {
  const presentation = createBrainstormPresentation(cb.dispatch);
  let sessionRecord: ReturnType<typeof createBrainstormSessionRecord> | undefined;
  try {
    signal.throwIfAborted();
    const cwd = resolveWorkingDir();
    if (input.context !== undefined && typeof input.context !== 'string') throw new Error('Brainstorm context must be a string.');
    if (cb.ctx?.chatSession) {
      const engines = input.engines === undefined
        ? filterDefaultOrchestrationEngines(cb.ctx.activeEngines())
        : typeof input.engines === 'string' ? input.engines.split(',').map(id => id.trim()).filter(Boolean) : input.engines;
      if (typeof input.question !== 'string' || !input.question.trim()) throw new Error('Brainstorm requires a question.');
      if (!Array.isArray(engines) || !engines.length || !engines.every(id => typeof id === 'string' && id.trim())) {
        throw new Error('Brainstorm requires at least one engine.');
      }
      input = { ...input, engines };
      if (input.context === undefined && cb.ctx.config) {
        const context = scanProjectContext(cwd, cb.ctx.config.projectContext || undefined, cb.ctx.config.contextFormat);
        input = { ...input, context };
        if (context) cb.dispatch({ type: 'info', message: `Context: ${cwd}` });
      }
      sessionRecord = createBrainstormSessionRecord({ question: input.question as string, engines, chatSession: cb.ctx.chatSession, signal });
      presentation.setEngines(engines);
    }
    const output = await execute(input, { cwd, signal, onWorkflowEvent: presentation.onEvent });
    if ((output.exitCode ?? 0) !== 0) throw new Error(output.stderr?.trim() || output.failure?.message || 'brainstorm failed');
    const result = output.result ?? output;
    signal.throwIfAborted();
    presentation.complete(result as BrainstormResult);
    const summary = sessionRecord?.complete(result as BrainstormResult);
    if (summary && !process.env.AGON_NO_SUMMARY) cb.dispatch({ type: 'info', message: summary });
    return result;
  } catch (error) {
    presentation.fail();
    try { sessionRecord?.fail(); }
    catch { cb.dispatch({ type: 'warning', message: 'Brainstorm failed and its failure receipt could not be recorded.' }); }
    throw error;
  } finally {
    presentation.dispose();
  }
}
