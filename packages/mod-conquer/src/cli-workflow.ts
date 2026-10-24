import type { CommandResult, Json } from '@kernlang/agon-mod-api';
import type { ConquerInvocationContext } from './host.js';
import type { ConquerResult } from './workflow.js';
import type { ConquerPullRequest } from './pull-request.js';
import type { ConquerPublicationResult } from './publication.js';
import { renderConquerProgress, renderConquerPublication } from './presentation.js';
import type { ConquerDisplay, ConquerProgressState } from './presentation.js';

/** Preserve terminal output without changing the structured execution result. */
export async function runConquerCli(
  input: Json, context: ConquerInvocationContext,
  execute: (input: Json, context: ConquerInvocationContext) => Promise<CommandResult>,
  display?: ConquerDisplay,
): Promise<CommandResult> {
  const lines: string[] = [];
  const write: ConquerDisplay = display ?? (event => { lines.push(event.type === 'header' ? event.title : event.message); });
  let state: ConquerProgressState | undefined;
  const checkedWrite: ConquerDisplay = event => {
    context.signal.throwIfAborted();
    write(event);
    context.signal.throwIfAborted();
  };
  const info = (message: string) => checkedWrite({ type: 'info', message });
  try {
    const output = await execute(input, { ...context, onWorkflowEvent: event => {
      renderConquerProgress(event, checkedWrite, started => { state = started; });
      context.onWorkflowEvent?.(event);
      context.signal.throwIfAborted();
    } });
    context.signal.throwIfAborted();
    const result = output.result as {
      workflow?: ConquerResult; outputDir?: string;
      publication?: ConquerPublicationResult; pullRequest?: ConquerPullRequest;
    } | undefined;
    const workflow = result?.workflow;
    if (workflow && state) {
      info(`Stopped: ${workflow.stopReason} · turns ${workflow.turnsUsed} · consults ${workflow.consultsRun}`);
      if (workflow.counterexample) info(`Falsifier counterexample: ${workflow.counterexample}${workflow.observed ? ` → observed: ${workflow.observed}` : ''}`);
      if (workflow.attackText) info(`Adversary falsifier log: ${result?.outputDir} (advisory — review before merging).`);
      if (output.exitCode === 0 && workflow.done) {
        info('✓ Conquered — build complete and the done-oracle passed.');
        info(`Claim: ${workflow.lastClaim || '(no claim captured)'}`);
        if (!renderConquerPublication(result ?? {}, info)) info(`The builder's changes are isolated on ${state.worktree.branch} at ${state.worktree.path}. Review and commit there, then open a PR to merge. Remove it later with: agon worktree rm ${state.worktree.branch}`);
      } else {
        info(output.failure?.message || workflow.doneReason || 'Did not reach a verified done state.');
        if (workflow.doneReason && output.failure?.message && workflow.doneReason !== output.failure.message) info(workflow.doneReason);
        info(`Work preserved on ${state.worktree.branch} at ${state.worktree.path}.`);
      }
    }
    return { ...output, stdout: lines.length ? lines.join('\n') + '\n' : '' };
  } catch (error) {
    if (state) {
      try { write({ type: 'warning', message: `Work preserved on ${state.worktree.branch} at ${state.worktree.path}. Remove it later with: agon worktree rm ${state.worktree.branch}` }); }
      catch (displayError) { console.warn('[agon] Conquer recovery display failed:', displayError); }
    }
    throw error;
  }
}
