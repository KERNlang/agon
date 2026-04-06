import { defineCommand } from 'citty';
import { writeFileSync, mkdirSync, unlinkSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { header, success, fail, info, table, bold, green, red, dim, yellow } from '../output.js';
import { fetchModelsRegistry, buildModelEntries, searchModels, modelEntryToEngineDef } from '@agon/core';
import type { ModelEntry } from '@agon/core';

function enginesDir() {
  return join(homedir(), '.agon', 'engines');
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function printResults(results: ModelEntry[], offset: number, limit: number) {
  const page = results.slice(offset, offset + limit);
  let currentProvider = '';
  for (let i = 0; i < page.length; i++) {
    const entry = page[i];
    if (entry.providerName !== currentProvider) {
      currentProvider = entry.providerName;
      console.log('');
      console.log(bold(currentProvider));
    }
    const idx = offset + i + 1;
    const cost = entry.costInput != null ? dim(` $${entry.costInput}/$${entry.costOutput} per 1M tok`) : '';
    const ctx = entry.contextWindow ? dim(` ${Math.round(entry.contextWindow / 1024)}k ctx`) : '';
    console.log(`  ${dim(String(idx).padStart(4))}  ${entry.modelName}${ctx}${cost}`);
  }
}

async function interactiveAdd() {
  header('Add Provider — models.dev registry');
  info('Fetching model registry...');

  let registry;
  try {
    registry = await fetchModelsRegistry();
  } catch (err) {
    fail(`Could not fetch models.dev: ${err instanceof Error ? err.message : String(err)}`);
    console.log('');
    info('Fallback: agon provider add <id> <baseUrl> <API_KEY_ENV> <model>');
    process.exit(1);
  }

  const allEntries = buildModelEntries(registry);
  info(`${allEntries.length} models from ${new Set(allEntries.map(e => e.providerId)).size} providers`);
  console.log('');

  // Search loop
  while (true) {
    const query = await prompt(bold('Search') + ' (or "q" to quit): ');
    if (query === 'q' || query === 'quit' || query === 'exit') {
      return;
    }

    const results = searchModels(allEntries, query);
    if (results.length === 0) {
      console.log(red('  No matches. Try a different search term.'));
      continue;
    }

    const showLimit = Math.min(results.length, 20);
    printResults(results, 0, showLimit);
    if (results.length > showLimit) {
      console.log(dim(`  ... and ${results.length - showLimit} more. Narrow your search.`));
    }
    console.log('');

    const pick = await prompt('Enter number to add (or press Enter to search again): ');
    if (!pick) continue;

    const num = parseInt(pick, 10);
    if (isNaN(num) || num < 1 || num > results.length) {
      console.log(red('  Invalid selection.'));
      continue;
    }

    const selected = results[num - 1];
    console.log('');
    console.log(`  Provider: ${bold(selected.providerName)}`);
    console.log(`  Model:    ${bold(selected.modelName)} (${selected.modelId})`);
    console.log(`  API:      ${selected.baseUrl}`);
    console.log(`  Format:   ${selected.format}`);
    console.log(`  Auth:     ${selected.apiKeyEnv}`);

    const hasKey = !!process.env[selected.apiKeyEnv];
    if (!hasKey) {
      console.log('');
      console.log(yellow(`  ${selected.apiKeyEnv} is not set.`));
      const key = await prompt(`  Enter API key (or press Enter to skip): `);
      if (key) {
        console.log(dim(`  Set for this session. To persist: export ${selected.apiKeyEnv}=${key}`));
        process.env[selected.apiKeyEnv] = key;
      }
    }

    // Write engine definition
    const def = modelEntryToEngineDef(selected);
    const dir = enginesDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${def.id}.json`), JSON.stringify(def, null, 2) + '\n');

    console.log('');
    success(`Added: ${bold(def.id)}`);
    if (!process.env[selected.apiKeyEnv]) {
      info(`Set your key: export ${selected.apiKeyEnv}=your_key`);
    }
    return;
  }
}

export const providerCommand = defineCommand({
  meta: {
    name: 'provider',
    description: 'Add, remove, or list API providers',
  },
  args: {
    action: {
      type: 'positional',
      description: 'Action: add | remove | list | browse',
      required: true,
    },
  },
  async run({ args }) {
    let action = args.action;
    const providerIdx = process.argv.indexOf('provider');
    const extra = providerIdx >= 0 ? process.argv.slice(providerIdx + 2) : [];

    switch (action) {
      case 'add': {
        // No args → interactive mode with models.dev registry
        if (extra.length === 0) {
          await interactiveAdd();
          return;
        }

        // With args → manual mode: agon provider add <id> <baseUrl> <apiKeyEnv> <model>
        if (extra.length < 4) {
          fail('Usage: agon provider add <id> <baseUrl> <API_KEY_ENV> <model>');
          console.log('');
          info('Or run without args for interactive model browser:');
          console.log('  agon provider add');
          process.exit(1);
        }

        const [id, baseUrl, apiKeyEnv, ...modelParts] = extra;
        if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
          fail('Provider ID must contain only letters, numbers, dots, hyphens, and underscores');
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
          fail('Provider ID must contain only letters, numbers, dots, hyphens, and underscores');
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

      case 'browse': {
        // Show full registry grouped by provider
        header('Available Models — models.dev');
        info('Fetching...');

        try {
          const registry = await fetchModelsRegistry();
          const entries = buildModelEntries(registry);
          printResults(entries, 0, 100);
          console.log('');
          info(`${entries.length} models total. Use "agon provider add" to add one interactively.`);
        } catch (err) {
          fail(`Could not fetch models.dev: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }

      case 'list':
      default: {
        const dir = enginesDir();
        header('Custom Providers');

        if (!existsSync(dir)) {
          info('No custom providers yet.');
          console.log('');
          info('Add one: agon provider add');
          return;
        }

        const files = readdirSync(dir).filter((f: string) => f.endsWith('.json'));
        if (files.length === 0) {
          info('No custom providers yet.');
          console.log('');
          info('Add one: agon provider add');
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
