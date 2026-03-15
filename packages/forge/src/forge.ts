import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type {
  ForgeOptions,
  ForgeManifest,
  EngineAdapter,
  ForgeEvent,
  AgonConfig,
} from '@agon/core';
import {
  EngineRegistry,
  loadConfig,
  buildForgePrompt,
  repoRoot,
  headSha,
  worktreeRemove,
  updateElo,
  classifyTask,
} from '@agon/core';
import { runBaseline, runStage1, runStage2, determineWinner } from './stages.js';
import { runSynthesis } from './synthesis.js';
import { writeManifest } from './manifest.js';
import type { WorktreeEntry } from './types.js';

/**
 * Run the full forge orchestration.
 */
export async function runForge(
  options: ForgeOptions,
  registry: EngineRegistry,
  adapter: EngineAdapter,
  onEvent?: (event: ForgeEvent) => void,
): Promise<ForgeManifest> {
  const config = loadConfig(options.cwd);
  const forgeId = randomUUID();
  const forgeDir = options.forgeDir;
  const worktrees: WorktreeEntry[] = [];

  mkdirSync(forgeDir, { recursive: true });

  const root = repoRoot(options.cwd);
  const sha = headSha(options.cwd);

  // Resolve available engines
  const enabledEngines = options.engines ?? config.forgeEnabledEngines;
  const available = enabledEngines.filter((id) => {
    try {
      const engine = registry.get(id);
      return registry.isAvailable(engine);
    } catch {
      return false;
    }
  });

  const starter = options.starter
    ?? registry.pickStarter(available, config.forgeStarterStrategy, config.forgeFixedStarter);

  const challengers = available.filter((id) => id !== starter);

  // Build forge prompt
  const forgePrompt = buildForgePrompt({
    task: options.task,
    fitnessCmd: options.fitnessCmd,
  });

  // Initialize manifest
  const manifest: ForgeManifest = {
    forgeId,
    forgeDir,
    task: options.task,
    fitnessCmd: options.fitnessCmd,
    timestamp: new Date().toISOString(),
    engines: available,
    results: {},
    patches: {},
    winner: null,
    closeCall: false,
    stage1Accepted: false,
    baselinePasses: false,
    starter,
    enginesDispatched: 0,
  };

  // Dry-run mode
  if (options.dryRun) {
    onEvent?.({
      type: 'forge:done',
      data: { dryRun: true, engines: available, starter },
    });
    return manifest;
  }

  try {
    // Stage 0: Baseline check
    if (config.forgeRequireBaselineCheck) {
      manifest.baselinePasses = await runBaseline({
        cwd: options.cwd,
        fitnessCmd: options.fitnessCmd,
        fitnessTimeout: config.forgeFitnessTimeout,
        forgeDir,
        onEvent,
      });
    }

    // Stage 1: Starter engine
    const stage1 = await runStage1({
      starter,
      forgePrompt,
      fitnessCmd: options.fitnessCmd,
      config,
      registry,
      adapter,
      cwd: options.cwd,
      forgeDir,
      worktrees,
      onEvent,
    });

    manifest.enginesDispatched = 1;
    for (const [id, result] of stage1.engineResults) {
      manifest.results[id] = result;
      if (result.patchPath) manifest.patches[id] = result.patchPath;
    }

    if (stage1.accepted) {
      manifest.stage1Accepted = true;
      manifest.winner = starter;
      writeManifest(manifest);

      onEvent?.({
        type: 'forge:done',
        engineId: starter,
        data: { stage1Accepted: true, score: stage1.engineResults.get(starter)?.score },
      });
      return manifest;
    }

    // Stage 2: Challengers (parallel)
    if (challengers.length > 0) {
      const stage2 = await runStage2({
        challengers,
        forgePrompt,
        fitnessCmd: options.fitnessCmd,
        config,
        registry,
        adapter,
        cwd: options.cwd,
        forgeDir,
        existingResults: stage1.engineResults,
        worktrees,
        onEvent,
      });

      manifest.enginesDispatched = available.length;
      for (const [id, result] of stage2.engineResults) {
        manifest.results[id] = result;
        if (result.patchPath) manifest.patches[id] = result.patchPath;
      }

      const { winner, closeCall, bestScore, secondScore } = determineWinner(
        stage2.engineResults,
        config.forgeClearWinnerSpread,
      );
      manifest.winner = winner;
      manifest.closeCall = closeCall;

      onEvent?.({
        type: 'winner:determined',
        engineId: winner ?? undefined,
        data: { closeCall, bestScore, secondScore },
      });

      // Stage 3: Synthesis (if close call + enabled + 2+ passing)
      const passingCount = [...stage2.engineResults.values()].filter((r) => r.pass).length;
      if (
        closeCall &&
        config.forgeEnableSynthesis &&
        passingCount >= 2 &&
        winner
      ) {
        const losers = [...stage2.engineResults.keys()].filter((id) => id !== winner);

        const synthResult = await runSynthesis({
          manifest,
          winner,
          losers,
          registry,
          adapter,
          forgeDir,
          fitnessCmd: options.fitnessCmd,
          timeout: config.forgeSynthesisTimeout,
          fitnessTimeout: config.forgeFitnessTimeout,
          maxCritiques: config.forgeMaxCritiques,
          repoRoot: root,
          headSha: sha,
          onEvent,
        });

        manifest.synthesis = {
          pass: synthResult.pass,
          score: synthResult.score,
          wins: synthResult.wins,
          patchPath: synthResult.patchPath,
          originalWinnerScore: synthResult.originalWinnerScore,
        };

        if (synthResult.wins) {
          manifest.winner = 'synthesis';
        }
      }
    } else {
      // Only starter, use its result
      manifest.winner = stage1.winner;
    }

    // ELO updates — credit the engine winner (even when synthesis wins,
    // the engine that produced the base still "won" the competition)
    const eloWinner = manifest.winner === 'synthesis'
      ? Object.entries(manifest.results)
          .filter(([id, r]) => id !== 'synthesis' && r.pass)
          .sort(([, a], [, b]) => b.score - a.score)[0]?.[0] ?? null
      : manifest.winner;

    if (config.eloEnabled && eloWinner) {
      const taskClass = classifyTask(options.task);
      const losers = available.filter(
        (id) => id !== eloWinner && manifest.results[id]?.pass,
      );

      for (const loser of losers) {
        updateElo(eloWinner, loser, taskClass, config.eloKFactor);
        onEvent?.({
          type: 'elo:update',
          data: { winner: eloWinner, loser, taskClass },
        });
      }
    }

    writeManifest(manifest);
    onEvent?.({ type: 'forge:done', data: { winner: manifest.winner } });

    return manifest;
  } finally {
    // Cleanup all worktrees
    for (const wt of worktrees) {
      worktreeRemove(wt.repoRoot, wt.path);
    }
  }
}
