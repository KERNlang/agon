// @kern-source: brainstorm:1
import { defineCommand } from 'citty';

// @kern-source: brainstorm:2
import { join, dirname } from 'node:path';

// @kern-source: brainstorm:3
import { fileURLToPath } from 'node:url';

// @kern-source: brainstorm:4
import { mkdirSync } from 'node:fs';

// @kern-source: brainstorm:5
import { EngineRegistry, ensureAgonHome, RUNS_DIR } from '@agon/core';

// @kern-source: brainstorm:6
import { createCliAdapter } from '@agon/adapter-cli';

// @kern-source: brainstorm:7
import { runBrainstorm } from '@agon/forge';

// @kern-source: brainstorm:8
import { header, success, info, table, bold, cyan, green } from '../blocks/output-format.js';

// @kern-source: brainstorm:9
import { icons } from '../signals/icons.js';

// @kern-source: brainstorm:11
export const brainstormCommand: any = defineCommand({
  meta: {
    name: 'brainstorm',
    description: 'Confidence-bidding brainstorm — engines bid, highest confidence answers',
  },
  args: {
    question: {
      type: 'positional',
      description: 'Question to brainstorm',
      required: true,
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
    timeout: {
      type: 'string',
      description: 'Timeout in seconds',
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

    const outputDir = join(RUNS_DIR, `brainstorm-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });

    header(`Brainstorm: ${args.question}`);
    info(`Engines: ${available.join(', ')}`);

    const result = await runBrainstorm({
      question: args.question,
      engines: available,
      registry,
      adapter,
      timeout: parseInt(args.timeout, 10),
      outputDir,
    });

    console.log('');
    header('Bids');
    const rows = result.bids.map((b: any) => [
      b.engineId === result.winner ? green(`${icons().winner} ${b.engineId}`) : b.engineId,
      String(b.confidence),
      b.reasoning.slice(0, 60),
    ]);
    table(['Engine', 'Confidence', 'Reasoning'], rows);

    console.log('');
    header(`Response from ${bold(result.winner)}`);
    console.log(result.response);
  },
});

