import { defineCommand } from 'citty';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { EngineRegistry, ensureAgonHome, loadConfig, RUNS_DIR } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { runCampfire } from '@agon/forge';
import { header, info, bold, dim } from '../output.js';

export const campfireCommand = defineCommand({
  meta: {
    name: 'campfire',
    description: 'Open discussion — all engines think together, no competition',
  },
  args: {
    topic: {
      type: 'positional',
      description: 'Topic to discuss',
      required: true,
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
    strategy: {
      type: 'string',
      alias: 's',
      description: 'Strategy: lead-first or all-respond',
      default: 'lead-first',
    },
    lead: {
      type: 'string',
      alias: 'l',
      description: 'Lead engine ID (for lead-first strategy)',
    },
    timeout: {
      type: 'string',
      description: 'Timeout in seconds',
      default: '120',
    },
  },
  async run({ args }) {
    ensureAgonHome();
    const config = loadConfig(process.cwd());

    const registry = new EngineRegistry();
    registry.load(join(dirname(fileURLToPath(import.meta.url)), '../../../engines'));

    const adapter = createCliAdapter(registry);
    const available = args.engines
      ? args.engines.split(',').map((s) => s.trim())
      : registry.activeIds(config);

    const outputDir = join(RUNS_DIR, `campfire-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });

    const strategy = args.strategy === 'all-respond' ? 'all-respond' : 'lead-first';

    header(`Campfire: ${args.topic}`);
    info(`Engines: ${available.join(', ')}`);
    info(`Strategy: ${strategy}`);
    console.log('');

    const result = await runCampfire({
      topic: args.topic,
      engines: available,
      registry,
      adapter,
      strategy,
      leadEngine: args.lead,
      timeout: parseInt(args.timeout, 10),
      outputDir,
    });

    for (const round of result.rounds) {
      console.log('');
      header(`${bold(round.engineId)}`);
      console.log(round.content);
    }

    console.log('');
    info(dim(`Full output saved: ${outputDir}`));
  },
});
