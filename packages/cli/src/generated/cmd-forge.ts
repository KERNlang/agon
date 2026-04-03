import { defineCommand } from 'citty';

import { join, dirname } from 'node:path';

import { fileURLToPath } from 'node:url';

import { mkdirSync } from 'node:fs';

import { EngineRegistry, ensureAgonHome, loadConfig, RUNS_DIR } from '@agon/core';

import { createCliAdapter } from '@agon/adapter-cli';

import { runForge } from '@agon/forge';

import { header, success, fail, warn, info, table, green, red, yellow, bold, cyan } from '../output.js';

export const forgeCommand: any = defineCommand({
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
  },
  async run({ args }) {
    ensureAgonHome();
    const config = loadConfig(args.cwd);

    const registry = new EngineRegistry();
    registry.load(join(dirname(fileURLToPath(import.meta.url)), '../../../../engines'));

    const adapter = createCliAdapter(registry);

    const available = registry.availableIds();
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

    const engines = args.engines?.split(',').map((s: string) => s.trim());

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
      },
      registry,
      adapter,
      (event: any) => {
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

    const rows = Object.entries(manifest.results).map(([id, r]: [string, any]) => [
      id === manifest.winner ? green(`★ ${id}`) : id,
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

