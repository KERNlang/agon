import type { EngineAdapter, ForgeEvent } from '@kernlang/agon-core';
import { EngineRegistry, resolveWorkingDir, classifyTask, loadConfig } from '@kernlang/agon-core';
import { runSynthesisRuntime } from '@kernlang/agon-mod-synthesis';
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
  const cls = classifyTask(prompt);
  const codeClasses = ['algorithm', 'refactor', 'bugfix', 'feature', 'test'];
  if (!codeClasses.includes(cls)) return null;
  // Phrased conditionally on the OUTPUT, not as a classification claim — the
  // classifier is heuristic (e.g. "create"/"build" → feature), so a prose task
  // that trips the gate still reads correctly and the user simply carries on.
  return [
    'Heads up: `agon synthesis` picks a winner by LLM judgment with no fitness test.',
    'If this task produces code you can test, prefer `agon forge -t "<test>"` — it selects by',
    "proven correctness and won't crown a confident-but-wrong artifact. If it's design, prose,",
    "or tradeoffs with no clean pass/fail, synthesis is the right tool — carry on.",
  ].join(' ');
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
