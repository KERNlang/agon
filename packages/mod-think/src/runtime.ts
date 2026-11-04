import type { EngineAdapter, EngineDefinition } from '@kernlang/agon-support-engine-runtime';
import { buildThinkPrompt, groundThoughts, isThinkStrategy, parseThoughts, selectBranch, validateChain } from './thinking.js';
import type { ThinkResult, ThoughtNode } from './thinking.js';

export interface ThinkRuntimeOptions {
  problem: string;
  strategy: string;
  engineId: string;
  registry: { get(id: string): EngineDefinition };
  adapter: EngineAdapter;
  maxThoughts: number;
  branches?: number;
  critic?: string;
  timeout: number;
  outputDir: string;
  cwd: string;
  ground: boolean;
  signal?: AbortSignal;
}

export type ThinkCritiqueOptions = Pick<ThinkRuntimeOptions,
  'problem' | 'registry' | 'adapter' | 'timeout' | 'outputDir' | 'cwd' | 'signal'
> & { thoughts: ThoughtNode[]; summary: string; criticId: string };

export interface ThinkEffects {
  warn(message: string): void;
  assertCurrent?(): void;
}

function assertCurrent(options: { signal?: AbortSignal }, effects: ThinkEffects): void {
  options.signal?.throwIfAborted();
  effects.assertCurrent?.();
}

export async function runThinkCritique(opts: ThinkCritiqueOptions, effects: ThinkEffects): Promise<string> {
  assertCurrent(opts, effects);
  try {
    const critic = opts.registry.get(opts.criticId);
    const chainText = opts.thoughts.map((t) => `${t.thoughtNumber}. [${t.kind}] ${t.thought}`).join('\n');
    const prompt = [
      `A reasoner produced this chain for the task: ${opts.problem}`,
      '',
      chainText,
      '',
      `Conclusion: ${opts.summary}`,
      '',
      'You are an adversarial critic. In <=6 bullets, name the laziest, weakest, wrong, unsupported, or missing steps. Be specific and harsh. Do NOT rewrite the chain.',
    ].join('\n');
    const result = await opts.adapter.dispatch({
      engine: critic,
      prompt,
      systemPrompt: 'You are an adversarial reviewer of a reasoning chain. Respond with terse, specific critique bullets only. Do NOT use tools, read files, or run commands.',
      textOnly: true,
      cwd: opts.cwd ?? process.cwd(),
      mode: 'exec',
      timeout: opts.timeout,
      outputDir: opts.outputDir,
      signal: opts.signal,
    });
    assertCurrent(opts, effects);
    const out = String(result.stdout ?? '').trim();
    return (result.exitCode === 0 && !result.timedOut && out) ? out : '';
  } catch (err) {
    assertCurrent(opts, effects);
    effects.warn(`[agon] think adversarial critique (${opts.criticId}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/**
 * Run one sequential-thinking chain via a single structured dispatch, then ground, machine-validate, select the winning branch (tot only), and optionally run a second `critic` engine to adversarially attack the chain. Pure prompt-scaffold path so it works for engines with weak/absent adaptive thinking. cwd defaults to process.cwd() but callers (e.g. goal --cwd) should pass the target repo so dispatch + grounding resolve there. Returns a ThinkResult whose refinedSpec is the handoff to `agon goal`.
 */
export async function runThinkRuntime(opts: ThinkRuntimeOptions, effects: ThinkEffects): Promise<ThinkResult> {
  assertCurrent(opts, effects);
  const strategy = isThinkStrategy(opts.strategy) ? opts.strategy : 'linear';
  const branches = Math.max(1, Math.min(opts.branches ?? 1, 8));
  const cwd = opts.cwd ?? process.cwd();
  const engine = opts.registry.get(opts.engineId);
  const prompt = buildThinkPrompt(opts.problem, strategy, opts.maxThoughts, branches);

  let raw = '';
  let dispatchOk = false;
  try {
    const result = await opts.adapter.dispatch({
      engine,
      prompt,
      systemPrompt: 'You are a structured sequential reasoner. Output ONLY the JSON object requested. Do NOT use tools, read files, or run commands.',
      textOnly: true,
      cwd,
      mode: 'exec',
      timeout: opts.timeout,
      outputDir: opts.outputDir,
      signal: opts.signal,
    });
    assertCurrent(opts, effects);
    raw = String(result.stdout ?? '');
    dispatchOk = result.exitCode === 0 && !result.timedOut && raw.trim().length > 0;
    if (!dispatchOk) {
      const detail = result.timedOut ? 'timed out' : (result.stderr?.trim()?.slice(0, 200) || `exit ${result.exitCode}`);
      effects.warn(`[agon] think dispatch (${opts.engineId}) failed: ${detail}`);
    }
  } catch (err) {
    assertCurrent(opts, effects);
    effects.warn(`[agon] think dispatch (${opts.engineId}) threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!dispatchOk) {
    return {
      problem: opts.problem,
      strategy,
      engineId: opts.engineId,
      thoughts: [],
      summary: '',
      openQuestions: [],
      refinedSpec: opts.problem,
      protocolValid: false,
      groundingIssues: [],
      ok: false,
    };
  }

  const cap = Math.min(opts.maxThoughts * branches, 80);
  const parsed = parseThoughts(raw, cap);
  const grounded = opts.ground
    ? groundThoughts(parsed.thoughts, cwd)
    : { thoughts: parsed.thoughts, issues: [] as string[] };
  const protocolValid = validateChain(grounded.thoughts, strategy);

  // tot picks the best-scored branch and prunes losers. graph/hypothesis
  // keep all branches (graph MERGES them; pruning would misrepresent that).
  const selected = strategy === 'tot'
    ? selectBranch(grounded.thoughts)
    : { thoughts: grounded.thoughts, chosenBranch: undefined as string | undefined };

  // Optional second-engine adversarial critique (skip if it is the same engine).
  let adversarialCritique: string | undefined;
  let criticEngineId: string | undefined;
  const criticId = opts.critic?.trim();
  if (criticId && criticId !== opts.engineId) {
    const critique = await runThinkCritique({
      problem: opts.problem,
      thoughts: selected.thoughts,
      summary: parsed.summary,
      criticId,
      registry: opts.registry,
      adapter: opts.adapter,
      timeout: opts.timeout,
      outputDir: opts.outputDir,
      cwd,
      signal: opts.signal,
    }, effects);
    if (critique) {
      adversarialCritique = critique;
      criticEngineId = criticId;
    }
  }

  assertCurrent(opts, effects);
  return {
    problem: opts.problem,
    strategy,
    engineId: opts.engineId,
    thoughts: selected.thoughts,
    summary: parsed.summary,
    openQuestions: parsed.openQuestions,
    refinedSpec: parsed.refinedSpec || opts.problem,
    protocolValid,
    groundingIssues: grounded.issues,
    chosenBranch: selected.chosenBranch,
    adversarialCritique,
    criticEngineId,
    ok: true,
  };
}
