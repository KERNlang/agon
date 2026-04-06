import { defineCommand } from 'citty';
import { writeFileSync, mkdirSync, unlinkSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { header, success, fail, info, table, bold, green, red, dim } from '../output.js';

function enginesDir() {
  return join(homedir(), '.agon', 'engines');
}

export const providerCommand = defineCommand({
  meta: {
    name: 'provider',
    description: 'Add, remove, or list API providers',
  },
  args: {
    action: {
      type: 'positional',
      description: 'Action: add | remove | list',
      required: true,
    },
  },
  async run({ args }) {
    // Parse action and remaining args — slice relative to 'provider' position for npx/tsx compat
    let action = args.action;
    const providerIdx = process.argv.indexOf('provider');
    const extra = providerIdx >= 0 ? process.argv.slice(providerIdx + 2) : [];

    switch (action) {
      case 'add': {
        // agon provider add <id> <baseUrl> <apiKeyEnv> <model>
        if (extra.length < 4) {
          fail('Usage: agon provider add <id> <baseUrl> <API_KEY_ENV> <model>');
          console.log('');
          info('Examples:');
          console.log(`  agon provider add minimax https://api.minimax.chat MINIMAX_API_KEY MiniMax-M1`);
          console.log(`  agon provider add groq https://api.groq.com/openai GROQ_API_KEY llama-3.3-70b-versatile`);
          console.log(`  agon provider add deepseek https://api.deepseek.com DEEPSEEK_API_KEY deepseek-chat`);
          console.log(`  agon provider add together https://api.together.xyz TOGETHER_API_KEY meta-llama/Llama-3.3-70B-Instruct-Turbo`);
          console.log(`  agon provider add mistral https://api.mistral.ai MISTRAL_API_KEY mistral-large-latest`);
          process.exit(1);
        }

        const [id, baseUrl, apiKeyEnv, ...modelParts] = extra;
        if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
          fail('Provider ID must contain only letters, numbers, hyphens, and underscores');
          process.exit(1);
        }
        const model = modelParts.join(' ');

        const def = {
          schemaVersion: 3,
          id,
          displayName: id.charAt(0).toUpperCase() + id.slice(1),
          isLocal: false,
          tier: 'user',
          timeout: 180,
          exec: { args: [] },
          review: { args: [] },
          api: { baseUrl, apiKeyEnv, model, maxTokens: 4096 },
        };

        const dir = enginesDir();
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${id}.json`), JSON.stringify(def, null, 2) + '\n');

        const hasKey = !!process.env[apiKeyEnv];
        success(`Provider added: ${bold(id)}`);
        console.log(`  Model:  ${model}`);
        console.log(`  API:    ${baseUrl}`);
        console.log(`  Key:    ${apiKeyEnv} ${hasKey ? green('(set)') : red('(not set)')}`);
        if (!hasKey) {
          console.log('');
          info(`Set your API key: export ${apiKeyEnv}=your_key`);
        }
        break;
      }

      case 'remove': {
        const id = extra[0];
        if (!id) {
          fail('Usage: agon provider remove <id>');
          process.exit(1);
        }
        if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
          fail('Provider ID must contain only letters, numbers, hyphens, and underscores');
          process.exit(1);
        }
        const path = join(enginesDir(), `${id}.json`);
        if (!existsSync(path)) {
          fail(`Provider "${id}" not found in ~/.agon/engines/`);
          process.exit(1);
        }
        unlinkSync(path);
        success(`Removed provider: ${id}`);
        break;
      }

      case 'list':
      default: {
        const dir = enginesDir();
        header('Custom Providers');

        if (!existsSync(dir)) {
          info('No custom providers yet.');
          console.log('');
          info(`Add one: agon provider add <id> <baseUrl> <API_KEY_ENV> <model>`);
          return;
        }

        const files = readdirSync(dir).filter((f: string) => f.endsWith('.json'));
        if (files.length === 0) {
          info('No custom providers yet.');
          console.log('');
          info(`Add one: agon provider add <id> <baseUrl> <API_KEY_ENV> <model>`);
          return;
        }

        const rows: string[][] = [];
        for (const file of files) {
          try {
            const def = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
            if (def.api) {
              const hasKey = !!process.env[def.api.apiKeyEnv];
              rows.push([
                hasKey ? green(def.id) : red(def.id),
                def.api.model,
                dim(def.api.baseUrl),
                hasKey ? green('ready') : red(`needs ${def.api.apiKeyEnv}`),
              ]);
            }
          } catch (_e) { /* skip malformed */ }
        }

        if (rows.length > 0) {
          table(['ID', 'Model', 'API', 'Status'], rows);
        }
        break;
      }
    }
  },
});
