import { defineCommand } from 'citty';
import {
  EngineRegistry, ensureAgonHome, loadConfig,
  createRunDir, writeRunStatus, printRunSummary,
} from '@agon/core';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import type { BrainstormBid } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { runBrainstorm } from '@agon/forge';
import { header, info, table, bold, green } from '../output.js';
import { icons } from '../icons.js';
import { filterDefaultOrchestrationEngines } from '../generated/handlers/engine-filter.js';

export const brainstormCommand = defineCommand({
  meta: {
    name: 'brainstorm',
    description: 'Confidence-bidding brainstorm — engines bid, highest-quality answer wins (quality = substance + calibrated confidence)',
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
    label: {
      type: 'string',
      description: 'Human-readable suffix baked into the run dir name (orchestrators: distinguish parallel runs without grep).',
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
      mode: 'brainstorm',
      label: args.label,
    });

    const quiet = process.env.AGON_QUIET === '1';
    if (!quiet) {
      header(`Brainstorm: ${args.question}`);
      info(`Engines: ${available.join(', ')}`);
    }

    const result = await runBrainstorm({
      question: args.question,
      engines: available,
      registry,
      adapter,
      timeout: parseInt(args.timeout, 10),
      outputDir,
    });

    // Authoritative outcome record. A bid entry counts as 'ok' (engine
    // participated with a confidence); missing engines collapse to 'error'.
    const bidByEngine = new Map<string, BrainstormBid>();
    for (const b of result.bids) bidByEngine.set(b.engineId, b);
    const engineStatuses = available.map((id: string) => {
      const bid = bidByEngine.get(id);
      return bid
        ? { id, status: 'ok' as const, detail: `confidence=${bid.confidence}` }
        : { id, status: 'error' as const, detail: 'no bid returned' };
    });
    const okCount = engineStatuses.filter((e) => e.status === 'ok').length;
    const status = {
      mode: 'brainstorm',
      label: args.label,
      startedAt,
      endedAt: new Date().toISOString(),
      engines: engineStatuses,
      summary: `${okCount}/${available.length} bid; winner=${result.winner}`,
      ok: okCount === available.length,
    };
    writeRunStatus(outputDir, status);

    if (quiet) {
      printRunSummary(status);
      return;
    }

    console.log('');
    header('Bids');
    // Quality is the actual ranking key (answer substance + calibrated
    // confidence); the winner is the top Quality, not the top Confidence.
    // Show both so the winner is legible.
    const rows = result.bids.map((b: BrainstormBid) => [
      b.engineId === result.winner ? green(`${icons().winner} ${b.engineId}`) : b.engineId,
      b.score != null ? String(Math.round(b.score)) : '—',
      String(b.confidence),
      b.reasoning.slice(0, 60),
    ]);
    table(['Engine', 'Quality', 'Confidence', 'Reasoning'], rows);

    console.log('');
    header(`Response from ${bold(result.winner)}`);
    console.log(result.response);
    printRunSummary(status);
  },
});
