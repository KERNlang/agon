import { defineCommand } from 'citty';
import { EngineRegistry, ensureAgonHome, loadConfig } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { resolveBuiltinEnginesDir } from '../generated/lib/engines-dir.js';
import { resolveReviewTarget, runReviewCore, selectReviewEngine } from '../generated/handlers/review.js';
import { fail, header, info, warn, bold } from '../output.js';

export const reviewCommand = defineCommand({
  meta: {
    name: 'review',
    description: 'Run a non-interactive AI review of a diff target',
  },
  args: {
    target: {
      type: 'positional',
      description: 'Review target: uncommitted, branch:NAME, or commit:SHA',
      required: false,
      default: 'uncommitted',
    },
    engine: {
      type: 'string',
      description: 'Specific engine for review',
    },
    engines: {
      type: 'string',
      alias: 'e',
      description: 'Comma-separated engine list',
    },
  },
  async run({ args }) {
    ensureAgonHome();
    const cwd = process.cwd();
    const config = loadConfig(cwd);

    const registry = new EngineRegistry();
    registry.load(resolveBuiltinEnginesDir());
    const adapter = createCliAdapter(registry);

    const ctx = {
      config,
      registry,
      adapter,
      activeEngines: () => registry.activeIds(config),
    } as any;

    let target;
    try {
      target = resolveReviewTarget(args.target, cwd);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (!target.diff.trim()) {
      warn(`No diff found for ${target.label}.`);
      return;
    }

    const requested = args.engines
      ? args.engines.split(',').map((s) => s.trim()).filter(Boolean)
      : [selectReviewEngine(args.engine, ctx)];

    header(`Review: ${target.label}`);
    info(`Engines: ${requested.join(', ')}`);

    for (const engineId of requested) {
      console.log('');
      header(`Reviewer: ${bold(engineId)}`);
      try {
        const result = await runReviewCore(target.diff, target.label, engineId, ctx);
        console.log(result.response);
        if (result.parseFailed) {
          warn(`${engineId}: review parser did not find the sentinel JSON block.`);
        } else if (result.blocking) {
          warn(`${engineId}: blocking findings reported.`);
        }
      } catch (err) {
        fail(`${engineId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  },
});
