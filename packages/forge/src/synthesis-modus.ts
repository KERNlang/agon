// ── Synthesis modus — competitive cross-pollination ───────────────────
// Engines draft independently, swap and improve each other's work, then a
// judge scores the evolved artifacts.  Distinct from Forge (single-task
// competition), Tribunal (debate), and Brainstorm (confidence bidding).

import type { EngineAdapter, ForgeEvent } from '@agon/core';
import { EngineRegistry, resolveWorkingDir } from '@agon/core';

// ── Types ─────────────────────────────────────────────────────────────

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

export interface SynthesisScore {
  engineId: string;
  score: number;
  breakdown: string;
}

export interface SynthesisResult {
  prompt: string;
  drafts: SynthesisDraft[];
  swaps: SynthesisSwap[];
  scores: SynthesisScore[];
  winner: string;
  judgeReasoning: string;
}

// ── Prompt builders ───────────────────────────────────────────────────

function buildDraftPrompt(prompt: string): string {
  return [
    `## SYNTHESIS DRAFT`,
    `Task: ${prompt}`,
    ``,
    `## INSTRUCTIONS`,
    `Produce your best independent solution to the task above.`,
    `Write it as plain text / code / markdown — whatever format best serves the task.`,
    `Do NOT reference other engines; this is your solo draft.`,
    `Be thorough and specific.`,
  ].join('\n');
}

function buildSwapPrompt(task: string, originalEngineId: string, originalContent: string): string {
  return [
    `## SYNTHESIS SWAP — IMPROVE ANOTHER ENGINE'S DRAFT`,
    `Task: ${task}`,
    ``,
    `## ORIGINAL DRAFT by ${originalEngineId}`,
    `---`,
    originalContent,
    `---`,
    ``,
    `## INSTRUCTIONS`,
    `You have received the draft above from another engine.`,
    `Your job: produce an improved version.`,
    `You may fix bugs, add missing details, restructure for clarity, or strengthen arguments.`,
    `Do NOT simply rewrite — genuinely improve it.`,
    `After your improved draft, add a short ## REASONING section explaining what you changed and why.`,
  ].join('\n');
}

function buildJudgePrompt(task: string, entries: { engineId: string; content: string }[]): string {
  const drafts = entries
    .map((e, i) => `## ENTRY ${i + 1} — ${e.engineId}\n---\n${e.content}\n---`)
    .join('\n\n');

  return [
    `## SYNTHESIS JUDGE`,
    `Task: ${task}`,
    ``,
    drafts,
    ``,
    `## INSTRUCTIONS`,
    `You are an impartial judge. Evaluate each entry on:`,
    `- correctness / accuracy (0-25)`,
    `- completeness / depth (0-25)`,
    `- clarity / structure (0-25)`,
    `- creativity / insight (0-25)`,
    ``,
    `For each entry, write a brief critique (2-3 sentences).`,
    `Then end your response with exactly these lines:`,
    ``,
    `SCORE_1: <number 0-100>`,
    `SCORE_2: <number 0-100>`,
    `...`,
    `WINNER: "<engineId>"`,
    `REASONING: "<one-sentence verdict>"`,
  ].join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function parseJudgeOutput(text: string, engineIds: string[]): { scores: SynthesisScore[]; winner: string; reasoning: string } {
  const scores: SynthesisScore[] = [];
  for (let i = 0; i < engineIds.length; i++) {
    const re = new RegExp(`SCORE_${i + 1}\\s*:\\s*(\\d{1,3})`, 'i');
    const m = text.match(re);
    scores.push({
      engineId: engineIds[i],
      score: m ? Math.min(parseInt(m[1], 10), 100) : 0,
      breakdown: '',
    });
  }

  const winnerMatch = text.match(/WINNER:\s*"?([^"\n]+)"?/i);
  const winner = winnerMatch ? winnerMatch[1].trim() : engineIds[0];

  const reasonMatch = text.match(/REASONING:\s*"?([^"\n]+)"?/i);
  const reasoning = reasonMatch ? reasonMatch[1].trim() : 'No reasoning provided';

  return { scores, winner, reasoning };
}

// ── Core ──────────────────────────────────────────────────────────────

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

export async function runSynthesis(opts: SynthesisOptions): Promise<SynthesisResult> {
  const { prompt, engines, registry, adapter, timeout, outputDir } = opts;
  const swapRounds = Math.max(0, opts.swaps ?? 1);
  const cwd = resolveWorkingDir();

  // ── Phase 1: Initial drafts (parallel) ──────────────────────────────
  const drafts: SynthesisDraft[] = [];
  const draftPromises = engines.map(async (engineId) => {
    const engine = registry.get(engineId);
    try {
      const result = await adapter.dispatch({
        engine,
        prompt: buildDraftPrompt(prompt),
        systemPrompt: 'You are participating in a synthesis competition. Produce your best independent draft. Do NOT use tools, read files, or run commands.',
        cwd,
        mode: 'exec',
        timeout,
        outputDir,
        signal: opts.signal,
      });
      const content = result.stdout.trim();
      drafts.push({ engineId, content, round: 0 });
      opts.onEvent?.({ type: 'synthesis:draft' as any, engineId, data: { engineId, round: 0 } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[agon] synthesis draft (${engineId}) failed: ${msg}`);
      drafts.push({ engineId, content: `[draft failed: ${msg}]`, round: 0 });
      opts.onEvent?.({ type: 'engine:failed' as any, engineId, data: { engineId, phase: 'synthesis-draft', error: msg } });
    }
  });

  await Promise.all(draftPromises);

  // ── Phase 2: Swap rounds ────────────────────────────────────────────
  const swaps: SynthesisSwap[] = [];
  let currentDrafts = new Map(drafts.map((d) => [d.engineId, d.content]));

  for (let round = 1; round <= swapRounds; round++) {
    const shuffled = shuffleInPlace([...engines]);
    const pairs: [string, string][] = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      if (i + 1 < shuffled.length) {
        pairs.push([shuffled[i], shuffled[i + 1]]);
      }
    }
    // Odd engine out keeps its draft

    const swapPromises = pairs.map(async ([fromId, toId]) => {
      const original = currentDrafts.get(fromId);
      if (!original) return;
      const engine = registry.get(toId);
      try {
        const result = await adapter.dispatch({
          engine,
          prompt: buildSwapPrompt(prompt, fromId, original),
          systemPrompt: 'You are improving another engine\'s draft in a synthesis competition. Produce a better version with a ## REASONING section. Do NOT use tools, read files, or run commands.',
          cwd,
          mode: 'exec',
          timeout,
          outputDir,
          signal: opts.signal,
        });
        const raw = result.stdout.trim();
        const parts = raw.split(/##\s*REASONING/i);
        const improved = parts[0].trim();
        const reasoning = parts[1]?.trim() || 'No reasoning provided';
        swaps.push({ round, fromEngineId: fromId, toEngineId: toId, originalContent: original, improvedContent: improved, reasoning });
        currentDrafts.set(toId, improved);
        opts.onEvent?.({ type: 'synthesis:swap' as any, engineId: toId, data: { round, from: fromId, to: toId } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[agon] synthesis swap (${toId} improving ${fromId}) failed: ${msg}`);
        opts.onEvent?.({ type: 'engine:failed' as any, engineId: toId, data: { engineId: toId, phase: 'synthesis-swap', error: msg } });
      }
    });

    await Promise.all(swapPromises);
  }

  // ── Phase 3: Judge ──────────────────────────────────────────────────
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
      prompt: buildJudgePrompt(prompt, entries),
      systemPrompt: 'You are an impartial judge in a synthesis competition. Score entries and declare a winner. Do NOT use tools, read files, or run commands.',
      cwd,
      mode: 'review',
      timeout,
      outputDir,
      signal: opts.signal,
    });
    judgeText = judgeResult.stdout.trim();
    opts.onEvent?.({ type: 'synthesis:score' as any, engineId: judgeId, data: {} });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[agon] synthesis judge (${judgeId}) failed: ${msg}`);
    opts.onEvent?.({ type: 'engine:failed' as any, engineId: judgeId, data: { engineId: judgeId, phase: 'synthesis-judge', error: msg } });
  }

  const { scores, winner, reasoning } = parseJudgeOutput(judgeText, entries.map((e) => e.engineId));

  // Fallback winner if parsing failed
  const finalWinner = engines.includes(winner) ? winner : entries[0]?.engineId ?? engines[0];

  opts.onEvent?.({ type: 'synthesis:done' as any, data: { winner: finalWinner } });

  return {
    prompt,
    drafts,
    swaps,
    scores,
    winner: finalWinner,
    judgeReasoning: reasoning,
  };
}
