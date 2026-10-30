import type { EngineAdapter, ForgeEvent } from '@kernlang/agon-core';
import { EngineRegistry, resolveWorkingDir, classifyTask, loadConfig } from '@kernlang/agon-core';
import { runSynthesisRuntime, synthesisRoutingAdviceForTaskClass } from '@kernlang/agon-mod-synthesis';
import type { SynthesisResult } from '@kernlang/agon-mod-synthesis';

export {
  buildSynthesisDraftPrompt,
  buildSynthesisSwapPrompt,
  buildSynthesisJudgePrompt,
  shuffleSynthesisEnginesInPlace,
  normalizeSynthesisWinner,
  parseSynthesisJudgeOutput,
} from '@kernlang/agon-mod-synthesis';
export type { SynthesisDraft, SynthesisSwap, SynthesisScore, SynthesisResult } from '@kernlang/agon-mod-synthesis';

export interface SynthesisOptions {
  prompt: string;
  engines: string[];
  registry: EngineRegistry;
  adapter: EngineAdapter;
  swaps?: number;
  judge?: string;
  timeout: number;
  outputDir: string;
  onEvent?: (event: ForgeEvent) => void;
  signal?: AbortSignal;
}

/**
 * Routing guard. synthesis selects a winner by LLM judgment with NO fitness test — fine for prose/design where no clean pass/fail exists, but a liability for testable code (an LLM judge once scored a broken implementation 91/100). For code-shaped tasks, advise forge, which selects by a real fitness test. Returns null for docs/ambiguous tasks (synthesis is the right tool).
 */
export function synthesisRoutingAdvice(prompt: string): string | null {
  return synthesisRoutingAdviceForTaskClass(classifyTask(prompt));
}

export function runSynthesisModus(opts: SynthesisOptions): Promise<SynthesisResult> {
  return runSynthesisRuntime({
    ...opts,
    onEvent: opts.onEvent ? event => opts.onEvent!(event as ForgeEvent) : undefined,
  }, {
    resolveWorkingDir,
    health: { loadConfig },
    warn: message => console.warn(message),
  });
}
