import { defineCommand } from 'citty';

import { loadConfig, configSet, DEFAULT_CONFIG, ensureAgonHome } from '@agon/core';

import type { AgonConfig } from '@agon/core';

import { header, info, table, bold, success, fail } from '../output.js';

export const configCommand: any = defineCommand({
  meta: {
    name: 'config',
    description: 'View and modify Agon configuration',
  },
  args: {
    action: {
      type: 'positional',
      description: 'Action: list | get <key> | set <key> <value>',
      required: true,
    },
    key: {
      type: 'string',
      description: 'Config key',
    },
    value: {
      type: 'string',
      description: 'Config value (for set)',
    },
  },
  run({ args }) {
    ensureAgonHome();

    switch (args.action) {
      case 'list': {
        header('Configuration');
        const config = loadConfig();
        const rows = Object.entries(config).map(([key, value]) => {
          const defaultVal = (DEFAULT_CONFIG as any)[key as keyof typeof DEFAULT_CONFIG];
          const isDefault = JSON.stringify(value) === JSON.stringify(defaultVal);
          return [
            key,
            String(Array.isArray(value) ? value.join(',') : value),
            isDefault ? 'default' : 'custom',
          ];
        });
        table(['Key', 'Value', 'Source'], rows);
        break;
      }

      case 'get': {
        if (!args.key) {
          fail('Usage: agon config get <key>');
          process.exit(1);
        }
        const config = loadConfig();
        const key = args.key as keyof AgonConfig;
        if (key in config) {
          const value = (config as any)[key as keyof typeof config];
          console.log(Array.isArray(value) ? value.join(',') : String(value));
        } else {
          fail(`Unknown key: ${args.key}`);
          process.exit(1);
        }
        break;
      }

      case 'set': {
        if (!args.key || args.value === undefined) {
          fail('Usage: agon config set <key> <value>');
          process.exit(1);
        }

        const key = args.key as keyof AgonConfig;
        if (!(key in DEFAULT_CONFIG)) {
          fail(`Unknown key: ${args.key}`);
          process.exit(1);
        }

        // Parse value based on type
        const defaultVal = (DEFAULT_CONFIG as any)[key];
        let parsed: unknown;

        if (typeof defaultVal === 'boolean') {
          parsed = args.value === 'true';
        } else if (typeof defaultVal === 'number') {
          parsed = parseInt(args.value, 10);
          if (isNaN(parsed as number)) {
            fail(`Invalid number: ${args.value}`);
            process.exit(1);
          }
        } else if (Array.isArray(defaultVal)) {
          parsed = args.value.split(',').map((s: string) => s.trim());
        } else {
          parsed = args.value;
        }

        configSet(key, parsed as AgonConfig[typeof key]);
        success(`Set ${bold(args.key)} = ${args.value}`);
        break;
      }

      default:
        fail(`Unknown action: ${args.action}`);
        info('Available: list, get, set');
        process.exit(1);
    }
  },
});

