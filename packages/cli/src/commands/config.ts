import { defineCommand } from 'citty';
import type { AgonConfig } from '@kernlang/agon-core';
import { loadConfig, configSet, DEFAULT_CONFIG, ensureAgonHome, OPTIONAL_CONFIG_KEYS, parseConfigSetValue } from '@kernlang/agon-core';
import { header, info, table, bold, success, fail } from '../blocks/output-format.js';

export const configCommand = defineCommand({
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
          const defaultVal = DEFAULT_CONFIG[key as keyof typeof DEFAULT_CONFIG];
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
        if (key in config || Object.hasOwn(OPTIONAL_CONFIG_KEYS, key)) {
          const value = config[key as keyof typeof config];
          console.log(value === undefined ? '' : Array.isArray(value) ? value.join(',') : String(value));
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

        const parsed = parseConfigSetValue(args.key, args.value);
        if (!parsed.ok) {
          fail(parsed.error);
          process.exit(1);
        }

        configSet(args.key as keyof AgonConfig, parsed.value as never);
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
