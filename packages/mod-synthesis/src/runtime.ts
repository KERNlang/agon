import type { EngineAdapter } from '@kernlang/agon-support-engine-runtime';
import { preflightHealthFilter } from '@kernlang/agon-support-panel';
import type { PanelEngineRegistry, PanelHealthRuntime } from '@kernlang/agon-support-panel';

export interface SynthesisDraft {
  engineId: string;
  content: string;
  round: number;
}

export interface SynthesisSwap {
  round: number;
  fromEngineId: string;
  toEngineId: string;
  originalContent: string;
  improvedContent: string;
  reasoning: string;
}

import { parseSynthesisJudgeOutput } from './judge-parser.js';
import type { SynthesisScore } from './judge-parser.js';

export interface SynthesisResult {
  prompt: string;
  drafts: SynthesisDraft[];
  swaps: SynthesisSwap[];
  scores: SynthesisScore[];
  winner: string;
  judgeReasoning: string;
}

export interface SynthesisRuntimeOptions {
  prompt: string;
  engines: string[];
  registry: PanelEngineRegistry;
  adapter: EngineAdapter;
  swaps?: number;
  judge?: string;
  timeout: number;
  outputDir: string;
  onEvent?: (event: SynthesisRuntimeEvent) => void;
  signal?: AbortSignal;
}


export interface SynthesisRuntimeEvent {
  type: 'synthesis:draft' | 'synthesis:swap' | 'synthesis:score' | 'engine:failed';
  engineId: string;
  data: Record<string, unknown>;
}

export interface SynthesisRuntimeEffects {
  resolveWorkingDir(): string;
  health: PanelHealthRuntime;
  warn(message: string): void;
}

export function buildSynthesisDraftPrompt(prompt: string): string {
  return [
    '## SYNTHESIS DRAFT',
    `Task: ${prompt}`,
    '',
    '## INSTRUCTIONS',
    'Produce your best independent solution to the task above.',
    'Write it as plain text / code / markdown - whatever format best serves the task.',
    'Do NOT reference other engines; this is your solo draft.',
    'Be thorough and specific.',
  ].join('\n');
}

export function buildSynthesisSwapPrompt(task: string, originalEngineId: string, originalContent: string): string {
  return [
    "## SYNTHESIS SWAP - IMPROVE ANOTHER ENGINE'S DRAFT",
    `Task: ${task}`,
    '',
    `## ORIGINAL DRAFT by ${originalEngineId}`,
    '---',
    originalContent,
    '---',
    '',
    '## INSTRUCTIONS',
    'You have received the draft above from another engine.',
    'Your job: produce an improved version.',
    'You may fix bugs, add missing details, restructure for clarity, or strengthen arguments.',
    'Do NOT simply rewrite - genuinely improve it.',
    'After your improved draft, add a short ## REASONING section explaining what you changed and why.',
  ].join('\n');
}

export function buildSynthesisJudgePrompt(task: string, entries: {engineId:string;content:string}[]): string {
  const drafts = entries
    .map((e, i) => `## ENTRY ${i + 1} - ${e.engineId}\n---\n${e.content}\n---`)
    .join('\n\n');

  return [
    '## SYNTHESIS JUDGE',
    `Task: ${task}`,
    '',
    drafts,
    '',
    '## INSTRUCTIONS',
    'You are an impartial judge. Evaluate each entry on:',
    '- correctness / accuracy (0-25)',
    '- completeness / depth (0-25)',
    '- clarity / structure (0-25)',
    '- creativity / insight (0-25)',
    '',
    'For each entry, write a brief critique (2-3 sentences), and explicitly name the single most',
    'important edge case or scenario the entry FAILS to handle — correctness blind spots such as',
    'unusual inputs, platform/environment quirks (e.g. path canonicalization), concurrency, or',
    'empty/error states. A plausible-looking answer that ignores a key edge case is NOT correct.',
    'Then end your response with exactly these lines, one set per entry in order:',
    '',
    'SCORE_1: <number 0-100>',
    'CONFIDENCE_1: <0.0-1.0 — your confidence the entry is actually CORRECT, not just plausible>',
    'UNHANDLED_1: <the most important edge case this entry does not handle, or "none">',
    'SCORE_2: <number 0-100>',
    'CONFIDENCE_2: <0.0-1.0>',
    'UNHANDLED_2: <edge case, or "none">',
    '...',
    'WINNER: "<engineId>"',
    'REASONING: "<one-sentence verdict>"',
  ].join('\n');
}

export function shuffleSynthesisEnginesInPlace(arr: any[]): any[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}


export async function runSynthesisRuntime(opts: SynthesisRuntimeOptions, effects: SynthesisRuntimeEffects): Promise<SynthesisResult> {
  const check = () => opts.signal?.throwIfAborted();
  check();
  const { prompt, registry, adapter, timeout, outputDir } = opts;
  const swapRounds = Math.max(0, opts.swaps ?? 1);
  const cwd = effects.resolveWorkingDir();
  // Pre-flight: drop session-quarantined engines (Layer 1, pure zero-dispatch). Probe opt-in.
  const __hc = await preflightHealthFilter({ engineIds: opts.engines, registry, adapter, signal: opts.signal, runtime: effects.health });
  check();
  for (const s of __hc.skipped) effects.warn(`[agon] synthesis: skipping ${s.engineId} — ${s.status} (${s.reason})`);
  const engines = __hc.healthy;
  if (engines.length === 0) {
    throw new Error(`No healthy engines for synthesis; all ${__hc.skipped.length} were quarantined this session (${__hc.skipped.map((s) => s.engineId).join(', ')}). Restore with 'agon engine add <id>'.`);
  }

  const drafts: SynthesisDraft[] = [];
  const draftPromises = engines.map(async (engineId) => {
    check();
    const engine = registry.get(engineId);
    try {
      const result = await adapter.dispatch({
        engine,
        prompt: buildSynthesisDraftPrompt(prompt),
        systemPrompt: 'You are participating in a synthesis competition. Produce your best independent draft. Do NOT use tools, read files, or run commands.',
        textOnly: true,
        cwd,
        mode: 'exec',
        timeout,
        outputDir,
        signal: opts.signal,
      });
      check();
      const content = result.stdout.trim();
      drafts.push({ engineId, content, round: 0 });
      opts.onEvent?.({ type: 'synthesis:draft', engineId, data: { engineId, round: 0 } });
    } catch (err) {
      check();
      const msg = err instanceof Error ? err.message : String(err);
      effects.warn(`[agon] synthesis draft (${engineId}) failed: ${msg}`);
      drafts.push({ engineId, content: `[draft failed: ${msg}]`, round: 0 });
      opts.onEvent?.({ type: 'engine:failed', engineId, data: { engineId, phase: 'synthesis-draft', error: msg } });
    }
  });

  await Promise.all(draftPromises);
  check();

  const swaps: SynthesisSwap[] = [];
  let currentDrafts = new Map(drafts.map((d) => [d.engineId, d.content]));

  for (let round = 1; round <= swapRounds; round += 1) {
    check();
    const shuffled = shuffleSynthesisEnginesInPlace([...engines]);
    const pairs: [string, string][] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) {
        pairs.push([shuffled[i], shuffled[i + 1]]);
      }
    }

    const swapPromises = pairs.map(async ([fromId, toId]) => {
      check();
      const original = currentDrafts.get(fromId);
      if (!original || original.startsWith('[draft failed')) return;
      const engine = registry.get(toId);
      try {
        const result = await adapter.dispatch({
          engine,
          prompt: buildSynthesisSwapPrompt(prompt, fromId, original),
          systemPrompt: "You are improving another engine's draft in a synthesis competition. Produce a better version with a ## REASONING section. Do NOT use tools, read files, or run commands.",
          textOnly: true,
          cwd,
          mode: 'exec',
          timeout,
          outputDir,
          signal: opts.signal,
        });
        check();
        const raw = result.stdout.trim();
        const parts = raw.split(/##\s*REASONING/i);
        const improved = parts[0].trim();
        const reasoning = parts[1]?.trim() || 'No reasoning provided';
        swaps.push({ round, fromEngineId: fromId, toEngineId: toId, originalContent: original, improvedContent: improved, reasoning });
        currentDrafts.set(toId, improved);
        opts.onEvent?.({ type: 'synthesis:swap', engineId: toId, data: { round, from: fromId, to: toId } });
      } catch (err) {
        check();
        const msg = err instanceof Error ? err.message : String(err);
        effects.warn(`[agon] synthesis swap (${toId} improving ${fromId}) failed: ${msg}`);
        opts.onEvent?.({ type: 'engine:failed', engineId: toId, data: { engineId: toId, phase: 'synthesis-swap', error: msg } });
      }
    });

    await Promise.all(swapPromises);
    check();
  }

  const judgeId = opts.judge && engines.includes(opts.judge)
    ? opts.judge
    : engines[0];

  const judgeEngine = registry.get(judgeId);
  const entries = engines
    .map((id) => ({ engineId: id, content: currentDrafts.get(id) || '' }))
    .filter((e) => e.content && !e.content.startsWith('[draft failed'));

  let judgeText = '';
  try {
    const judgeResult = await adapter.dispatch({
      engine: judgeEngine,
      prompt: buildSynthesisJudgePrompt(prompt, entries),
      systemPrompt: 'You are an impartial judge in a synthesis competition. Score entries and declare a winner. Do NOT use tools, read files, or run commands.',
      textOnly: true,
      cwd,
      mode: 'review',
      timeout,
      outputDir,
      signal: opts.signal,
    });
    check();
    judgeText = judgeResult.stdout.trim();
    opts.onEvent?.({ type: 'synthesis:score', engineId: judgeId, data: {} });
  } catch (err) {
    check();
    const msg = err instanceof Error ? err.message : String(err);
    effects.warn(`[agon] synthesis judge (${judgeId}) failed: ${msg}`);
    opts.onEvent?.({ type: 'engine:failed', engineId: judgeId, data: { engineId: judgeId, phase: 'synthesis-judge', error: msg } });
  }

  const { scores, winner, reasoning } = parseSynthesisJudgeOutput(judgeText, entries.map((e) => e.engineId));

  return {
    prompt,
    drafts,
    swaps,
    scores,
    winner,
    judgeReasoning: reasoning,
  };
}
