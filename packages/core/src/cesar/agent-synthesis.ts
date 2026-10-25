import {
  runAgentTeamSynthesis as runOwnedAgentTeamSynthesis,
  runAgentInvestigateSynthesis as runOwnedAgentInvestigateSynthesis,
  type AgentSynthesisOptions,
  type AgentSynthesisResult,
  type AgentInvestigateSynthesisOptions,
  type AgentInvestigateSynthesisResult,
  type AgentSynthesisRuntime,
} from '@kernlang/agon-mod-agent';
import { runApiAgentLoop } from '../api/agent-loop.js';
import { recordApiLoopDispatch } from '../signals/delegate-ledger.js';
import { worktreeChangedDiff } from '../blocks/git.js';
import { spawnWithTimeout } from '../blocks/process.js';

export {
  MAX_WINNER_DIFF_CHARS, MAX_LOSER_DIFF_CHARS, MAX_LOSER_RESPONSE_CHARS, MAX_TOTAL_PROMPT_CHARS,
  buildAgentSynthesisPrompt, buildAgentInvestigateSynthesisPrompt, detectSynthesisInsightMention,
} from '@kernlang/agon-mod-agent';
export type {
  AgentSynthesisLoser, AgentSynthesisOptions, AgentSynthesisResult,
  AgentInvestigateSynthesisOptions, AgentInvestigateSynthesisResult, SynthesisBiasSignal,
} from '@kernlang/agon-mod-agent';

const compatibilityRuntime: AgentSynthesisRuntime = {
  runApiAgentLoop,
  recordApiLoopDispatch,
  worktreeChangedDiff,
};

/** Preserve the Core API while callers migrate to the Agent owner. */
export function runAgentTeamSynthesis(options: AgentSynthesisOptions): Promise<AgentSynthesisResult> {
  return runOwnedAgentTeamSynthesis(options, compatibilityRuntime);
}

/** Preserve the Core API while callers migrate to the Agent owner. */
export function runAgentInvestigateSynthesis(options: AgentInvestigateSynthesisOptions): Promise<AgentInvestigateSynthesisResult> {
  return runOwnedAgentInvestigateSynthesis(options, compatibilityRuntime);
}

/**
 * Outcome of re-running the project's fitness command against the winner's worktree after synthesis edits. passed=true means the refinement did not regress; passed=false means the caller must revert to the pre-synthesis diff. error is populated for unexpected spawn failures separate from normal non-zero exits.
 */
export interface PostSynthesisFitnessResult {
  passed: boolean;
  exitCode: number;
  error: string|null;
  durationMs: number;
}

/**
 * Re-run the project's fitness command (e.g. 'npm run typecheck') against the winner's worktree after synthesis edits. Used by runAgentTeam to decide whether to keep the synthesized diff or revert to the pre-synthesis winner diff. Extracted from the caller into a standalone helper so it can be unit-tested against a mocked spawn. Swallows spawn errors into the result rather than throwing — the caller must NOT crash the team run on a fitness tool hiccup.
 */
export async function runPostSynthesisFitnessCheck(opts: {worktreePath:string, fitnessCmd:string, timeoutSec?:number, signal?:AbortSignal, executionRefusal?:()=>string|undefined}): Promise<PostSynthesisFitnessResult> {
  const start = Date.now();
  const assertExecutionAllowed = (): void => {
    opts.signal?.throwIfAborted();
    let reason: string | undefined;
    try { reason = opts.executionRefusal?.(); }
    catch { reason = 'Fitness execution authority check failed'; }
    if (reason !== undefined) throw new Error(reason || 'Fitness execution refused');
  };
  try {
    assertExecutionAllowed();
    const result = await spawnWithTimeout({
      command: 'sh',
      args: ['-c', opts.fitnessCmd],
      cwd: opts.worktreePath,
      timeout: (opts.timeoutSec ?? 90) * 1000,
      signal: opts.signal,
    });
    assertExecutionAllowed();
    return {
      passed: result.exitCode === 0,
      exitCode: result.exitCode,
      error: null,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      passed: false,
      exitCode: -1,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
