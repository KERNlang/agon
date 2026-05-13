import { defineCommand } from 'citty';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { EngineRegistry, ensureAgonHome, loadConfig, RUNS_DIR } from '@agon/core';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import type { ForgeEvent } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { isTribunalMode, runTribunal } from '@agon/forge';
import type { TribunalMode } from '@agon/forge';
import { header, success, fail, info, bold, cyan, dim, green, yellow } from '../output.js';
import { filterDefaultOrchestrationEngines } from '../generated/handlers/engine-filter.js';

export const tribunalCommand = defineCommand({
  meta: {
    name: 'tribunal',
    description: 'Adversarial debate — engines argue different sides of a question',
  },
  args: {
    question: {
      type: 'positional',
      description: 'Question to debate',
      required: true,
    },
    rounds: {
      type: 'string',
      alias: 'r',
      description: 'Number of debate rounds',
      default: '2',
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
    mode: {
      type: 'string',
      alias: 'm',
      description: 'Tribunal mode (adversarial, synthesis, steelman, socratic, red-team, postmortem)',
      default: 'adversarial',
    },
    timeout: {
      type: 'string',
      description: 'Timeout per engine in seconds',
      default: '120',
    },
  },
  async run({ args }) {
    ensureAgonHome();
    const config = loadConfig(process.cwd());

    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());

    const adapter = createCliAdapter(registry);
    const available = args.engines
      ? args.engines.split(',').map((s) => s.trim())
      : filterDefaultOrchestrationEngines(registry.activeIds(config));

    if (available.length < 2) {
      fail('Tribunal needs at least 2 engines. Only found: ' + (available.join(', ') || 'none'));
      process.exit(1);
    }

    // Cap at 4 engines for readability
    const engines = available.slice(0, 4);
    const rounds = parseInt(args.rounds, 10);
    const mode = String(args.mode ?? 'adversarial');
    if (!isTribunalMode(mode)) {
      fail(`Invalid tribunal mode: ${mode}`);
      info('Valid modes: adversarial, synthesis, steelman, socratic, red-team, postmortem');
      process.exit(1);
    }

    const outputDir = join(RUNS_DIR, `tribunal-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });

    header(`Tribunal: ${args.question}`);
    info(`Engines: ${engines.join(', ')}`);
    info(`Rounds: ${rounds}`);
    info(`Mode: ${mode}`);
    console.log('');

    const result = await runTribunal({
      question: args.question,
      engines,
      rounds,
      mode: mode as TribunalMode,
      registry,
      adapter,
      timeout: parseInt(args.timeout, 10),
      outputDir,
      onEvent: (event: ForgeEvent) => {
        if (event.data?.round) {
          const engineId = event.engineId;
          const position = event.data?.position;
          if (engineId && position) {
            info(`Round ${event.data.round}: ${bold(String(engineId))} (${String(position)})...`);
          }
        }
      },
    });

    // Display results
    for (const round of result.rounds) {
      console.log('');
      header(`Round ${round.round}`);
      for (const pos of round.positions) {
        console.log('');
        console.log(`  ${bold(pos.engineId)} ${dim(`(${pos.position})`)}`);
        // Show first 500 chars of argument
        const arg = pos.arguments[0] ?? '';
        const lines = arg.slice(0, 500).split('\n');
        for (const line of lines) {
          console.log(`  ${line}`);
        }
        if (arg.length > 500) console.log(`  ${dim('...(truncated)')}`);
      }
    }

    // Summary
    console.log('');
    header('Verdict');
    console.log('');
    console.log(result.summary);
    console.log('');
    info(dim(`Full debate saved: ${outputDir}`));
  },
});
