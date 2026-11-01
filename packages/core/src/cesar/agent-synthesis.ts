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
import { recordApiLoopDispatch } from '@kernlang/agon-support-persistence';
import { worktreeChangedDiff } from '../blocks/git.js';
export { runPostSynthesisFitnessCheck } from '@kernlang/agon-mod-forge';
export type { PostSynthesisFitnessResult } from '@kernlang/agon-mod-forge';

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
