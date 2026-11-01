import { defineCommand } from 'citty';

import { EngineRegistry, ensureAgonHome, loadConfig, createRunDir, writeRunStatus, printRunSummary } from '@kernlang/agon-core';

import { resolveBuiltinEnginesDir } from '../lib/engines-dir.js';

import { presentSynthesisResult, synthesisRunStatus } from '@kernlang/agon-mod-synthesis';

import { createCliAdapter } from '@kernlang/agon-adapter-cli';

import { runSynthesisModus, synthesisRoutingAdvice } from '@kernlang/agon-forge';

import { header, info, table, bold, green, dim, warn, fail } from '../blocks/output-format.js';

import { filterDefaultOrchestrationEngines } from '../handlers/engine-filter.js';

export const synthesisCommand: any = defineCommand({
  meta: {
    name: 'synthesis',
    description: 'Competitive cross-pollination - engines draft, swap, improve, judge picks the best evolved artifact',
  },
  args: {
    prompt: {
      type: 'positional',
      description: 'Task or prompt to synthesize',
      required: true,
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
    swaps: {
      type: 'string',
      alias: 's',
      description: 'Number of swap rounds (0 = draft-only)',
      default: '1',
    },
    judge: {
      type: 'string',
      alias: 'j',
      description: 'Judge engine ID (default: first engine)',
    },
    timeout: {
      type: 'string',
      description: 'Timeout per engine in seconds',
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
      ? args.engines.split(',').map((s: string) => s.trim())
      : filterDefaultOrchestrationEngines(registry.activeIds(config as any));
    const removedSyn = registry.partitionRoster(args.engines ? args.engines.split(',') : null, config as any).removed;
    if (removedSyn.length > 0) {
      fail(`Removed engine(s) cannot run: ${removedSyn.join(', ')}. Restore with 'agon engine add <id>'.`);
      process.exit(1);
    }

    if (args.quiet) process.env.AGON_QUIET = '1';
    const startedAt = new Date().toISOString();
    const { path: outputDir } = createRunDir({
      mode: 'synthesis',
      label: args.label,
    });

    const quiet = process.env.AGON_QUIET === '1';
    if (!quiet) {
      header(`Synthesis: ${args.prompt}`);
      info(`Engines: ${available.join(', ')}`);
      info(`Swap rounds: ${args.swaps}`);
      const routingAdvice = synthesisRoutingAdvice(args.prompt);
      if (routingAdvice) warn(routingAdvice);
      console.log('');
    }

    const result = await runSynthesisModus({
      prompt: args.prompt,
      engines: available,
      registry,
      adapter,
      swaps: parseInt(args.swaps, 10),
      judge: args.judge,
      timeout: parseInt(args.timeout, 10),
      outputDir,
    });

    const status = synthesisRunStatus(result, {
      engines: available, label: args.label, startedAt, endedAt: new Date().toISOString(),
    });
    writeRunStatus(outputDir, status);

    if (quiet) {
      printRunSummary(status);
      return;
    }

    presentSynthesisResult(result, outputDir, { log: text => console.log(text), header, info, table, bold, green, dim });
    printRunSummary(status);
  },
});
