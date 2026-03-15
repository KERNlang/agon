import { defineCommand } from 'citty';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineRegistry, getEngineRating } from '@agon/core';
import { createCliAdapter } from '@agon/adapter-cli';
import { header, success, fail, info, table, bold, green, red, dim } from '../output.js';

export const engineCommand = defineCommand({
  meta: {
    name: 'engine',
    description: 'Manage AI engines',
  },
  args: {
    action: {
      type: 'positional',
      description: 'Action: list | info <id>',
      required: true,
    },
    id: {
      type: 'positional',
      description: 'Engine ID (for info)',
    },
  },
  async run({ args }) {
    const registry = new EngineRegistry();
    registry.load(join(dirname(fileURLToPath(import.meta.url)), '../../../../engines'));

    const adapter = createCliAdapter(registry);

    switch (args.action) {
      case 'list': {
        header('Engines');
        const engines = registry.list();
        const rows: string[][] = [];

        for (const engine of engines) {
          const available = registry.isAvailable(engine);
          const version = available
            ? (await adapter.getVersion(engine)) ?? dim('unknown')
            : '';

          rows.push([
            available ? green(engine.id) : red(engine.id),
            engine.displayName,
            available ? green('installed') : red('missing'),
            version,
            engine.tier,
          ]);
        }

        table(['ID', 'Name', 'Status', 'Version', 'Tier'], rows);
        break;
      }

      case 'info': {
        if (!args.id) {
          fail('Usage: agon engine info <id>');
          process.exit(1);
        }

        try {
          const engine = registry.get(args.id);
          const available = registry.isAvailable(engine);
          const rating = getEngineRating(args.id);

          header(`Engine: ${engine.displayName}`);
          console.log(`  ID:         ${bold(engine.id)}`);
          console.log(`  Binary:     ${engine.binary}`);
          console.log(`  Status:     ${available ? green('installed') : red('not found')}`);
          const modes = [engine.exec ? 'exec' : '', engine.review ? 'review' : ''].filter(Boolean);
          console.log(`  Modes:      ${modes.join(', ') || 'none'}`);
          console.log(`  Timeout:    ${engine.timeout}s`);
          console.log(`  Tier:       ${engine.tier}`);
          console.log(`  ELO:        ${rating.rating} (W:${rating.wins} L:${rating.losses})`);

          if (!available && engine.installHint) {
            console.log('');
            info(`Install: ${engine.installHint}`);
          }
        } catch {
          fail(`Engine "${args.id}" not found`);
          process.exit(1);
        }
        break;
      }

      default:
        fail(`Unknown action: ${args.action}`);
        info('Available: list, info');
        process.exit(1);
    }
  },
});
