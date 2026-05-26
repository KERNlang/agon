// @kern-source: brainstorm:1
import { defineCommand } from 'citty';

// @kern-source: brainstorm:2
import { join } from 'node:path';

// @kern-source: brainstorm:3
import { mkdirSync } from 'node:fs';

// @kern-source: brainstorm:4
import { EngineRegistry, ensureAgonHome, loadConfig, RUNS_DIR } from '@agon/core';

// @kern-source: brainstorm:5
import { resolveBuiltinEnginesDir } from '../lib/engines-dir.js';

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
    const config = loadConfig(process.cwd());

    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());

    const adapter = createCliAdapter(registry);
    const available = args.engines
      ? args.engines.split(',').map((s: string) => registry.resolveId(s.trim())).filter(Boolean)
      : registry.activeIds(config as any);

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
    // Build a map: engineId → group info so the bids table can show
    // "(N engines agree)" tags next to engines that paraphrased others.
    const groupTagByEngine = new Map<string, string>();
    if (result.groups && result.groups.length > 0 && result.groups.length < result.bids.length) {
      for (const g of result.groups) {
        if (g.members.length < 2) continue;
        const tag = `(${g.members.length} engines agree)`;
        for (const m of g.members) groupTagByEngine.set(m, tag);
      }
    }
    const rows = result.bids.map((b: any) => {
      const tag = groupTagByEngine.get(b.engineId);
      const reasoningCol = tag
        ? `${cyan(tag)} ${b.reasoning.slice(0, 60 - tag.length - 1)}`
        : b.reasoning.slice(0, 60);
      return [
        b.engineId === result.winner ? green(`${icons().winner} ${b.engineId}`) : b.engineId,
        String(b.confidence),
        reasoningCol,
      ];
    });
    table(['Engine', 'Confidence', 'Reasoning'], rows);

    console.log('');
    header(`Response from ${bold(result.winner)}`);
    console.log(result.response);
  },
});

