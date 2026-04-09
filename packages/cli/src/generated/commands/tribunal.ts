// @kern-source: tribunal:1
import { defineCommand } from 'citty';

// @kern-source: tribunal:2
import { join, dirname } from 'node:path';

// @kern-source: tribunal:3
import { fileURLToPath } from 'node:url';

// @kern-source: tribunal:4
import { mkdirSync } from 'node:fs';

// @kern-source: tribunal:5
import { EngineRegistry, ensureAgonHome, RUNS_DIR } from '@agon/core';

// @kern-source: tribunal:6
import { createCliAdapter } from '@agon/adapter-cli';

// @kern-source: tribunal:7
import { runTribunal } from '@agon/forge';

// @kern-source: tribunal:8
import { header, success, fail, info, bold, cyan, dim, green, yellow } from '../blocks/output-format.js';

// @kern-source: tribunal:10
export const tribunalCommand: ReturnType<typeof defineCommand> = defineCommand({
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
    timeout: {
      type: 'string',
      description: 'Timeout per engine in seconds',
      default: '120',
    },
  },
  async run({ args }) {
    ensureAgonHome();

    const registry = new EngineRegistry();
    registry.load(join(dirname(fileURLToPath(import.meta.url)), '../../../../engines'));

    const adapter = createCliAdapter(registry);
    const available = args.engines
      ? args.engines.split(',').map((s: string) => s.trim())
      : registry.availableIds();

    if (available.length < 2) {
      fail('Tribunal needs at least 2 engines. Only found: ' + (available.join(', ') || 'none'));
      process.exit(1);
    }

    // Cap at 4 engines for readability
    const engines = available.slice(0, 4);
    const rounds = parseInt(args.rounds, 10);

    const outputDir = join(RUNS_DIR, `tribunal-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });

    header(`Tribunal: ${args.question}`);
    info(`Engines: ${engines.join(', ')}`);
    info(`Rounds: ${rounds}`);
    console.log('');

    const result = await runTribunal({
      question: args.question,
      engines,
      rounds,
      registry,
      adapter,
      timeout: parseInt(args.timeout, 10),
      outputDir,
      onEvent: (event: any) => {
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
}) as ReturnType<typeof defineCommand>;

