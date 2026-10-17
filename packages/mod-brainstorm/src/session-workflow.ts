import type { BrainstormWorkflowEvent } from './host.js';
import { parseBrainstormResult } from './result.js';
import type { BrainstormResult } from './result.js';

export interface BrainstormSessionCommandResult {
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly result?: unknown;
  readonly failure?: { readonly message?: string };
}

export interface BrainstormSessionExecutionContext {
  cwd: string;
  signal: AbortSignal;
  onWorkflowEvent: (event: BrainstormWorkflowEvent) => void;
}

export interface BrainstormSessionHost {
  cwd(): string;
  hasSession(): boolean;
  defaultEngines(): string[];
  scanContext?(cwd: string): string;
  summaryEnabled(): boolean;
  notify(level: 'info' | 'warning', message: string): void;
  createPresentation(): {
    setEngines(engines: readonly string[]): void;
    onEvent(event: BrainstormWorkflowEvent): void;
    complete(result: BrainstormResult): void;
    fail(): void;
    dispose(): void;
  };
  createRecord(question: string, engines: string[], signal: AbortSignal): {
    complete(result: BrainstormResult): string | undefined;
    fail(): void;
  };
}

function normalizeEngines(value: unknown): string[] {
  const engines = typeof value === 'string'
    ? value.split(',').map(id => id.trim()).filter(Boolean)
    : Array.isArray(value) ? Array.from(value, id => typeof id === 'string' ? id.trim() : id) : value;
  if (!Array.isArray(engines) || !engines.length || !engines.every(id => typeof id === 'string' && id.length > 0)) {
    throw new Error('Brainstorm requires at least one engine.');
  }
  return engines;
}

/** Owns preparation, selected execution and session settlement. The invocation
 * host binds data/renderer effects and its generation-selected executor. */
export async function runBrainstormSession(
  input: Record<string, unknown>,
  signal: AbortSignal,
  host: BrainstormSessionHost,
  execute: (input: Record<string, unknown>, context: BrainstormSessionExecutionContext) => Promise<BrainstormSessionCommandResult>,
): Promise<BrainstormResult> {
  const presentation = host.createPresentation();
  let sessionRecord: ReturnType<BrainstormSessionHost['createRecord']> | undefined;
  const warn = (message: string): void => {
    try { host.notify('warning', message); }
    catch { /* A diagnostic failure must not replace the execution outcome. */ }
  };
  try {
    signal.throwIfAborted();
    const cwd = host.cwd();
    if (input.context !== undefined && typeof input.context !== 'string') throw new Error('Brainstorm context must be a string.');
    if (typeof input.question !== 'string' || !input.question.trim()) throw new Error('Brainstorm requires a question.');
    const selectedEngines = input.engines === undefined ? undefined : normalizeEngines(input.engines);
    if (selectedEngines) input = { ...input, engines: selectedEngines };
    if (host.hasSession()) {
      const engines = selectedEngines ?? normalizeEngines(host.defaultEngines());
      input = { ...input, engines };
      if (input.context === undefined && host.scanContext) {
        const context = host.scanContext(cwd);
        input = { ...input, context };
        if (context) host.notify('info', `Context: ${cwd}`);
      }
      signal.throwIfAborted();
      sessionRecord = host.createRecord(input.question as string, engines, signal);
      presentation.setEngines(engines);
    }
    signal.throwIfAborted();
    const output = await execute(input, { cwd, signal, onWorkflowEvent: event => presentation.onEvent(event) });
    signal.throwIfAborted();
    if ((output.exitCode ?? 0) !== 0) throw new Error(output.stderr?.trim() || output.failure?.message || 'brainstorm failed');
    const result = parseBrainstormResult(output.result ?? output);
    signal.throwIfAborted();
    const summary = sessionRecord?.complete(result);
    try { presentation.complete(result); }
    catch { warn('Brainstorm completed, but its result display could not be updated.'); }
    try { if (summary && host.summaryEnabled()) host.notify('info', summary); }
    catch { warn('Brainstorm completed, but its summary could not be displayed.'); }
    return result;
  } catch (error) {
    const failure = signal.aborted ? signal.reason : error;
    try { presentation.fail(); }
    catch { warn('Brainstorm failed and its failure display could not be updated.'); }
    try { sessionRecord?.fail(); }
    catch { warn('Brainstorm failed and its failure receipt could not be recorded.'); }
    throw failure;
  } finally {
    try { presentation.dispose(); }
    catch { warn('Brainstorm presentation cleanup failed.'); }
  }
}
