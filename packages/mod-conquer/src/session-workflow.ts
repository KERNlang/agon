import type { ConquerInvocationContext } from './host.js';
import type { ConquerResult } from './workflow.js';

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
        if (event.type !== 'conquer:start' && event.type !== 'conquer:turn') return;
        if (!event.data) throw new Error('Conquer returned invalid session metadata.');
        if (event.type === 'conquer:start') {
          const data = event.data;
          const retained = data.worktree as { branch?: unknown; path?: unknown } | undefined;
          if (typeof data.builder !== 'string' || !Array.isArray(data.advisors)
            || !data.advisors.every(id => typeof id === 'string')
            || typeof retained?.branch !== 'string' || typeof retained.path !== 'string') {
            throw new Error('Conquer returned invalid session metadata.');
          }
          builder = data.builder;
          advisors = [...data.advisors];
          worktree = { branch: retained.branch, path: retained.path };
          host.dispatch({ type: 'header', title: `Conquer · builder=${builder} · advisors=${advisors.join(',') || '(none)'}` });
          const task = input.task as string;
          for (const message of [task.length > 120 ? task.slice(0, 120) + '…' : task,
            `gate: ${input.gate}`, `isolated branch: ${worktree.branch}`, `worktree: ${worktree.path}`]) {
            signal.throwIfAborted();
            info(message);
          }
          if (data.dirtySourceExcluded) host.dispatch({ type: 'warning', message: 'The source checkout has uncommitted work. It remains untouched and is not included in this HEAD-based Conquer branch.' });
        } else {
          const turn = event.data;
          const detail = typeof turn.detail === 'string' ? turn.detail : '';
          info(`turn ${turn.n} · ${turn.action}${turn.action === 'consult' || turn.action === 'done-check' ? ` — ${detail.slice(0, 80)}` : ''}`);
        }
        signal.throwIfAborted();
      },
    });
    signal.throwIfAborted();
    const result = output.result as { workflow?: ConquerResult; outputDir?: string } | undefined;
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
      info(`The builder's changes are isolated on ${worktree.branch} at ${worktree.path}. Review and commit there, then open a PR to merge. Remove it later with: agon worktree rm ${worktree.branch}`);
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
