import type { ConquerInvocationContext } from './host.js';
import type { ConquerResult } from './workflow.js';
import { renderConquerProgress, renderConquerPublication } from './presentation.js';
import type { ConquerPublicationOutput } from './presentation.js';

export interface ConquerSessionHost {
  cwd(): string;
  now(): number;
  dispatch(event: { type: 'header'; title: string } | { type: 'info' | 'warning'; message: string }): void;
  appendMessage(message: { role: 'engine'; engineId: string; content: string; timestamp: string }): void;
  recordRun(result: {
    mode: 'conquer'; intent: string; winner: string; success: boolean; durationMs: number;
    engineIds: string[]; completionState: 'completed' | 'crashed' | 'aborted';
  }): void;
}

export interface ConquerSessionCommandResult {
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly result?: unknown;
  readonly failure?: { readonly message?: string };
}

export type ConquerSessionContext = Pick<ConquerInvocationContext, 'cwd' | 'signal' | 'onWorkflowEvent'>;

/** Own session presentation and history; the host executes the selected contribution. */
export async function runConquerSession(
  input: Record<string, unknown>, signal: AbortSignal, host: ConquerSessionHost,
  execute: (input: Record<string, unknown>, context: ConquerSessionContext) => Promise<ConquerSessionCommandResult>,
): Promise<unknown> {
  signal.throwIfAborted();
  if (typeof input.task !== 'string' || !input.task.trim()) throw new Error('Usage: /conquer <task> --gate "<test cmd>"');
  if (typeof input.gate !== 'string' || !input.gate.trim()) throw new Error('/conquer needs a --gate command (the done-oracle).');
  const startedAt = host.now();
  let builder = '', advisors: string[] = [];
  let worktree: { branch: string; path: string } | undefined;
  let recorded = false;
  const info = (message: string) => {
    signal.throwIfAborted();
    host.dispatch({ type: 'info', message });
    signal.throwIfAborted();
  };
  const record = (success: boolean, completionState: 'completed' | 'crashed' | 'aborted') => {
    // A failed host write must not cause a second partial write.
    recorded = true;
    host.recordRun({ mode: 'conquer', intent: input.task as string, winner: builder, success,
      durationMs: host.now() - startedAt, engineIds: [builder, ...advisors].filter(Boolean), completionState });
  };
  try {
    const output = await execute(input, {
      cwd: host.cwd(), signal,
      onWorkflowEvent(event) {
        signal.throwIfAborted();
        renderConquerProgress({ ...event, data: event.data && { ...event.data, task: input.task, gate: input.gate } }, message => {
          signal.throwIfAborted();
          host.dispatch(message);
          signal.throwIfAborted();
        }, state => { builder = state.builder; advisors = state.advisors; worktree = state.worktree; });
        signal.throwIfAborted();
      },
    });
    signal.throwIfAborted();
    const result = output.result as (ConquerPublicationOutput & { workflow?: ConquerResult; outputDir?: string }) | undefined;
    const workflow = result?.workflow;
    if (!workflow || typeof workflow.done !== 'boolean' || typeof workflow.stopReason !== 'string' || !worktree || !builder) {
      throw new Error(output.stderr?.trim() || output.failure?.message || 'Conquer returned an invalid session result.');
    }
    info(`Stopped: ${workflow.stopReason} · turns ${workflow.turnsUsed} · consults ${workflow.consultsRun}`);
    if (workflow.counterexample) info(`Falsifier counterexample: ${workflow.counterexample}${workflow.observed ? ` → observed: ${workflow.observed}` : ''}`);
    if (workflow.attackText) info(`Adversary falsifier log in ${result?.outputDir} (advisory — review before merging).`);
    const success = (output.exitCode ?? 0) === 0 && workflow.done;
    const claim = workflow.lastClaim || '(no claim captured)';
    const reason = success ? workflow.doneReason : output.failure?.message || output.stderr?.trim() || workflow.doneReason;
    if (success) {
      info(`✓ Conquered. Claim: ${claim}`);
      if (!renderConquerPublication(result ?? {}, info)) info(`The builder's changes are isolated on ${worktree.branch} at ${worktree.path}. Review and commit there, then open a PR to merge. Remove it later with: agon worktree rm ${worktree.branch}`);
    } else {
      info(reason ? `${workflow.done ? 'Conquer failed' : 'Not verified done'} — ${reason}` : 'Did not reach a verified done state — inspect the isolated worktree.');
      info(`Work preserved on ${worktree.branch} at ${worktree.path}.`);
    }
    signal.throwIfAborted();
    host.appendMessage({ role: 'engine', engineId: builder, timestamp: new Date(host.now()).toISOString(),
      content: success ? `[conquer:done] ${claim}`
        : `[conquer:stopped] ${workflow.stopReason}${reason ? ` — ${reason}` : ''}` });
    // History commits the session outcome. Finish its receipt despite late cancellation.
    record(success, success ? 'completed' : workflow.done || workflow.stopReason === 'builder-failed' ? 'crashed' : 'aborted');
    if (!success) throw new Error(output.stderr?.trim() || output.failure?.message || 'Conquer did not reach verified completion.');
    return output.result;
  } catch (error) {
    if (worktree) {
      try { host.dispatch({ type: 'info', message: `Work preserved on ${worktree.branch} at ${worktree.path}. Remove it later with: agon worktree rm ${worktree.branch}` }); }
      catch (displayError) { console.warn('[agon] Conquer recovery display failed:', displayError); }
    }
    if (!recorded && builder) {
      try { record(false, signal.aborted ? 'aborted' : 'crashed'); }
      catch (recordError) { console.warn('[agon] Conquer failure recording failed:', recordError); }
    }
    throw error;
  }
}
