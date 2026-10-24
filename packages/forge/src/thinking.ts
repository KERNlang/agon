import { runThinkRuntime, runThinkCritique } from '@kernlang/agon-mod-think';
import type { ThinkRuntimeOptions, ThinkCritiqueOptions, ThinkResult } from '@kernlang/agon-mod-think';

export { ThinkChainStateError, beginThinkChain, advanceThinkChain, critiqueThinkChain,
  reviseThinkChain, resumeThinkChain, finalizeThinkChain, isThinkStrategy,
  joinProblemInput, buildThinkPrompt, extractThinkJson, parseThoughts,
  groundThoughts, validateChain, selectBranch } from '@kernlang/agon-mod-think';
export type { ThinkChainState, ThoughtNode, ThinkResult } from '@kernlang/agon-mod-think';

// Keep legacy call signatures while Think owns the implementation.
export function runThinkChain(options: Omit<ThinkRuntimeOptions, 'cwd'> & { cwd?: string }): Promise<ThinkResult> {
  return runThinkRuntime({ ...options, cwd: options.cwd ?? process.cwd() }, {
    warn: message => console.warn(message),
  });
}

export function runAdversarialCritique(options: Omit<ThinkCritiqueOptions, 'cwd'> & { cwd?: string }): Promise<string> {
  return runThinkCritique({ ...options, cwd: options.cwd ?? process.cwd() }, {
    warn: message => console.warn(message),
  });
}
