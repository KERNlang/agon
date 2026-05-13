import { defineCommand } from 'citty';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { EngineRegistry, ensureAgonHome, loadConfig, RUNS_DIR } from '@agon/core';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import type { EngineResult, ForgeEvent } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { runForge } from '@agon/forge';
import { header, success, fail, warn, info, table, green, red, yellow, bold, cyan } from '../output.js';
import { icons } from '../icons.js';
import { filterDefaultOrchestrationEngines } from '../generated/handlers/engine-filter.js';

export const forgeCommand = defineCommand({
  meta: {
    name: 'forge',
    description: 'Run competitive forge — engines race to implement a task',
  },
  args: {
    task: {
      type: 'positional',
      description: 'Task description',
      required: true,
    },
    test: {
      type: 'string',
      alias: 't',
      description: 'Fitness test command',
      required: true,
    },
    cwd: {
      type: 'string',
      description: 'Working directory',
      default: process.cwd(),
    },
    starter: {
      type: 'string',
      alias: 's',
      description: 'Override starter engine',
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
    timeout: {
      type: 'string',
      description: 'Engine timeout in seconds',
    },
    dryRun: {
      type: 'boolean',
      description: 'Show what would happen without executing',
      default: false,
    },
    finalizeOnScore: {
      type: 'string',
      description: 'Finalize forge as soon as any engine PASSES with score >= this threshold (0-100). Aborts in-flight stage-2 engines and proceeds to winner selection. Useful for cost-control and Cesar-driven smart early-exit.',
    },
  },
  async run({ args }) {
    ensureAgonHome();
    const config = loadConfig(args.cwd);

    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());

    const adapter = createCliAdapter(registry);

    const allActive = registry.activeIds(config);
    const available = args.engines
      ? allActive
      : filterDefaultOrchestrationEngines(allActive);
    if (available.length === 0) {
      fail('No engines found. Install at least one AI CLI tool.');
      info('Supported: claude, codex, gemini');
      process.exit(1);
    }

    const forgeDir = join(RUNS_DIR, `forge-${Date.now()}`);
    mkdirSync(forgeDir, { recursive: true });

    header(`Forge: ${args.task}`);
    info(`Engines: ${available.join(', ')}`);
    info(`Fitness: ${args.test}`);

    if (args.dryRun) {
      warn('Dry-run mode — no engines will be dispatched');
    }

    const engines = args.engines?.split(',').map((s) => s.trim());

    const finalizeOnScoreRaw = args.finalizeOnScore?.trim();
    const finalizeOnScore = finalizeOnScoreRaw ? Number(finalizeOnScoreRaw) : undefined;
    if (finalizeOnScoreRaw && (!Number.isFinite(finalizeOnScore!) || finalizeOnScore! < 0 || finalizeOnScore! > 100)) {
      fail(`--finalize-on-score must be a number in [0,100]; got "${finalizeOnScoreRaw}"`);
      process.exit(1);
    }
    // Caller-driven finalize: pass an onResult predicate that asks runForge
    // to stop as soon as any engine PASSES at or above the threshold. We only
    // finalize on pass=true to avoid prematurely cutting off engines that
    // might have produced a passing patch from the still-running set.
    const onResult = finalizeOnScore !== undefined
      ? (_engineId: string, result: EngineResult): 'finalize' | 'continue' => {
          if (result.pass && result.score >= finalizeOnScore) {
            info(`Finalize threshold met: score ${result.score} ≥ ${finalizeOnScore} — aborting remaining engines.`);
            return 'finalize';
          }
          return 'continue';
        }
      : undefined;

    const manifest = await runForge(
      {
        task: args.task,
        fitnessCmd: args.test,
        cwd: args.cwd,
        forgeDir,
        timeout: args.timeout ? parseInt(args.timeout, 10) : undefined,
        starter: args.starter,
        engines,
        dryRun: args.dryRun,
        onResult,
      },
      registry,
      adapter,
      (event: ForgeEvent) => {
        switch (event.type) {
          case 'baseline:start':
            info('Running baseline preflight...');
            break;
          case 'baseline:done':
            if (event.data?.passes) {
              warn('Baseline passes — fitness test may be non-discriminating');
            }
            break;
          case 'stage1:dispatch':
            info(`Stage 1: dispatching ${bold(event.engineId ?? 'starter')}...`);
            break;
          case 'stage1:accepted':
            success(`Stage 1 auto-accepted: ${event.engineId} (score: ${event.data?.score})`);
            break;
          case 'stage2:dispatch':
            info(`Stage 2: dispatching ${bold(event.engineId ?? 'challenger')}...`);
            break;
          case 'engine:failed':
            warn(`Engine failed: ${bold(String(event.engineId ?? event.data?.engineId ?? 'unknown'))} (${event.data?.phase ?? 'dispatch'})`);
            break;
          case 'forge:engine-skipped' as any: {
            const skippedId = String((event as any).data?.engineId ?? 'unknown');
            const reason = String((event as any).data?.reason ?? 'unavailable');
            warn(`Engine skipped: ${bold(skippedId)} — ${reason}`);
            break;
          }
          case 'winner:determined':
            if (event.data?.winner) {
              success(`Winner: ${bold(String(event.data.winner))} (score: ${event.data.bestScore})`);
              if (event.data.closeCall) {
                warn('Close call — triggering synthesis');
              }
            } else {
              fail('No engine passed the fitness test');
            }
            break;
          case 'synthesis:done':
            if (event.data?.wins) {
              success(`Synthesis improved score: ${event.data.originalScore} → ${event.data.score}`);
            }
            break;
          case 'forge:done':
            break;
        }
      },
    );

    // Summary
    console.log('');
    header('Results');

    const rows = (Object.entries(manifest.results) as [string, EngineResult][]).map(([id, r]) => [
      id === manifest.winner ? green(`${icons().winner} ${id}`) : id,
      r.pass ? green('PASS') : red('FAIL'),
      String(r.score),
      String(r.diffLines),
      String(r.filesChanged),
      `${r.durationSec}s`,
    ]);

    table(['Engine', 'Status', 'Score', 'Diff', 'Files', 'Time'], rows);

    console.log('');
    if (manifest.winner) {
      success(`Winner: ${bold(manifest.winner)}`);
      info(`Patch: ${manifest.patches[manifest.winner]}`);
    } else {
      fail('No winner — all engines failed');
    }
    info(`Manifest: ${forgeDir}/manifest.json`);
  },
});
