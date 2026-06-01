import { defineCommand } from 'citty';
import {
  EngineRegistry, ensureAgonHome, loadConfig,
  createRunDir, writeRunStatus, printRunSummary,
} from '@kernlang/agon-core';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import { createCliAdapter } from '@kernlang/agon-adapter-cli';
import { runCampfire } from '@kernlang/agon-forge';
import { header, info, bold, dim } from '../output.js';
import { filterDefaultOrchestrationEngines } from '../generated/handlers/engine-filter.js';

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
    label: {
      type: 'string',
      description: 'Human-readable suffix baked into the run dir name.',
    },
    quiet: {
      type: 'boolean',
      description: 'Suppress streaming output; stdout becomes only the run dir path + final summary.',
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

    if (args.quiet) process.env.AGON_QUIET = '1';
    const startedAt = new Date().toISOString();
    const { path: outputDir } = createRunDir({
      mode: 'campfire',
      label: args.label,
    });

    const strategy = args.strategy === 'all-respond' ? 'all-respond' : 'lead-first';

    const quiet = process.env.AGON_QUIET === '1';
    if (!quiet) {
      header(`Campfire: ${args.topic}`);
      info(`Engines: ${available.join(', ')}`);
      info(`Strategy: ${strategy}`);
      console.log('');
    }

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

    // An engine is 'ok' if it contributed at least one non-empty round.
    const roundsByEngine = new Map<string, number>();
    for (const round of result.rounds) {
      if (round.content && round.content.trim()) {
        roundsByEngine.set(round.engineId, (roundsByEngine.get(round.engineId) ?? 0) + 1);
      }
    }
    const engineStatuses = available.map((id: string) => {
      const count = roundsByEngine.get(id) ?? 0;
      return count > 0
        ? { id, status: 'ok' as const, detail: `${count} round(s)` }
        : { id, status: 'error' as const, detail: 'no output' };
    });
    const okCount = engineStatuses.filter((e) => e.status === 'ok').length;
    const status = {
      mode: 'campfire',
      label: args.label,
      startedAt,
      endedAt: new Date().toISOString(),
      engines: engineStatuses,
      summary: `${okCount}/${available.length} engines contributed`,
      ok: okCount === available.length,
    };
    writeRunStatus(outputDir, status);

    if (quiet) {
      printRunSummary(status);
      return;
    }

    for (const round of result.rounds) {
      console.log('');
      header(`${bold(round.engineId)}`);
      console.log(round.content);
    }

    console.log('');
    info(dim(`Full output saved: ${outputDir}`));
    printRunSummary(status);
  },
});
