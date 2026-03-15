import { readFileSync } from 'node:fs';
import type {
  EngineAdapter,
  EngineResult,
  ForgeManifest,
  Critique,
} from '@agon/core';
import {
  EngineRegistry,
  FitnessError,
  buildCritiquePrompt,
  buildSynthesisPrompt,
  worktreeCreate,
  worktreeRemove,
  applyPatch,
} from '@agon/core';
import { runFitness } from './fitness.js';
import type { SynthesisResult, ForgeEventCallback } from './types.js';

/**
 * Run synthesis: collect critiques from losers, refine winner.
 */
export async function runSynthesis(opts: {
  manifest: ForgeManifest;
  winner: string;
  losers: string[];
  registry: EngineRegistry;
  adapter: EngineAdapter;
  forgeDir: string;
  fitnessCmd: string;
  timeout: number;
  fitnessTimeout: number;
  maxCritiques: number;
  repoRoot: string;
  headSha: string;
  onEvent?: ForgeEventCallback;
}): Promise<SynthesisResult> {
  const { manifest, winner, losers, registry, adapter, forgeDir } = opts;

  const winnerResult = manifest.results[winner];
  if (!winnerResult.patchPath) {
    throw new FitnessError('Winner has no patch path — cannot synthesize');
  }
  const winnerPatch = readFileSync(winnerResult.patchPath, 'utf-8');

  // Phase 1: Collect critiques from losers (parallel)
  opts.onEvent?.({ type: 'synthesis:start' });

  const critiquePromises = losers.map(async (loserId) => {
    opts.onEvent?.({ type: 'synthesis:critique', engineId: loserId });
    const engine = registry.get(loserId);
    const prompt = buildCritiquePrompt({
      winnerEngine: winner,
      diff: winnerPatch,
      maxCritiques: opts.maxCritiques,
    });

    try {
      const result = await adapter.dispatch({
        engine,
        prompt,
        cwd: forgeDir,
        mode: 'review',
        timeout: opts.timeout,
        outputDir: forgeDir,
      });

      // Parse critique JSON from stdout
      return parseCritiques(result.stdout);
    } catch {
      return [] as Critique[];
    }
  });

  const critiqueArrays = await Promise.all(critiquePromises);
  const allCritiques = critiqueArrays.flat().slice(0, opts.maxCritiques);

  if (allCritiques.length === 0) {
    return {
      pass: false,
      score: 0,
      wins: false,
      patchPath: '',
      originalWinnerScore: winnerResult.score,
      critiques: [],
    };
  }

  // Phase 2: Winner refinement
  opts.onEvent?.({ type: 'synthesis:refine', engineId: winner });

  const synthWtPath = `${forgeDir}/synth-worktree`;

  try {
    worktreeCreate(opts.repoRoot, synthWtPath, opts.headSha);

    // Apply winner's patch to synth worktree
    applyPatch(synthWtPath, winnerPatch);

    // Build synthesis prompt
    const synthPrompt = buildSynthesisPrompt({
      diff: winnerPatch,
      critiques: allCritiques,
      fitnessCmd: opts.fitnessCmd,
    });

    const winnerEngine = registry.get(winner);
    await adapter.dispatch({
      engine: winnerEngine,
      prompt: synthPrompt,
      cwd: synthWtPath,
      mode: 'exec',
      timeout: opts.timeout,
      outputDir: forgeDir,
    });

    // Phase 3: Score synthesis
    opts.onEvent?.({ type: 'synthesis:score' });

    const synthResult = await runFitness({
      engineId: 'synthesis',
      worktreePath: synthWtPath,
      fitnessCmd: opts.fitnessCmd,
      timeout: opts.fitnessTimeout,
      forgeDir,
    });

    const wins = synthResult.pass && synthResult.score > winnerResult.score;

    opts.onEvent?.({
      type: 'synthesis:done',
      data: {
        wins,
        score: synthResult.score,
        originalScore: winnerResult.score,
      },
    });

    return {
      pass: synthResult.pass,
      score: synthResult.score,
      wins,
      patchPath: synthResult.patchPath ?? '',
      originalWinnerScore: winnerResult.score,
      critiques: allCritiques,
    };
  } finally {
    worktreeRemove(opts.repoRoot, synthWtPath);
  }
}

/**
 * Parse critique JSON from engine output.
 */
function parseCritiques(output: string): Critique[] {
  // Find the last JSON array in output (engines may output text before/after)
  const allMatches = [...output.matchAll(/\[[\s\S]*?\]/g)];
  const jsonMatch = allMatches.length > 0 ? [allMatches[allMatches.length - 1][0]] : null;
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      file?: string;
      lines?: string;
      problem?: string;
      minimal_fix?: string;
      minimalFix?: string;
    }>;

    return parsed
      .filter((c) => c.file && c.problem)
      .map((c) => ({
        file: c.file!,
        lines: c.lines ?? '',
        problem: c.problem!,
        minimalFix: c.minimal_fix ?? c.minimalFix ?? '',
      }));
  } catch {
    return [];
  }
}
